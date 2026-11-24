import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOmniGateway, resolveSafePreviewPath } from '../lib/omni-gateway.mjs';

function makeTempDir(prefix = 'agy-omni-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function rawHttpRequest(urlStr, { method = 'GET', headers = {} } = {}) {
  const parsed = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = http.request({
      method,
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      headers
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('loopback HTTP 206 Range streaming, token/Host/Origin/Sec-Fetch-Site guards, and HTML scoped HMAC token + CSP', async () => {
  const dir = makeTempDir();
  const dataDir = join(dir, 'data');
  const mediaFile = join(dir, 'clip.mp4');
  const htmlFile = join(dir, 'preview.html');
  const payload = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
  writeFileSync(mediaFile, payload);
  writeFileSync(htmlFile, '<!doctype html><html><body><h1>Hi</h1></body></html>');

  const gateway = createOmniGateway(dataDir, { home: join(dir, 'fake-home') });
  try {
    const opened = await gateway.open({ uriOrPath: pathToFileURL(mediaFile).href });
    assert.equal(opened.ok, true);
    assert.equal(opened.kind, 'video');
    assert.equal(opened.mime, 'video/mp4');
    assert.equal(opened.size, payload.length);
    assert.equal(opened.name, 'clip.mp4');
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/stream\/[a-f0-9]+\?token=[a-f0-9]{64}$/);

    // Full 200 GET
    const full = await rawHttpRequest(opened.url);
    assert.equal(full.status, 200);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(full.headers['content-type'], 'video/mp4');
    assert.equal(full.body.toString('utf8'), payload.toString('utf8'));

    // 206 Range start-end
    const slice1 = await rawHttpRequest(opened.url, { headers: { Range: 'bytes=10-19' } });
    assert.equal(slice1.status, 206);
    assert.equal(slice1.headers['content-range'], `bytes 10-19/${payload.length}`);
    assert.equal(slice1.headers['content-length'], '10');
    assert.equal(slice1.body.toString('utf8'), 'ABCDEFGHIJ');

    // 206 Range open-ended & suffix
    const slice2 = await rawHttpRequest(opened.url, { headers: { Range: 'bytes=-6' } });
    assert.equal(slice2.status, 206);
    assert.equal(slice2.body.toString('utf8'), 'uvwxyz');

    // 416 out of bounds
    const badRange = await rawHttpRequest(opened.url, { headers: { Range: 'bytes=9999-10000' } });
    assert.equal(badRange.status, 416);
    assert.equal(badRange.headers['content-range'], `bytes */${payload.length}`);

    // HEAD request
    const headRes = await rawHttpRequest(opened.url, { method: 'HEAD' });
    assert.equal(headRes.status, 200);
    assert.equal(headRes.body.length, 0);

    // POST rejected
    const postRes = await rawHttpRequest(opened.url, { method: 'POST' });
    assert.equal(postRes.status, 405);

    // Missing / wrong token rejected
    const noTokenUrl = opened.url.split('?')[0];
    assert.equal((await rawHttpRequest(noTokenUrl)).status, 403);
    assert.equal((await rawHttpRequest(`${noTokenUrl}?token=${'0'.repeat(64)}`)).status, 403);

    // DNS rebinding Host rejected
    const badHost = await rawHttpRequest(opened.url, { headers: { Host: 'evil.example.com:80' } });
    assert.equal(badHost.status, 403);

    // External Origin & Referer rejected, loopback Origin & null Origin allowed
    assert.equal((await rawHttpRequest(opened.url, { headers: { Origin: 'https://evil.com' } })).status, 403);
    assert.equal((await rawHttpRequest(opened.url, { headers: { Referer: 'https://evil.com/page' } })).status, 403);
    assert.equal((await rawHttpRequest(opened.url, { headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
    assert.equal((await rawHttpRequest(opened.url, {
      headers: { Origin: 'https://127.0.0.1:42311', 'Sec-Fetch-Site': 'cross-site' }
    })).status, 200);
    assert.equal((await rawHttpRequest(opened.url, { headers: { Origin: 'null' } })).status, 200);

    // HTML file gets scoped HMAC token + restrictive CSP, and its token CANNOT read clip.mp4
    const htmlOpened = await gateway.open({ uriOrPath: htmlFile });
    assert.equal(htmlOpened.kind, 'html');
    const htmlToken = new URL(htmlOpened.url).searchParams.get('token');
    const videoToken = new URL(opened.url).searchParams.get('token');
    assert.notEqual(htmlToken, videoToken);

    const htmlRes = await rawHttpRequest(htmlOpened.url);
    assert.equal(htmlRes.status, 200);
    assert.equal(
      htmlRes.headers['content-security-policy'],
      "default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'"
    );

    // Attempting to use HTML's scoped token against clip.mp4 is blocked
    const crossFileAttempt = await rawHttpRequest(`${noTokenUrl}?token=${htmlToken}`);
    assert.equal(crossFileAttempt.status, 403);

    // Verify classification of all remaining kinds (audio, pdf, image, svg, table, font, code, binary)
    const sampleKinds = [
      ['sound.mp3', 'audio', 'audio/mpeg'],
      ['doc.pdf', 'pdf', 'application/pdf'],
      ['pic.webp', 'image', 'image/webp'],
      ['diagram.svg', 'svg', 'image/svg+xml'],
      ['data.csv', 'table', 'text/csv; charset=utf-8'],
      ['type.woff2', 'font', 'font/woff2'],
      ['index.ts', 'code', 'text/plain; charset=utf-8'],
      ['blob.bin', 'binary', 'application/octet-stream']
    ];
    for (const [fname, expectedKind, expectedMime] of sampleKinds) {
      const fpath = join(dir, fname);
      writeFileSync(fpath, 'sample');
      const res = await gateway.open({ uriOrPath: fpath });
      assert.equal(res.kind, expectedKind);
      assert.equal(res.mime, expectedMime);
    }

    // TOCTOU symlink swap after open() is rejected at stream time
    const swapTarget = join(dir, 'swap.txt');
    const secretFile = join(dir, 'secret.pem');
    writeFileSync(swapTarget, 'safe');
    writeFileSync(secretFile, 'PRIVATE KEY');
    const swapOpened = await gateway.open({ uriOrPath: swapTarget });
    rmSync(swapTarget);
    symlinkSync(secretFile, swapTarget);
    const swapRes = await rawHttpRequest(swapOpened.url);
    assert.equal(swapRes.status, 404);
  } finally {
    await gateway.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('path security blocks UNC, Windows device paths, traversal, sensitive credential paths, and symlinks to secrets', async () => {
  const dir = makeTempDir();
  const fakeHome = join(dir, 'home');
  const sshDir = join(fakeHome, '.ssh');
  const awsDir = join(fakeHome, '.aws');
  const pluginDataDir = join(fakeHome, '.gemini', 'antigravity', 'plugin_data', 'agy-powertools');
  const pluginCfgDir = join(fakeHome, '.gemini', 'config', 'plugins', 'demo');
  mkdirSync(sshDir, { recursive: true });
  mkdirSync(awsDir, { recursive: true });
  mkdirSync(pluginDataDir, { recursive: true });
  mkdirSync(pluginCfgDir, { recursive: true });

  const sshKey = join(sshDir, 'id_ed25519');
  const awsCreds = join(awsDir, 'credentials');
  const accountsFile = join(pluginDataDir, 'accounts.json');
  const thoughtProfiles = join(pluginCfgDir, 'thought-profiles.json');
  const dotEnv = join(dir, '.env');
  const pemFile = join(dir, 'server.pem');
  const keyFile = join(dir, 'tls.key');
  const credFile = join(dir, 'gcp-credential-prod.json');
  const safeFile = join(dir, 'notes.txt');

  for (const f of [sshKey, awsCreds, accountsFile, thoughtProfiles, dotEnv, pemFile, keyFile, credFile, safeFile]) {
    writeFileSync(f, 'content');
  }

  // Symlink disguised as harmless .txt pointing to ~/.ssh/id_ed25519
  const sneakyLink = join(dir, 'harmless.txt');
  symlinkSync(sshKey, sneakyLink);

  const opts = { home: fakeHome };
  try {
    assert.equal(resolveSafePreviewPath(safeFile, opts).name, 'notes.txt');

    const rejected = [
      '\\\\server\\share\\video.mp4',
      '//server/share/video.mp4',
      'file://fileserver/share/video.mp4',
      '\\\\.\\PhysicalDrive0',
      '\\\\?\\C:\\Windows\\system32\\cmd.exe',
      '../outside.txt',
      `${dir}/../outside.txt`,
      `file://${dir}/%2e%2e/outside.txt`,
      sshKey,
      awsCreds,
      accountsFile,
      thoughtProfiles,
      dotEnv,
      pemFile,
      keyFile,
      credFile,
      sneakyLink
    ];

    for (const bad of rejected) {
      assert.throws(() => resolveSafePreviewPath(bad, opts), `Expected rejection for: ${bad}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tableSlice streams CSV (RFC 4180 quotes/BOM/CJK), TSV, JSONL, filters, paginates, and truncates safely', async () => {
  const dir = makeTempDir();
  const gateway = createOmniGateway(join(dir, 'data'), {
    home: join(dir, 'home'),
    maxTableScanBytes: 1024
  });

  try {
    const csvPath = join(dir, 'metrics.csv');
    writeFileSync(csvPath, [
      '\uFEFFname,note,score',
      'Alice,"hello, ""world""",95',
      'Bob,"line1\nline2",88',
      '陈明,"中文测试, 逗号",99',
      'David,plain,72'
    ].join('\r\n'));

    const csvAll = await gateway.tableSlice({ uriOrPath: csvPath, offset: 0, limit: 10 });
    assert.equal(csvAll.ok, true);
    assert.equal(csvAll.format, 'csv');
    assert.deepEqual(csvAll.headers, ['name', 'note', 'score']);
    assert.equal(csvAll.totalMatched, 4);
    assert.equal(csvAll.truncated, false);
    assert.deepEqual(csvAll.rows[0], ['Alice', 'hello, "world"', '95']);
    assert.deepEqual(csvAll.rows[1], ['Bob', 'line1\nline2', '88']);
    assert.deepEqual(csvAll.rows[2], ['陈明', '中文测试, 逗号', '99']);

    const csvFiltered = await gateway.tableSlice({ uriOrPath: csvPath, offset: 0, limit: 1, query: '中文' });
    assert.equal(csvFiltered.totalMatched, 1);
    assert.deepEqual(csvFiltered.rows, [['陈明', '中文测试, 逗号', '99']]);

    const tsvPath = join(dir, 'items.tsv');
    writeFileSync(tsvPath, 'id\ttitle\n1\tAlpha\n2\tBeta\n3\tGamma\n');
    const tsvPage = await gateway.tableSlice({ uriOrPath: tsvPath, offset: 1, limit: 1 });
    assert.equal(tsvPage.format, 'tsv');
    assert.equal(tsvPage.totalMatched, 3);
    assert.deepEqual(tsvPage.rows, [['2', 'Beta']]);

    const jsonlPath = join(dir, 'events.jsonl');
    writeFileSync(jsonlPath, [
      JSON.stringify({ id: 1, kind: 'start', meta: { ok: true } }),
      JSON.stringify({ id: 2, kind: 'finish', extra: 'bonus' }),
      JSON.stringify({ id: 3, kind: 'start', extra: 'later' })
    ].join('\n'));
    const jsonlRes = await gateway.tableSlice({ uriOrPath: jsonlPath, offset: 0, limit: 10, query: 'start' });
    assert.equal(jsonlRes.format, 'jsonl');
    assert.deepEqual(jsonlRes.headers, ['id', 'kind', 'meta', 'extra']);
    assert.equal(jsonlRes.totalMatched, 2);
    assert.deepEqual(jsonlRes.rows[0], ['1', 'start', '{"ok":true}', '']);
    assert.deepEqual(jsonlRes.rows[1], ['3', 'start', '', 'later']);

    // Exceed maxTableScanBytes (1024 in this test instance) -> truncated: true
    const bigCsv = join(dir, 'big.csv');
    const lines = ['col1,col2'];
    for (let i = 0; i < 200; i++) lines.push(`row-${i},${'x'.repeat(20)}`);
    writeFileSync(bigCsv, lines.join('\n'));
    const truncRes = await gateway.tableSlice({ uriOrPath: bigCsv, offset: 0, limit: 500 });
    assert.equal(truncRes.truncated, true);
    assert.ok(truncRes.totalMatched < 200);
  } finally {
    await gateway.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inlineDiff enforces --no-optional-locks and --literal-pathspecs, handles tracked/untracked/binary/truncation/traversal', async () => {
  const dir = makeTempDir();
  const repoDir = join(dir, 'repo');
  mkdirSync(repoDir, { recursive: true });

  const observedArgs = [];
  const trackingExecGit = (cmd, args, opts, cb) => {
    observedArgs.push(args);
    return execFile(cmd, args, opts, cb);
  };

  const gateway = createOmniGateway(join(dir, 'data'), {
    home: join(dir, 'home'),
    execGit: trackingExecGit
  });

  try {
    const git = (...args) => spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
    const init = git('init', '-b', 'main');
    if (init.status !== 0) git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');

    writeFileSync(join(repoDir, 'app.js'), 'const a = 1;\nconst b = 2;\n');
    writeFileSync(join(repoDir, 'big.txt'), Array.from({ length: 400 }, (_, i) => `old-${i}`).join('\n') + '\n');
    writeFileSync(join(repoDir, 'img.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    git('add', 'app.js', 'big.txt', 'img.bin');
    git('commit', '-m', 'init');

    // Modify tracked file
    writeFileSync(join(repoDir, 'app.js'), 'const a = 1;\nconst b = 42;\nconst c = 3;\n');
    // Modify large tracked file (>300 diff lines)
    writeFileSync(join(repoDir, 'big.txt'), Array.from({ length: 400 }, (_, i) => `new-${i}`).join('\n') + '\n');
    // Modify tracked binary file
    writeFileSync(join(repoDir, 'img.bin'), Buffer.from([0x00, 0xff, 0xfe, 0x03]));
    // Untracked text file (>120 lines)
    writeFileSync(join(repoDir, 'untracked.txt'), Array.from({ length: 150 }, (_, i) => `line-${i + 1}`).join('\n') + '\n');
    // Untracked binary file
    writeFileSync(join(repoDir, 'bin.dat'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));

    const workspaceUri = pathToFileURL(repoDir).href;

    const trackedDiff = await gateway.inlineDiff({ workspaceUri, path: 'app.js' });
    assert.equal(trackedDiff.ok, true);
    assert.equal(trackedDiff.binary, false);
    assert.equal(trackedDiff.untracked, false);
    assert.equal(trackedDiff.truncated, false);
    assert.ok(trackedDiff.lines.some(l => l.kind === 'hunk'));
    assert.ok(trackedDiff.lines.some(l => l.kind === 'del' && l.text === 'const b = 2;'));
    assert.ok(trackedDiff.lines.some(l => l.kind === 'add' && l.text === 'const b = 42;'));
    assert.ok(trackedDiff.lines.some(l => l.kind === 'ctx' && l.text === 'const a = 1;'));

    const trackedBinDiff = await gateway.inlineDiff({ workspaceUri, path: 'img.bin' });
    assert.equal(trackedBinDiff.ok, true);
    assert.equal(trackedBinDiff.binary, true);
    assert.equal(trackedBinDiff.untracked, false);
    assert.deepEqual(trackedBinDiff.lines, []);

    const bigDiff = await gateway.inlineDiff({ workspaceUri, path: join(repoDir, 'big.txt') });
    assert.equal(bigDiff.truncated, true);
    assert.equal(bigDiff.lines.length, 300);

    const untrackedDiff = await gateway.inlineDiff({ workspaceUri, path: 'untracked.txt' });
    assert.equal(untrackedDiff.untracked, true);
    assert.equal(untrackedDiff.binary, false);
    assert.equal(untrackedDiff.truncated, true);
    assert.equal(untrackedDiff.lines.filter(l => l.kind === 'add').length, 120);

    const binDiff = await gateway.inlineDiff({ workspaceUri, path: 'bin.dat' });
    assert.equal(binDiff.untracked, true);
    assert.equal(binDiff.binary, true);
    assert.deepEqual(binDiff.lines, []);

    // Verify safety flags on every git invocation
    assert.ok(observedArgs.length > 0);
    assert.ok(observedArgs.every(args => args[0] === '--no-optional-locks' && args[1] === '--literal-pathspecs'));

    // Reject path traversal outside repo
    await assert.rejects(() => gateway.inlineDiff({ workspaceUri, path: '../outside.txt' }), /超出/);
    await assert.rejects(() => gateway.inlineDiff({ workspaceUri, path: '/etc/passwd' }), /超出/);
  } finally {
    await gateway.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('wallpaperSet, wallpaperStatus, wallpaperClear validate extensions, serve over loopback, and persist', async () => {
  const dir = makeTempDir();
  const dataDir = join(dir, 'data');
  const fakeHome = join(dir, 'home');
  const pngPath = join(dir, 'bg.png');
  const badPath = join(dir, 'not-wallpaper.svg');
  writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  writeFileSync(badPath, '<svg></svg>');

  const gw1 = createOmniGateway(dataDir, { home: fakeHome });
  let gw2;
  try {
    const empty = await gw1.wallpaperStatus();
    assert.deepEqual(empty, { ok: true, hasMedia: false, kind: '', fileName: '', mediaUrl: '' });

    await assert.rejects(() => gw1.wallpaperSet({ filePath: badPath }), /壁纸仅支持/);

    const setRes = await gw1.wallpaperSet({ filePath: pngPath });
    assert.equal(setRes.ok, true);
    assert.equal(setRes.hasMedia, true);
    assert.equal(setRes.kind, 'image');
    assert.equal(setRes.fileName, 'bg.png');
    assert.match(setRes.mediaUrl, /^http:\/\/127\.0\.0\.1:\d+\/stream\//);

    const fetched = await rawHttpRequest(setRes.mediaUrl);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers['content-type'], 'image/png');
    assert.equal(fetched.body.length, 8);

    // Video wallpaper supports Range streaming
    const vidPath = join(dir, 'loop.mp4');
    writeFileSync(vidPath, Buffer.from('MP4VIDEOHEADER0123456789'));
    const vidRes = await gw1.wallpaperSet({ filePath: vidPath });
    assert.equal(vidRes.kind, 'video');
    const vidRange = await rawHttpRequest(vidRes.mediaUrl, { headers: { Range: 'bytes=0-7' } });
    assert.equal(vidRange.status, 206);
    assert.equal(vidRange.body.toString('utf8'), 'MP4VIDEO');

    // Reload from persisted wallpaper.json in a second instance
    gw2 = createOmniGateway(dataDir, { home: fakeHome });
    const reloaded = await gw2.wallpaperStatus();
    assert.equal(reloaded.hasMedia, true);
    assert.equal(reloaded.kind, 'video');
    assert.equal(reloaded.fileName, 'loop.mp4');

    const cleared = gw2.wallpaperClear();
    assert.deepEqual(cleared, { ok: true, hasMedia: false, kind: '', fileName: '', mediaUrl: '' });
    assert.equal((await gw2.wallpaperStatus()).hasMedia, false);
  } finally {
    await gw1.close();
    if (gw2) await gw2.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archiveScan, archiveRun, and archiveRestore move stale subagent conversations and restore losslessly', async () => {
  const dir = makeTempDir();
  const dataDir = join(dir, 'data');
  const brainDir = join(dir, 'brain');
  const now = Date.now();
  const oldDate = new Date(now - 12 * 24 * 60 * 60 * 1000);
  const recentDate = new Date(now - 2 * 24 * 60 * 60 * 1000);

  const makeConv = (id, transcriptLine, mtimeDate) => {
    const convDir = join(brainDir, id);
    const logsDir = join(convDir, '.system_generated', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const transcriptFile = join(logsDir, 'transcript.jsonl');
    const artifactFile = join(convDir, 'notes.md');
    writeFileSync(transcriptFile, JSON.stringify(transcriptLine) + '\n');
    writeFileSync(artifactFile, `artifact for ${id}`);
    utimesSync(transcriptFile, mtimeDate, mtimeDate);
    utimesSync(artifactFile, mtimeDate, mtimeDate);
    utimesSync(convDir, mtimeDate, mtimeDate);
  };

  // Old subagent (identified via transcript metadata) -> eligible
  makeConv('sub-old-1', { step_index: 0, source: 'subagent', parent_conversation_id: 'main-1' }, oldDate);
  // Old explicit subagent (passed via subagentIds) -> eligible
  makeConv('sub-explicit-2', { step_index: 0, source: 'USER_EXPLICIT' }, oldDate);
  // Recent subagent (< 7 days) -> NOT eligible
  makeConv('sub-recent-3', { step_index: 0, is_subagent: true }, recentDate);
  // Old main conversation (not subagent) -> NOT eligible
  makeConv('main-old-4', { step_index: 0, source: 'USER_EXPLICIT' }, oldDate);

  const gateway = createOmniGateway(dataDir, { brainDir, home: join(dir, 'home') });
  try {
    const scan = gateway.archiveScan({ maxAgeDays: 7, subagentIds: ['sub-explicit-2'], now });
    assert.equal(scan.ok, true);
    assert.equal(scan.scannedCount, 4);
    assert.equal(scan.eligibleCount, 2);
    assert.deepEqual(scan.candidates.map(c => c.id).sort(), ['sub-explicit-2', 'sub-old-1']);
    assert.ok(scan.eligibleBytes > 0);

    const runRes = gateway.archiveRun({ maxAgeDays: 7, subagentIds: ['sub-explicit-2'], now });
    assert.equal(runRes.ok, true);
    assert.equal(runRes.archivedCount, 2);
    assert.deepEqual(runRes.archivedIds.sort(), ['sub-explicit-2', 'sub-old-1']);
    assert.equal(existsSync(join(brainDir, 'sub-old-1')), false);
    assert.equal(existsSync(join(brainDir, 'sub-explicit-2')), false);
    assert.equal(existsSync(join(brainDir, 'sub-recent-3')), true);
    assert.equal(existsSync(join(brainDir, 'main-old-4')), true);
    assert.equal(existsSync(join(dataDir, 'archived-conversations', 'manifest.json')), true);

    // Restore losslessly
    const restoreRes = gateway.archiveRestore();
    assert.equal(restoreRes.ok, true);
    assert.equal(restoreRes.restoredCount, 2);
    assert.deepEqual(restoreRes.restoredIds.sort(), ['sub-explicit-2', 'sub-old-1']);
    assert.equal(restoreRes.remainingArchivedCount, 0);
    assert.equal(readFileSync(join(brainDir, 'sub-old-1', 'notes.md'), 'utf8'), 'artifact for sub-old-1');
    assert.equal(readFileSync(join(brainDir, 'sub-explicit-2', 'notes.md'), 'utf8'), 'artifact for sub-explicit-2');
    // Non-clobber check: re-archive, create a conflicting folder at destination, verify restore skips without clobbering
    gateway.archiveRun({ maxAgeDays: 7, subagentIds: ['sub-explicit-2'], now });
    mkdirSync(join(brainDir, 'sub-old-1'), { recursive: true });
    writeFileSync(join(brainDir, 'sub-old-1', 'new.md'), 'do-not-overwrite');
    const safeRestore = gateway.archiveRestore();
    assert.deepEqual(safeRestore.restoredIds, ['sub-explicit-2']);
    assert.equal(safeRestore.skipped.length, 1);
    assert.equal(safeRestore.skipped[0].id, 'sub-old-1');
    assert.equal(safeRestore.skipped[0].reason, 'destination-exists');
    assert.equal(safeRestore.remainingArchivedCount, 1);
    assert.equal(readFileSync(join(brainDir, 'sub-old-1', 'new.md'), 'utf8'), 'do-not-overwrite');
  } finally {
    await gateway.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chatFoldersGet and chatFoldersSave persist folders and prune dangling assignments', async () => {
  const dir = makeTempDir();
  const gateway = createOmniGateway(join(dir, 'data'), { home: join(dir, 'home') });
  try {
    assert.deepEqual(gateway.chatFoldersGet(), { ok: true, folders: [], assignments: {} });

    const saved = gateway.chatFoldersSave({
      folders: [
        { id: 'f-daily', name: '日常问答', color: '#669DF6' },
        { id: 'f-notes', name: '灵感整理' }
      ],
      assignments: {
        'conv-1': 'f-daily',
        'conv-2': 'f-notes',
        'conv-orphan': 'f-deleted'
      }
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.folders.length, 2);
    assert.deepEqual(saved.assignments, { 'conv-1': 'f-daily', 'conv-2': 'f-notes' });

    const loaded = gateway.chatFoldersGet();
    assert.deepEqual(loaded, saved);
  } finally {
    await gateway.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('omni-gateway source and test contain no middle-dot character (U+00B7)', () => {
  const src = readFileSync(new URL('../lib/omni-gateway.mjs', import.meta.url), 'utf8');
  const tst = readFileSync(new URL('./omni-gateway.test.mjs', import.meta.url), 'utf8');
  assert.equal(src.includes('\u00b7'), false);
  assert.equal(tst.includes('\u00b7'), false);
});
