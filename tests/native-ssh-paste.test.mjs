import test from 'node:test';
import assert from 'node:assert/strict';
import { installSshCommandPaste, sshCommandDestination } from '../lib/native-ssh-paste.mjs';

test('SSH command paste extracts only a native destination', () => {
  assert.equal(sshCommandDestination('ssh -p 23911 root@remote.example  samplePassword'), 'root@remote.example:23911');
  assert.equal(sshCommandDestination('ssh -p2222 user@[2001:db8::1]\r\nPassword: samplePassword'), 'user@[2001:db8::1]:2222');
  assert.equal(sshCommandDestination('ssh -- devbox'), 'devbox');
  assert.equal(sshCommandDestination('ssh user@remote.example:2222'), 'user@remote.example:2222');
  for (const direct of ['devbox', 'user@host:2222', 'ssh://user@host:2222']) assert.equal(sshCommandDestination(direct), null);
  for (const invalid of ['ssh', 'ssh -p 0 devbox', 'ssh -p 65536 devbox', 'ssh -p 2222 devbox:22', 'ssh -o StrictHostKeyChecking=no devbox', 'ssh devbox;other']) {
    assert.equal(sshCommandDestination(invalid), '');
  }
});

test('only the SSH input gets the normalized value, without submitting or emitting the password', () => {
  const status = { dataset: {}, setAttribute() {} };
  const dialog = { querySelector: () => null, append: node => assert.equal(node, status) };
  class Input {
    set value(value) { this.nativeValue = value; }
    matches(selector) { return selector === 'input[data-testid="ssh-connect-host-input"]'; }
    closest() { return dialog; }
    dispatchEvent(event) { events.push({ type: event.type, bubbles: event.bubbles, value: this.nativeValue }); }
  }
  let paste, prevented = 0, enabled = true;
  const events = [];
  const controller = new AbortController();
  const doc = {
    addEventListener(type, listener, options) {
      assert.equal(type, 'paste');
      assert.deepEqual(options, { capture: true, signal: controller.signal });
      paste = listener;
    },
    createElement: () => status,
    defaultView: { HTMLInputElement: Input, Event }
  };
  installSshCommandPaste(doc, { enabled: () => enabled, text: (_zh, en) => en, signal: controller.signal });
  const input = new Input();
  const send = (value, target = input) => paste({ target, clipboardData: { getData: () => value }, preventDefault: () => prevented++, stopPropagation() {} });
  send('ssh -p 2222 user@host samplePassword');
  assert.deepEqual(events, [{ type: 'input', bubbles: true, value: 'user@host:2222' }]);
  assert.match(status.textContent, /native prompt/);
  send('ssh -o unsupported host samplePassword');
  assert.equal(events.length, 1);
  assert.doesNotMatch(status.textContent, /samplePassword/);
  send('user@other:2222');
  send('ssh another', { matches: () => false });
  enabled = false;
  send('ssh another');
  assert.equal(prevented, 2);
});
