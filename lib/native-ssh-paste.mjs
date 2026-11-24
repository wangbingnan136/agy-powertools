// OpenSSH command paste + VS Code Remote-SSH ("Add New SSH Host") helper.
// Runs inside the renderer bundle; keeps zero Node dependencies.

const SSH_PASTE_OPTS_WITH_ARG = new Set([
  '-b', '-B', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J',
  '-L', '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w'
]);
const SSH_PASTE_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const SSH_PASTE_HOST_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$|^\[[0-9A-Fa-f:.]+(?:%[A-Za-z0-9._-]+)?\]$/;
const SSH_PASTE_ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

function tokenizePasteLine(raw = '') {
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

function suggestSshAlias(host, port = 0, user = '') {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return 'ssh-host';
  let base = '';
  const seeta = h.match(/^connect\.([a-z0-9-]+)\.seetacloud\.com$/i);
  const autodl = h.match(/^(?:connect\.|region-)?([a-z0-9-]+)\.autodl\.(?:com|pro)$/i);
  if (seeta) base = `seetacloud-${seeta[1].toLowerCase()}`;
  else if (autodl) base = `autodl-${autodl[1].toLowerCase()}`;
  else if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) base = `ssh-${h.replace(/\./g, '-')}`;
  else {
    const segs = h.split('.').filter(Boolean);
    base = segs.length >= 2 ? segs.slice(0, 2).join('-') : (segs[0] || 'ssh-host');
  }
  base = base.replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '') || 'ssh-host';
  const suffix = port > 0 && port !== 22 ? `-${port}` : '';
  const prefix = user && user !== 'root' ? `${String(user).replace(/[^a-z0-9_-]+/gi, '').toLowerCase()}-` : '';
  const alias = `${prefix}${base}${suffix}`.slice(0, 62).replace(/[-._]+$/g, '');
  return SSH_PASTE_ALIAS_RE.test(alias) ? alias : 'ssh-host';
}

export function parseSshCommand(text = '') {
  const input = String(text || '').trimStart();
  if (!/^ssh(?:\.exe)?(?=\s|$)/i.test(input)) return null;
  const lines = input.split(/\r?\n/);
  const tokens = tokenizePasteLine(lines[0].trimEnd());
  if (tokens.length < 2) return { valid: false };

  let optPort = 0;
  let optUser = '';
  let identityFile = '';
  let proxyJump = '';
  let forwardAgent = false;
  let target = '';
  let afterDash = false;
  let hadTrailing = lines.slice(1).some(l => l.trim().length > 0);

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!afterDash && tok === '--') { afterDash = true; continue; }
    if (!afterDash && tok.startsWith('-') && tok.length > 1) {
      if (target && hadTrailing) break;
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
        if (!val || !SSH_PASTE_USER_RE.test(val)) return { valid: false };
        optUser = val;
        continue;
      }
      if (flag === '-i') {
        identityFile = tok.length > 2 ? tok.slice(2) : (tokens[++i] || '');
        if (!identityFile || /[\x00-\x1f\x7f]/.test(identityFile)) return { valid: false };
        continue;
      }
      if (flag === '-J') {
        proxyJump = tok.length > 2 ? tok.slice(2) : (tokens[++i] || '');
        if (!proxyJump || /[\x00-\x1f\x7f]/.test(proxyJump)) return { valid: false };
        continue;
      }
      if (flag === '-A') { forwardAgent = true; continue; }
      if (SSH_PASTE_OPTS_WITH_ARG.has(flag)) return { valid: false };
      if (/^-[TN46Cvq]+$/.test(tok)) continue;
      return { valid: false };
    }
    if (!target) target = tok;
    else hadTrailing = true;
  }

  if (!target) return { valid: false };
  let raw = target;
  if (raw.startsWith('ssh://')) raw = raw.slice(6).replace(/\/+$/, '');
  let user = '';
  const at = raw.lastIndexOf('@');
  if (at >= 0) {
    user = raw.slice(0, at);
    raw = raw.slice(at + 1);
    if (!user || !SSH_PASTE_USER_RE.test(user)) return { valid: false };
  }
  let host = raw;
  let destPort = 0;
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close < 0) return { valid: false };
    host = raw.slice(0, close + 1);
    const rest = raw.slice(close + 1);
    if (rest) {
      if (!rest.startsWith(':')) return { valid: false };
      const p = Number(rest.slice(1));
      if (!Number.isInteger(p) || p < 1 || p > 65535) return { valid: false };
      destPort = p;
    }
  } else {
    const colons = raw.split(':').length - 1;
    if (colons === 1) {
      const idx = raw.indexOf(':');
      const p = Number(raw.slice(idx + 1));
      if (!Number.isInteger(p) || p < 1 || p > 65535) return { valid: false };
      host = raw.slice(0, idx);
      destPort = p;
    } else if (colons > 1) {
      return { valid: false };
    }
  }
  if (!host || !SSH_PASTE_HOST_RE.test(host)) return { valid: false };
  if (optPort && destPort) return { valid: false };
  const port = optPort || destPort || 0;
  const finalUser = user || optUser || '';
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  // Only pass the destination to Antigravity; never pass any password or trailing text.
  const destination = `${finalUser ? `${finalUser}@` : ''}${host}${port ? `:${port}` : ''}`;
  return {
    valid: true,
    destination,
    host: bareHost,
    user: finalUser,
    port,
    identityFile,
    proxyJump,
    forwardAgent,
    hadTrailing,
    suggestedAlias: suggestSshAlias(bareHost, port, finalUser)
  };
}

// null = normal paste; empty string = an SSH command in an unsupported format.
export function sshCommandDestination(text) {
  const parsed = parseSshCommand(text);
  if (parsed === null) return null;
  return parsed.valid ? parsed.destination : '';
}

function setNativeInputValue(document, input, value) {
  const view = document.defaultView;
  Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new view.Event('input', { bubbles: true }));
}

export function installSshCommandPaste(document, { enabled, text, saveHost, signal }) {
  document.addEventListener('paste', event => {
    const input = event.target;
    if (!enabled() || !input?.matches?.('input[data-testid="ssh-connect-host-input"]') || input.readOnly || input.disabled) return;
    const dialog = input.closest('[data-testid="ssh-connect-dialog"]');
    if (!dialog) return;
    const parsed = parseSshCommand(event.clipboardData?.getData('text/plain') ?? '');
    if (parsed === null) return;
    event.preventDefault();
    event.stopPropagation();

    const destination = parsed.valid ? parsed.destination : '';
    if (destination) setNativeInputValue(document, input, destination);

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
      ? text('已填入 SSH 地址。可保存至 ~/.ssh/config，或在点连接后的原生弹窗中输入密码。', 'SSH address filled. Save to ~/.ssh/config or enter the password in the native prompt after clicking Connect.')
      : text('请粘贴 ssh -p 端口 用户@主机，或直接输入 SSH 地址。', 'Paste ssh -p PORT user@host, or enter an SSH address.');

    // Render VS Code Remote-SSH ("Add New SSH Host") save bar when saveHost is available
    const existingBar = dialog.querySelector('[data-agy-ssh-save-bar]');
    if (!parsed.valid || typeof saveHost !== 'function') {
      existingBar?.remove?.();
      return;
    }
    existingBar?.remove?.();
    const bar = document.createElement('div');
    bar.dataset.agySshSaveBar = '';
    bar.dataset.agyPowertoolsRoot = 'ssh-save-bar';
    bar.className = 'flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-xs';
    const aliasInput = document.createElement('input');
    aliasInput.type = 'text';
    aliasInput.value = parsed.suggestedAlias;
    aliasInput.placeholder = text('主机别名', 'Host alias');
    aliasInput.setAttribute('aria-label', text('SSH 主机别名', 'SSH host alias'));
    aliasInput.className = 'flex-1 min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'shrink-0 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary cursor-pointer';
    saveBtn.textContent = text('保存到 ~/.ssh/config', 'Save to ~/.ssh/config');
    saveBtn.addEventListener('click', async () => {
      const alias = aliasInput.value.trim() || parsed.suggestedAlias;
      saveBtn.disabled = true;
      try {
        const res = await saveHost({
          alias,
          host: parsed.host,
          user: parsed.user,
          port: parsed.port,
          identityFile: parsed.identityFile,
          proxyJump: parsed.proxyJump,
          forwardAgent: parsed.forwardAgent
        });
        const savedAlias = res?.alias || alias;
        setNativeInputValue(document, input, savedAlias);
        status.textContent = text(`已保存主机「${savedAlias}」到 ~/.ssh/config，可直接点击连接。`, `Saved "${savedAlias}" to ~/.ssh/config. Click Connect to continue.`);
      } catch (err) {
        status.textContent = err?.message || text('保存 ~/.ssh/config 失败', 'Failed to save ~/.ssh/config');
      } finally {
        saveBtn.disabled = false;
      }
    });
    bar.append(aliasInput, saveBtn);
    dialog.append(bar);
  }, { capture: true, signal });
}
