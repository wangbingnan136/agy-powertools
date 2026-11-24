(() => {
  const DEFAULT_OPTS = {
    enabled: true,
    themePalette: 'native',
    lightThemePreset: 'crystal',
    accentTone: 'follow',
    cornerStyle: 'balanced',
    codeFont: 'default',
    codeLigatures: false,
    ambientIntensity: 70,
    sidebarCompact: false,
    sidebarNavFold: false,
    composerRestyle: false,
    placeholderStyle: 'native',
    logoInk: 'accent',
    userBubbleTint: false,
    compact: true,
    motionLevel: 'off',
    targetFps: 120,
    contextStyle: 'ring',
    smoothCaret: false,
    scrollBottomMotion: 'native',
    streamInk: false,
    convAura: false,
    prismRim: false,
    homeRipple: false,
    mascotMode: 'off',
    wallpaperEnabled: false,
    wallpaperOpacity: 22,
    wallpaperBlur: 8,
    wallpaperDim: 35,
    language: 'zh-CN'
  };

  const PALETTES = {
    obsidian: {
      '--background': '#0E0E11',
      '--sidebar': '#09090B',
      '--card': '#141418',
      '--border': 'rgba(218,228,255,0.07)',
      '--foreground': '#F2F2F5',
      '--primary': '#669DF6',
      '--secondary': '#1B1B21',
      '--secondary-foreground': '#D7DBE6',
      '--muted': '#1A1A20',
      '--muted-foreground': '#9DA3B4',
      '--primary-foreground': '#09090B'
    },
    warm: {
      '--background': '#141413',
      '--sidebar': '#10100F',
      '--card': '#1B1A18',
      '--border': 'rgba(245,240,230,0.08)',
      '--foreground': '#F2EFE9',
      '--primary': '#D97757',
      '--secondary': '#242220',
      '--secondary-foreground': '#DED8CE',
      '--muted': '#22201E',
      '--muted-foreground': '#A8A095',
      '--primary-foreground': '#FFFFFF'
    },
    crystal: {
      '--background': '#F4F7FB',
      '--sidebar': '#E8EEF6',
      '--card': '#FFFFFF',
      '--border': 'rgba(15,23,42,0.09)',
      '--foreground': '#0F172A',
      '--primary': '#2563EB',
      '--secondary': '#E2E8F0',
      '--secondary-foreground': '#1E293B',
      '--muted': '#EDF2F7',
      '--muted-foreground': '#475569',
      '--primary-foreground': '#FFFFFF'
    },
    alabaster: {
      '--background': '#F6F4EE',
      '--sidebar': '#EBE6DC',
      '--card': '#FFFFFF',
      '--border': 'rgba(28,24,20,0.09)',
      '--foreground': '#1C1814',
      '--primary': '#C25934',
      '--secondary': '#E5DFD3',
      '--secondary-foreground': '#2E2821',
      '--muted': '#EFECE4',
      '--muted-foreground': '#665E54',
      '--primary-foreground': '#FFFFFF'
    }
  };

  const ACCENT_TONES = {
    cobalt: { dark: '#669DF6', light: '#2563EB' },
    iris: { dark: '#A58AF8', light: '#7C3AED' },
    amber: { dark: '#F2B84B', light: '#D97706' },
    mono: { dark: '#D4D7E0', light: '#334155' }
  };

  const CODE_FONTS = {
    jetbrains: '"JetBrains Mono", ui-monospace, monospace',
    sfmono: '"SF Mono", Consolas, ui-monospace, monospace',
    fira: '"Fira Code", ui-monospace, monospace'
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIAL_NODE_MIN = 16;
  const VIAL_NODE_MAX = 24;
  const RIPPLE_CHARS = ['.', ':', '+', '*', 'o', '#'];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
  const asElement = node => (node && node.nodeType === 3 ? node.parentElement : node);
  const setInlineStyle = (el, prop, val) => {
    if (!el?.style) return;
    if (typeof el.style.setProperty === 'function') {
      if (val == null || val === '') el.style.removeProperty?.(prop);
      else el.style.setProperty(prop, String(val));
    } else {
      el.style[prop] = val == null ? '' : String(val);
    }
  };

  const formatTokens = n => {
    if (n == null || !Number.isFinite(Number(n))) return '-';
    const v = Number(n);
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(Math.round(v));
  };

  function hasClass(el, className) {
    if (!el) return false;
    if (el.classList && typeof el.classList.contains === 'function') {
      return el.classList.contains(className);
    }
    const raw = typeof el.className === 'string' ? el.className : '';
    return raw.split(/\s+/).includes(className);
  }

  function matchesAnyClass(el, classes) {
    if (!el) return false;
    for (let i = 0; i < classes.length; i++) {
      if (hasClass(el, classes[i])) return true;
    }
    return false;
  }

  function detectDarkMode(doc) {
    if (!doc) return true;
    const html = doc.documentElement;
    const body = doc.body;
    if (hasClass(html, 'dark')) return true;
    const bodyLight = Boolean(
      (body && typeof body.matches === 'function' && body.matches('.light,.theme-light,.light-theme'))
      || matchesAnyClass(body, ['light', 'theme-light', 'light-theme'])
    );
    const htmlLight = matchesAnyClass(html, ['light', 'theme-light', 'light-theme']);
    if (bodyLight || htmlLight) return false;
    return true;
  }

  function resolvePaletteKey(opts, isDark) {
    if (!opts || opts.enabled === false) return 'native';
    if (opts.themePalette !== 'obsidian' && opts.themePalette !== 'warm') return 'native';
    if (isDark) return opts.themePalette;
    if (opts.lightThemePreset === 'alabaster' || opts.themePalette === 'warm') return 'alabaster';
    return 'crystal';
  }

  function computeThemeVars(opts, isDark) {
    const paletteKey = resolvePaletteKey(opts, isDark);
    if (paletteKey === 'native') return {};
    const vars = { ...PALETTES[paletteKey] };
    const tone = ACCENT_TONES[opts.accentTone];
    if (tone) {
      const accent = isDark ? tone.dark : tone.light;
      vars['--primary'] = accent;
      vars['--agy-accent'] = accent;
      if (opts.accentTone === 'mono' && isDark) {
        vars['--primary-foreground'] = '#0E0E11';
      }
    } else {
      vars['--agy-accent'] = vars['--primary'];
    }
    return vars;
  }

  function createSvgEl(doc, tag, attrs = {}) {
    const el = typeof doc.createElementNS === 'function'
      ? doc.createElementNS(SVG_NS, tag)
      : doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null && typeof el.setAttribute === 'function') {
        el.setAttribute(k, String(v));
      }
    }
    return el;
  }

  function createVialPhysics(init = {}) {
    const rawFill = Number.isFinite(init.fill) ? init.fill : 0.5;
    const initialFill = clamp(rawFill > 1 ? rawFill / 100 : rawFill, 0, 1);
    const nodeCount = clamp(Math.round(Number(init.nodeCount) || 20), VIAL_NODE_MIN, VIAL_NODE_MAX);
    const heights = new Float64Array(nodeCount);
    const velocities = new Float64Array(nodeCount);
    const nextHeights = new Float64Array(nodeCount);

    let fill = initialFill;
    let targetFill = initialFill;
    let tilt = 0;
    let tiltVelocity = 0;
    let streaming = Boolean(init.streaming);
    let idleMs = 0;
    let sleeping = !streaming;
    let energy = 0;
    let dropClockMs = 0;
    let bubbleClockMs = 0;
    let seed = 1337;
    const droplets = [];
    const bubbles = [];

    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const wake = () => {
      idleMs = 0;
      sleeping = false;
    };

    const impulseAt = (normX = 0.5, strength = 0.25) => {
      const cx = clamp(Number(normX) || 0.5, 0, 1) * (nodeCount - 1);
      const amp = clamp(Number(strength) || 0, -1.5, 1.5);
      for (let i = 0; i < nodeCount; i++) {
        const dist = Math.abs(i - cx);
        if (dist < 3.5) {
          const weight = 1 - dist / 3.5;
          velocities[i] += amp * weight * 1.8;
        }
      }
      wake();
    };

    const slosh = (impulse = 0.4, tiltDelta = 0.25) => {
      const imp = clamp(Number(impulse) || 0, -2, 2);
      const td = clamp(Number(tiltDelta) || 0, -1.2, 1.2);
      tilt = clamp(tilt + td, -1, 1);
      tiltVelocity += td * 2.5;
      const mid = (nodeCount - 1) / 2;
      for (let i = 0; i < nodeCount; i++) {
        const lever = (i - mid) / Math.max(1, mid);
        velocities[i] += lever * imp * 2.2;
      }
      wake();
    };

    const drag = (dx = 0, dy = 0) => {
      const nx = clamp(Number(dx) || 0, -60, 60) / 48;
      const ny = clamp(Number(dy) || 0, -60, 60) / 60;
      slosh(nx * 0.65, nx * 0.45);
      if (Math.abs(ny) > 0.02) {
        impulseAt(0.5, ny * 0.35);
      }
    };

    const setFill = next => {
      const num = Number(next);
      if (!Number.isFinite(num)) return;
      const norm = clamp(num > 1 ? num / 100 : num, 0, 1);
      if (Math.abs(norm - targetFill) > 1e-4) {
        targetFill = norm;
        wake();
      }
    };

    const setStreaming = next => {
      const flag = Boolean(next);
      if (flag !== streaming) {
        streaming = flag;
        if (streaming) wake();
      }
    };

    const step = (dtMs = 16) => {
      const clampedMs = clamp(Number(dtMs) || 16, 1, 64);
      const dt = clampedMs / 1000;

      if (sleeping && !streaming && Math.abs(targetFill - fill) < 1e-4) {
        return {
          sleeping: true,
          energy: 0,
          fill,
          tilt: 0,
          heights: Array.from(heights),
          droplets: [],
          bubbles: []
        };
      }

      fill += (targetFill - fill) * Math.min(1, dt * 8);

      const tiltStiff = 28;
      const tiltDamp = 6.5;
      const tiltAcc = -tiltStiff * tilt - tiltDamp * tiltVelocity;
      tiltVelocity += tiltAcc * dt;
      tilt = clamp(tilt + tiltVelocity * dt, -1, 1);

      const stiffness = 42;
      const damping = 5.2;
      const spread = 28;
      const mid = (nodeCount - 1) / 2;

      for (let i = 0; i < nodeCount; i++) {
        const left = i > 0 ? heights[i - 1] : heights[i];
        const right = i < nodeCount - 1 ? heights[i + 1] : heights[i];
        const neighborForce = spread * (left + right - 2 * heights[i]);
        const tiltForce = tilt * ((i - mid) / Math.max(1, mid)) * 6.0;
        const acc = -stiffness * heights[i] - damping * velocities[i] + neighborForce + tiltForce;
        velocities[i] += acc * dt;
        nextHeights[i] = clamp(heights[i] + velocities[i] * dt, -0.35, 0.35);
      }

      for (let i = 0; i < nodeCount; i++) {
        heights[i] = nextHeights[i];
      }

      const surfaceY = 1 - fill;

      if (streaming) {
        dropClockMs += clampedMs;
        bubbleClockMs += clampedMs;
        if (dropClockMs >= 260 && droplets.length < 4 && surfaceY > 0.14) {
          dropClockMs = 0;
          droplets.push({
            x: 0.25 + nextRand() * 0.5,
            y: 0.04,
            vy: 0.25 + nextRand() * 0.2,
            radius: 1.6 + nextRand() * 1.1
          });
        }
        if (bubbleClockMs >= 210 && bubbles.length < 7 && fill > 0.08) {
          bubbleClockMs = 0;
          bubbles.push({
            x: 0.18 + nextRand() * 0.64,
            y: 0.96,
            vy: -(0.22 + nextRand() * 0.22),
            phase: nextRand() * Math.PI * 2,
            radius: 1.1 + nextRand() * 1.4,
            alpha: 0.45 + nextRand() * 0.35
          });
        }
      }

      for (let i = droplets.length - 1; i >= 0; i--) {
        const d = droplets[i];
        d.vy += 1.9 * dt;
        d.y += d.vy * dt;
        if (d.y >= surfaceY) {
          impulseAt(d.x, 0.12);
          droplets.splice(i, 1);
        }
      }

      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.phase += dt * 5;
        b.y += b.vy * dt;
        b.x = clamp(b.x + Math.sin(b.phase) * 0.03 * dt, 0.12, 0.88);
        if (b.y <= surfaceY + 0.01 || fill <= 0.02) {
          bubbles.splice(i, 1);
        }
      }

      let totalE = Math.abs(tilt) + Math.abs(tiltVelocity) * 0.2 + Math.abs(targetFill - fill) * 4;
      for (let i = 0; i < nodeCount; i++) {
        totalE += Math.abs(heights[i]) + Math.abs(velocities[i]) * 0.25;
      }
      totalE += (droplets.length + bubbles.length) * 0.15;
      energy = totalE;

      if (!streaming && energy < 0.025) {
        idleMs += clampedMs;
        if (idleMs >= 1100) {
          for (let i = 0; i < nodeCount; i++) {
            heights[i] = 0;
            velocities[i] = 0;
          }
          tilt = 0;
          tiltVelocity = 0;
          fill = targetFill;
          energy = 0;
          sleeping = true;
        }
      } else {
        idleMs = 0;
        sleeping = false;
      }

      return {
        sleeping,
        energy,
        fill,
        tilt,
        heights: Array.from(heights),
        droplets: droplets.map(d => ({ ...d })),
        bubbles: bubbles.map(b => ({ ...b }))
      };
    };

    const getState = () => ({
      fill,
      targetFill,
      tilt,
      tiltVelocity,
      streaming,
      sleeping,
      idleMs,
      energy,
      nodeCount,
      heights: Array.from(heights),
      droplets: droplets.map(d => ({ ...d })),
      bubbles: bubbles.map(b => ({ ...b }))
    });

    return {
      step,
      slosh,
      drag,
      impulseAt,
      setFill,
      setStreaming,
      getState
    };
  }

  function renderTriggerVialSvg({ percent = 0, streaming = false } = {}) {
    const pct = clamp(Number.isFinite(Number(percent)) ? Number(percent) : 0, 0, 100);
    const toneColor = pct >= 95 ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#38BDF8';
    const glowColor = pct >= 95 ? 'rgba(239,68,68,0.45)' : pct >= 80 ? 'rgba(245,158,11,0.45)' : 'rgba(56,189,248,0.45)';
    const innerTop = 3.5;
    const innerHeight = 10.5;
    const fillHeight = Number(((pct / 100) * innerHeight).toFixed(2));
    const fillY = Number((innerTop + innerHeight - fillHeight).toFixed(2));
    const clipId = `agy-vial-clip-${Math.round(pct)}`;
    const streamingDot = streaming
      ? `<circle cx="8" cy="4.2" r="0.85" fill="${toneColor}" opacity="0.95" />`
      : '';
    const markup = [
      `<svg xmlns="${SVG_NS}" width="16" height="16" viewBox="0 0 16 16" fill="none" data-testid="agy-trigger-vial-svg" style="filter:drop-shadow(0 0 2px ${glowColor})">`,
      `<defs><clipPath id="${clipId}"><rect x="5" y="3.5" width="6" height="10.5" rx="3" /></clipPath></defs>`,
      `<path d="M5.5 2h5M6 2v1.8a2.5 2.5 0 0 0-1 2v5.7a3 3 0 0 0 6 0V5.8a2.5 2.5 0 0 0-1-2V2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.88" />`,
      `<g clip-path="url(#${clipId})">`,
      fillHeight > 0 ? `<rect x="4.5" y="${fillY}" width="7" height="${fillHeight + 1}" fill="${toneColor}" opacity="0.86" />` : '',
      fillHeight > 0 ? `<path d="M4.5 ${fillY} Q 8 ${Math.max(2.5, fillY - 0.8)} 11.5 ${fillY}" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="0.7" fill="none" />` : '',
      `</g>`,
      streamingDot,
      `</svg>`
    ].join('');

    return {
      tag: 'svg',
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      percent: pct,
      streaming: Boolean(streaming),
      color: toneColor,
      attrs: {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        'data-testid': 'agy-trigger-vial-svg',
        'aria-hidden': 'true'
      },
      markup,
      toNode(doc = globalThis.document) {
        if (!doc) return null;
        const svg = createSvgEl(doc, 'svg', {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          'data-testid': 'agy-trigger-vial-svg',
          'aria-hidden': 'true'
        });
        if (svg.style) svg.style.filter = `drop-shadow(0 0 2px ${glowColor})`;
        const defs = createSvgEl(doc, 'defs');
        const cp = createSvgEl(doc, 'clipPath', { id: clipId });
        cp.appendChild?.(createSvgEl(doc, 'rect', { x: 5, y: 3.5, width: 6, height: 10.5, rx: 3 }));
        defs.appendChild?.(cp);
        svg.appendChild?.(defs);
        svg.appendChild?.(createSvgEl(doc, 'path', {
          d: 'M5.5 2h5M6 2v1.8a2.5 2.5 0 0 0-1 2v5.7a3 3 0 0 0 6 0V5.8a2.5 2.5 0 0 0-1-2V2',
          stroke: 'currentColor',
          'stroke-width': '1.3',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          opacity: '0.88'
        }));
        const g = createSvgEl(doc, 'g', { 'clip-path': `url(#${clipId})` });
        if (fillHeight > 0) {
          g.appendChild?.(createSvgEl(doc, 'rect', {
            x: 4.5,
            y: fillY,
            width: 7,
            height: fillHeight + 1,
            fill: toneColor,
            opacity: '0.86'
          }));
        }
        svg.appendChild?.(g);
        if (streaming) {
          svg.appendChild?.(createSvgEl(doc, 'circle', {
            cx: 8,
            cy: 4.2,
            r: 0.85,
            fill: toneColor,
            opacity: '0.95'
          }));
        }
        return svg;
      }
    };
  }

  function createStandalonePopoverVial(containerEl, initialProps = {}, hooks = {}) {
    const doc = globalThis.document;
    if (!containerEl || !doc) return null;
    let props = { ...initialProps };
    const uiText = (zh, en) => {
      if (typeof hooks.uiText === 'function') return hooks.uiText(zh, en);
      if (typeof props.uiText === 'function') return props.uiText(zh, en);
      if (typeof globalThis.__agyToZhTw === 'function' && props.language === 'zh-TW') return globalThis.__agyToZhTw(zh);
      return props.language === 'en' ? en : zh;
    };

    const computePct = p => (
      p.percent != null
        ? clamp(Number(p.percent), 0, 100)
        : (p.maxTokens > 0 ? clamp((Number(p.usedTokens || 0) / Number(p.maxTokens)) * 100, 0, 100) : 0)
    );

    const physics = createVialPhysics({
      fill: computePct(props) / 100,
      streaming: Boolean(props.streaming)
    });

    const root = doc.createElement('div');
    root.setAttribute?.('data-testid', 'agy-popover-vial-root');
    root.setAttribute?.('data-agy-optics-el', 'popover-vial');

    const canvas = doc.createElement('canvas');
    canvas.width = 96;
    canvas.height = 200;
    canvas.setAttribute?.('width', '96');
    canvas.setAttribute?.('height', '200');
    canvas.setAttribute?.('data-testid', 'agy-popover-vial-canvas');
    if (canvas.style) canvas.style.cssText = 'width:96px;height:200px;flex-shrink:0;cursor:grab;touch-action:none';

    const infoCol = doc.createElement('div');
    infoCol.className = 'agy-vial-breakdown';

    const headline = doc.createElement('div');
    headline.setAttribute?.('data-testid', 'agy-vial-headline');
    if (headline.style) headline.style.fontWeight = '600';

    const slicesWrap = doc.createElement('div');
    if (slicesWrap.style) slicesWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';

    const metricsRow = doc.createElement('div');
    metricsRow.setAttribute?.('data-testid', 'agy-vial-metrics');
    if (metricsRow.style) metricsRow.style.cssText = 'font-size:11px;opacity:0.75;display:flex;gap:8px';

    let compactBtn = null;
    let activeSlice = '';
    let localRafId = null;

    const sliceDefs = [
      { key: 'system', testId: 'agy-vial-slice-system', color: '#EA580C', label: () => uiText('系统与规则', 'System & rules'), field: 'systemTokens' },
      { key: 'messages', testId: 'agy-vial-slice-messages', color: '#2563EB', label: () => uiText('对话消息', 'Messages'), field: 'messageTokens' },
      { key: 'tools', testId: 'agy-vial-slice-tools', color: '#0D9488', label: () => uiText('工具输出', 'Tool outputs'), field: 'toolTokens' }
    ];

    const drawVialCanvas = () => {
      const ctx = canvas.getContext?.('2d');
      if (!ctx) return;
      const st = physics.getState();
      const w = 96;
      const h = 200;
      ctx.clearRect(0, 0, w, h);

      const padX = 14;
      const topY = 14;
      const tubeW = w - padX * 2;
      const tubeH = h - 28;
      const waterBaseY = topY + tubeH * (1 - st.fill);

      ctx.save();
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(padX, topY, tubeW, tubeH, 16);
      } else {
        ctx.rect(padX, topY, tubeW, tubeH);
      }
      ctx.clip();

      const pts = st.heights;
      ctx.beginPath();
      ctx.moveTo(padX, topY + tubeH);
      for (let i = 0; i < pts.length; i++) {
        const px = padX + (i / Math.max(1, pts.length - 1)) * tubeW;
        const py = clamp(waterBaseY + pts[i] * 26, topY, topY + tubeH);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(padX + tubeW, topY + tubeH);
      ctx.closePath();

      const pctNow = st.fill * 100;
      ctx.fillStyle = activeSlice === 'system'
        ? 'rgba(234,88,12,0.78)'
        : activeSlice === 'tools'
          ? 'rgba(13,148,136,0.78)'
          : pctNow >= 95
            ? 'rgba(239,68,68,0.78)'
            : pctNow >= 80
              ? 'rgba(245,158,11,0.78)'
              : 'rgba(56,189,248,0.75)';
      ctx.fill();

      for (const d of st.droplets) {
        ctx.beginPath();
        ctx.arc(padX + d.x * tubeW, topY + d.y * tubeH, d.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(125,211,252,0.9)';
        ctx.fill();
      }
      for (const b of st.bubbles) {
        ctx.beginPath();
        ctx.arc(padX + b.x * tubeW, topY + b.y * tubeH, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${b.alpha.toFixed(2)})`;
        ctx.fill();
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(148,163,184,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(padX, topY, tubeW, tubeH, 16);
      } else {
        ctx.rect(padX, topY, tubeW, tubeH);
      }
      ctx.stroke();
    };

    const sliceNodes = sliceDefs.map(def => {
      const rowEl = doc.createElement('div');
      rowEl.className = 'agy-vial-slice';
      rowEl.setAttribute?.('data-testid', def.testId);
      const left = doc.createElement('span');
      const right = doc.createElement('span');
      rowEl.appendChild?.(left);
      rowEl.appendChild?.(right);
      rowEl.addEventListener?.('pointerenter', () => {
        activeSlice = def.key;
        rowEl.setAttribute?.('data-active', 'true');
        drawVialCanvas();
      });
      rowEl.addEventListener?.('pointerleave', () => {
        activeSlice = '';
        rowEl.removeAttribute?.('data-active');
        drawVialCanvas();
      });
      slicesWrap.appendChild?.(rowEl);
      return { def, rowEl, left, right };
    });

    const renderInfo = () => {
      const pct = computePct(props);
      headline.textContent = `${Math.round(pct)}% (${formatTokens(props.usedTokens)} / ${formatTokens(props.maxTokens)})`;

      for (const { def, left, right } of sliceNodes) {
        left.textContent = def.label();
        right.textContent = formatTokens(props[def.field] || 0);
      }

      const tpsText = props.tps != null ? `${props.tps} tok/s` : '';
      const ttftText = props.ttftMs != null ? `${Math.round(props.ttftMs)}ms` : '';
      metricsRow.textContent = [tpsText, ttftText].filter(Boolean).join(' / ');

      if (pct >= 80) {
        if (!compactBtn) {
          compactBtn = doc.createElement('button');
          compactBtn.type = 'button';
          compactBtn.setAttribute?.('data-testid', 'agy-vial-compact-btn');
          compactBtn.textContent = uiText('填入 /compact', 'Insert /compact');
          compactBtn.addEventListener?.('click', () => {
            if (typeof props.onCompact === 'function') props.onCompact('/compact');
            else if (typeof props.onInsertText === 'function') props.onInsertText('/compact');
            else hooks.onInsertText?.('/compact');
          });
          infoCol.appendChild?.(compactBtn);
        }
      } else if (compactBtn) {
        compactBtn.remove?.();
        compactBtn = null;
      }
    };

    const wake = () => {
      if (typeof hooks.wake === 'function') {
        hooks.wake();
        return;
      }
      if (localRafId != null) return;
      const raf = typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (cb => setTimeout(() => cb(nowMs()), 16));
      let prev = nowMs();
      const stepLoop = ts => {
        localRafId = null;
        const cur = Number.isFinite(ts) ? ts : nowMs();
        const dt = clamp(cur - prev, 1, 64);
        prev = cur;
        const res = physics.step(dt);
        drawVialCanvas();
        if (!res.sleeping) localRafId = raf(stepLoop);
      };
      localRafId = raf(stepLoop);
    };

    let dragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    canvas.addEventListener?.('pointerdown', e => {
      dragging = true;
      lastPointerX = Number(e.clientX ?? 0);
      lastPointerY = Number(e.clientY ?? 0);
      physics.impulseAt(0.5, 0.2);
      wake();
    });
    canvas.addEventListener?.('pointermove', e => {
      if (!dragging) return;
      const cx = Number(e.clientX ?? lastPointerX);
      const cy = Number(e.clientY ?? lastPointerY);
      physics.drag(cx - lastPointerX, cy - lastPointerY);
      lastPointerX = cx;
      lastPointerY = cy;
      wake();
    });
    const stopDrag = () => { dragging = false; };
    canvas.addEventListener?.('pointerup', stopDrag);
    canvas.addEventListener?.('pointerleave', stopDrag);

    infoCol.appendChild?.(headline);
    infoCol.appendChild?.(slicesWrap);
    infoCol.appendChild?.(metricsRow);
    root.appendChild?.(canvas);
    root.appendChild?.(infoCol);
    containerEl.appendChild?.(root);

    renderInfo();
    drawVialCanvas();
    if (!physics.getState().sleeping) wake();

    return {
      physics,
      stepAndDraw(dtMs = 16) {
        const res = physics.step(dtMs);
        drawVialCanvas();
        return res;
      },
      update(nextProps = {}) {
        props = { ...props, ...nextProps };
        physics.setFill(computePct(props) / 100);
        physics.setStreaming(Boolean(props.streaming));
        renderInfo();
        drawVialCanvas();
        if (!physics.getState().sleeping) wake();
      },
      unmount() {
        if (localRafId != null) {
          const caf = typeof globalThis.cancelAnimationFrame === 'function'
            ? globalThis.cancelAnimationFrame.bind(globalThis)
            : clearTimeout;
          caf(localRafId);
          localRafId = null;
        }
        hooks.onUnmount?.();
        canvas.width = 0;
        canvas.height = 0;
        root.remove?.();
      }
    };
  }

  function createOptics(env = {}) {
    const doc = globalThis.document;
    const win = typeof globalThis.window !== 'undefined' ? globalThis.window : null;
    const getUiText = (zh, en) => {
      if (typeof env.uiText === 'function') return env.uiText(zh, en);
      const lang = currentOpts.language || 'zh-CN';
      if (lang === 'en') return en;
      if (lang === 'zh-TW' && typeof globalThis.__agyToZhTw === 'function') return globalThis.__agyToZhTw(zh);
      return zh;
    };

    let currentOpts = { ...DEFAULT_OPTS, ...(typeof env.options === 'function' ? env.options() : null) };
    let currentExecSignal = null;
    let disposed = false;

    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const listenerOpts = ac ? { signal: ac.signal } : undefined;
    const listenerCaptureOpts = ac ? { capture: true, signal: ac.signal } : { capture: true };

    const activeTimers = new Set();
    const safeTimeout = (fn, ms) => {
      const id = setTimeout(() => {
        activeTimers.delete(id);
        if (!disposed) fn();
      }, ms);
      activeTimers.add(id);
      return id;
    };

    const rafFn = typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (cb => setTimeout(() => cb(nowMs()), 16));
    const cafFn = typeof globalThis.cancelAnimationFrame === 'function'
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : clearTimeout;

    const isReducedMotion = () => {
      try {
        return Boolean(win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
      } catch {
        return false;
      }
    };
    let winBlurred = false;
    const isWindowHidden = () => Boolean(doc?.hidden || winBlurred);

    const effectiveMotionLevel = () => {
      if (currentOpts.enabled === false) return 'off';
      if (isReducedMotion()) return 'off';
      return currentOpts.motionLevel || 'off';
    };

    // Centralized 0fps-enforcing animation scheduler
    const tasks = new Map();
    let rafId = null;
    let lastTickAt = 0;
    let lastFrameDispatchAt = 0;

    const stopLoop = () => {
      if (rafId != null) {
        cafFn(rafId);
        rafId = null;
      }
      lastTickAt = 0;
      lastFrameDispatchAt = 0;
    };

    const hasActiveTasks = () => {
      for (const task of tasks.values()) {
        if (task.active) return true;
      }
      return false;
    };

    const pump = ts => {
      rafId = null;
      if (disposed || isWindowHidden() || !hasActiveTasks()) {
        stopLoop();
        return;
      }
      const now = Number.isFinite(ts) ? ts : nowMs();
      const fpsCap = Number(currentOpts.targetFps);
      const minInterval = fpsCap > 0 ? (1000 / fpsCap) * 0.9 : 0;
      if (minInterval > 0 && lastFrameDispatchAt > 0 && now - lastFrameDispatchAt < minInterval) {
        rafId = rafFn(pump);
        return;
      }
      const dt = lastTickAt > 0 ? clamp(now - lastTickAt, 1, 250) : 16;
      lastTickAt = now;
      lastFrameDispatchAt = now;

      for (const task of tasks.values()) {
        if (!task.active) continue;
        try {
          const keepGoing = task.tick(dt);
          if (keepGoing === false) task.active = false;
        } catch {
          task.active = false;
        }
      }
      if (!disposed && !isWindowHidden() && hasActiveTasks()) {
        rafId = rafFn(pump);
      } else {
        stopLoop();
      }
    };

    const scheduleWake = taskId => {
      if (disposed) return;
      const task = tasks.get(taskId);
      if (task) task.active = true;
      if (isWindowHidden() || rafId != null || !hasActiveTasks()) return;
      lastTickAt = nowMs();
      lastFrameDispatchAt = 0;
      rafId = rafFn(pump);
    };

    const registerTask = (id, tick) => {
      tasks.set(id, { active: false, tick });
    };

    const sleepTask = id => {
      const task = tasks.get(id);
      if (task) task.active = false;
      if (!hasActiveTasks()) stopLoop();
    };

    // 1. Style injection & Document attribute tracking
    let styleEl = null;
    let lastCssText = '';
    const appliedRootAttrs = new Set();
    const appliedRootVars = new Set();
    let lastResolvedPalette = 'native';
    let lastIsDark = true;

    const setRootAttr = (name, val) => {
      const html = doc?.documentElement;
      if (!html) return;
      if (val == null || val === false || val === '') {
        if (appliedRootAttrs.has(name)) {
          html.removeAttribute?.(name);
          appliedRootAttrs.delete(name);
        }
      } else {
        const str = val === true ? '' : String(val);
        if (html.getAttribute?.(name) !== str) {
          html.setAttribute?.(name, str);
        }
        appliedRootAttrs.add(name);
      }
    };

    const setRootVar = (name, val) => {
      const html = doc?.documentElement;
      if (!html?.style) return;
      if (val == null || val === '') {
        if (appliedRootVars.has(name)) {
          html.style.removeProperty?.(name);
          appliedRootVars.delete(name);
        }
      } else {
        html.style.setProperty?.(name, String(val));
        appliedRootVars.add(name);
      }
    };

    const buildCss = (opts, isDark, paletteKey, themeVars) => {
      if (opts.enabled === false) return '';
      const chunks = [];
      const ambient = clamp(Number(opts.ambientIntensity ?? 70), 0, 100) / 100;
      const radiusMap = { sharp: '4px', soft: '16px' };
      const radius = radiusMap[opts.cornerStyle] || '';
      const font = CODE_FONTS[opts.codeFont] || '';

      if (paletteKey !== 'native') {
        const varDecl = Object.entries(themeVars).map(([k, v]) => `${k}:${v}`).join(';');
        chunks.push(`:root{${varDecl};--agy-ambient:${ambient.toFixed(2)}}`);
        if (!opts.userBubbleTint) {
          const glassBg = isDark
            ? 'linear-gradient(135deg,color-mix(in srgb,var(--card) 82%,rgba(255,255,255,0.06)),color-mix(in srgb,var(--card) 92%,transparent))'
            : 'color-mix(in srgb,var(--card) 92%,var(--primary) 4%)';
          chunks.push(
            `html[data-agy-optics-palette]:not([data-agy-optics-palette="native"]):not([data-agy-user-bubble]) [data-testid="user-input-step"] [data-testid="user-message-bubble"]{background:${glassBg};backdrop-filter:blur(10px);border:1px solid var(--border)}`
          );
        }
      } else {
        chunks.push(`:root{--agy-ambient:${ambient.toFixed(2)}}`);
      }

      if (radius) {
        chunks.push(
          `:root{--agy-radius:${radius};--agy-card-radius:${radius};--radius:${radius}}`
          + `.surface-composer-card,[data-testid="user-message-bubble"],[data-testid="agent-response"] pre,[role="dialog"]{border-radius:${radius}!important}`
        );
      }

      if (font || opts.codeLigatures) {
        const fontDecl = font ? `--font-mono:${font};font-family:${font};` : '';
        const ligDecl = opts.codeLigatures
          ? 'font-variant-ligatures:normal;font-feature-settings:"liga" 1,"calt" 1;'
          : (font ? 'font-variant-ligatures:none;font-feature-settings:"liga" 0,"calt" 0;' : '');
        chunks.push(
          `pre,code,pre code,[data-markdown-root] code,.monaco-editor{${fontDecl}${ligDecl}}`
        );
      }

      if (opts.sidebarCompact) {
        chunks.push(
          `[data-testid="conversation-row-sidebar"],.agy-sidebar-row{min-height:26px!important;height:26px!important;padding-top:2px!important;padding-bottom:2px!important}`
        );
      }

      if (opts.sidebarNavFold) {
        chunks.push(
          `[data-agy-nav-folded="true"]{display:none!important}`
          + `[data-testid="agy-nav-fold-toggle"]{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;margin:2px 6px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--muted-foreground);font-size:11.5px;cursor:pointer}`
          + `[data-testid="agy-nav-fold-toggle"]:hover{background:var(--secondary);color:var(--foreground)}`
        );
      }

      if (opts.composerRestyle) {
        chunks.push(
          `html[data-agy-composer-restyle] .surface-composer-card{border-color:color-mix(in srgb,var(--border) 70%,var(--agy-accent,var(--primary)) 18%);box-shadow:0 8px 28px rgba(0,0,0,${isDark ? (0.28 * ambient + 0.08).toFixed(2) : (0.08 * ambient + 0.02).toFixed(2)})}`
        );
      }

      if (opts.logoInk === 'foreground') {
        chunks.push(`html[data-agy-logo-ink="foreground"] [data-testid="home-greeting"] svg{color:var(--foreground)}`);
      } else if (paletteKey !== 'native' || opts.accentTone !== 'follow') {
        chunks.push(`html[data-agy-logo-ink="accent"] [data-testid="home-greeting"] svg{color:var(--agy-accent,var(--primary))}`);
      }

      chunks.push(
        `.agy-smooth-caret{position:fixed;width:2px;border-radius:1px;background:var(--agy-accent,var(--primary,#669DF6));pointer-events:none;z-index:9050;transition:opacity 180ms ease;box-shadow:0 0 6px color-mix(in srgb,var(--agy-accent,var(--primary,#669DF6)) 55%,transparent)}`
      );

      chunks.push(
        `::highlight(agy-ink-1){color:color-mix(in srgb,var(--foreground,currentColor) 20%,transparent)}`
        + `::highlight(agy-ink-2){color:color-mix(in srgb,var(--foreground,currentColor) 38%,transparent)}`
        + `::highlight(agy-ink-3){color:color-mix(in srgb,var(--foreground,currentColor) 58%,transparent)}`
        + `::highlight(agy-ink-4){color:color-mix(in srgb,var(--foreground,currentColor) 78%,transparent)}`
        + `::highlight(agy-ink-5){color:color-mix(in srgb,var(--foreground,currentColor) 94%,transparent)}`
      );

      chunks.push(
        `@keyframes agy-aura-settle{0%{opacity:0.95}65%{opacity:0.65}100%{opacity:0.22}}`
        + `[data-testid="conversation-view"][data-agy-conv-aura="waiting"]{box-shadow:inset 0 0 0 1.5px rgba(245,158,11,${(0.55 * ambient + 0.15).toFixed(2)}),inset 0 0 22px rgba(245,158,11,${(0.18 * ambient + 0.04).toFixed(2)});animation:agy-aura-settle 1.3s ease-out 1 forwards}`
        + `[data-testid="conversation-view"][data-agy-conv-aura="error"]{box-shadow:inset 0 0 0 1.5px rgba(239,68,68,${(0.6 * ambient + 0.15).toFixed(2)}),inset 0 0 22px rgba(239,68,68,${(0.18 * ambient + 0.04).toFixed(2)});animation:agy-aura-settle 1.3s ease-out 1 forwards}`
        + `[data-testid="conversation-view"][data-agy-conv-aura="done-bg"]{box-shadow:inset 0 0 0 1.5px rgba(16,185,129,${(0.55 * ambient + 0.15).toFixed(2)}),inset 0 0 22px rgba(56,189,248,${(0.2 * ambient + 0.04).toFixed(2)});animation:agy-aura-settle 1.5s ease-out 1 forwards}`
      );

      chunks.push(
        `.surface-composer-card[data-agy-rim-active="1"]{background-image:radial-gradient(240px circle at var(--agy-rim-x,-999px) var(--agy-rim-y,-999px),color-mix(in srgb,var(--agy-accent,var(--primary,#669DF6)) ${Math.round(14 * ambient + 4)}%,transparent),transparent 70%)}`
      );

      chunks.push(
        `[data-testid="agy-wallpaper-layer"]{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}`
        + `body[data-has-browser-hole="true"] [data-testid="agy-wallpaper-layer"]{display:none!important}`
      );

      chunks.push(
        `[data-testid="agy-mascot-stage"]{position:absolute;bottom:100%;left:14px;right:14px;height:52px;pointer-events:none;z-index:12;overflow:visible}`
        + `[data-testid="agy-mascot-stage"] [data-testid="agy-mascot-item"]{pointer-events:auto;position:absolute;bottom:0;cursor:grab;user-select:none;transition:transform 140ms ease}`
        + `[data-testid="agy-mascot-stage"][data-peek="true"]{pointer-events:none!important;z-index:0!important;opacity:0.42!important;transform:translateY(10px) scale(0.88)!important}`
        + `[data-testid="agy-mascot-stage"][data-peek="true"] [data-testid="agy-mascot-item"]{pointer-events:none!important}`
      );

      chunks.push(
        `[data-testid="agy-popover-vial-root"]{display:flex;align-items:stretch;gap:12px;padding:8px}`
        + `.agy-vial-breakdown{display:flex;flex-direction:column;justify-content:space-between;gap:6px;flex:1;min-width:0;font-size:12px}`
        + `.agy-vial-slice{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 6px;border-radius:6px;cursor:default}`
        + `.agy-vial-slice:hover,.agy-vial-slice[data-active="true"]{background:var(--secondary,rgba(128,128,128,0.12))}`
      );

      return chunks.join('\n');
    };

    const syncStylesAndTokens = () => {
      if (!doc) return;
      lastIsDark = detectDarkMode(doc);
      lastResolvedPalette = resolvePaletteKey(currentOpts, lastIsDark);
      const themeVars = computeThemeVars(currentOpts, lastIsDark);

      setRootAttr('data-agy-optics-palette', currentOpts.enabled === false ? null : lastResolvedPalette);
      setRootAttr('data-agy-optics-mode', currentOpts.enabled === false ? null : (lastIsDark ? 'dark' : 'light'));
      setRootAttr('data-agy-composer-restyle', currentOpts.enabled !== false && currentOpts.composerRestyle ? '1' : null);
      setRootAttr('data-agy-sidebar-compact', currentOpts.enabled !== false && currentOpts.sidebarCompact ? '1' : null);
      setRootAttr(
        'data-agy-logo-ink',
        currentOpts.enabled !== false && (currentOpts.logoInk === 'foreground' || lastResolvedPalette !== 'native' || currentOpts.accentTone !== 'follow')
          ? (currentOpts.logoInk || 'accent')
          : null
      );

      if (currentOpts.enabled !== false && lastResolvedPalette !== 'native') {
        for (const [k, v] of Object.entries(themeVars)) {
          setRootVar(k, v);
        }
      } else {
        for (const k of [...appliedRootVars]) {
          if (k !== '--agy-ambient' && k !== '--agy-radius' && k !== '--agy-card-radius' && k !== '--radius') {
            setRootVar(k, null);
          }
        }
      }

      if (currentOpts.enabled !== false && (currentOpts.cornerStyle === 'sharp' || currentOpts.cornerStyle === 'soft')) {
        const rad = currentOpts.cornerStyle === 'sharp' ? '4px' : '16px';
        setRootVar('--agy-radius', rad);
        setRootVar('--agy-card-radius', rad);
        setRootVar('--radius', rad);
      } else {
        setRootVar('--agy-radius', null);
        setRootVar('--agy-card-radius', null);
        setRootVar('--radius', null);
      }

      const cssText = buildCss(currentOpts, lastIsDark, lastResolvedPalette, themeVars);
      if (!cssText) {
        if (styleEl) {
          styleEl.remove?.();
          styleEl = null;
          lastCssText = '';
        }
      } else {
        if (!styleEl && doc.head) {
          styleEl = doc.createElement('style');
          styleEl.dataset = styleEl.dataset || {};
          styleEl.dataset.agyOpticsStyle = '1';
          styleEl.setAttribute?.('data-agy-optics-style', '1');
          styleEl.setAttribute?.('data-agy-optics-el', 'style');
          doc.head.appendChild?.(styleEl);
        }
        if (styleEl && lastCssText !== cssText) {
          styleEl.textContent = cssText;
          lastCssText = cssText;
        }
      }
    };

    // 2. Sidebar Nav Fold (never hides New Conversation or /powertools)
    let navFoldExpanded = false;
    let navFoldBtn = null;
    const foldedNodes = new Set();

    const clearNavFold = () => {
      for (const el of foldedNodes) {
        el?.removeAttribute?.('data-agy-nav-folded');
      }
      foldedNodes.clear();
      if (navFoldBtn) {
        navFoldBtn.remove?.();
        navFoldBtn = null;
      }
    };

    const syncSidebarNavFold = () => {
      if (!doc || currentOpts.enabled === false || !currentOpts.sidebarNavFold) {
        clearNavFold();
        return;
      }
      const nav = doc.querySelector?.('[data-testid="sidebar-navigation-items"]');
      if (!nav) {
        clearNavFold();
        return;
      }
      const targets = [
        ...(nav.querySelectorAll?.('a[href="/automations"],a[href="/customizations"]') || [])
      ];
      for (const link of targets) {
        const href = link.getAttribute?.('href') || '';
        if (href === '/powertools') continue;
        if (navFoldExpanded) {
          link.removeAttribute?.('data-agy-nav-folded');
        } else {
          link.setAttribute?.('data-agy-nav-folded', 'true');
        }
        foldedNodes.add(link);
      }
      const powertoolsLink = nav.querySelector?.('a[href="/powertools"]');
      if (powertoolsLink) powertoolsLink.removeAttribute?.('data-agy-nav-folded');

      if (targets.length === 0) {
        if (navFoldBtn) { navFoldBtn.remove?.(); navFoldBtn = null; }
        return;
      }
      if (!navFoldBtn || !navFoldBtn.isConnected) {
        navFoldBtn = doc.createElement('button');
        navFoldBtn.type = 'button';
        navFoldBtn.setAttribute?.('data-testid', 'agy-nav-fold-toggle');
        navFoldBtn.setAttribute?.('data-agy-optics-el', 'nav-fold');
        navFoldBtn.addEventListener?.('click', e => {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          navFoldExpanded = !navFoldExpanded;
          syncSidebarNavFold();
        }, listenerOpts);
        nav.appendChild?.(navFoldBtn);
      }
      const label = navFoldExpanded ? getUiText('收起', 'Less') : getUiText('更多', 'More');
      if (navFoldBtn.textContent !== label) navFoldBtn.textContent = label;
      navFoldBtn.setAttribute?.('aria-expanded', String(navFoldExpanded));
    };

    // 3. Studio Placeholder Style (restores originals cleanly)
    const originalPlaceholders = new Map();
    const restorePlaceholders = () => {
      for (const [el, rec] of originalPlaceholders) {
        if (el) {
          for (const [attr, prev] of Object.entries(rec)) {
            if (prev === null) el.removeAttribute?.(attr);
            else el.setAttribute?.(attr, prev);
          }
        }
      }
      originalPlaceholders.clear();
    };

    const syncPlaceholderStyle = () => {
      if (!doc || currentOpts.enabled === false || currentOpts.placeholderStyle !== 'studio') {
        restorePlaceholders();
        return;
      }
      const copy = getUiText('描述任务，@ 引用上下文，/ 唤起指令', 'Describe a task, @ for context, / for commands');
      const cards = doc.querySelectorAll?.('.surface-composer-card') || [];
      for (const card of cards) {
        const inputs = card.querySelectorAll?.('[contenteditable="true"],textarea,input') || [];
        for (const el of inputs) {
          const text = String(el.value ?? el.textContent ?? '').trim();
          const attrs = ['data-placeholder', 'aria-placeholder', 'placeholder'];
          const matched = attrs.filter(a => el.hasAttribute?.(a));
          const targetAttrs = matched.length ? matched : (el.hasAttribute?.('contenteditable') ? ['data-placeholder'] : []);
          if (!targetAttrs.length) continue;
          if (!originalPlaceholders.has(el)) {
            const snap = {};
            for (const a of targetAttrs) snap[a] = el.hasAttribute?.(a) ? el.getAttribute?.(a) : null;
            originalPlaceholders.set(el, snap);
          }
          if (!text) {
            for (const a of targetAttrs) {
              if (el.getAttribute?.(a) !== copy) el.setAttribute?.(a, copy);
            }
          }
        }
      }
    };

    // 4. Smooth Caret
    let caretEl = null;
    const caretState = { x: 0, y: 0, tx: 0, ty: 0, h: 18, visible: false, idleMs: 0 };

    const removeCaretEl = () => {
      sleepTask('smooth-caret');
      caretState.visible = false;
      if (caretEl) {
        caretEl.remove?.();
        caretEl = null;
      }
    };

    registerTask('smooth-caret', dt => {
      if (!caretEl || !caretState.visible || currentOpts.enabled === false || !currentOpts.smoothCaret || effectiveMotionLevel() === 'off') {
        if (caretEl?.style) caretEl.style.opacity = '0';
        return false;
      }
      caretState.idleMs += dt;
      const factor = Math.min(1, dt * 0.025);
      caretState.x += (caretState.tx - caretState.x) * factor;
      caretState.y += (caretState.ty - caretState.y) * factor;
      if (caretEl.style) {
        caretEl.style.transform = `translate3d(${caretState.x.toFixed(1)}px, ${caretState.y.toFixed(1)}px, 0)`;
        caretEl.style.height = `${Math.max(12, caretState.h)}px`;
        caretEl.style.opacity = caretState.idleMs >= 600 ? '0' : '1';
      }
      if (caretState.idleMs >= 600) {
        caretState.visible = false;
        return false;
      }
      return true;
    });

    const updateCaretFromSelection = target => {
      if (disposed || currentOpts.enabled === false || !currentOpts.smoothCaret || effectiveMotionLevel() === 'off') return;
      const editable = asElement(target)?.closest?.('.surface-composer-card [contenteditable="true"]');
      if (!editable || !doc?.body) return;
      let rect = null;
      try {
        const sel = win?.getSelection?.() || doc.getSelection?.();
        if (sel && sel.rangeCount > 0) {
          const r = sel.getRangeAt(0);
          rect = r.getBoundingClientRect?.();
        }
      } catch {}
      if (!rect || (rect.width === 0 && rect.height === 0 && rect.left === 0 && rect.top === 0)) {
        const box = editable.getBoundingClientRect?.();
        if (!box) return;
        rect = { left: box.left + 8, top: box.top + 6, height: 18 };
      }
      if (!caretEl) {
        caretEl = doc.createElement('div');
        caretEl.className = 'agy-smooth-caret';
        caretEl.setAttribute?.('data-agy-optics-el', 'smooth-caret');
        caretEl.setAttribute?.('data-testid', 'agy-smooth-caret');
        doc.body.appendChild?.(caretEl);
        caretState.x = rect.left;
        caretState.y = rect.top;
      }
      caretState.tx = rect.left;
      caretState.ty = rect.top;
      caretState.h = rect.height || 18;
      caretState.idleMs = 0;
      caretState.visible = true;
      scheduleWake('smooth-caret');
    };

    if (doc) {
      for (const evt of ['input', 'keyup', 'mouseup', 'focus']) {
        doc.addEventListener?.(evt, e => updateCaretFromSelection(e.target), listenerCaptureOpts);
      }
      doc.addEventListener?.('blur', () => {
        caretState.visible = false;
        if (caretEl?.style) caretEl.style.opacity = '0';
        sleepTask('smooth-caret');
      }, listenerCaptureOpts);
    }

    // 5. Scroll-to-Bottom Smooth Inertial Glide
    let scrollAnim = null;
    const cancelScrollGlide = () => {
      scrollAnim = null;
      sleepTask('scroll-bottom');
    };

    registerTask('scroll-bottom', dt => {
      if (!scrollAnim || !scrollAnim.viewport) return false;
      scrollAnim.elapsed += dt;
      const p = clamp(scrollAnim.elapsed / scrollAnim.duration, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const target = Math.max(0, (scrollAnim.viewport.scrollHeight || 0) - (scrollAnim.viewport.clientHeight || 0));
      scrollAnim.viewport.scrollTop = scrollAnim.startTop + (target - scrollAnim.startTop) * eased;
      if (p >= 1) {
        scrollAnim = null;
        return false;
      }
      return true;
    });

    if (doc) {
      doc.addEventListener?.('click', event => {
        if (disposed || currentOpts.enabled === false || currentOpts.scrollBottomMotion !== 'smooth' || effectiveMotionLevel() === 'off') return;
        const btn = asElement(event.target)?.closest?.(
          '[data-testid="conversation-view"] button[data-testid*="scroll-bottom"],'
          + '[data-testid="conversation-view"] button[data-testid*="scroll-to-bottom"],'
          + '[data-testid="conversation-view"] button[aria-label*="Scroll to bottom"],'
          + '[data-testid="conversation-view"] button[aria-label*="滚动到底部"],'
          + '[data-testid="conversation-view"] button[aria-label*="捲動到底部"],'
          + '[data-testid="conversation-view"] [data-agy-scroll-bottom]'
        );
        if (!btn) return;
        const view = btn.closest?.('[data-testid="conversation-view"]');
        const viewport = view?.querySelector?.('[data-testid="autoscroll-viewport"]') || view;
        if (!viewport) return;
        const target = Math.max(0, (viewport.scrollHeight || 0) - (viewport.clientHeight || 0));
        const startTop = Number(viewport.scrollTop || 0);
        if (Math.abs(target - startTop) < 1) return;
        event.preventDefault?.();
        event.stopPropagation?.();
        scrollAnim = {
          viewport,
          startTop,
          elapsed: 0,
          duration: 260
        };
        scheduleWake('scroll-bottom');
      }, listenerCaptureOpts);

      for (const cancelEvt of ['wheel', 'touchstart', 'pointerdown']) {
        doc.addEventListener?.(cancelEvt, () => {
          if (scrollAnim) cancelScrollGlide();
        }, listenerCaptureOpts);
      }
      doc.addEventListener?.('keydown', e => {
        if (scrollAnim && ['ArrowUp', 'PageUp', 'Home'].includes(e?.key)) {
          cancelScrollGlide();
        }
      }, listenerCaptureOpts);
    }

    // 6. Stream Ink (5-stage CSS.highlights)
    const trackedTextNodes = new Map(); // Text node -> prev length
    let inkSpans = []; // { range, ageMs }
    let streamStopElapsed = -1;
    let wasStreaming = false;

    const clearStreamInk = () => {
      inkSpans = [];
      trackedTextNodes.clear();
      streamStopElapsed = -1;
      wasStreaming = false;
      sleepTask('stream-ink');
      const hl = globalThis.CSS?.highlights;
      if (hl && typeof hl.delete === 'function') {
        for (let stage = 1; stage <= 5; stage++) {
          hl.delete(`agy-ink-${stage}`);
        }
      }
    };

    const isSignalStreaming = signal => {
      if (!signal) return false;
      if (typeof signal === 'string') return signal === 'streaming' || signal === 'running';
      if (typeof signal === 'object') {
        if (signal.streaming === true) return true;
        return signal.status === 2 || signal.status === 4;
      }
      return false;
    };

    const flushInkHighlights = dt => {
      const hl = globalThis.CSS?.highlights;
      const HlCtor = globalThis.Highlight;
      if (!hl || typeof HlCtor !== 'function' || currentOpts.enabled === false || !currentOpts.streamInk || effectiveMotionLevel() === 'off') {
        clearStreamInk();
        return false;
      }

      const streamingNow = isSignalStreaming(currentExecSignal);
      if (!streamingNow && streamStopElapsed >= 0 && dt > 0) {
        streamStopElapsed += dt;
      }

      const buckets = [[], [], [], [], []];
      const nextSpans = [];
      for (const item of inkSpans) {
        if (dt > 0) item.ageMs += dt;
        const expiredAfterStop = !streamingNow && streamStopElapsed >= 900;
        if (item.ageMs >= 900 || expiredAfterStop) continue;
        const stageIdx = clamp(Math.floor(item.ageMs / 180), 0, 4);
        buckets[stageIdx].push(item.range);
        nextSpans.push(item);
      }
      inkSpans = nextSpans;

      for (let i = 0; i < 5; i++) {
        const key = `agy-ink-${i + 1}`;
        if (buckets[i].length > 0) {
          hl.set(key, new HlCtor(...buckets[i]));
        } else {
          hl.delete(key);
        }
      }

      return inkSpans.length > 0;
    };

    const collectLatestStreamChunks = () => {
      const hl = globalThis.CSS?.highlights;
      const HlCtor = globalThis.Highlight;
      if (!hl || typeof HlCtor !== 'function' || !doc || typeof doc.createRange !== 'function') return;
      const responses = doc.querySelectorAll?.('[data-testid="agent-response"]') || [];
      const active = responses.length ? responses[responses.length - 1] : null;
      if (!active) return;

      const textNodes = [];
      if (typeof doc.createTreeWalker === 'function') {
        const showText = globalThis.NodeFilter?.SHOW_TEXT ?? 4;
        const walker = doc.createTreeWalker(active, showText);
        let node;
        while ((node = walker.nextNode?.())) textNodes.push(node);
      } else if (Array.isArray(active.textNodes)) {
        textNodes.push(...active.textNodes);
      }

      let added = false;
      for (const node of textNodes) {
        const len = String(node.nodeValue || '').length;
        const prev = trackedTextNodes.has(node) ? trackedTextNodes.get(node) : 0;
        if (len > prev) {
          const range = doc.createRange();
          range.setStart(node, prev);
          range.setEnd(node, len);
          inkSpans.push({ range, ageMs: 0 });
          trackedTextNodes.set(node, len);
          added = true;
        } else if (!trackedTextNodes.has(node)) {
          trackedTextNodes.set(node, len);
        }
      }
      if (added) {
        flushInkHighlights(0);
        scheduleWake('stream-ink');
      }
    };

    registerTask('stream-ink', dt => flushInkHighlights(dt));

    const syncStreamInk = execSignal => {
      if (currentOpts.enabled === false || !currentOpts.streamInk || effectiveMotionLevel() === 'off') {
        clearStreamInk();
        return;
      }
      const streamingNow = isSignalStreaming(execSignal);
      if (streamingNow) {
        wasStreaming = true;
        streamStopElapsed = -1;
        collectLatestStreamChunks();
      } else if (wasStreaming) {
        wasStreaming = false;
        streamStopElapsed = 0;
        if (inkSpans.length > 0) scheduleWake('stream-ink');
      }
    };

    // 7. Conversation Semantic Edge Aura (3-state: waiting | error | done-bg)
    let lastAuraState = '';
    let seenActiveWhileHidden = false;

    const resolveAuraState = execSignal => {
      if (currentOpts.enabled === false || !currentOpts.convAura) return '';
      if (!execSignal) return '';
      if (typeof execSignal === 'string') {
        return ['waiting', 'error', 'done-bg'].includes(execSignal) ? execSignal : '';
      }
      if (typeof execSignal === 'object') {
        if (['waiting', 'error', 'done-bg'].includes(execSignal.aura)) return execSignal.aura;
        if (['waiting', 'error', 'done-bg'].includes(execSignal.state)) return execSignal.state;
        if (execSignal.live?.waiting || execSignal.waiting || execSignal.status === 9) return 'waiting';
        if (execSignal.live?.errorText || execSignal.live?.genError || execSignal.error || execSignal.status === 3 || execSignal.live?.lastCase === 'errorMessage') {
          return 'error';
        }
        if (execSignal.doneBackground || execSignal.completedBackground || (execSignal.status === 1 && execSignal.background)) {
          return 'done-bg';
        }
        if (execSignal.status === 2 || execSignal.status === 4) {
          if (isWindowHidden()) seenActiveWhileHidden = true;
          return '';
        }
        if (execSignal.status === 1 && seenActiveWhileHidden) {
          seenActiveWhileHidden = false;
          return 'done-bg';
        }
      }
      return '';
    };

    const syncConvAura = execSignal => {
      if (!doc) return;
      const view = doc.querySelector?.('[data-testid="conversation-view"]');
      const nextAura = resolveAuraState(execSignal);
      lastAuraState = nextAura;
      if (!view) return;
      if (!nextAura) {
        view.removeAttribute?.('data-agy-conv-aura');
      } else if (view.getAttribute?.('data-agy-conv-aura') !== nextAura) {
        view.setAttribute?.('data-agy-conv-aura', nextAura);
      }
    };

    // 8. Prism Rim Highlight (pointer-proximity on .surface-composer-card)
    let activeRimCard = null;
    let rimPending = false;
    let lastRimEvent = null;

    const clearPrismRim = () => {
      rimPending = false;
      lastRimEvent = null;
      if (activeRimCard) {
        activeRimCard.removeAttribute?.('data-agy-rim-active');
        activeRimCard.style?.removeProperty?.('--agy-rim-x');
        activeRimCard.style?.removeProperty?.('--agy-rim-y');
        activeRimCard = null;
      }
    };

    const applyPrismRimPoint = () => {
      rimPending = false;
      if (disposed || currentOpts.enabled === false || !currentOpts.prismRim || effectiveMotionLevel() === 'off' || !lastRimEvent) {
        clearPrismRim();
        return;
      }
      const ev = lastRimEvent;
      const card = asElement(ev.target)?.closest?.('.surface-composer-card');
      if (!card) {
        clearPrismRim();
        return;
      }
      if (activeRimCard && activeRimCard !== card) {
        activeRimCard.removeAttribute?.('data-agy-rim-active');
      }
      activeRimCard = card;
      const rect = card.getBoundingClientRect?.();
      if (!rect) return;
      const x = Math.round((ev.clientX ?? 0) - rect.left);
      const y = Math.round((ev.clientY ?? 0) - rect.top);
      card.setAttribute?.('data-agy-rim-active', '1');
      card.style?.setProperty?.('--agy-rim-x', `${x}px`);
      card.style?.setProperty?.('--agy-rim-y', `${y}px`);
    };

    if (doc) {
      doc.addEventListener?.('pointermove', event => {
        if (disposed || currentOpts.enabled === false || !currentOpts.prismRim || effectiveMotionLevel() === 'off') return;
        if (!asElement(event.target)?.closest?.('.surface-composer-card')) {
          if (activeRimCard) clearPrismRim();
          return;
        }
        lastRimEvent = { clientX: event.clientX, clientY: event.clientY, target: event.target };
        if (!rimPending) {
          rimPending = true;
          queueMicrotask(applyPrismRimPoint);
        }
      }, listenerOpts);
      doc.addEventListener?.('pointerleave', clearPrismRim, listenerOpts);
    }

    // 9. Home Screen Character Dot-Matrix Ripple
    let homeCanvas = null;
    let homeWaves = [];

    const isConversationPath = () => /^\/c\//.test(String(globalThis.location?.pathname || ''));

    const reclaimCanvas = canvas => {
      if (!canvas) return;
      canvas.width = 0;
      canvas.height = 0;
    };

    const unmountHomeRipple = () => {
      homeWaves = [];
      sleepTask('home-ripple');
      if (homeCanvas) {
        reclaimCanvas(homeCanvas);
        homeCanvas.remove?.();
        homeCanvas = null;
      }
    };

    const drawHomeRipple = dt => {
      if (!homeCanvas || !homeCanvas.isConnected) return false;
      const rect = homeCanvas.parentElement?.getBoundingClientRect?.() || { width: 800, height: 600, left: 0, top: 0 };
      const w = Math.max(1, Math.round(rect.width || 800));
      const h = Math.max(1, Math.round(rect.height || 600));
      if (homeCanvas.width !== w || homeCanvas.height !== h) {
        homeCanvas.width = w;
        homeCanvas.height = h;
      }
      const ctx = homeCanvas.getContext?.('2d');
      if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.font = '12px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
      }

      const active = [];
      for (const wave of homeWaves) {
        wave.elapsedMs += dt;
        if (wave.elapsedMs >= 1200) continue;
        active.push(wave);
        if (!ctx) continue;
        const p = wave.elapsedMs / 1200;
        const radius = 12 + p * 260;
        const alpha = (1 - p) * 0.55;
        ctx.fillStyle = `rgba(102, 157, 246, ${alpha.toFixed(3)})`;
        const steps = 28;
        for (let i = 0; i < steps; i++) {
          const angle = (i / steps) * Math.PI * 2;
          const x = wave.x - rect.left + Math.cos(angle) * radius;
          const y = wave.y - rect.top + Math.sin(angle) * radius;
          const ch = RIPPLE_CHARS[(i + Math.floor(p * 12)) % RIPPLE_CHARS.length];
          ctx.fillText(ch, x, y);
        }
      }
      homeWaves = active;
      if (homeWaves.length === 0) {
        if (ctx) ctx.clearRect(0, 0, w, h);
        reclaimCanvas(homeCanvas);
        return false;
      }
      return true;
    };

    registerTask('home-ripple', dt => {
      if (!homeCanvas || currentOpts.enabled === false || !currentOpts.homeRipple || effectiveMotionLevel() === 'off' || isConversationPath()) {
        unmountHomeRipple();
        return false;
      }
      return drawHomeRipple(dt);
    });

    const syncHomeRipple = () => {
      if (!doc || currentOpts.enabled === false || !currentOpts.homeRipple || effectiveMotionLevel() === 'off' || isConversationPath()) {
        unmountHomeRipple();
        return;
      }
      const greeting = doc.querySelector?.('[data-testid="home-greeting"]');
      if (!greeting) {
        unmountHomeRipple();
        return;
      }
      const host = greeting.parentElement || doc.body;
      if (!host) return;
      if (!homeCanvas || !homeCanvas.isConnected) {
        homeCanvas = doc.createElement('canvas');
        homeCanvas.setAttribute?.('data-testid', 'agy-home-ripple-canvas');
        homeCanvas.setAttribute?.('data-agy-optics-el', 'home-ripple');
        homeCanvas.setAttribute?.('aria-hidden', 'true');
        if (homeCanvas.style) {
          homeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
        }
        reclaimCanvas(homeCanvas);
        if (typeof host.insertBefore === 'function' && greeting.parentElement === host) {
          host.insertBefore(homeCanvas, greeting);
        } else {
          host.appendChild?.(homeCanvas);
        }
      }
    };

    if (doc) {
      doc.addEventListener?.('click', event => {
        if (disposed || !homeCanvas || currentOpts.enabled === false || !currentOpts.homeRipple || effectiveMotionLevel() === 'off' || isConversationPath()) return;
        if (asElement(event.target)?.closest?.('button,a,input,textarea,[contenteditable],[role="button"],.surface-composer-card')) return;
        homeWaves.push({ x: Number(event.clientX ?? 200), y: Number(event.clientY ?? 200), elapsedMs: 0 });
        scheduleWake('home-ripple');
      }, listenerOpts);
    }

    // 10. Wallpaper Layer (Beta) with Browser-Hole deference & 0fps video pause
    let wallpaperLayer = null;
    let wallpaperMediaEl = null;
    let wallpaperDimEl = null;
    let wallpaperStatusCache = null;
    let wallpaperFetching = false;

    const removeWallpaper = () => {
      if (wallpaperMediaEl && typeof wallpaperMediaEl.pause === 'function') {
        try { wallpaperMediaEl.pause(); } catch {}
        wallpaperMediaEl.removeAttribute?.('src');
      }
      wallpaperMediaEl = null;
      wallpaperDimEl = null;
      wallpaperStatusCache = null;
      if (wallpaperLayer) {
        wallpaperLayer.remove?.();
        wallpaperLayer = null;
      }
    };

    const isBrowserHoleActive = () => doc?.body?.getAttribute?.('data-has-browser-hole') === 'true';

    const updateWallpaperPresentation = () => {
      if (!wallpaperLayer || !wallpaperMediaEl) return;
      const hole = isBrowserHoleActive();
      const hidden = isWindowHidden();
      if (hole) {
        wallpaperLayer.setAttribute?.('data-hidden-browser-hole', 'true');
        setInlineStyle(wallpaperLayer, 'display', 'none');
      } else {
        wallpaperLayer.removeAttribute?.('data-hidden-browser-hole');
        setInlineStyle(wallpaperLayer, 'display', 'block');
      }
      const opacity = clamp(Number(currentOpts.wallpaperOpacity ?? 22), 0, 80) / 100;
      const blur = clamp(Number(currentOpts.wallpaperBlur ?? 8), 0, 32);
      const dim = clamp(Number(currentOpts.wallpaperDim ?? 35), 0, 80) / 100;
      setInlineStyle(wallpaperMediaEl, 'width', '100%');
      setInlineStyle(wallpaperMediaEl, 'height', '100%');
      setInlineStyle(wallpaperMediaEl, 'object-fit', 'cover');
      setInlineStyle(wallpaperMediaEl, 'opacity', String(opacity));
      setInlineStyle(wallpaperMediaEl, 'filter', blur > 0 ? `blur(${blur}px)` : 'none');
      setInlineStyle(wallpaperMediaEl, 'transform', blur > 0 ? 'scale(1.04)' : 'none');
      if (wallpaperDimEl?.style) {
        wallpaperDimEl.style.cssText = `position:absolute;inset:0;pointer-events:none;background:rgba(0,0,0,${dim.toFixed(2)})`;
      }
      if (wallpaperMediaEl.tagName?.toLowerCase() === 'video') {
        if (hole || hidden) {
          wallpaperMediaEl.pause?.();
        } else {
          Promise.resolve(wallpaperMediaEl.play?.()).catch(() => {});
        }
      }
    };

    const mountWallpaperFromStatus = status => {
      if (disposed || !doc?.body || currentOpts.enabled === false || !currentOpts.wallpaperEnabled) {
        removeWallpaper();
        return;
      }
      if (!status?.hasMedia || !status?.mediaUrl) {
        removeWallpaper();
        return;
      }
      const wantTag = status.kind === 'video' ? 'video' : 'img';
      if (!wallpaperLayer || !wallpaperLayer.isConnected) {
        wallpaperLayer = doc.createElement('div');
        wallpaperLayer.setAttribute?.('data-testid', 'agy-wallpaper-layer');
        wallpaperLayer.setAttribute?.('data-agy-optics-el', 'wallpaper');
        wallpaperLayer.setAttribute?.('aria-hidden', 'true');
        if (wallpaperLayer.style) {
          wallpaperLayer.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden';
        }
        doc.body.insertBefore?.(wallpaperLayer, doc.body.firstChild || null) ?? doc.body.appendChild?.(wallpaperLayer);
      }
      if (!wallpaperMediaEl || wallpaperMediaEl.tagName?.toLowerCase() !== wantTag || wallpaperMediaEl.getAttribute?.('src') !== status.mediaUrl) {
        wallpaperLayer.innerHTML = '';
        wallpaperMediaEl = doc.createElement(wantTag);
        wallpaperMediaEl.setAttribute?.('src', status.mediaUrl);
        if (wantTag === 'video') {
          wallpaperMediaEl.muted = true;
          wallpaperMediaEl.loop = true;
          wallpaperMediaEl.playsInline = true;
          wallpaperMediaEl.autoplay = true;
          wallpaperMediaEl.setAttribute?.('muted', '');
          wallpaperMediaEl.setAttribute?.('loop', '');
          wallpaperMediaEl.setAttribute?.('playsinline', '');
        }
        wallpaperDimEl = doc.createElement('div');
        wallpaperDimEl.setAttribute?.('data-agy-wallpaper-dim', '1');
        wallpaperLayer.appendChild?.(wallpaperMediaEl);
        wallpaperLayer.appendChild?.(wallpaperDimEl);
      }
      updateWallpaperPresentation();
    };

    const syncWallpaper = () => {
      if (!doc || currentOpts.enabled === false || !currentOpts.wallpaperEnabled) {
        removeWallpaper();
        return;
      }
      if (wallpaperStatusCache) {
        mountWallpaperFromStatus(wallpaperStatusCache);
        return;
      }
      if (!wallpaperFetching && typeof env.request === 'function') {
        wallpaperFetching = true;
        Promise.resolve(env.request('wallpaper.status', {}))
          .then(res => {
            wallpaperFetching = false;
            if (disposed) return;
            wallpaperStatusCache = res || null;
            if (currentOpts.enabled !== false && currentOpts.wallpaperEnabled) {
              mountWallpaperFromStatus(wallpaperStatusCache);
            }
          })
          .catch(() => { wallpaperFetching = false; });
      }
    };

    // 11. Trigger Vial Replacement in [data-testid="agy-context-ring-trigger"]
    const replacedTriggerButtons = new Set();

    const restoreTriggerVials = () => {
      for (const btn of replacedTriggerButtons) {
        const custom = btn.querySelector?.('[data-testid="agy-trigger-vial-svg"]');
        custom?.remove?.();
        const orig = btn.querySelector?.('[data-agy-vial-orig="1"]');
        if (orig) {
          orig.removeAttribute?.('data-agy-vial-orig');
          setInlineStyle(orig, 'display', null);
        }
      }
      replacedTriggerButtons.clear();
    };

    const syncTriggerVial = () => {
      if (!doc || currentOpts.enabled === false || currentOpts.contextStyle !== 'vial') {
        restoreTriggerVials();
        return;
      }
      const triggers = doc.querySelectorAll?.('[data-testid="agy-context-ring-trigger"]') || [];
      if (!triggers.length) return;
      const st = typeof env.state === 'function' ? env.state() : null;
      const pct = Number(st?.contextWindow?.usedPercent ?? 0);
      const streaming = isSignalStreaming(currentExecSignal);
      for (const trigger of triggers) {
        const nativeSvg = trigger.querySelector?.('svg:not([data-testid="agy-trigger-vial-svg"])');
        if (nativeSvg) {
          nativeSvg.setAttribute?.('data-agy-vial-orig', '1');
          setInlineStyle(nativeSvg, 'display', 'none');
        }
        const existing = trigger.querySelector?.('[data-testid="agy-trigger-vial-svg"]');
        const desc = renderTriggerVialSvg({ percent: pct, streaming });
        const node = desc.toNode(doc);
        if (node) {
          if (existing) existing.replaceWith?.(node);
          else trigger.insertBefore?.(node, trigger.firstChild || null) ?? trigger.appendChild?.(node);
        }
        replacedTriggerButtons.add(trigger);
      }
    };

    // 12. Mountable 96x200 Popover Vial Widget
    const mountedPopovers = new Set();
    let popoverSeq = 0;

    function mountPopoverVial(containerEl, initialProps = {}) {
      const taskId = `popover-vial-${++popoverSeq}`;
      let handle = null;
      handle = createStandalonePopoverVial(containerEl, initialProps, {
        uiText: getUiText,
        onInsertText: text => env.onInsertText?.(text),
        wake: () => scheduleWake(taskId),
        onUnmount: () => {
          sleepTask(taskId);
          tasks.delete(taskId);
          if (handle) mountedPopovers.delete(handle);
        }
      });
      if (!handle) return null;
      registerTask(taskId, dt => {
        const res = handle.stepAndDraw(dt);
        return !res.sleeping;
      });
      if (!handle.physics.getState().sleeping) scheduleWake(taskId);
      mountedPopovers.add(handle);
      return handle;
    }

    // 13. Interactive Pixel Companions (mascotMode: 'off' | 'crab' | 'cat' | 'pack')
    let mascotStage = null;
    let mascotCanvas = null;
    let mascotState = {
      mode: 'off',
      companions: [],
      peek: false,
      aurora: false,
      auroraRemainingMs: 0,
      sleeping: true,
      idleMs: 0
    };
    const mascotNodes = new Map();

    const ROSTER_BY_MODE = {
      crab: [{ id: 'clawd', kind: 'crab', label: 'Clawd', color: '#F97316', x: 24 }],
      cat: [{ id: 'mystic-cat', kind: 'cat', label: 'Mystic Cat', color: '#A855F7', x: 24 }],
      pack: [
        { id: 'clawd', kind: 'crab', label: 'Clawd', color: '#F97316', x: 16 },
        { id: 'mystic-cat', kind: 'cat', label: 'Mystic Cat', color: '#A855F7', x: 52 },
        { id: 'mini-crab-1', kind: 'mini-crab', label: 'Mini Crab 1', color: '#FB923C', x: 88 },
        { id: 'mini-crab-2', kind: 'mini-crab', label: 'Mini Crab 2', color: '#FDBA74', x: 118 },
        { id: 'mini-crab-3', kind: 'mini-crab', label: 'Mini Crab 3', color: '#EA580C', x: 148 }
      ]
    };

    const createPixelCompanionSvg = (kind, color) => {
      const svg = createSvgEl(doc, 'svg', {
        width: kind === 'mini-crab' ? 20 : 26,
        height: kind === 'mini-crab' ? 18 : 22,
        viewBox: '0 0 12 10',
        'shape-rendering': 'crispEdges',
        'aria-hidden': 'true'
      });
      const pixels = kind === 'cat'
        ? [
          [2, 1, 1, 2], [9, 1, 1, 2],
          [2, 3, 8, 5],
          [4, 5, 1, 1, '#FEF08A'], [7, 5, 1, 1, '#FEF08A'],
          [3, 8, 2, 2], [7, 8, 2, 2]
        ]
        : [
          [1, 2, 2, 2], [9, 2, 2, 2],
          [3, 3, 6, 4],
          [4, 4, 1, 1, '#0E0E11'], [7, 4, 1, 1, '#0E0E11'],
          [2, 7, 2, 2], [5, 7, 2, 2], [8, 7, 2, 2]
        ];
      for (const p of pixels) {
        svg.appendChild?.(createSvgEl(doc, 'rect', {
          x: p[0], y: p[1], width: p[2], height: p[3], fill: p[4] || color
        }));
      }
      return svg;
    };

    const checkPeekConflict = () => {
      if (!doc) return false;
      const hits = doc.querySelectorAll?.('.agy-goal-bar, [role="listbox"], [role="dialog"], [role="menu"]') || [];
      for (const el of hits) {
        if (el.getAttribute?.('aria-hidden') === 'true') continue;
        if (el.style?.display === 'none' || el.style?.getPropertyValue?.('display') === 'none') continue;
        return true;
      }
      return false;
    };

    const applyMascotDomState = () => {
      if (!mascotStage) return;
      mascotStage.setAttribute?.('data-mode', mascotState.mode);
      mascotStage.setAttribute?.('data-peek', mascotState.peek ? 'true' : 'false');
      mascotStage.setAttribute?.('data-aurora', mascotState.aurora ? 'true' : 'false');
      mascotStage.setAttribute?.('data-sleeping', mascotState.sleeping ? 'true' : 'false');

      for (const comp of mascotState.companions) {
        const el = mascotNodes.get(comp.id);
        if (!el) continue;
        el.setAttribute?.('data-stack-index', String(comp.stackIndex));
        if (comp.stackedOnId) el.setAttribute?.('data-stacked-on', comp.stackedOnId);
        else el.removeAttribute?.('data-stacked-on');
        if (el.style) {
          const yOffset = -comp.stackIndex * 18;
          el.style.left = `${Math.round(comp.x)}px`;
          el.style.transform = `translateY(${yOffset}px)`;
          el.style.zIndex = String(10 + comp.stackIndex);
        }
      }
    };

    const wakeMascot = () => {
      mascotState.idleMs = 0;
      mascotState.sleeping = false;
      applyMascotDomState();
      scheduleWake('mascot');
    };

    const evaluateStackAndAurora = () => {
      const n = mascotState.companions.length;
      if (n <= 0) return;
      const maxStack = mascotState.companions.reduce((m, c) => Math.max(m, c.stackIndex + 1), 1);
      const anyPetted = mascotState.companions.some(c => c.pets >= 3);
      if ((n >= 2 && maxStack >= Math.min(5, n)) || anyPetted) {
        mascotState.aurora = true;
        mascotState.auroraRemainingMs = 1800;
        wakeMascot();
      }
    };

    const stackCompanion = (sourceId, targetId) => {
      const src = mascotState.companions.find(c => c.id === sourceId);
      const dst = mascotState.companions.find(c => c.id === targetId);
      if (!src || !dst || src === dst) return false;
      const towerItems = mascotState.companions.filter(c => c.x === dst.x || c.id === dst.id || c.stackedOnId === dst.id);
      const nextIdx = Math.min(4, towerItems.reduce((m, c) => Math.max(m, c.stackIndex + 1), 1));
      src.x = dst.x;
      src.stackIndex = nextIdx;
      src.stackedOnId = dst.id;
      wakeMascot();
      evaluateStackAndAurora();
      applyMascotDomState();
      return true;
    };

    const petCompanion = id => {
      const comp = mascotState.companions.find(c => c.id === id);
      if (!comp) return;
      comp.pets += 1;
      wakeMascot();
      evaluateStackAndAurora();
      applyMascotDomState();
    };

    let mascotHostCard = null;
    let mascotHostPrevPos = null;

    const unmountMascot = () => {
      sleepTask('mascot');
      if (mascotCanvas) {
        reclaimCanvas(mascotCanvas);
        mascotCanvas = null;
      }
      mascotNodes.clear();
      if (mascotStage) {
        mascotStage.remove?.();
        mascotStage = null;
      }
      if (mascotHostCard) {
        setInlineStyle(mascotHostCard, 'position', mascotHostPrevPos);
        mascotHostCard = null;
        mascotHostPrevPos = null;
      }
      mascotState = {
        mode: 'off',
        companions: [],
        peek: false,
        aurora: false,
        auroraRemainingMs: 0,
        sleeping: true,
        idleMs: 0
      };
    };

    registerTask('mascot', dt => {
      if (!mascotStage || mascotState.mode === 'off' || currentOpts.enabled === false) {
        unmountMascot();
        return false;
      }
      mascotState.idleMs += dt;
      if (mascotState.aurora) {
        mascotState.auroraRemainingMs = Math.max(0, mascotState.auroraRemainingMs - dt);
        if (mascotState.auroraRemainingMs <= 0) {
          mascotState.aurora = false;
        }
      }
      const ctx = mascotCanvas?.getContext?.('2d');
      if (ctx && mascotCanvas) {
        if (mascotCanvas.width !== 240 || mascotCanvas.height !== 56) {
          mascotCanvas.width = 240;
          mascotCanvas.height = 56;
        }
        ctx.clearRect(0, 0, 240, 56);
        if (mascotState.aurora) {
          const hue = Math.round(((1800 - mascotState.auroraRemainingMs) * 0.25) % 360);
          ctx.fillStyle = `hsla(${hue}, 90%, 62%, 0.25)`;
          ctx.fillRect(0, 0, 240, 56);
        }
      }
      if (!mascotState.aurora && mascotState.idleMs >= 2000) {
        mascotState.sleeping = true;
        applyMascotDomState();
        if (mascotCanvas) reclaimCanvas(mascotCanvas);
        return false;
      }
      applyMascotDomState();
      return true;
    });

    const syncMascots = () => {
      const mode = currentOpts.enabled === false ? 'off' : (currentOpts.mascotMode || 'off');
      if (!doc || !ROSTER_BY_MODE[mode]) {
        unmountMascot();
        return;
      }
      const card = [...(doc.querySelectorAll?.('.surface-composer-card') || [])]
        .find(el => el.querySelector?.('[data-testid="model-selector-trigger"]'))
        || doc.querySelector?.('.surface-composer-card');
      if (!card) {
        unmountMascot();
        return;
      }

      if (!mascotStage || !mascotStage.isConnected || mascotStage.parentElement !== card || mascotState.mode !== mode) {
        unmountMascot();
        mascotState.mode = mode;
        mascotState.companions = ROSTER_BY_MODE[mode].map(item => ({
          ...item,
          stackIndex: 0,
          stackedOnId: '',
          pets: 0
        }));
        mascotState.peek = checkPeekConflict();
        mascotState.idleMs = 0;
        mascotState.sleeping = false;

        mascotStage = doc.createElement('div');
        mascotStage.setAttribute?.('data-testid', 'agy-mascot-stage');
        mascotStage.setAttribute?.('data-agy-optics-el', 'mascot-stage');

        mascotCanvas = doc.createElement('canvas');
        mascotCanvas.setAttribute?.('data-testid', 'agy-mascot-canvas');
        mascotCanvas.setAttribute?.('aria-hidden', 'true');
        if (mascotCanvas.style) {
          mascotCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
        }
        mascotStage.appendChild?.(mascotCanvas);

        for (const comp of mascotState.companions) {
          const itemEl = doc.createElement('div');
          itemEl.setAttribute?.('data-testid', 'agy-mascot-item');
          itemEl.setAttribute?.('data-mascot-id', comp.id);
          itemEl.setAttribute?.('data-mascot-kind', comp.kind);
          itemEl.setAttribute?.('title', comp.label);
          itemEl.appendChild?.(createPixelCompanionSvg(comp.kind, comp.color));

          let dragActive = false;
          let dragStartX = 0;
          let origX = comp.x;
          let moved = false;

          itemEl.addEventListener?.('pointerdown', e => {
            dragActive = true;
            moved = false;
            dragStartX = Number(e.clientX ?? 0);
            origX = comp.x;
            comp.stackIndex = 0;
            comp.stackedOnId = '';
            wakeMascot();
          });
          itemEl.addEventListener?.('pointermove', e => {
            if (!dragActive) return;
            const dx = Number(e.clientX ?? dragStartX) - dragStartX;
            if (Math.abs(dx) > 3) moved = true;
            comp.x = clamp(origX + dx, 0, 260);
            wakeMascot();
          });
          itemEl.addEventListener?.('pointerup', () => {
            if (!dragActive) return;
            dragActive = false;
            if (!moved) {
              petCompanion(comp.id);
              return;
            }
            const target = mascotState.companions.find(other =>
              other.id !== comp.id && Math.abs(other.x - comp.x) <= 28
            );
            if (target) stackCompanion(comp.id, target.id);
            else applyMascotDomState();
          });
          itemEl.addEventListener?.('click', () => {
            if (!moved) petCompanion(comp.id);
          });

          mascotNodes.set(comp.id, itemEl);
          mascotStage.appendChild?.(itemEl);
        }

        const prevPos = card.style?.getPropertyValue?.('position') ?? card.style?.position ?? '';
        if (card.style && (!prevPos || prevPos === 'static')) {
          mascotHostCard = card;
          mascotHostPrevPos = prevPos || null;
          setInlineStyle(card, 'position', 'relative');
        }
        card.appendChild?.(mascotStage);
        applyMascotDomState();
        scheduleWake('mascot');
      } else {
        mascotState.peek = checkPeekConflict();
        applyMascotDomState();
      }
    };

    // 14. Global Lifecycle Listeners & MutationObserver
    let rescanTimer = null;
    const scheduleRescan = () => {
      if (disposed || rescanTimer != null) return;
      rescanTimer = safeTimeout(() => {
        rescanTimer = null;
        if (disposed) return;
        syncSidebarNavFold();
        syncPlaceholderStyle();
        syncHomeRipple();
        syncTriggerVial();
        syncMascots();
      }, 24);
    };

    let observer = null;
    if (doc?.body && typeof MutationObserver === 'function') {
      observer = new MutationObserver(records => {
        if (disposed) return;
        let browserHoleChanged = false;
        let themeClassChanged = false;
        let conflictOrLayoutChanged = false;
        let textChanged = false;

        for (const rec of records) {
          if (rec.type === 'attributes') {
            if (rec.attributeName === 'data-has-browser-hole') browserHoleChanged = true;
            else if (rec.attributeName === 'class') themeClassChanged = true;
          } else if (rec.type === 'characterData') {
            const targetEl = asElement(rec.target);
            if (!targetEl?.closest?.('[data-agy-optics-el]')) textChanged = true;
          } else {
            const targetEl = asElement(rec.target);
            if (targetEl?.closest?.('[data-agy-optics-el]')) continue;
            conflictOrLayoutChanged = true;
          }
        }
        if (browserHoleChanged) updateWallpaperPresentation();
        if (themeClassChanged) syncStylesAndTokens();
        if ((textChanged || conflictOrLayoutChanged) && currentOpts.streamInk && isSignalStreaming(currentExecSignal)) {
          collectLatestStreamChunks();
        }
        if (conflictOrLayoutChanged) {
          if (mascotStage) {
            mascotState.peek = checkPeekConflict();
            applyMascotDomState();
          }
          scheduleRescan();
        }
      });
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-has-browser-hole', 'class'] });
      if (doc.documentElement && doc.documentElement !== doc.body) {
        observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
      }
    }

    const handleVisibility = () => {
      if (disposed) return;
      if (isWindowHidden()) {
        stopLoop();
        if (wallpaperMediaEl?.tagName?.toLowerCase() === 'video') wallpaperMediaEl.pause?.();
        if (mascotStage) {
          mascotState.sleeping = true;
          applyMascotDomState();
        }
      } else {
        updateWallpaperPresentation();
        if (hasActiveTasks()) scheduleWake(tasks.keys().next().value);
      }
    };

    doc?.addEventListener?.('visibilitychange', handleVisibility, listenerOpts);
    win?.addEventListener?.('blur', () => { winBlurred = true; handleVisibility(); }, listenerOpts);
    win?.addEventListener?.('focus', () => { winBlurred = false; handleVisibility(); }, listenerOpts);
    win?.addEventListener?.('popstate', () => syncHomeRipple(), listenerOpts);

    // Core public sync & dispose
    function sync(nextOptions, execSignal) {
      if (disposed) return;
      const baseOpts = nextOptions === undefined
        ? (typeof env.options === 'function' ? env.options() : currentOpts)
        : nextOptions;
      currentOpts = { ...DEFAULT_OPTS, ...(baseOpts || {}) };
      if (execSignal !== undefined) {
        currentExecSignal = execSignal;
      }

      syncStylesAndTokens();
      syncSidebarNavFold();
      syncPlaceholderStyle();
      syncStreamInk(currentExecSignal);
      syncConvAura(currentExecSignal);
      syncHomeRipple();
      syncWallpaper();
      syncTriggerVial();
      syncMascots();

      if (currentOpts.enabled === false || !currentOpts.smoothCaret || effectiveMotionLevel() === 'off') {
        removeCaretEl();
      }
      if (currentOpts.enabled === false || !currentOpts.prismRim || effectiveMotionLevel() === 'off') {
        clearPrismRim();
      }
      if (currentOpts.enabled === false || currentOpts.scrollBottomMotion !== 'smooth' || effectiveMotionLevel() === 'off') {
        cancelScrollGlide();
      }
    }

    function getThemeVars() {
      return computeThemeVars(currentOpts, detectDarkMode(doc));
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      stopLoop();
      for (const id of activeTimers) clearTimeout(id);
      activeTimers.clear();
      observer?.disconnect();
      observer = null;
      ac?.abort();

      clearStreamInk();
      removeCaretEl();
      cancelScrollGlide();
      clearPrismRim();
      unmountHomeRipple();
      removeWallpaper();
      unmountMascot();
      clearNavFold();
      restorePlaceholders();
      restoreTriggerVials();

      for (const p of [...mountedPopovers]) {
        p.unmount();
      }
      mountedPopovers.clear();

      if (doc) {
        const view = doc.querySelector?.('[data-testid="conversation-view"]');
        view?.removeAttribute?.('data-agy-conv-aura');
        for (const attr of [...appliedRootAttrs]) {
          doc.documentElement?.removeAttribute?.(attr);
        }
        appliedRootAttrs.clear();
        for (const v of [...appliedRootVars]) {
          doc.documentElement?.style?.removeProperty?.(v);
        }
        appliedRootVars.clear();
      }
      if (styleEl) {
        styleEl.remove?.();
        styleEl = null;
      }
      lastCssText = '';
      tasks.clear();
    }

    // Run initial sync cleanly
    sync(currentOpts, currentExecSignal);

    return {
      sync,
      setWallpaperStatus(status) {
        wallpaperStatusCache = status;
        if (status) syncWallpaper();
        else removeWallpaper();
      },
      dispose,
      getThemeVars,
      createVialPhysics,
      renderTriggerVialSvg,
      mountPopoverVial,
      stackCompanion,
      petCompanion,
      getDebugState: () => ({
        disposed,
        isDark: lastIsDark,
        resolvedPalette: lastResolvedPalette,
        auraState: lastAuraState,
        activeTaskCount: [...tasks.values()].filter(t => t.active).length,
        rafActive: rafId != null,
        mascot: {
          mode: mascotState.mode,
          peek: mascotState.peek,
          aurora: mascotState.aurora,
          sleeping: mascotState.sleeping,
          count: mascotState.companions.length,
          maxStack: mascotState.companions.reduce((m, c) => Math.max(m, c.stackIndex + 1), 0)
        },
        wallpaperMounted: Boolean(wallpaperLayer && wallpaperLayer.isConnected),
        wallpaperHiddenForBrowserHole: isBrowserHoleActive(),
        homeRippleMounted: Boolean(homeCanvas && homeCanvas.isConnected),
        inkSpanCount: inkSpans.length
      })
    };
  }

  createOptics.createVialPhysics = createVialPhysics;
  createOptics.renderTriggerVialSvg = renderTriggerVialSvg;
  createOptics.mountPopoverVial = createStandalonePopoverVial;
  globalThis.__agyCreateVialPhysics = createVialPhysics;
  globalThis.__agyOpticsHelpers = {
    createVialPhysics,
    renderTriggerVialSvg,
    mountPopoverVial: createStandalonePopoverVial
  };
  globalThis.__agyCreateOptics = createOptics;
})();
