// null = normal paste; empty string = an SSH command in an unsupported format.
export function sshCommandDestination(text) {
  const input = text.trimStart();
  if (!/^ssh(?:\.exe)?(?=\s|$)/i.test(input)) return null;
  const line = input.split(/[\r\n]/, 1)[0].trimEnd();
  const match = /^(?:ssh(?:\.exe)?)[ \t]+(?:-p[ \t]*([0-9]{1,5})[ \t]+)?(?:--[ \t]+)?((?:[A-Za-z0-9_][A-Za-z0-9._-]*@)*)([A-Za-z0-9_][A-Za-z0-9._-]*|\[[0-9A-Fa-f:.]+(?:%[A-Za-z0-9._-]+)?\])(?::([0-9]{1,5}))?(?=[ \t]|$)/i.exec(line);
  if (!match) return '';
  const [, optionPort, user, host, destinationPort] = match;
  const port = Number(optionPort ?? destinationPort);
  if (optionPort && destinationPort || (optionPort || destinationPort) && !(port >= 1 && port <= 65535)) return '';
  // Only pass the destination to Antigravity; never pass the password or any trailing text.
  return `${user}${host}${port ? `:${port}` : ''}`;
}

export function installSshCommandPaste(document, { enabled, text, signal }) {
  document.addEventListener('paste', event => {
    const input = event.target;
    if (!enabled() || !input?.matches?.('input[data-testid="ssh-connect-host-input"]') || input.readOnly || input.disabled) return;
    const dialog = input.closest('[data-testid="ssh-connect-dialog"]');
    if (!dialog) return;
    const destination = sshCommandDestination(event.clipboardData?.getData('text/plain') ?? '');
    if (destination === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (destination) {
      const view = document.defaultView;
      // The native form is React-controlled; use the DOM setter to signal an input change.
      Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set.call(input, destination);
      input.dispatchEvent(new view.Event('input', { bubbles: true }));
    }
    let status = dialog.querySelector('[data-agy-ssh-paste-status]');
    if (!status) {
      status = document.createElement('p');
      status.dataset.agySshPasteStatus = '';
      status.dataset.agyPowertoolsRoot = 'ssh-paste-status';
      status.setAttribute('role', 'status');
      status.className = 'text-sm text-muted-foreground';
      dialog.append(status);
    }
    status.textContent = destination
      ? text('已填入 SSH 地址。若需要密码，请在点击连接后的原生弹窗输入。', 'SSH address filled. Enter the password in the native prompt if requested.')
      : text('请粘贴 ssh -p 端口 用户@主机，或直接输入 SSH 地址。', 'Paste ssh -p PORT user@host, or enter an SSH address.');
  }, { capture: true, signal });
}
