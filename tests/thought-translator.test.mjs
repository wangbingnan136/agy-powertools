import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createThoughtTranslator,
  isLocalOrLanHost,
  isPrimarilyCjk,
  maskApiKey,
  validateUpstreamUrl
} from '../lib/thought-translator.mjs';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'agy-thought-test-'));
}

function jsonResponse(body, status = 200) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    async text() { return text; },
    async json() { return JSON.parse(text); }
  };
}

test('machine mode translates short text via GET, long text via POST, joins segments, and disables redirects', async () => {
  const dir = makeTempDir();
  try {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'POST') {
        return jsonResponse([[['长文本译文第一段', 'orig1'], ['，第二段。', 'orig2']], null, 'en']);
      }
      return jsonResponse([[['你好，', 'Hello, '], ['世界！', 'world!']], null, 'en']);
    };

    const translator = createThoughtTranslator(dir, {
      fetchImpl,
      machineEndpoint: 'https://translate.example.test/translate_a/single'
    });

    const shortRes = await translator.translate({ text: 'Hello, world!', mode: 'machine', targetLang: 'zh-CN' });
    assert.equal(shortRes.ok, true);
    assert.equal(shortRes.translated, '你好，世界！');
    assert.equal(shortRes.cached, false);
    assert.equal(shortRes.mode, 'machine');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.redirect, 'error');
    assert.match(calls[0].url, /client=gtx/);
    assert.match(calls[0].url, /sl=auto/);
    assert.match(calls[0].url, /tl=zh-CN/);
    assert.match(calls[0].url, /dt=t/);

    const longText = 'A'.repeat(1700);
    const longRes = await translator.translate({ text: longText, mode: 'machine', targetLang: 'zh-CN' });
    assert.equal(longRes.translated, '长文本译文第一段，第二段。');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, 'POST');
    assert.equal(calls[1].init.redirect, 'error');
    assert.match(calls[1].init.body, /^q=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AI mode sends temperature 0.2, respects polishing styles, caps customPrompt, and supports local empty apiKey', async () => {
  const dir = makeTempDir();
  try {
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith('/models')) {
        return jsonResponse({ data: [{ id: 'gpt-4o-mini' }, { id: 'qwen2.5:14b' }] });
      }
      return jsonResponse({
        choices: [{ message: { content: '优化后的技术译文 `foo/bar.ts#L10`' } }]
      });
    };

    const translator = createThoughtTranslator(dir, { fetchImpl });

    // Local Ollama profile with empty apiKey is allowed
    const localSave = translator.saveProfile({
      profile: {
        id: 'ollama-local',
        name: 'Local Ollama',
        baseUrl: 'http://127.0.0.1:11434/v1/',
        apiKey: '',
        model: 'qwen2.5:14b'
      }
    });
    assert.equal(localSave.ok, true);
    assert.equal(localSave.activeProfileId, 'ollama-local');
    assert.equal(localSave.profiles[0].apiKey, '');
    assert.equal(localSave.profiles[0].baseUrl, 'http://127.0.0.1:11434/v1');

    // LAN IP with empty apiKey is also allowed
    translator.saveProfile({
      profile: { id: 'lan-vllm', name: 'LAN vLLM', baseUrl: 'http://192.168.1.50:8000/v1', apiKey: '', model: 'llama3' },
      setActive: false
    });
    assert.equal(isLocalOrLanHost('10.0.0.8'), true);
    assert.equal(isLocalOrLanHost('172.16.4.2'), true);
    assert.equal(isLocalOrLanHost('172.31.255.1'), true);
    assert.equal(isLocalOrLanHost('172.32.0.1'), false);
    assert.equal(isLocalOrLanHost('::1'), true);

    // Public endpoint with empty apiKey is rejected
    assert.throws(() => translator.saveProfile({
      profile: { id: 'pub-empty', name: 'Public', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' }
    }), /API Key/);

    // Translate with local profile (Authorization header must be omitted)
    const res1 = await translator.translate({
      text: 'Inspect foo/bar.ts#L10 with --verbose flag',
      mode: 'ai',
      targetLang: 'zh-CN',
      style: 'technical'
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.model, 'qwen2.5:14b');
    assert.equal(requests[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(requests[0].body.temperature, 0.2);
    assert.equal(requests[0].init.headers.Authorization, undefined);
    assert.match(requests[0].body.messages[0].content, /engineering prose/i);

    // Concise style
    await translator.translate({
      text: 'Step one and step two',
      mode: 'ai',
      targetLang: 'zh-CN',
      style: 'concise'
    });
    assert.match(requests[1].body.messages[0].content, /bullet-ready/i);

    // Custom style caps customPrompt at 2000 chars
    const hugePrompt = 'P'.repeat(2600);
    await translator.translate({
      text: 'Custom test',
      mode: 'ai',
      targetLang: 'en',
      style: 'custom',
      customPrompt: hugePrompt
    });
    const sysPrompt = requests[2].body.messages[0].content;
    assert.ok(sysPrompt.startsWith('P'.repeat(2000)));
    assert.ok(!sysPrompt.includes('P'.repeat(2001)));
    assert.match(sysPrompt, /Target language: en/);

    // Fetch models on local endpoint without apiKey
    const modelsRes = await translator.fetchModels({ profileId: 'ollama-local' });
    assert.equal(modelsRes.ok, true);
    assert.deepEqual(modelsRes.models, ['gpt-4o-mini', 'qwen2.5:14b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('profiles store uses 0o600, masks apiKey, preserves key on same baseUrl, and strips keys in export/import', async () => {
  const dir = makeTempDir();
  try {
    let seenAuth = '';
    const fetchImpl = async (_url, init) => {
      seenAuth = init.headers?.Authorization || '';
      return jsonResponse({ data: [{ id: 'model-a' }] });
    };

    const translator = createThoughtTranslator(dir, { fetchImpl });
    const saved = translator.saveProfile({
      profile: {
        id: 'openai-main',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-super-secret-value-1234',
        model: 'gpt-4o-mini'
      }
    });

    assert.equal(maskApiKey('sk-super-secret-value-1234'), 'sk-****1234');
    assert.equal(maskApiKey(''), '');
    assert.equal(saved.profiles[0].apiKey, 'sk-****1234');

    // Verify 0o600 permissions on disk
    const profilesFile = join(dir, 'thought-profiles.json');
    if (process.platform !== 'win32') {
      const mode = statSync(profilesFile).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    // Saving with masked placeholder on same id + baseUrl preserves original apiKey
    translator.saveProfile({
      profile: {
        id: 'openai-main',
        name: 'OpenAI Renamed',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-****1234',
        model: 'gpt-4o'
      }
    });
    await translator.fetchModels({ profileId: 'openai-main' });
    assert.equal(seenAuth, 'Bearer sk-super-secret-value-1234');

    // Saving with omitted apiKey on same id + baseUrl also preserves original apiKey
    translator.saveProfile({
      profile: {
        id: 'openai-main',
        name: 'OpenAI V2',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini'
      }
    });
    seenAuth = '';
    await translator.fetchModels({ profileId: 'openai-main' });
    assert.equal(seenAuth, 'Bearer sk-super-secret-value-1234');

    // Changing baseUrl to a different origin must NEVER carry over the saved apiKey
    assert.throws(() => translator.saveProfile({
      profile: {
        id: 'openai-main',
        name: 'Hijack',
        baseUrl: 'https://evil.example.com/v1',
        apiKey: 'sk-****1234',
        model: 'gpt-4o'
      }
    }), /API Key/);

    // exportSanitized strips all apiKey values completely
    const exported = translator.exportSanitized();
    assert.equal(exported.ok, true);
    assert.equal(exported.profiles.length, 1);
    assert.equal(exported.profiles[0].apiKey, '');
    assert.ok(!JSON.stringify(exported).includes('1234'));

    // importSanitized strips any apiKey even if present in input JSON
    const imported = translator.importSanitized({
      activeProfileId: 'imp-1',
      profiles: [{
        id: 'imp-1',
        name: 'Imported',
        baseUrl: 'https://api.example.org/v1',
        apiKey: 'sk-should-be-stripped-9999',
        model: 'm1'
      }]
    });
    assert.equal(imported.ok, true);
    assert.equal(imported.profiles[0].apiKey, '');
    const rawDisk = JSON.parse(readFileSync(profilesFile, 'utf8'));
    assert.equal(rawDisk.profiles[0].apiKey, '');

    // deleteProfile removes entry
    const deleted = translator.deleteProfile({ id: 'imp-1' });
    assert.equal(deleted.profiles.length, 0);
    assert.equal(deleted.activeProfileId, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SSRF guard blocks metadata hosts, non-http schemes, and cross-origin apiKey exfiltration', async () => {
  const dir = makeTempDir();
  try {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return jsonResponse({ data: [] });
    };
    const translator = createThoughtTranslator(dir, { fetchImpl });

    const blockedUrls = [
      'file:///etc/passwd',
      'ftp://example.com/v1',
      'gopher://127.0.0.1:6379/',
      'http://169.254.169.254/latest/meta-data',
      'http://169.254.170.2/v2/credentials',
      'http://metadata.google.internal/computeMetadata/v1',
      'https://sub.metadata.google.internal/v1',
      'http://100.100.100.200/latest/meta-data',
      'http://[::ffff:169.254.169.254]/latest',
      'http://[fe80::1]/v1',
      'http://0.0.0.0:11434/v1',
      'https://user:pass@api.openai.com/v1'
    ];
    for (const bad of blockedUrls) {
      assert.throws(() => validateUpstreamUrl(bad), `Expected SSRF guard to block: ${bad}`);
      assert.throws(() => translator.saveProfile({
        profile: { id: 'bad', name: 'Bad', baseUrl: bad, apiKey: 'sk-1234567890', model: 'm' }
      }));
    }

    // Save a legitimate profile, then try to fetchModels against a different origin using profileId
    translator.saveProfile({
      profile: {
        id: 'legit',
        name: 'Legit',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-topsecret-5678',
        model: 'gpt-4o-mini'
      }
    });

    await assert.rejects(
      () => translator.fetchModels({ baseUrl: 'https://attacker.example.com/v1', profileId: 'legit' }),
      /不同源/
    );
    await assert.rejects(
      () => translator.fetchModels({ baseUrl: 'http://127.0.0.1:9999/v1', apiKey: 'sk-****5678', profileId: 'legit' }),
      /不同源/
    );
    assert.equal(fetchCalled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrency limiter caps at 3 in FIFO order, deduplicates identical in-flight keys, and persists bounded LRU cache', async () => {
  const dir = makeTempDir();
  try {
    let inFlightNow = 0;
    let maxObserved = 0;
    const startOrder = [];
    let totalCalls = 0;

    const fetchImpl = async url => {
      totalCalls++;
      const parsed = new URL(url);
      const q = parsed.searchParams.get('q') || '';
      startOrder.push(q);
      inFlightNow++;
      if (inFlightNow > maxObserved) maxObserved = inFlightNow;
      await new Promise(r => setTimeout(r, 25));
      inFlightNow--;
      return jsonResponse([[[`ZH:${q}`, q]], null, 'en']);
    };

    const translator = createThoughtTranslator(dir, {
      fetchImpl,
      machineEndpoint: 'https://translate.example.test/translate_a/single',
      maxConcurrent: 3,
      maxCacheEntries: 4
    });

    // Launch 6 distinct texts concurrently -> max 3 at once, FIFO order
    const distinctInputs = ['t1', 't2', 't3', 't4', 't5', 't6'];
    const results = await Promise.all(
      distinctInputs.map(text => translator.translate({ text, mode: 'machine', targetLang: 'zh-CN' }))
    );
    assert.equal(maxObserved, 3);
    assert.deepEqual(startOrder, distinctInputs);
    assert.deepEqual(results.map(r => r.translated), distinctInputs.map(t => `ZH:${t}`));
    assert.equal(totalCalls, 6);

    // LRU cap = 4 -> t1 and t2 were evicted; t3..t6 remain cached
    const hitT6 = await translator.translate({ text: 't6', mode: 'machine', targetLang: 'zh-CN' });
    assert.equal(hitT6.cached, true);
    assert.equal(hitT6.translated, 'ZH:t6');
    assert.equal(totalCalls, 6);

    // Force bypasses cache
    const forcedT6 = await translator.translate({ text: 't6', mode: 'machine', targetLang: 'zh-CN', force: true });
    assert.equal(forcedT6.cached, false);
    assert.equal(totalCalls, 7);

    // In-flight deduplication: 5 simultaneous calls for identical new key -> only 1 fetch
    const dedupResults = await Promise.all(
      Array.from({ length: 5 }, () => translator.translate({ text: 'same-key', mode: 'machine', targetLang: 'zh-CN' }))
    );
    assert.equal(totalCalls, 8);
    assert.ok(dedupResults.every(r => r.translated === 'ZH:same-key'));

    // Cache persists across new instances
    const translator2 = createThoughtTranslator(dir, {
      fetchImpl,
      machineEndpoint: 'https://translate.example.test/translate_a/single',
      maxCacheEntries: 4
    });
    const persistedHit = await translator2.translate({ text: 'same-key', mode: 'machine', targetLang: 'zh-CN' });
    assert.equal(persistedHit.cached, true);
    assert.equal(persistedHit.translated, 'ZH:same-key');
    assert.equal(totalCalls, 8);

    // clearCache empties cache
    const cleared = translator2.clearCache();
    assert.equal(cleared.ok, true);
    assert.equal(cleared.cleared, 4);
    assert.equal(translator2.getProfiles().cacheEntries, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('translateTitles skips CJK titles for zh targets, preserves Japanese translation, and caps at 24 items', async () => {
  const dir = makeTempDir();
  try {
    const seen = [];
    const fetchImpl = async url => {
      const q = new URL(url).searchParams.get('q') || '';
      seen.push(q);
      return jsonResponse([[[`译:${q}`, q]], null, 'auto']);
    };

    const translator = createThoughtTranslator(dir, {
      fetchImpl,
      machineEndpoint: 'https://translate.example.test/translate_a/single'
    });

    assert.equal(isPrimarilyCjk('修复 CDP 端口监听异常'), true);
    assert.equal(isPrimarilyCjk('Fix CDP port listener error'), false);
    assert.equal(isPrimarilyCjk('日本語のテストを実行する'), false);

    const items = [
      { id: 'cjk-1', title: '排查 Antigravity 代理隧道超时问题' },
      { id: 'ja-1', title: 'テストを実行して結果を確認する' },
      ...Array.from({ length: 28 }, (_, i) => ({ id: `en-${i + 1}`, title: `Refactor module ${i + 1}` }))
    ];

    const res = await translator.translateTitles({ items, mode: 'machine', targetLang: 'zh-CN' });
    assert.equal(res.ok, true);
    assert.equal(res.translations['cjk-1'], undefined);
    assert.equal(res.translations['ja-1'], '译:テストを実行して結果を確認する');
    assert.equal(Object.keys(res.translations).length, 24);
    assert.equal(seen.length, 24);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('diagnose reports masked proxy status, latency, and handles upstream failure gracefully', async () => {
  const dir = makeTempDir();
  try {
    const okFetch = async () => jsonResponse([[['你好', 'hello']], null, 'en']);
    const translator = createThoughtTranslator(dir, {
      fetchImpl: okFetch,
      machineEndpoint: 'https://translate.example.test/translate_a/single',
      getSettings: () => ({
        proxyEnabled: true,
        proxyUrl: 'http://alice:supersecret@127.0.0.1:7890'
      })
    });

    const okDiag = await translator.diagnose({ mode: 'machine' });
    assert.equal(okDiag.ok, true);
    assert.equal(okDiag.daemonAlive, true);
    assert.equal(okDiag.upstreamOk, true);
    assert.equal(okDiag.proxyActive, true);
    assert.equal(okDiag.proxyUrl, 'http://***@127.0.0.1:7890');
    assert.ok(!okDiag.proxyUrl.includes('supersecret'));
    assert.equal(typeof okDiag.latencyMs, 'number');

    const failTranslator = createThoughtTranslator(dir, {
      fetchImpl: async () => jsonResponse('gateway timeout', 504),
      machineEndpoint: 'https://translate.example.test/translate_a/single'
    });
    const failDiag = await failTranslator.diagnose({ mode: 'machine' });
    assert.equal(failDiag.ok, false);
    assert.equal(failDiag.daemonAlive, true);
    assert.equal(failDiag.upstreamOk, false);
    assert.match(failDiag.message, /504/);

    // AI mode diagnose (unconfigured profile fails gracefully, configured succeeds)
    const noProfileDiag = await failTranslator.diagnose({ mode: 'ai' });
    assert.equal(noProfileDiag.ok, false);
    assert.equal(noProfileDiag.daemonAlive, true);
    assert.equal(noProfileDiag.upstreamOk, false);

    const aiTranslator = createThoughtTranslator(dir, {
      fetchImpl: async url => {
        if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }] });
        return jsonResponse({ choices: [{ message: { content: 'AI 标题译文' } }] });
      }
    });
    aiTranslator.saveProfile({
      profile: { id: 'ai-diag', name: 'AI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test-diag-9876', model: 'gpt-4o-mini' }
    });
    const aiDiag = await aiTranslator.diagnose({ mode: 'ai', profileId: 'ai-diag' });
    assert.equal(aiDiag.ok, true);
    assert.equal(aiDiag.daemonAlive, true);
    assert.equal(aiDiag.upstreamOk, true);
    assert.match(aiDiag.message, /2 个模型/);

    // AI mode translateTitles and empty text fast-path
    const aiTitles = await aiTranslator.translateTitles({
      items: [{ id: 't1', title: 'Investigate memory leak' }, { id: 't2', title: '排查内存泄漏问题' }],
      mode: 'ai',
      targetLang: 'zh-CN',
      profileId: 'ai-diag'
    });
    assert.deepEqual(aiTitles, { ok: true, translations: { t1: 'AI 标题译文' } });

    const emptyRes = await aiTranslator.translate({ text: '   ', mode: 'ai', profileId: 'ai-diag' });
    assert.equal(emptyRes.ok, true);
    assert.equal(emptyRes.translated, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('thought-translator source and test contain no middle-dot character (U+00B7)', () => {
  const src = readFileSync(new URL('../lib/thought-translator.mjs', import.meta.url), 'utf8');
  const tst = readFileSync(new URL('./thought-translator.test.mjs', import.meta.url), 'utf8');
  assert.equal(src.includes('\u00b7'), false);
  assert.equal(tst.includes('\u00b7'), false);
});
