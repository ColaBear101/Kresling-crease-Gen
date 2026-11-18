// Small shared helpers for UI modules.

/** Create an element: el('div', { class: 'x', onclick: fn, text: 'hi' }, child1, child2) */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** Run fn on the next animation frame, coalescing repeated calls. */
export function rafThrottle(fn) {
  let pending = false, lastArgs;
  return (...args) => {
    lastArgs = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...lastArgs); });
  };
}

/** Number formatting: fixed decimals, en dash for missing values, thin space before units. */
export function fmt(x, digits = 1, unit = '') {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  const s = Math.abs(x) >= 1e5 || (Math.abs(x) > 0 && Math.abs(x) < 10 ** -digits)
    ? x.toExponential(2)
    : x.toFixed(digits);
  return unit ? `${s} ${unit}` : s;
}

/** Engineering formatting with SI prefix, e.g. fmtSI(0.0042, 'N') -> "4.2 mN". */
export function fmtSI(x, unit = '', digits = 3) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  if (x === 0) return `0 ${unit}`;
  const pre = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
  const a = Math.abs(x);
  const [f, p] = pre.find(([f]) => a >= f) || pre[pre.length - 1];
  return `${Number((x / f).toPrecision(digits))} ${p}${unit}`;
}

export function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

/** Size a canvas to its CSS box at device pixel ratio; returns { ctx, w, h, dpr } in CSS pixels. */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

/** localStorage that never throws. */
export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

/**
 * Safe file-name stem from a design, e.g. "kresling_n6_d40_f6".
 * Adds "x2" for a stack, "_left" for a mirrored pattern and, with { scaled: true }
 * (files drawn at the print scale: pattern, DXF, molds), "_80pct" when the print
 * scale is not 100 %, so different prints of one design do not overwrite each other:
 * "kresling_n6_d40p5_f6x2_left_80pct".
 */
export function fileStem(params, opts = {}) {
  const parts = [`kresling_n${params.n}_d${String(params.dia).replace('.', 'p')}_f${params.floors}${params.stack > 1 ? `x${params.stack}` : ''}`];
  if (Number(params.chir) === -1) parts.push('left');
  if (opts.scaled && params.scale !== undefined && Number(params.scale) !== 100) parts.push(`${params.scale}pct`);
  return parts.join('_');
}
