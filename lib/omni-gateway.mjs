import { execFile } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { pluginDataDir } from './paths.mjs';

const DEFAULT_MAX_TABLE_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_DIFF_LINES = 300;
const MAX_UNTRACKED_LINES = 120;
const MAX_UNTRACKED_BYTES = 256 * 1024;
const MAX_REGISTERED_FILES = 256;
const MAX_JSONL_HEADERS = 200;
const MAX_CHAT_FOLDERS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const VALID_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ALLOWED_ORIGIN_RE = /^(?:null|https?:\/\/127\.0\.0\.1(?::\d+)?|https:\/\/localhost(?::\d+)?)$/i;
const ALLOWED_FETCH_SITES = new Set(['none', 'same-origin', 'cross-site']);
const STREAM_PATH_RE = /^\/stream\/([a-f0-9]{16,64})$/;
const HTML_CSP = "default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'";
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:";

const VIDEO_MIMES = Object.freeze({
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg'
});

const AUDIO_MIMES = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac'
});

const IMAGE_MIMES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon'
});

const TABLE_MIMES = Object.freeze({
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8'
});

const FONT_MIMES = Object.freeze({
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
});

const CODE_MIMES = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.scss': 'text/plain; charset=utf-8',
  '.less': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.toml': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.go': 'text/plain; charset=utf-8',
  '.rs': 'text/plain; charset=utf-8',
  '.java': 'text/plain; charset=utf-8',
  '.c': 'text/plain; charset=utf-8',
  '.h': 'text/plain; charset=utf-8',
  '.cpp': 'text/plain; charset=utf-8',
  '.hpp': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.zsh': 'text/plain; charset=utf-8',
  '.bash': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.graphql': 'text/plain; charset=utf-8',
  '.vue': 'text/plain; charset=utf-8',
  '.svelte': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.conf': 'text/plain; charset=utf-8'
});

const WALLPAPER_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const WALLPAPER_VIDEO_EXTS = new Set(['.mp4', '.webm']);

export function classifyFileKind(filePath) {
  const ext = extname(String(filePath || '')).toLowerCase();
  if (VIDEO_MIMES[ext]) return 'video';
  if (AUDIO_MIMES[ext]) return 'audio';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.svg') return 'svg';
  if (IMAGE_MIMES[ext]) return 'image';
  if (TABLE_MIMES[ext]) return 'table';
  if (FONT_MIMES[ext]) return 'font';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (CODE_MIMES[ext]) return 'code';
  return 'binary';
}

export function mimeForExt(extInput) {
  const ext = String(extInput || '').toLowerCase();
  if (VIDEO_MIMES[ext]) return VIDEO_MIMES[ext];
  if (AUDIO_MIMES[ext]) return AUDIO_MIMES[ext];
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.svg') return 'image/svg+xml';
  if (IMAGE_MIMES[ext]) return IMAGE_MIMES[ext];
  if (TABLE_MIMES[ext]) return TABLE_MIMES[ext];
  if (FONT_MIMES[ext]) return FONT_MIMES[ext];
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (CODE_MIMES[ext]) return CODE_MIMES[ext];
  return 'application/octet-stream';
}

function toPosixSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

function collectHomePrefixes(home) {
  const roots = new Set();
  for (const candidate of [home, homedir()]) {
    if (!candidate) continue;
    const resolved = toPosixSlashes(resolve(candidate)).replace(/\/+$/, '').toLowerCase();
    roots.add(resolved);
    try {
      const real = toPosixSlashes(realpathSync(candidate)).replace(/\/+$/, '').toLowerCase();
      roots.add(real);
    } catch { /* Ignore missing synthetic home in tests. */ }
  }
  return [...roots];
}

function isSensitivePath(filePath, homePrefixes) {
  const norm = toPosixSlashes(filePath).replace(/\/+$/, '');
  const lower = norm.toLowerCase();
  const base = basename(norm).toLowerCase();

  for (const homeRoot of homePrefixes) {
    const restrictedDirs = [
      `${homeRoot}/.ssh`,
      `${homeRoot}/.aws`,
      `${homeRoot}/.gnupg`,
      `${homeRoot}/.kube`
    ];
    for (const dir of restrictedDirs) {
      if (lower === dir || lower.startsWith(`${dir}/`)) return true;
    }
    const accountsPrefix = `${homeRoot}/.gemini/antigravity/plugin_data/agy-powertools/accounts`;
    if (lower === accountsPrefix || lower.startsWith(accountsPrefix)) return true;
  }

  if (/(?:^|\/)\.(?:ssh|aws|gnupg|kube)(?:\/|$)/i.test(lower)) return true;
  if (/(?:^|\/)\.gemini\/antigravity\/plugin_data\/agy-powertools\/accounts/i.test(lower)) return true;
  if (/(?:^|\/)\.gemini\/config\/plugins\/[^/]+\/thought-profiles\.json$/i.test(lower)) return true;
  if (base === 'thought-profiles.json') return true;
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (/\.(?:pem|key|p12|pfx)$/i.test(base)) return true;
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(base)) return true;
  if (/credential/i.test(base) || /(?:^|\/)[^/]*credential[^/]*(?:\/|$)/i.test(lower)) return true;
  if (lower === '/etc/shadow' || lower === '/etc/master.passwd' || lower === '/etc/sudoers') return true;

  return false;
}

function parseInputToLocalPath(uriOrPath) {
  const raw = String(uriOrPath || '').trim();
  if (!raw || raw.includes('\0')) {
    throw new Error('无效的文件路径');
  }
  if (/^\\\\[.?]\\/.test(raw) || /^\/\/[.?]\//.test(raw)) {
    throw new Error('禁止访问设备路径');
  }
  if (raw.startsWith('\\\\') || raw.startsWith('//')) {
    throw new Error('禁止访问 UNC 网络共享路径');
  }
  if (/%2e%2e/i.test(raw) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(raw)) {
    throw new Error('禁止包含上级目录越界路径');
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('文件 URI 格式无效');
    }
    if (parsed.protocol !== 'file:') {
      throw new Error(`仅支持本地 file:// URI，不支持 ${parsed.protocol}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (host && host !== 'localhost') {
      throw new Error('禁止访问远程或 UNC file:// 路径');
    }
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(parsed.pathname);
    } catch {
      throw new Error('文件 URI 解码失败');
    }
    if (decodedPath.includes('\0') || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(decodedPath)) {
      throw new Error('文件 URI 包含非法路径段');
    }
    if (/^\/[.?]\//.test(decodedPath)) {
      throw new Error('禁止访问设备路径');
    }
    try {
      return fileURLToPath(parsed);
    } catch {
      throw new Error('无法转换本地文件 URI');
    }
  }

  if (!isAbsolute(raw)) {
    throw new Error('仅允许绝对路径或 file:// URI');
  }
  return raw;
}

export function resolveSafePreviewPath(uriOrPath, { home = homedir() } = {}) {
  const localPath = parseInputToLocalPath(uriOrPath);
  const homePrefixes = collectHomePrefixes(home);

  if (isSensitivePath(localPath, homePrefixes)) {
    throw new Error('目标路径属于受保护的敏感凭据目录或文件，已拒绝访问');
  }
  if (!existsSync(localPath)) {
    throw new Error('目标文件不存在');
  }

  let realPath;
  try {
    realPath = realpathSync(localPath);
  } catch {
    throw new Error('无法解析目标文件真实路径');
  }

  if (isSensitivePath(realPath, homePrefixes)) {
    throw new Error('符号链接或真实路径指向敏感凭据位置，已拒绝访问');
  }

  let st;
  try {
    st = statSync(realPath);
  } catch {
    throw new Error('无法读取目标文件信息');
  }
  if (!st.isFile()) {
    throw new Error('目标路径不是普通文件');
  }

  return {
    realPath,
    size: st.size,
    name: basename(realPath)
  };
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, filePath);
}

function readJsonSafe(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGIN_RE.test(String(origin).trim());
}

function isAllowedReferer(referer) {
  if (!referer) return true;
  try {
    const parsed = new URL(String(referer).trim());
    return ALLOWED_ORIGIN_RE.test(parsed.origin);
  } catch {
    return false;
  }
}

function parseByteRange(rangeHeader, fileSize) {
  const match = String(rangeHeader || '').trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (fileSize <= 0) return null;

  let start;
  let end;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(Number(rawEnd), fileSize - 1) : fileSize - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= fileSize) {
    return null;
  }
  return { start, end };
}

function formatJsonlCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function streamDelimitedTable(filePath, delimiter, { offset, limit, queryLower, maxScanBytes }) {
  return new Promise((resolvePromise, rejectPromise) => {
    let headers = null;
    const rows = [];
    let totalMatched = 0;
    let truncated = false;
    let bytesRead = 0;
    let firstChunk = true;

    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;
    let justClosedQuote = false;
    let pendingCarriageReturn = false;

    const emitRow = () => {
      currentRow.push(currentCell);
      currentCell = '';
      justClosedQuote = false;
      const isBlankSingle = currentRow.length === 1 && currentRow[0] === '';
      const row = currentRow;
      currentRow = [];
      if (isBlankSingle) return;

      if (!headers) {
        headers = row.map(c => String(c));
        return;
      }
      if (queryLower) {
        const matched = row.some(cell => cell.toLowerCase().includes(queryLower));
        if (!matched) return;
      }
      if (totalMatched >= offset && rows.length < limit) {
        rows.push(row);
      }
      totalMatched++;
    };

    const feedText = text => {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (pendingCarriageReturn) {
          pendingCarriageReturn = false;
          if (ch === '\n') continue;
        }
        if (inQuotes) {
          if (ch === '"') {
            if (i + 1 < text.length && text[i + 1] === '"') {
              currentCell += '"';
              i++;
            } else {
              inQuotes = false;
              justClosedQuote = true;
            }
          } else {
            currentCell += ch;
          }
          continue;
        }
        if (justClosedQuote) {
          justClosedQuote = false;
          if (ch === '"') {
            currentCell += '"';
            inQuotes = true;
            continue;
          }
        }
        if (ch === '"' && currentCell.length === 0) {
          inQuotes = true;
        } else if (ch === delimiter) {
          currentRow.push(currentCell);
          currentCell = '';
        } else if (ch === '\r') {
          pendingCarriageReturn = true;
          emitRow();
        } else if (ch === '\n') {
          emitRow();
        } else {
          currentCell += ch;
        }
      }
    };

    const decoder = new StringDecoder('utf8');
    const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
    let finished = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      if (!truncated) {
        const tail = decoder.end();
        if (tail) feedText(tail);
        if (currentCell.length > 0 || currentRow.length > 0) {
          emitRow();
        }
      }
      const finalHeaders = headers || [];
      const colCount = finalHeaders.length;
      const normalizedRows = colCount > 0
        ? rows.map(r => (r.length < colCount ? [...r, ...Array(colCount - r.length).fill('')] : r))
        : rows;
      resolvePromise({
        headers: finalHeaders,
        rows: normalizedRows,
        totalMatched,
        truncated
      });
    };

    stream.on('data', chunk => {
      const remaining = maxScanBytes - bytesRead;
      if (remaining <= 0) {
        truncated = true;
        stream.destroy();
        finalize();
        return;
      }
      let slice = chunk;
      if (chunk.length > remaining) {
        slice = chunk.subarray(0, remaining);
        truncated = true;
      }
      bytesRead += slice.length;
      let text = decoder.write(slice);
      if (firstChunk) {
        firstChunk = false;
        if (text.startsWith('\uFEFF')) text = text.slice(1);
      }
      feedText(text);
      if (truncated) {
        stream.destroy();
        finalize();
      }
    });

    stream.on('end', finalize);
    stream.on('error', err => {
      if (!finished) {
        finished = true;
        rejectPromise(err);
      }
    });
  });
}

function streamJsonlTable(filePath, { offset, limit, queryLower, maxScanBytes }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const headerSet = new Set();
    const headers = [];
    const collectedObjects = [];
    let totalMatched = 0;
    let truncated = false;
    let bytesRead = 0;
    let firstChunk = true;
    let leftover = '';

    const registerHeader = key => {
      if (!headerSet.has(key) && headers.length < MAX_JSONL_HEADERS) {
        headerSet.add(key);
        headers.push(key);
      }
    };

    const processLine = rawLine => {
      const line = rawLine.replace(/\r$/, '').trim();
      if (!line) return;
      let obj;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          obj = parsed;
        } else {
          obj = { value: parsed };
        }
      } catch {
        obj = { _raw: line };
      }

      const keys = Object.keys(obj);
      for (const k of keys) registerHeader(k);

      if (queryLower) {
        const matched = keys.some(k => formatJsonlCell(obj[k]).toLowerCase().includes(queryLower));
        if (!matched) return;
      }

      if (totalMatched >= offset && collectedObjects.length < limit) {
        collectedObjects.push(obj);
      }
      totalMatched++;
    };

    const decoder = new StringDecoder('utf8');
    const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
    let finished = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      if (!truncated) {
        const tail = decoder.end();
        const finalLine = leftover + tail;
        if (finalLine.trim()) processLine(finalLine);
      }
      const rows = collectedObjects.map(obj => headers.map(h => formatJsonlCell(obj[h])));
      resolvePromise({
        headers,
        rows,
        totalMatched,
        truncated
      });
    };

    stream.on('data', chunk => {
      const remaining = maxScanBytes - bytesRead;
      if (remaining <= 0) {
        truncated = true;
        stream.destroy();
        finalize();
        return;
      }
      let slice = chunk;
      if (chunk.length > remaining) {
        slice = chunk.subarray(0, remaining);
        truncated = true;
      }
      bytesRead += slice.length;
      let text = decoder.write(slice);
      if (firstChunk) {
        firstChunk = false;
        if (text.startsWith('\uFEFF')) text = text.slice(1);
      }
      const combined = leftover + text;
      const lines = combined.split('\n');
      leftover = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
      if (truncated) {
        stream.destroy();
        finalize();
      }
    });

    stream.on('end', finalize);
    stream.on('error', err => {
      if (!finished) {
        finished = true;
        rejectPromise(err);
      }
    });
  });
}

function runGitSafe(cwd, args, { execGit = execFile, timeoutMs = 4000 } = {}) {
  return new Promise(resolvePromise => {
    execGit(
      'git',
      ['--no-optional-locks', '--literal-pathspecs', ...args],
      { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout = '', stderr = '') => {
        resolvePromise({
          ok: !error,
          code: error?.code ?? 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        });
      }
    );
  });
}

function resolveWorkspaceDir(workspaceUri) {
  const raw = String(workspaceUri || '').trim();
  if (!raw || raw.includes('\0')) throw new Error('工作区路径无效');
  let dir = raw;
  if (raw.startsWith('file://')) {
    dir = fileURLToPath(new URL(raw));
  }
  if (!isAbsolute(dir) || !existsSync(dir)) {
    throw new Error('工作区目录不存在');
  }
  return realpathSync(dir);
}

function resolveRepoFilePath(repoRootReal, workspaceDirReal, relOrAbsPath) {
  const raw = String(relOrAbsPath || '').trim();
  if (!raw || raw.includes('\0')) throw new Error('目标文件路径无效');
  let candidate = raw;
  if (raw.startsWith('file://')) {
    candidate = fileURLToPath(new URL(raw));
  }
  const full = isAbsolute(candidate) ? resolve(candidate) : resolve(workspaceDirReal, candidate);

  let resolvedTarget = full;
  if (existsSync(full)) {
    resolvedTarget = realpathSync(full);
  } else {
    const parent = dirname(full);
    if (existsSync(parent)) {
      resolvedTarget = join(realpathSync(parent), basename(full));
    }
  }

  const rel = relative(repoRootReal, resolvedTarget);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('目标文件路径超出 Git 仓库边界');
  }
  return {
    fullPath: resolvedTarget,
    relPath: rel.replace(/\\/g, '/')
  };
}

function parseUnifiedDiffLines(rawDiff) {
  const text = String(rawDiff || '').replace(/\r\n/g, '\n');
  const parsed = [];
  let inHunk = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('@@ ')) {
      inHunk = true;
      parsed.push({ kind: 'hunk', text: line });
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('+')) {
      parsed.push({ kind: 'add', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      parsed.push({ kind: 'del', text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      parsed.push({ kind: 'ctx', text: line.slice(1) });
    }
  }
  const truncated = parsed.length > MAX_DIFF_LINES;
  return {
    lines: truncated ? parsed.slice(0, MAX_DIFF_LINES) : parsed,
    truncated
  };
}

function readUntrackedPreview(fullPath) {
  let fd;
  try {
    const st = statSync(fullPath);
    if (!st.isFile()) {
      return { binary: false, truncated: false, lines: [] };
    }
    const readLen = Math.min(st.size, MAX_UNTRACKED_BYTES);
    fd = openSync(fullPath, 'r');
    const buf = Buffer.allocUnsafe(readLen);
    const bytesRead = readLen > 0 ? readSync(fd, buf, 0, readLen, 0) : 0;
    const slice = buf.subarray(0, bytesRead);
    if (slice.includes(0)) {
      return { binary: true, truncated: false, lines: [] };
    }
    const text = slice.toString('utf8').replace(/\r\n/g, '\n');
    const allLines = text.length === 0 ? [] : text.split('\n');
    if (allLines.length > 0 && allLines.at(-1) === '') allLines.pop();
    const truncated = allLines.length > MAX_UNTRACKED_LINES || st.size > readLen;
    const shown = truncated ? allLines.slice(0, MAX_UNTRACKED_LINES) : allLines;
    const lines = shown.length > 0
      ? [{ kind: 'hunk', text: `@@ -0,0 +1,${shown.length} @@` }, ...shown.map(l => ({ kind: 'add', text: l }))]
      : [];
    return { binary: false, truncated, lines };
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }
}

function computeDirSizeAndMtime(rootDir) {
  let bytes = 0;
  let rootMtimeMs = 0;
  let latestFileMtimeMs = 0;
  let hasFile = false;
  try {
    rootMtimeMs = lstatSync(rootDir).mtimeMs;
  } catch {
    return { bytes: 0, latestMtimeMs: 0 };
  }
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let st;
    try {
      st = lstatSync(current);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isFile()) {
      hasFile = true;
      bytes += st.size;
      if (st.mtimeMs > latestFileMtimeMs) latestFileMtimeMs = st.mtimeMs;
      continue;
    }
    if (st.isDirectory()) {
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        stack.push(join(current, entry.name));
      }
    }
  }
  return { bytes, latestMtimeMs: hasFile ? latestFileMtimeMs : rootMtimeMs };
}

function inspectConversationForSubagent(convDir) {
  const metaPath = join(convDir, 'metadata.json');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (
        meta?.isSubagent === true ||
        meta?.is_subagent === true ||
        Boolean(meta?.parentConversationId || meta?.parent_conversation_id) ||
        /subagent|swarm|child/i.test(String(meta?.source || meta?.role || meta?.kind || ''))
      ) {
        return 'metadata';
      }
    } catch { /* Ignore malformed metadata. */ }
  }

  const transcriptPath = join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
  if (!existsSync(transcriptPath)) return '';

  let fd;
  try {
    const st = statSync(transcriptPath);
    if (!st.isFile() || st.size === 0) return '';
    const readLen = Math.min(st.size, 16384);
    fd = openSync(transcriptPath, 'r');
    const buf = Buffer.allocUnsafe(readLen);
    const n = readSync(fd, buf, 0, readLen, 0);
    const head = buf.subarray(0, n).toString('utf8');
    const lines = head.split('\n').slice(0, 12);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!obj || typeof obj !== 'object') continue;
      const sourceText = String(
        obj.source ||
        obj.payload?.source ||
        obj.metadata?.source ||
        obj.role ||
        obj.kind ||
        ''
      );
      if (
        obj.is_subagent === true ||
        obj.isSubagent === true ||
        obj.metadata?.is_subagent === true ||
        obj.metadata?.isSubagent === true ||
        obj.payload?.is_subagent === true ||
        obj.payload?.isSubagent === true ||
        Boolean(
          obj.parent_conversation_id ||
          obj.parentConversationId ||
          obj.metadata?.parent_conversation_id ||
          obj.metadata?.parentConversationId ||
          obj.payload?.parent_conversation_id ||
          obj.payload?.parentConversationId
        ) ||
        /subagent|swarm_worker|child_conversation/i.test(sourceText)
      ) {
        return 'transcript';
      }
    }
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
  }
  return '';
}

function moveDirectorySafe(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  try {
    renameSync(src, dest);
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err;
    cpSync(src, dest, { recursive: true, preserveTimestamps: true });
    rmSync(src, { recursive: true, force: true });
  }
}

export function createOmniGateway(
  dataDir = pluginDataDir(),
  {
    brainDir,
    home = homedir(),
    execGit = execFile,
    maxTableScanBytes = DEFAULT_MAX_TABLE_SCAN_BYTES
  } = {}
) {
  const resolvedDataDir = String(dataDir || pluginDataDir());
  const resolvedBrainDir = String(brainDir || join(home, '.gemini', 'antigravity', 'brain'));
  const wallpaperMetaPath = join(resolvedDataDir, 'wallpaper.json');
  const archiveRootDir = join(resolvedDataDir, 'archived-conversations');
  const archiveManifestPath = join(archiveRootDir, 'manifest.json');
  const chatFoldersPath = join(resolvedDataDir, 'chat-folders.json');
  const tableScanCap = Math.max(1024, Number(maxTableScanBytes) || DEFAULT_MAX_TABLE_SCAN_BYTES);

  const sessionToken = randomBytes(32).toString('hex');
  const fileRegistry = new Map();
  const pathToFileId = new Map();
  let pinnedWallpaperId = '';

  let server = null;
  let serverPort = 0;
  let serverStarting = null;

  const makeScopedHtmlToken = fileId => (
    createHmac('sha256', sessionToken).update(`html:${fileId}`).digest('hex')
  );

  const registerFile = (resolved, { pinWallpaper = false } = {}) => {
    const existingId = pathToFileId.get(resolved.realPath);
    const kind = classifyFileKind(resolved.realPath);
    const ext = extname(resolved.realPath).toLowerCase();
    const mime = mimeForExt(ext);

    let fileId = existingId;
    if (fileId && fileRegistry.has(fileId)) {
      const entry = fileRegistry.get(fileId);
      entry.size = resolved.size;
      entry.name = resolved.name;
      entry.mime = mime;
      entry.kind = kind;
      fileRegistry.delete(fileId);
      fileRegistry.set(fileId, entry);
    } else {
      fileId = randomBytes(16).toString('hex');
      const entry = {
        fileId,
        realPath: resolved.realPath,
        size: resolved.size,
        name: resolved.name,
        kind,
        mime,
        scopedToken: kind === 'html' ? makeScopedHtmlToken(fileId) : ''
      };
      fileRegistry.set(fileId, entry);
      pathToFileId.set(resolved.realPath, fileId);
      while (fileRegistry.size > MAX_REGISTERED_FILES) {
        const oldestKey = [...fileRegistry.keys()].find(k => k !== pinnedWallpaperId);
        if (!oldestKey) break;
        const removed = fileRegistry.get(oldestKey);
        fileRegistry.delete(oldestKey);
        if (removed && pathToFileId.get(removed.realPath) === oldestKey) {
          pathToFileId.delete(removed.realPath);
        }
      }
    }

    if (pinWallpaper) pinnedWallpaperId = fileId;
    return fileRegistry.get(fileId);
  };

  const handleHttpRequest = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const expectedHost = `127.0.0.1:${serverPort}`;
    if (String(req.headers.host || '').trim() !== expectedHost) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden Host');
      return;
    }

    const secFetchSite = req.headers['sec-fetch-site'];
    if (secFetchSite !== undefined && !ALLOWED_FETCH_SITES.has(String(secFetchSite).trim().toLowerCase())) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden Sec-Fetch-Site');
      return;
    }

    const origin = req.headers.origin;
    if (origin !== undefined && !isAllowedOrigin(origin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden Origin');
      return;
    }

    const referer = req.headers.referer;
    if (referer !== undefined && !isAllowedReferer(referer)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden Referer');
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', `http://${expectedHost}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    const pathMatch = parsedUrl.pathname.match(STREAM_PATH_RE);
    if (!pathMatch) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const fileId = pathMatch[1];
    const entry = fileRegistry.get(fileId);
    const token = parsedUrl.searchParams.get('token') || '';
    const tokenValid = entry
      ? (entry.kind === 'html'
        ? (safeEqualHex(token, entry.scopedToken) || safeEqualHex(token, sessionToken))
        : safeEqualHex(token, sessionToken))
      : false;

    if (!tokenValid) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let verified;
    try {
      verified = resolveSafePreviewPath(entry.realPath, { home });
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('File Unavailable');
      return;
    }

    const headers = {
      'Content-Type': entry.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    };
    if (origin && origin !== 'null') {
      headers['Access-Control-Allow-Origin'] = String(origin);
      headers.Vary = 'Origin';
    }
    if (entry.kind === 'html') {
      headers['Content-Security-Policy'] = HTML_CSP;
    } else if (entry.kind === 'svg') {
      headers['Content-Security-Policy'] = SVG_CSP;
    }

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, verified.size);
      if (!range) {
        res.writeHead(416, {
          ...headers,
          'Content-Range': `bytes */${verified.size}`
        });
        res.end();
        return;
      }
      const chunkLen = range.end - range.start + 1;
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${verified.size}`,
        'Content-Length': String(chunkLen)
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(verified.realPath, { start: range.start, end: range.end });
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.destroy();
      });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return;
    }

    res.writeHead(200, {
      ...headers,
      'Content-Length': String(verified.size)
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(verified.realPath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.destroy();
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };

  const ensureServer = async () => {
    if (server && server.listening && serverPort > 0) return serverPort;
    if (serverStarting) return serverStarting;

    serverStarting = new Promise((resolvePromise, rejectPromise) => {
      const srv = http.createServer(handleHttpRequest);
      srv.once('error', err => {
        serverStarting = null;
        rejectPromise(err);
      });
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        server = srv;
        serverPort = typeof addr === 'object' && addr ? addr.port : 0;
        serverStarting = null;
        srv.unref();
        resolvePromise(serverPort);
      });
    });
    return serverStarting;
  };

  const buildStreamUrl = entry => {
    const token = entry.kind === 'html' ? entry.scopedToken : sessionToken;
    return `http://127.0.0.1:${serverPort}/stream/${entry.fileId}?token=${token}`;
  };

  async function open({ uriOrPath } = {}) {
    const resolved = resolveSafePreviewPath(uriOrPath, { home });
    await ensureServer();
    const entry = registerFile(resolved);
    return {
      ok: true,
      url: buildStreamUrl(entry),
      kind: entry.kind,
      mime: entry.mime,
      size: resolved.size,
      name: resolved.name,
      path: resolved.realPath
    };
  }

  async function tableSlice({ uriOrPath, offset = 0, limit = 100, query = '' } = {}) {
    const resolved = resolveSafePreviewPath(uriOrPath, { home });
    const ext = extname(resolved.realPath).toLowerCase();
    let format;
    if (ext === '.csv') format = 'csv';
    else if (ext === '.tsv') format = 'tsv';
    else if (ext === '.jsonl' || ext === '.ndjson') format = 'jsonl';
    else throw new Error(`不支持的表格文件格式: ${ext || 'unknown'}`);

    const safeOffset = Math.max(0, Number.isInteger(Number(offset)) ? Number(offset) : 0);
    const safeLimit = Math.min(1000, Math.max(1, Number.isInteger(Number(limit)) ? Number(limit) : 100));
    const queryLower = String(query || '').trim().toLowerCase();

    const result = format === 'jsonl'
      ? await streamJsonlTable(resolved.realPath, { offset: safeOffset, limit: safeLimit, queryLower, maxScanBytes: tableScanCap })
      : await streamDelimitedTable(resolved.realPath, format === 'tsv' ? '\t' : ',', { offset: safeOffset, limit: safeLimit, queryLower, maxScanBytes: tableScanCap });

    return {
      ok: true,
      format,
      headers: result.headers,
      rows: result.rows,
      totalMatched: result.totalMatched,
      truncated: result.truncated
    };
  }

  async function inlineDiff({ workspaceUri, path: relOrAbsPath, safeRead = false } = {}) {
    const workspaceDirReal = resolveWorkspaceDir(workspaceUri);
    const topRes = await runGitSafe(workspaceDirReal, ['rev-parse', '--show-toplevel'], { execGit });
    if (!topRes.ok || !topRes.stdout.trim()) {
      throw new Error('当前工作区不是有效的 Git 仓库');
    }
    const repoRootReal = realpathSync(topRes.stdout.trim());
    const { fullPath, relPath } = resolveRepoFilePath(repoRootReal, workspaceDirReal, relOrAbsPath);
    if (safeRead) {
      if (repoRootReal !== workspaceDirReal) throw new Error('Git 仓库与工作区不一致');
      const filters = await runGitSafe(repoRootReal, ['config', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], { execGit });
      if (filters.code !== 1) throw new Error('为避免运行外部过滤器，已关闭此仓库的行内差异预览');
    }
    const safeDiffFlags = safeRead ? ['--no-ext-diff', '--no-textconv', '--ignore-submodules=all'] : [];

    const untrackedRes = await runGitSafe(repoRootReal, ['ls-files', '--others', '--', relPath], { execGit });
    const isUntracked = untrackedRes.ok && untrackedRes.stdout.trim().length > 0;
    if (isUntracked && existsSync(fullPath)) {
      if (safeRead) return { ok: true, binary: false, untracked: true, truncated: false, lines: [] };
      const preview = readUntrackedPreview(fullPath);
      return {
        ok: true,
        binary: preview.binary,
        untracked: true,
        truncated: preview.truncated,
        lines: preview.lines
      };
    }

    let diffRes = await runGitSafe(repoRootReal, ['diff', 'HEAD', ...safeDiffFlags, '--unified=3', '--', relPath], { execGit });
    if (!diffRes.ok) {
      const [staged, unstaged] = await Promise.all([
        runGitSafe(repoRootReal, ['diff', '--cached', ...safeDiffFlags, '--unified=3', '--', relPath], { execGit }),
        runGitSafe(repoRootReal, ['diff', ...safeDiffFlags, '--unified=3', '--', relPath], { execGit })
      ]);
      diffRes = {
        ok: true,
        stdout: [staged.stdout, unstaged.stdout].filter(Boolean).join('\n')
      };
    }

    const out = diffRes.stdout || '';
    if (/^Binary files .* differ$/m.test(out) || /^GIT binary patch$/m.test(out)) {
      return {
        ok: true,
        binary: true,
        untracked: false,
        truncated: false,
        lines: []
      };
    }

    const parsed = parseUnifiedDiffLines(out);
    return {
      ok: true,
      binary: false,
      untracked: false,
      truncated: parsed.truncated,
      lines: parsed.lines
    };
  }

  function classifyWallpaperExt(filePath) {
    const ext = extname(String(filePath || '')).toLowerCase();
    if (WALLPAPER_IMAGE_EXTS.has(ext)) return 'image';
    if (WALLPAPER_VIDEO_EXTS.has(ext)) return 'video';
    return '';
  }

  async function wallpaperStatus() {
    const saved = readJsonSafe(wallpaperMetaPath, null);
    const savedPath = typeof saved?.filePath === 'string' ? saved.filePath.trim() : '';
    if (!savedPath) {
      return { ok: true, hasMedia: false, kind: '', fileName: '', mediaUrl: '' };
    }
    const kind = classifyWallpaperExt(savedPath);
    if (!kind) {
      return { ok: true, hasMedia: false, kind: '', fileName: '', mediaUrl: '' };
    }
    let resolved;
    try {
      resolved = resolveSafePreviewPath(savedPath, { home });
    } catch {
      return { ok: true, hasMedia: false, kind: '', fileName: '', mediaUrl: '' };
    }
    await ensureServer();
    const entry = registerFile(resolved, { pinWallpaper: true });
    return {
      ok: true,
      hasMedia: true,
      kind,
      fileName: resolved.name,
      mediaUrl: buildStreamUrl(entry)
    };
  }

  async function wallpaperSet({ filePath } = {}) {
    const resolved = resolveSafePreviewPath(filePath, { home });
    const kind = classifyWallpaperExt(resolved.realPath);
    if (!kind) {
      throw new Error('壁纸仅支持 jpg/jpeg/png/webp/gif/avif/mp4/webm 格式');
    }
    writeJsonAtomic(wallpaperMetaPath, {
      filePath: resolved.realPath,
      kind,
      fileName: resolved.name,
      updatedAt: new Date().toISOString()
    });
    await ensureServer();
    const entry = registerFile(resolved, { pinWallpaper: true });
    return {
      ok: true,
      hasMedia: true,
      kind,
      fileName: resolved.name,
      mediaUrl: buildStreamUrl(entry)
    };
  }

  function wallpaperClear() {
    pinnedWallpaperId = '';
    if (existsSync(wallpaperMetaPath)) {
      rmSync(wallpaperMetaPath, { force: true });
    }
    return { ok: true, hasMedia: false, kind: '', fileName: '', mediaUrl: '' };
  }

  const readArchiveManifest = () => {
    const raw = readJsonSafe(archiveManifestPath, null);
    const items = Array.isArray(raw?.items)
      ? raw.items.filter(item => item && typeof item.id === 'string' && VALID_ID_RE.test(item.id))
      : [];
    return { version: 1, items };
  };

  function archiveScan({ maxAgeDays = 7, subagentIds, now = Date.now() } = {}) {
    const ageLimitDays = Number.isFinite(Number(maxAgeDays)) && Number(maxAgeDays) >= 0 ? Number(maxAgeDays) : 7;
    const cutoffMs = now - ageLimitDays * DAY_MS;
    const explicitSet = subagentIds
      ? new Set([...subagentIds].map(id => String(id || '').trim()).filter(id => VALID_ID_RE.test(id)))
      : null;

    const candidates = [];
    let scannedCount = 0;
    let eligibleBytes = 0;

    if (existsSync(resolvedBrainDir)) {
      let entries = [];
      try {
        entries = readdirSync(resolvedBrainDir, { withFileTypes: true });
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !VALID_ID_RE.test(entry.name)) continue;
        scannedCount++;
        const convDir = join(resolvedBrainDir, entry.name);
        let reason = '';
        if (explicitSet && explicitSet.has(entry.name)) {
          reason = 'explicit';
        } else {
          reason = inspectConversationForSubagent(convDir);
        }
        if (!reason) continue;

        const stats = computeDirSizeAndMtime(convDir);
        if (stats.latestMtimeMs > cutoffMs) continue;

        const ageDays = Number(((now - stats.latestMtimeMs) / DAY_MS).toFixed(2));
        candidates.push({
          id: entry.name,
          bytes: stats.bytes,
          ageDays,
          reason
        });
        eligibleBytes += stats.bytes;
      }
    }

    const manifest = readArchiveManifest();
    const archivedBytes = manifest.items.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);

    return {
      ok: true,
      maxAgeDays: ageLimitDays,
      scannedCount,
      eligibleCount: candidates.length,
      eligibleBytes,
      eligibleMB: Number((eligibleBytes / (1024 * 1024)).toFixed(2)),
      candidates,
      archivedCount: manifest.items.length,
      archivedBytes,
      archivedMB: Number((archivedBytes / (1024 * 1024)).toFixed(2))
    };
  }

  function archiveRun({ maxAgeDays = 7, subagentIds, now = Date.now() } = {}) {
    const scan = archiveScan({ maxAgeDays, subagentIds, now });
    const manifest = readArchiveManifest();
    const existingIds = new Set(manifest.items.map(item => item.id));
    const archivedIds = [];
    let freedBytes = 0;

    if (scan.candidates.length > 0) {
      mkdirSync(archiveRootDir, { recursive: true });
    }

    for (const candidate of scan.candidates) {
      const src = join(resolvedBrainDir, candidate.id);
      const dest = join(archiveRootDir, candidate.id);
      if (!existsSync(src) || existsSync(dest)) continue;
      moveDirectorySafe(src, dest);
      if (!existingIds.has(candidate.id)) {
        manifest.items.push({
          id: candidate.id,
          originalPath: src,
          archivedPath: dest,
          bytes: candidate.bytes,
          archivedAt: new Date(now).toISOString(),
          reason: candidate.reason
        });
        existingIds.add(candidate.id);
      }
      archivedIds.push(candidate.id);
      freedBytes += candidate.bytes;
    }

    if (archivedIds.length > 0) {
      writeJsonAtomic(archiveManifestPath, manifest);
    }

    return {
      ok: true,
      archivedCount: archivedIds.length,
      freedBytes,
      freedMB: Number((freedBytes / (1024 * 1024)).toFixed(2)),
      archivedIds,
      totalArchivedCount: manifest.items.length
    };
  }

  function archiveRestore({ ids } = {}) {
    const manifest = readArchiveManifest();
    if (manifest.items.length === 0) {
      return {
        ok: true,
        restoredCount: 0,
        restoredBytes: 0,
        restoredMB: 0,
        restoredIds: [],
        skipped: [],
        remainingArchivedCount: 0
      };
    }

    const filterSet = Array.isArray(ids) && ids.length > 0
      ? new Set(ids.map(id => String(id || '').trim()))
      : null;

    const restoredIds = [];
    const skipped = [];
    const remaining = [];
    let restoredBytes = 0;

    mkdirSync(resolvedBrainDir, { recursive: true });

    for (const item of manifest.items) {
      if (filterSet && !filterSet.has(item.id)) {
        remaining.push(item);
        continue;
      }
      if (!VALID_ID_RE.test(item.id)) {
        skipped.push({ id: item.id, reason: 'invalid-id' });
        remaining.push(item);
        continue;
      }
      const src = join(archiveRootDir, item.id);
      const dest = join(resolvedBrainDir, item.id);
      if (!existsSync(src)) {
        skipped.push({ id: item.id, reason: 'archive-missing' });
        continue;
      }
      if (existsSync(dest)) {
        skipped.push({ id: item.id, reason: 'destination-exists' });
        remaining.push(item);
        continue;
      }
      moveDirectorySafe(src, dest);
      restoredIds.push(item.id);
      restoredBytes += Number(item.bytes) || 0;
    }

    writeJsonAtomic(archiveManifestPath, { version: 1, items: remaining });

    return {
      ok: true,
      restoredCount: restoredIds.length,
      restoredBytes,
      restoredMB: Number((restoredBytes / (1024 * 1024)).toFixed(2)),
      restoredIds,
      skipped,
      remainingArchivedCount: remaining.length
    };
  }

  function normalizeChatFoldersPayload(raw = {}) {
    const rawFolders = Array.isArray(raw?.folders) ? raw.folders : [];
    const seen = new Set();
    const folders = [];
    for (const item of rawFolders) {
      if (folders.length >= MAX_CHAT_FOLDERS) break;
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '').trim().slice(0, 64);
      const name = String(item.name || '').trim().slice(0, 80);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const clean = { id, name };
      if (typeof item.color === 'string' && item.color.trim()) clean.color = item.color.trim().slice(0, 32);
      if (typeof item.icon === 'string' && item.icon.trim()) clean.icon = item.icon.trim().slice(0, 32);
      if (typeof item.collapsed === 'boolean') clean.collapsed = item.collapsed;
      if (typeof item.createdAt === 'string' && item.createdAt.trim()) clean.createdAt = item.createdAt.trim().slice(0, 40);
      folders.push(clean);
    }

    const rawAssignments = raw?.assignments && typeof raw.assignments === 'object' && !Array.isArray(raw.assignments)
      ? raw.assignments
      : {};
    const assignments = {};
    for (const [convId, folderId] of Object.entries(rawAssignments)) {
      const cleanConv = String(convId || '').trim();
      const cleanFolder = String(folderId || '').trim();
      if (!cleanConv || !cleanFolder || !seen.has(cleanFolder)) continue;
      assignments[cleanConv] = cleanFolder;
    }
    return { folders, assignments };
  }

  function chatFoldersGet() {
    const raw = readJsonSafe(chatFoldersPath, { folders: [], assignments: {} });
    const normalized = normalizeChatFoldersPayload(raw);
    return {
      ok: true,
      folders: normalized.folders,
      assignments: normalized.assignments
    };
  }

  function chatFoldersSave({ folders = [], assignments = {} } = {}) {
    if (!Array.isArray(folders)) {
      throw new Error('folders 必须为数组');
    }
    if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
      throw new Error('assignments 必须为键值对象');
    }
    const normalized = normalizeChatFoldersPayload({ folders, assignments });
    writeJsonAtomic(chatFoldersPath, { version: 1, ...normalized });
    return {
      ok: true,
      folders: normalized.folders,
      assignments: normalized.assignments
    };
  }

  async function close() {
    if (serverStarting) {
      try { await serverStarting; } catch {}
    }
    if (!server) return { ok: true };
    const closing = server;
    server = null;
    serverPort = 0;
    try { closing.closeAllConnections?.(); } catch {}
    await new Promise(resolvePromise => {
      try {
        closing.close(() => resolvePromise());
      } catch {
        resolvePromise();
      }
    });
    return { ok: true };
  }

  return {
    open,
    tableSlice,
    inlineDiff,
    wallpaperStatus,
    wallpaperSet,
    wallpaperClear,
    archiveScan,
    archiveRun,
    archiveRestore,
    chatFoldersGet,
    chatFoldersSave,
    close
  };
}
