// Sidebar: the design summary card (key numbers, errors, warnings, notes) and
// one collapsible group of controls per GROUPS entry, generated from SCHEMA.
//
//   mountControls(container, app) -> { update(change), resize(), setActive(active) }
//
// Range controls are a slider (sets params while dragging) plus a text field
// (commits on Enter, blur or change; Arrow keys step, Shift x10, Esc reverts).
// Controls are built once and patched in place, so focus and caret survive
// store updates; a field being typed into is never overwritten.
//
// Pure helpers (tested in Node): formatParam(value, step), parseNumber(text),
// stepDecimals(step), summaryRows(design), messagesOf(design), statusInfo(design).

import { el, fmt, fmtSI, storage, clamp } from '../app/util.js';
import { STORAGE_KEY } from '../app/store.js';
import { SCHEMA, GROUPS } from '../core/params.js';
import { foldedHeightWindow, bistableAngleWindow } from '../core/design.js';

const GROUPS_KEY = `${STORAGE_KEY}:groups`;
const DEFAULT_OPEN = { shape: true, floors: true, sheet: true, material: false, analysis: false, fab: false };

// ── pure helpers ───────────────────────────────────────────────────────────

/** Number of decimals implied by a step, e.g. 0.05 -> 2, 1 -> 0. */
export function stepDecimals(step) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Text for a parameter value: the step's decimals, or more if the value needs them (23.47 at step 0.1). */
export function formatParam(value, step = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const d = stepDecimals(step);
  const fixed = value.toFixed(d);
  if (Math.abs(Number(fixed) - value) < 1e-9) return fixed;
  return String(Number(value.toFixed(Math.min(6, d + 3))));
}

/** Parse what a user typed: accepts a decimal comma, a unicode minus and a trailing unit. NaN if not a number. */
export function parseNumber(text) {
  if (typeof text === 'number') return text;
  let t = String(text ?? '').trim().replace(/\s+/g, '').replace(/[−–]/g, '-');
  t = t.replace(/[a-zA-Zµ°%²³/]+$/u, '');
  if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

const nz = (x) => (x !== null && x !== undefined && Math.abs(x) < 1e-9 ? 0 : x);
function pair(a, b, digits, unit) {
  const u = unit === '°' ? '°' : ` ${unit}`;
  if (b === null || b === undefined) return `${fmt(nz(a), digits)}${u}`;
  return `${fmt(nz(a), digits)} → ${fmt(nz(b), digits)}${u}`;
}

/** Rows of the design summary card: [{ key, label, value, title }]. Values are '–' for invalid designs. */
export function summaryRows(design) {
  const v = Boolean(design && design.valid);
  const L = v ? design.lengths : null;
  const T = v ? design.twist : null;
  const I = v ? design.inner : null;
  const dash = '–';
  return [
    { key: 'length', label: 'Length', title: 'Whole stack, deployed → folded',
      value: v ? pair(L.deployed, L.folded, 1, 'mm') : dash },
    { key: 'stroke', label: 'Stroke', title: 'Deployed minus folded length, and as a share of the deployed length',
      value: v ? (L.stroke === null ? 'one stable state' : `${fmt(L.stroke, 1)} mm · ${fmt(100 * (1 - L.ratio), 0)} %`) : dash },
    { key: 'rotation', label: 'End rotation', title: 'Rotation of the top end against the bottom end, deployed → folded',
      value: v ? pair(T.endRotationDeployedDeg, T.endRotationFoldedDeg, 1, '°') : dash },
    { key: 'opening', label: 'Clear opening', title: 'Diameter of the free passage along the axis, deployed → folded',
      value: v ? pair(I.deployed, I.folded, 1, 'mm') : dash },
    { key: 'angle', label: 'Crease angle', title: 'Angle between a polygon fold and the short diagonal, as printed',
      value: v ? `${fmt(design.strip.angleDeg, 2)}°` : dash },
    { key: 'tolerance', label: 'Folded height per 1°', title: 'How far the folded floor height moves if the printed crease angle is off by one degree',
      value: v && design.tolerance ? `${fmt(design.tolerance.foldedPerDeg, 2)} mm` : dash },
    { key: 'mass', label: 'Sheet mass', title: 'Mass of the folding body (without seam strips and end rings)',
      value: v && design.sheet ? fmtSI(design.sheet.mass, 'g', 3) : dash },
  ];
}

/** Errors, warnings and notes as one list: [{ kind: 'bad'|'warn'|'note', label, text }]. */
export function messagesOf(design) {
  if (!design) return [];
  return [
    ...(design.errors || []).map((text) => ({ kind: 'bad', label: 'Error', text })),
    ...(design.warnings || []).map((text) => ({ kind: 'warn', label: 'Warning', text })),
    ...(design.notes || []).map((text) => ({ kind: 'note', label: 'Note', text })),
  ];
}

const STATUS = {
  bistable: { label: 'Bistable', kind: 'ok', desc: 'two stable states' },
  monostable: { label: 'Monostable', kind: 'warn', desc: 'one stable state' },
  invalid: { label: 'Invalid', kind: 'bad', desc: 'this design cannot be folded' },
};

/** Status chip content: { status, label, kind ('ok'|'warn'|'bad'), title, aria }. */
export function statusInfo(design) {
  const status = design && STATUS[design.status] ? design.status : 'invalid';
  const s = STATUS[status];
  const lines = [
    ...((design && design.errors) || []).map((t) => `Error: ${t}`),
    ...((design && design.warnings) || []).map((t) => `Warning: ${t}`),
  ];
  return {
    status, label: s.label, kind: s.kind,
    title: [`${s.label}: ${s.desc}.`, ...lines].join('\n'),
    aria: `Design status: ${s.label}, ${s.desc}.${lines.length ? ` ${lines.join(' ')}` : ''}`,
  };
}

// ── mount ──────────────────────────────────────────────────────────────────

export function mountControls(container, app) {
  const { store } = app;
  const controls = [];              // { s, type, root, ... }
  const byKey = new Map();
  const editing = new Set();        // keys whose text field holds uncommitted typing
  let msgSig = null;

  // ── summary card ──
  const kv = el('dl', { class: 'kv' });
  const rowEls = new Map();
  for (const r of summaryRows(store.design())) {
    const dt = el('dt', { text: r.label, title: r.title });
    const dd = el('dd', { text: r.value });
    rowEls.set(r.key, dd);
    kv.append(dt, dd);
  }
  const msgs = el('ul', { class: 'msgs', 'aria-label': 'Design messages' });
  const summary = el('section', { class: 'sb-summary', 'aria-labelledby': 'sb-summary-title' },
    el('div', { class: 'sb-summary-head' },
      el('h2', { class: 'section-label', id: 'sb-summary-title', text: 'Design summary' }),
      el('span', { class: 'muted', text: 'deployed → folded' })),
    kv, msgs);

  // ── groups ──
  const openState = { ...DEFAULT_OPEN, ...(storage.get(GROUPS_KEY, null) || {}) };
  const groupEls = [];
  for (const [gk, glabel] of GROUPS) {
    const body = el('div', { class: 'group-body' });
    for (const s of SCHEMA.filter((x) => x.group === gk)) {
      const c = s.type === 'range' ? buildRange(s) : s.type === 'select' ? buildSelect(s) : buildCheck(s);
      controls.push(c);
      byKey.set(s.key, c);
      body.append(c.root);
    }
    const det = el('details', { class: 'group', 'data-group': gk, open: openState[gk] ? true : undefined },
      el('summary', { text: glabel }), body);
    det.addEventListener('toggle', () => {
      if (openState[gk] === det.open) return;
      openState[gk] = det.open;
      storage.set(GROUPS_KEY, openState);
    });
    groupEls.push(det);
  }

  // ── design-window hints ──
  const hintH1 = el('p', { class: 'hint', id: 'hint-H1' });
  const angleText = el('span', { id: 'hint-angle' });
  const centreBtn = el('button', { type: 'button', class: 'btn btn-sm', text: 'Centre in bistable window' });
  const hintAngle = el('div', { class: 'hint' }, angleText, centreBtn);
  let winH1 = null, winH1Key = null, winAngle = null, winAngleKey = null;
  if (byKey.has('H1')) {
    const c = byKey.get('H1');
    c.root.append(hintH1);
    addDescribedBy(c.box, 'hint-H1');
  }
  if (byKey.has('angle')) {
    const c = byKey.get('angle');
    c.root.append(hintAngle);
    addDescribedBy(c.box, 'hint-angle');
  }
  centreBtn.addEventListener('click', () => {
    if (!winAngle) return;
    store.setParams({ angle: Math.round(winAngle.mid * 10) / 10 });
  });

  container.replaceChildren(summary, ...groupEls);
  sync(true);

  // ── builders ──
  function head(s, forId) {
    const labelId = `ctl-${s.key}-label`;
    const label = el('label', { for: forId, id: labelId, text: s.label });
    if (!s.help) return el('div', { class: 'ctl-head' }, label);
    const helpId = `ctl-${s.key}-help`;
    const btn = el('button', { type: 'button', class: 'help-btn', 'aria-label': `About ${s.label}`, 'aria-expanded': 'false', 'aria-describedby': helpId, text: 'i' });
    const tip = el('div', { class: 'tip', id: helpId, role: 'tooltip', text: s.help });
    btn.addEventListener('click', () => btn.setAttribute('aria-expanded', String(btn.getAttribute('aria-expanded') !== 'true')));
    btn.addEventListener('blur', () => btn.setAttribute('aria-expanded', 'false'));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        e.preventDefault(); e.stopPropagation();
        btn.setAttribute('aria-expanded', 'false');
      }
    });
    return el('div', { class: 'ctl-head' }, label, btn, tip);
  }

  function buildRange(s) {
    const id = `ctl-${s.key}`;
    const helpId = s.help ? `${id}-help` : null;
    const unitId = s.unit ? `${id}-unit` : null;
    const slider = el('input', {
      type: 'range', id: `${id}-slider`, min: s.min, max: s.max, step: s.step,
      'aria-labelledby': `${id}-label`, 'aria-describedby': helpId || undefined,
    });
    const box = el('input', {
      type: 'text', id, inputmode: s.step >= 1 ? 'numeric' : 'decimal', autocomplete: 'off', spellcheck: 'false',
      enterkeyhint: 'done', role: 'spinbutton', 'aria-valuemin': s.min, 'aria-valuemax': s.max,
      'aria-describedby': [unitId, helpId].filter(Boolean).join(' ') || undefined,
    });
    const numBox = el('span', { class: 'num-box' }, box, s.unit ? el('span', { class: 'unit', id: unitId, text: s.unit }) : null);
    const c = { s, type: 'range', slider, box, numBox };
    c.root = el('div', { class: 'ctl ctl-range', 'data-key': s.key }, head(s, id), el('div', { class: 'ctl-body' }, slider, numBox));

    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      setPct(c, v);
      store.setParams({ [s.key]: v });
    });
    box.addEventListener('input', () => editing.add(s.key));
    box.addEventListener('change', () => commit(c));
    box.addEventListener('blur', () => { if (editing.has(s.key)) commit(c); });
    box.addEventListener('focus', () => { if (!editing.has(s.key)) box.select(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(c); }
      else if (e.key === 'Escape' && editing.has(s.key)) {
        e.preventDefault(); e.stopPropagation();
        editing.delete(s.key);
        syncRange(c, store.params[s.key], true);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        nudge(c, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        nudge(c, e.key === 'PageUp' ? 1 : -1, 10);
      }
    });
    return c;
  }

  function buildSelect(s) {
    const id = `ctl-${s.key}`;
    const sel = el('select', { id, 'aria-describedby': s.help ? `${id}-help` : undefined },
      ...s.options.map(([value, label]) => el('option', { value: String(value), text: label })));
    sel.addEventListener('change', () => store.setParams({ [s.key]: sel.value }));
    const c = { s, type: 'select', sel };
    c.root = el('div', { class: 'ctl ctl-inline ctl-select', 'data-key': s.key }, head(s, id), sel);
    return c;
  }

  function buildCheck(s) {
    const id = `ctl-${s.key}`;
    const box = el('input', { type: 'checkbox', id, 'aria-describedby': s.help ? `${id}-help` : undefined });
    box.addEventListener('change', () => store.setParams({ [s.key]: box.checked }));
    const c = { s, type: 'check', box };
    c.root = el('div', { class: 'ctl ctl-inline ctl-check', 'data-key': s.key }, box, head(s, id));
    return c;
  }

  function addDescribedBy(node, id) {
    const cur = (node.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
    if (!cur.includes(id)) node.setAttribute('aria-describedby', [...cur, id].join(' '));
  }

  // ── editing ──
  function commit(c) {
    const { s, box } = c;
    editing.delete(s.key);
    const typed = box.value.trim();
    const raw = parseNumber(typed);
    if (!Number.isFinite(raw)) {
      if (typed) app.toast(`${s.label}: “${typed}” is not a number.`, 'warn');
      syncRange(c, store.params[s.key], true);
      return;
    }
    if (raw < s.min || raw > s.max) {
      const unit = s.unit ? (s.unit === '°' ? '°' : ` ${s.unit}`) : '';
      app.toast(`${s.label} is limited to ${formatParam(s.min, s.step)}–${formatParam(s.max, s.step)}${unit}.`, 'warn');
    }
    store.setParams({ [s.key]: clamp(raw, s.min, s.max) });
    syncRange(c, store.params[s.key], true);
  }

  function nudge(c, dir, mult) {
    const { s, box } = c;
    const typed = editing.has(s.key) ? parseNumber(box.value) : NaN;
    const base = Number.isFinite(typed) ? typed : store.params[s.key];
    const d = stepDecimals(s.step);
    let v = Math.round((base + dir * s.step * mult) / s.step) * s.step;
    v = clamp(Number(v.toFixed(d)), s.min, s.max);
    editing.delete(s.key);
    store.setParams({ [s.key]: v });
    syncRange(c, store.params[s.key], true);
  }

  // ── sync from the store ──
  function setPct(c, v) {
    const { min, max } = c.s;
    const pct = max > min ? clamp(((v - min) / (max - min)) * 100, 0, 100) : 0;
    c.slider.style.setProperty('--pct', `${pct.toFixed(2)}%`);
  }

  function syncRange(c, v, force = false) {
    const sv = String(v);
    if (c.slider.value !== sv) c.slider.value = sv;
    setPct(c, v);
    const typing = editing.has(c.s.key) && document.activeElement === c.box;
    if (force || !typing) {
      if (!typing) editing.delete(c.s.key);
      const txt = formatParam(v, c.s.step);
      if (c.box.value !== txt) c.box.value = txt;
    }
    c.box.setAttribute('aria-valuenow', sv);
    c.box.setAttribute('aria-valuetext', `${formatParam(v, c.s.step)}${c.s.unit ? ` ${c.s.unit}` : ''}`);
  }

  function syncControl(c, p) {
    const visible = !c.s.when || Boolean(c.s.when(p));
    if (c.root.hidden === visible) c.root.hidden = !visible;
    const v = p[c.s.key];
    if (c.type === 'range') syncRange(c, v);
    else if (c.type === 'select') { if (c.sel.value !== String(v)) c.sel.value = String(v); }
    else if (c.box.checked !== Boolean(v)) c.box.checked = Boolean(v);
  }

  function syncHints(p) {
    const R = p.dia / 2;
    if (p.designBy === 'heights') {
      const key = `${p.n}|${p.dia}|${p.H0}`;
      if (key !== winH1Key) { winH1Key = key; winH1 = foldedHeightWindow(p.n, R, p.H0); }
      const lo = winH1.min < 1e-3 ? 0 : winH1.min;
      const ok = p.H1 + 2e-6 >= winH1.min && p.H1 < p.H0;
      hintH1.className = ok ? 'hint' : 'hint bad';
      hintH1.replaceChildren(
        ok ? 'Both states exist for' : 'Outside the window: both states need',
        ' ', el('span', { class: 'num', text: `${lo === 0 ? '0' : fmt(lo, 2)} ≤ H1 < ${fmt(p.H0, 2)} mm` }));
    } else {
      const key = `${p.n}|${p.dia}|${p.hFlat}`;
      if (key !== winAngleKey) { winAngleKey = key; winAngle = bistableAngleWindow(p.n, R, p.hFlat); }
      if (winAngle) {
        const inside = p.angle >= winAngle.lo - 1e-9 && p.angle <= winAngle.hi + 1e-9;
        hintAngle.className = inside ? 'hint' : 'hint bad';
        angleText.replaceChildren(inside ? 'Bistable for' : 'Bistable only for', ' ',
          el('span', { class: 'num', text: `${fmt(winAngle.lo, 1)}° – ${fmt(winAngle.hi, 1)}°` }));
        centreBtn.disabled = Math.abs(p.angle - Math.round(winAngle.mid * 10) / 10) < 1e-9;
      } else {
        hintAngle.className = 'hint bad';
        angleText.textContent = 'No crease angle gives two stable states at this strip height and diameter.';
        centreBtn.disabled = true;
      }
    }
  }

  function syncSummary() {
    const d = store.design();
    for (const r of summaryRows(d)) {
      const dd = rowEls.get(r.key);
      if (dd && dd.textContent !== r.value) dd.textContent = r.value;
    }
    const list = messagesOf(d);
    const sig = list.map((m) => `${m.kind}:${m.text}`).join('\n');
    if (sig === msgSig) return;
    msgSig = sig;
    msgs.replaceChildren(...list.map((m) => el('li', { class: `msg ${m.kind}` },
      el('span', { class: `badge ${m.kind === 'note' ? '' : m.kind}`.trim(), text: m.label }),
      el('span', { text: m.text }))));
    msgs.hidden = list.length === 0;
  }

  function sync() {
    const p = store.params;
    for (const c of controls) syncControl(c, p);
    syncHints(p);
    syncSummary();
  }

  return {
    update(change) { if (change && change.kind === 'params') sync(); },
    resize() {},
    setActive() {},
  };
}
