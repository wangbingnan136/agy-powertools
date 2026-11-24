import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { installSshCommandPaste, parseSshCommand, sshCommandDestination } from '../lib/native-ssh-paste.mjs';
import { parseOpenSshCommand, upsertSshConfigHost } from '../lib/ssh-config.mjs';
import { nativeSource } from '../lib/native-host.mjs';

test('SSH command paste extracts only a native destination and supports Remote-SSH flags', () => {
  assert.equal(sshCommandDestination('ssh -p 23911 root@remote.example  samplePassword'), 'root@remote.example:23911');
  assert.equal(sshCommandDestination('ssh -p2222 user@[2001:db8::1]\r\nPassword: samplePassword'), 'user@[2001:db8::1]:2222');
  assert.equal(sshCommandDestination('ssh -- devbox'), 'devbox');
  assert.equal(sshCommandDestination('ssh user@remote.example:2222'), 'user@remote.example:2222');
  assert.equal(sshCommandDestination('ssh root@connect.weste.seetacloud.com -p 11430 -i ~/.ssh/id_ed25519 -J bastion -A'), 'root@connect.weste.seetacloud.com:11430');
  const parsed = parseSshCommand('ssh -p 11430 root@connect.weste.seetacloud.com -i ~/.ssh/my_key -J jumpbox -A  ignoredPw');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.host, 'connect.weste.seetacloud.com');
  assert.equal(parsed.user, 'root');
  assert.equal(parsed.port, 11430);
  assert.equal(parsed.identityFile, '~/.ssh/my_key');
  assert.equal(parsed.proxyJump, 'jumpbox');
  assert.equal(parsed.forwardAgent, true);
  assert.equal(parsed.suggestedAlias, 'seetacloud-weste-11430');
  for (const direct of ['devbox', 'user@host:2222', 'ssh://user@host:2222']) assert.equal(sshCommandDestination(direct), null);
  for (const invalid of ['ssh', 'ssh -p 0 devbox', 'ssh -p 65536 devbox', 'ssh -p 2222 devbox:22', 'ssh -o StrictHostKeyChecking=no devbox', 'ssh devbox;other']) {
    assert.equal(sshCommandDestination(invalid), '');
  }
});

test('upsertSshConfigHost losslessly preserves comments and unrelated directives', () => {
  const original = [
    '# >>> codex-ssh-connect:keepme >>>',
    'Host keepme',
    '  HostName 10.0.0.1',
    '  RemoteForward 127.0.0.1:17890 127.0.0.1:7890',
    '# <<< codex-ssh-connect:keepme <<<',
    '',
    'Host seetacloud-weste-11430',
    '  # Existing comment',
    '  HostName old.example.com',
    '  User root',
    '  Port 22',
    '  ServerAliveInterval 15',
    ''
  ].join('\n');
  const updated = upsertSshConfigHost(original, {
    alias: 'seetacloud-weste-11430',
    host: 'connect.weste.seetacloud.com',
    user: 'root',
    port: 11430,
    identityFile: '~/.ssh/seeta_ed25519'
  });
  assert.match(updated, /# >>> codex-ssh-connect:keepme >>>/);
  assert.match(updated, /RemoteForward 127\.0\.0\.1:17890 127\.0\.0\.1:7890/);
  assert.match(updated, /# Existing comment/);
  assert.match(updated, /HostName connect\.weste\.seetacloud\.com/);
  assert.match(updated, /Port 11430/);
  assert.match(updated, /ServerAliveInterval 15/);
  assert.match(updated, /IdentityFile ~\/\.ssh\/seeta_ed25519/);

  const appended = upsertSshConfigHost(original, {
    alias: 'new-gpu',
    host: 'connect.westc.seetacloud.com',
    user: 'root',
    port: 23911
  });
  assert.match(appended, /\nHost new-gpu\n  HostName connect\.westc\.seetacloud\.com\n  User root\n  Port 23911\n$/);
  const cmdParsed = parseOpenSshCommand('ssh -p 11430 -l root connect.weste.seetacloud.com trailingSecret');
  assert.equal(cmdParsed.valid, true);
  assert.equal(cmdParsed.suggestedAlias, 'seetacloud-weste-11430');
});

test('only the SSH input gets the normalized value, without submitting or emitting the password, and supports Save to ~/.ssh/config', async () => {
  const elements = [];
  const makeEl = tag => {
    const el = {
      tag, dataset: {}, children: [], listeners: new Map(), value: '', textContent: '', disabled: false,
      setAttribute() {},
      addEventListener(type, fn) { this.listeners.set(type, fn); },
      append(...nodes) { this.children.push(...nodes); },
      remove() {}
    };
    elements.push(el);
    return el;
  };
  let statusNode = null;
  let barNode = null;
  const dialog = {
    querySelector: sel => sel === '[data-agy-ssh-paste-status]' ? statusNode : (sel === '[data-agy-ssh-save-bar]' ? barNode : null),
    append: node => {
      if (node.dataset.agySshPasteStatus !== undefined) statusNode = node;
      if (node.dataset.agySshSaveBar !== undefined) barNode = node;
    }
  };
  class Input {
    set value(value) { this.nativeValue = value; }
    matches(selector) { return selector === 'input[data-testid="ssh-connect-host-input"]'; }
    closest() { return dialog; }
    dispatchEvent(event) { events.push({ type: event.type, bubbles: event.bubbles, value: this.nativeValue }); }
  }
  let paste, prevented = 0, enabled = true;
  const savedPayloads = [];
  const events = [];
  const controller = new AbortController();
  const doc = {
    addEventListener(type, listener, options) {
      assert.equal(type, 'paste');
      assert.deepEqual(options, { capture: true, signal: controller.signal });
      paste = listener;
    },
    createElement: makeEl,
    defaultView: { HTMLInputElement: Input, Event }
  };
  installSshCommandPaste(doc, {
    enabled: () => enabled,
    text: (_zh, en) => en,
    saveHost: async payload => { savedPayloads.push(payload); return { ok: true, alias: payload.alias }; },
    signal: controller.signal
  });
  const input = new Input();
  const send = (value, target = input) => paste({ target, clipboardData: { getData: () => value }, preventDefault: () => prevented++, stopPropagation() {} });
  send('ssh -p 2222 user@host samplePassword');
  assert.deepEqual(events, [{ type: 'input', bubbles: true, value: 'user@host:2222' }]);
  assert.match(statusNode.textContent, /native prompt/);
  assert.ok(barNode);
  const saveBtn = barNode.children[1];
  await saveBtn.listeners.get('click')();
  assert.equal(savedPayloads.length, 1);
  assert.equal(savedPayloads[0].host, 'host');
  assert.equal(savedPayloads[0].port, 2222);
  assert.equal(events.at(-1).value, savedPayloads[0].alias);

  send('ssh -o unsupported host samplePassword');
  assert.doesNotMatch(statusNode.textContent, /samplePassword/);
  send('user@other:2222');
  send('ssh another', { matches: () => false });
  enabled = false;
  send('ssh another');
  assert.equal(prevented, 2);
});

test('nativeSource embeds buildHash so same-version updates hot-reload cleanly', () => {
  const src = nativeSource('https://127.0.0.1');
  new Script(src);
  assert.match(src, /__agyNativeBuildHash="[a-f0-9]{12}"/);
  assert.match(src, /__agyPowertools\?\.buildHash!==/);
});
