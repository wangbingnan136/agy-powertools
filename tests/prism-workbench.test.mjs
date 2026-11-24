import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { toZhTw } from '../lib/zh-tw.mjs';

const source = readFileSync(new URL('../lib/prism-workbench.js', import.meta.url), 'utf8');

// Lightweight, deterministic Mock DOM with full CSS selector & event bubbling support
function createMockDom() {
  const listenersByNode = new WeakMap();

  function splitSelectorList(selector) {
    const parts = [];
    let buf = '';
    let bracket = 0;
    let quote = '';
    for (let i = 0; i < selector.length; i++) {
      const ch = selector[i];
      if (quote) {
        buf += ch;
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
      if (ch === '[') { bracket++; buf += ch; continue; }
      if (ch === ']') { bracket = Math.max(0, bracket - 1); buf += ch; continue; }
      if (ch === ',' && bracket === 0) {
        if (buf.trim()) parts.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts;
  }

  function splitCombinators(sel) {
    const tokens = [];
    let buf = '';
    let bracket = 0;
    let quote = '';
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (quote) { buf += ch; if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
      if (ch === '[') { bracket++; buf += ch; continue; }
      if (ch === ']') { bracket = Math.max(0, bracket - 1); buf += ch; continue; }
      if (bracket === 0 && /\s/.test(ch)) {
        if (buf) { tokens.push(buf); buf = ''; }
        continue;
      }
      buf += ch;
    }
    if (buf) tokens.push(buf);
    return tokens;
  }

  function matchesSimple(el, simple) {
    if (!el || el.nodeType !== 1) return false;
    let rest = simple;
    // Tag prefix
    const tagMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9_-]*|\*)/);
    if (tagMatch) {
      const tag = tagMatch[1];
      if (tag !== '*' && el.tagName !== tag.toUpperCase()) return false;
      rest = rest.slice(tag.length);
    }
    while (rest.length > 0) {
      if (rest.startsWith('#')) {
        const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
        if (!m) return false;
        if (el.id !== m[1]) return false;
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith('.')) {
        const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
        if (!m) return false;
        if (!el.classList.contains(m[1])) return false;
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith('[')) {
        const end = rest.indexOf(']');
        if (end < 0) return false;
        const inner = rest.slice(1, end);
        rest = rest.slice(end + 1);
        const attrMatch = inner.match(/^([^=\^*$|~]+)(?:(\^=|\*=|\$=|=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/);
        if (!attrMatch) return false;
        const attrName = attrMatch[1].trim();
        const op = attrMatch[2];
        const expected = attrMatch[3] ?? attrMatch[4] ?? attrMatch[5] ?? '';
        const actual = el.getAttribute(attrName);
        if (!op) {
          if (!el.hasAttribute(attrName)) return false;
        } else if (op === '=') {
          if (actual !== expected) return false;
        } else if (op === '^=') {
          if (actual == null || !actual.startsWith(expected)) return false;
        } else if (op === '*=') {
          if (actual == null || !actual.includes(expected)) return false;
        } else if (op === '$=') {
          if (actual == null || !actual.endsWith(expected)) return false;
        }
      } else {
        return false;
      }
    }
    return true;
  }

  function matchesSingleSelector(el, selector) {
    const chain = splitCombinators(selector);
    if (!chain.length) return false;
    if (!matchesSimple(el, chain[chain.length - 1])) return false;
    let cur = el.parentElement;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (cur && !matchesSimple(cur, chain[i])) cur = cur.parentElement;
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  function matchesSelector(el, selector) {
    if (!el || el.nodeType !== 1 || !selector) return false;
    return splitSelectorList(selector).some(part => matchesSingleSelector(el, part));
  }

  function makeClassList(el) {
    return {
      add(...names) {
        const cur = new Set(String(el._className || '').split(/\s+/).filter(Boolean));
        for (const n of names) if (n) cur.add(n);
        el._className = [...cur].join(' ');
      },
      remove(...names) {
        const cur = new Set(String(el._className || '').split(/\s+/).filter(Boolean));
        for (const n of names) cur.delete(n);
        el._className = [...cur].join(' ');
      },
      contains(name) {
        return String(el._className || '').split(/\s+/).includes(name);
      }
    };
  }

  class MockText {
    constructor(val) {
      this.nodeType = 3;
      this.nodeValue = String(val ?? '');
      this.parentNode = null;
      this.parentElement = null;
      this.childNodes = [];
    }
    get textContent() { return this.nodeValue; }
    set textContent(v) { this.nodeValue = String(v ?? ''); }
    get isConnected() {
      let p = this.parentNode;
      while (p) { if (p === document) return true; p = p.parentNode; }
      return false;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
  }

  class MockElement {
    constructor(tagName) {
      this.nodeType = 1;
      this.tagName = String(tagName || 'DIV').toUpperCase();
      this._attrs = new Map();
      this._className = '';
      this.childNodes = [];
      this.parentNode = null;
      this.parentElement = null;
      this.style = {};
      this.hidden = false;
      this.value = '';
      this.scrollTop = 0;
      this.playbackRate = 1;
      this.currentTime = 0;
      this.duration = 120;
      this.paused = false;
      this.scrolledIntoViewCount = 0;
      this.clickedCount = 0;
      this._rectFn = null;
      this.classList = makeClassList(this);
      this.dataset = new Proxy({}, {
        get: (_, key) => {
          const attr = `data-${String(key).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`;
          return this._attrs.get(attr);
        },
        set: (_, key, val) => {
          const attr = `data-${String(key).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`;
          this._attrs.set(attr, String(val));
          return true;
        },
        deleteProperty: (_, key) => {
          const attr = `data-${String(key).replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}`;
          this._attrs.delete(attr);
          return true;
        }
      });
    }
    get id() { return this._attrs.get('id') || ''; }
    set id(v) { this._attrs.set('id', String(v)); }
    get className() { return this._className; }
    set className(v) { this._className = String(v || ''); }
    get isConnected() {
      let p = this;
      while (p) { if (p === document) return true; p = p.parentNode; }
      return false;
    }
    get children() { return this.childNodes.filter(c => c.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 ? (this.parentNode.childNodes[idx + 1] || null) : null;
    }
    get nextElementSibling() {
      let n = this.nextSibling;
      while (n && n.nodeType !== 1) n = n.nextSibling;
      return n || null;
    }
    get previousElementSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      for (let i = idx - 1; i >= 0; i--) {
        if (this.parentNode.childNodes[i].nodeType === 1) return this.parentNode.childNodes[i];
      }
      return null;
    }
    get textContent() {
      return this.childNodes.map(c => c.textContent).join('');
    }
    set textContent(v) {
      for (const c of this.childNodes) { c.parentNode = null; c.parentElement = null; }
      this.childNodes = [];
      const s = String(v ?? '');
      if (s) this.appendChild(new MockText(s));
    }
    get outerHTML() {
      return `<${this.tagName.toLowerCase()}>${this.textContent}</${this.tagName.toLowerCase()}>`;
    }
    setAttribute(name, value) {
      if (name === 'class') this._className = String(value);
      else this._attrs.set(name, String(value));
    }
    getAttribute(name) {
      if (name === 'class') return this._className;
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
    hasAttribute(name) {
      if (name === 'class') return Boolean(this._className);
      return this._attrs.has(name);
    }
    removeAttribute(name) {
      if (name === 'class') this._className = '';
      else this._attrs.delete(name);
    }
    appendChild(child) {
      if (typeof child === 'string') child = new MockText(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      child.parentElement = this.nodeType === 1 ? this : null;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(child, refNode) {
      if (typeof child === 'string') child = new MockText(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      child.parentElement = this.nodeType === 1 ? this : null;
      const idx = refNode ? this.childNodes.indexOf(refNode) : -1;
      if (idx < 0) this.childNodes.push(child);
      else this.childNodes.splice(idx, 0, child);
      return child;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
        child.parentElement = null;
      }
      return child;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    cloneNode(deep = false) {
      const copy = new MockElement(this.tagName);
      copy._className = this._className;
      for (const [k, v] of this._attrs) copy._attrs.set(k, v);
      if (deep) {
        for (const c of this.childNodes) {
          copy.appendChild(c.nodeType === 3 ? new MockText(c.nodeValue) : c.cloneNode(true));
        }
      }
      return copy;
    }
    matches(sel) { return matchesSelector(this, sel); }
    closest(sel) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(sel) {
      const res = [];
      const walk = node => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (matchesSelector(child, sel)) res.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return res;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    getBoundingClientRect() {
      if (typeof this._rectFn === 'function') return this._rectFn(this);
      return { left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 };
    }
    getContext() {
      const ops = [];
      return {
        ops,
        clearRect(...a) { ops.push(['clearRect', ...a]); },
        fillRect(...a) { ops.push(['fillRect', ...a]); },
        drawImage(...a) { ops.push(['drawImage', ...a]); },
        scale(...a) { ops.push(['scale', ...a]); }
      };
    }
    toDataURL() { return 'data:image/png;base64,MOCKPNG'; }
    pause() { this.paused = true; }
    focus() { document.activeElement = this; }
    scrollIntoView() { this.scrolledIntoViewCount++; }
    addEventListener(type, fn, opts) {
      const signal = typeof opts === 'object' ? opts?.signal : undefined;
      if (signal?.aborted) return;
      if (!listenersByNode.has(this)) listenersByNode.set(this, new Map());
      const map = listenersByNode.get(this);
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(fn);
      if (signal) {
        signal.addEventListener('abort', () => {
          const arr = map.get(type);
          if (arr) {
            const idx = arr.indexOf(fn);
            if (idx >= 0) arr.splice(idx, 1);
          }
        }, { once: true });
      }
    }
    dispatchEvent(event) {
      event.target = event.target || this;
      if (typeof event.preventDefault !== 'function') {
        event.defaultPrevented = false;
        event.preventDefault = () => { event.defaultPrevented = true; };
      }
      if (typeof event.stopPropagation !== 'function') {
        event._stopped = false;
        event.stopPropagation = () => { event._stopped = true; };
      }
      let cur = this;
      while (cur) {
        event.currentTarget = cur;
        const map = listenersByNode.get(cur);
        const fns = map?.get(event.type);
        if (fns) {
          for (const fn of [...fns]) fn(event);
        }
        if (event._stopped || event.bubbles === false) break;
        cur = cur.parentNode;
      }
      return !event.defaultPrevented;
    }
    click() {
      this.clickedCount++;
      this.dispatchEvent({ type: 'click', bubbles: true });
    }
  }

  const documentElement = new MockElement('html');
  const head = new MockElement('head');
  const body = new MockElement('body');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  const document = {
    nodeType: 9,
    documentElement,
    head,
    body,
    activeElement: body,
    childNodes: [documentElement],
    createElement: tag => new MockElement(tag),
    createTextNode: val => new MockText(val),
    createRange: () => ({
      startContainer: null,
      startOffset: 0,
      endContainer: null,
      endOffset: 0,
      setStart(n, o) { this.startContainer = n; this.startOffset = o; },
      setEnd(n, o) { this.endContainer = n; this.endOffset = o; },
      getClientRects() { return [{ left: 10, top: 10, right: 200, bottom: 30 }]; }
    }),
    getElementById: id => documentElement.querySelector(`#${id}`),
    querySelector: sel => documentElement.querySelector(sel),
    querySelectorAll: sel => documentElement.querySelectorAll(sel),
    addEventListener(type, fn, opts) {
      const signal = typeof opts === 'object' ? opts?.signal : undefined;
      if (signal?.aborted) return;
      if (!listenersByNode.has(document)) listenersByNode.set(document, new Map());
      const map = listenersByNode.get(document);
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(fn);
      if (signal) {
        signal.addEventListener('abort', () => {
          const arr = map.get(type);
          if (arr) {
            const idx = arr.indexOf(fn);
            if (idx >= 0) arr.splice(idx, 1);
          }
        }, { once: true });
      }
    },
    dispatchEvent(event) {
      event.target = event.target || document.body;
      if (typeof event.preventDefault !== 'function') {
        event.defaultPrevented = false;
        event.preventDefault = () => { event.defaultPrevented = true; };
      }
      if (typeof event.stopPropagation !== 'function') {
        event._stopped = false;
        event.stopPropagation = () => { event._stopped = true; };
      }
      const fns = listenersByNode.get(document)?.get(event.type) || [];
      for (const fn of [...fns]) fn(event);
      return !event.defaultPrevented;
    }
  };
  documentElement.parentNode = document;

  const storageMap = new Map();
  const localStorage = {
    getItem: k => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => { storageMap.set(k, String(v)); },
    removeItem: k => { storageMap.delete(k); },
    clear: () => { storageMap.clear(); }
  };

  const highlightsMap = new Map();
  class Highlight {
    constructor(...ranges) { this.ranges = ranges; }
  }
  const CSS = { highlights: highlightsMap };

  const copiedTexts = [];
  const openedUrls = [];
  let selectedText = '';

  const context = vm.createContext({
    document,
    window: {
      open: (url, target) => { openedUrls.push({ url, target }); },
      getSelection: () => ({ toString: () => selectedText }),
      addEventListener() {}
    },
    location: { pathname: '/c/conv-1' },
    localStorage,
    CSS,
    Highlight,
    AbortController,
    Event: class MockEvent { constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles); } },
    navigator: {
      clipboard: {
        writeText: async txt => { copiedTexts.push(txt); }
      }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    __agyToZhTw: toZhTw
  });

  vm.runInContext(source, context);

  return {
    context,
    document,
    localStorage,
    highlightsMap,
    copiedTexts,
    openedUrls,
    setSelectedText(v) { selectedText = v; },
    createWorkbench: env => context.__agyCreateWorkbench(env)
  };
}

function flush() {
  return new Promise(resolve => setTimeout(resolve, 15));
}

test('script format: browser IIFE (no ESM import/export), zero middle dots, and clean toZhTw conversion', () => {
  assert.equal(/^\s*(?:import|export)\b/m.test(source), false, 'Must not use ESM import/export');
  assert.equal(source.includes('\u00b7'), false, 'Must never include middle dot character');
  const simplifiedOnly = /[万与个为义于产仅从仓们价优会传体余侧关内写准减凑凭击划则刚创删务动区协单占却历压参发变号后听启周响唤围图圆场声处备头夹实审对导将尝尽层带帮并广库应开异强归当录径忆态总战执扩扬抢护报担拦择挂换据数断无旧时昵显暂机权条来栏树样档检汇没洁浅测浏滚满点热状独环现电监盘码确碍离积称稳筛签简类紧级线组细织终结给络绝统继续缓编缩网联脑范营补装观规视览触计订认让议记许设访证识诊试话询该详语误说请读调败账费资转轮软载较辅辑输边过运这进远违连迟适选遥邮采钟钥钮链销错键长闭问闲间阅队阶际险随隐静页顶项顺顿预频题额风馈驻验骤麦标彻]/;
  const converted = toZhTw(source).replace(/简体中文|批准/g, '');
  const leftover = converted.match(simplifiedOnly);
  assert.equal(leftover, null, `Unexpected simplified glyph after toZhTw: ${leftover?.[0]}`);
});

test('Effort Slider mounts star ticks, auto-yields to .ces-slider, renders Orchestrator prism, and remembers effort per model in localStorage', () => {
  const dom = createMockDom();
  const { document, localStorage } = dom;

  const panel = document.createElement('div');
  panel.setAttribute('data-testid', 'model-selector-panel');

  const modelA = document.createElement('button');
  modelA.setAttribute('data-testid', 'model-selector-item');
  modelA.setAttribute('data-model-id', 'gemini-4-carbon');
  modelA.setAttribute('aria-selected', 'true');
  modelA.textContent = 'Gemini 4 Carbon';

  const modelB = document.createElement('button');
  modelB.setAttribute('data-testid', 'model-selector-item');
  modelB.setAttribute('data-model-id', 'claude-sonnet-4');
  modelB.setAttribute('aria-selected', 'false');
  modelB.textContent = 'Claude Sonnet 4';

  const effortLevels = ['Low', 'Medium', 'High', 'XHigh'];
  const effortBtns = {};
  for (const lvl of effortLevels) {
    const b = document.createElement('button');
    b.setAttribute('data-testid', 'model-selector-effort-option');
    b.setAttribute('aria-selected', lvl === 'Medium' ? 'true' : 'false');
    b.textContent = lvl;
    b.addEventListener('click', () => {
      for (const other of Object.values(effortBtns)) other.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-selected', 'true');
    });
    effortBtns[lvl.toLowerCase()] = b;
    panel.appendChild(b);
  }
  panel.appendChild(modelA);
  panel.appendChild(modelB);
  document.body.appendChild(panel);

  const opts = { enabled: true, effortSlider: true, effortMemory: true };
  const wb = dom.createWorkbench({ options: () => opts });

  const slider = panel.querySelector('[data-testid="agy-effort-slider"]');
  assert.ok(slider, 'Effort slider should mount inside model-selector-panel');
  assert.equal(slider.querySelectorAll('.agy-effort-tick').length, 4);

  // Click XHigh star tick -> clicks native button & persists to localStorage
  const xhighTick = slider.querySelector('[data-testid="agy-effort-tick-xhigh"]');
  xhighTick.click();
  assert.equal(effortBtns.xhigh.clickedCount, 1);
  assert.equal(effortBtns.xhigh.getAttribute('aria-selected'), 'true');
  assert.deepEqual(JSON.parse(localStorage.getItem('agy.effortMemory.v1')), { 'gemini-4-carbon': 'xhigh' });

  // Switch to Model B (native defaults to Medium), user chooses Low
  modelA.setAttribute('aria-selected', 'false');
  modelB.setAttribute('aria-selected', 'true');
  effortBtns.xhigh.setAttribute('aria-selected', 'false');
  effortBtns.medium.setAttribute('aria-selected', 'true');
  wb.sync();
  slider.querySelector('[data-testid="agy-effort-tick-low"]').click();
  assert.deepEqual(JSON.parse(localStorage.getItem('agy.effortMemory.v1')), {
    'gemini-4-carbon': 'xhigh',
    'claude-sonnet-4': 'low'
  });

  // Switch back to Model A (native resets to Medium) -> memory auto-restores XHigh!
  modelB.setAttribute('aria-selected', 'false');
  modelA.setAttribute('aria-selected', 'true');
  effortBtns.low.setAttribute('aria-selected', 'false');
  effortBtns.medium.setAttribute('aria-selected', 'true');
  const prevClicks = effortBtns.xhigh.clickedCount;
  wb.sync();
  assert.equal(effortBtns.xhigh.clickedCount, prevClicks + 1);
  assert.equal(effortBtns.xhigh.getAttribute('aria-selected'), 'true');

  // Orchestrator active -> renders faceted prism indicator bar
  const orch = document.createElement('button');
  orch.setAttribute('data-testid', 'model-selector-orchestrator');
  orch.setAttribute('aria-checked', 'true');
  panel.appendChild(orch);
  wb.sync();
  assert.ok(panel.querySelector('[data-testid="agy-effort-prism-bar"]'));
  assert.equal(panel.querySelector('[data-testid="agy-effort-slider"]'), null);

  // External .ces-slider present -> auto-yields!
  const externalCes = document.createElement('div');
  externalCes.className = 'ces-slider';
  panel.appendChild(externalCes);
  wb.sync();
  assert.equal(panel.querySelector('[data-agy-effort-slider="1"]'), null);

  wb.dispose();
});

test('Thought Translator supports expand vs preload trigger, immersive vs bilingual views, file pills, and lossless session title restore', async () => {
  const dom = createMockDom();
  const { document } = dom;

  const calls = [];
  const openEditorCalls = [];
  const opts = {
    enabled: true,
    language: 'zh-CN',
    thoughtTranslate: 'machine',
    thoughtTrigger: 'expand',
    thoughtView: 'bilingual',
    translateSessionTitles: true
  };

  // Build thinking block (collapsed initially)
  const thinkingContainer = document.createElement('div');
  thinkingContainer.setAttribute('data-testid', 'thinking-block');
  const trigger = document.createElement('button');
  trigger.setAttribute('data-testid', 'thinking-collapsible-trigger');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.textContent = 'Thought for 4s';
  const body = document.createElement('div');
  body.setAttribute('data-testid', 'thinking-content');
  const originalTextNode = document.createTextNode('Inspect foo/bar.ts#L12 and /abs/path.py:42 carefully.\n\nThen verify tests.');
  body.appendChild(originalTextNode);
  thinkingContainer.appendChild(trigger);
  thinkingContainer.appendChild(body);
  document.body.appendChild(thinkingContainer);

  // Build sidebar rows (1 English, 1 already Chinese)
  const rowEn = document.createElement('div');
  rowEn.setAttribute('data-testid', 'conversation-row-sidebar');
  const linkEn = document.createElement('a');
  linkEn.setAttribute('href', '/c/c-en');
  linkEn.textContent = 'Refactor login middleware';
  rowEn.appendChild(linkEn);

  const rowZh = document.createElement('div');
  rowZh.setAttribute('data-testid', 'conversation-row-sidebar');
  const linkZh = document.createElement('a');
  linkZh.setAttribute('href', '/c/c-zh');
  linkZh.textContent = '修复登录中间件权限';
  rowZh.appendChild(linkZh);

  document.body.appendChild(rowEn);
  document.body.appendChild(rowZh);

  const wb = dom.createWorkbench({
    options: () => opts,
    state: () => ({ conversationId: 'conv-1', workspaceUri: 'file:///repo' }),
    request: async (method, payload) => {
      calls.push({ method, payload });
      if (method === 'thought.translate') {
        return {
          ok: true,
          translated: '仔细检查 foo/bar.ts#L12 和 /abs/path.py:42 以及 https://example.com/a.ts。\n\n然后验证测试。'
        };
      }
      if (method === 'thought.translateTitles') {
        return { ok: true, translations: { 'c-en': '重构登录中间件' } };
      }
      if (method === 'file.openEditor') {
        openEditorCalls.push(payload);
        return { ok: true };
      }
      return { ok: true };
    }
  });

  await flush();

  // In 'expand' mode while collapsed -> thought.translate MUST NOT fire
  assert.equal(calls.filter(c => c.method === 'thought.translate').length, 0);

  // Session titles: non-CJK translated, CJK skipped
  const titleCall = calls.find(c => c.method === 'thought.translateTitles');
  assert.ok(titleCall);
  assert.deepEqual(JSON.parse(JSON.stringify(titleCall.payload.items)), [{ id: 'c-en', title: 'Refactor login middleware' }]);
  assert.equal(linkEn.textContent, '重构登录中间件');
  assert.equal(linkZh.textContent, '修复登录中间件权限');

  // Switch to 'preload' while still collapsed -> auto pre-translates latest finished block!
  wb.sync({ ...opts, thoughtTrigger: 'preload' });
  await flush();
  assert.equal(calls.filter(c => c.method === 'thought.translate').length, 1);

  // Expand thinking block -> displays bilingual pairs with ZERO mutation to originalTextNode!
  trigger.setAttribute('aria-expanded', 'true');
  wb.sync({ ...opts, thoughtTrigger: 'expand', thoughtView: 'bilingual' });
  await flush();
  assert.equal(originalTextNode.nodeValue, 'Inspect foo/bar.ts#L12 and /abs/path.py:42 carefully.\n\nThen verify tests.');
  const box = thinkingContainer.querySelector('[data-agy-thought-box="1"]');
  assert.ok(box);
  assert.equal(box.getAttribute('translate'), 'no');
  assert.equal(box.getAttribute('data-agy-no-translate'), 'true');
  assert.equal(box.getAttribute('data-view'), 'bilingual');
  assert.equal(box.querySelectorAll('[data-agy-thought-pair="1"]').length, 2);

  // File path pills clickable and invoke file.openEditor with line numbers (ignoring https URL)
  const pills = box.querySelectorAll('[data-testid="agy-thought-file-pill"]');
  assert.equal(pills.length, 2);
  pills[0].click();
  pills[1].click();
  await flush();
  assert.equal(openEditorCalls.length, 2);
  assert.equal(openEditorCalls[0].uri, 'file:///repo/foo/bar.ts');
  assert.equal(openEditorCalls[0].line, 12);
  assert.equal(openEditorCalls[1].uri, 'file:///abs/path.py');
  assert.equal(openEditorCalls[1].line, 42);

  // Switch to 'immersive' view -> renders single translated body + toggle original button
  wb.sync({ ...opts, thoughtTrigger: 'expand', thoughtView: 'immersive' });
  assert.equal(box.getAttribute('data-view'), 'immersive');
  assert.ok(box.querySelector('[data-testid="agy-thought-immersive-body"]'));
  assert.equal(body.getAttribute('data-agy-thought-hidden'), '1');

  // Clicking 译文 / 原文切换 reveals original body
  box.querySelector('[data-testid="agy-thought-view-toggle"]').click();
  assert.equal(body.hasAttribute('data-agy-thought-hidden'), false);

  // Disabling translateSessionTitles restores 100% of original titles losslessly
  wb.sync({ ...opts, translateSessionTitles: false });
  assert.equal(linkEn.textContent, 'Refactor login middleware');

  // Re-enable titles and verify thoughtTranslate: 'off' removes all overlays (0 B) and restores titles
  wb.sync({ ...opts, translateSessionTitles: true });
  assert.equal(linkEn.textContent, '重构登录中间件');
  wb.sync({ ...opts, thoughtTranslate: 'off' });
  assert.equal(document.querySelectorAll('[data-agy-thought-box="1"]').length, 0);
  assert.equal(linkEn.textContent, 'Refactor login middleware');

  // Re-enable and verify dispose() restores original titles too
  wb.sync({ ...opts, thoughtTranslate: 'machine', translateSessionTitles: true });
  assert.equal(linkEn.textContent, '重构登录中间件');
  wb.dispose();
  assert.equal(linkEn.textContent, 'Refactor login middleware');
});

test('Code Block >= 48 lines folds/expands manually with scrollTop anchor compensation, and Inline Step Diff expands hunks', async () => {
  const dom = createMockDom();
  const { document } = dom;

  const viewport = document.createElement('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  viewport.scrollTop = 1000;
  viewport._rectFn = () => ({ top: 0, bottom: 800, left: 0, right: 800, height: 800, width: 800 });

  const convView = document.createElement('div');
  convView.setAttribute('data-testid', 'conversation-view');

  // Short code block (47 lines) -> should NOT get fold button
  const shortWrap = document.createElement('div');
  const shortHeader = document.createElement('div');
  shortHeader.setAttribute('data-testid', 'code-block-header');
  const shortPre = document.createElement('pre');
  shortPre.textContent = Array.from({ length: 47 }, (_, i) => `const a${i} = ${i};`).join('\n');
  shortWrap.appendChild(shortHeader);
  shortWrap.appendChild(shortPre);

  // Long code block (52 lines) -> SHOULD get fold button, never auto-folded
  const longWrap = document.createElement('div');
  const longHeader = document.createElement('div');
  longHeader.setAttribute('data-testid', 'code-block-header');
  const longPre = document.createElement('pre');
  longPre.textContent = Array.from({ length: 52 }, (_, i) => `line ${i + 1}`).join('\n');
  // Simulate block scrolled 400px past viewport top with height shrinking 1200 -> 112 on fold
  longPre._rectFn = node => {
    const folded = node.getAttribute('data-agy-code-folded') === '1';
    return { top: -400, bottom: folded ? -288 : 800, left: 0, right: 700, height: folded ? 112 : 1200, width: 700 };
  };
  longWrap.appendChild(longHeader);
  longWrap.appendChild(longPre);

  // File change row for inlineStepDiff
  const diffRow = document.createElement('div');
  diffRow.setAttribute('data-testid', 'file-change-row');
  diffRow.setAttribute('data-path', 'src/app.mjs');
  const diffChip = document.createElement('span');
  diffChip.setAttribute('data-testid', 'diff-line-count');
  diffChip.textContent = '+3 -1';
  diffRow.appendChild(diffChip);

  convView.appendChild(shortWrap);
  convView.appendChild(longWrap);
  convView.appendChild(diffRow);
  viewport.appendChild(convView);
  document.body.appendChild(viewport);

  const rpcCalls = [];
  const wb = dom.createWorkbench({
    options: () => ({ enabled: true, codeBlockFold: true, inlineStepDiff: true }),
    state: () => ({ conversationId: 'conv-1', workspaceUri: 'file:///ws' }),
    request: async (method, payload) => {
      rpcCalls.push({ method, payload });
      if (method === 'diff.inline') {
        return {
          ok: true,
          binary: false,
          untracked: false,
          truncated: false,
          lines: [
            { kind: 'hunk', text: '@@ -1,2 +1,3 @@' },
            { kind: 'del', text: '-old()' },
            { kind: 'add', text: '+new()' }
          ]
        };
      }
      return { ok: true };
    }
  });

  // Sticky header applied to both; fold button ONLY on >= 48 lines
  assert.equal(shortHeader.classList.contains('agy-code-sticky-header'), true);
  assert.equal(shortHeader.querySelector('[data-testid="agy-code-fold-btn"]'), null);

  assert.equal(longHeader.classList.contains('agy-code-sticky-header'), true);
  const foldBtn = longHeader.querySelector('[data-testid="agy-code-fold-btn"]');
  assert.ok(foldBtn);
  assert.equal(longPre.hasAttribute('data-agy-code-folded'), false, 'Never auto-fold');
  assert.ok(foldBtn.textContent.includes('52'));

  // Fold while scrolled past top (-400px) -> viewport.scrollTop compensated by 400 (1000 -> 600)!
  foldBtn.click();
  assert.equal(longPre.getAttribute('data-agy-code-folded'), '1');
  assert.equal(viewport.scrollTop, 600);
  assert.ok(foldBtn.textContent.includes('展开'));

  // Expand back
  foldBtn.click();
  assert.equal(longPre.hasAttribute('data-agy-code-folded'), false);
  assert.ok(foldBtn.textContent.includes('折叠'));

  // Inline Step Diff toggle
  const diffToggle = diffRow.querySelector('[data-testid="agy-inline-diff-toggle"]');
  assert.ok(diffToggle);
  diffToggle.click();
  await flush();

  const drawer = convView.querySelector('[data-testid="agy-inline-diff-drawer"]');
  assert.ok(drawer);
  assert.equal(drawer.querySelectorAll('.agy-git-diff-line').length, 3);
  assert.equal(rpcCalls[0].method, 'diff.inline');
  assert.equal(rpcCalls[0].payload.path, 'src/app.mjs');

  // Open in editor button inside diff drawer
  drawer.querySelector('[data-testid="agy-inline-diff-open-editor"]').click();
  await flush();
  assert.equal(rpcCalls[1].method, 'file.openEditor');
  assert.equal(rpcCalls[1].payload.uri, 'file:///ws/src/app.mjs');

  wb.dispose();
  assert.equal(longHeader.querySelector('[data-testid="agy-code-fold-btn"]'), null);
  assert.equal(convView.querySelector('[data-testid="agy-inline-diff-drawer"]'), null);
});

test('Conversation Rail Hover Outline shows prompts/chapters/filter/collapse-steps and Alt+Up/Down ignores editable inputs', () => {
  const dom = createMockDom();
  const { document } = dom;

  const rail = document.createElement('nav');
  rail.setAttribute('data-testid', 'agy-turn-outline');
  document.body.appendChild(rail);

  const turns = Array.from({ length: 7 }, (_, i) => ({
    turnNumber: i + 1,
    stepIndexStart: i * 10,
    promptTitle: i === 2 ? 'Fix authentication bug' : `Prompt number ${i + 1}`
  }));

  // Expanded tool-group collapsibles for [收起步骤]
  const worked1 = document.createElement('button');
  worked1.setAttribute('data-testid', 'worked-for-collapsible');
  worked1.setAttribute('aria-expanded', 'true');
  const worked2 = document.createElement('button');
  worked2.setAttribute('data-testid', 'tool-group-collapsible');
  worked2.setAttribute('aria-expanded', 'true');
  document.body.appendChild(worked1);
  document.body.appendChild(worked2);

  // Editable elements to verify Alt+ArrowUp/Down guard
  const input = document.createElement('input');
  const monacoWrap = document.createElement('div');
  monacoWrap.className = 'monaco-editor';
  const monacoInner = document.createElement('div');
  monacoWrap.appendChild(monacoInner);
  const editableDiv = document.createElement('div');
  editableDiv.setAttribute('contenteditable', 'true');
  document.body.appendChild(input);
  document.body.appendChild(monacoWrap);
  document.body.appendChild(editableDiv);

  const jumped = [];
  const wb = dom.createWorkbench({
    options: () => ({ enabled: true, railHoverOutline: true }),
    state: () => ({ conversationId: 'conv-1', turns }),
    adapter: {
      navigateTurn: turn => { jumped.push(turn.turnNumber); return true; }
    }
  });

  // Hover rail -> popover appears with 7 prompts & 2 chapter markers (1-5, 6-7)
  rail.dispatchEvent({ type: 'mouseenter', bubbles: false });
  const pop = document.querySelector('[data-testid="agy-rail-popover"]');
  assert.ok(pop);
  assert.equal(pop.querySelectorAll('.agy-rail-item').length, 7);
  assert.equal(pop.querySelectorAll('[data-agy-chapter-marker="1"]').length, 2);

  // Instant keyword filter
  const filter = pop.querySelector('[data-testid="agy-rail-filter"]');
  filter.value = 'authentication';
  filter.dispatchEvent({ type: 'input', bubbles: true });
  assert.equal(pop.querySelectorAll('.agy-rail-item').length, 1);

  // Collapse historical steps
  pop.querySelector('[data-testid="agy-rail-collapse-steps"]').click();
  assert.equal(worked1.clickedCount, 1);
  assert.equal(worked2.clickedCount, 1);

  // Alt+ArrowUp / Alt+ArrowDown when NOT in editable input
  document.activeElement = document.body;
  const evUp = { type: 'keydown', key: 'ArrowUp', altKey: true, target: document.body };
  document.dispatchEvent(evUp);
  assert.equal(evUp.defaultPrevented, true);
  assert.equal(jumped.at(-1), 6); // From last (7) -> 6

  const evDown = { type: 'keydown', key: 'ArrowDown', altKey: true, target: document.body };
  document.dispatchEvent(evDown);
  assert.equal(evDown.defaultPrevented, true);
  assert.equal(jumped.at(-1), 7);

  // Ignored inside <input>, [contenteditable="true"], and .monaco-editor
  const countBefore = jumped.length;
  const evInInput = { type: 'keydown', key: 'ArrowUp', altKey: true, target: input };
  document.dispatchEvent(evInInput);
  assert.equal(evInInput.defaultPrevented, false);

  const evInEditable = { type: 'keydown', key: 'ArrowUp', altKey: true, target: editableDiv };
  document.dispatchEvent(evInEditable);
  assert.equal(evInEditable.defaultPrevented, false);

  const evInMonaco = { type: 'keydown', key: 'ArrowUp', altKey: true, target: monacoInner };
  document.dispatchEvent(evInMonaco);
  assert.equal(evInMonaco.defaultPrevented, false);
  assert.equal(jumped.length, countBefore);

  wb.dispose();
});

test('Quick Context Menu respects Shift+Right-Click & file:// exclusion, delegates /side, guards unsent draft, highlights bare links, and opens Omni Viewer modes', async () => {
  const dom = createMockDom();
  const { document, highlightsMap, openedUrls } = dom;

  const convView = document.createElement('div');
  convView.setAttribute('data-testid', 'conversation-view');
  const response = document.createElement('div');
  response.setAttribute('data-testid', 'agent-response');
  const prose = document.createElement('p');
  const bareText = document.createTextNode('Preview https://example.com/docs and localhost:5173/app and /tmp/demo.mp4 here.');
  prose.appendChild(bareText);

  const fileLink = document.createElement('a');
  fileLink.setAttribute('href', 'file:///repo/README.md');
  fileLink.textContent = 'README.md';

  const composerCard = document.createElement('div');
  composerCard.className = 'surface-composer-card';
  const composerInput = document.createElement('div');
  composerInput.setAttribute('contenteditable', 'true');
  composerCard.appendChild(composerInput);

  response.appendChild(prose);
  response.appendChild(fileLink);
  convView.appendChild(response);
  convView.appendChild(composerCard);
  document.body.appendChild(convView);

  const sideChatCalls = [];
  const notifications = [];
  const rpcCalls = [];
  let composerDraft = '';

  const wb = dom.createWorkbench({
    options: () => ({ enabled: true, quickContextMenu: true, omniViewer: true, linkTarget: 'builtin' }),
    state: () => ({ conversationId: 'conv-42' }),
    adapter: {
      getComposerText: () => composerDraft,
      setComposerText: (_card, val) => { composerDraft = val; return true; }
    },
    triggerSideChat: (card, cid, q) => { sideChatCalls.push({ card, cid, q }); return true; },
    notify: n => notifications.push(n),
    request: async (method, payload) => {
      rpcCalls.push({ method, payload });
      if (method === 'omni.open') {
        const u = String(payload.uriOrPath || '');
        if (u.endsWith('.mp4')) return { ok: true, kind: 'video', url: 'http://127.0.0.1:9999/stream/v?token=t', name: 'demo.mp4', path: u };
        if (u.endsWith('.csv')) return { ok: true, kind: 'table', url: 'http://127.0.0.1:9999/stream/c?token=t', name: 'data.csv', path: u };
        if (u.endsWith('.woff2')) return { ok: true, kind: 'font', url: 'http://127.0.0.1:9999/stream/f?token=t', name: 'JetBrains.woff2', path: u };
        if (u.endsWith('.png')) return { ok: true, kind: 'image', url: 'http://127.0.0.1:9999/stream/i?token=t', name: 'shot.png', path: u };
        if (u.endsWith('.mp3')) return { ok: true, kind: 'audio', url: 'http://127.0.0.1:9999/stream/a?token=t', name: 'clip.mp3', path: u };
        if (u.endsWith('.pdf')) return { ok: true, kind: 'pdf', url: 'http://127.0.0.1:9999/stream/p?token=t', name: 'spec.pdf', path: u };
      }
      if (method === 'omni.tableSlice') {
        return {
          ok: true,
          format: 'csv',
          headers: ['name', 'score'],
          rows: payload.query ? [['Alice', '99']] : [['Alice', '99'], ['Bob', '85']],
          totalMatched: payload.query ? 1 : 2,
          truncated: false
        };
      }
      return { ok: true };
    }
  });

  // Bare URL / path highlighting via CSS.highlights without splitting text node!
  assert.equal(prose.childNodes.length, 1, 'Must not split React text nodes');
  const hl = highlightsMap.get('agy-omni-link');
  assert.ok(hl && hl.ranges.length === 3, 'Should highlight https URL, localhost:5173, and /tmp/demo.mp4');

  // canOmniPreview checks
  assert.equal(wb.canOmniPreview('file:///tmp/demo.mp4'), true);
  assert.equal(wb.canOmniPreview('/tmp/data.csv'), true);
  assert.equal(wb.canOmniPreview('/tmp/JetBrains.woff2'), true);
  assert.equal(wb.canOmniPreview('/Users/a/.ssh/id_rsa'), false);
  assert.equal(wb.canOmniPreview('/repo/.env'), false);
  assert.equal(wb.canOmniPreview('/repo/dir/'), false);

  // Shift+Right-Click passes through natively
  const shiftEv = { type: 'contextmenu', bubbles: true, shiftKey: true, clientX: 50, clientY: 60 };
  prose.dispatchEvent(shiftEv);
  assert.equal(shiftEv.defaultPrevented, false);
  assert.equal(document.querySelector('[data-testid="agy-quick-context-menu"]'), null);

  // Right-click on file:// link passes through to Powertools FileContextMenu
  const fileEv = { type: 'contextmenu', bubbles: true, shiftKey: false, clientX: 50, clientY: 60 };
  fileLink.dispatchEvent(fileEv);
  assert.equal(fileEv.defaultPrevented, false);
  assert.equal(document.querySelector('[data-testid="agy-quick-context-menu"]'), null);

  // Right-click on conversation prose opens Quick Menu with all 6 actions
  dom.setSelectedText('explain this architecture');
  const prosePlain = document.createElement('div');
  prosePlain.textContent = 'Normal prose without URLs';
  response.appendChild(prosePlain);
  const ctxEv = { type: 'contextmenu', bubbles: true, shiftKey: false, clientX: 400, clientY: 300 };
  prosePlain.dispatchEvent(ctxEv);
  assert.equal(ctxEv.defaultPrevented, true);
  const qmenu = document.querySelector('[data-testid="agy-quick-context-menu"]');
  assert.ok(qmenu);
  for (const tid of ['agy-qmenu-copy', 'agy-qmenu-side', 'agy-qmenu-plan', 'agy-qmenu-compact', 'agy-qmenu-learn', 'agy-qmenu-grill']) {
    assert.ok(qmenu.querySelector(`[data-testid="${tid}"]`), `Missing quick menu item ${tid}`);
  }

  // Click /side -> calls env.triggerSideChat directly
  qmenu.querySelector('[data-testid="agy-qmenu-side"]').click();
  assert.equal(sideChatCalls.length, 1);
  assert.equal(sideChatCalls[0].cid, 'conv-42');
  assert.equal(sideChatCalls[0].q, 'explain this architecture');

  // Draft-busy guard: composer has unsent draft -> /plan does NOT overwrite and triggers env.notify
  composerDraft = 'unsent important draft';
  prosePlain.dispatchEvent({ type: 'contextmenu', bubbles: true, shiftKey: false, clientX: 400, clientY: 300 });
  document.querySelector('[data-testid="agy-qmenu-plan"]').click();
  assert.equal(composerDraft, 'unsent important draft');
  assert.ok(notifications.some(n => n.tag === 'agy-quick-menu-draft-busy'));

  // Empty composer -> /plan writes cleanly
  composerDraft = '';
  prosePlain.dispatchEvent({ type: 'contextmenu', bubbles: true, shiftKey: false, clientX: 400, clientY: 300 });
  document.querySelector('[data-testid="agy-qmenu-plan"]').click();
  assert.equal(composerDraft, '/plan explain this architecture');

  // Cmd+Click on bare URL inverts linkTarget ('builtin' -> 'external')
  prose.dispatchEvent({ type: 'click', bubbles: true, clientX: 50, clientY: 20, metaKey: true });
  assert.equal(openedUrls.length, 1);
  assert.equal(openedUrls[0].url, 'https://example.com/docs');

  // Omni Viewer: VIDEO mode (frame-step & playback speed)
  const vRes = await wb.openOmniViewer('/tmp/demo.mp4');
  assert.equal(vRes.ok, true);
  assert.equal(vRes.kind, 'video');
  const video = document.querySelector('[data-testid="agy-omni-video"]');
  assert.ok(video);
  video.currentTime = 1;
  document.querySelector('[data-testid="agy-omni-frame-next"]').click();
  assert.ok(video.currentTime > 1);
  document.querySelector('[data-testid="agy-omni-speed-2"]').click();
  assert.equal(video.playbackRate, 2);

  // Omni Viewer: TABLE mode (frozen header + search calling omni.tableSlice)
  const tRes = await wb.openOmniViewer('/tmp/data.csv');
  assert.equal(tRes.kind, 'table');
  const table = document.querySelector('[data-testid="agy-omni-table"]');
  assert.equal(table.querySelectorAll('tbody tr').length, 2);
  const search = document.querySelector('[data-testid="agy-omni-table-search"]');
  search.value = 'Alice';
  search.dispatchEvent({ type: 'input', bubbles: true });
  await flush();
  assert.equal(table.querySelectorAll('tbody tr').length, 1);

  // Omni Viewer: FONT mode (dynamic @font-face + specimen waterfall)
  const fRes = await wb.openOmniViewer('/tmp/JetBrains.woff2');
  assert.equal(fRes.kind, 'font');
  const fontStyle = document.head.querySelector('[data-agy-omni-font="1"]');
  assert.ok(fontStyle && fontStyle.textContent.includes('@font-face'));
  const waterfall = document.querySelector('[data-testid="agy-omni-font-waterfall"]');
  assert.equal(waterfall.querySelectorAll('.agy-omni-font-row').length, 6);

  // Omni Viewer: IMAGE mode (checkerboard zoom + export PNG)
  const iRes = await wb.openOmniViewer('/tmp/shot.png');
  assert.equal(iRes.kind, 'image');
  assert.equal(document.head.querySelector('[data-agy-omni-font="1"]'), null, 'Previous font style cleaned up');
  document.querySelector('[data-testid="agy-omni-zoom-in"]').click();
  assert.equal(document.querySelector('[data-testid="agy-omni-zoom-label"]').textContent, '125%');
  assert.ok(document.querySelector('[data-testid="agy-omni-export-png"]'));

  // Omni Viewer: PDF sandboxed iframe
  const pRes = await wb.openOmniViewer('/tmp/spec.pdf');
  assert.equal(pRes.kind, 'pdf');
  const iframe = document.querySelector('[data-testid="agy-omni-iframe"]');
  assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts');

  wb.dispose();
  assert.equal(document.querySelector('[data-testid="agy-omni-viewer-drawer"]'), null);
  assert.equal(highlightsMap.has('agy-omni-link'), false);
});

test('picked media opens without an RPC call and revokes its URL on close', async () => {
  const { File } = await import('node:buffer');
  const { context, document, createWorkbench } = createMockDom();
  const released = [];
  context.File = File;
  context.URL = {
    createObjectURL: file => `blob:fixture/${file.name}`,
    revokeObjectURL: url => released.push(url)
  };
  const wb = createWorkbench({
    options: () => ({ enabled: true, omniViewer: false, language: 'en' }),
    request: () => { throw new Error('picked media must not use RPC'); }
  });
  try {
    await assert.rejects(wb.openPickedMedia('file:///example.png'), /Choose a file/);
    await assert.rejects(wb.openPickedMedia(new File(['<html/>'], 'test.html', { type: 'text/html' })), /not available/);
    const result = await wb.openPickedMedia(new File(['fixture'], 'picture.png', { type: 'image/png' }));
    assert.equal(result.kind, 'image');
    assert.ok(document.querySelector('[data-testid="agy-omni-viewer-drawer"]'));
    document.querySelector('[data-testid="agy-omni-close"]').click();
    assert.deepEqual(released, ['blob:fixture/picture.png']);
  } finally {
    wb.dispose();
  }
});

test('Home Studio mounts 3 tabs with zero polling and unmounts cleanly; Chat Mode Beta organizes & filters folders', async () => {
  const dom = createMockDom();
  const { document } = dom;

  // Home view DOM
  const homeRoot = document.createElement('div');
  const greeting = document.createElement('div');
  greeting.setAttribute('data-testid', 'home-greeting');
  const composer = document.createElement('div');
  composer.setAttribute('data-testid', 'agent-input-box');
  homeRoot.appendChild(greeting);
  homeRoot.appendChild(composer);
  document.body.appendChild(homeRoot);

  // Sidebar DOM with 2 conversations
  const sidebar = document.createElement('aside');
  sidebar.setAttribute('role', 'navigation');
  sidebar.setAttribute('aria-label', 'Sidebar');
  const row1 = document.createElement('div');
  row1.setAttribute('data-testid', 'conversation-row-sidebar');
  const a1 = document.createElement('a');
  a1.setAttribute('href', '/c/chat-1');
  a1.textContent = 'Trip planning';
  row1.appendChild(a1);

  const row2 = document.createElement('div');
  row2.setAttribute('data-testid', 'conversation-row-sidebar');
  const a2 = document.createElement('a');
  a2.setAttribute('href', '/c/chat-2');
  a2.textContent = 'Cooking recipes';
  row2.appendChild(a2);

  sidebar.appendChild(row1);
  sidebar.appendChild(row2);
  document.body.appendChild(sidebar);

  const rpcCalls = [];
  const wb = dom.createWorkbench({
    options: () => ({ enabled: true, homeStudio: true, chatModeBeta: true }),
    dashboard: () => ({
      requests: [
        { timestampMs: Date.now(), inputTokens: 1200, cacheReadTokens: 800, outputTokens: 400, costUsd: 0.05, status: 'success' }
      ]
    }),
    account: () => ({
      groups: [
        { displayName: 'Gemini', buckets: [{ bucketId: 'gemini_5h', window: '5h', remainingFraction: 0.82 }] }
      ]
    }),
    request: async (method, payload) => {
      rpcCalls.push({ method, payload });
      if (method === 'chatFolders.get') {
        return {
          ok: true,
          folders: [{ id: 'travel', name: '旅行' }],
          assignments: { 'chat-1': 'travel' }
        };
      }
      return { ok: true };
    }
  });

  // Home Studio mounted with ZERO extra backend polling
  assert.equal(rpcCalls.length, 0, 'Home Studio must not poll backend');
  const studio = document.querySelector('[data-testid="agy-home-studio"]');
  assert.ok(studio);
  assert.ok(studio.querySelector('[data-testid="agy-studio-overview"]'));

  // Switch tabs: 趋势 & 模型额度
  studio.querySelector('[data-testid="agy-studio-tab-trend"]').click();
  assert.ok(studio.querySelector('[data-testid="agy-studio-trend-bars"]'));
  studio.querySelector('[data-testid="agy-studio-tab-quota"]').click();
  const quotaList = studio.querySelector('[data-testid="agy-studio-quota-list"]');
  assert.ok(quotaList && quotaList.textContent.includes('82%'));

  // Leaving Home view unmounts Home Studio cleanly
  greeting.remove();
  wb.sync();
  assert.equal(document.querySelector('[data-testid="agy-home-studio"]'), null);

  // Chat Mode Beta toggle mounted at top of sidebar
  const chatBtn = sidebar.querySelector('[data-testid="agy-mode-chat"]');
  assert.ok(chatBtn);
  chatBtn.click();
  await flush();
  assert.equal(rpcCalls.some(c => c.method === 'chatFolders.get'), true);

  // Filter by 'travel' folder -> chat-1 visible, chat-2 hidden
  sidebar.querySelector('[data-testid="agy-chat-folder-travel"]').click();
  assert.equal(row1.hasAttribute('data-agy-chat-hidden'), false);
  assert.equal(row2.getAttribute('data-agy-chat-hidden'), '1');

  // Create new folder -> persists via chatFolders.save
  const folderInput = sidebar.querySelector('[data-testid="agy-chat-folder-input"]');
  folderInput.value = '美食';
  sidebar.querySelector('[data-testid="agy-chat-folder-create"]').click();
  const saveCall = rpcCalls.find(c => c.method === 'chatFolders.save');
  assert.ok(saveCall);
  assert.equal(saveCall.payload.folders.some(f => f.name === '美食'), true);

  // Switching back to Code restores ALL rows cleanly
  sidebar.querySelector('[data-testid="agy-mode-code"]').click();
  assert.equal(row1.hasAttribute('data-agy-chat-hidden'), false);
  assert.equal(row2.hasAttribute('data-agy-chat-hidden'), false);

  wb.dispose();
  assert.equal(sidebar.querySelector('[data-testid="agy-chat-mode-wrap"]'), null);
});

test('Edge cases: Effort drag/keyboard, Thought retranslate, Binary Inline Diff, Mermaid/Audio/Pagination Omni, Chat DnD & zh-TW', async () => {
  const dom = createMockDom();
  const { document, localStorage } = dom;

  // 1. Effort slider drag & keyboard + direct native button click
  const panel = document.createElement('div');
  panel.setAttribute('data-testid', 'model-selector-panel');
  const mItem = document.createElement('button');
  mItem.setAttribute('data-testid', 'model-selector-item');
  mItem.setAttribute('data-model-id', 'gpt-astra');
  mItem.setAttribute('aria-selected', 'true');
  mItem.textContent = 'GPT Astra';
  panel.appendChild(mItem);
  const eBtns = {};
  for (const name of ['Low', 'Medium', 'High', 'XHigh']) {
    const b = document.createElement('button');
    b.setAttribute('data-testid', 'model-selector-effort-option');
    b.setAttribute('aria-selected', name === 'Low' ? 'true' : 'false');
    b.textContent = name;
    b.addEventListener('click', () => {
      for (const o of Object.values(eBtns)) o.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-selected', 'true');
    });
    eBtns[name.toLowerCase()] = b;
    panel.appendChild(b);
  }
  document.body.appendChild(panel);

  // 2. Binary diff row + Mermaid SVG + Sidebar row for exclusion + Chat DnD
  const convView = document.createElement('div');
  convView.setAttribute('data-testid', 'conversation-view');
  const binRow = document.createElement('div');
  binRow.setAttribute('data-testid', 'file-change-row');
  binRow.setAttribute('data-path', 'assets/logo.png');
  const mermaidWrap = document.createElement('div');
  mermaidWrap.className = 'mermaid';
  const svg = document.createElement('svg');
  svg.id = 'mermaid-1';
  mermaidWrap.appendChild(svg);
  convView.appendChild(binRow);
  convView.appendChild(mermaidWrap);
  document.body.appendChild(convView);

  const sidebar = document.createElement('aside');
  sidebar.setAttribute('role', 'navigation');
  sidebar.setAttribute('aria-label', 'Sidebar');
  const sRow = document.createElement('div');
  sRow.className = 'agy-sidebar-row';
  const sLink = document.createElement('a');
  sLink.setAttribute('href', '/c/dnd-conv');
  sLink.textContent = 'Drag me';
  sRow.appendChild(sLink);
  sidebar.appendChild(sRow);
  document.body.appendChild(sidebar);

  // 3. Thinking block for retranslate force:true
  const tWrap = document.createElement('div');
  tWrap.setAttribute('data-testid', 'thinking-block');
  const tTrig = document.createElement('button');
  tTrig.setAttribute('data-testid', 'thinking-collapsible-trigger');
  tTrig.setAttribute('aria-expanded', 'true');
  tTrig.textContent = 'Thought for 2s';
  const tBody = document.createElement('div');
  tBody.setAttribute('data-testid', 'thinking-content');
  tBody.textContent = 'Analyze binary diff';
  tWrap.appendChild(tTrig);
  tWrap.appendChild(tBody);
  document.body.appendChild(tWrap);

  const rpcCalls = [];
  const wb = dom.createWorkbench({
    options: () => ({
      enabled: true,
      language: 'zh-TW',
      effortSlider: true,
      effortMemory: true,
      thoughtTranslate: 'machine',
      thoughtTrigger: 'expand',
      thoughtView: 'immersive',
      inlineStepDiff: true,
      quickContextMenu: true,
      omniViewer: true,
      chatModeBeta: true
    }),
    state: () => ({ conversationId: 'conv-edge', workspaceUri: 'file:///ws' }),
    request: async (method, payload) => {
      rpcCalls.push({ method, payload });
      if (method === 'thought.translate') return { ok: true, translated: payload.force ? '重新分析二進位差異' : '分析二進位差異' };
      if (method === 'diff.inline') return { ok: true, binary: true, untracked: true, truncated: false, lines: [] };
      if (method === 'omni.open') {
        if (String(payload.uriOrPath).endsWith('.mp3')) return { ok: true, kind: 'audio', url: 'http://127.0.0.1:9999/stream/a?token=t', name: 'voice.mp3' };
        return { ok: true, kind: 'table', url: 'http://127.0.0.1:9999/stream/t?token=t', name: 'big.csv', path: '/tmp/big.csv' };
      }
      if (method === 'omni.tableSlice') {
        return {
          ok: true,
          format: 'csv',
          headers: ['id'],
          rows: [[String(payload.offset + 1)]],
          totalMatched: 150,
          truncated: false
        };
      }
      if (method === 'chatFolders.get') {
        return { ok: true, folders: [{ id: 'work', name: '工作' }], assignments: {} };
      }
      return { ok: true };
    }
  });

  await flush();

  // Slider keyboard ArrowRight moves Low -> Medium and persists
  const track = panel.querySelector('[role="slider"]');
  track.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true });
  assert.equal(eBtns.medium.getAttribute('aria-selected'), 'true');
  assert.equal(JSON.parse(localStorage.getItem('agy.effortMemory.v1'))['gpt-astra'], 'medium');

  // Slider pointer drag to far right selects XHigh
  track._rectFn = () => ({ left: 0, width: 300, top: 0, height: 30 });
  track.dispatchEvent({ type: 'pointerdown', clientX: 295, pointerId: 1, bubbles: true });
  track.dispatchEvent({ type: 'pointerup', clientX: 295, pointerId: 1, bubbles: true });
  assert.equal(eBtns.xhigh.getAttribute('aria-selected'), 'true');

  // Direct native click on High updates localStorage
  eBtns.high.click();
  assert.equal(JSON.parse(localStorage.getItem('agy.effortMemory.v1'))['gpt-astra'], 'high');

  // Thought retranslate sends force: true and zh-TW renders Traditional labels
  const retryBtn = tWrap.querySelector('[data-testid="agy-thought-retry"]');
  assert.ok(retryBtn);
  retryBtn.click();
  await flush();
  assert.equal(rpcCalls.some(c => c.method === 'thought.translate' && c.payload.force === true), true);

  // Binary + untracked inline diff notice
  binRow.querySelector('[data-testid="agy-inline-diff-toggle"]').click();
  await flush();
  assert.ok(convView.querySelector('[data-testid="agy-inline-diff-binary"]'));

  // Sidebar row contextmenu MUST NOT be intercepted
  const sideCtx = { type: 'contextmenu', bubbles: true, shiftKey: false, clientX: 10, clientY: 10 };
  sLink.dispatchEvent(sideCtx);
  assert.equal(sideCtx.defaultPrevented, false);

  // Mermaid SVG contextmenu opens zoom/export actions and zooms into Omni SVG viewer
  const mCtx = { type: 'contextmenu', bubbles: true, shiftKey: false, clientX: 100, clientY: 100 };
  svg.dispatchEvent(mCtx);
  assert.equal(mCtx.defaultPrevented, true);
  document.querySelector('[data-testid="agy-qmenu-mermaid-zoom"]').click();
  await flush();
  assert.equal(document.querySelector('[data-testid="agy-omni-viewer-drawer"]')?.getAttribute('data-omni-kind'), 'svg');

  // Omni Audio waveform click-to-seek
  await wb.openOmniViewer('/tmp/voice.mp3');
  const audio = document.querySelector('[data-testid="agy-omni-audio"]');
  const waveform = document.querySelector('[data-testid="agy-omni-waveform"]');
  waveform._rectFn = () => ({ left: 0, width: 400, top: 0, height: 84 });
  waveform.dispatchEvent({ type: 'click', clientX: 200, bubbles: true });
  assert.equal(audio.currentTime, 60); // 50% of 120s duration

  // Omni Table pagination (offset 0 -> 100 -> 0)
  await wb.openOmniViewer('/tmp/big.csv');
  document.querySelector('[data-testid="agy-omni-table-next"]').click();
  await flush();
  assert.equal(rpcCalls.some(c => c.method === 'omni.tableSlice' && c.payload.offset === 100), true);

  // Chat Mode drag-and-drop conversation onto folder chip & folder delete
  sidebar.querySelector('[data-testid="agy-mode-chat"]').click();
  await flush();
  const transfer = new Map();
  sRow.dispatchEvent({
    type: 'dragstart',
    bubbles: true,
    dataTransfer: { setData: (k, v) => transfer.set(k, v) }
  });
  const workChip = sidebar.querySelector('[data-testid="agy-chat-folder-work"]');
  workChip.dispatchEvent({
    type: 'drop',
    bubbles: true,
    dataTransfer: { getData: k => transfer.get(k) || '' }
  });
  const dndSave = [...rpcCalls].reverse().find(c => c.method === 'chatFolders.save');
  assert.equal(dndSave?.payload?.assignments?.['dnd-conv'], 'work');

  // Delete folder clears its assignment
  sidebar.querySelector('[data-testid="agy-chat-folder-delete-work"]').click();
  const delSave = [...rpcCalls].reverse().find(c => c.method === 'chatFolders.save');
  assert.equal(delSave?.payload?.folders?.length, 0);
  assert.equal(delSave?.payload?.assignments?.['dnd-conv'], undefined);

  wb.dispose();
});
