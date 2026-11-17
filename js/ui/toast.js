// Short status messages stacked in #toast-root (an aria-live="polite" region).
//
//   toast('Saved pattern.svg', 'ok')        kind: 'info' | 'ok' | 'warn' | 'error'
//   const t = toast('Working...', 'info', { timeout: 0 }); t.close();
//
// Messages close after TOAST_MS (errors stay a little longer), pause while
// hovered or focused, and repeat messages restart the existing toast instead
// of stacking a copy. At most MAX_TOASTS are shown; the oldest goes first.

export const TOAST_MS = 3500;
const ERROR_MS = 6000;
const MAX_TOASTS = 4;
const KINDS = new Set(['info', 'ok', 'warn', 'error']);
const live = new Map();   // message key -> handle

function toastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.append(root);
  }
  if (!root.hasAttribute('aria-live')) root.setAttribute('aria-live', 'polite');
  return root;
}

/** Show a message. Returns { close() }. opts.timeout in ms (0 = until closed). */
export function toast(message, kind = 'info', opts = {}) {
  const text = String(message ?? '');
  const k = KINDS.has(kind) ? kind : 'info';
  if (typeof document === 'undefined') return { close() {} };
  const timeout = opts.timeout ?? (k === 'error' ? ERROR_MS : TOAST_MS);
  const key = `${k}|${text}`;

  const existing = live.get(key);
  if (existing) { existing.restart(); return existing; }

  const root = toastRoot();
  const node = document.createElement('div');
  node.className = `toast ${k}`;
  if (k === 'error') node.setAttribute('role', 'alert');
  const msg = document.createElement('div');
  msg.className = 'toast-msg';
  msg.textContent = text;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn btn-sm';
  close.setAttribute('aria-label', 'Dismiss message');
  close.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  node.append(msg, close);

  let timer = null;
  let closed = false;
  let hover = false;
  const arm = () => {
    clearTimeout(timer);
    if (timeout > 0 && !hover) timer = setTimeout(handle.close, timeout);
  };
  const handle = {
    node,
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      live.delete(key);
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !node.isConnected) { node.remove(); return; }
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 160);
    },
    restart() {
      if (closed) return;
      root.append(node);       // move to the newest position
      arm();
    },
  };

  close.addEventListener('click', handle.close);
  node.addEventListener('pointerenter', () => { hover = true; clearTimeout(timer); });
  node.addEventListener('pointerleave', () => { hover = false; arm(); });
  node.addEventListener('focusin', () => { hover = true; clearTimeout(timer); });
  node.addEventListener('focusout', (e) => { if (!node.contains(e.relatedTarget)) { hover = false; arm(); } });

  live.set(key, handle);
  root.append(node);
  const shown = [...root.children].filter((c) => !c.classList.contains('leaving'));
  for (const old of shown.slice(0, Math.max(0, shown.length - MAX_TOASTS))) {
    const h = [...live.values()].find((x) => x.node === old);
    if (h) h.close(); else old.remove();
  }
  arm();
  return handle;
}
