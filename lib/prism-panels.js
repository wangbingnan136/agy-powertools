(() => {
  const DEFAULT_SCENE_PRESETS = Object.freeze({
    native: Object.freeze({
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
      wallpaperEnabled: false
    }),
    ultra: Object.freeze({
      themePalette: 'obsidian',
      ambientIntensity: 100,
      sidebarCompact: true,
      composerRestyle: true,
      placeholderStyle: 'studio',
      motionLevel: 'ultra',
      targetFps: 120,
      contextStyle: 'vial',
      smoothCaret: true,
      scrollBottomMotion: 'smooth',
      streamInk: true,
      convAura: true,
      prismRim: true,
      homeRipple: true,
      mascotMode: 'pack'
    }),
    focus: Object.freeze({
      themePalette: 'obsidian',
      ambientIntensity: 35,
      sidebarCompact: true,
      motionLevel: 'subtle',
      targetFps: 120,
      contextStyle: 'ring',
      smoothCaret: true,
      scrollBottomMotion: 'smooth',
      convAura: true,
      streamInk: false,
      prismRim: false,
      homeRipple: false,
      mascotMode: 'off',
      codeBlockFold: true,
      inlineStepDiff: true
    }),
    eco: Object.freeze({
      motionLevel: 'off',
      ambientIntensity: 0,
      contextStyle: 'ring',
      scrollBottomMotion: 'native',
      streamInk: false,
      convAura: false,
      prismRim: false,
      homeRipple: false,
      mascotMode: 'off',
      smoothCaret: false,
      wallpaperEnabled: false
    })
  });

  const LANGUAGE_ITEMS = Object.freeze([
    ['zh-CN', '简体中文'],
    ['zh-TW', '繁體中文'],
    ['yue', '粵語（香港）'],
    ['en', 'English'],
    ['ja', '日本語']
  ]);

  const SETTINGS_CATEGORIES = Object.freeze([
    'all',
    'optics',
    'workbench',
    'thought',
    'telemetry',
    'accounts',
    'beta'
  ]);

  const SUPPORTED_LANGS = new Set(['zh-CN', 'zh-TW', 'yue', 'en', 'ja']);
  const SENSITIVE_KEY_RE = /^(?:api[-_]?key|secret|password|passwd|access[-_]?token|refresh[-_]?token|credential|credentials)$/i;

  function sanitizeBundleForExport(input) {
    if (!input || typeof input !== 'object') return input;
    const stripProxyAuth = raw => {
      if (typeof raw !== 'string' || !raw.trim()) return '';
      try {
        const u = new URL(raw);
        if (!u.username && !u.password) return raw;
        const host = u.hostname.includes(':') && !u.hostname.startsWith('[') ? `[${u.hostname}]` : u.hostname;
        return `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}`;
      } catch {
        return raw.replace(/\/\/[^@/]+@/, '//');
      }
    };
    const walk = val => {
      if (val === null || typeof val !== 'object') return val;
      if (Array.isArray(val)) return val.map(walk);
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        if (SENSITIVE_KEY_RE.test(k)) continue;
        if (k === 'proxyUrl' && typeof v === 'string') {
          out[k] = stripProxyAuth(v);
        } else {
          out[k] = walk(v);
        }
      }
      return out;
    };
    return walk(input);
  }

  function formatMb(bytesOrMb) {
    const val = Number(bytesOrMb);
    if (!Number.isFinite(val) || val <= 0) return '0.0 MB';
    return `${val.toFixed(1)} MB`;
  }

  function bytesToMb(bytes) {
    const num = Number(bytes);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return num / (1024 * 1024);
  }

  function createPrismPanels(deps = {}) {
    const R = deps.R || globalThis.React || {};
    const h = deps.h || R.createElement;
    const env = deps.env || {};
    const supported = name => deps.capabilities?.[name] !== false;
    const t = typeof deps.t === 'function' ? deps.t : v => v;
    const Frag = R.Fragment || Symbol.for('react.fragment');
    const useState = R.useState || (init => [typeof init === 'function' ? init() : init, () => {}]);
    const useEffect = R.useEffect || (() => {});
    const useRef = R.useRef || (init => ({ current: init }));

    let styleEl = null;
    if (typeof document !== 'undefined' && document?.createElement && document?.head?.append) {
      styleEl = document.createElement('style');
      styleEl.dataset.agyPrismPanelsStyle = '';
      styleEl.textContent = `
        .pt-prism-catbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px;border-radius:10px;border:1px solid var(--border);background:color-mix(in oklab,var(--secondary) 24%,transparent)}
        .pt-prism-catbtn{height:28px;padding:0 10px;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--secondary-foreground);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;transition:background 120ms ease,color 120ms ease,border-color 120ms ease}
        .pt-prism-catbtn:hover{background:var(--secondary);color:var(--foreground)}
        .pt-prism-catbtn[aria-pressed=true]{background:var(--card);color:var(--foreground);border-color:color-mix(in srgb,var(--primary) 42%,var(--border));font-weight:500}
        .pt-prism-presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:12px 14px}
        .pt-prism-preset{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:color-mix(in srgb,var(--secondary) 32%,var(--background));color:var(--foreground);text-align:left;cursor:pointer;font:inherit;transition:border-color 120ms ease,background 120ms ease}
        .pt-prism-preset:hover{background:var(--secondary)}
        .pt-prism-preset[aria-pressed=true]{border-color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,var(--card))}
        .pt-prism-preset-title{font-size:13px;font-weight:600;line-height:1.3}
        .pt-prism-preset-desc{font-size:11.5px;line-height:1.4;color:var(--muted-foreground)}
        .pt-prism-block{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
        .pt-prism-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
        .pt-prism-textarea{width:100%;min-height:84px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--background);color:var(--foreground);font:inherit;font-size:12.5px;line-height:1.5;resize:vertical;box-sizing:border-box;outline:none}
        .pt-prism-textarea:focus{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 20%,transparent)}
        .pt-prism-range-wrap{display:inline-flex;align-items:center;gap:10px;min-width:170px}
        .pt-prism-range{width:120px;accent-color:var(--primary);cursor:pointer}
        .pt-prism-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .pt-prism-chip{height:24px;padding:0 9px;border-radius:9999px;border:1px solid var(--border);background:var(--secondary);color:var(--secondary-foreground);font:inherit;font-size:11.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
        .pt-prism-chip[aria-pressed=true]{border-color:var(--primary);background:color-mix(in srgb,var(--primary) 14%,transparent);color:var(--foreground);font-weight:500}
        .pt-prism-profile-list{display:flex;flex-direction:column;gap:6px}
        .pt-prism-profile-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:color-mix(in srgb,var(--secondary) 28%,var(--background))}
        .pt-prism-profile-item[data-active=true]{border-color:color-mix(in srgb,var(--primary) 45%,var(--border));background:color-mix(in srgb,var(--primary) 8%,var(--card))}
        .pt-prism-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        @media(max-width:720px){.pt-prism-presets,.pt-prism-grid2{grid-template-columns:1fr}}
      `;
      document.head.append(styleEl);
    }

    const toTw = str => (typeof globalThis.__agyToZhTw === 'function' ? globalThis.__agyToZhTw(str) : str);

    const resolveLanguage = langOverride => {
      const lang = langOverride || env?.options?.()?.language || 'zh-CN';
      return SUPPORTED_LANGS.has(lang) ? lang : 'zh-CN';
    };

    function tr5(zhCN, en, ja, yue, langOverride) {
      const lang = resolveLanguage(langOverride);
      if (lang === 'en') return en ?? zhCN;
      if (lang === 'ja') return ja ?? en ?? zhCN;
      if (lang === 'yue') return yue ?? toTw(zhCN);
      if (lang === 'zh-TW') return toTw(zhCN);
      return zhCN;
    }

    const PRESETS = env.scenePresets || globalThis.__agyScenePresets || DEFAULT_SCENE_PRESETS;
    const optsOf = () => env?.options?.() || {};

    const Uy = deps.Uy || ((props, ...children) => h('button', { type: 'button', ...props }, ...children));
    const TP = deps.TP || (({ children, ...rest }) => h('div', { className: 'agy-card rounded-xl border border-border overflow-hidden divide-y divide-border', ...rest }, children));
    const UP = deps.UP || (({ label, description, rightElement, extraContent, ...rest }) => h('div', { className: 'pt-row p-3', ...rest },
      h('div', null, h('div', null, label), description && h('div', { className: 'pt-muted' }, description), extraContent),
      rightElement));
    const XP = deps.XP || (({ checked, onCheckedChange, ...rest }) => h('input', {
      type: 'checkbox',
      role: 'switch',
      checked: Boolean(checked),
      onChange: e => onCheckedChange?.(Boolean(e?.target?.checked)),
      ...rest
    }));
    const Select = deps.Select || (({ value, onChange, label, items, testId }) => h('select', {
      value: String(value ?? ''),
      'aria-label': t(label),
      'data-testid': testId,
      onChange: e => onChange?.(e?.target?.value)
    }, ...items.map(([k, name]) => h('option', { key: k, value: String(k), 'data-testid': testId ? `${testId}-${k}` : undefined }, t(name)))));

    const section = typeof deps.section === 'function'
      ? deps.section
      : (title, children) => h('section', { className: 'pt-stack' }, h('h3', { className: 'pt-section-title' }, t(title)), children);

    const card = typeof deps.card === 'function'
      ? deps.card
      : (title, children, right) => h('section', { className: 'pt-card' }, h('div', { className: 'pt-card-head' }, h('h2', null, t(title)), right), children);

    const icon = typeof deps.icon === 'function'
      ? deps.icon
      : (name, size = 16, extra = {}) => h('span', { 'data-icon': name, style: { fontSize: size }, ...extra });

    const defaultToggle = (key, label, description) => {
      const opts = optsOf();
      const resolvedLabel = t(label);
      return h(UP, {
        key,
        label: resolvedLabel,
        description,
        descriptionId: description ? `agy-setting-description-${key}` : undefined,
        'data-testid': `agy-setting-row-${key}`,
        rightElement: h(XP, {
          checked: Boolean(opts[key]),
          onCheckedChange: value => { void env?.change?.({ [key]: value }); },
          'aria-label': resolvedLabel,
          'aria-describedby': description ? `agy-setting-description-${key}` : undefined,
          'data-testid': `agy-setting-${key}`
        })
      });
    };

    const toggleRow = (key, label, description) => (
      typeof deps.toggle === 'function'
        ? deps.toggle(key, label, description)
        : defaultToggle(key, label, description)
    );

    const selectRow = (key, label, description, items, coerce = v => v) => {
      const opts = optsOf();
      return h(UP, {
        key,
        label: t(label),
        description,
        descriptionId: description ? `agy-setting-description-${key}` : undefined,
        'data-testid': `agy-setting-row-${key}`,
        rightElement: h(Select, {
          value: opts[key],
          onChange: next => { void env?.change?.({ [key]: coerce(next) }); },
          label,
          testId: `agy-setting-${key}`,
          items
        })
      });
    };

    function SettingsCategoryFilter({ hiddenCategories = [], value = 'all', onChange } = {}) {
      const active = SETTINGS_CATEGORIES.includes(value) ? value : 'all';
      const items = [
        ['all', tr5('全部', 'All', 'すべて', '全部')],
        ['optics', tr5('界面与光学', 'Interface & Optics', '外観と光学', '介面與光學')],
        ['workbench', tr5('交互与工作台', 'Workbench', 'ワークベンチ', '互動與工作台')],
        ['thought', tr5('思考转译', 'Thought Translator', '思考翻訳', '思考轉譯')],
        ['telemetry', tr5('统计与进度', 'Telemetry & Progress', '統計と進捗', '統計與進度')],
        ['accounts', tr5('账号与代理', 'Accounts & Proxy', 'アカウントとプロキシ', '帳號與代理')],
        ['beta', tr5('实验与归档', 'Beta & Archive', '実験とアーカイブ', '實驗與歸檔')]
      ];
      return h('nav', {
        className: 'pt-prism-catbar',
        role: 'tablist',
        'aria-label': tr5('设置分类筛选', 'Settings category filter', '設定カテゴリ', '設定分類篩選'),
        'data-testid': 'agy-settings-category-filter'
      }, ...items.filter(([key]) => !hiddenCategories.includes(key)).map(([key, label]) => h('button', {
        key,
        type: 'button',
        role: 'tab',
        className: 'pt-prism-catbtn',
        'aria-selected': active === key,
        'aria-pressed': active === key,
        'data-testid': `agy-settings-cat-${key}`,
        onClick: () => onChange?.(key),
        onKeyDown: event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const idx = items.findIndex(([id]) => id === active);
          const nextIdx = event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (idx + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
          onChange?.(items[nextIdx][0]);
          event.currentTarget?.parentElement?.children?.[nextIdx]?.focus?.();
        }
      }, label)));
    }

    function ScenePresetBar() {
      const opts = optsOf();
      const presets = [
        [
          'native',
          tr5('原生清爽', 'Native Clean', 'ネイティブ', '原生清爽'),
          tr5('恢复默认视觉与动效，保留账号与代理', 'Reset visuals and motion while keeping accounts and proxy', 'アカウントとプロキシを残して外観を初期化', '還原預設視覺同動效，保留帳號同代理')
        ],
        [
          'ultra',
          tr5('完整光效', 'Ultra Optics', 'フル光学', '完整光效'),
          tr5('深空黑曜、水波试管、流式墨迹与像素伙伴', 'Obsidian, water vial, stream ink, and pixel companions', 'オブシディアン、バイアル、インク演出を有効化', '深空黑曜、水波試管、流式墨跡同像素夥伴')
        ],
        [
          'focus',
          tr5('专注编码', 'Focus Coding', '集中コーディング', '專注寫碼'),
          tr5('深色护眼、顺滑光标与代码折叠 diff 预览', 'Dark low-distraction palette, smooth caret, and inline diff', '低刺激ダーク配色と滑らかカーソル、折りたたみ', '深色護眼、順滑游標同程式碼折疊差異預覽')
        ],
        [
          'eco',
          tr5('静默省电', 'Silent Eco', '省電力エコ', '靜默省電'),
          tr5('关闭高耗能动画与壁纸，保持 0fps 静默', 'Disable animations and wallpaper for 0fps idle power', 'アニメーションと壁紙を停止し 0fps 省電力化', '關閉高耗能動畫同壁紙，保持 0fps 靜默')
        ]
      ];
      const matchesPreset = patch => Object.entries(patch).every(([k, v]) => opts[k] === v);
      return section(
        tr5('场景预设', 'Scene presets', 'シーンプリセット', '場景預設'),
        h(TP, { 'data-testid': 'agy-scene-preset-bar' },
          h('div', { className: 'pt-prism-presets' }, ...presets.map(([key, title, desc]) => {
            const patch = PRESETS[key] || {};
            const isActive = Object.keys(patch).length > 0 && matchesPreset(patch);
            return h('button', {
              key,
              type: 'button',
              className: 'pt-prism-preset',
              'aria-pressed': isActive,
              'data-testid': `agy-scene-preset-${key}`,
              onClick: () => { void env?.change?.({ ...patch }); }
            },
            h('span', { className: 'pt-prism-preset-title' }, title),
            h('span', { className: 'pt-prism-preset-desc' }, desc));
          }))
        )
      );
    }

    function OpticsSettingsSection() {
      return h('div', { className: 'pt-stack', 'data-testid': 'agy-optics-settings-section' },
        section(
          tr5('外观与光学主题', 'Appearance & Optical Theme', '外観と光学テーマ', '外觀與光學主題'),
          h(TP, null,
            selectRow(
              'themePalette',
              tr5('光学配色主题', 'Optical theme palette', '光学カラーパレット', '光學配色主題'),
              tr5('选择深空黑曜或暖炭玄岩，或保持原生跟随。', 'Choose Obsidian or Warm Basalt, or follow native client colors.', 'オブシディアン、ウォーム玄岩、または既定を選択します。', '揀選深空黑曜或暖炭玄岩，或者跟隨原生配色。'),
              [
                ['native', tr5('原生跟随', 'Native', 'ネイティブ', '原生跟隨')],
                ['obsidian', tr5('深空黑曜', 'Obsidian', 'オブシディアン', '深空黑曜')],
                ['warm', tr5('暖炭玄岩', 'Warm Basalt', 'ウォーム玄岩', '暖炭玄岩')]
              ]
            ),
            selectRow(
              'lightThemePreset',
              tr5('浅色画布预设', 'Light theme preset', 'ライトテーマプリセット', '淺色畫布預設'),
              tr5('浅色模式下切换冷晶或暖白画册底色。', 'Choose Crystal Day or Alabaster Paper when in light mode.', 'ライトモード時の背景色を選択します。', '淺色模式底下切換白晝冷晶或者暖白畫冊底色。'),
              [
                ['crystal', tr5('白昼冷晶', 'Crystal Day', 'クリスタル', '白晝冷晶')],
                ['alabaster', tr5('暖白画册', 'Alabaster Paper', 'アラバスター', '暖白畫冊')]
              ]
            ),
            selectRow(
              'accentTone',
              tr5('强调色调', 'Accent tone', 'アクセントカラー', '強調色調'),
              tr5('自定义全局焦点与高亮主色。', 'Customize primary accent hue for focus and highlights.', 'フォーカスと強調表示のメインカラーを設定します。', '自訂全域焦點同高亮主色。'),
              [
                ['follow', tr5('跟随主题', 'Follow theme', 'テーマ準拠', '跟隨主題')],
                ['cobalt', tr5('钴蓝', 'Cobalt', 'コバルト', '鈷藍')],
                ['iris', tr5('鸢尾紫', 'Iris', 'アイリス', '鳶尾紫')],
                ['amber', tr5('琥珀金', 'Amber', 'アンバー', '琥珀金')],
                ['mono', tr5('极简黑白', 'Monochrome', 'モノクロ', '極簡黑白')]
              ]
            ),
            selectRow(
              'cornerStyle',
              tr5('圆角风格', 'Corner style', '角丸スタイル', '圓角風格'),
              tr5('调整卡片与输入框的几何圆角曲率。', 'Adjust corner radius across cards and composer.', 'カードや入力欄の角丸を調整します。', '調整卡片同輸入框嘅幾何圓角曲率。'),
              [
                ['sharp', tr5('锐利方角', 'Sharp (4px)', 'シャープ', '銳利方角')],
                ['balanced', tr5('均衡圆角', 'Balanced', 'バランス', '均衡圓角')],
                ['soft', tr5('柔和圆润', 'Soft (16px)', 'ソフト', '柔和圓潤')]
              ]
            ),
            selectRow(
              'codeFont',
              tr5('代码字体', 'Code font', 'コードフォント', '程式碼字體'),
              tr5('指定代码块与内联代码的等宽字体。', 'Choose monospace font family for code blocks and inline code.', 'コード表示用の等幅フォントを選択します。', '指定程式碼區塊同行內程式碼嘅等寬字體。'),
              [
                ['default', tr5('系统默认', 'Default', 'デフォルト', '系統預設')],
                ['jetbrains', 'JetBrains Mono'],
                ['sfmono', 'SF Mono'],
                ['fira', 'Fira Code']
              ]
            ),
            toggleRow(
              'codeLigatures',
              tr5('启用代码连字', 'Code ligatures', 'コードリガチャ', '啟用程式碼連字'),
              tr5('开启等宽字体的编程符号连字渲染。', 'Enable programming ligatures in code blocks.', 'コードブロックで合字表示を有効にします。', '開啟等寬字體嘅編程符號連字渲染。')
            ),
            selectRow(
              'ambientIntensity',
              tr5('环境光效强度', 'Ambient intensity', 'アンビエント光強度', '環境光效強度'),
              tr5('控制面板与边缘光学层的环境光浓度。', 'Control ambient optical glow opacity across surfaces.', '環境光エフェクトの強さを調整します。', '控制面板同邊緣光學層嘅環境光濃度。'),
              [
                [0, tr5('0% (关闭)', '0% (Off)', '0% (オフ)', '0% (關閉)')],
                [35, tr5('35% (轻柔)', '35% (Subtle)', '35% (控えめ)', '35% (輕柔)')],
                [70, tr5('70% (均衡)', '70% (Balanced)', '70% (標準)', '70% (均衡)')],
                [100, tr5('100% (饱满)', '100% (Full)', '100% (最大)', '100% (飽滿)')]
              ],
              Number
            ),
            toggleRow(
              'sidebarCompact',
              tr5('紧凑侧栏会话行', 'Compact sidebar rows', 'サイドバー行をコンパクト化', '緊湊側欄會話行'),
              tr5('收紧左侧栏会话列表行高至 26px，容纳更多历史对话。', 'Tighten sidebar conversation row height to 26px.', 'サイドバーの会話行の高さを 26px に詰めます。', '收緊左側欄會話清單行高至 26px，容納更多對話。')
            ),
            toggleRow(
              'sidebarNavFold',
              tr5('折叠次要侧栏导航', 'Fold secondary nav items', '補助ナビを折りたたむ', '折疊次要側欄導航'),
              tr5('将自动化与自定义等低频入口收纳为可展开开关。', 'Fold secondary nav items while keeping New Chat and Powertools visible.', '新規チャットと Powertools 以外の項目を折りたたみます。', '將自動化同自訂等入口收納為可展開開關。')
            ),
            toggleRow(
              'composerRestyle',
              tr5('重塑输入框玻璃质感', 'Restyle composer card', '入力欄の光学リスタイル', '重塑輸入框玻璃質感'),
              tr5('为对话输入框添加细腻层次边框与透光阴影。', 'Apply refined surface elevation and subtle border polish to composer.', '入力カードに立体的な境界線と陰影を適用します。', '為對話輸入框加上細膩層次邊框同透光陰影。')
            ),
            selectRow(
              'placeholderStyle',
              tr5('输入框占位提示风格', 'Placeholder style', 'プレースホルダー表示', '輸入框佔位提示風格'),
              tr5('切换原生提示词或简洁工作台提示语。', 'Switch between native composer placeholder or clean Studio copy.', '入力欄のガイド文言を切り替えます。', '切換原生提示語或者簡潔工作台提示語。'),
              [
                ['native', tr5('原生提示', 'Native', 'ネイティブ', '原生提示')],
                ['studio', tr5('工作台风格', 'Studio', 'スタジオ', '工作台風格')]
              ]
            ),
            selectRow(
              'logoInk',
              tr5('首页标志着色', 'Home greeting logo ink', 'ホームロゴ配色', '首頁標誌著色'),
              tr5('调整首页欢迎图标使用强调色或前景色。', 'Choose accent color or foreground ink for the home greeting mark.', 'ホーム画面のロゴにアクセント色または前景色を使用します。', '調整首頁歡迎圖示用強調色定前景色。'),
              [
                ['accent', tr5('强调色', 'Accent', 'アクセント', '強調色')],
                ['foreground', tr5('前景色', 'Foreground', '前景色', '前景色')]
              ]
            )
          )
        ),
        section(
          tr5('动效、水波与像素伙伴', 'Motion, Optics & Companions', 'モーション・光学・コンパニオン', '動效、水波同像素夥伴'),
          h(TP, null,
            selectRow(
              'motionLevel',
              tr5('动效物理等级', 'Motion choreography level', 'モーションレベル', '動效物理等級'),
              tr5('控制动画平滑度与物理粒子响应强度；静止后自动回归 0fps。', 'Control motion richness; all engines automatically sleep at 0fps when idle.', '動きの強度を設定します。待機時は自動で 0fps になります。', '控制動畫平滑度同物理粒子響應強度；靜止後自動回歸 0fps。'),
              [
                ['off', tr5('关闭', 'Off', 'オフ', '關閉')],
                ['subtle', tr5('轻微缓动', 'Subtle', '控えめ', '輕微緩動')],
                ['standard', tr5('标准动效', 'Standard', '標準', '標準動效')],
                ['ultra', tr5('极致流光', 'Ultra', 'ウルトラ', '極致流光')]
              ]
            ),
            selectRow(
              'targetFps',
              tr5('目标帧率上限', 'Target FPS cap', '目標フレームレート上限', '目標幀率上限'),
              tr5('限制物理动画最高帧率；设为 0 时跟随系统原生调度。', 'Cap animation loop FPS; set 0 for native scheduling.', 'アニメーションの上限 FPS を制限します（0 でネイティブ）。', '限制動畫最高幀率；設為 0 時跟隨系統調度。'),
              [
                [60, '60 FPS'],
                [120, '120 FPS'],
                [180, '180 FPS'],
                [0, tr5('跟随系统', 'Native', 'ネイティブ', '跟隨系統')]
              ],
              Number
            ),
            selectRow(
              'contextStyle',
              tr5('上下文指示器样式', 'Context indicator style', 'コンテキスト表示形式', '上下文指示器樣式'),
              tr5('在经典上下文圆环与物理水波试管之间切换。', 'Switch between classic context ring and shallow-water physics vial.', 'クラシックリングと物理ウォーターバイアルを切り替えます。', '喺經典上下文圓環同物理水波試管之間切換。'),
              [
                ['ring', tr5('圆环', 'Ring', 'リング', '圓環')],
                ['vial', tr5('水波试管', 'Water Vial', '水波バイアル', '水波試管')]
              ]
            ),
            toggleRow(
              'smoothCaret',
              tr5('丝滑光标跟随', 'Smooth gliding caret', 'スムースキャレット', '絲滑游標跟隨'),
              tr5('为输入框光标增加轻量平滑插值跟随，停顿 600ms 后自动休眠。', 'Render a soft gliding caret overlay in the composer that sleeps after 600ms idle.', '入力欄のカーソル移動を滑らかに補間します。', '為輸入框游標加上輕量平滑跟隨，停頓后自動休眠。')
            ),
            selectRow(
              'scrollBottomMotion',
              tr5('回到底部滚动动效', 'Scroll-to-bottom motion', '最下部スクロール演出', '回到底部捲動動效'),
              tr5('拦截回底按钮，提供约 260ms 惯性顺滑滚动，手动滚轮立即让步。', 'Use fast inertial glide when jumping to bottom, yielding immediately on wheel.', '最下部移動を滑らかな慣性スクロールにします。', '攔截回底按鈕，提供慣性順滑捲動，手動滾輪即時讓步。'),
              [
                ['native', tr5('原生跳底', 'Native', 'ネイティブ', '原生跳底')],
                ['smooth', tr5('顺滑惯性', 'Smooth', 'スムーズ', '順滑慣性')]
              ]
            ),
            toggleRow(
              'streamInk',
              tr5('流式墨迹渐现', 'Streaming ink fade', 'ストリーミングインク演出', '流式墨跡漸現'),
              tr5('基于 CSS Highlights 实现零 DOM 拆分的流式生成文字 5 阶渐现。', 'Use CSS Highlights for 5-stage fade-in during streaming without splitting DOM nodes.', 'DOM を分割せず CSS Highlights で生成文字を段階表示します。', '透過 CSS Highlights 實現零 DOM 拆分流式漸現。')
            ),
            toggleRow(
              'convAura',
              tr5('会话状态边缘光晕', 'Conversation edge aura', '会話ステータス光輪', '會話狀態邊緣光暈'),
              tr5('在等待审批、异常报错或后台完成时呈现柔和三态边缘光晕。', 'Show subtle semantic edge glow for waiting, error, and background-done states.', '承認待ちやエラー、完了を画面端の光で通知します。', '喺等待審批、錯誤或背景完成時顯示柔和邊緣光暈。')
            ),
            toggleRow(
              'prismRim',
              tr5('棱镜指针边缘高光', 'Prism rim highlight', 'プリズムリムハイライト', '稜鏡指標邊緣高光'),
              tr5('指针靠近输入框边缘时呈现细腻径向光斑，移开后归零休眠。', 'Subtle radial border sheen tracking pointer proximity on composer card.', 'ポインタに反応する微細な境界ハイライトを表示します。', '滑鼠靠近輸入框邊緣時呈現微細光斑，移開即休眠。')
            ),
            toggleRow(
              'homeRipple',
              tr5('首页字符波纹矩阵', 'Home dot-matrix ripple', 'ホームドット波紋', '首頁字元波紋矩陣'),
              tr5('在首页空白区域点击可激发字符点阵扩散波纹，1.2s 后自动静默。', 'Interactive character ripple canvas on Home that settles to 0fps after 1.2s.', 'ホーム画面のクリックで広がるドット波紋を描画します。', '喺首頁空白位點擊可激發字元點陣波紋，完畢後自動靜默。')
            ),
            selectRow(
              'mascotMode',
              tr5('像素桌宠伙伴', 'Pixel companions', 'ピクセルコンパニオン', '像素桌寵夥伴'),
              tr5('在主输入框上沿停驻可拖拽叠叠乐的像素小蟹或小紫猫，弹窗出现时自动避让。', 'Anchor draggable pixel companions atop composer; auto-peeks behind open menus.', '入力欄上部にドラッグ可能なドット絵マスコットを配置します。', '喺主輸入框邊緣放置可拖曳疊疊樂像素夥伴，選單彈出時自動讓位。'),
              [
                ['off', tr5('关闭', 'Off', 'オフ', '關閉')],
                ['crab', tr5('像素蟹 Clawd', 'Pixel Crab Clawd', 'ピクセルカニ Clawd', '像素蟹 Clawd')],
                ['cat', tr5('小紫猫', 'Purple Cat', 'パープルキャット', '小紫貓')],
                ['pack', tr5('全家福叠叠乐', 'Companion Pack', 'コンパニオンパック', '全家福疊疊樂')]
              ]
            )
          )
        )
      );
    }

    function PickedMediaPreview() {
      const [error, setError] = useState('');
      const label = tr5('预览本地媒体或字体', 'Preview local media or fonts', 'ローカルメディア・フォントをプレビュー', '預覽本機媒體或字型');
      return h(UP, { label,
        description: error || tr5('只读取你选中的文件，不启动文件服务器。', 'Only reads the selected file; no file server is started.', '選択したファイルだけを読み込みます。', '只讀取你揀嘅檔案，唔會啟動檔案伺服器。'),
        rightElement: h('input', { type: 'file', accept: '.png,.jpeg,.jpg,.gif,.webp,.avif,.mp4,.webm,.mp3,.wav,.ogg,.m4a,.flac,.woff,.woff2,.ttf,.otf', 'aria-label': label,
          'data-testid': 'agy-local-media-preview', onChange: async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try { setError(''); await env.prism.openPickedMedia(file); }
            catch (err) { setError(err.message); }
          } })
      });
    }

    function WorkbenchSettingsSection() {
      return h('div', { className: 'pt-stack', 'data-testid': 'agy-workbench-settings-section' },
        section(
          tr5('交互与工作台', 'Workbench & Productivity', 'ワークベンチと操作性', '互動與工作台'),
          h(TP, null,
            toggleRow(
              'effortSlider',
              tr5('模型推理深度滑杆', 'Reasoning effort slider', '推論深度スライダー', '模型推理深度滑桿'),
              tr5('在模型选择器内嵌星标滑杆或棱镜指示条，直观调节 Low 至 XHigh。', 'Embed an interactive effort slider inside the model selector menu.', 'モデル選択メニューに推論深度スライダーを表示します。', '喺模型選擇器內嵌滑桿，直觀調節 Low 到 XHigh。')
            ),
            toggleRow(
              'effortMemory',
              tr5('按模型记忆推理深度', 'Per-model effort memory', 'モデル別推論深度の記憶', '按模型記憶推理深度'),
              tr5('自动记住每个模型上次选择的推理深度，切换模型时无感恢复。', 'Remember and restore the last chosen effort level per model.', 'モデルごとに前回の推論深度を自動復元します。', '自動記住每個模型上次揀嘅推理深度，切換時自動還原。')
            ),
            toggleRow(
              'codeBlockFold',
              tr5('长代码块吸顶与折叠', 'Code block sticky header & fold', 'コードブロック固定ヘッダーと折りたたみ', '長程式碼區塊吸頂同折疊'),
              tr5('为超过 48 行的已完成代码块提供手动折叠按钮并保持滚动锚点稳定。', 'Add sticky headers and manual fold controls for 48+ line code blocks.', '48 行以上のコードブロックに手動折りたたみボタンを追加します。', '為超過 48 行嘅已完成程式碼區塊提供手動折疊，並保持捲動位置穩定。')
            ),
            toggleRow(
              'railHoverOutline',
              tr5('目录悬停过滤与快捷键', 'Rail hover outline & Alt+Up/Down', 'ホバー目次と Alt+上下ジャンプ', '目錄懸停過濾同快捷鍵'),
              tr5('悬停会话目录可关键词过滤全部提问，支持 Alt+方向键快速跳转轮次。', 'Enhance turn outline with hover prompt filter, step collapse, and Alt+Up/Down.', '目次のホバー検索、ステップ折りたたみ、Alt+上下移動を有効にします。', '懸停目錄可搜尋全部提問，支援 Alt+方向鍵跳轉輪次。')
            ),
            toggleRow(
              'inlineStepDiff',
              tr5('步骤内联 Diff 预览', 'Inline step diff preview', 'ステップ内インライン Diff', '步驟內聯 Diff 預覽'),
              tr5('点击步骤中的文件变更计数条即可展开语法着色的内联差异预览。', 'Expand syntax-tinted diff drawers directly on step file-change chips.', 'ステップ内の変更ファイル表示からインライン差分を展開します。', '點擊步驟入面嘅檔案變更條即可展開內聯差異預覽。')
            ),
            env.prism && h(PickedMediaPreview),
            supported('omni') && toggleRow(
              'omniViewer',
              tr5('全能流式侧栏预览 (Omni)', 'Omni streaming viewer', 'Omni ストリーミングビューア', '全能流式側欄預覽 (Omni)'),
              tr5('支持音视频 206 流式播放、表格检索、字体瀑布流及图表的右侧抽屉预览。', 'Enable right-side streaming preview drawer for media, tables, fonts, and SVGs.', '動画、音声、CSV、フォント等を右ペインでプレビューします。', '支援影音 206 流式播放、表格搜尋、字體同圖表側欄預覽。')
            ),
            supported('omni') && selectRow(
              'linkTarget',
              tr5('裸链接默认打开方式', 'Bare link open target', 'リンクの既定の開き方', '純連結預設開啟方式'),
              tr5('点击对话中的普通网址或本地路径时优先使用的打开目标（按住 Cmd/Ctrl 反转）。', 'Choose whether plain URLs open in the built-in drawer or system browser.', '平文 URL クリック時の既定ターゲットを選択します。', '點擊對話中嘅網址或本機路徑時預設開啟目標（按住 Cmd/Ctrl 反轉）。'),
              [
                ['builtin', tr5('右侧内置面板', 'Built-in panel', '内蔵パネル', '右側內置面板')],
                ['external', tr5('系统浏览器', 'System browser', 'システムブラウザ', '系統瀏覽器')]
              ]
            ),
            toggleRow(
              'quickContextMenu',
              tr5('对话选区快捷菜单', 'Quick conversation context menu', '会話クイックメニュー', '對話選區快捷選單'),
              tr5('右键对话文本一键触发复制、/side 追问或斜杠命令（按住 Shift 右键保留系统菜单）。', 'Right-click prose for Copy, /side, and slash actions (Shift+Right-Click for OS menu).', '右クリックでコピーや /side 等を実行します（Shift 併用で標準メニュー）。', '右鍵對話內容一鍵複製、/side 追問或快捷指令（按住 Shift 保留系統選單）。')
            )
          )
        )
      );
    }

    function ThoughtSettingsSection() {
      const opts = optsOf();
      const [diagBusy, setDiagBusy] = useState(false);
      const [diagResult, setDiagResult] = useState(null);
      const [cacheBusy, setCacheBusy] = useState(false);
      const [cacheFeedback, setCacheFeedback] = useState('');
      const [promptDraft, setPromptDraft] = useState(() => String(opts.thoughtCustomPrompt || ''));
      const [profilesState, setProfilesState] = useState({ activeProfileId: '', profiles: [], cacheEntries: 0 });
      const [draft, setDraft] = useState({ id: '', name: '', baseUrl: '', apiKey: '', model: '' });
      const [modelsList, setModelsList] = useState([]);
      const [modelsBusy, setModelsBusy] = useState(false);
      const [profileBusy, setProfileBusy] = useState(false);
      const [profileNotice, setProfileNotice] = useState('');
      const [testBusy, setTestBusy] = useState(false);
      const [testResult, setTestResult] = useState(null);

      useEffect(() => {
        setPromptDraft(String(opts.thoughtCustomPrompt || ''));
      }, [opts.thoughtCustomPrompt]);

      const loadProfiles = async () => {
        if (typeof env?.request !== 'function') return;
        try {
          const res = await env.request('thought.profiles.get');
          if (!res) return;
          const profiles = Array.isArray(res.profiles) ? res.profiles : [];
          const activeId = res.activeProfileId || profiles[0]?.id || '';
          setProfilesState({ activeProfileId: activeId, profiles, cacheEntries: Number(res.cacheEntries || 0) });
          const active = profiles.find(p => p.id === activeId) || profiles[0];
          if (active) {
            setDraft({
              id: active.id || '',
              name: active.name || '',
              baseUrl: active.baseUrl || '',
              apiKey: active.apiKey || '',
              model: active.model || ''
            });
          }
        } catch { /* Ignore if backend service is not wired yet. */ }
      };

      useEffect(() => {
        if (opts.thoughtTranslate === 'ai') void loadProfiles();
      }, [opts.thoughtTranslate]);

      const runDiagnose = async () => {
        if (diagBusy || typeof env?.request !== 'function') return;
        setDiagBusy(true);
        try {
          const res = await env.request('thought.diagnose', {
            mode: opts.thoughtTranslate || 'machine',
            profileId: draft.id || profilesState.activeProfileId || ''
          });
          setDiagResult(res || { ok: false, message: tr5('未收到诊断响应', 'No diagnostic response', '診断応答なし', '未收到診斷回應') });
        } catch (err) {
          setDiagResult({ ok: false, message: err?.message || tr5('诊断失败', 'Diagnostics failed', '診断に失敗しました', '診斷失敗') });
        } finally {
          setDiagBusy(false);
        }
      };

      const runClearCache = async () => {
        if (cacheBusy || typeof env?.request !== 'function') return;
        setCacheBusy(true);
        try {
          const res = await env.request('thought.clearCache');
          const count = Number(res?.cleared ?? 0);
          setCacheFeedback(tr5(
            `已清理 ${count} 条译文缓存`,
            `Cleared ${count} cached translations`,
            `${count} 件の翻訳キャッシュを削除しました`,
            `已清理 ${count} 條譯文快取`
          ));
        } catch (err) {
          setCacheFeedback(err?.message || tr5('清理缓存失败', 'Failed to clear cache', 'キャッシュ削除に失敗しました', '清理快取失敗'));
        } finally {
          setCacheBusy(false);
        }
      };

      const saveProfile = async () => {
        if (profileBusy || typeof env?.request !== 'function') return;
        setProfileBusy(true);
        setProfileNotice('');
        try {
          const res = await env.request('thought.profiles.save', {
            profile: { ...draft },
            setActive: true
          });
          const profiles = Array.isArray(res?.profiles) ? res.profiles : [];
          const activeId = res?.activeProfileId || draft.id || '';
          setProfilesState(prev => ({ ...prev, activeProfileId: activeId, profiles }));
          const saved = profiles.find(p => p.id === activeId) || profiles[profiles.length - 1];
          if (saved) setDraft({ id: saved.id || '', name: saved.name || '', baseUrl: saved.baseUrl || '', apiKey: saved.apiKey || '', model: saved.model || '' });
          setProfileNotice(tr5('渠道配置已保存', 'Profile saved', 'プロファイルを保存しました', '渠道配置已儲存'));
        } catch (err) {
          setProfileNotice(err?.message || tr5('保存渠道失败', 'Failed to save profile', '保存に失敗しました', '儲存渠道失敗'));
        } finally {
          setProfileBusy(false);
        }
      };

      const deleteProfile = async id => {
        if (!id || profileBusy || typeof env?.request !== 'function') return;
        setProfileBusy(true);
        setProfileNotice('');
        try {
          const res = await env.request('thought.profiles.delete', { id });
          const profiles = Array.isArray(res?.profiles) ? res.profiles : [];
          const activeId = res?.activeProfileId || profiles[0]?.id || '';
          setProfilesState(prev => ({ ...prev, activeProfileId: activeId, profiles }));
          const nextActive = profiles.find(p => p.id === activeId) || { id: '', name: '', baseUrl: '', apiKey: '', model: '' };
          setDraft({ id: nextActive.id || '', name: nextActive.name || '', baseUrl: nextActive.baseUrl || '', apiKey: nextActive.apiKey || '', model: nextActive.model || '' });
        } catch (err) {
          setProfileNotice(err?.message || tr5('删除渠道失败', 'Failed to delete profile', '削除に失敗しました', '刪除渠道失敗'));
        } finally {
          setProfileBusy(false);
        }
      };

      const fetchModels = async () => {
        if (modelsBusy || typeof env?.request !== 'function') return;
        setModelsBusy(true);
        setProfileNotice('');
        try {
          const res = await env.request('thought.models', {
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey,
            profileId: draft.id || profilesState.activeProfileId || ''
          });
          const list = Array.isArray(res?.models) ? res.models : [];
          setModelsList(list);
          if (list.length && !draft.model) setDraft(prev => ({ ...prev, model: list[0] }));
          setProfileNotice(tr5(
            `已拉取 ${list.length} 个模型`,
            `Fetched ${list.length} models`,
            `${list.length} 件のモデルを取得しました`,
            `已拉取 ${list.length} 個模型`
          ));
        } catch (err) {
          setProfileNotice(err?.message || tr5('拉取模型失败', 'Failed to fetch models', 'モデル取得に失敗しました', '拉取模型失敗'));
        } finally {
          setModelsBusy(false);
        }
      };

      const runTranslateTest = async () => {
        if (testBusy || typeof env?.request !== 'function') return;
        setTestBusy(true);
        setTestResult(null);
        try {
          const targetLang = opts.language === 'en' ? 'zh-CN' : (opts.language || 'zh-CN');
          const res = await env.request('thought.translate', {
            text: 'Check edge cases and verify the output before committing.',
            mode: 'ai',
            targetLang,
            style: opts.thoughtStyle || 'technical',
            customPrompt: opts.thoughtCustomPrompt || '',
            profileId: draft.id || profilesState.activeProfileId || '',
            force: true
          });
          setTestResult({ ok: true, text: res?.translated || '', model: res?.model || draft.model || '' });
        } catch (err) {
          setTestResult({ ok: false, text: err?.message || tr5('测试请求失败', 'Test request failed', 'テスト送信に失敗しました', '測試請求失敗') });
        } finally {
          setTestBusy(false);
        }
      };

      return h('div', { className: 'pt-stack', 'data-testid': 'agy-thought-settings-section' },
        section(
          tr5('思考过程转译', 'Thought Translator', '思考プロセス翻訳', '思考過程轉譯'),
          h(TP, null,
            h('div', { className: 'pt-prism-block', 'data-testid': 'agy-thought-actions-bar' },
              h('div', { className: 'pt-prism-row' },
                h('div', { className: 'pt-toolbar' },
                  h(Uy, {
                    variant: 'secondary',
                    size: 'sm',
                    type: 'button',
                    disabled: diagBusy,
                    'data-testid': 'agy-thought-diagnose-btn',
                    onClick: () => { void runDiagnose(); }
                  }, diagBusy ? tr5('诊断中…', 'Diagnosing…', '診断中…', '診斷中…') : tr5('一键诊断', 'Diagnose', '診断を実行', '一鍵診斷')),
                  h(Uy, {
                    variant: 'secondary',
                    size: 'sm',
                    type: 'button',
                    disabled: cacheBusy,
                    'data-testid': 'agy-thought-clear-cache-btn',
                    onClick: () => { void runClearCache(); }
                  }, cacheBusy ? tr5('清理中…', 'Clearing…', '削除中…', '清理中…') : tr5('清理译文缓存', 'Clear translation cache', '翻訳キャッシュ削除', '清理譯文快取'))
                ),
                cacheFeedback && h('span', { className: 'pt-muted', 'data-testid': 'agy-thought-cache-feedback' }, cacheFeedback)
              ),
              diagResult && h('div', {
                className: 'pt-proxy-feedback',
                role: 'status',
                'data-tone': diagResult.ok && diagResult.upstreamOk !== false ? 'ok' : 'warning',
                'data-testid': 'agy-thought-diagnose-result'
              }, h('span', null, [
                `${tr5('延迟', 'Latency', '遅延', '延遲')}: ${diagResult.latencyMs ?? 0}ms`,
                `${tr5('代理', 'Proxy', 'プロキシ', '代理')}: ${diagResult.proxyActive ? (diagResult.proxyUrl || tr5('已启用', 'Active', '有効', '已啟用')) : tr5('直连', 'Direct', '直接', '直連')}`,
                `${tr5('上游状态', 'Upstream', 'アップストリーム', '上游狀態')}: ${diagResult.upstreamOk ? tr5('正常', 'Healthy', '正常', '正常') : tr5('异常', 'Unreachable', '異常', '異常')}`,
                diagResult.message || ''
              ].filter(Boolean).join(' / ')))
            ),
            selectRow(
              'thoughtTranslate',
              tr5('转译模式', 'Translation mode', '翻訳モード', '轉譯模式'),
              tr5('选择免配置机器翻译，或连接自有 OpenAI 兼容模型。', 'Choose zero-config machine translation or your OpenAI-compatible model.', '設定不要の機械翻訳、または OpenAI 互換モデルを選択します。', '揀選免配置機器翻譯，或者連接自家 OpenAI 相容模型。'),
              [
                ['off', tr5('关闭', 'Off', 'オフ', '關閉')],
                ['machine', tr5('免配置机器翻译', 'Zero-config machine', '機械翻訳 (設定不要)', '免配置機器翻譯')],
                ['ai', tr5('AI 模型流式转译', 'AI model streaming', 'AI モデル翻訳', 'AI 模型流式轉譯')]
              ]
            ),
            selectRow(
              'thoughtTrigger',
              tr5('触发时机', 'Trigger timing', '翻訳タイミング', '觸發時機'),
              tr5('决定展开思考块时按需翻译，或生成结束后自动预译。', 'Translate on expand or preload once thinking completes.', '展開時に翻訳するか、完了時に事前翻訳するかを選択します。', '決定展開思考塊時按需翻譯，定生成完自動預譯。'),
              [
                ['expand', tr5('点开按需', 'On expand', '展開時に翻訳', '點開按需')],
                ['preload', tr5('完结预译', 'Preload on finish', '完了後に事前翻訳', '完結預譯')]
              ]
            ),
            selectRow(
              'thoughtView',
              tr5('展示视图', 'Display view', '表示レイアウト', '展示檢視'),
              tr5('双语上下对照便于核对原文，沉浸模式仅保留译文。', 'Show bilingual side-by-side blocks or immersive translated prose.', '原文との対訳表示、または翻訳文のみの没入表示を選択します。', '雙語上下對照方便核對原文，沉浸模式淨係保留譯文。'),
              [
                ['bilingual', tr5('双语上下对照', 'Bilingual', '対訳表示', '雙語上下對照')],
                ['immersive', tr5('沉浸纯译文', 'Immersive', '没入表示', '沉浸純譯文')]
              ]
            ),
            selectRow(
              'thoughtStyle',
              tr5('译文风格', 'Polishing style', '文体スタイル', '譯文風格'),
              tr5('在 AI 转译模式下控制输出口吻与专业度。', 'Control output tone and structure for AI translation mode.', 'AI 翻訳時のトーンや要約スタイルを指定します。', '喺 AI 轉譯模式底下控制輸出語氣同專業度。'),
              [
                ['technical', tr5('专业工程手稿', 'Technical prose', '技術文書スタイル', '專業工程手稿')],
                ['concise', tr5('精炼核心要点', 'Concise bullets', '簡潔な要点', '精煉核心要點')],
                ['custom', tr5('自定义提示词', 'Custom prompt', 'カスタムプロンプト', '自訂提示詞')]
              ]
            ),
            opts.thoughtStyle === 'custom' && h('div', { className: 'pt-prism-block', 'data-testid': 'agy-setting-row-thoughtCustomPrompt' },
              h('div', { className: 'pt-prism-row' },
                h('span', { style: { fontSize: 13, fontWeight: 500 } }, tr5('自定义系统提示词', 'Custom system prompt', 'カスタムシステムプロンプト', '自訂系統提示詞')),
                h('span', { className: 'pt-muted tabular-nums' }, `${promptDraft.length} / 2000`)
              ),
              h('textarea', {
                className: 'pt-prism-textarea',
                maxLength: 2000,
                value: promptDraft,
                placeholder: tr5('例如：用简洁中文工程笔记风格转译，保留所有路径和命令。', 'e.g., Translate concisely in engineering note style while keeping paths and flags.', '例：パスやコマンドを保持して簡潔な技術メモとして翻訳。', '例如：用簡潔中文工程筆記風格轉譯，保留所有路徑同指令。'),
                'aria-label': tr5('自定义系统提示词', 'Custom system prompt', 'カスタムプロンプト', '自訂系統提示詞'),
                'data-testid': 'agy-thought-custom-prompt',
                onChange: e => {
                  const next = String(e?.target?.value ?? '').slice(0, 2000);
                  setPromptDraft(next);
                  void env?.change?.({ thoughtCustomPrompt: next.trim() });
                }
              })
            ),
            toggleRow(
              'translateSessionTitles',
              tr5('侧栏会话标题翻译', 'Translate session titles', '会話タイトル翻訳', '側欄會話標題翻譯'),
              tr5('批量将侧栏英文会话标题转译为当前语言，关闭后无损还原原标题。', 'Batch-translate non-CJK sidebar titles and restore originals cleanly when off.', 'サイドバーの会話タイトルを翻訳し、無効時は元に戻します。', '批量將側欄英文會話標題轉譯成目前語言，關閉後無損還原。')
            )
          )
        ),
        opts.thoughtTranslate === 'ai' && card(
          tr5('OpenAI 兼容渠道管理', 'OpenAI-compatible providers', 'OpenAI 互換プロバイダー管理', 'OpenAI 相容渠道管理'),
          h('div', { className: 'pt-prism-block', 'data-testid': 'agy-thought-profiles-card' },
            h('div', { className: 'pt-muted', 'data-testid': 'agy-thought-privacy-notice' },
              tr5(
                'API Key 仅保存在本机 0600 权限配置文件中，不会随配置导出或发送至无关域名。',
                'API keys stay local with 0600 file permissions only and are never exported or sent to other origins.',
                'API キーはローカルの 0600 権限ファイルにのみ保存され、外部へは送信されません。',
                'API Key 淨係儲存喺本機 0600 權限設定檔入面，唔會隨設定匯出或者傳去無關網域。'
              )
            ),
            profilesState.profiles.length > 0 && h('div', { className: 'pt-prism-profile-list' },
              ...profilesState.profiles.map(p => {
                const isActive = p.id && p.id === profilesState.activeProfileId;
                return h('div', {
                  key: p.id || p.name,
                  className: 'pt-prism-profile-item',
                  'data-active': isActive ? 'true' : undefined,
                  'data-testid': `agy-thought-profile-${p.id}`
                },
                h('div', { style: { minWidth: 0, flex: 1 } },
                  h('div', { style: { fontSize: 13, fontWeight: 500 } }, p.name || p.baseUrl || p.id),
                  h('div', { className: 'pt-muted' }, `${p.model || '-'} / ${p.baseUrl || ''}`)),
                h('div', { className: 'pt-toolbar' },
                  h(Uy, {
                    variant: 'ghost',
                    size: 'sm',
                    type: 'button',
                    onClick: () => setDraft({ id: p.id || '', name: p.name || '', baseUrl: p.baseUrl || '', apiKey: p.apiKey || '', model: p.model || '' })
                  }, tr5('编辑', 'Edit', '編集', '編輯')),
                  h(Uy, {
                    variant: 'ghost',
                    size: 'sm',
                    type: 'button',
                    disabled: profileBusy,
                    'data-testid': `agy-thought-profile-delete-${p.id}`,
                    onClick: () => { void deleteProfile(p.id); }
                  }, tr5('删除', 'Delete', '削除', '刪除'))
                ));
              })
            ),
            h('div', { className: 'pt-prism-grid2' },
              h('input', {
                className: 'pt-acct-input',
                type: 'text',
                value: draft.name,
                placeholder: tr5('渠道名称（如 DeepSeek / Ollama）', 'Provider name (e.g. DeepSeek / Ollama)', 'プロバイダー名', '渠道名稱（例如 DeepSeek / Ollama）'),
                'aria-label': tr5('渠道名称', 'Provider name', 'プロバイダー名', '渠道名稱'),
                'data-testid': 'agy-thought-profile-name',
                onChange: e => setDraft(prev => ({ ...prev, name: e?.target?.value ?? '' }))
              }),
              h('input', {
                className: 'pt-acct-input',
                type: 'text',
                value: draft.baseUrl,
                placeholder: 'https://api.openai.com/v1',
                'aria-label': tr5('接口地址', 'Base URL', 'ベース URL', '介面網址'),
                'data-testid': 'agy-thought-profile-baseurl',
                onChange: e => setDraft(prev => ({ ...prev, baseUrl: e?.target?.value ?? '' }))
              }),
              h('input', {
                className: 'pt-acct-input',
                type: 'password',
                value: draft.apiKey,
                placeholder: tr5('API Key（本机 Ollama 可留空）', 'API Key (optional for local Ollama)', 'API キー（Ollama は空欄可）', 'API Key（本機 Ollama 可留空）'),
                'aria-label': 'API Key',
                'data-testid': 'agy-thought-profile-apikey',
                onChange: e => setDraft(prev => ({ ...prev, apiKey: e?.target?.value ?? '' }))
              }),
              h('input', {
                className: 'pt-acct-input',
                type: 'text',
                value: draft.model,
                placeholder: tr5('模型 ID（如 gpt-4o-mini）', 'Model ID (e.g. gpt-4o-mini)', 'モデル ID', '模型 ID（例如 gpt-4o-mini）'),
                'aria-label': tr5('模型名称', 'Model name', 'モデル名', '模型名稱'),
                'data-testid': 'agy-thought-profile-model',
                onChange: e => setDraft(prev => ({ ...prev, model: e?.target?.value ?? '' }))
              })
            ),
            modelsList.length > 0 && h('div', { className: 'pt-prism-chips', 'data-testid': 'agy-thought-models-list' },
              ...modelsList.slice(0, 24).map(modelName => h('button', {
                key: modelName,
                type: 'button',
                className: 'pt-prism-chip',
                'aria-pressed': draft.model === modelName,
                'data-testid': 'agy-thought-model-chip',
                onClick: () => setDraft(prev => ({ ...prev, model: modelName }))
              }, modelName))
            ),
            h('div', { className: 'pt-prism-row' },
              h('div', { className: 'pt-toolbar' },
                h(Uy, {
                  variant: 'primary',
                  size: 'sm',
                  type: 'button',
                  disabled: profileBusy,
                  'data-testid': 'agy-thought-profile-save',
                  onClick: () => { void saveProfile(); }
                }, tr5('保存渠道', 'Save profile', '保存', '儲存渠道')),
                h(Uy, {
                  variant: 'secondary',
                  size: 'sm',
                  type: 'button',
                  disabled: modelsBusy,
                  'data-testid': 'agy-thought-fetch-models',
                  onClick: () => { void fetchModels(); }
                }, modelsBusy ? tr5('拉取中…', 'Fetching…', '取得中…', '拉取中…') : tr5('拉取模型列表', 'Fetch models', 'モデル一覧を取得', '拉取模型清單')),
                h(Uy, {
                  variant: 'secondary',
                  size: 'sm',
                  type: 'button',
                  disabled: testBusy,
                  'data-testid': 'agy-thought-test-btn',
                  onClick: () => { void runTranslateTest(); }
                }, testBusy ? tr5('测试中…', 'Testing…', 'テスト中…', '測試中…') : tr5('发送测试', 'Send test', 'テスト送信', '傳送測試')),
                h(Uy, {
                  variant: 'ghost',
                  size: 'sm',
                  type: 'button',
                  onClick: () => setDraft({ id: '', name: '', baseUrl: '', apiKey: '', model: '' })
                }, tr5('新建空白', 'New blank', '新規作成', '新建空白'))
              ),
              profileNotice && h('span', { className: 'pt-muted', 'data-testid': 'agy-thought-profile-notice' }, profileNotice)
            ),
            testResult && h('div', {
              className: 'pt-proxy-feedback',
              role: 'status',
              'data-tone': testResult.ok ? 'ok' : 'error',
              'data-testid': 'agy-thought-test-result'
            }, h('span', null, testResult.model ? `[${testResult.model}] ${testResult.text}` : testResult.text))
          )
        )
      );
    }

    function LocalWallpaperPicker() {
      const [fileName, setFileName] = useState(() => env.prism.wallpaperName());
      const [error, setError] = useState('');
      const opts = env.options();
      const choose = async file => {
        try {
          setError('');
          setFileName(env.prism.selectWallpaper(file));
          if (file && !opts.wallpaperEnabled && await env.change({ wallpaperEnabled: true }) === false) {
            setError(tr5('未能启用壁纸', 'Could not enable wallpaper', '壁紙を有効にできませんでした', '未能啟用壁紙'));
          }
        } catch (err) { setError(err.message); }
      };
      return card(tr5('本地壁纸 (Beta)', 'Local wallpaper (Beta)', 'ローカル壁紙 (Beta)', '本機壁紙 (Beta)'),
        h('div', { className: 'pt-prism-block' },
          h('p', { className: 'pt-muted' }, tr5('只在当前窗口使用所选文件。重开窗口后需要重新选择，不会上传文件。', 'The selected file stays in this window. Choose it again after reopening; nothing is uploaded.', 'ファイルはこのウィンドウ内だけで利用され、アップロードされません。', '檔案只喺目前視窗使用，唔會上傳；重開後要再揀。')),
          h('input', { type: 'file', accept: 'image/avif,image/gif,image/jpeg,image/png,image/webp,video/mp4,video/webm', 'aria-label': tr5('选择本地壁纸', 'Choose local wallpaper', '壁紙を選択', '揀本機壁紙'), 'data-testid': 'agy-local-wallpaper-picker', onChange: e => { const file = e.target.files?.[0]; if (file) void choose(file); e.target.value = ''; } }),
          fileName && h('div', { className: 'pt-prism-row' }, h('span', null, fileName),
            h(Uy, { type: 'button', size: 'sm', onClick: () => { void choose(null); } }, tr5('清除壁纸', 'Clear wallpaper', '壁紙を消去', '清除壁紙'))),
          fileName && toggleRow('wallpaperEnabled', tr5('显示壁纸', 'Show wallpaper', '壁紙を表示', '顯示壁紙')),
          fileName && [['wallpaperOpacity', tr5('透明度', 'Opacity', '不透明度', '透明度'), 80, '%'], ['wallpaperBlur', tr5('模糊', 'Blur', 'ぼかし', '模糊'), 32, 'px'], ['wallpaperDim', tr5('遮罩', 'Dim', '暗さ', '遮罩'), 80, '%']].map(([key, label, max, unit]) => h(UP, {
            key, label, rightElement: h('div', { className: 'pt-prism-range-wrap' },
              h('input', { type: 'range', min: 0, max, value: opts[key], 'aria-label': label, onChange: e => { void env.change({ [key]: Number(e.target.value) }); } }),
              h('span', { className: 'tabular-nums' }, `${opts[key]}${unit}`))
          })),
          error && h('p', { role: 'alert' }, error)));
    }

    function BetaAndArchiveSection() {
      const opts = optsOf();
      const [wallpaperPath, setWallpaperPath] = useState('');
      const [wallpaperStatus, setWallpaperStatus] = useState(null);
      const [wallpaperBusy, setWallpaperBusy] = useState(false);
      const [wallpaperError, setWallpaperError] = useState('');
      const [archiveBusy, setArchiveBusy] = useState(false);
      const [archiveInfo, setArchiveInfo] = useState(null);
      const [archiveError, setArchiveError] = useState('');

      useEffect(() => {
        if (!supported('wallpaper') || typeof env?.request !== 'function') return;
        void env.request('wallpaper.status').then(res => {
          if (res && typeof res === 'object') setWallpaperStatus(res);
        }).catch(() => {});
      }, []);

      const applyWallpaper = async () => {
        if (wallpaperBusy || typeof env?.request !== 'function') return;
        const clean = String(wallpaperPath || '').trim();
        if (!clean) {
          setWallpaperError(tr5('请填写本地图片或视频文件路径', 'Enter a local image or video path', 'ローカルの画像・動画パスを入力してください', '請填寫本機圖片或影片檔案路徑'));
          return;
        }
        setWallpaperBusy(true);
        setWallpaperError('');
        try {
          const res = await env.request('wallpaper.setPath', { filePath: clean });
          setWallpaperStatus(res || { ok: true, hasMedia: true, fileName: clean.split(/[\\/]/).pop() });
          if (!opts.wallpaperEnabled) void env?.change?.({ wallpaperEnabled: true });
        } catch (err) {
          setWallpaperError(err?.message || tr5('设置壁纸失败', 'Failed to set wallpaper', '壁紙設定に失敗しました', '設定壁紙失敗'));
        } finally {
          setWallpaperBusy(false);
        }
      };

      const clearWallpaper = async () => {
        if (wallpaperBusy || typeof env?.request !== 'function') return;
        setWallpaperBusy(true);
        setWallpaperError('');
        try {
          const res = await env.request('wallpaper.clear');
          setWallpaperStatus(res || { ok: true, hasMedia: false, fileName: '' });
          setWallpaperPath('');
        } catch (err) {
          setWallpaperError(err?.message || tr5('清除壁纸失败', 'Failed to clear wallpaper', '壁紙解除に失敗しました', '清除壁紙失敗'));
        } finally {
          setWallpaperBusy(false);
        }
      };

      const runArchiveAction = async method => {
        if (archiveBusy || typeof env?.request !== 'function') return;
        setArchiveBusy(true);
        setArchiveError('');
        try {
          const res = await env.request(method);
          setArchiveInfo({ action: method, ...(res || {}) });
        } catch (err) {
          setArchiveError(err?.message || tr5('归档操作失败', 'Archive action failed', 'アーカイブ処理に失敗しました', '歸檔操作失敗'));
        } finally {
          setArchiveBusy(false);
        }
      };

      const rangeControl = (key, label, min, max, unit) => {
        const currentVal = Number.isInteger(opts[key]) ? opts[key] : min;
        return h(UP, {
          key,
          label: t(label),
          'data-testid': `agy-setting-row-${key}`,
          rightElement: h('div', { className: 'pt-prism-range-wrap' },
            h('input', {
              type: 'range',
              className: 'pt-prism-range',
              min,
              max,
              step: 1,
              value: currentVal,
              'aria-label': t(label),
              'data-testid': `agy-setting-${key}`,
              onChange: e => {
                const next = Math.max(min, Math.min(max, Math.round(Number(e?.target?.value ?? min))));
                void env?.change?.({ [key]: next });
              }
            }),
            h('span', { className: 'tabular-nums pt-muted', style: { minWidth: 44, textAlign: 'right' } }, `${currentVal}${unit}`)
          )
        });
      };

      const archiveCount = archiveInfo
        ? (archiveInfo.eligibleCount ?? archiveInfo.archivedCount ?? archiveInfo.restoredCount ?? archiveInfo.count ?? 0)
        : 0;
      const archiveMb = archiveInfo
        ? (archiveInfo.mbFreed ?? archiveInfo.totalMb ?? bytesToMb(archiveInfo.freedBytes ?? archiveInfo.totalBytes ?? 0))
        : 0;

      return h('div', { className: 'pt-stack', 'data-testid': 'agy-beta-archive-section' },
        section(
          tr5('实验特性 (Beta)', 'Experimental features (Beta)', '実験機能 (Beta)', '實驗特性 (Beta)'),
          h(TP, null,
            toggleRow(
              'homeStudio',
              tr5('首页 Studio 用量看板', 'Home Studio usage card', 'ホーム Studio 使用量カード', '首頁 Studio 用量看板'),
              tr5('在空白首页输入框下方直接展示概览、趋势与模型额度。', 'Show compact Overview, Trends, and Quota tabs below the Home composer.', 'ホーム画面に概要・推移・残高カードを表示します。', '喺空白首頁輸入框下方直接展示概覽、趨勢同模型額度。')
            ),
            toggleRow(
              'chatModeBeta',
              tr5('Chat 对话空间模式 (Beta)', 'Chat workspace mode (Beta)', 'Chat 会話スペースモード (Beta)', 'Chat 對話空間模式 (Beta)'),
              tr5('在侧栏顶部提供 Code | Chat 切换器，支持按自定义文件夹整理日常对话。', 'Add Code | Chat toggle in sidebar to organize everyday chats in custom folders.', 'サイドバーに Code | Chat 切替と会話フォルダ整理を追加します。', '喺側欄頂部提供 Code | Chat 切換器，支援按自訂資料夾整理日常對話。')
            )
          )
        ),
        env.prism && h(LocalWallpaperPicker),
        supported('wallpaper') && card(
          tr5('自定义动静态壁纸 (Beta)', 'Custom wallpaper (Beta)', 'カスタム壁紙 (Beta)', '自訂動靜態壁紙 (Beta)'),
          h('div', { className: 'pt-prism-block', 'data-testid': 'agy-wallpaper-card' },
            toggleRow(
              'wallpaperEnabled',
              tr5('启用自定义壁纸', 'Enable custom wallpaper', 'カスタム壁紙を有効化', '啟用自訂壁紙'),
              tr5('仅在非内置浏览器窗口中叠加背景媒体层，窗口失焦自动暂停视频。', 'Render local image/video backdrop behind UI; auto-pauses when blurred.', 'UI 背景にローカル画像・動画を表示し、非アクティブ時は自動停止します。', '淨係喺非內置瀏覽器視窗疊加背景媒體層，視窗失焦自動暫停影片。')
            ),
            h('div', { className: 'pt-prism-row' },
              h('input', {
                className: 'pt-acct-input',
                style: { flex: 1, minWidth: 180 },
                type: 'text',
                value: wallpaperPath,
                placeholder: tr5('输入本机图片或视频路径 (.png / .webp / .mp4 / .webm)', 'Local image or video file path (.png / .webp / .mp4 / .webm)', 'ローカル画像または動画のファイルパス', '輸入本機圖片或影片路徑 (.png / .webp / .mp4 / .webm)'),
                'aria-label': tr5('壁纸文件路径', 'Wallpaper file path', '壁紙ファイルパス', '壁紙檔案路徑'),
                'data-testid': 'agy-wallpaper-path-input',
                onChange: e => setWallpaperPath(e?.target?.value ?? '')
              }),
              h(Uy, {
                variant: 'primary',
                size: 'sm',
                type: 'button',
                disabled: wallpaperBusy,
                'data-testid': 'agy-wallpaper-apply-btn',
                onClick: () => { void applyWallpaper(); }
              }, tr5('应用壁纸', 'Apply wallpaper', '壁紙を適用', '套用壁紙')),
              h(Uy, {
                variant: 'secondary',
                size: 'sm',
                type: 'button',
                disabled: wallpaperBusy,
                'data-testid': 'agy-wallpaper-clear-btn',
                onClick: () => { void clearWallpaper(); }
              }, tr5('清除壁纸', 'Clear wallpaper', '壁紙を解除', '清除壁紙'))
            ),
            wallpaperStatus?.hasMedia && h('div', { className: 'pt-muted', 'data-testid': 'agy-wallpaper-status' },
              `${tr5('当前壁纸', 'Active media', '現在の壁紙', '目前壁紙')}: ${wallpaperStatus.fileName || wallpaperStatus.kind || 'media'}`
            ),
            wallpaperError && h('div', { className: 'pt-proxy-feedback', role: 'alert', 'data-tone': 'error' }, wallpaperError),
            rangeControl('wallpaperOpacity', tr5('壁纸透明度', 'Wallpaper opacity', '壁紙の不透明度', '壁紙透明度'), 0, 80, '%'),
            rangeControl('wallpaperBlur', tr5('背景高斯模糊', 'Wallpaper blur', '背景ぼかし', '背景高斯模糊'), 0, 32, 'px'),
            rangeControl('wallpaperDim', tr5('暗角压暗遮罩', 'Wallpaper dim overlay', '暗転オーバーレイ', '暗角壓暗遮罩'), 0, 80, '%')
          )
        ),
        supported('archive') && card(
          tr5('历史子代理会话归档', 'Subagent conversation archive', '履歴サブエージェント会話アーカイブ', '歷史子代理會話歸檔'),
          h('div', { className: 'pt-prism-block', 'data-testid': 'agy-archive-card' },
            h('div', { className: 'pt-prism-row' },
              h('div', { className: 'pt-toolbar' },
                h(Uy, {
                  variant: 'secondary',
                  size: 'sm',
                  type: 'button',
                  disabled: archiveBusy,
                  'data-testid': 'agy-archive-scan-btn',
                  onClick: () => { void runArchiveAction('archive.scan'); }
                }, tr5('扫描体积', 'Scan size', '容量スキャン', '掃描體積')),
                h(Uy, {
                  variant: 'primary',
                  size: 'sm',
                  type: 'button',
                  disabled: archiveBusy,
                  'data-testid': 'agy-archive-run-btn',
                  onClick: () => { void runArchiveAction('archive.run'); }
                }, tr5('一键安全归档', 'Archive safely', '安全アーカイブ実行', '一鍵安全歸檔')),
                h(Uy, {
                  variant: 'secondary',
                  size: 'sm',
                  type: 'button',
                  disabled: archiveBusy,
                  'data-testid': 'agy-archive-restore-btn',
                  onClick: () => { void runArchiveAction('archive.restore'); }
                }, tr5('无损还原归档', 'Restore archive', 'アーカイブを復元', '無損還原歸檔'))
              )
            ),
            archiveInfo && h('div', {
              className: 'pt-proxy-feedback',
              role: 'status',
              'data-tone': 'ok',
              'data-testid': 'agy-archive-status'
            }, h('span', null,
              archiveInfo.action === 'archive.restore'
                ? tr5(
                  `已无损还原 ${archiveCount} 个会话，占用 ${formatMb(archiveMb)}`,
                  `Restored ${archiveCount} conversations (${formatMb(archiveMb)})`,
                  `${archiveCount} 件の会話を復元しました (${formatMb(archiveMb)})`,
                  `已無損還原 ${archiveCount} 個會話，佔用 ${formatMb(archiveMb)}`
                )
                : archiveInfo.action === 'archive.run'
                  ? tr5(
                    `已安全归档 ${archiveCount} 个会话，释放 ${formatMb(archiveMb)}`,
                    `Archived ${archiveCount} conversations, freed ${formatMb(archiveMb)}`,
                    `${archiveCount} 件をアーカイブし ${formatMb(archiveMb)} 解放しました`,
                    `已安全歸檔 ${archiveCount} 個會話，釋放 ${formatMb(archiveMb)}`
                  )
                  : tr5(
                    `可归档 ${archiveCount} 个子代理会话，约 ${formatMb(archiveMb)}`,
                    `Found ${archiveCount} archivable conversations (${formatMb(archiveMb)})`,
                    `${archiveCount} 件の対象会話が見つかりました (${formatMb(archiveMb)})`,
                    `可歸檔 ${archiveCount} 個子代理會話，約 ${formatMb(archiveMb)}`
                  )
            )),
            archiveError && h('div', { className: 'pt-proxy-feedback', role: 'alert', 'data-tone': 'error' }, archiveError)
          )
        )
      );
    }

    function ConfigBackupSection() {
      const [importText, setImportText] = useState('');
      const [busy, setBusy] = useState(false);
      const [feedback, setFeedback] = useState(null);
      const fileInputRef = useRef(null);

      const triggerDownload = jsonText => {
        try {
          if (typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function' || typeof document?.createElement !== 'function') return;
          const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'agy-powertools-settings.json';
          anchor.style && (anchor.style.display = 'none');
          document.body?.append?.(anchor);
          anchor.click?.();
          anchor.remove?.();
          URL.revokeObjectURL?.(url);
        } catch { /* Ignore download fallback in headless test environments. */ }
      };

      const doExport = async () => {
        if (busy || typeof env?.request !== 'function') return;
        setBusy(true);
        setFeedback(null);
        try {
          const raw = await env.request('settings.export');
          const bundle = sanitizeBundleForExport(raw?.bundle || raw);
          const jsonText = JSON.stringify(bundle, null, 2);
          try { await globalThis.navigator?.clipboard?.writeText?.(jsonText); } catch { /* Optional clipboard write. */ }
          triggerDownload(jsonText);
          setFeedback({
            tone: 'ok',
            text: tr5(
              '已导出脱敏配置 JSON（已移除 API Key 与代理账号密码）并复制到剪贴板',
              'Exported sanitized JSON (API keys & proxy auth stripped) and copied to clipboard',
              'API キーと認証情報を除いた設定 JSON を出力・コピーしました',
              '已匯出脫敏設定 JSON（已移除 API Key 同代理帳密）並複製到剪貼簿'
            )
          });
        } catch (err) {
          setFeedback({
            tone: 'error',
            text: err?.message || tr5('导出配置失败', 'Export failed', 'エクスポートに失敗しました', '匯出設定失敗')
          });
        } finally {
          setBusy(false);
        }
      };

      const doImportRaw = async rawJson => {
        if (busy || typeof env?.request !== 'function') return;
        let parsed;
        try {
          parsed = JSON.parse(String(rawJson || ''));
        } catch {
          setFeedback({
            tone: 'error',
            text: tr5('配置 JSON 格式无效', 'Invalid settings JSON format', '設定 JSON の形式が無効です', '設定 JSON 格式無效')
          });
          return;
        }
        setBusy(true);
        setFeedback(null);
        try {
          const res = await env.request('settings.import', { bundle: parsed });
          const nextSettings = res?.settings || res?.patch;
          if (nextSettings && typeof nextSettings === 'object') {
            if (await env?.change?.(nextSettings) === false) throw new Error(tr5('应用配置失败', 'Could not apply settings', '設定の適用に失敗しました', '套用設定失敗'));
          }
          setFeedback({
            tone: 'ok',
            text: tr5(
              '已成功导入并应用配置',
              'Settings imported and applied',
              '設定をインポートして適用しました',
              '已成功匯入並套用設定'
            )
          });
        } catch (err) {
          setFeedback({
            tone: 'error',
            text: err?.message || tr5('导入配置失败', 'Import failed', 'インポートに失敗しました', '匯入設定失敗')
          });
        } finally {
          setBusy(false);
        }
      };

      const onFileChange = async event => {
        const file = event?.target?.files?.[0];
        if (!file) return;
        try {
          const textContent = typeof file.text === 'function' ? await file.text() : '';
          setImportText(textContent);
          await doImportRaw(textContent);
        } catch (err) {
          setFeedback({ tone: 'error', text: err?.message || tr5('读取文件失败', 'Failed to read file', 'ファイル読込失敗', '讀取檔案失敗') });
        }
      };

      return section(
        tr5('配置备份与导入', 'Config backup & restore', '設定バックアップと復元', '設定備份同匯入'),
        h(TP, { 'data-testid': 'agy-config-backup-section' },
          h('div', { className: 'pt-prism-block' },
            h('div', { className: 'pt-prism-row' },
              h('div', { className: 'pt-toolbar' },
                h(Uy, {
                  variant: 'primary',
                  size: 'sm',
                  type: 'button',
                  disabled: busy,
                  'data-testid': 'agy-settings-export-btn',
                  onClick: () => { void doExport(); }
                }, tr5('导出脱敏配置 JSON', 'Export sanitized JSON', '脱敏設定 JSON を出力', '匯出脫敏設定 JSON')),
                h(Uy, {
                  variant: 'secondary',
                  size: 'sm',
                  type: 'button',
                  disabled: busy,
                  onClick: () => fileInputRef.current?.click?.()
                }, tr5('选择文件导入', 'Choose JSON file', 'JSON ファイルを選択', '揀選檔案匯入')),
                h('input', {
                  ref: fileInputRef,
                  type: 'file',
                  accept: '.json,application/json',
                  style: { display: 'none' },
                  'aria-label': tr5('选择配置文件', 'Choose settings JSON file', '設定 JSON ファイル', '揀選設定檔'),
                  'data-testid': 'agy-settings-import-file',
                  onChange: e => { void onFileChange(e); }
                })
              )
            ),
            h('textarea', {
              className: 'pt-prism-textarea',
              value: importText,
              placeholder: tr5('在此粘贴导出的配置 JSON，然后点击「导入恢复配置」…', 'Paste exported settings JSON here and click Import & restore…', '出力した設定 JSON を貼り付けてインポートを実行…', '喺呢度貼上匯出嘅設定 JSON，然後撳「匯入恢復設定」…'),
              'aria-label': tr5('配置 JSON 粘贴框', 'Settings JSON input', '設定 JSON 入力', '設定 JSON 貼上框'),
              'data-testid': 'agy-settings-import-textarea',
              onChange: e => setImportText(e?.target?.value ?? '')
            }),
            h('div', { className: 'pt-prism-row' },
              h(Uy, {
                variant: 'secondary',
                size: 'sm',
                type: 'button',
                disabled: busy || !importText.trim(),
                'data-testid': 'agy-settings-import-btn',
                onClick: () => { void doImportRaw(importText); }
              }, tr5('导入恢复配置', 'Import & restore', '設定を復元', '匯入恢復設定'))
            ),
            feedback && h('div', {
              className: 'pt-proxy-feedback',
              role: feedback.tone === 'error' ? 'alert' : 'status',
              'data-tone': feedback.tone,
              'data-testid': 'agy-settings-backup-status'
            }, feedback.text)
          )
        )
      );
    }

    return {
      tr5,
      LANGUAGE_ITEMS,
      SETTINGS_CATEGORIES,
      SCENE_PRESETS: PRESETS,
      SettingsCategoryFilter,
      ScenePresetBar,
      OpticsSettingsSection,
      WorkbenchSettingsSection,
      ThoughtSettingsSection,
      BetaAndArchiveSection,
      ConfigBackupSection,
      dispose() {
        styleEl?.remove?.();
      }
    };
  }

  globalThis.__agyCreatePrismPanels = createPrismPanels;
})();
