import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const HOST_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$|^\[[0-9A-Fa-f:.]+(?:%[A-Za-z0-9._-]+)?\]$/;
const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const SAFE_VALUE_RE = /^[^\x00-\x1f\x7f\r\n]+$/;

const SSH_OPTS_WITH_ARG = new Set([
  '-b', '-B', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J',
  '-L', '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w'
]);

export function tokenizeSshCommand(raw = '') {
  const tokens = [];
  let cur = '';
  let quote = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ' ' || ch === '\t') {
      if (cur) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (escaped) cur += '\\';
  if (cur) tokens.push(cur);
  return tokens;
}

export function deriveHostAlias(host, port = 0, user = '') {
  const cleanHost = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!cleanHost) return 'ssh-host';
  let base = '';
  const seeta = cleanHost.match(/^connect\.([a-z0-9-]+)\.seetacloud\.com$/i);
  const autodl = cleanHost.match(/^(?:connect\.|region-)?([a-z0-9-]+)\.autodl\.(?:com|pro)$/i);
  if (seeta) base = `seetacloud-${seeta[1].toLowerCase()}`;
  else if (autodl) base = `autodl-${autodl[1].toLowerCase()}`;
  else if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(cleanHost)) base = `ssh-${cleanHost.replace(/\./g, '-')}`;
  else {
    const segs = cleanHost.split('.').filter(Boolean);
    base = segs.length >= 2 ? segs.slice(0, 2).join('-') : (segs[0] || 'ssh-host');
  }
  base = base.replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '') || 'ssh-host';
  const suffix = Number.isInteger(port) && port > 0 && port !== 22 ? `-${port}` : '';
  const prefix = user && user !== 'root' ? `${String(user).replace(/[^a-z0-9_-]+/gi, '').toLowerCase()}-` : '';
  const alias = `${prefix}${base}${suffix}`.slice(0, 62).replace(/[-._]+$/g, '');
  return ALIAS_RE.test(alias) ? alias : 'ssh-host';
}

function splitTarget(token) {
  let raw = String(token || '').trim();
  if (raw.startsWith('ssh://')) raw = raw.slice(6).replace(/\/+$/, '');
  let user = '';
  const at = raw.lastIndexOf('@');
  if (at >= 0) {
    user = raw.slice(0, at);
    raw = raw.slice(at + 1);
    if (!user || !USER_RE.test(user)) return null;
  }
  let host = raw;
  let port = 0;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end < 0) return null;
    host = raw.slice(0, end + 1);
    const rest = raw.slice(end + 1);
    if (rest) {
      if (!rest.startsWith(':')) return null;
      const p = Number(rest.slice(1));
      if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
      port = p;
    }
  } else {
    const colons = raw.split(':').length - 1;
    if (colons === 1) {
      const idx = raw.indexOf(':');
      const p = Number(raw.slice(idx + 1));
      if (!Number.isInteger(p) || p < 1 || p > 65535) return null;
      host = raw.slice(0, idx);
      port = p;
    } else if (colons > 1) {
      return null;
    }
  }
  if (!host || !HOST_RE.test(host)) return null;
  return { user, host, port };
}

/**
 * Parses a standard OpenSSH command (`ssh -p 11430 root@host`, `-l`, `-i`, `-J`, `-A`, etc.)
 * modeled on VS Code Remote-SSH (`open-remote-ssh`). Always discards any trailing text/password.
 */
export function parseOpenSshCommand(raw = '') {
  const input = String(raw || '').trimStart();
  if (!/^ssh(?:\.exe)?(?=\s|$)/i.test(input)) return null;
  const lines = input.split(/\r?\n/);
  const firstLine = lines[0].trimEnd();
  const tokens = tokenizeSshCommand(firstLine);
  if (tokens.length < 2 || !/^ssh(?:\.exe)?$/i.test(basename(tokens[0]))) {
    return { valid: false };
  }

  let optPort = 0;
  let optUser = '';
  let identityFile = '';
  let proxyJump = '';
  let configFile = '';
  let forwardAgent = false;
  let targetToken = '';
  let hadTrailingText = lines.slice(1).some(l => l.trim().length > 0);
  let afterDoubleDash = false;

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!afterDoubleDash && tok === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && tok.startsWith('-') && tok.length > 1) {
      // Once we already have a target and another positional (e.g. trailing password), stop parsing options
      if (targetToken && hadTrailingText) break;
      const flag = tok.slice(0, 2);
      if (flag === '-p') {
        const val = tok.length > 2 ? tok.slice(2) : tokens[++i];
        const p = Number(val);
        if (!Number.isInteger(p) || p < 1 || p > 65535) return { valid: false };
        optPort = p;
        continue;
      }
      if (flag === '-l') {
        const val = tok.length > 2 ? tok.slice(2) : (tokens[++i] || '');
        if (!val || !USER_RE.test(val)) return { valid: false };
        optUser = val;
        continue;
      }
      if (flag === '-i') {
        identityFile = tok.length > 2 ? tok.slice(2) : (tokens[++i] || '');
        if (!identityFile || !SAFE_VALUE_RE.test(identityFile)) return { valid: false };
        continue;
      }
      if (flag === '-J') {
        proxyJump = tok.length > 2 ? tok.slice(2) : (tokens[++i] || '');
        if (!proxyJump || !SAFE_VALUE_RE.test(proxyJump)) return { valid: false };
        continue;
      }
      if (flag === '-F') {
        configFile = tok.length > 2 ? tok.slice(2) : (tokens[++i] || '');
        if (!configFile || !SAFE_VALUE_RE.test(configFile)) return { valid: false };
        continue;
      }
      if (flag === '-A') {
        forwardAgent = true;
        continue;
      }
      if (SSH_OPTS_WITH_ARG.has(flag)) {
        // Unsupported option with argument (e.g. -o, -L, -R): reject to stay strict & safe
        return { valid: false };
      }
      // Simple boolean flags like -T, -N, -4, -6, -C, -v
      if (/^-[TN46Cvq]+$/.test(tok)) continue;
      return { valid: false };
    }
    if (!targetToken) {
      targetToken = tok;
    } else {
      hadTrailingText = true;
    }
  }

  if (!targetToken) return { valid: false };
  const split = splitTarget(targetToken);
  if (!split) return { valid: false };
  if (optPort && split.port) return { valid: false };
  const port = optPort || split.port || 0;
  const user = split.user || optUser || '';
  const host = split.host;
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const destination = `${user ? `${user}@` : ''}${host}${port ? `:${port}` : ''}`;

  return {
    valid: true,
    destination,
    host: bareHost,
    user,
    port,
    identityFile,
    proxyJump,
    forwardAgent,
    configFile,
    hadTrailingText,
    suggestedAlias: deriveHostAlias(bareHost, port, user)
  };
}

function formatConfigValue(val) {
  const s = String(val ?? '').trim();
  return /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/**
 * Losslessly updates or appends a `Host <alias>` section in an OpenSSH config file,
 * preserving all existing comments, blank lines, indentation, and other tools' directives.
 */
export function upsertSshConfigHost(existingContent = '', entry = {}) {
  const alias = String(entry.alias || '').trim();
  const hostName = String(entry.host || entry.hostName || '').trim();
  const user = String(entry.user || '').trim();
  const port = Number(entry.port || 0);
  const identityFile = String(entry.identityFile || '').trim();
  const proxyJump = String(entry.proxyJump || '').trim();
  const forwardAgent = Boolean(entry.forwardAgent);

  if (!ALIAS_RE.test(alias)) throw new Error('无效的 SSH 主机别名');
  if (!hostName || !SAFE_VALUE_RE.test(hostName) || /\s/.test(hostName)) throw new Error('无效的 SSH 主机名');
  if (user && !USER_RE.test(user)) throw new Error('无效的 SSH 用户名');
  if (port && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('无效的 SSH 端口');
  if (identityFile && !SAFE_VALUE_RE.test(identityFile)) throw new Error('无效的密钥文件路径');
  if (proxyJump && !SAFE_VALUE_RE.test(proxyJump)) throw new Error('无效的 ProxyJump 参数');

  const updates = new Map([['hostname', { key: 'HostName', value: hostName }]]);
  if (user) updates.set('user', { key: 'User', value: user });
  if (port > 0) updates.set('port', { key: 'Port', value: String(port) });
  if (identityFile) updates.set('identityfile', { key: 'IdentityFile', value: formatConfigValue(identityFile) });
  if (proxyJump) updates.set('proxyjump', { key: 'ProxyJump', value: formatConfigValue(proxyJump) });
  if (forwardAgent) updates.set('forwardagent', { key: 'ForwardAgent', value: 'yes' });

  const eol = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  let secStart = -1;
  let secEnd = lines.length;
  let indent = '  ';

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].replace(/#.*$/, '').trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(Host|Match)\s+(.*)$/i);
    if (!m) {
      if (secStart >= 0 && indent === '  ') {
        const ws = lines[i].match(/^(\s+)/);
        if (ws) indent = ws[1];
      }
      continue;
    }
    if (secStart >= 0) {
      secEnd = i;
      break;
    }
    if (m[1].toLowerCase() === 'host') {
      const patterns = m[2].trim().split(/\s+/);
      if (patterns.length === 1 && patterns[0] === alias) {
        secStart = i;
      }
    }
  }

  if (secStart >= 0) {
    const replaced = new Set();
    const out = [...lines];
    let lastDirectiveIdx = secStart;
    for (let i = secStart + 1; i < secEnd; i++) {
      const stripped = out[i].replace(/#.*$/, '').trim();
      if (!stripped) continue;
      const m = out[i].match(/^(\s*)([A-Za-z][A-Za-z0-9]*)(\s*=\s*|\s+)(.*)$/);
      if (!m) continue;
      lastDirectiveIdx = i;
      const kLower = m[2].toLowerCase();
      if (updates.has(kLower) && !replaced.has(kLower)) {
        const next = updates.get(kLower);
        out[i] = `${m[1]}${m[2]}${m[3]}${next.value}`;
        replaced.add(kLower);
      }
    }
    const missingLines = [];
    for (const [kLower, spec] of updates.entries()) {
      if (!replaced.has(kLower)) missingLines.push(`${indent}${spec.key} ${spec.value}`);
    }
    if (missingLines.length) out.splice(lastDirectiveIdx + 1, 0, ...missingLines);
    return out.join(eol) + eol;
  }

  const block = [`Host ${alias}`];
  for (const spec of updates.values()) block.push(`  ${spec.key} ${spec.value}`);
  if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
  return [...lines, ...block].join(eol) + eol;
}

export function saveHostToSshConfig(entry, { home = homedir(), configFile = '' } = {}) {
  const sshDir = join(home, '.ssh');
  const defaultPath = join(sshDir, 'config');
  const targetPath = configFile && isAbsolute(configFile) ? configFile : defaultPath;
  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
  if (dirname(targetPath) === sshDir) {
    try { chmodSync(sshDir, 0o700); } catch {}
  }
  const prev = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '';
  const next = upsertSshConfigHost(prev, entry);
  const tmp = `${targetPath}.tmp.${process.pid}`;
  writeFileSync(tmp, next, { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch {}
  renameSync(tmp, targetPath);
  return { ok: true, alias: String(entry.alias || '').trim(), configPath: targetPath };
}
