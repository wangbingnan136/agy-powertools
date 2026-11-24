import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { toZhTw } from '../lib/zh-tw.mjs';

const opticsSource = readFileSync(new URL('../lib/prism-optics.js', import.meta.url), 'utf8');

function splitTopLevelCommas(sel) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(sel.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(sel.slice(start).trim());
  return parts.filter(Boolean);
}

function splitWhitespaceRespectingBrackets(sel) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let buf = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') { depth++; buf += ch; continue; }
    if (ch === ')' || ch === ']') { depth = Math.max(0, depth - 1); buf += ch; continue; }
    if (/\s/.test(ch) && depth === 0) {
      if (buf) { parts.push(buf); buf = ''; }
      continue;
    }
    buf += ch;
  }
  if (buf) parts.push(buf);
  return parts;
}

function matchesSimple(el, compound) {
  if (!el || el.nodeType !== 1) return false;
  let rest = compound.trim();
  if (!rest) return false;

  // Extract :not(...)
  const notExprs = [];
  rest = rest.replace(/:not\(([^()]+)\)/g, (_, inner) => {
    notExprs.push(inner.trim());
    return '';
  });

  // Extract [attr...]
  const attrChecks = [];
  rest = rest.replace(/\[([^\]]+)\]/g, (_, raw) => {
    const m = raw.match(/^([a-zA-Z0-9_-]+)\s*(?:(\*|\^)?=\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/);
    if (m) {
      attrChecks.push({
        name: m[1],
        op: m[2] || (raw.includes('=') ? '=' : ''),
        val: m[3] ?? m[4] ?? m[5] ?? ''
      });
    }
    return '';
  });

  // Remaining tag & classes
  const tokens = rest.split(/(?=[.#])/).filter(Boolean);
  for (const tok of tokens) {
    if (tok.startsWith('.')) {
      if (!el.classList.contains(tok.slice(1))) return false;
    } else if (tok.startsWith('#')) {
      if (el.getAttribute('id') !== tok.slice(1)) return false;
    } else if (tok !== '*') {
      if (el.tagName.toLowerCase() !== tok.toLowerCase()) return false;
    }
  }

  for (const chk of attrChecks) {
    const actual = el.getAttribute(chk.name);
    if (!chk.op) {
      if (actual == null) return false;
    } else if (chk.op === '=') {
      if (actual !== chk.val) return false;
    } else if (chk.op === '*') {
      if (actual == null || !actual.includes(chk.val)) return false;
    } else if (chk.op === '^') {
      if (actual == null || !actual.startsWith(chk.val)) return false;
    }
  }

  for (const ne of notExprs) {
    if (matchesSimple(el, ne)) return false;
  }
  return true;
}

function matchesSelector(el, selector) {
  if (!el || el.nodeType !== 1 || !selector) return false;
  for (const branch of splitTopLevelCommas(selector)) {
    const parts = splitWhitespaceRespectingBrackets(branch);
    if (!parts.length) continue;
    if (!matchesSimple(el, parts[parts.length - 1])) continue;
    let cur = el.parentElement;
    let idx = parts.length - 2;
    while (idx >= 0 && cur) {
      if (matchesSimple(cur, parts[idx])) idx--;
      cur = cur.parentElement;
    }
    if (idx < 0) return true;
  }
  return false;
}

function createMockEnv({ pathname = '/', dark = true, reducedMotion = false } = {}) {
  let fakeNow = 1000;
  let nextRafId = 1;
  let nextTimerId = 1;
  const rafQueue = new Map();
  const timers = new Map();
  const observers = new Set();

  const notifyMutations = records => {
    for (const obs of observers) {
      obs.callback(records);
    }
  };

  class MockText {
    constructor(text) {
      this.nodeType = 3;
      this.nodeValue = String(text);
      this.parentElement = null;
      this.isConnected = false;
    }
  }

  class MockStyle {
    constructor() {
      this.props = new Map();
    }
    setProperty(k, v) { this.props.set(k, String(v)); }
    getPropertyValue(k) { return this.props.get(k) || ''; }
    removeProperty(k) { this.props.delete(k); }
    set cssText(val) {
      this.props.clear();
      for (const pair of String(val).split(';')) {
        const idx = pair.indexOf(':');
        if (idx > 0) this.props.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    }
    get cssText() {
      return [...this.props.entries()].map(([k, v]) => `${k}:${v}`).join(';');
    }
  }

  class MockElement {
    constructor(tagName, ownerDoc) {
      this.nodeType = 1;
      this.tagName = String(tagName || 'div').toUpperCase();
      this.ownerDocument = ownerDoc;
      this.children = [];
      this.childNodes = [];
      this.parentElement = null;
      this.attrs = new Map();
      this.listeners = new Map();
      this.style = new MockStyle();
      this.dataset = {};
      this.isConnected = false;
      this.textContentValue = '';
      this.scrollTop = 0;
      this.scrollHeight = 1200;
      this.clientHeight = 400;
      this.rect = { left: 10, top: 20, width: 320, height: 120 };
      this.paused = false;
      this.playCalls = 0;
      this.pauseCalls = 0;
      this.width = 0;
      this.height = 0;
      this.classList = {
        add: (...names) => {
          const cur = new Set(this.className.split(/\s+/).filter(Boolean));
          for (const n of names) cur.add(n);
          this.className = [...cur].join(' ');
        },
        remove: (...names) => {
          const cur = new Set(this.className.split(/\s+/).filter(Boolean));
          for (const n of names) cur.delete(n);
          this.className = [...cur].join(' ');
        },
        contains: name => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => {
          const has = this.classList.contains(name);
          const next = force === undefined ? !has : Boolean(force);
          if (next) this.classList.add(name);
          else this.classList.remove(name);
          return next;
        }
      };
    }

    get className() { return this.attrs.get('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get firstChild() { return this.children[0] || null; }
    get textContent() {
      if (this.childNodes.length === 0) return this.textContentValue;
      return this.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
    }
    set textContent(v) {
      this.textContentValue = String(v ?? '');
      this.childNodes = [];
      this.children = [];
    }
    set innerHTML(v) {
      if (!v) {
        this.childNodes = [];
        this.children = [];
        this.textContentValue = '';
      }
    }
    get innerHTML() { return ''; }

    setAttribute(name, val) {
      const prev = this.attrs.get(name);
      this.attrs.set(name, String(val));
      if (name.startsWith('data-')) {
        const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[camel] = String(val);
      }
      if (this.isConnected && prev !== String(val)) {
        notifyMutations([{ type: 'attributes', target: this, attributeName: name }]);
      }
    }
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    hasAttribute(name) { return this.attrs.has(name); }
    removeAttribute(name) {
      const had = this.attrs.has(name);
      this.attrs.delete(name);
      if (name.startsWith('data-')) {
        const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        delete this.dataset[camel];
      }
      if (this.isConnected && had) {
        notifyMutations([{ type: 'attributes', target: this, attributeName: name }]);
      }
    }
    toggleAttribute(name, force) {
      const has = this.hasAttribute(name);
      const next = force === undefined ? !has : Boolean(force);
      if (next) this.setAttribute(name, '');
      else this.removeAttribute(name);
      return next;
    }

    _attachChild(node, beforeNode = null) {
      if (!node) return node;
      if (node.parentElement) node.remove?.();
      node.parentElement = this;
      const syncConnected = (n, val) => {
        n.isConnected = val;
        if (n.childNodes) for (const c of n.childNodes) syncConnected(c, val);
      };
      syncConnected(node, this.isConnected);
      if (beforeNode && this.childNodes.includes(beforeNode)) {
        const idx = this.childNodes.indexOf(beforeNode);
        this.childNodes.splice(idx, 0, node);
      } else {
        this.childNodes.push(node);
      }
      this.children = this.childNodes.filter(c => c.nodeType === 1);
      if (this.isConnected) {
        notifyMutations([{ type: 'childList', target: this, addedNodes: [node] }]);
      }
      return node;
    }

    appendChild(node) { return this._attachChild(node); }
    append(...nodes) { for (const n of nodes) this._attachChild(n); }
    insertBefore(node, ref) { return this._attachChild(node, ref); }
    replaceWith(node) {
      if (!this.parentElement) return;
      const parent = this.parentElement;
      const idx = parent.childNodes.indexOf(this);
      this.remove();
      parent.insertBefore(node, parent.childNodes[idx] || null);
    }
    remove() {
      if (!this.parentElement) return;
      const parent = this.parentElement;
      const idx = parent.childNodes.indexOf(this);
      if (idx >= 0) parent.childNodes.splice(idx, 1);
      parent.children = parent.childNodes.filter(c => c.nodeType === 1);
      this.parentElement = null;
      const markDisconnected = n => {
        n.isConnected = false;
        if (n.childNodes) for (const c of n.childNodes) markDisconnected(c);
      };
      markDisconnected(this);
      if (parent.isConnected) {
        notifyMutations([{ type: 'childList', target: parent, removedNodes: [this] }]);
      }
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
      const out = [];
      const visit = node => {
        for (const child of node.children) {
          if (matchesSelector(child, sel)) out.push(child);
          visit(child);
        }
      };
      visit(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

    addEventListener(type, fn, opts) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      const entry = { fn, capture: Boolean(typeof opts === 'boolean' ? opts : opts?.capture) };
      this.listeners.get(type).add(entry);
      if (opts && typeof opts === 'object' && opts.signal) {
        opts.signal.addEventListener?.('abort', () => {
          this.listeners.get(type)?.delete(entry);
        });
      }
    }
    dispatchEvent(ev = {}) {
      let stopped = false;
      const event = {
        type: ev.type || 'click',
        target: ev.target || this,
        clientX: ev.clientX ?? 0,
        clientY: ev.clientY ?? 0,
        key: ev.key || '',
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { stopped = true; }
      };
      const path = [];
      for (let cur = this; cur; cur = cur.parentElement) path.unshift(cur);
      for (const entry of [...(docListeners.get(event.type) || [])]) {
        if (entry.capture && !stopped) entry.fn(event);
      }
      for (const node of path) {
        if (stopped) break;
        for (const entry of [...(node.listeners.get(event.type) || [])]) {
          if (entry.capture && !stopped) entry.fn(event);
        }
      }
      for (let i = path.length - 1; i >= 0 && !stopped; i--) {
        const node = path[i];
        for (const entry of [...(node.listeners.get(event.type) || [])]) {
          if (!entry.capture && !stopped) entry.fn(event);
        }
      }
      if (!stopped) {
        for (const entry of [...(docListeners.get(event.type) || [])]) {
          if (!entry.capture && !stopped) entry.fn(event);
        }
      }
      return !event.defaultPrevented;
    }

    getBoundingClientRect() { return { ...this.rect }; }
    getContext() {
      const calls = [];
      return {
        calls,
        clearRect: (...a) => calls.push(['clearRect', ...a]),
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        closePath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        rect: () => {},
        roundRect: () => {},
        clip: () => {},
        fill: () => calls.push(['fill']),
        stroke: () => {},
        arc: () => {},
        fillRect: (...a) => calls.push(['fillRect', ...a]),
        fillText: (...a) => calls.push(['fillText', ...a]),
        set fillStyle(v) { calls.push(['fillStyle', v]); },
        set strokeStyle(_) {},
        set lineWidth(_) {},
        set font(_) {},
        set textAlign(_) {},
        set textBaseline(_) {}
      };
    }
    play() { this.paused = false; this.playCalls++; return Promise.resolve(); }
    pause() { this.paused = true; this.pauseCalls++; }
  }

  const docListeners = new Map();
  const winListeners = new Map();

  const document = {
    nodeType: 9,
    hidden: false,
    documentElement: null,
    head: null,
    body: null,
    createElement(tag) { return new MockElement(tag, this); },
    createElementNS(_ns, tag) { return new MockElement(tag, this); },
    createTextNode(txt) { return new MockText(txt); },
    createRange() {
      return {
        setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
        setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
        getBoundingClientRect() { return { left: 120, top: 240, width: 1, height: 18 }; }
      };
    },
    createTreeWalker(root) {
      const list = [];
      const walk = n => {
        for (const c of n.childNodes || []) {
          if (c.nodeType === 3) list.push(c);
          else walk(c);
        }
      };
      walk(root);
      let idx = 0;
      return { nextNode: () => (idx < list.length ? list[idx++] : null) };
    },
    getSelection() {
      return {
        rangeCount: 1,
        getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 145, top: 260, width: 1, height: 19 }) })
      };
    },
    querySelector(sel) { return this.documentElement.querySelector(sel); },
    querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); },
    addEventListener(type, fn, opts) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      const entry = { fn, capture: Boolean(typeof opts === 'boolean' ? opts : opts?.capture) };
      docListeners.get(type).add(entry);
      if (opts && typeof opts === 'object' && opts.signal) {
        opts.signal.addEventListener?.('abort', () => {
          docListeners.get(type)?.delete(entry);
        });
      }
    },
    dispatchEvent(ev = {}) {
      const event = {
        type: ev.type || 'click',
        target: ev.target || this.body,
        clientX: ev.clientX ?? 0,
        clientY: ev.clientY ?? 0,
        key: ev.key || '',
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {}
      };
      for (const entry of [...(docListeners.get(event.type) || [])]) {
        entry.fn(event);
      }
      return !event.defaultPrevented;
    }
  };

  document.documentElement = new MockElement('html', document);
  document.documentElement.isConnected = true;
  document.head = new MockElement('head', document);
  document.body = new MockElement('body', document);
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);
  if (dark) document.documentElement.classList.add('dark');
  else document.body.classList.add('light');

  const highlights = new Map();
  class MockHighlight {
    constructor(...ranges) { this.ranges = ranges; }
  }

  class MockMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }

  const windowObj = {
    matchMedia: q => ({ matches: q.includes('prefers-reduced-motion') ? reducedMotion : false }),
    getSelection: () => document.getSelection(),
    addEventListener(type, fn, opts) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      const entry = { fn };
      winListeners.get(type).add(entry);
      if (opts && typeof opts === 'object' && opts.signal) {
        opts.signal.addEventListener?.('abort', () => {
          winListeners.get(type)?.delete(entry);
        });
      }
    },
    dispatchEvent(ev = {}) {
      for (const entry of [...(winListeners.get(ev.type) || [])]) {
        entry.fn(ev);
      }
    }
  };

  const context = vm.createContext({
    document,
    window: windowObj,
    location: { pathname },
    AbortController,
    MutationObserver: MockMutationObserver,
    CSS: { highlights },
    Highlight: MockHighlight,
    NodeFilter: { SHOW_TEXT: 4 },
    performance: { now: () => fakeNow },
    Date: class extends Date { static now() { return fakeNow; } },
    requestAnimationFrame(cb) {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) { rafQueue.delete(id); },
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, at: fakeNow + (ms || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    queueMicrotask
  });

  vm.runInContext(opticsSource, context);

  const stepFrame = (dtMs = 16) => {
    fakeNow += dtMs;
    const dueTimers = [...timers.entries()].filter(([, t]) => t.at <= fakeNow);
    for (const [id, t] of dueTimers) {
      timers.delete(id);
      t.fn();
    }
    const batch = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of batch) cb(fakeNow);
  };

  const stepUntilIdle = (maxSteps = 250, dtMs = 16) => {
    let steps = 0;
    while (rafQueue.size > 0 && steps < maxSteps) {
      stepFrame(dtMs);
      steps++;
    }
    return steps;
  };

  return {
    context,
    document,
    window: windowObj,
    highlights,
    rafQueue,
    timers,
    docListeners,
    winListeners,
    stepFrame,
    stepUntilIdle,
    advanceTime: ms => { fakeNow += ms; }
  };
}

test('prism-optics.js obeys browser IIFE contract, zero middle dots, and zh-TW glyph compliance', () => {
  assert.equal(opticsSource.includes('\u00b7'), false, 'Must never contain middle dot (\\u00b7)');
  assert.equal(/^\s*(import|export)\s/m.test(opticsSource), false, 'Must not contain ESM import/export statements');

  const simplifiedOnly = /[万与个为义于产仅从仓们价优会传体余侧关内写准减凑凭击划则刚创删务动区协单占却历压参发变号后听启周响唤围图圆场声处备头夹实审对导将尝尽层带帮并广库应开异强归当录径忆态总战执扩扬抢护报担拦择挂换据数断无旧时昵显暂机权条来栏树样档检汇没洁浅测浏滚满点热状独环现电监盘码确碍离积称稳筛签简类紧级线组细织终结给络绝统继续缓编缩网联脑范营补装观规视览触计订认让议记许设访证识诊试话询该详语误说请读调败账费资转轮软载较辅辑输边过运这进远违连迟适选遥邮采钟钥钮链销错键长闭问闲间阅队阶际险随隐静页顶项顺顿预频题额风馈驻验骤麦标彻]/;
  const converted = toZhTw(opticsSource);
  const leftover = converted.match(simplifiedOnly);
  assert.equal(leftover, null, `Unexpected simplified glyph after toZhTw: ${leftover?.[0]}`);
});

test('all 4 optical palettes, dark/light switching, accentTone, userBubbleTint deference, and getThemeVars()', () => {
  const m = createMockEnv({ dark: true });
  const optics = m.context.__agyCreateOptics({ options: () => ({ enabled: true, themePalette: 'obsidian' }) });

  // 1. Dark obsidian
  let vars = optics.getThemeVars();
  assert.equal(vars['--background'], '#0E0E11');
  assert.equal(vars['--sidebar'], '#09090B');
  assert.equal(vars['--card'], '#141418');
  assert.equal(vars['--border'], 'rgba(218,228,255,0.07)');
  assert.equal(vars['--foreground'], '#F2F2F5');
  assert.equal(vars['--primary'], '#669DF6');
  assert.equal(m.document.documentElement.getAttribute('data-agy-optics-palette'), 'obsidian');

  // 2. Dark warm
  optics.sync({ enabled: true, themePalette: 'warm' });
  vars = optics.getThemeVars();
  assert.equal(vars['--background'], '#141413');
  assert.equal(vars['--sidebar'], '#10100F');
  assert.equal(vars['--card'], '#1B1A18');
  assert.equal(vars['--border'], 'rgba(245,240,230,0.08)');
  assert.equal(vars['--foreground'], '#F2EFE9');
  assert.equal(vars['--primary'], '#D97757');

  // 3. Light crystal
  m.document.documentElement.classList.remove('dark');
  m.document.body.classList.add('light');
  optics.sync({ enabled: true, themePalette: 'obsidian', lightThemePreset: 'crystal' });
  vars = optics.getThemeVars();
  assert.equal(vars['--background'], '#F4F7FB');
  assert.equal(vars['--sidebar'], '#E8EEF6');
  assert.equal(vars['--card'], '#FFFFFF');
  assert.equal(vars['--foreground'], '#0F172A');
  assert.equal(vars['--primary'], '#2563EB');

  // 4. Light alabaster (via preset or warm palette in light mode)
  optics.sync({ enabled: true, themePalette: 'obsidian', lightThemePreset: 'alabaster' });
  vars = optics.getThemeVars();
  assert.equal(vars['--background'], '#F6F4EE');
  assert.equal(vars['--sidebar'], '#EBE6DC');
  assert.equal(vars['--card'], '#FFFFFF');
  assert.equal(vars['--foreground'], '#1C1814');
  assert.equal(vars['--primary'], '#C25934');

  optics.sync({ enabled: true, themePalette: 'warm', lightThemePreset: 'crystal' });
  assert.equal(optics.getThemeVars()['--background'], '#F6F4EE');

  // Accent tones in light & dark
  optics.sync({ enabled: true, themePalette: 'obsidian', accentTone: 'iris' });
  assert.equal(optics.getThemeVars()['--primary'], '#7C3AED');
  m.document.documentElement.classList.add('dark');
  m.document.body.classList.remove('light');
  optics.sync({ enabled: true, themePalette: 'obsidian', accentTone: 'amber' });
  assert.equal(optics.getThemeVars()['--primary'], '#F2B84B');

  // userBubbleTint conflict deference: never override user bubble when userBubbleTint === true
  optics.sync({ enabled: true, themePalette: 'obsidian', userBubbleTint: true });
  let styleTag = m.document.head.querySelector('style[data-agy-optics-style="1"]');
  assert.equal(styleTag.textContent.includes('user-message-bubble'), false);

  optics.sync({ enabled: true, themePalette: 'obsidian', userBubbleTint: false });
  styleTag = m.document.head.querySelector('style[data-agy-optics-style="1"]');
  assert.ok(styleTag.textContent.includes(':not([data-agy-user-bubble])'));

  // Native palette leaves theme colors untouched while keeping independent toggles
  optics.sync({ enabled: true, themePalette: 'native', codeFont: 'jetbrains', cornerStyle: 'soft', sidebarCompact: true });
  assert.deepEqual({ ...optics.getThemeVars() }, {});
  assert.equal(m.document.documentElement.style.getPropertyValue('--background'), '');
  styleTag = m.document.head.querySelector('style[data-agy-optics-style="1"]');
  assert.ok(styleTag.textContent.includes('JetBrains Mono'));
  assert.ok(styleTag.textContent.includes('16px'));
  assert.ok(styleTag.textContent.includes('26px'));

  // Fast hot update < 10ms
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) {
    optics.sync({ enabled: true, themePalette: i % 2 ? 'obsidian' : 'warm' });
  }
  const avgMs = (performance.now() - t0) / 10;
  assert.ok(avgMs < 10, `Expected hot sync < 10ms, got ${avgMs.toFixed(2)}ms`);

  optics.dispose();
});

test('sidebarNavFold folds automations/customizations while keeping /powertools visible, plus studio placeholder & logoInk', () => {
  const m = createMockEnv({ dark: true });
  const nav = m.document.createElement('div');
  nav.setAttribute('data-testid', 'sidebar-navigation-items');
  const newChat = m.document.createElement('button');
  newChat.setAttribute('data-testid', 'new-conversation-btn');
  const automations = m.document.createElement('a');
  automations.setAttribute('href', '/automations');
  const customizations = m.document.createElement('a');
  customizations.setAttribute('href', '/customizations');
  const powertools = m.document.createElement('a');
  powertools.setAttribute('href', '/powertools');
  nav.append(newChat, automations, customizations, powertools);
  m.document.body.appendChild(nav);

  const card = m.document.createElement('div');
  card.className = 'surface-composer-card';
  const input = m.document.createElement('div');
  input.setAttribute('contenteditable', 'true');
  input.setAttribute('data-placeholder', 'Original placeholder');
  card.appendChild(input);
  m.document.body.appendChild(card);

  const greeting = m.document.createElement('div');
  greeting.setAttribute('data-testid', 'home-greeting');
  const logoSvg = m.document.createElement('svg');
  greeting.appendChild(logoSvg);
  m.document.body.appendChild(greeting);

  const optics = m.context.__agyCreateOptics({
    options: () => ({
      enabled: true,
      themePalette: 'obsidian',
      sidebarNavFold: true,
      placeholderStyle: 'studio',
      logoInk: 'foreground'
    }),
    uiText: zh => zh
  });

  assert.equal(automations.getAttribute('data-agy-nav-folded'), 'true');
  assert.equal(customizations.getAttribute('data-agy-nav-folded'), 'true');
  assert.equal(powertools.hasAttribute('data-agy-nav-folded'), false);
  const foldBtn = nav.querySelector('[data-testid="agy-nav-fold-toggle"]');
  assert.ok(foldBtn);
  assert.equal(foldBtn.textContent, '更多');

  foldBtn.dispatchEvent({ type: 'click', target: foldBtn });
  assert.equal(automations.hasAttribute('data-agy-nav-folded'), false);
  assert.equal(foldBtn.textContent, '收起');

  assert.notEqual(input.getAttribute('data-placeholder'), 'Original placeholder');
  assert.equal(m.document.documentElement.getAttribute('data-agy-logo-ink'), 'foreground');

  optics.dispose();
  assert.equal(input.getAttribute('data-placeholder'), 'Original placeholder');
  assert.equal(nav.querySelector('[data-testid="agy-nav-fold-toggle"]'), null);
  assert.equal(automations.hasAttribute('data-agy-nav-folded'), false);
});

test('createVialPhysics wave slosh, streaming droplets/bubbles, and 0fps idle convergence', () => {
  const m = createMockEnv();
  const vial = m.context.__agyCreateVialPhysics({ fill: 0.65, streaming: false, nodeCount: 20 });
  assert.equal(vial.getState().nodeCount, 20);
  assert.equal(vial.getState().sleeping, true);

  // Slosh wakes physics and produces non-zero wave displacements
  vial.slosh(0.8, 0.5);
  const firstStep = vial.step(16);
  assert.equal(firstStep.sleeping, false);
  assert.ok(firstStep.heights.some(h => Math.abs(h) > 0.001));

  // Stepping until converged reaches 0fps sleep cleanly
  let settled = false;
  for (let i = 0; i < 300; i++) {
    const res = vial.step(16);
    if (res.sleeping) { settled = true; break; }
  }
  assert.equal(settled, true, 'Vial physics must settle to sleeping (0fps)');
  assert.equal(vial.getState().energy, 0);

  // Streaming spawns falling droplets and rising bubbles, keeping awake until streaming stops
  vial.setStreaming(true);
  let sawDroplet = false;
  let sawBubble = false;
  for (let i = 0; i < 40; i++) {
    const res = vial.step(16);
    if (res.droplets.length > 0) sawDroplet = true;
    if (res.bubbles.length > 0) sawBubble = true;
  }
  assert.ok(sawDroplet, 'Streaming mode should spawn droplets');
  assert.ok(sawBubble, 'Streaming mode should spawn micro-bubbles');
  assert.equal(vial.getState().sleeping, false);

  vial.setStreaming(false);
  let reSettled = false;
  for (let i = 0; i < 400; i++) {
    if (vial.step(16).sleeping) { reSettled = true; break; }
  }
  assert.equal(reSettled, true, 'Vial should return to 0fps sleep after streaming stops');
});

test('renderTriggerVialSvg and mountPopoverVial UI integration + /compact button threshold', () => {
  const m = createMockEnv();
  const trigger = m.document.createElement('button');
  trigger.setAttribute('data-testid', 'agy-context-ring-trigger');
  const origSvg = m.document.createElement('svg');
  trigger.appendChild(origSvg);
  m.document.body.appendChild(trigger);

  const inserted = [];
  const optics = m.context.__agyCreateOptics({
    options: () => ({ enabled: true, contextStyle: 'vial' }),
    state: () => ({ contextWindow: { usedPercent: 84 } }),
    onInsertText: text => inserted.push(text),
    uiText: zh => zh
  });

  assert.equal(trigger.getAttribute('data-testid'), 'agy-context-ring-trigger');
  assert.ok(trigger.querySelector('[data-testid="agy-trigger-vial-svg"]'));
  assert.equal(origSvg.style.props.get('display') || origSvg.style.display, 'none');

  const container = m.document.createElement('div');
  m.document.body.appendChild(container);
  const pop = optics.mountPopoverVial(container, {
    usedTokens: 300000,
    maxTokens: 512000,
    percent: 58,
    streaming: true,
    systemTokens: 50000,
    messageTokens: 200000,
    toolTokens: 50000,
    tps: 72.5,
    ttftMs: 420
  });

  const canvas = container.querySelector('[data-testid="agy-popover-vial-canvas"]');
  assert.equal(canvas.width, 96);
  assert.equal(canvas.height, 200);
  assert.ok(container.querySelector('[data-testid="agy-vial-slice-system"]').textContent.includes('系统与规则'));
  assert.ok(container.querySelector('[data-testid="agy-vial-slice-messages"]').textContent.includes('对话消息'));
  assert.ok(container.querySelector('[data-testid="agy-vial-slice-tools"]').textContent.includes('工具输出'));
  assert.equal(container.querySelector('[data-testid="agy-vial-compact-btn"]'), null, '< 80% hides compact btn');

  pop.update({ percent: 86, usedTokens: 440000, streaming: false });
  const compactBtn = container.querySelector('[data-testid="agy-vial-compact-btn"]');
  assert.ok(compactBtn, '>= 80% shows compact button');
  compactBtn.dispatchEvent({ type: 'click', target: compactBtn });
  assert.deepEqual(inserted, ['/compact']);

  // Drag slosh wakes and settles to 0fps
  canvas.dispatchEvent({ type: 'pointerdown', clientX: 20, clientY: 50, target: canvas });
  canvas.dispatchEvent({ type: 'pointermove', clientX: 55, clientY: 55, target: canvas });
  canvas.dispatchEvent({ type: 'pointerup', target: canvas });
  assert.equal(pop.physics.getState().sleeping, false);
  m.stepUntilIdle(300, 16);
  assert.equal(pop.physics.getState().sleeping, true);

  optics.dispose();
  assert.equal(trigger.querySelector('[data-testid="agy-trigger-vial-svg"]'), null);
});

test('interactive pixel companions: pack roster, 5-stack tower, rainbow aurora easter egg, peek auto-yield, and 0fps sleep', () => {
  const m = createMockEnv();
  const card = m.document.createElement('div');
  card.className = 'surface-composer-card';
  const modelTrigger = m.document.createElement('button');
  modelTrigger.setAttribute('data-testid', 'model-selector-trigger');
  card.appendChild(modelTrigger);
  m.document.body.appendChild(card);

  const optics = m.context.__agyCreateOptics({
    options: () => ({ enabled: true, mascotMode: 'pack' })
  });

  const stage = card.querySelector('[data-testid="agy-mascot-stage"]');
  assert.ok(stage);
  assert.equal(stage.querySelectorAll('[data-testid="agy-mascot-item"]').length, 5);

  // Stack all 5 companions into a tower -> triggers rainbow aurora
  optics.stackCompanion('mystic-cat', 'clawd');
  optics.stackCompanion('mini-crab-1', 'clawd');
  optics.stackCompanion('mini-crab-2', 'clawd');
  optics.stackCompanion('mini-crab-3', 'clawd');
  assert.equal(stage.getAttribute('data-aurora'), 'true');
  assert.equal(optics.getDebugState().mascot.maxStack, 5);

  // Conflict resolution: .agy-goal-bar or [role="listbox"] switches stage to peek mode
  const goalBar = m.document.createElement('div');
  goalBar.className = 'agy-goal-bar';
  m.document.body.appendChild(goalBar);
  assert.equal(stage.getAttribute('data-peek'), 'true');
  goalBar.remove();
  assert.equal(stage.getAttribute('data-peek'), 'false');

  const menu = m.document.createElement('div');
  menu.setAttribute('role', 'menu');
  m.document.body.appendChild(menu);
  assert.equal(stage.getAttribute('data-peek'), 'true');
  menu.remove();
  assert.equal(stage.getAttribute('data-peek'), 'false');

  // Settles and sleeps at 0fps after aurora (~1.8s) + 2s idle
  m.stepUntilIdle(350, 20);
  assert.equal(stage.getAttribute('data-sleeping'), 'true');
  assert.equal(optics.getDebugState().rafActive, false);
  assert.equal(optics.getDebugState().activeTaskCount, 0);

  optics.dispose();
});

test('motion choreography: streamInk CSS.highlights, convAura, smoothCaret, scrollBottom, prismRim, homeRipple, wallpaper Browser-Hole deference & complete dispose()', async () => {
  const m = createMockEnv({ pathname: '/' });

  // Home greeting + composer + conversation view
  const homeHost = m.document.createElement('div');
  const greeting = m.document.createElement('div');
  greeting.setAttribute('data-testid', 'home-greeting');
  homeHost.appendChild(greeting);
  m.document.body.appendChild(homeHost);

  const convView = m.document.createElement('div');
  convView.setAttribute('data-testid', 'conversation-view');
  const viewport = m.document.createElement('div');
  viewport.setAttribute('data-testid', 'autoscroll-viewport');
  viewport.scrollTop = 0;
  viewport.scrollHeight = 1200;
  viewport.clientHeight = 400;
  const scrollBtn = m.document.createElement('button');
  scrollBtn.setAttribute('data-testid', 'scroll-to-bottom-btn');
  convView.append(viewport, scrollBtn);

  const response = m.document.createElement('div');
  response.setAttribute('data-testid', 'agent-response');
  const textNode = m.document.createTextNode('Hello streaming ');
  response.childNodes.push(textNode);
  textNode.parentElement = response;
  convView.appendChild(response);
  m.document.body.appendChild(convView);

  const card = m.document.createElement('div');
  card.className = 'surface-composer-card';
  const editable = m.document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  card.appendChild(editable);
  m.document.body.appendChild(card);

  const optics = m.context.__agyCreateOptics({
    options: () => ({
      enabled: true,
      motionLevel: 'ultra',
      targetFps: 120,
      smoothCaret: true,
      scrollBottomMotion: 'smooth',
      streamInk: true,
      convAura: true,
      prismRim: true,
      homeRipple: true,
      wallpaperEnabled: true,
      wallpaperOpacity: 30,
      wallpaperBlur: 12,
      wallpaperDim: 40
    }),
    request: async method => {
      if (method === 'wallpaper.status') {
        return { ok: true, hasMedia: true, kind: 'video', fileName: 'bg.mp4', mediaUrl: 'http://127.0.0.1:9999/bg.mp4' };
      }
      return { ok: true };
    }
  });

  // Allow cross-realm wallpaper async fetch to resolve
  await new Promise(r => setImmediate(r));

  // Wallpaper mounted & Browser-Hole deference
  const wpLayer = m.document.querySelector('[data-testid="agy-wallpaper-layer"]');
  const wpVideo = wpLayer?.querySelector('video');
  assert.ok(wpLayer);
  assert.ok(wpVideo);
  assert.equal(wpVideo.style.props.get('opacity'), '0.3');
  assert.equal(wpVideo.style.props.get('filter'), 'blur(12px)');

  m.document.body.setAttribute('data-has-browser-hole', 'true');
  assert.equal(wpLayer.getAttribute('data-hidden-browser-hole'), 'true');
  assert.equal(wpVideo.paused, true);
  m.document.body.removeAttribute('data-has-browser-hole');
  assert.equal(wpVideo.paused, false);

  // Hidden/blur pauses video (0fps)
  m.document.hidden = true;
  m.document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(wpVideo.paused, true);
  m.document.hidden = false;
  m.document.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(wpVideo.paused, false);

  // Home ripple wave settles to 0fps in ~1.2s and unmounts on /c/*
  const rippleCanvas = m.document.querySelector('[data-testid="agy-home-ripple-canvas"]');
  assert.ok(rippleCanvas);
  m.document.dispatchEvent({ type: 'click', target: m.document.body, clientX: 100, clientY: 100 });
  assert.equal(optics.getDebugState().rafActive, true);
  m.stepUntilIdle(120, 20);
  assert.equal(optics.getDebugState().rafActive, false);
  assert.equal(rippleCanvas.width, 0);

  m.context.location.pathname = '/c/conv-123';
  optics.sync();
  assert.equal(m.document.querySelector('[data-testid="agy-home-ripple-canvas"]'), null);

  // convAura 3-state reflection
  optics.sync(undefined, 'waiting');
  assert.equal(convView.getAttribute('data-agy-conv-aura'), 'waiting');
  optics.sync(undefined, { error: 'boom' });
  assert.equal(convView.getAttribute('data-agy-conv-aura'), 'error');
  optics.sync(undefined, { status: 1, background: true });
  assert.equal(convView.getAttribute('data-agy-conv-aura'), 'done-bg');

  // streamInk CSS.highlights without DOM splitting, progressing stages and settling within 900ms after stop
  optics.sync(undefined, { status: 2, streaming: true });
  assert.ok(m.highlights.has('agy-ink-1'));
  m.stepFrame(200);
  assert.ok(m.highlights.has('agy-ink-2'));
  textNode.nodeValue += 'more words';
  optics.sync(undefined, { status: 2, streaming: true });
  optics.sync(undefined, { status: 1, streaming: false });
  m.stepUntilIdle(100, 20);
  assert.equal(m.highlights.size, 0);
  assert.equal(optics.getDebugState().rafActive, false);

  // smoothCaret glides and fades out after 600ms idle (0fps)
  m.document.dispatchEvent({ type: 'input', target: editable });
  const caretEl = m.document.querySelector('[data-testid="agy-smooth-caret"]');
  assert.ok(caretEl);
  m.stepUntilIdle(100, 20);
  assert.equal(caretEl.style.opacity, '0');
  assert.equal(optics.getDebugState().rafActive, false);

  // scrollBottomMotion smooth glide completes cleanly and also cancels on wheel
  scrollBtn.dispatchEvent({ type: 'click', target: scrollBtn });
  m.stepFrame(40);
  assert.ok(viewport.scrollTop > 0 && viewport.scrollTop < 800);
  m.document.dispatchEvent({ type: 'wheel', target: viewport });
  assert.equal(optics.getDebugState().rafActive, false);

  viewport.scrollTop = 0;
  scrollBtn.dispatchEvent({ type: 'click', target: scrollBtn });
  m.stepUntilIdle(40, 20);
  assert.equal(viewport.scrollTop, 800);
  assert.equal(optics.getDebugState().rafActive, false);

  // prismRim radial variables & pointerleave cleanup
  m.document.dispatchEvent({ type: 'pointermove', target: editable, clientX: 60, clientY: 80 });
  await Promise.resolve();
  assert.equal(card.getAttribute('data-agy-rim-active'), '1');
  assert.equal(card.style.getPropertyValue('--agy-rim-x'), '50px');
  assert.equal(card.style.getPropertyValue('--agy-rim-y'), '60px');
  m.document.dispatchEvent({ type: 'pointerleave', target: card });
  assert.equal(card.hasAttribute('data-agy-rim-active'), false);

  // Full dispose() removes everything cleanly
  optics.dispose();
  assert.equal(optics.getDebugState().disposed, true);
  assert.equal(optics.getDebugState().rafActive, false);
  assert.equal(m.document.head.querySelector('style[data-agy-optics-style="1"]'), null);
  assert.equal(m.document.querySelector('[data-agy-optics-el]'), null);
  assert.equal(convView.hasAttribute('data-agy-conv-aura'), false);
  assert.equal(m.document.documentElement.hasAttribute('data-agy-optics-palette'), false);
  assert.equal(m.highlights.size, 0);
});

test('prefers-reduced-motion, targetFps cap, crab/cat mascot modes, and petting aurora', () => {
  const m = createMockEnv({ reducedMotion: true });
  const card = m.document.createElement('div');
  card.className = 'surface-composer-card';
  const greeting = m.document.createElement('div');
  greeting.setAttribute('data-testid', 'home-greeting');
  m.document.body.append(card, greeting);

  const opticsReduced = m.context.__agyCreateOptics({
    options: () => ({ enabled: true, motionLevel: 'ultra', homeRipple: true, smoothCaret: true })
  });
  assert.equal(m.document.querySelector('[data-testid="agy-home-ripple-canvas"]'), null);
  assert.equal(opticsReduced.getDebugState().rafActive, false);
  opticsReduced.dispose();

  const m2 = createMockEnv({ reducedMotion: false });
  const card2 = m2.document.createElement('div');
  card2.className = 'surface-composer-card';
  m2.document.body.appendChild(card2);

  const optics2 = m2.context.__agyCreateOptics({
    options: () => ({ enabled: true, mascotMode: 'crab', targetFps: 60 })
  });
  assert.equal(card2.querySelectorAll('[data-testid="agy-mascot-item"]').length, 1);
  assert.equal(card2.querySelector('[data-mascot-id="clawd"]').getAttribute('data-mascot-kind'), 'crab');

  optics2.sync({ enabled: true, mascotMode: 'cat', targetFps: 60 });
  assert.equal(card2.querySelectorAll('[data-testid="agy-mascot-item"]').length, 1);
  assert.equal(card2.querySelector('[data-mascot-id="mystic-cat"]').getAttribute('data-mascot-kind'), 'cat');

  // Petting 3 times triggers rainbow aurora easter egg
  optics2.petCompanion('mystic-cat');
  optics2.petCompanion('mystic-cat');
  optics2.petCompanion('mystic-cat');
  assert.equal(card2.querySelector('[data-testid="agy-mascot-stage"]').getAttribute('data-aurora'), 'true');
  m2.stepUntilIdle(350, 20);
  assert.equal(card2.querySelector('[data-testid="agy-mascot-stage"]').getAttribute('data-sleeping'), 'true');
  assert.equal(optics2.getDebugState().rafActive, false);

  optics2.dispose();
  assert.equal(card2.style.getPropertyValue('position'), '');
});

test('standalone mountPopoverVial, hidden peek deference, image wallpaper, and targetFps throttling', async () => {
  const m = createMockEnv();
  m.context.__agyToZhTw = toZhTw;

  // Standalone mountPopoverVial without optics instance
  const host = m.document.createElement('div');
  m.document.body.appendChild(host);
  const inserted = [];
  const standaloneVial = m.context.__agyCreateOptics.mountPopoverVial(host, {
    percent: 88,
    usedTokens: 450000,
    maxTokens: 512000,
    language: 'zh-TW',
    onInsertText: text => inserted.push(text)
  });
  assert.ok(host.querySelector('[data-testid="agy-vial-slice-system"]').textContent.includes('系統與規則'));
  assert.ok(host.querySelector('[data-testid="agy-vial-slice-messages"]').textContent.includes('對話訊息'));
  assert.ok(host.querySelector('[data-testid="agy-vial-slice-tools"]').textContent.includes('工具輸出'));
  const compact = host.querySelector('[data-testid="agy-vial-compact-btn"]');
  compact.dispatchEvent({ type: 'click', target: compact });
  assert.deepEqual(inserted, ['/compact']);
  standaloneVial.unmount();

  // Hidden [role="dialog"] should NOT trigger peek mode, and targetFps: 60 throttles <15ms frames
  const hiddenDialog = m.document.createElement('div');
  hiddenDialog.setAttribute('role', 'dialog');
  hiddenDialog.setAttribute('aria-hidden', 'true');
  const card = m.document.createElement('div');
  card.className = 'surface-composer-card';
  const convView = m.document.createElement('div');
  convView.setAttribute('data-testid', 'conversation-view');
  const vp = m.document.createElement('div');
  vp.setAttribute('data-testid', 'autoscroll-viewport');
  vp.scrollTop = 0;
  vp.scrollHeight = 1200;
  vp.clientHeight = 400;
  const scrollBtn = m.document.createElement('button');
  scrollBtn.setAttribute('data-testid', 'scroll-to-bottom-btn');
  convView.append(vp, scrollBtn);
  m.document.body.append(hiddenDialog, card, convView);

  const optics = m.context.__agyCreateOptics({
    options: () => ({
      enabled: true,
      motionLevel: 'standard',
      targetFps: 60,
      scrollBottomMotion: 'smooth',
      mascotMode: 'crab',
      wallpaperEnabled: true
    }),
    request: async () => ({ ok: true, hasMedia: true, kind: 'image', fileName: 'wall.png', mediaUrl: 'http://127.0.0.1:9999/wall.png' })
  });
  await new Promise(r => setImmediate(r));

  assert.ok(m.document.querySelector('[data-testid="agy-wallpaper-layer"] img'));
  assert.equal(card.querySelector('[data-testid="agy-mascot-stage"]').getAttribute('data-peek'), 'false');

  // Scroll glide capped at 60fps: 1st step runs, 4ms later is skipped, 16ms later advances
  scrollBtn.dispatchEvent({ type: 'click', target: scrollBtn });
  m.stepFrame(16);
  const afterFirst = vp.scrollTop;
  assert.ok(afterFirst > 0);
  m.stepFrame(4);
  assert.equal(vp.scrollTop, afterFirst);
  m.stepFrame(16);
  assert.ok(vp.scrollTop > afterFirst);

  optics.dispose();
});
