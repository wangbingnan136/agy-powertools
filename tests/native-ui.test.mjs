import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');

function page(ready = false) {
  const callbacks = new Map();
  const nodes = [];
  const node = () => ({
    dataset: {}, isConnected: false,
    append(child) { child.isConnected = true; },
    setAttribute() {}, addEventListener() {}, remove() { this.isConnected = false; }
  });
  const attrs = new Set();
  const document = {
    readyState: ready ? 'complete' : 'loading',
    head: ready ? node() : null, body: ready ? node() : null,
    documentElement: { toggleAttribute(name, force) { if (force === undefined ? !attrs.has(name) : force) attrs.add(name); else attrs.delete(name); }, removeAttribute(name) { attrs.delete(name); }, hasAttribute(name) { return attrs.has(name); } },
    createElement() { const element = node(); nodes.push(element); return element; },
    addEventListener(event, callback) { if (!callbacks.has(event)) callbacks.set(event, []); callbacks.get(event).push(callback); },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const context = vm.createContext({
    document, location: { pathname: '/' }, AbortController,
    React: { createElement() { return {}; } }, ReactDOM: { createRoot() { throw new Error('No DOM roots expected'); } }, HC() {},
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  return { context, document, nodes, callbacks, node };
}

test('SSH command paste observes setting changes without reinstalling its listener', async () => {
  const p = page(true);
  const settings = { enabled: true, sshCommandPaste: true };
  p.context.__agyInitialSettings = settings;
  let change, enabled, installs = 0;
  p.context.__agyPanels = env => { change = env.change; };
  p.context.installSshCommandPaste = (_document, options) => { enabled = options.enabled; installs++; };
  p.context.__agyPowertoolsHost = raw => {
    const { id, method, settings: patch } = JSON.parse(raw);
    if (method === 'settings.set') Object.assign(settings, patch);
    queueMicrotask(() => p.context.__agyPowertoolsReceive?.(id, { ...settings }));
  };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enabled(), true);
  await change({ sshCommandPaste: false });
  assert.equal(enabled(), false);
  await change({ sshCommandPaste: true });
  assert.equal(enabled(), true);
  assert.equal(installs, 1);
  p.context.__agyPowertools.dispose();
});

test('new-document injection waits for head and body and initializes exactly once', () => {
  const p = page();
  vm.runInContext(source, p.context);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 0);
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.callbacks.get('DOMContentLoaded').length, 1);
  p.document.head = p.node(); p.document.body = p.node();
  p.callbacks.get('DOMContentLoaded')[0]();
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.context.__agyPowertoolsPending, undefined);
  assert.equal(p.nodes.length, 1);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 1);
});

test('already-loaded injection initializes without waiting and disposes cleanly', () => {
  const p = page(true);
  vm.runInContext(source, p.context);
  assert.equal(p.callbacks.has('DOMContentLoaded'), false);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), false);
  assert.ok(p.nodes.every(n => !n.isConnected));
});

test('multi-pane conversations with multiple composers stay healthy without triggering reload loops', () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-1';
  const renderedRings = [];
  p.context.ReactDOM = { createRoot(mount) { renderedRings.push(mount); return { render() {}, unmount() {} }; } };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = () => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    return { isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? {} : null };
  };
  const twoTriggers = [makeComposerTrigger(), makeComposerTrigger()];
  let ringNodes = [{}, {}];
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return twoTriggers;
    if (sel === '[data-testid="agy-context-ring-trigger"]') return ringNodes;
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true };
  vm.runInContext(source, p.context);
  assert.equal(renderedRings.length, 2);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('side-question and split-pane composers fetch and render independent context and telemetry per cascadeId', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/main-conv';
  const renderedByMount = new Map();
  const mountOrder = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.ReactDOM = {
    createRoot(mount) {
      mountOrder.push(mount);
      return {
        render(el) { renderedByMount.set(mount, el); },
        unmount() {}
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = cid => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    const card = { cid };
    return { cid, isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  };
  const mainTrigger = makeComposerTrigger('main-conv');
  const btwTrigger = makeComposerTrigger('btw-conv');
  p.context.__agyNativeAdapter.composerCascadeId = el => el?.cid || '';
  const stateRequests = [];
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextRing: true, speedStats: true }));
      return;
    }
    if (req.method === 'state') {
      stateRequests.push(req.conversationId);
      const reply = req.conversationId === 'btw-conv'
        ? { conversationId: 'btw-conv', contextWindow: { usedPercent: 80.4, usedTokens: 632000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 60.4 }, turns: [], requests: [] }
        : { conversationId: 'main-conv', contextWindow: { usedPercent: 78.2, usedTokens: 615000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 51.7 }, turns: [], requests: [] };
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, reply));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [mainTrigger, btwTrigger];
    if (sel === '[data-testid="agy-context-ring-trigger"]') return [{}, {}];
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));
  assert.ok(stateRequests.includes('main-conv'));
  assert.ok(stateRequests.includes('btw-conv'));
  assert.equal(mountOrder.length, 2);
  const mainData = renderedByMount.get(mountOrder[0])?.props?.data;
  const btwData = renderedByMount.get(mountOrder[1])?.props?.data;
  assert.equal(mainData?.conversationId, 'main-conv');
  assert.equal(mainData?.contextWindow?.usedPercent, 78.2);
  assert.equal(btwData?.conversationId, 'btw-conv');
  assert.equal(btwData?.contextWindow?.usedPercent, 80.4);
  assert.equal(btwData?.telemetry?.latestTps, 60.4);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('accountSwitcher respects multiAccount master switch, toggles native settings hide attr, and cleans up on dispose', () => {
  const pOff = page(true);
  const offMounts = [];
  const offSettingsBtn = { isConnected: true, parentElement: { insertBefore(node) { node.isConnected = true; offMounts.push(node); } } };
  pOff.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  pOff.context.__agyNativeAdapter.installPage = () => true;
  pOff.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} });
  pOff.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? offSettingsBtn : null;
  pOff.context.__agyInitialSettings = { enabled: true, multiAccount: false, accountSwitcher: true };
  vm.runInContext(source, pOff.context);
  assert.equal(offMounts.length, 0);
  assert.equal(pOff.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
  pOff.context.__agyPowertools.dispose();

  const p = page(true);
  const mountedNodes = [];
  const settingsBtn = {
    isConnected: true,
    parentElement: {
      children: [],
      insertBefore(node, before) {
        node.isConnected = true;
        mountedNodes.push({ node, before });
      }
    }
  };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({
    Page: () => null,
    Sidebar: () => null,
    AccountSwitcher: () => null,
    dispose() {}
  });
  p.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? settingsBtn : null;
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, accountSwitcher: true };
  vm.runInContext(source, p.context);
  assert.equal(mountedNodes.length, 1);
  assert.equal(mountedNodes[0].node.dataset.agyPowertoolsRoot, 'account-switcher');
  assert.equal(mountedNodes[0].before, settingsBtn);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(mountedNodes[0].node.isConnected, false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
});

test('renderRoot does not repeatedly call insertBefore when before equals existing mount', () => {
  const p = page(true);
  let insertCount = 0;
  const link = { isConnected: true, nextSibling: null };
  const parent = {
    insertBefore(node) {
      insertCount++;
      node.isConnected = true;
      link.nextSibling = node;
    }
  };
  link.parentElement = parent;
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  let scheduled = null;
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => sel === 'a[href="/customizations"]' ? link : null;
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(insertCount, 1);
  // Trigger a second mount cycle after link.nextSibling points to entry.mount
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, 1);
  p.context.__agyPowertools.dispose();
});

test('Powertools sidebar entry repositions after /customizations once /customizations mounts later', () => {
  const p = page(true);
  const children = [];
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  let insertCount = 0;
  const navContainer = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const existingIdx = children.indexOf(node);
      if (existingIdx >= 0) children.splice(existingIdx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  const newChat = { id: 'new-chat', isConnected: true, parentElement: navContainer, nextSibling: null };
  children.push(newChat);
  let custLink = null;
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => {
    if (sel === 'a[href="/customizations"]') return custLink;
    if (sel === '[data-testid="sidebar-navigation-items"]') return navContainer;
    return null;
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(children.length, 2);
  assert.equal(children[1].dataset.agyPowertoolsRoot, 'management');

  // Now native React mounts Automations and Customizations after Powertools
  const automations = { id: 'auto', isConnected: true, parentElement: navContainer, nextSibling: null };
  custLink = { id: 'cust', isConnected: true, parentElement: navContainer, nextSibling: null };
  children.push(automations, custLink);
  syncSiblings();
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.deepEqual(children.map(c => c.id || c.dataset?.agyPowertoolsRoot), ['new-chat', 'auto', 'cust', 'management']);
  const countAfterMove = insertCount;

  // Next mount tick must be a no-op (no flicker loop)
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, countAfterMove);

  p.context.__agyPowertools.dispose();
  assert.equal(children.find(c => c.dataset?.agyPowertoolsRoot === 'management')?.isConnected, false);
});

test('cold-start proxy prompt banner appears on mismatch, handles unreachable port, dismisses, and cleans up on dispose', async () => {
  const p = page(true);
  const bodyChildren = [];
  const makeEl = () => {
    const listeners = new Map();
    const el = {
      dataset: {},
      children: [],
      isConnected: false,
      textContent: '',
      append(...items) {
        for (const item of items) {
          item.isConnected = true;
          this.children.push(item);
        }
      },
      setAttribute() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      click() { listeners.get('click')?.(); },
      remove() {
        this.isConnected = false;
        const idx = bodyChildren.indexOf(this);
        if (idx >= 0) bodyChildren.splice(idx, 1);
      }
    };
    return el;
  };
  p.document.createElement = () => makeEl();
  p.document.body = {
    append(el) { el.isConnected = true; bodyChildren.push(el); }
  };

  const sent = [];
  p.context.__agyPowertoolsHost = payload => {
    const req = JSON.parse(payload);
    sent.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' });
      } else if (req.method === 'proxy.status') {
        p.context.__agyPowertoolsReceive(req.id, {
          configured: true,
          configuredUrl: 'http://127.0.0.1:7897',
          configuredDisplayUrl: 'http://127.0.0.1:7897',
          configuredForceHttp1: false,
          active: false,
          mismatch: true,
          reason: 'not-applied',
          canRelaunch: true
        });
      } else if (req.method === 'proxy.relaunch') {
        p.context.__agyPowertoolsReceive(req.id, req.force
          ? { ok: true, relaunching: true, proxyActive: true }
          : { ok: false, portUnreachable: true, message: '代理端口 127.0.0.1:7897 无法连接' });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setTimeout(resolve, 20));

  const findBanner = () => bodyChildren.find(el => el.dataset.testid === 'agy-proxy-prompt-banner');
  const findBtn = (banner, testId) => banner?.children?.flatMap(c => c.children || []).find(b => b.dataset?.testid === testId);

  let banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('http://127.0.0.1:7897'));
  assert.equal(banner.children[0].textContent.includes('\u00b7'), false);

  // Clicking relaunch when port is closed warns instead of restarting immediately
  findBtn(banner, 'agy-proxy-banner-relaunch').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('无法连接'));
  assert.ok(findBtn(banner, 'agy-proxy-banner-force'));

  // Dismiss removes banner cleanly
  findBtn(banner, 'agy-proxy-banner-dismiss').click();
  assert.equal(findBanner(), undefined);

  p.context.__agyPowertools.dispose();
  assert.equal(bodyChildren.some(el => el.dataset.testid === 'agy-proxy-prompt-banner'), false);
});

test('native-bindings resolves 2.34.0 notification hook without type:"add" and stays optional when absent', () => {
  const bindingsSource = readFileSync(new URL('../lib/native-bindings.js', import.meta.url), 'utf8');
  const makeEnv = (toastHook, jcImpl = null) => {
    const Sy = () => null; Sy.displayName = 'CompactTooltipBaseUi';
    const ctx = vm.createContext({
      React: {},
      createFileRoute: () => opts => opts,
      HC: () => ({ defaultOpen: 1, matchTriggerWidth: 1, disableMobileSheet: 1 }),
      IC: () => ({ startDragTracking: 1, tag: 'popover-trigger-element', asChild: 1 }),
      JC: jcImpl || (() => ({ scrollContainerClassName: 1, arrowNavigable: 1, matchTriggerWidth: 1 })),
      KC: () => ({ asChild: 1, isMobile: 1, setIsOpen: 1 }),
      GC: () => ({ tooltipPlace: 1, secondaryAction: 1, tag: 'main-row-trigger' }),
      Uy: () => ({ paddingClassName: 1, computedAriaLabel: 1, asChild: 1 }),
      XP: () => ({ onCheckedChange: 1, desc: 'aria-describedby', role:"switch" }),
      UP: ({label: a}) => ({ rightElement: a, extraContent: 1, descriptionId: 1 }),
      TP: () => 'agy-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border',
      VP: () => ({ headerRight: 1, defaultCollapsed: 1, forceExpanded: 1 }),
      dq: ({name: a}) => ({ cls: 'google-symbols', kind: 'Icon', a }),
      k0: ({trigger: a}) => ({ triggerVisible: a, onCollapseComplete: 1, defaultExpanded: 1 }),
      Sy,
      kT: () => ({ ownsHighlight: 1, onHighlightExit: 1, onSearchQueryChange: 1 }),
      lT: () => ({ asChild: 1, openOnHover: 1, closeDelay: 1, attr: "data-no-drag" }),
      mT: () => ({ collisionBoundary: 1, pad: 1, alignOffset: 1, keepMounted: 1 }),
      nT: () => ({ highlighted: 1, selected: 1, action: 1, description: 1, managedHighlight: 1 }),
      HU: s => s.sourceTrajectoryStepInfo?.stepIndex,
      Kc: x => x,
      resolveFn: () => { const c = Kc(Proto.CascadeConfigSchema, { lookupCustomModelInfo: 1, customModelInfoOverride: 1, checkpointConfig: void 0 }); return c; },
      segmentFn: () => ({ getStepRendererConfig: 1, hasBeenCollapsed: 1, leadingSteps: 1 }),
      menuFn: function m(a,{onRenameClick:b}) { return { b, onRestoreClick: 1, onCreateGroup: 1 }; },
      Proto: { CascadeConfigSchema: {} },
      Wb: x => { const o = Object.create(null); o.$typeName=x.members+'oneof'; return o; },
      IJ: s => { const x = {}; x._dirtyElements=1; x._dirtyLeaves=1; x._parsed=!0; return JSON.parse(s); },
      LN: s => JSON.stringify({ version:1, singleParagraph: s, type:"root" }),
      ...(toastHook ? { kn: toastHook } : {})
    });
    // Ensure resolveFn contains exact matcher literal checkpointConfig=void 0
    vm.runInContext(`resolveFn = function(checkpointConfig=void 0){ const x=Kc(Proto.CascadeConfigSchema, checkpointConfig); return { lookupCustomModelInfo: x, customModelInfoOverride: 1 }; };`, ctx);
    vm.runInContext(bindingsSource, ctx);
    return ctx.__agyResolveNativeBindings([]);
  };

  // 2.34.0 style (action creator Mqa instead of inline type:"add")
  const toast234 = function () { return ({ autoDismissMs: m, plainTextFallback: p, primaryActionLabel: l }) => b.showNotification({ primaryActionLabel: l, autoDismissMs: m, plainTextFallback: p }); };
  const resolved234 = makeEnv(toast234);
  assert.equal(resolved234.names.um, 'kn');
  assert.equal(resolved234.bindings.um, toast234);

  // Absent toast hook degrades gracefully without throwing
  const resolvedNoToast = makeEnv(null);
  assert.equal(resolvedNoToast.bindings.um, undefined);

  // 2.35.0 style JC (scrollContainerClassName removed, keeps arrowNavigable + matchTriggerWidth + collisionAvoidance / contentRef.current=)
  const jc235 = function LQ({ arrowNavigable: l, matchTriggerWidth: k, collisionAvoidance: n }) { const y = { contentRef: {} }; y.contentRef.current = l || k || n; return y; };
  const resolved235 = makeEnv(toast234, jc235);
  assert.equal(resolved235.names.JC, 'JC');
  assert.equal(resolved235.bindings.JC, jc235);
});

test('overview mounts both progress and overviewQuota in stable order without insertBefore ping-pong', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-ov';
  const children = [];
  let insertCount = 0;
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  const overview = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const idx = children.indexOf(node);
      if (idx >= 0) children.splice(idx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, Progress: () => null, OverviewQuota: () => null, dispose() {} });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, progress: true, overviewQuota: true }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-ov', turns: [], requests: [], progress: { status: 'complete', tasks: [] } }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelector = sel => sel === '[data-testid="overview-panel"]' ? overview : null;
  p.context.__agyInitialSettings = { enabled: true, progress: true, overviewQuota: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(children.map(c => c.dataset.agyPowertoolsRoot).join(','), 'progress,overview-quota');
  const stableCount = insertCount;
  // Re-trigger mount cycles multiple times -> zero extra insertBefore mutations
  for (let i = 0; i < 4; i++) {
    observerCb?.([{ target: { closest: () => null } }]);
    scheduled?.();
  }
  assert.equal(insertCount, stableCount);
  p.context.__agyPowertools.dispose();
});

test('startAddAccount awaits active sync and calls accounts.completeAdd, and refreshAccount skips quota.observe on credentialMismatch', async () => {
  const p = page(true);
  let capturedEnv = null;
  let currentEmail = 'alpha@example.com';
  const calls = [];
  let mismatchNextSync = false;
  let quotaRemaining = 0.9;

  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({
    email: currentEmail,
    name: currentEmail.split('@')[0],
    plan: 'Google AI Ultra',
    planId: 'g1-ultra-tier'
  });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: {
        groups: [{
          displayName: 'Gemini Models',
          buckets: [{ bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: quotaRemaining }, resetTime: null }]
        }]
      }
    })
  });
  p.context.__agyNativeAdapter.startAccountLogin = async () => {
    currentEmail = 'beta@example.com';
    return { ok: true, email: currentEmail };
  };
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.autoSwitchCandidate') {
        p.context.__agyPowertoolsReceive(req.id, { candidate: { id: 'acct-a', email: 'alpha@example.com', name: 'Alpha' }, cooldownRemainingMs: 0 });
      } else if (req.method === 'accounts.prepareAdd') {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, backedUpId: 'acct-a', prevCredHash: 'HASH_A', activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'alpha@example.com', hasCredential: true }] });
      } else if (req.method === 'accounts.syncActive') {
        if (mismatchNextSync) {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [{ id: 'acct-b', email: 'beta@example.com', hasCredential: true }],
            credentialMismatch: { uiEmail: 'beta@example.com', credentialEmail: 'alpha@example.com' }
          });
        } else {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [
              { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
              { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
            ]
          });
        }
      } else if (req.method === 'accounts.completeAdd') {
        p.context.__agyPowertoolsReceive(req.id, {
          ok: true,
          relaunching: false,
          manualRestartRequired: true,
          account: { id: 'acct-b', email: 'beta@example.com', name: 'beta' },
          activeId: 'acct-b',
          accounts: [
            { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
            { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
          ]
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);

  // Even when the newly signed-in account has a depleted bucket and autoSwitchAccount is enabled,
  // startAddAccount suppresses auto-switch so it never races with completeAdd / relaunch.
  quotaRemaining = 0;
  const addRes = await capturedEnv.startAddAccount('Backup');
  assert.equal(addRes.ok, true);
  assert.equal(addRes.manualRestartRequired, true);
  assert.equal(calls.some(c => c.method === 'accounts.autoSwitchCandidate'), false);
  assert.equal(p.context.document.querySelector('[data-testid="agy-autoswitch-banner"]'), null);
  quotaRemaining = 0.9;
  const methods = calls.map(c => c.method);
  const prepIdx = methods.indexOf('accounts.prepareAdd');
  const syncIdx = methods.lastIndexOf('accounts.syncActive');
  const completeIdx = methods.indexOf('accounts.completeAdd');
  assert.ok(prepIdx >= 0 && syncIdx > prepIdx && completeIdx > syncIdx, `Expected prepareAdd -> syncActive -> completeAdd, got ${methods.join(',')}`);
  const completeCall = calls[completeIdx];
  assert.equal(completeCall.email, 'beta@example.com');
  assert.equal(completeCall.prevEmail, 'alpha@example.com');
  assert.equal(completeCall.prevCredHash, 'HASH_A');
  assert.equal(completeCall.relaunch, true);

  // When syncActive reports credentialMismatch, refreshAccount MUST NOT call quota.observe
  const beforeObserve = calls.filter(c => c.method === 'quota.observe').length;
  mismatchNextSync = true;
  await capturedEnv.refreshAccountQuotas('acct-b');
  const afterObserve = calls.filter(c => c.method === 'quota.observe').length;
  assert.equal(afterObserve, beforeObserve);

  p.context.__agyPowertools.dispose();
});

test('sidebar bell switches to most recent running session, toggles Priority view, and search shortcut ignores terminal focus', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/idle-conv';
  const renderedTrees = new Map();
  p.context.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: () => 0,
    useEffect: () => {},
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useRef: v => ({ current: v })
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) { renderedTrees.set(mount.dataset?.agyPowertoolsRoot, tree); },
        unmount() { renderedTrees.delete(mount.dataset?.agyPowertoolsRoot); }
      };
    }
  };

  const navigated = [];
  let jumpedTurn = null;
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    installPage: () => true,
    router: () => ({
      navigate: async arg => {
        navigated.push(arg);
        if (arg?.params?.cascadeId) p.context.location.pathname = `/c/${arg.params.cascadeId}`;
      },
      subscribe: () => () => {}
    }),
    navigateTurn: turn => { jumpedTurn = turn; return true; },
    conversationDirectory: () => ({
      running: [
        { id: 'run-latest', title: 'Train A100 model', projectId: 'p-ml', projectName: 'FlowIE', running: true, updatedAtMs: 2000 },
        { id: 'run-older', title: 'Check logs', projectId: 'p-ops', projectName: 'ops', running: true, updatedAtMs: 1000 },
        ...Array.from({ length: 10 }, (_, i) => ({ id: `run-extra-${i}`, running: true, updatedAtMs: 100 - i }))
      ],
      unread: [],
      projects: [],
      byId: {},
      subagentIds: []
    })
  };

  let capturedEnv = null;
  p.context.__agyPanels = env => { capturedEnv = env; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, sidebarFocusBell: true, sessionSearch: true, sessionSearchShortcut: true }));
    } else if (req.method === 'settings.set') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, req.settings));
    }
  };

  const headerChildren = [];
  const syncHeaderSiblings = () => {
    for (let i = 0; i < headerChildren.length; i++) headerChildren[i].nextSibling = headerChildren[i + 1] || null;
  };
  const headerRow = {
    insertBefore(child, before) {
      child.isConnected = true;
      const existing = headerChildren.indexOf(child);
      if (existing >= 0) headerChildren.splice(existing, 1);
      const idx = before ? headerChildren.indexOf(before) : -1;
      if (idx >= 0) headerChildren.splice(idx, 0, child);
      else headerChildren.push(child);
      syncHeaderSiblings();
    }
  };
  const afterSearch = { id: 'after-search', isConnected: true, parentElement: headerRow, nextSibling: null };
  const searchBtn = { id: 'search', isConnected: true, parentElement: headerRow, nextSibling: afterSearch };
  headerChildren.push(searchBtn, afterSearch);
  syncHeaderSiblings();
  const navBlockParent = { insertBefore(child) { child.isConnected = true; } };
  const navBlock = { isConnected: true, parentElement: navBlockParent, nextSibling: null };
  const sidebarEl = {
    querySelector: sel => {
      if (sel.includes('Search')) return searchBtn;
      if (sel === '[data-testid="sidebar-navigation-items"]') return navBlock;
      return null;
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  p.document.querySelector = sel => {
    if (sel.includes('Open Conversation Picker')) return searchBtn;
    if (sel.includes('Sidebar')) return sidebarEl;
    return null;
  };

  p.context.__agyInitialSettings = { enabled: true, sidebarFocusBell: true, sessionSearch: true, sessionSearchShortcut: true };
  vm.runInContext(source, p.context);

  const bellFnTree = renderedTrees.get('sidebar-bell');
  assert.ok(bellFnTree);
  assert.deepEqual(headerChildren.map(c => c.id || c.dataset?.agyPowertoolsRoot), ['search', 'sidebar-bell', 'after-search']);
  const bellRendered = bellFnTree.type(bellFnTree.props);
  assert.equal(bellRendered.props['data-testid'], 'agy-sidebar-bell-btn');

  // First click switches to run-latest and opens Priority panel
  bellRendered.props.onClick({ preventDefault() {}, stopPropagation() {} });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(navigated[0].params.cascadeId, 'run-latest');
  assert.ok(renderedTrees.has('sidebar-focus'));

  // Priority actions render real SVG, and promoted rows are hidden only in the native list.
  const focusTree = renderedTrees.get('sidebar-focus');
  const renderFocus = () => focusTree.type(focusTree.props);
  const [dedupStyle, focusHeader, focusList] = renderFocus().children;
  assert.match(dedupStyle.children[0], /\/c\/run-latest/);
  assert.equal(focusList.props['data-testid'], 'agy-priority-list');
  assert.equal(focusList.props.tabIndex, 0);
  const rows = focusList.children[0];
  assert.equal(rows.length, 12);
  assert.equal(rows.at(-1).props['data-conversation-id'], 'run-extra-9');
  const css = p.nodes.find(n => Object.hasOwn(n.dataset, 'agyDensityStyle')).textContent;
  assert.match(css, /\.agy-priority-list\{[^}]*max-block-size:min\(calc\(var\(--agy-priority-visible-rows,4\) \* var\(--agy-priority-row-height\)\),36vh\);overflow-y:auto/);
  assert.equal(focusList.props.style['--agy-priority-visible-rows'], 4);
  for (const count of [3, 5]) {
    await capturedEnv.change({ priorityVisibleRows: count });
    const list = renderFocus().children[2];
    assert.equal(list.props.style['--agy-priority-visible-rows'], count);
    assert.equal(list.children[0].length, 12);
  }
  const sliders = focusHeader.children[1];
  const icon = sliders.children[0];
  assert.equal(icon.type(icon.props).type, 'svg');
  sliders.props.onClick({ preventDefault() {}, stopPropagation() {} });
  const menu = renderFocus().children[1].children[2];
  assert.equal(menu.children[0].props['data-testid'], 'agy-sidebar-next-running-btn');
  assert.equal(menu.children[1].props['data-testid'], 'agy-priority-clear-read');
  assert.equal(menu.children[1].props.disabled, true);

  // Cmd+Opt+F triggers Session Search unless inside .xterm terminal
  const keyHandlers = p.callbacks.get('keydown') || [];
  let prevented = false;
  for (const fn of keyHandlers) {
    fn({ metaKey: true, altKey: true, shiftKey: false, code: 'KeyF', key: 'ƒ', target: { closest: sel => sel.includes('.xterm') ? {} : null }, preventDefault() { prevented = true; }, stopPropagation() {} });
  }
  assert.equal(prevented, false);
  for (const fn of keyHandlers) {
    fn({ metaKey: true, altKey: true, shiftKey: false, code: 'KeyF', key: 'ƒ', target: { closest: () => null }, preventDefault() { prevented = true; }, stopPropagation() {} });
  }
  assert.equal(prevented, true);
  assert.equal(capturedEnv.consumeRequestedTab(), 'search');

  // jumpToSearchHit navigates to target conversation and scrolls to matched turn
  capturedEnv.jumpToSearchHit({ conversationId: 'run-older', projectId: 'p-ops', stepIndexStart: 14 });
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(JSON.parse(JSON.stringify(jumpedTurn)), { stepIndexStart: 14 });

  p.context.__agyPowertools.dispose();
});

test('Priority view retains finished and read chats like Codex, sorts waiting/unread/active/idle, ages out after TTL, and clears read chats on demand', () => {
  const p = page(true);
  p.context.ReactDOM = { createRoot: () => ({ render() {}, unmount() {} }) };
  p.context.document.hasFocus = () => true;
  p.context.location.pathname = '/c/chat-focused';
  const records = {
    'chat-focused': { id: 'chat-focused', title: 'Focused task', projectName: 'proj1', running: true, unread: false, updatedAtMs: 1000 },
    'chat-bg': { id: 'chat-bg', title: 'Background task', projectName: 'proj2', running: true, unread: false, updatedAtMs: 2000 },
    'ordinary': { id: 'ordinary', title: 'Recently updated ordinary chat', running: false, unread: false, updatedAtMs: 1_699_999_999_999 }
  };
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    installPage: () => true,
    onEditChange: () => () => {},
    onGoalDetected: () => () => {},
    executionState: id => id === 'chat-bg' && records['chat-bg'].waiting ? { live: { waiting: true } } : null,
    conversationDirectory: () => ({
      running: Object.values(records).filter(r => r.running),
      unread: Object.values(records).filter(r => r.unread),
      byId: { ...records },
      projects: [],
      subagentIds: []
    })
  };
  p.context.__agyInitialSettings = { enabled: true, sidebarFocusBell: true };
  vm.runInContext(source, p.context);
  const pt = p.context.__agyPowertools;
  const t0 = 1_700_000_000_000;

  // 1. Both running; chat-bg waiting on approval ranks above active
  records['chat-bg'].waiting = true;
  let snap = pt.syncPriorityItems({ now: t0, activeId: 'chat-focused', focused: true });
  assert.deepEqual(Array.from(snap.items, i => `${i.id}:${i.attentionState}`), ['chat-bg:waiting', 'chat-focused:active']);

  // 2. Both finish: focused chat becomes `idle` (retained!), background chat becomes `unread` (ranks above idle!)
  records['chat-bg'].waiting = false;
  records['chat-bg'].running = false;
  records['chat-focused'].running = false;
  snap = pt.syncPriorityItems({ now: t0 + 5000, activeId: 'chat-focused', focused: true });
  assert.deepEqual(Array.from(snap.items, i => `${i.id}:${i.attentionState}`), ['chat-bg:unread', 'chat-focused:idle']);

  // 3. Clicking chat-bg to read it transitions unread -> idle WITHOUT disappearing from Priority
  p.context.location.pathname = '/c/chat-bg';
  snap = pt.syncPriorityItems({ now: t0 + 10_000, activeId: 'chat-bg', focused: true });
  assert.deepEqual(Array.from(snap.items, i => i.attentionState), ['idle', 'idle']);
  assert.equal(snap.items.length, 2);

  // 4. After 15m TTL, chat-focused (finished at t0+5s) ages out while chat-bg (read at t0+10s) still has 3s left
  snap = pt.syncPriorityItems({ now: t0 + 5000 + 15 * 60 * 1000 + 2000, activeId: 'other', focused: true });
  assert.deepEqual(Array.from(snap.items, i => i.id), ['chat-bg']);

  // 5. "Clear read chats" sweeps remaining idle items immediately
  pt.clearReadPriorityChats(t0 + 5000 + 15 * 60 * 1000 + 3000);
  snap = pt.syncPriorityItems({ now: t0 + 5000 + 15 * 60 * 1000 + 3000, activeId: 'other', focused: true });
  assert.equal(snap.items.length, 0);

  // Clearing a read chat only suppresses the old update, not its next run.
  records['chat-bg'].running = true;
  snap = pt.syncPriorityItems({ now: t0 + 5000 + 15 * 60 * 1000 + 4000, activeId: 'other' });
  assert.deepEqual(Array.from(snap.items, i => i.id), ['chat-bg']);
  records['chat-bg'].archived = true;
  snap = pt.syncPriorityItems({ now: t0 + 5000 + 15 * 60 * 1000 + 5000, activeId: 'other' });
  assert.equal(snap.items.length, 0);

  pt.dispose();
});

test('composer under-card status strip mounts outside .surface-composer-card after card and renders Git + telemetry cleanly', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-under';
  const renderedByMount = new Map();
  p.context.React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props || {}), children: children.length <= 1 ? children[0] : children },
      children
    }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: v => ({ current: v })
  };
  p.context.HC = ({ children }) => children;
  p.context.IC = ({ children }) => children;
  p.context.JC = ({ children: _c, ...props }) => ({ type: 'PopoverContent', props, children: [] });
  p.context.Uy = ({ children, ...props }) => ({ type: 'Button', props, children: Array.isArray(children) ? children : [children] });
  p.context.__agyNativeAdapter = {
    wrap: el => el,
    composerCascadeId: () => 'conv-under',
    workspaceUri: (_cid, src) => src === card ? 'file:///repo' : ''
  };
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(el) { renderedByMount.set(mount, el); },
        unmount() { renderedByMount.delete(mount); }
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });

  const makeContainer = () => {
    const children = [];
    const syncSiblings = () => {
      for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
    };
    return {
      children,
      insertBefore(node, before) {
        const cur = children.indexOf(node);
        if (cur !== -1) children.splice(cur, 1);
        const idx = before ? children.indexOf(before) : -1;
        if (idx === -1) children.push(node);
        else children.splice(idx, 0, node);
        node.parentElement = this;
        node.isConnected = true;
        syncSiblings();
      }
    };
  };

  const inputBox = makeContainer();
  const footerRow = makeContainer();
  const card = { isConnected: true, parentElement: null, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  inputBox.insertBefore(card, null);
  const modelTrigger = { isConnected: true, parentElement: null, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  footerRow.insertBefore(modelTrigger, null);

  p.document.querySelector = sel => sel === '.surface-composer-card' ? card : null;
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [modelTrigger];
    if (sel === '[data-testid="agy-context-ring-trigger"]') return [{}];
    return [];
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'git.status') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {
        isRepo: true, branch: 'feat/composer-under-strip', changedCount: 2, additions: 1604, deletions: 310, files: []
      }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {
        conversationId: 'conv-under',
        goal: { text: 'Ship clean UI', status: 'active' },
        contextWindow: { usedPercent: 64, usedTokens: 128000, maxTokens: 200000, categories: [] },
        telemetry: { tps: 29.5, latestTps: 29.5 },
        turns: [], requests: []
      }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true, gitStatusPill: true, goalBar: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));

  // composer footer row stays untouched; inputBox holds [goal-bar, card, ring(under-strip)]
  assert.equal(footerRow.children.length, 1);
  assert.deepEqual(
    inputBox.children.map(n => n === card ? 'card' : n.dataset?.agyPowertoolsRoot),
    ['goal-bar', 'card', 'ring']
  );
  const ringMount = inputBox.children[2];
  assert.equal(ringMount.className, 'block w-full');

  // Evaluate rendered NativeEntry tree to verify left Git + right Context/Speed under-strip structure
  const rootEl = renderedByMount.get(ringMount);
  const stripTree = rootEl.type(rootEl.props);
  assert.equal(stripTree.props['data-testid'], 'agy-composer-under-strip');
  const flatText = [];
  const testIds = [];
  const walk = node => {
    if (node == null || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') { flatText.push(String(node)); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.type === 'function') { walk(node.type(node.props || {})); return; }
    if (node.props?.['data-testid']) testIds.push(node.props['data-testid']);
    (node.children || []).forEach(walk);
  };
  walk(stripTree);
  assert.ok(testIds.includes('agy-git-status-trigger'));
  assert.ok(testIds.includes('agy-context-ring-trigger'));
  assert.ok(testIds.includes('agy-speed-stats-trigger'));
  const joined = flatText.join(' ');
  assert.ok(joined.includes('feat/composer-under-strip'));
  assert.ok(joined.includes('+1604'));
  assert.ok(joined.includes('-310'));
  assert.ok(joined.includes('上下文 '));
  assert.ok(joined.includes('64%'));
  assert.ok(joined.includes('29.5 tok/s'));
  assert.equal(joined.includes('\u00b7'), false);

  // Empty state (no telemetry, no git repo) returns null so no empty padding bar renders
  const emptyResult = rootEl.type({ data: null, conversationId: '', source: {} });
  assert.equal(emptyResult, null);

  p.context.__agyPowertools.dispose();
});
