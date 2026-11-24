import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import { pluginDataDir } from './paths.mjs';
import { DEFAULT_PROXY_BYPASS, maskProxyUrl, normalizeProxyBypass, normalizeProxyUrl } from './proxy.mjs';

export const DEFAULT_MACHINE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

const PROFILES_FILE = 'thought-profiles.json';
const CACHE_FILE = 'thought-cache.json';
const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_CACHE_ENTRIES = 400;
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_CUSTOM_PROMPT_CHARS = 2000;
const MAX_TITLE_ITEMS = 24;
const MACHINE_GET_LIMIT = 1500;
const MACHINE_CHUNK_LIMIT = 4000;
const VALID_MODES = new Set(['machine', 'ai']);
const VALID_STYLES = new Set(['technical', 'concise', 'custom']);

const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.internal',
  'metadata.tencentyun.com',
  'instance-data',
  'instance-data.ec2.internal',
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254'
]);

const UNSAFE_URL_CHARS = /[\x00-\x1f\x7f\s]/;
const CJK_CHAR_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const KANA_CHAR_RE = /[\u3040-\u30ff]/;
const LATIN_CHAR_RE = /[A-Za-z]/g;

function normalizeHost(hostname = '') {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '');
}

function extractMappedIpv4(host) {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return '';
}

function parseIpv4Octets(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts;
}

function isBlockedMetadataHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (METADATA_HOSTS.has(host) || host.endsWith('.metadata.google.internal')) return true;

  const mappedV4 = extractMappedIpv4(host);
  const v4 = parseIpv4Octets(mappedV4 || host);
  if (v4) {
    const [a, b, c, d] = v4;
    if (a === 169 && b === 254) return true;
    if (a === 0 && b === 0 && c === 0 && d === 0) return true;
    if (a === 100 && b === 100 && c === 100 && d === 200) return true;
    return false;
  }

  if (host === '::' || host === '0:0:0:0:0:0:0:0') return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  if (host.startsWith('fd00:ec2:')) return true;
  return false;
}

export function isLocalOrLanHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host || isBlockedMetadataHost(host)) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;

  const mappedV4 = extractMappedIpv4(host);
  const v4 = parseIpv4Octets(mappedV4 || host);
  if (!v4) return false;
  const [a, b] = v4;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function validateUpstreamUrl(rawUrl, { stripCompletionsSuffix = false } = {}) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || trimmed.length > 2048 || UNSAFE_URL_CHARS.test(trimmed)) {
    throw new Error('上游接口地址格式无效');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('上游接口地址无法解析');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`不允许的协议: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('接口地址不允许内嵌账号密码');
  }
  if (!parsed.hostname || isBlockedMetadataHost(parsed.hostname)) {
    throw new Error('目标主机被安全策略拦截（SSRF 防护）');
  }
  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (stripCompletionsSuffix && pathname.endsWith('/chat/completions')) {
    pathname = pathname.slice(0, -'/chat/completions'.length);
  }
  const normalized = `${parsed.origin}${pathname}`;
  return { url: normalized, parsed, origin: parsed.origin, hostname: normalizeHost(parsed.hostname) };
}

export function maskApiKey(apiKey = '') {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '****';
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}

export function isPrimarilyCjk(text = '') {
  const str = String(text || '').trim();
  if (!str) return false;
  if (KANA_CHAR_RE.test(str)) return false;
  const cjkCount = (str.match(CJK_CHAR_RE) || []).length;
  if (cjkCount === 0) return false;
  const latinCount = (str.match(LATIN_CHAR_RE) || []).length;
  if (latinCount === 0) return true;
  return cjkCount / (cjkCount + latinCount) >= 0.4;
}

function writeJsonAtomic(filePath, data, mode) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const payload = JSON.stringify(data, null, 2) + '\n';
  writeFileSync(tmpPath, payload, mode ? { encoding: 'utf8', mode } : 'utf8');
  if (mode) {
    try { chmodSync(tmpPath, mode); } catch { /* Best effort on non-POSIX filesystems. */ }
  }
  renameSync(tmpPath, filePath);
  if (mode) {
    try { chmodSync(filePath, mode); } catch { /* Best effort on non-POSIX filesystems. */ }
  }
}

function readJsonSafe(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function shouldBypassProxy(targetHost, bypassList = DEFAULT_PROXY_BYPASS) {
  const host = normalizeHost(targetHost);
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  const entries = String(bypassList || '')
    .split(/[,;\s]+/)
    .map(item => normalizeHost(item))
    .filter(Boolean);
  for (const rule of entries) {
    if (rule === '*') return true;
    if (rule === host) return true;
    if (rule.startsWith('.') && host.endsWith(rule)) return true;
    if (rule.startsWith('*.') && host.endsWith(rule.slice(1))) return true;
  }
  return false;
}

function resolveActiveProxy(getSettings, env = process.env) {
  const settings = typeof getSettings === 'function' ? (getSettings() || {}) : {};
  const settingsUrl = settings.proxyEnabled ? (normalizeProxyUrl(settings.proxyUrl || '') || '') : '';
  if (settingsUrl) {
    return {
      active: true,
      url: settingsUrl,
      maskedUrl: maskProxyUrl(settingsUrl),
      bypass: normalizeProxyBypass(settings.proxyBypass ?? DEFAULT_PROXY_BYPASS) || DEFAULT_PROXY_BYPASS
    };
  }
  const envRaw = env?.HTTPS_PROXY || env?.https_proxy || env?.HTTP_PROXY || env?.http_proxy || env?.ALL_PROXY || env?.all_proxy || '';
  const envUrl = normalizeProxyUrl(envRaw) || '';
  if (envUrl) {
    const envBypass = env?.NO_PROXY || env?.no_proxy || DEFAULT_PROXY_BYPASS;
    return {
      active: true,
      url: envUrl,
      maskedUrl: maskProxyUrl(envUrl),
      bypass: normalizeProxyBypass(envBypass) || DEFAULT_PROXY_BYPASS
    };
  }
  return { active: false, url: '', maskedUrl: '', bypass: DEFAULT_PROXY_BYPASS };
}

function openHttpConnectTunnel(proxyUrl, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(proxyUrl);
    const proxyHost = normalizeHost(parsed.hostname);
    const proxyPort = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    let settled = false;
    const socket = parsed.protocol === 'https:'
      ? tls.connect({ host: proxyHost, port: proxyPort, servername: proxyHost })
      : net.createConnection({ host: proxyHost, port: proxyPort });
    socket.setTimeout(timeoutMs);

    const fail = err => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      reject(err);
    };

    const onConnect = () => {
      const lines = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
        'Proxy-Connection: keep-alive'
      ];
      if (parsed.username || parsed.password) {
        const creds = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
        lines.push(`Proxy-Authorization: Basic ${Buffer.from(creds, 'utf8').toString('base64')}`);
      }
      socket.write(lines.join('\r\n') + '\r\n\r\n');
    };

    if (parsed.protocol === 'https:') socket.once('secureConnect', onConnect);
    else socket.once('connect', onConnect);

    let headerBuf = Buffer.alloc(0);
    const onData = chunk => {
      headerBuf = Buffer.concat([headerBuf, chunk]);
      const endIdx = headerBuf.indexOf('\r\n\r\n');
      if (endIdx === -1) {
        if (headerBuf.length > 8192) fail(new Error('代理 CONNECT 响应头过长'));
        return;
      }
      socket.removeListener('data', onData);
      const statusLine = headerBuf.subarray(0, headerBuf.indexOf('\r\n')).toString('latin1');
      const match = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/i);
      const code = match ? Number(match[1]) : 0;
      if (code < 200 || code >= 300) {
        fail(new Error(`代理 CONNECT 隧道建立失败 (HTTP ${code || 'unknown'})`));
        return;
      }
      const leftover = headerBuf.subarray(endIdx + 4);
      if (leftover.length > 0) socket.unshift(leftover);
      settled = true;
      socket.setTimeout(0);
      resolve(socket);
    };

    socket.on('data', onData);
    socket.once('timeout', () => fail(new Error('代理隧道连接超时')));
    socket.once('error', err => fail(new Error(`代理连接失败: ${err.message}`)));
    socket.once('end', () => fail(new Error('代理提前断开连接')));
  });
}

function openSocks5Tunnel(proxyUrl, targetHost, targetPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(proxyUrl);
    const proxyHost = normalizeHost(parsed.hostname);
    const proxyPort = parsed.port ? Number(parsed.port) : 1080;
    const hasAuth = Boolean(parsed.username || parsed.password);
    let settled = false;
    const socket = net.createConnection({ host: proxyHost, port: proxyPort });
    socket.setTimeout(timeoutMs);

    const fail = err => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      reject(err);
    };

    let stage = 'greeting';
    let buf = Buffer.alloc(0);

    const sendConnect = () => {
      stage = 'connect';
      const domainBytes = Buffer.from(targetHost, 'ascii');
      const req = Buffer.alloc(7 + domainBytes.length);
      req[0] = 0x05;
      req[1] = 0x01;
      req[2] = 0x00;
      req[3] = 0x03;
      req[4] = domainBytes.length;
      domainBytes.copy(req, 5);
      req.writeUInt16BE(targetPort, 5 + domainBytes.length);
      socket.write(req);
    };

    socket.once('connect', () => {
      socket.write(hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    });

    const onData = chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting' && buf.length >= 2) {
        const ver = buf[0];
        const method = buf[1];
        buf = buf.subarray(2);
        if (ver !== 0x05) return fail(new Error('无效的 SOCKS5 代理'));
        if (method === 0x00) sendConnect();
        else if (method === 0x02 && hasAuth) {
          stage = 'auth';
          const u = Buffer.from(decodeURIComponent(parsed.username), 'utf8');
          const p = Buffer.from(decodeURIComponent(parsed.password), 'utf8');
          socket.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
        } else {
          return fail(new Error('SOCKS5 代理认证方式不支持'));
        }
      }
      if (stage === 'auth' && buf.length >= 2) {
        const status = buf[1];
        buf = buf.subarray(2);
        if (status !== 0x00) return fail(new Error('SOCKS5 代理认证失败'));
        sendConnect();
      }
      if (stage === 'connect' && buf.length >= 4) {
        if (buf[0] !== 0x05 || buf[1] !== 0x00) {
          return fail(new Error(`SOCKS5 连接目标失败 (0x${buf[1].toString(16)})`));
        }
        const atyp = buf[3];
        let needed = 4;
        if (atyp === 0x01) needed = 10;
        else if (atyp === 0x04) needed = 22;
        else if (atyp === 0x03) {
          if (buf.length < 5) return;
          needed = 5 + buf[4] + 2;
        } else {
          return fail(new Error('SOCKS5 地址类型无效'));
        }
        if (buf.length < needed) return;
        const leftover = buf.subarray(needed);
        socket.removeListener('data', onData);
        if (leftover.length > 0) socket.unshift(leftover);
        settled = true;
        socket.setTimeout(0);
        resolve(socket);
      }
    };

    socket.on('data', onData);
    socket.once('timeout', () => fail(new Error('SOCKS5 代理连接超时')));
    socket.once('error', err => fail(new Error(`SOCKS5 代理连接失败: ${err.message}`)));
    socket.once('end', () => fail(new Error('SOCKS5 代理提前断开连接')));
  });
}

async function fetchViaProxy(targetUrlStr, init, proxyUrl, timeoutMs) {
  const target = new URL(targetUrlStr);
  const proxy = new URL(proxyUrl);
  const isTargetHttps = target.protocol === 'https:';
  const targetPort = target.port ? Number(target.port) : (isTargetHttps ? 443 : 80);
  const targetHost = normalizeHost(target.hostname);
  const isSocks = proxy.protocol === 'socks5:' || proxy.protocol === 'socks5h:';

  let customSocket = null;
  if (isSocks) {
    const rawSocket = await openSocks5Tunnel(proxyUrl, targetHost, targetPort, timeoutMs);
    customSocket = isTargetHttps ? tls.connect({ socket: rawSocket, servername: targetHost }) : rawSocket;
  } else if (isTargetHttps) {
    const rawSocket = await openHttpConnectTunnel(proxyUrl, targetHost, targetPort, timeoutMs);
    customSocket = tls.connect({ socket: rawSocket, servername: targetHost });
  }

  return new Promise((resolve, reject) => {
    const reqHeaders = { ...(init.headers || {}) };
    let reqOpts;
    let client;

    if (customSocket) {
      client = isTargetHttps ? https : http;
      reqOpts = {
        method: init.method || 'GET',
        host: targetHost,
        port: targetPort,
        path: `${target.pathname}${target.search}`,
        headers: reqHeaders,
        agent: false,
        createConnection: () => customSocket
      };
    } else {
      client = proxy.protocol === 'https:' ? https : http;
      const proxyHost = normalizeHost(proxy.hostname);
      const proxyPort = proxy.port ? Number(proxy.port) : (proxy.protocol === 'https:' ? 443 : 80);
      if (proxy.username || proxy.password) {
        const creds = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
        reqHeaders['Proxy-Authorization'] = `Basic ${Buffer.from(creds, 'utf8').toString('base64')}`;
      }
      reqHeaders.Host = target.host;
      reqOpts = {
        method: init.method || 'GET',
        host: proxyHost,
        port: proxyPort,
        path: target.href,
        headers: reqHeaders,
        agent: false
      };
    }

    const req = client.request(reqOpts, res => {
      const status = res.statusCode || 0;
      if (init.redirect === 'error' && status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        req.destroy();
        reject(new Error('请求被重定向，已按安全策略中止'));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rawText = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || '',
          headers: new Headers(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
          async text() { return rawText; },
          async json() { return JSON.parse(rawText); }
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('上游请求超时'));
    });

    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy(new Error('请求已取消'));
        return;
      }
      init.signal.addEventListener('abort', () => req.destroy(new Error('请求已取消')), { once: true });
    }

    req.on('error', err => reject(err));
    if (init.body !== undefined && init.body !== null) {
      req.end(init.body);
    } else {
      req.end();
    }
  });
}

function buildSystemPrompt(style, targetLang, customPrompt) {
  const lang = String(targetLang || 'zh-CN').trim() || 'zh-CN';
  if (style === 'custom') {
    const trimmed = String(customPrompt || '').trim().slice(0, MAX_CUSTOM_PROMPT_CHARS);
    if (trimmed) {
      return `${trimmed}\n\nTarget language: ${lang}. Output only the final result without meta commentary.`;
    }
  }
  if (style === 'concise') {
    return [
      `You are a concise technical translator and summarizer. Translate and distill the reasoning into concise, bullet-ready key points in ${lang}.`,
      'Preserve code identifiers, file paths (e.g. foo/bar.ts#L10), CLI flags, URLs, and Markdown formatting verbatim.',
      'Output only the concise translated points with no preamble.'
    ].join(' ');
  }
  return [
    `You are a technical engineering translator. Translate and polish the reasoning into accurate, clear engineering prose in ${lang}.`,
    'Strictly preserve code identifiers, symbol names, file paths (e.g. foo/bar.ts#L10), CLI flags, URLs, numbers, and Markdown structure.',
    'Output only the translated prose with no preamble or commentary.'
  ].join(' ');
}

function splitTextForMachine(text, limit = MACHINE_CHUNK_LIMIT) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit);
    if (cut < Math.floor(limit * 0.4)) cut = remaining.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.4)) cut = remaining.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function parseGoogleTranslatePayload(payload) {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload) && Array.isArray(payload[0])) {
    const out = [];
    for (const seg of payload[0]) {
      if (Array.isArray(seg) && typeof seg[0] === 'string') out.push(seg[0]);
    }
    return out.join('');
  }
  if (payload && typeof payload === 'object' && typeof payload.translated === 'string') {
    return payload.translated;
  }
  throw new Error('机器翻译响应格式异常');
}

function extractChatCompletionText(payload) {
  const msg = payload?.choices?.[0]?.message;
  if (!msg) throw new Error('AI 接口未返回有效 choices[0].message');
  if (typeof msg.content === 'string') return msg.content.trim();
  if (Array.isArray(msg.content)) {
    return msg.content
      .map(part => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  throw new Error('AI 接口返回内容为空');
}

function extractModelIds(payload) {
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : null;
  if (!list) throw new Error('模型列表响应格式无效');
  const seen = new Set();
  for (const item of list) {
    const id = typeof item === 'string'
      ? item.trim()
      : typeof item?.id === 'string'
        ? item.id.trim()
        : typeof item?.name === 'string'
          ? item.name.trim()
          : '';
    if (id) seen.add(id);
  }
  return [...seen].sort();
}

export function createThoughtTranslator(
  dataDir = pluginDataDir(),
  {
    getSettings,
    fetchImpl = globalThis.fetch,
    machineEndpoint = DEFAULT_MACHINE_ENDPOINT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES
  } = {}
) {
  const resolvedDir = String(dataDir || pluginDataDir());
  const profilesPath = join(resolvedDir, PROFILES_FILE);
  const cachePath = join(resolvedDir, CACHE_FILE);
  const concurrencyCap = Math.max(1, Number.isInteger(maxConcurrent) ? maxConcurrent : DEFAULT_MAX_CONCURRENT);
  const cacheCap = Math.max(1, Number.isInteger(maxCacheEntries) ? maxCacheEntries : DEFAULT_MAX_CACHE_ENTRIES);
  const reqTimeoutMs = Math.max(500, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);

  const loadProfilesStore = () => {
    const raw = readJsonSafe(profilesPath, null);
    if (!raw || typeof raw !== 'object') return { activeProfileId: '', profiles: [] };
    const profiles = Array.isArray(raw.profiles)
      ? raw.profiles
        .filter(item => item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim())
        .map(item => ({
          id: item.id.trim(),
          name: String(item.name || '').trim(),
          baseUrl: String(item.baseUrl || '').trim(),
          apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
          model: String(item.model || '').trim()
        }))
      : [];
    const activeId = typeof raw.activeProfileId === 'string' && profiles.some(p => p.id === raw.activeProfileId)
      ? raw.activeProfileId
      : (profiles[0]?.id || '');
    return { activeProfileId: activeId, profiles };
  };

  let profilesStore = loadProfilesStore();

  const persistProfiles = () => {
    writeJsonAtomic(profilesPath, profilesStore, 0o600);
  };

  const maskProfile = p => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: maskApiKey(p.apiKey),
    hasApiKey: Boolean(p.apiKey),
    model: p.model
  });

  const loadCacheMap = () => {
    const map = new Map();
    const raw = readJsonSafe(cachePath, null);
    if (!raw || typeof raw !== 'object') return map;
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [key, val] = entry;
      if (typeof key !== 'string' || !val || typeof val.translated !== 'string') continue;
      map.set(key, {
        translated: val.translated,
        mode: String(val.mode || 'machine'),
        model: String(val.model || ''),
        updatedAt: Number(val.updatedAt) || 0
      });
    }
    while (map.size > cacheCap) {
      map.delete(map.keys().next().value);
    }
    return map;
  };

  const cache = loadCacheMap();

  const persistCache = () => {
    try {
      writeJsonAtomic(cachePath, { version: 1, entries: [...cache.entries()] });
    } catch { /* Best effort persistence. */ }
  };

  const cacheGet = key => {
    if (!cache.has(key)) return null;
    const entry = cache.get(key);
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  };

  const cacheSet = (key, value) => {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, { ...value, updatedAt: Date.now() });
    while (cache.size > cacheCap) {
      cache.delete(cache.keys().next().value);
    }
    persistCache();
  };

  let activeRequests = 0;
  const queue = [];
  const inFlight = new Map();

  const runWithConcurrency = fn => new Promise((resolve, reject) => {
    const start = () => {
      activeRequests++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          activeRequests--;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (activeRequests < concurrencyCap) start();
    else queue.push(start);
  });

  const doFetch = async (urlStr, init = {}) => {
    const checked = validateUpstreamUrl(urlStr);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('请求超时')), reqTimeoutMs);
    const mergedInit = {
      ...init,
      redirect: 'error',
      signal: controller.signal
    };
    try {
      const proxy = resolveActiveProxy(getSettings);
      if (fetchImpl === globalThis.fetch && proxy.active && !shouldBypassProxy(checked.hostname, proxy.bypass)) {
        return await fetchViaProxy(urlStr, mergedInit, proxy.url, reqTimeoutMs);
      }
      return await fetchImpl(urlStr, mergedInit);
    } finally {
      clearTimeout(timer);
    }
  };

  const resolveProfile = (requestedProfileId = '') => {
    const id = String(requestedProfileId || '').trim() || profilesStore.activeProfileId;
    const found = id
      ? profilesStore.profiles.find(p => p.id === id)
      : profilesStore.profiles[0];
    if (!found) {
      throw new Error('未找到可用的 AI 转译配置，请先新增并保存 OpenAI 兼容渠道');
    }
    return found;
  };

  const runMachineTranslateChunk = async (chunk, targetLang) => {
    const endpoint = validateUpstreamUrl(machineEndpoint).url;
    const baseParams = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: targetLang,
      dt: 't'
    });
    let response;
    if (chunk.length <= MACHINE_GET_LIMIT) {
      baseParams.set('q', chunk);
      response = await doFetch(`${endpoint}?${baseParams.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
    } else {
      response = await doFetch(`${endpoint}?${baseParams.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json'
        },
        body: new URLSearchParams({ q: chunk }).toString()
      });
    }
    if (!response?.ok) {
      throw new Error(`机器翻译接口返回 HTTP ${response?.status || 'unknown'}`);
    }
    const data = await response.json();
    return parseGoogleTranslatePayload(data);
  };

  const runMachineTranslate = async (text, targetLang) => {
    const chunks = splitTextForMachine(text, MACHINE_CHUNK_LIMIT);
    const parts = [];
    for (const chunk of chunks) {
      parts.push(await runMachineTranslateChunk(chunk, targetLang));
    }
    return parts.join('');
  };

  const runAiTranslate = async ({ text, targetLang, style, customPrompt, profile }) => {
    const validated = validateUpstreamUrl(profile.baseUrl, { stripCompletionsSuffix: true });
    if (!profile.model) {
      throw new Error('当前 AI 配置未指定模型名称');
    }
    const apiKey = String(profile.apiKey || '').trim();
    if (!apiKey && !isLocalOrLanHost(validated.hostname)) {
      throw new Error('远端 AI 接口缺少 API Key');
    }
    const requestUrl = `${validated.url}/chat/completions`;
    const reqChecked = validateUpstreamUrl(requestUrl);
    if (apiKey && reqChecked.origin !== validated.origin) {
      throw new Error('拒绝将 API Key 发送至非绑定源地址');
    }
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await doFetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: profile.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildSystemPrompt(style, targetLang, customPrompt) },
          { role: 'user', content: text }
        ]
      })
    });
    if (!response?.ok) {
      let detail = '';
      try {
        const errBody = await response.text();
        detail = errBody.slice(0, 160).replace(/\s+/g, ' ').trim();
      } catch {}
      throw new Error(`AI 转译请求失败 (HTTP ${response?.status || 'unknown'})${detail ? `: ${detail}` : ''}`);
    }
    const payload = await response.json();
    return extractChatCompletionText(payload);
  };

  const makeCacheKey = ({ mode, targetLang, style, customPrompt, profileId, model, text }) => (
    createHash('sha256')
      .update(JSON.stringify([mode, targetLang, style, customPrompt, profileId, model, text]))
      .digest('hex')
  );

  async function translate({
    text = '',
    mode = 'machine',
    targetLang = 'zh-CN',
    style = 'technical',
    customPrompt = '',
    profileId = '',
    force = false
  } = {}) {
    const normalizedMode = String(mode || 'machine').trim();
    if (!VALID_MODES.has(normalizedMode)) {
      throw new Error(`不支持的翻译模式: ${normalizedMode}`);
    }
    const normalizedStyle = VALID_STYLES.has(style) ? style : 'technical';
    const normalizedLang = String(targetLang || 'zh-CN').trim() || 'zh-CN';
    const cappedPrompt = String(customPrompt || '').trim().slice(0, MAX_CUSTOM_PROMPT_CHARS);
    const inputText = String(text ?? '');

    let profile = null;
    let resolvedProfileId = '';
    let resolvedModel = normalizedMode === 'machine' ? 'google-gtx' : '';
    if (normalizedMode === 'ai') {
      profile = resolveProfile(profileId);
      resolvedProfileId = profile.id;
      resolvedModel = profile.model;
    }

    if (!inputText.trim()) {
      return {
        ok: true,
        translated: '',
        cached: false,
        mode: normalizedMode,
        model: resolvedModel
      };
    }

    const cacheKey = makeCacheKey({
      mode: normalizedMode,
      targetLang: normalizedLang,
      style: normalizedStyle,
      customPrompt: cappedPrompt,
      profileId: resolvedProfileId,
      model: resolvedModel,
      text: inputText
    });

    if (!force) {
      const hit = cacheGet(cacheKey);
      if (hit) {
        return {
          ok: true,
          translated: hit.translated,
          cached: true,
          mode: normalizedMode,
          model: resolvedModel
        };
      }
      const pending = inFlight.get(cacheKey);
      if (pending) {
        const res = await pending;
        return {
          ok: true,
          translated: res.translated,
          cached: false,
          mode: normalizedMode,
          model: resolvedModel
        };
      }
    }

    const task = runWithConcurrency(async () => {
      const translated = normalizedMode === 'machine'
        ? await runMachineTranslate(inputText, normalizedLang)
        : await runAiTranslate({
          text: inputText,
          targetLang: normalizedLang,
          style: normalizedStyle,
          customPrompt: cappedPrompt,
          profile
        });
      cacheSet(cacheKey, { translated, mode: normalizedMode, model: resolvedModel });
      return { translated };
    });

    if (!force) inFlight.set(cacheKey, task);
    try {
      const result = await task;
      return {
        ok: true,
        translated: result.translated,
        cached: false,
        mode: normalizedMode,
        model: resolvedModel
      };
    } finally {
      if (!force && inFlight.get(cacheKey) === task) {
        inFlight.delete(cacheKey);
      }
    }
  }

  async function translateTitles({
    items = [],
    mode = 'machine',
    targetLang = 'zh-CN',
    profileId = ''
  } = {}) {
    const normalizedMode = String(mode || 'machine').trim();
    if (!VALID_MODES.has(normalizedMode)) {
      throw new Error(`不支持的翻译模式: ${normalizedMode}`);
    }
    const normalizedLang = String(targetLang || 'zh-CN').trim() || 'zh-CN';
    const skipCjk = normalizedLang.toLowerCase().startsWith('zh');
    const list = Array.isArray(items) ? items : [];
    const selected = [];
    for (const item of list) {
      if (selected.length >= MAX_TITLE_ITEMS) break;
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim();
      const title = String(item.title || '').trim();
      if (!id || !title) continue;
      if (skipCjk && isPrimarilyCjk(title)) continue;
      selected.push({ id, title });
    }

    if (selected.length === 0) {
      return { ok: true, translations: {} };
    }

    if (normalizedMode === 'ai') {
      resolveProfile(profileId);
    }

    const titlePrompt = 'Translate the conversation title accurately and concisely on a single line, preserving code identifiers and technical terms.';
    const translations = {};
    let firstError = null;
    const settled = await Promise.allSettled(selected.map(async ({ id, title }) => {
      const res = await translate({
        text: title,
        mode: normalizedMode,
        targetLang: normalizedLang,
        style: normalizedMode === 'ai' ? 'custom' : 'technical',
        customPrompt: normalizedMode === 'ai' ? titlePrompt : '',
        profileId
      });
      return { id, translated: res.translated.replace(/\r?\n/g, ' ').trim() };
    }));

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        if (outcome.value.translated) {
          translations[outcome.value.id] = outcome.value.translated;
        }
      } else if (!firstError) {
        firstError = outcome.reason;
      }
    }

    if (Object.keys(translations).length === 0 && firstError) {
      throw firstError;
    }
    return { ok: true, translations };
  }

  function getProfiles() {
    return {
      ok: true,
      activeProfileId: profilesStore.activeProfileId,
      profiles: profilesStore.profiles.map(maskProfile),
      cacheEntries: cache.size
    };
  }

  function saveProfile({ profile, setActive = true } = {}) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      throw new Error('配置对象格式无效');
    }
    const checked = validateUpstreamUrl(profile.baseUrl, { stripCompletionsSuffix: true });
    const rawId = typeof profile.id === 'string' ? profile.id.trim() : '';
    const id = rawId || `prof_${randomBytes(6).toString('hex')}`;
    if (id.length > 128 || /[\x00-\x1f\x7f]/.test(id)) {
      throw new Error('配置 ID 无效');
    }

    const existingIdx = profilesStore.profiles.findIndex(p => p.id === id);
    const existing = existingIdx >= 0 ? profilesStore.profiles[existingIdx] : null;
    const sameBaseUrl = Boolean(existing && existing.baseUrl === checked.url);

    let resolvedApiKey = '';
    const incomingKey = profile.apiKey;
    if (existing && sameBaseUrl) {
      if (incomingKey === undefined || incomingKey === null) {
        resolvedApiKey = existing.apiKey;
      } else if (typeof incomingKey === 'string') {
        const trimmedKey = incomingKey.trim();
        if (existing.apiKey && trimmedKey === maskApiKey(existing.apiKey)) {
          resolvedApiKey = existing.apiKey;
        } else {
          resolvedApiKey = trimmedKey;
        }
      }
    } else if (typeof incomingKey === 'string') {
      const trimmedKey = incomingKey.trim();
      if (existing && existing.apiKey && trimmedKey === maskApiKey(existing.apiKey)) {
        resolvedApiKey = '';
      } else {
        resolvedApiKey = trimmedKey;
      }
    }

    if (!resolvedApiKey && !isLocalOrLanHost(checked.hostname)) {
      throw new Error('非本地或局域网接口需要填写 API Key');
    }

    const name = String(profile.name || '').trim().slice(0, 120) || checked.hostname;
    const model = String(profile.model || '').trim().slice(0, 200);
    const nextRecord = {
      id,
      name,
      baseUrl: checked.url,
      apiKey: resolvedApiKey,
      model
    };

    if (existingIdx >= 0) {
      profilesStore.profiles[existingIdx] = nextRecord;
    } else {
      profilesStore.profiles.push(nextRecord);
    }

    if (setActive || !profilesStore.activeProfileId) {
      profilesStore.activeProfileId = id;
    }
    persistProfiles();

    return {
      ok: true,
      activeProfileId: profilesStore.activeProfileId,
      profiles: profilesStore.profiles.map(maskProfile)
    };
  }

  function deleteProfile({ id } = {}) {
    const targetId = String(id || '').trim();
    if (!targetId) throw new Error('缺少配置 ID');
    const nextProfiles = profilesStore.profiles.filter(p => p.id !== targetId);
    profilesStore.profiles = nextProfiles;
    if (profilesStore.activeProfileId === targetId) {
      profilesStore.activeProfileId = nextProfiles[0]?.id || '';
    }
    persistProfiles();
    return {
      ok: true,
      activeProfileId: profilesStore.activeProfileId,
      profiles: profilesStore.profiles.map(maskProfile)
    };
  }

  async function fetchModels({ baseUrl = '', apiKey, profileId = '' } = {}) {
    const saved = profileId ? profilesStore.profiles.find(p => p.id === String(profileId).trim()) : null;
    const rawBase = String(baseUrl || '').trim() || saved?.baseUrl || '';
    const checked = validateUpstreamUrl(rawBase, { stripCompletionsSuffix: true });

    let resolvedKey = '';
    const explicitKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const isMaskedSaved = Boolean(saved?.apiKey && explicitKey === maskApiKey(saved.apiKey));

    if (explicitKey && !isMaskedSaved) {
      resolvedKey = explicitKey;
    } else if (saved) {
      const savedChecked = validateUpstreamUrl(saved.baseUrl, { stripCompletionsSuffix: true });
      if (checked.origin !== savedChecked.origin) {
        throw new Error('拒绝将已保存配置的 API Key 发送到不同源地址');
      }
      resolvedKey = saved.apiKey;
    }

    if (!resolvedKey && !isLocalOrLanHost(checked.hostname)) {
      throw new Error('远端模型列表接口需要 API Key');
    }

    const modelsUrl = `${checked.url}/models`;
    const headers = { Accept: 'application/json' };
    if (resolvedKey) headers.Authorization = `Bearer ${resolvedKey}`;

    const response = await doFetch(modelsUrl, {
      method: 'GET',
      headers
    });
    if (!response?.ok) {
      throw new Error(`拉取模型列表失败 (HTTP ${response?.status || 'unknown'})`);
    }
    const payload = await response.json();
    const models = extractModelIds(payload);
    return { ok: true, models };
  }

  async function diagnose({ mode = 'machine', profileId = '' } = {}) {
    const normalizedMode = VALID_MODES.has(mode) ? mode : 'machine';
    const proxy = resolveActiveProxy(getSettings);
    const startedAt = Date.now();
    try {
      if (normalizedMode === 'machine') {
        const text = await runMachineTranslateChunk('hello', 'zh-CN');
        const latencyMs = Date.now() - startedAt;
        return {
          ok: true,
          daemonAlive: true,
          mode: normalizedMode,
          proxyActive: proxy.active,
          proxyUrl: proxy.maskedUrl,
          upstreamOk: Boolean(text),
          latencyMs,
          message: `机器翻译上游连通正常 (${latencyMs}ms)`
        };
      }
      const profile = resolveProfile(profileId);
      const result = await fetchModels({ baseUrl: profile.baseUrl, profileId: profile.id });
      const latencyMs = Date.now() - startedAt;
      return {
        ok: true,
        daemonAlive: true,
        mode: normalizedMode,
        proxyActive: proxy.active,
        proxyUrl: proxy.maskedUrl,
        upstreamOk: true,
        latencyMs,
        message: `AI 渠道连通正常，共发现 ${result.models.length} 个模型 (${latencyMs}ms)`
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      return {
        ok: false,
        daemonAlive: true,
        mode: normalizedMode,
        proxyActive: proxy.active,
        proxyUrl: proxy.maskedUrl,
        upstreamOk: false,
        latencyMs,
        message: error?.message || '上游诊断失败'
      };
    }
  }

  function clearCache() {
    const cleared = cache.size;
    cache.clear();
    persistCache();
    return { ok: true, cleared };
  }

  function exportSanitized() {
    return {
      ok: true,
      version: 1,
      activeProfileId: profilesStore.activeProfileId,
      profiles: profilesStore.profiles.map(p => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        apiKey: '',
        model: p.model
      }))
    };
  }

  function importSanitized(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('导入的翻译配置格式无效');
    }
    const source = Array.isArray(data)
      ? { profiles: data, activeProfileId: '' }
      : (data.thoughtProfiles && typeof data.thoughtProfiles === 'object' ? data.thoughtProfiles : data);
    if (!Array.isArray(source.profiles)) {
      throw new Error('导入的翻译配置缺少 profiles 数组');
    }

    const imported = [];
    const seenIds = new Set();
    for (const raw of source.profiles) {
      if (!raw || typeof raw !== 'object') continue;
      const checked = validateUpstreamUrl(raw.baseUrl, { stripCompletionsSuffix: true });
      const id = String(raw.id || '').trim() || `prof_${randomBytes(6).toString('hex')}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      imported.push({
        id,
        name: String(raw.name || '').trim().slice(0, 120) || checked.hostname,
        baseUrl: checked.url,
        apiKey: '',
        model: String(raw.model || '').trim().slice(0, 200)
      });
    }

    const activeId = typeof source.activeProfileId === 'string' && imported.some(p => p.id === source.activeProfileId)
      ? source.activeProfileId
      : (imported[0]?.id || '');

    profilesStore = { activeProfileId: activeId, profiles: imported };
    persistProfiles();

    return {
      ok: true,
      activeProfileId: profilesStore.activeProfileId,
      profiles: profilesStore.profiles.map(maskProfile),
      importedCount: imported.length
    };
  }

  return {
    translate,
    translateTitles,
    getProfiles,
    saveProfile,
    deleteProfile,
    fetchModels,
    diagnose,
    clearCache,
    exportSanitized,
    exportSanitizedProfiles: exportSanitized,
    importSanitized
  };
}
