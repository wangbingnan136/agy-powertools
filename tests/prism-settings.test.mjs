import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import {
  DEFAULT_SETTINGS,
  SCENE_PRESETS,
  createSettingsStore,
  exportSanitizedSettings,
  importSanitizedSettings,
  normalizeSettings
} from '../lib/settings.mjs';
import { toZhTw } from '../lib/zh-tw.mjs';

const panelsSource = readFileSync(new URL('../lib/prism-panels.js', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../lib/settings.mjs', import.meta.url), 'utf8');
const zhTwSource = readFileSync(new URL('../lib/zh-tw.mjs', import.meta.url), 'utf8');

function createHarness({ initialOptions = {}, requestHandler = async () => ({}), clipboardLog = [], downloads = [] } = {}) {
  let opts = { ...DEFAULT_SETTINGS, ...initialOptions };
  const changes = [];
  const requests = [];
  let stateSlots = [];
  let refSlots = [];
  let hookIdx = 0;
  let refIdx = 0;
  const effectQueue = [];

  const R = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      const flat = [];
      for (const child of children) {
        if (Array.isArray(child)) flat.push(...child);
        else flat.push(child);
      }
      return { type, props: props || {}, children: flat };
    },
    useState(init) {
      const i = hookIdx++;
      if (!(i in stateSlots)) stateSlots[i] = typeof init === 'function' ? init() : init;
      const setState = next => {
        stateSlots[i] = typeof next === 'function' ? next(stateSlots[i]) : next;
      };
      return [stateSlots[i], setState];
    },
    useRef(init) {
      const i = refIdx++;
      if (!(i in refSlots)) refSlots[i] = { current: init };
      return refSlots[i];
    },
    useEffect(fn) {
      effectQueue.push(fn);
    }
  };

  const h = R.createElement;
  const t = v => (opts.language === 'zh-TW' ? toZhTw(v) : v);
  const text = (zh, en) => (opts.language === 'en' ? en : opts.language === 'zh-TW' ? toZhTw(zh) : zh);
  const Uy = ({ children, ...props }) => h('button', props, children);
  const TP = ({ children, ...props }) => h('div', { 'data-comp': 'TP', ...props }, children);
  const UP = ({ label, description, rightElement, extraContent, ...props }) =>
    h('div', { 'data-comp': 'UP', ...props }, label, description, extraContent, rightElement);
  const XP = ({ checked, onCheckedChange, ...props }) =>
    h('input', { type: 'checkbox', role: 'switch', checked, onCheckedChange, ...props });
  const Select = ({ value, onChange, label, items = [], testId }) =>
    h('div', { 'data-testid': testId, 'aria-label': t(label), 'data-value': value },
      ...items.map(([k, name]) => h('button', {
        key: k,
        type: 'button',
        'data-testid': testId ? `${testId}-${k}` : undefined,
        onClick: () => onChange(k)
      }, t(name))));
  const section = (title, children) => h('section', { 'data-comp': 'section', 'data-title': title }, h('h3', null, t(title)), children);
  const card = (title, children, right) => h('section', { 'data-comp': 'card', 'data-title': title }, h('h2', null, t(title)), right, children);
  const icon = (name, size = 16, extra = {}) => h('span', { 'data-icon': name, 'data-size': size, ...extra });

  const env = {
    options: () => opts,
    defaults: DEFAULT_SETTINGS,
    async change(patch) {
      changes.push(patch);
      opts = normalizeSettings({ ...opts, ...patch });
      return opts;
    },
    async request(method, payload) {
      requests.push({ method, payload });
      return requestHandler(method, payload);
    }
  };

  const headNodes = [];
  const doc = {
    head: { append(el) { headNodes.push(el); } },
    body: { append() {} },
    createElement(tag) {
      return {
        tag,
        dataset: {},
        style: {},
        click() { downloads.push({ href: this.href, download: this.download }); },
        remove() { this.removed = true; }
      };
    }
  };

  const context = vm.createContext({
    React: R,
    __agyToZhTw: toZhTw,
    document: doc,
    Blob: class MockBlob { constructor(parts, info) { this.parts = parts; this.type = info?.type; } },
    URL: {
      createObjectURL: blob => `blob:mock/${downloads.length}:${blob.parts.join('')}`,
      revokeObjectURL() {}
    },
    navigator: {
      clipboard: {
        async writeText(txt) { clipboardLog.push(txt); }
      }
    }
  });

  vm.runInContext(panelsSource, context);
  const panels = context.__agyCreatePrismPanels({
    R,
    h,
    env,
    t,
    text,
    section,
    card,
    Select,
    Uy,
    TP,
    UP,
    XP,
    icon
  });

  const expand = node => {
    if (node == null || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') {
      return expand(node.type({ ...(node.props || {}), children: node.children }));
    }
    return {
      ...node,
      children: (node.children || []).map(expand)
    };
  };

  const render = (Component, props = {}) => {
    hookIdx = 0;
    refIdx = 0;
    effectQueue.length = 0;
    const raw = Component(props);
    return expand(raw);
  };

  const flushEffects = async () => {
    const fns = effectQueue.splice(0, effectQueue.length);
    for (const fn of fns) await fn();
  };

  const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

  const resetHooks = () => {
    stateSlots = [];
    refSlots = [];
  };

  const findByTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = findByTestId(child, id);
        if (hit) return hit;
      }
      return null;
    }
    if (node.props?.['data-testid'] === id) return node;
    return findByTestId(node.children || [], id);
  };

  const findAll = (node, pred, acc = []) => {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
      for (const child of node) findAll(child, pred, acc);
      return acc;
    }
    if (pred(node)) acc.push(node);
    findAll(node.children || [], pred, acc);
    return acc;
  };

  const collectText = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).filter(Boolean).join(' ');
    if (typeof node === 'object') {
      const parts = [];
      if (typeof node.props?.label === 'string') parts.push(node.props.label);
      if (typeof node.props?.description === 'string') parts.push(node.props.description);
      parts.push(collectText(node.children));
      return parts.filter(Boolean).join(' ');
    }
    return '';
  };

  return {
    panels,
    env,
    changes,
    requests,
    headNodes,
    render,
    flushEffects,
    flushMicrotasks,
    resetHooks,
    findByTestId,
    findAll,
    collectText,
    getOptions: () => opts,
    setLanguage: lang => { opts = { ...opts, language: lang }; }
  };
}

test('new settings keys validate enums, booleans, integer ranges, prompt cap, and reject invalid inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-prism-settings-'));
  try {
    const store = createSettingsStore(dir);
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);

    // 5 locales
    for (const lang of ['zh-CN', 'zh-TW', 'yue', 'en', 'ja']) {
      assert.equal(store.set({ language: lang }).language, lang);
    }

    // Valid enums and discrete numeric options
    const validEnumSamples = {
      themePalette: ['native', 'obsidian', 'warm'],
      lightThemePreset: ['crystal', 'alabaster'],
      accentTone: ['follow', 'cobalt', 'iris', 'amber', 'mono'],
      cornerStyle: ['sharp', 'balanced', 'soft'],
      codeFont: ['default', 'jetbrains', 'sfmono', 'fira'],
      ambientIntensity: [0, 35, 70, 100],
      placeholderStyle: ['native', 'studio'],
      logoInk: ['accent', 'foreground'],
      motionLevel: ['off', 'subtle', 'standard', 'ultra'],
      targetFps: [60, 120, 180, 0],
      contextStyle: ['ring', 'vial'],
      scrollBottomMotion: ['native', 'smooth'],
      mascotMode: ['off', 'crab', 'cat', 'pack'],
      linkTarget: ['builtin', 'external'],
      thoughtTranslate: ['off', 'machine', 'ai'],
      thoughtTrigger: ['preload', 'expand'],
      thoughtView: ['immersive', 'bilingual'],
      thoughtStyle: ['technical', 'concise', 'custom']
    };
    for (const [key, values] of Object.entries(validEnumSamples)) {
      for (const v of values) {
        assert.equal(store.set({ [key]: v })[key], v);
      }
    }

    // Valid booleans
    const booleanKeys = [
      'codeLigatures', 'sidebarCompact', 'sidebarNavFold', 'composerRestyle',
      'smoothCaret', 'streamInk', 'convAura', 'prismRim', 'homeRipple',
      'effortSlider', 'effortMemory', 'codeBlockFold', 'railHoverOutline',
      'inlineStepDiff', 'omniViewer', 'quickContextMenu',
      'translateSessionTitles', 'homeStudio', 'chatModeBeta', 'wallpaperEnabled'
    ];
    for (const key of booleanKeys) {
      assert.equal(store.set({ [key]: true })[key], true);
      assert.equal(store.set({ [key]: false })[key], false);
    }

    // Integer ranges
    assert.equal(store.set({ wallpaperOpacity: 0 }).wallpaperOpacity, 0);
    assert.equal(store.set({ wallpaperOpacity: 80 }).wallpaperOpacity, 80);
    assert.equal(store.set({ wallpaperBlur: 0 }).wallpaperBlur, 0);
    assert.equal(store.set({ wallpaperBlur: 32 }).wallpaperBlur, 32);
    assert.equal(store.set({ wallpaperDim: 0 }).wallpaperDim, 0);
    assert.equal(store.set({ wallpaperDim: 80 }).wallpaperDim, 80);

    // thoughtCustomPrompt trim & 2000-char cap
    const longPrompt = `  ${'x'.repeat(2400)}  `;
    assert.equal(store.set({ thoughtCustomPrompt: longPrompt }).thoughtCustomPrompt.length, 2000);
    assert.equal(store.set({ thoughtCustomPrompt: '  keep paths  ' }).thoughtCustomPrompt, 'keep paths');

    // Invalid types and out-of-range rejections without mutating persisted settings
    const before = readFileSync(join(dir, 'settings.json'), 'utf8');
    const badPayloads = [
      { language: 'fr' },
      { themePalette: 'solarized' },
      { lightThemePreset: 'paper' },
      { accentTone: 'crimson' },
      { cornerStyle: 'pill' },
      { codeFont: 'comic-sans' },
      { ambientIntensity: 50 },
      { ambientIntensity: '70' },
      { placeholderStyle: 'minimal' },
      { logoInk: 'primary' },
      { motionLevel: 'extreme' },
      { targetFps: 30 },
      { targetFps: '120' },
      { contextStyle: 'tube' },
      { scrollBottomMotion: 'elastic' },
      { mascotMode: 'dog' },
      { linkTarget: 'new-window' },
      { thoughtTranslate: 'deepl' },
      { thoughtTrigger: 'always' },
      { thoughtView: 'split' },
      { thoughtStyle: 'casual' },
      { thoughtCustomPrompt: 123 },
      { thoughtCustomPrompt: null },
      { wallpaperOpacity: -1 },
      { wallpaperOpacity: 81 },
      { wallpaperOpacity: 22.5 },
      { wallpaperOpacity: '22' },
      { wallpaperBlur: -1 },
      { wallpaperBlur: 33 },
      { wallpaperDim: 81 },
      { smoothCaret: 'true' },
      { homeStudio: 1 }
    ];
    for (const bad of badPayloads) {
      assert.throws(() => store.set(bad), /设置选项无效/);
    }
    assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SCENE_PRESETS are frozen, transition cleanly across presets, and native preserves account/proxy/language', () => {
  assert.equal(Object.isFrozen(SCENE_PRESETS), true);
  for (const key of ['native', 'ultra', 'focus', 'eco']) {
    assert.equal(Object.isFrozen(SCENE_PRESETS[key]), true);
  }

  const dir = mkdtempSync(join(tmpdir(), 'agy-prism-presets-'));
  try {
    const store = createSettingsStore(dir);
    store.set({
      language: 'ja',
      multiAccount: true,
      proxyEnabled: true,
      proxyUrl: 'http://user:pass@127.0.0.1:7897',
      thoughtTranslate: 'machine'
    });

    const ultra = store.set(SCENE_PRESETS.ultra);
    assert.equal(ultra.themePalette, 'obsidian');
    assert.equal(ultra.motionLevel, 'ultra');
    assert.equal(ultra.contextStyle, 'vial');
    assert.equal(ultra.smoothCaret, true);
    assert.equal(ultra.scrollBottomMotion, 'smooth');
    assert.equal(ultra.streamInk, true);
    assert.equal(ultra.convAura, true);
    assert.equal(ultra.prismRim, true);
    assert.equal(ultra.homeRipple, true);
    assert.equal(ultra.mascotMode, 'pack');
    assert.equal(ultra.composerRestyle, true);
    assert.equal(ultra.sidebarCompact, true);

    const focus = store.set(SCENE_PRESETS.focus);
    assert.equal(focus.themePalette, 'obsidian');
    assert.equal(focus.motionLevel, 'subtle');
    assert.equal(focus.contextStyle, 'ring');
    assert.equal(focus.streamInk, false);
    assert.equal(focus.mascotMode, 'off');
    assert.equal(focus.codeBlockFold, true);
    assert.equal(focus.inlineStepDiff, true);

    const eco = store.set(SCENE_PRESETS.eco);
    assert.equal(eco.motionLevel, 'off');
    assert.equal(eco.ambientIntensity, 0);
    assert.equal(eco.smoothCaret, false);
    assert.equal(eco.wallpaperEnabled, false);
    assert.equal(eco.streamInk, false);

    const native = store.set(SCENE_PRESETS.native);
    assert.equal(native.themePalette, DEFAULT_SETTINGS.themePalette);
    assert.equal(native.motionLevel, DEFAULT_SETTINGS.motionLevel);
    assert.equal(native.ambientIntensity, DEFAULT_SETTINGS.ambientIntensity);
    assert.equal(native.mascotMode, DEFAULT_SETTINGS.mascotMode);
    // Preserves language, account, proxy, and thought settings
    assert.equal(native.language, 'ja');
    assert.equal(native.multiAccount, true);
    assert.equal(native.proxyEnabled, true);
    assert.equal(native.proxyUrl, 'http://user:pass@127.0.0.1:7897');
    assert.equal(native.thoughtTranslate, 'machine');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exportSanitizedSettings and importSanitizedSettings strip secrets and preserve proxy auth cleanly', () => {
  const current = {
    ...DEFAULT_SETTINGS,
    themePalette: 'obsidian',
    proxyEnabled: true,
    proxyUrl: 'http://alice:secret123@127.0.0.1:7897'
  };
  const bundle = exportSanitizedSettings(current, {
    apiKey: 'sk-top-secret',
    thoughtProfiles: [
      { id: 'p1', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-hidden-key', model: 'deepseek-chat' }
    ],
    nested: { api_key: 'sk-snake', accessToken: 'tok-abc', proxyUrl: 'socks5://bob:pw@[::1]:1080', note: 'keep-me' }
  });

  assert.equal(bundle.format, 'agy-powertools-settings-v1');
  assert.ok(Date.parse(bundle.exportedAt) > 0);
  assert.equal(bundle.settings.proxyUrl, 'http://127.0.0.1:7897');
  assert.equal('apiKey' in bundle, false);
  assert.equal('apiKey' in bundle.thoughtProfiles[0], false);
  assert.equal('api_key' in bundle.nested, false);
  assert.equal('accessToken' in bundle.nested, false);
  assert.equal(bundle.nested.proxyUrl, 'socks5://[::1]:1080');
  assert.equal(bundle.nested.note, 'keep-me');
  assert.equal(JSON.stringify(bundle).includes('secret123'), false);
  assert.equal(JSON.stringify(bundle).includes('sk-hidden-key'), false);

  // Importing back preserves existing proxyUrl auth when host/port match and auth was stripped
  const patch1 = importSanitizedSettings({
    format: 'agy-powertools-settings-v1',
    settings: {
      ...bundle.settings,
      motionLevel: 'ultra',
      unknownField: 'ignore',
      wallpaperOpacity: 999,
      __proto__: { polluted: true }
    }
  }, current);
  assert.equal(patch1.motionLevel, 'ultra');
  assert.equal(patch1.proxyUrl, 'http://alice:secret123@127.0.0.1:7897');
  assert.equal('unknownField' in patch1, false);
  assert.equal('wallpaperOpacity' in patch1, false);

  // Importing with masked proxy auth also preserves existing auth
  const patchMasked = importSanitizedSettings({
    format: 'agy-powertools-settings-v1',
    settings: { proxyUrl: 'http://***@127.0.0.1:7897', themePalette: 'warm' }
  }, current);
  assert.equal(patchMasked.proxyUrl, 'http://alice:secret123@127.0.0.1:7897');

  // Importing a different proxy server replaces proxyUrl as requested
  const patchDiffProxy = importSanitizedSettings({
    format: 'agy-powertools-settings-v1',
    settings: { proxyUrl: 'http://127.0.0.1:8888' }
  }, current);
  assert.equal(patchDiffProxy.proxyUrl, 'http://127.0.0.1:8888');

  // Invalid bundles throw clear Chinese error
  for (const invalid of [null, [], '{}', 'not-json', { format: 'wrong', settings: { compact: false } }, { settings: { unknownOnly: 1 } }, { settings: 'bad' }]) {
    assert.throws(() => importSanitizedSettings(invalid, current), /配置 JSON 格式无效/);
  }
});

test('prism-panels.js renders CategoryFilter, ScenePresetBar, Optics, and Workbench sections with exact bindings', async () => {
  const h = createHarness();
  assert.deepEqual(
    JSON.parse(JSON.stringify(h.panels.SCENE_PRESETS)),
    JSON.parse(JSON.stringify(SCENE_PRESETS))
  );

  // Category filter
  let pickedCategory = '';
  const catTree = h.render(h.panels.SettingsCategoryFilter, {
    value: 'all',
    onChange: next => { pickedCategory = next; }
  });
  for (const cat of ['all', 'optics', 'workbench', 'thought', 'telemetry', 'accounts', 'beta']) {
    const btn = h.findByTestId(catTree, `agy-settings-cat-${cat}`);
    assert.ok(btn, `Missing category button ${cat}`);
  }
  h.findByTestId(catTree, 'agy-settings-cat-thought').props.onClick();
  assert.equal(pickedCategory, 'thought');

  // Scene preset bar applies in <10ms
  const presetTree = h.render(h.panels.ScenePresetBar);
  const start = performance.now();
  h.findByTestId(presetTree, 'agy-scene-preset-ultra').props.onClick();
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 10, `Preset click took ${elapsed}ms`);
  assert.deepEqual(JSON.parse(JSON.stringify(h.changes.at(-1))), JSON.parse(JSON.stringify(SCENE_PRESETS.ultra)));

  // Keyboard navigation on SettingsCategoryFilter
  const focusCalls = [];
  catTree.props && h.findByTestId(catTree, 'agy-settings-cat-all').props.onKeyDown({
    key: 'ArrowRight',
    preventDefault() {},
    currentTarget: { parentElement: { children: [{ focus() { focusCalls.push(0); } }, { focus() { focusCalls.push(1); } }] } }
  });
  assert.equal(pickedCategory, 'optics');
  assert.deepEqual(focusCalls, [1]);

  // Re-render preset bar confirms active state follows options
  const activePresetTree = h.render(h.panels.ScenePresetBar);
  assert.equal(h.findByTestId(activePresetTree, 'agy-scene-preset-ultra').props['aria-pressed'], true);
  assert.equal(h.findByTestId(activePresetTree, 'agy-scene-preset-eco').props['aria-pressed'], false);

  // Optics section renders all 22 controls and updates values cleanly
  const opticsTree = h.render(h.panels.OpticsSettingsSection);
  const opticsKeys = [
    'themePalette', 'lightThemePreset', 'accentTone', 'cornerStyle', 'codeFont',
    'codeLigatures', 'ambientIntensity', 'sidebarCompact', 'sidebarNavFold',
    'composerRestyle', 'placeholderStyle', 'logoInk', 'motionLevel', 'targetFps',
    'contextStyle', 'smoothCaret', 'scrollBottomMotion', 'streamInk',
    'convAura', 'prismRim', 'homeRipple', 'mascotMode'
  ];
  for (const key of opticsKeys) {
    assert.ok(h.findByTestId(opticsTree, `agy-setting-row-${key}`), `Missing optics row ${key}`);
  }
  h.findByTestId(opticsTree, 'agy-setting-themePalette-warm').props.onClick();
  await Promise.resolve();
  assert.equal(h.getOptions().themePalette, 'warm');

  h.findByTestId(opticsTree, 'agy-setting-ambientIntensity-35').props.onClick();
  await Promise.resolve();
  assert.strictEqual(h.getOptions().ambientIntensity, 35);

  h.findByTestId(opticsTree, 'agy-setting-targetFps-180').props.onClick();
  await Promise.resolve();
  assert.strictEqual(h.getOptions().targetFps, 180);

  h.findByTestId(opticsTree, 'agy-setting-mascotMode-cat').props.onClick();
  await Promise.resolve();
  assert.equal(h.getOptions().mascotMode, 'cat');

  // Workbench section renders all 8 controls
  const wbTree = h.render(h.panels.WorkbenchSettingsSection);
  const wbKeys = [
    'effortSlider', 'effortMemory', 'codeBlockFold', 'railHoverOutline',
    'inlineStepDiff', 'omniViewer', 'linkTarget', 'quickContextMenu'
  ];
  for (const key of wbKeys) {
    assert.ok(h.findByTestId(wbTree, `agy-setting-row-${key}`), `Missing workbench row ${key}`);
  }
  h.findByTestId(wbTree, 'agy-setting-linkTarget-external').props.onClick();
  await Promise.resolve();
  assert.equal(h.getOptions().linkTarget, 'external');
  h.findByTestId(wbTree, 'agy-setting-effortSlider').props.onCheckedChange(false);
  await Promise.resolve();
  assert.equal(h.getOptions().effortSlider, false);

  h.panels.dispose();
  assert.equal(h.headNodes[0].removed, true);
});

test('ThoughtSettingsSection supports diagnostics, cache clear, custom prompt, and AI provider management', async () => {
  const h = createHarness({
    initialOptions: { thoughtTranslate: 'ai', thoughtStyle: 'custom', thoughtCustomPrompt: 'Initial prompt' },
    requestHandler: async (method, payload) => {
      if (method === 'thought.diagnose') {
        return { ok: true, latencyMs: 42, proxyActive: true, proxyUrl: 'http://127.0.0.1:7897', upstreamOk: true, message: 'OK' };
      }
      if (method === 'thought.clearCache') {
        return { ok: true, cleared: 17 };
      }
      if (method === 'thought.profiles.get') {
        return {
          ok: true,
          activeProfileId: 'p1',
          profiles: [{ id: 'p1', name: 'Local Ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'qwen2.5' }],
          cacheEntries: 3
        };
      }
      if (method === 'thought.models') {
        return { ok: true, models: ['qwen2.5', 'llama3.2'] };
      }
      if (method === 'thought.profiles.save') {
        return { ok: true, activeProfileId: 'p1', profiles: [{ id: 'p1', ...payload.profile }] };
      }
      if (method === 'thought.translate') {
        return { ok: true, translated: '检查边界条件并验证输出。', model: 'qwen2.5' };
      }
      if (method === 'thought.profiles.delete') {
        return { ok: true, activeProfileId: '', profiles: [] };
      }
      return { ok: true };
    }
  });

  h.render(h.panels.ThoughtSettingsSection);
  await h.flushEffects();
  const tree1 = h.render(h.panels.ThoughtSettingsSection);
  assert.ok(h.findByTestId(tree1, 'agy-thought-profiles-card'));
  assert.ok(h.collectText(h.findByTestId(tree1, 'agy-thought-privacy-notice')).includes('0600'));

  const customPromptEl = h.findByTestId(tree1, 'agy-thought-custom-prompt');
  assert.ok(customPromptEl);
  customPromptEl.props.onChange({ target: { value: '  concise notes  ' } });
  await Promise.resolve();
  assert.equal(h.getOptions().thoughtCustomPrompt, 'concise notes');

  h.findByTestId(tree1, 'agy-thought-diagnose-btn').props.onClick();
  h.findByTestId(tree1, 'agy-thought-clear-cache-btn').props.onClick();
  h.findByTestId(tree1, 'agy-thought-fetch-models').props.onClick();
  h.findByTestId(tree1, 'agy-thought-test-btn').props.onClick();
  await h.flushMicrotasks();

  const tree2 = h.render(h.panels.ThoughtSettingsSection);
  const diagText = h.collectText(h.findByTestId(tree2, 'agy-thought-diagnose-result'));
  assert.ok(diagText.includes('42ms'));
  assert.ok(diagText.includes('http://127.0.0.1:7897'));
  assert.ok(h.collectText(h.findByTestId(tree2, 'agy-thought-cache-feedback')).includes('17'));
  assert.equal(h.findAll(tree2, n => n.props?.['data-testid'] === 'agy-thought-model-chip').length, 2);
  assert.ok(h.collectText(h.findByTestId(tree2, 'agy-thought-test-result')).includes('检查边界条件并验证输出'));

  h.findByTestId(tree2, 'agy-thought-profile-save').props.onClick();
  await h.flushMicrotasks();
  const tree3 = h.render(h.panels.ThoughtSettingsSection);
  h.findByTestId(tree3, 'agy-thought-profile-delete-p1').props.onClick();
  await h.flushMicrotasks();
  assert.ok(h.requests.some(r => r.method === 'thought.profiles.save'));
  assert.ok(h.requests.some(r => r.method === 'thought.profiles.delete'));
});

test('BetaAndArchiveSection & ConfigBackupSection invoke wallpaper, archive, export, and import IPC flows', async () => {
  const clipboardLog = [];
  const downloads = [];
  const h = createHarness({
    clipboardLog,
    downloads,
    requestHandler: async (method, payload) => {
      if (method === 'wallpaper.status') return { ok: true, hasMedia: false, fileName: '' };
      if (method === 'wallpaper.setPath') return { ok: true, hasMedia: true, kind: 'video', fileName: 'bg.mp4' };
      if (method === 'wallpaper.clear') return { ok: true, hasMedia: false, fileName: '' };
      if (method === 'archive.scan') return { ok: true, eligibleCount: 6, totalBytes: 15 * 1024 * 1024 };
      if (method === 'archive.run') return { ok: true, archivedCount: 6, mbFreed: 15.0 };
      if (method === 'archive.restore') return { ok: true, restoredCount: 6, mbFreed: 15.0 };
      if (method === 'settings.export') {
        return {
          format: 'agy-powertools-settings-v1',
          settings: { ...DEFAULT_SETTINGS, themePalette: 'obsidian', proxyUrl: 'http://u:p@127.0.0.1:7897' },
          apiKey: 'sk-should-strip'
        };
      }
      if (method === 'settings.import') {
        const patch = importSanitizedSettings(payload.bundle, DEFAULT_SETTINGS);
        return { ok: true, settings: patch };
      }
      return { ok: true };
    }
  });

  // Beta & Archive
  let betaTree = h.render(h.panels.BetaAndArchiveSection);
  h.findByTestId(betaTree, 'agy-wallpaper-path-input').props.onChange({ target: { value: '/tmp/bg.mp4' } });
  betaTree = h.render(h.panels.BetaAndArchiveSection);
  h.findByTestId(betaTree, 'agy-wallpaper-apply-btn').props.onClick();
  await h.flushMicrotasks();
  h.findByTestId(betaTree, 'agy-setting-wallpaperOpacity').props.onChange({ target: { value: '45' } });
  h.findByTestId(betaTree, 'agy-archive-scan-btn').props.onClick();
  await h.flushMicrotasks();
  let betaAfterScan = h.render(h.panels.BetaAndArchiveSection);
  assert.ok(h.collectText(h.findByTestId(betaAfterScan, 'agy-archive-status')).includes('15.0 MB'));
  h.findByTestId(betaAfterScan, 'agy-archive-run-btn').props.onClick();
  await h.flushMicrotasks();
  let betaAfterRun = h.render(h.panels.BetaAndArchiveSection);
  assert.ok(h.collectText(h.findByTestId(betaAfterRun, 'agy-archive-status')).includes('6'));
  h.findByTestId(betaAfterRun, 'agy-archive-restore-btn').props.onClick();
  await h.flushMicrotasks();
  h.findByTestId(betaAfterRun, 'agy-wallpaper-clear-btn').props.onClick();
  await h.flushMicrotasks();
  assert.equal(h.getOptions().wallpaperOpacity, 45);
  assert.equal(h.getOptions().wallpaperEnabled, true);

  // Config Backup export & import
  h.resetHooks();
  let backupTree = h.render(h.panels.ConfigBackupSection);
  h.findByTestId(backupTree, 'agy-settings-export-btn').props.onClick();
  await h.flushMicrotasks();
  assert.equal(clipboardLog.length, 1);
  assert.equal(downloads.length, 1);
  const exportedJson = JSON.parse(clipboardLog[0]);
  assert.equal('apiKey' in exportedJson, false);
  assert.equal(exportedJson.settings.proxyUrl, 'http://127.0.0.1:7897');

  // Invalid JSON import feedback
  h.findByTestId(backupTree, 'agy-settings-import-textarea').props.onChange({ target: { value: '{bad-json' } });
  backupTree = h.render(h.panels.ConfigBackupSection);
  h.findByTestId(backupTree, 'agy-settings-import-btn').props.onClick();
  await h.flushMicrotasks();
  let backupErrorTree = h.render(h.panels.ConfigBackupSection);
  assert.ok(h.collectText(h.findByTestId(backupErrorTree, 'agy-settings-backup-status')).includes('无效'));

  // Valid JSON import updates UI options
  h.findByTestId(backupErrorTree, 'agy-settings-import-textarea').props.onChange({
    target: { value: JSON.stringify({ format: 'agy-powertools-settings-v1', settings: { themePalette: 'warm', motionLevel: 'standard' } }) }
  });
  backupTree = h.render(h.panels.ConfigBackupSection);
  h.findByTestId(backupTree, 'agy-settings-import-btn').props.onClick();
  await h.flushMicrotasks();
  assert.equal(h.getOptions().themePalette, 'warm');
  assert.equal(h.getOptions().motionLevel, 'standard');

  // File picker import also parses JSON and updates UI options
  h.findByTestId(backupTree, 'agy-settings-import-file').props.onChange({
    target: {
      files: [{
        async text() {
          return JSON.stringify({ format: 'agy-powertools-settings-v1', settings: { cornerStyle: 'soft', linkTarget: 'external' } });
        }
      }]
    }
  });
  await h.flushMicrotasks();
  assert.equal(h.getOptions().cornerStyle, 'soft');
  assert.equal(h.getOptions().linkTarget, 'external');
});

test('5-locale resolution (zh-CN, zh-TW, yue, en, ja), zero middle-dots, no ESM syntax, and toZhTw glyph purity', () => {
  const h = createHarness();
  const tr5 = h.panels.tr5;

  const sample = ['光学设置', 'Optics settings', '光学設定', '光學設定'];
  h.setLanguage('zh-CN');
  assert.equal(tr5(...sample), '光学设置');
  h.setLanguage('zh-TW');
  assert.equal(tr5(...sample), '光學設定');
  h.setLanguage('yue');
  assert.equal(tr5(...sample), '光學設定');
  h.setLanguage('en');
  assert.equal(tr5(...sample), 'Optics settings');
  h.setLanguage('ja');
  assert.equal(tr5(...sample), '光学設定');

  // Rendered components across all 5 locales contain zero middle dots
  for (const lang of ['zh-CN', 'zh-TW', 'yue', 'en', 'ja']) {
    h.setLanguage(lang);
    for (const comp of [
      () => h.render(h.panels.SettingsCategoryFilter, { value: 'all' }),
      () => h.render(h.panels.ScenePresetBar),
      () => h.render(h.panels.OpticsSettingsSection),
      () => h.render(h.panels.WorkbenchSettingsSection),
      () => h.render(h.panels.ThoughtSettingsSection),
      () => h.render(h.panels.BetaAndArchiveSection),
      () => h.render(h.panels.ConfigBackupSection)
    ]) {
      h.resetHooks();
      const txt = h.collectText(comp());
      assert.equal(txt.includes('\u00b7'), false, `Middle dot found in rendered UI for ${lang}`);
    }
  }

  // Browser IIFE must contain no ESM import/export
  assert.equal(/^\s*(?:import|export)\b/m.test(panelsSource), false);

  // Zero middle dots across all owned source files
  for (const [name, src] of [['settings.mjs', settingsSource], ['zh-tw.mjs', zhTwSource], ['prism-panels.js', panelsSource]]) {
    assert.equal(src.includes('\u00b7'), false, `Middle dot found in ${name}`);
  }

  // Simplified-only glyph check matching tests/i18n.test.mjs line 79
  const simplifiedOnly = /[万与个为义于产仅从仓们价优会传体余侧关内写准减凑凭击划则刚创删务动区协单占却历压参发变号后听启周响唤围图圆场声处备头夹实审对导将尝尽层带帮并广库应开异强归当录径忆态总战执扩扬抢护报担拦择挂换据数断无旧时昵显暂机权条来栏树样档检汇没洁浅测浏滚满点热状独环现电监盘码确碍离积称稳筛签简类紧级线组细织终结给络绝统继续缓编缩网联脑范营补装观规视览触计订认让议记许设访证识诊试话询该详语误说请读调败账费资转轮软载较辅辑输边过运这进远违连迟适选遥邮采钟钥钮链销错键长闭问闲间阅队阶际险随隐静页顶项顺顿预频题额风馈驻验骤麦标彻]/;
  for (const [name, src] of [['settings.mjs', settingsSource], ['prism-panels.js', panelsSource]]) {
    const converted = toZhTw(src).replace(/简体中文|批准/g, '');
    const leftover = converted.match(simplifiedOnly);
    assert.equal(leftover, null, `Unexpected simplified glyph ${leftover?.[0]} in ${name}`);
  }
});
