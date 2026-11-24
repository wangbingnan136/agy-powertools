import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROXY_BYPASS, isValidProxyBypass, isValidProxyUrl, normalizeProxyBypass, normalizeProxyUrl } from './proxy.mjs';

export const OVERVIEW_RANGE_OPTIONS = Object.freeze(['weeklyQuota', 'today', '24h', 'yesterday', 'week', 'month', '30d', 'all']);
export const USER_BUBBLE_PRESETS = Object.freeze(['accent', 'slate', 'ocean', 'sage', 'sand', 'plum', 'custom']);
export const EXTERNAL_EDITOR_OPTIONS = Object.freeze(['auto', 'cursor', 'vscode', 'windsurf', 'zed']);
export const LANGUAGE_OPTIONS = Object.freeze(['zh-CN', 'zh-TW', 'yue', 'en', 'ja']);
export const THEME_PALETTE_OPTIONS = Object.freeze(['native', 'obsidian', 'warm']);
export const LIGHT_THEME_PRESET_OPTIONS = Object.freeze(['crystal', 'alabaster']);
export const ACCENT_TONE_OPTIONS = Object.freeze(['follow', 'cobalt', 'iris', 'amber', 'mono']);
export const CORNER_STYLE_OPTIONS = Object.freeze(['sharp', 'balanced', 'soft']);
export const CODE_FONT_OPTIONS = Object.freeze(['default', 'jetbrains', 'sfmono', 'fira']);
export const AMBIENT_INTENSITY_OPTIONS = Object.freeze([0, 35, 70, 100]);
export const PLACEHOLDER_STYLE_OPTIONS = Object.freeze(['native', 'studio']);
export const LOGO_INK_OPTIONS = Object.freeze(['accent', 'foreground']);
export const MOTION_LEVEL_OPTIONS = Object.freeze(['off', 'subtle', 'standard', 'ultra']);
export const TARGET_FPS_OPTIONS = Object.freeze([60, 120, 180, 0]);
export const CONTEXT_STYLE_OPTIONS = Object.freeze(['ring', 'vial']);
export const SCROLL_BOTTOM_MOTION_OPTIONS = Object.freeze(['native', 'smooth']);
export const MASCOT_MODE_OPTIONS = Object.freeze(['off', 'crab', 'cat', 'pack']);
export const LINK_TARGET_OPTIONS = Object.freeze(['builtin', 'external']);
export const THOUGHT_TRANSLATE_OPTIONS = Object.freeze(['off', 'machine', 'ai']);
export const THOUGHT_TRIGGER_OPTIONS = Object.freeze(['preload', 'expand']);
export const THOUGHT_VIEW_OPTIONS = Object.freeze(['immersive', 'bilingual']);
export const THOUGHT_STYLE_OPTIONS = Object.freeze(['technical', 'concise', 'custom']);
export const SETTINGS_EXPORT_FORMAT = 'agy-powertools-settings-v1';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SENSITIVE_EXTRA_KEY_RE = /^(?:api[-_]?key|secret|password|passwd|access[-_]?token|refresh[-_]?token|credential|credentials)$/i;

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  priorityVisibleRows: 4,
  sshCommandPaste: true,
  compact: true, userBubbleTint: false, userBubblePreset: 'accent', userBubbleColor: '#2F75C3', contextRing: true, speedStats: true, gitStatusPill: true, timing: true, toolDetails: true,
  responseBranch: true, copySessionMarkdown: true, messageEdit: true, goalBar: true, sideChatCommand: true, fileContextMenu: true, externalEditor: 'auto', sessionSearch: true, sessionSearchShortcut: true, sidebarFocusBell: true, progress: true, overviewQuota: false, composerQuotaHalo: false, composerQuotaHaloWindow: 'auto', subagentTelemetry: true, keepTurnOutline: true, keepOverviewOpen: true, taskbarBadge: true, multiAccount: false, accountSwitcher: true, accountViewMode: 'list', accountQuotaWindow: '5h', autoSwitchAccount: false, proxyEnabled: false, proxyUrl: '', proxyBypass: DEFAULT_PROXY_BYPASS, proxyForceHttp1: false, stageUpdates: true, efficientIO: false, pragmaticCoding: false, language: 'zh-CN', overviewRange: 'weeklyQuota', contextLimit: 0, sidebarProjectLimit: 0,
  themePalette: 'native', lightThemePreset: 'crystal', accentTone: 'follow', cornerStyle: 'balanced', codeFont: 'default', codeLigatures: false, ambientIntensity: 70, sidebarCompact: false, sidebarNavFold: false, composerRestyle: false, placeholderStyle: 'native', logoInk: 'accent',
  motionLevel: 'off', targetFps: 120, contextStyle: 'ring', smoothCaret: false, scrollBottomMotion: 'native', streamInk: false, convAura: false, prismRim: false, homeRipple: false, mascotMode: 'off',
  effortSlider: true, effortMemory: true, codeBlockFold: true, railHoverOutline: true, inlineStepDiff: true, omniViewer: false, linkTarget: 'builtin', quickContextMenu: false,
  thoughtTranslate: 'off', thoughtTrigger: 'expand', thoughtView: 'bilingual', thoughtStyle: 'technical', thoughtCustomPrompt: '', translateSessionTitles: false,
  homeStudio: false, chatModeBeta: false, wallpaperEnabled: false, wallpaperOpacity: 22, wallpaperBlur: 8, wallpaperDim: 35
});

export const SCENE_PRESETS = Object.freeze({
  native: Object.freeze({
    themePalette: DEFAULT_SETTINGS.themePalette,
    lightThemePreset: DEFAULT_SETTINGS.lightThemePreset,
    accentTone: DEFAULT_SETTINGS.accentTone,
    cornerStyle: DEFAULT_SETTINGS.cornerStyle,
    codeFont: DEFAULT_SETTINGS.codeFont,
    codeLigatures: DEFAULT_SETTINGS.codeLigatures,
    ambientIntensity: DEFAULT_SETTINGS.ambientIntensity,
    sidebarCompact: DEFAULT_SETTINGS.sidebarCompact,
    sidebarNavFold: DEFAULT_SETTINGS.sidebarNavFold,
    composerRestyle: DEFAULT_SETTINGS.composerRestyle,
    placeholderStyle: DEFAULT_SETTINGS.placeholderStyle,
    logoInk: DEFAULT_SETTINGS.logoInk,
    motionLevel: DEFAULT_SETTINGS.motionLevel,
    targetFps: DEFAULT_SETTINGS.targetFps,
    contextStyle: DEFAULT_SETTINGS.contextStyle,
    smoothCaret: DEFAULT_SETTINGS.smoothCaret,
    scrollBottomMotion: DEFAULT_SETTINGS.scrollBottomMotion,
    streamInk: DEFAULT_SETTINGS.streamInk,
    convAura: DEFAULT_SETTINGS.convAura,
    prismRim: DEFAULT_SETTINGS.prismRim,
    homeRipple: DEFAULT_SETTINGS.homeRipple,
    mascotMode: DEFAULT_SETTINGS.mascotMode,
    wallpaperEnabled: DEFAULT_SETTINGS.wallpaperEnabled
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

const ENUM_VALIDATORS = {
  language: LANGUAGE_OPTIONS,
  overviewRange: OVERVIEW_RANGE_OPTIONS,
  userBubblePreset: USER_BUBBLE_PRESETS,
  externalEditor: EXTERNAL_EDITOR_OPTIONS,
  accountViewMode: ['list', 'card'],
  accountQuotaWindow: ['5h', 'weekly'],
  composerQuotaHaloWindow: ['auto', 'weekly', '5h'],
  contextLimit: [0, 256000, 500000, 1000000],
  sidebarProjectLimit: [0, 1, 2, 3, 4, 5, 10, -1],
  priorityVisibleRows: [3, 4, 5],
  themePalette: THEME_PALETTE_OPTIONS,
  lightThemePreset: LIGHT_THEME_PRESET_OPTIONS,
  accentTone: ACCENT_TONE_OPTIONS,
  cornerStyle: CORNER_STYLE_OPTIONS,
  codeFont: CODE_FONT_OPTIONS,
  ambientIntensity: AMBIENT_INTENSITY_OPTIONS,
  placeholderStyle: PLACEHOLDER_STYLE_OPTIONS,
  logoInk: LOGO_INK_OPTIONS,
  motionLevel: MOTION_LEVEL_OPTIONS,
  targetFps: TARGET_FPS_OPTIONS,
  contextStyle: CONTEXT_STYLE_OPTIONS,
  scrollBottomMotion: SCROLL_BOTTOM_MOTION_OPTIONS,
  mascotMode: MASCOT_MODE_OPTIONS,
  linkTarget: LINK_TARGET_OPTIONS,
  thoughtTranslate: THOUGHT_TRANSLATE_OPTIONS,
  thoughtTrigger: THOUGHT_TRIGGER_OPTIONS,
  thoughtView: THOUGHT_VIEW_OPTIONS,
  thoughtStyle: THOUGHT_STYLE_OPTIONS
};

const INT_RANGES = {
  wallpaperOpacity: [0, 80],
  wallpaperBlur: [0, 32],
  wallpaperDim: [0, 80]
};

const validSetting = (key, value) => {
  if (Object.hasOwn(ENUM_VALIDATORS, key)) return ENUM_VALIDATORS[key].includes(value);
  if (Object.hasOwn(INT_RANGES, key)) {
    const [min, max] = INT_RANGES[key];
    return Number.isInteger(value) && value >= min && value <= max;
  }
  if (key === 'userBubbleColor') return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
  if (key === 'thoughtCustomPrompt') return typeof value === 'string';
  if (key === 'proxyUrl') return isValidProxyUrl(value);
  if (key === 'proxyBypass') return isValidProxyBypass(value);
  return typeof value === 'boolean';
};

const coerceSetting = (key, value) => {
  if (key === 'proxyUrl') return normalizeProxyUrl(value) || '';
  if (key === 'proxyBypass') return normalizeProxyBypass(value) || DEFAULT_PROXY_BYPASS;
  if (key === 'userBubbleColor') return value.trim().toUpperCase();
  if (key === 'thoughtCustomPrompt') return value.trim().slice(0, 2000);
  return value;
};

export function normalizeSettings(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [
      key,
      validSetting(key, input[key]) ? coerceSetting(key, input[key]) : fallback
    ])
  );
}

function stripProxyCredentials(rawUrl = '') {
  const normalized = normalizeProxyUrl(rawUrl);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (!parsed.username && !parsed.password) return normalized;
    const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
      ? `[${parsed.hostname}]`
      : parsed.hostname;
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${host}${port}`;
  } catch {
    return '';
  }
}

function sanitizeExtraValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => sanitizeExtraValue(item, seen)).filter(item => item !== undefined);
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_EXTRA_KEY_RE.test(key)) continue;
    if (key === 'proxyUrl' && typeof entry === 'string') {
      out[key] = stripProxyCredentials(entry);
      continue;
    }
    const clean = sanitizeExtraValue(entry, seen);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

export function exportSanitizedSettings(settingsObj = {}, extra = {}) {
  const sanitizedSettings = normalizeSettings(settingsObj);
  if (sanitizedSettings.proxyUrl) {
    sanitizedSettings.proxyUrl = stripProxyCredentials(sanitizedSettings.proxyUrl);
  }
  const cleanExtra = extra && typeof extra === 'object' && !Array.isArray(extra)
    ? sanitizeExtraValue(extra)
    : {};
  return {
    ...cleanExtra,
    format: SETTINGS_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    settings: sanitizedSettings
  };
}

export function importSanitizedSettings(bundle, currentSettings = DEFAULT_SETTINGS) {
  let parsed = bundle;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { throw new Error('配置 JSON 格式无效'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('配置 JSON 格式无效');
  }
  if (Object.hasOwn(parsed, 'format') && parsed.format !== SETTINGS_EXPORT_FORMAT) {
    throw new Error('配置 JSON 格式无效');
  }
  let source = parsed;
  if (Object.hasOwn(parsed, 'settings')) {
    if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
      throw new Error('配置 JSON 格式无效');
    }
    source = parsed.settings;
  }
  const patch = {};
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(DEFAULT_SETTINGS, key) && validSetting(key, value)) {
      patch[key] = coerceSetting(key, value);
    }
  }
  if (!Object.keys(patch).length) {
    throw new Error('配置 JSON 格式无效');
  }
  if (Object.hasOwn(patch, 'proxyUrl') && typeof currentSettings?.proxyUrl === 'string' && currentSettings.proxyUrl) {
    const existingNorm = normalizeProxyUrl(currentSettings.proxyUrl);
    if (existingNorm && patch.proxyUrl) {
      try {
        const curUrl = new URL(existingNorm);
        const incUrl = new URL(patch.proxyUrl);
        const curHasAuth = Boolean(curUrl.username || curUrl.password);
        const incNoAuth = (!incUrl.username && !incUrl.password) || (incUrl.username === '***' && !incUrl.password);
        if (
          curHasAuth &&
          incNoAuth &&
          curUrl.protocol === incUrl.protocol &&
          curUrl.hostname === incUrl.hostname &&
          curUrl.port === incUrl.port
        ) {
          patch.proxyUrl = existingNorm;
        }
      } catch { /* Keep validated incoming proxyUrl if URL comparison fails. */ }
    }
  }
  return patch;
}
export function createSettingsStore(directory = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-powertools')) {
  const path = join(directory, 'settings.json');
  return {
    get() {
      try { return normalizeSettings(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}); }
      catch { return { ...DEFAULT_SETTINGS }; }
    },
    set(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置格式无效');
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(DEFAULT_SETTINGS, key) || !validSetting(key,value)) throw new Error('设置选项无效');
      }
      const value = normalizeSettings({ ...this.get(), ...patch });
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n', 'utf8');
      renameSync(`${path}.tmp`, path);
      return value;
    }
  };
}
