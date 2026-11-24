import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { File } from 'node:buffer';
import { createPrismService } from '../lib/prism-service.mjs';
import { createSettingsStore } from '../lib/settings.mjs';
import { nativeSource } from '../lib/native-host.mjs';

test('Powertools includes Prism script factories in one compilable renderer payload', () => {
  const source = nativeSource('https://127.0.0.1:9999');
  assert.doesNotThrow(() => new vm.Script(source));
  for (const name of ['Optics', 'Workbench', 'PrismPanels', 'PrismIntegration']) {
    assert.ok(source.includes(`globalThis.__agyCreate${name}`), name);
  }
});

test('renderer integration never enables unconnected services and preserves drafts', () => {
  const calls = [];
  let options = { enabled: true, contextStyle: 'vial', wallpaperEnabled: true, omniViewer: true, thoughtTranslate: 'ai', translateSessionTitles: true };
  let draft = 'unsent';
  const composer = {};
  const context = vm.createContext({
    location: { pathname: '/c/c1' },
    __agyCreateOptics: () => ({ sync: (opts, exec) => calls.push(['optics', opts, exec]), dispose: () => calls.push(['optics.dispose']) }),
    __agyCreateWorkbench: () => ({ sync: opts => calls.push(['workbench', opts]), dispose: () => calls.push(['workbench.dispose']) })
  });
  vm.runInContext(readFileSync(new URL('../lib/prism-integration.js', import.meta.url), 'utf8'), context);
  const integration = context.__agyCreatePrismIntegration({
    options: () => options,
    adapter: { getComposerText: () => draft, setComposerText(target, text) { assert.equal(target, composer); draft = text; } },
    notify: message => calls.push(['toast', message]), uiText: (zh, en) => en
  });
  integration.syncSettings();
  integration.syncSettings();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].contextStyle, 'ring'); // React owns the trigger; avoid a second injected icon.
  assert.equal(calls[0][1].wallpaperEnabled, false);
  assert.equal(calls[1][1].thoughtTranslate, 'off');
  assert.equal(calls[1][1].omniViewer, false);
  integration.syncExecution({ conversationId: 'c1', status: 2 });
  const state = { conversationId: 'c1', contextWindow: { usedPercent: 83, maxTokens: 500000 } };
  const vial = integration.vialProps(state, { closest: () => composer });
  assert.equal(vial.streaming, true);
  vial.onCompact();
  assert.equal(draft, 'unsent');
  draft = '';
  vial.onCompact();
  assert.equal(draft, '/compact');
  options = { ...options, enabled: false };
  integration.syncSettings();
  assert.equal(calls.at(-1)[1].enabled, false);
  integration.dispose();
  assert.deepEqual(calls.slice(-2).map(([key]) => key), ['workbench.dispose', 'optics.dispose']);
});

test('local wallpaper only accepts chosen media and releases previous object URLs', () => {
  const images = [];
  const revoked = [];
  const context = vm.createContext({
    File,
    location: { pathname: '/c/c1' },
    URL: { createObjectURL: file => `blob:fixture/${file.name}`, revokeObjectURL: url => revoked.push(url) },
    __agyCreateOptics: () => ({ sync() {}, dispose() {}, setWallpaperStatus: value => images.push(value) })
  });
  vm.runInContext(readFileSync(new URL('../lib/prism-integration.js', import.meta.url), 'utf8'), context);
  const integration = context.__agyCreatePrismIntegration({ options: () => ({ enabled: true, wallpaperEnabled: true }), uiText: (zh, en) => en });
  integration.syncSettings();
  assert.throws(() => integration.selectWallpaper('/absolute/path.png'), /Choose/);
  assert.throws(() => integration.selectWallpaper(new File(['<svg/>'], 'test.svg', { type: 'image/svg+xml' })), /Choose/);
  integration.selectWallpaper(new File(['png-fixture'], 'first.png', { type: 'image/png' }));
  assert.equal(integration.wallpaperName(), 'first.png');
  integration.selectWallpaper(new File(['mp4-fixture'], 'second.mp4', { type: 'video/mp4' }));
  assert.equal(images.at(-1).kind, 'video');
  assert.deepEqual(revoked, ['blob:fixture/first.png']);
  integration.selectWallpaper(null);
  assert.equal(images.at(-1), null);
  assert.deepEqual(revoked, ['blob:fixture/first.png', 'blob:fixture/second.mp4']);
  integration.dispose();
});

test('Prism RPC scopes the diff and keeps unfinished or consent-sensitive capabilities out of the renderer', async () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'agy-prism-integration-')));
  const root = join(temp, 'project');
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  try {
    git(['init', 'project'], temp);
    writeFileSync(join(root, 'main.txt'), 'before\n');
    git(['add', 'main.txt']);
    git(['-c', 'user.name=Powertools Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'initial']);
    writeFileSync(join(root, 'main.txt'), 'after\n');
    writeFileSync(join(root, '.env'), 'test-fixture\n');
    writeFileSync(join(temp, 'outside.txt'), 'not in the workspace\n');
    if (process.platform !== 'win32') symlinkSync(join(temp, 'outside.txt'), join(root, 'link.txt'));
    const dataDir = join(temp, 'data');
    const settings = createSettingsStore(dataDir);
    const svc = createPrismService({ settings, dataDir, workspaceOf: id => id === 'c1' ? pathToFileURL(root).href : '' });
    const req = (method, payload, context) => svc.request({ method, ...payload }, context);
    for (const method of ['omni.open', 'archive.run', 'wallpaper.setPath', 'thought.translate']) assert.equal(svc.handles(method), false);
    await assert.rejects(req('chatFolders.get'), /未开启/);
    settings.set({ chatModeBeta: true, multiAccount: true });
    await req('chatFolders.save', { folders: [{ id: 'daily', name: 'Daily' }], assignments: { c1: 'daily' } });
    assert.equal((await req('chatFolders.get')).assignments.c1, 'daily');
    const { bundle } = await req('settings.export');
    assert.equal('multiAccount' in bundle.settings, false);
    assert.deepEqual((await req('settings.import', { bundle: { settings: { themePalette: 'warm', autoSwitchAccount: true } } })).patch, { themePalette: 'warm' });
    assert.equal(settings.get().themePalette, 'native'); // Let the UI apply validated settings through its existing lifecycle.
    await assert.rejects(req('diff.inline', { conversationId: 'missing', workspaceUri: pathToFileURL(root).href, path: 'main.txt' }), /工作区/);
    await assert.rejects(req('diff.inline', { conversationId: 'c1', path: 'main.txt' }, { remoteWindow: true }), /不支持/);
    await assert.rejects(req('diff.inline', { conversationId: 'c1', path: '.env' }));
    await assert.rejects(req('diff.inline', { conversationId: 'c1', path: '../outside.txt' }));
    if (process.platform !== 'win32') await assert.rejects(req('diff.inline', { conversationId: 'c1', path: 'link.txt' }));
    // Isolate global Git config so user-installed filters do not change the fixture result.
    const previous = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = join(temp, 'empty-config');
    try {
      const diff = await req('diff.inline', { conversationId: 'c1', path: 'main.txt' });
      assert.ok(diff.lines.some(line => line.kind === 'add' && line.text.includes('after')));
      git(['config', 'filter.demo.clean', 'cat']);
      await assert.rejects(req('diff.inline', { conversationId: 'c1', path: 'main.txt' }), /过滤器/);
    } finally {
      if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previous;
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
