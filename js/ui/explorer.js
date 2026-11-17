// Design explorer: scan two parameters over a grid, check requirements, load a cell.
//
//   mountExplorer(container, app) -> { update(change), resize(), setActive(active) }
//
// Everything not on an axis comes from the current design. Cells are
// evaluated in ~10 ms slices so the page stays responsive; results go stale
// (and say so) when the design changes.

import { el, fmt, storage, fitCanvas, rafThrottle, clamp } from '../app/util.js';
import { cssVar } from './theme.js';
import { axisTicks, tickFormat } from '../render/chart.js';
import { EXPLORE_AXES, evaluateDesign } from '../physics/explore.js';

const KEY = 'kresling-studio:v1:explorer';
const MAX_STEPS = 40;
const METRICS = [
  ['score', 'Requirements met'],
  ['snapP', 'Snap force (N)'],
  ['barrier', 'Barrier (mJ/floor)'],
  ['ratio', 'Folded / deployed length'],
  ['safety', 'Buckling safety factor'],
];
const REQS = [
  ['bistable', 'Snaps between two stable states'],
  ['buckling', 'Does not buckle before snapping'],
  ['fits', 'Fits one page at the current scale'],
  ['strain', 'Panel strain within the sheet limit'],
];

function axisDefault(axis, value) {
  const span = axis.max - axis.min;
  let lo = value - span * 0.15, hi = value + span * 0.15;
  if (axis.key === 'n') { lo = Math.max(3, value - 3); hi = Math.min(axis.max, value + 4); }
  if (axis.key === 'floors') { lo = Math.max(1, value - 3); hi = Math.min(axis.max, value + 4); }
  lo = clamp(lo, axis.min, axis.max); hi = clamp(hi, axis.min, axis.max);
  if (axis.integer) { lo = Math.round(lo); hi = Math.round(hi); }
  else { lo = Number(lo.toPrecision(3)); hi = Number(hi.toPrecision(3)); }
  return { min: lo, max: hi, steps: axis.integer ? Math.min(12, hi - lo + 1) : 12 };
}

function values(axis, min, max, steps) {
  const n = clamp(Math.round(steps), 1, MAX_STEPS);
  const out = [];
  for (let i = 0; i < n; i++) {
    let v = n === 1 ? min : min + ((max - min) * i) / (n - 1);
    if (axis.integer) v = Math.round(v);
    else v = Number(v.toPrecision(5));
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export function mountExplorer(container, app) {
  const { store } = app;
  let active = false;
  container.replaceChildren();
  container.classList.add('ex');

  const saved = storage.get(KEY, {}) || {};
  const state = {
    x: saved.x || 'n', y: saved.y || 'H1',
    ranges: saved.ranges || {},
    req: { bistable: true, buckling: true, fits: true, strain: false, ...(saved.req || {}) },
    safety: Number.isFinite(saved.safety) ? saved.safety : null,
    metric: saved.metric || 'score',
  };
  let result = null;        // { xs, ys, cells, xKey, yKey, stale, base }
  let job = null;
  let hover = null;

  const persist = () => storage.set(KEY, { x: state.x, y: state.y, ranges: state.ranges, req: state.req, safety: state.safety, metric: state.metric });
  const axesFor = () => EXPLORE_AXES.filter((a) => a.modes.includes(store.params.designBy));
  const axisOf = (key) => EXPLORE_AXES.find((a) => a.key === key);
  function rangeOf(key) {
    const ax = axisOf(key);
    if (!state.ranges[key]) state.ranges[key] = axisDefault(ax, store.params[key]);
    return state.ranges[key];
  }

  // ── form ──
  const summary = el('p', { class: 'ex-context muted' });
  const axisBlock = (which) => {
    const sel = el('select', { id: `ex-${which}-axis`, 'aria-label': `${which.toUpperCase()} axis parameter` });
    const min = el('input', { type: 'number', id: `ex-${which}-min`, 'aria-label': 'From', step: 'any' });
    const max = el('input', { type: 'number', id: `ex-${which}-max`, 'aria-label': 'To', step: 'any' });
    const steps = el('input', { type: 'number', id: `ex-${which}-steps`, 'aria-label': 'Steps', min: '1', max: String(MAX_STEPS), step: '1' });
    sel.addEventListener('change', () => { state[which] = sel.value; syncForm(); persist(); });
    const commit = () => {
      const r = rangeOf(state[which]);
      const ax = axisOf(state[which]);
      const a = Number(min.value), b = Number(max.value), s = Number(steps.value);
      if (Number.isFinite(a)) r.min = clamp(a, ax.min, ax.max);
      if (Number.isFinite(b)) r.max = clamp(b, ax.min, ax.max);
      if (Number.isFinite(s)) r.steps = clamp(Math.round(s), 1, MAX_STEPS);
      syncForm(); persist();
    };
    for (const inp of [min, max, steps]) inp.addEventListener('change', commit);
    const box = el('fieldset', { class: 'ex-axis' },
      el('legend', { class: 'section-label', text: `${which.toUpperCase()} axis` }), sel,
      el('div', { class: 'ex-range' }, el('label', { for: min.id, class: 'muted', text: 'from' }), min,
        el('label', { for: max.id, class: 'muted', text: 'to' }), max,
        el('label', { for: steps.id, class: 'muted', text: 'steps' }), steps));
    return { box, sel, min, max, steps };
  };
  const X = axisBlock('x'), Y = axisBlock('y');

  const reqBox = el('fieldset', { class: 'ex-reqs' }, el('legend', { class: 'section-label', text: 'Requirements' }));
  const reqInputs = {};
  for (const [key, label] of REQS) {
    const cb = el('input', { type: 'checkbox', id: `ex-req-${key}` });
    cb.addEventListener('change', () => { state.req[key] = cb.checked; persist(); markStale(); });
    reqInputs[key] = cb;
    reqBox.append(el('label', { class: 'ex-check', for: cb.id }, cb, label));
  }
  const sfInput = el('input', { type: 'number', id: 'ex-safety', min: '1', max: '10', step: '0.1', 'aria-label': 'Required safety factor' });
  sfInput.addEventListener('change', () => { const v = Number(sfInput.value); state.safety = Number.isFinite(v) ? clamp(v, 1, 10) : null; persist(); markStale(); });
  reqBox.append(el('div', { class: 'ex-sf' }, el('label', { for: 'ex-safety', class: 'muted', text: 'Safety factor ×' }), sfInput));

  const metricSel = el('select', { id: 'ex-metric', 'aria-label': 'Colour cells by' }, ...METRICS.map(([v, t]) => el('option', { value: v, text: t })));
  metricSel.addEventListener('change', () => { state.metric = metricSel.value; persist(); draw(); renderList(); });

  const runBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'Run scan' });
  const cancelBtn = el('button', { type: 'button', class: 'btn', text: 'Cancel', hidden: true });
  const progress = el('div', { class: 'ex-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', hidden: true }, el('span'));
  const status = el('p', { class: 'ex-status muted', role: 'status' });
  runBtn.addEventListener('click', run);
  cancelBtn.addEventListener('click', () => { if (job) job.cancelled = true; });

  const form = el('form', { class: 'ex-form' }, el('h2', { class: 'ex-title', text: 'Explore designs' }), summary,
    X.box, Y.box, reqBox,
    el('div', { class: 'ex-colour' }, el('label', { for: 'ex-metric', class: 'section-label', text: 'Colour by' }), metricSel),
    el('div', { class: 'ex-run' }, runBtn, cancelBtn), progress, status);
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });

  // ── results ──
  const canvas = el('canvas', { class: 'ex-canvas', role: 'img', 'aria-label': 'Explorer heatmap. Click a cell to load that design.', tabindex: '0' });
  const tip = el('div', { class: 'ex-tip', hidden: true });
  const empty = el('div', { class: 'empty-state ex-empty' }, el('strong', { text: 'Scan two parameters at once' }),
    el('span', { class: 'muted', text: 'Pick the axes and requirements, then run the scan. Click any cell to load that design.' }));
  const plot = el('div', { class: 'ex-plot' }, canvas, tip, empty);
  const legend = el('div', { class: 'ex-legend' });
  const listHead = el('div', { class: 'ex-list-head' }, el('h3', { class: 'section-label', text: 'Designs that meet every requirement' }));
  const sortSel = el('select', { 'aria-label': 'Sort candidates' },
    el('option', { value: 'snapP', text: 'Lowest snap force' }),
    el('option', { value: 'stroke', text: 'Longest stroke' }),
    el('option', { value: 'safety', text: 'Highest safety factor' }));
  sortSel.addEventListener('change', renderList);
  listHead.append(sortSel);
  const list = el('ol', { class: 'ex-list' });
  const results = el('div', { class: 'ex-results' }, plot, legend, listHead, list);
  container.append(el('div', { class: 'ex-layout scroll' }, form, results));

  function syncForm() {
    const axes = axesFor();
    if (!axes.some((a) => a.key === state.x)) state.x = axes[0].key;
    if (!axes.some((a) => a.key === state.y) || state.y === state.x) state.y = axes.find((a) => a.key !== state.x).key;
    for (const [blk, which] of [[X, 'x'], [Y, 'y']]) {
      const other = which === 'x' ? state.y : state.x;
      blk.sel.replaceChildren(...axes.filter((a) => a.key !== other).map((a) => el('option', { value: a.key, text: a.unit ? `${a.label} (${a.unit})` : a.label })));
      blk.sel.value = state[which];
      const r = rangeOf(state[which]);
      const ax = axisOf(state[which]);
      for (const inp of [blk.min, blk.max]) { inp.min = ax.min; inp.max = ax.max; inp.step = ax.integer ? '1' : 'any'; }
      blk.min.value = r.min; blk.max.value = r.max; blk.steps.value = r.steps;
    }
    for (const [key] of REQS) reqInputs[key].checked = Boolean(state.req[key]);
    sfInput.value = state.safety ?? store.params.safety;
    sfInput.disabled = !state.req.buckling;
    metricSel.value = state.metric;
    const p = store.params;
    summary.textContent = `Everything else comes from the current design: n = ${p.n}, Ø ${p.dia} mm, ${p.floors * p.stack} floors, ${p.thick} µm ${p.material === 'custom' ? 'custom sheet' : 'sheet'}.`;
  }

  function markStale() {
    if (result && !result.stale) { result.stale = true; status.textContent = 'The design changed since this scan. Run it again to update.'; draw(); }
  }

  function run() {
    if (job) return;
    const xAx = axisOf(state.x), yAx = axisOf(state.y);
    const rx = rangeOf(state.x), ry = rangeOf(state.y);
    const xs = values(xAx, Math.min(rx.min, rx.max), Math.max(rx.min, rx.max), rx.steps);
    const ys = values(yAx, Math.min(ry.min, ry.max), Math.max(ry.min, ry.max), ry.steps);
    const base = { ...store.params };
    const req = { ...state.req, safety: state.safety ?? base.safety };
    const cells = new Array(xs.length * ys.length).fill(null);
    result = { xs, ys, cells, xKey: state.x, yKey: state.y, stale: false, base, req };
    job = { i: 0, cancelled: false, t0: performance.now() };
    runBtn.disabled = true; cancelBtn.hidden = false; progress.hidden = false;
    empty.hidden = true;
    const total = cells.length;
    const step = () => {
      if (!job) return;
      if (job.cancelled) { finish(`Cancelled after ${job.i} of ${total} designs.`); return; }
      const until = performance.now() + 10;
      while (job.i < total && performance.now() < until) {
        const i = job.i++;
        const xi = i % xs.length, yi = Math.floor(i / xs.length);
        try {
          cells[i] = evaluateDesign({ ...base, [state.x]: xs[xi], [state.y]: ys[yi] }, req);
        } catch (e) {
          cells[i] = { valid: false, status: 'invalid', reason: String(e && e.message ? e.message : e), meets: {}, score: 0, total: 0 };
        }
      }
      const pct = Math.round((100 * job.i) / total);
      progress.firstChild.style.width = `${pct}%`;
      progress.setAttribute('aria-valuenow', String(pct));
      status.textContent = `${job.i} of ${total} designs · ${((performance.now() - job.t0) / 1000).toFixed(1)} s`;
      draw();
      if (job.i >= total) finish(null);
      else setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  function finish(msg) {
    const secs = job ? ((performance.now() - job.t0) / 1000).toFixed(1) : '0';
    job = null;
    runBtn.disabled = false; cancelBtn.hidden = true; progress.hidden = true;
    const ok = result ? result.cells.filter((c) => c && c.valid && c.score === c.total && c.total > 0).length : 0;
    status.textContent = msg || `${result.cells.length} designs in ${secs} s · ${ok} meet every requirement.`;
    draw();
    renderList();
  }

  // ── drawing ──
  let geo = null;
  function metricValue(c) {
    if (!c || !c.valid) return null;
    if (state.metric === 'score') return c.total ? c.score / c.total : (c.bistable ? 1 : 0);
    const v = c[state.metric];
    return v === null || v === undefined || !Number.isFinite(v) ? null : v;
  }
  function colourScale(vals) {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const a = cssVar('--accent-soft'), b = cssVar('--accent');
    return (v) => mix(a, b, hi > lo ? (v - lo) / (hi - lo) : 1);
  }
  function draw() {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    legend.replaceChildren();
    if (!result) { geo = null; return; }
    const { xs, ys, cells } = result;
    const mono = cssVar('--font-mono');
    ctx.font = `10.5px ${mono}`;
    const left = 52, bottom = 36, top = 10, right = 12;
    const pw = Math.max(20, w - left - right), ph = Math.max(20, h - top - bottom);
    const cw = pw / xs.length, ch = ph / ys.length;
    geo = { left, top, cw, ch, pw, ph };
    const nums = state.metric === 'score' ? null : cells.map(metricValue).filter((v) => v !== null);
    const scale = nums && nums.length ? colourScale(nums) : null;
    const hatch = cssVar('--surface-3');
    for (let yi = 0; yi < ys.length; yi++) {
      for (let xi = 0; xi < xs.length; xi++) {
        const c = cells[yi * xs.length + xi];
        const x0 = left + xi * cw, y0 = top + (ys.length - 1 - yi) * ch;
        if (!c) { ctx.fillStyle = cssVar('--surface-2'); ctx.fillRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1); continue; }
        if (!c.valid) {
          ctx.fillStyle = hatch; ctx.fillRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);
          ctx.strokeStyle = cssVar('--line-strong'); ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(x0 + 2, y0 + ch - 2); ctx.lineTo(x0 + cw - 2, y0 + 2); ctx.stroke();
          continue;
        }
        let fill;
        if (state.metric === 'score') {
          const f = c.total ? c.score / c.total : 1;
          fill = f >= 1 ? cssVar('--ok') : f >= 0.5 ? cssVar('--warn-soft') : cssVar('--bad-soft');
          if (f >= 1) fill = mix(cssVar('--ok-soft'), cssVar('--ok'), 0.75);
        } else {
          const v = metricValue(c);
          fill = v === null ? cssVar('--surface-2') : scale(v);
        }
        ctx.fillStyle = fill;
        ctx.fillRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);
        if (state.metric !== 'score' && c.total && c.score < c.total) {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(x0 + 0.5, y0 + ch - 4, cw - 1, 3.5);
        }
      }
    }
    if (result.stale) { ctx.fillStyle = 'rgba(128,128,128,0.25)'; ctx.fillRect(left, top, pw, ph); }
    // current design marker
    const p = store.params;
    const cx = xs.length > 1 ? left + ((p[result.xKey] - xs[0]) / (xs[xs.length - 1] - xs[0])) * (pw - cw) + cw / 2 : left + cw / 2;
    const cy = ys.length > 1 ? top + ph - (((p[result.yKey] - ys[0]) / (ys[ys.length - 1] - ys[0])) * (ph - ch) + ch / 2) : top + ph / 2;
    if (cx >= left && cx <= left + pw && cy >= top && cy <= top + ph) {
      ctx.strokeStyle = cssVar('--mountain'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(4, Math.min(cw, ch) * 0.28), 0, Math.PI * 2); ctx.stroke();
    }
    if (hover) {
      ctx.strokeStyle = cssVar('--ink'); ctx.lineWidth = 2;
      ctx.strokeRect(left + hover.xi * cw + 1, top + (ys.length - 1 - hover.yi) * ch + 1, cw - 2, ch - 2);
    }
    // axes
    const xAx = axisOf(result.xKey), yAx = axisOf(result.yKey);
    ctx.fillStyle = cssVar('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xt = xs.length <= 12 ? xs : axisTicks(xs[0], xs[xs.length - 1], false, 6);
    for (const v of xt) {
      const px = xs.length > 1 ? left + ((v - xs[0]) / (xs[xs.length - 1] - xs[0])) * (pw - cw) + cw / 2 : left + cw / 2;
      ctx.fillText(tickFormat(v), px, top + ph + 4);
    }
    ctx.fillStyle = cssVar('--ink-3');
    ctx.fillText(xAx.unit ? `${xAx.label} (${xAx.unit})` : xAx.label, left + pw / 2, top + ph + 19);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = cssVar('--ink-2');
    const yt = ys.length <= 12 ? ys : axisTicks(ys[0], ys[ys.length - 1], false, 6);
    for (const v of yt) {
      const py = ys.length > 1 ? top + ph - (((v - ys[0]) / (ys[ys.length - 1] - ys[0])) * (ph - ch) + ch / 2) : top + ph / 2;
      ctx.fillText(tickFormat(v), left - 6, py);
    }
    ctx.save(); ctx.translate(11, top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = cssVar('--ink-3');
    ctx.fillText(yAx.unit ? `${yAx.label} (${yAx.unit})` : yAx.label, 0, 0); ctx.restore();
    // legend
    const sw = (color, text) => el('span', { class: 'ex-key' }, el('i', { style: { background: color } }), text);
    if (state.metric === 'score') {
      legend.append(sw(mix(cssVar('--ok-soft'), cssVar('--ok'), 0.75), 'meets all'), sw(cssVar('--warn-soft'), 'meets some'),
        sw(cssVar('--bad-soft'), 'meets few or none'), sw(hatch, 'invalid geometry'));
    } else if (nums && nums.length) {
      legend.append(sw(cssVar('--accent-soft'), `${fmt(Math.min(...nums), 2)}`), sw(cssVar('--accent'), `${fmt(Math.max(...nums), 2)}`),
        sw(hatch, 'invalid'), el('span', { class: 'ex-key muted', text: 'dark strip = misses a requirement' }));
    }
    legend.append(el('span', { class: 'ex-key' }, el('i', { class: 'ex-ring' }), 'current design'));
  }

  function cellAt(ev) {
    if (!geo || !result) return null;
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const xi = Math.floor((x - geo.left) / geo.cw), yr = Math.floor((y - geo.top) / geo.ch);
    if (xi < 0 || xi >= result.xs.length || yr < 0 || yr >= result.ys.length) return null;
    const yi = result.ys.length - 1 - yr;
    return { xi, yi, c: result.cells[yi * result.xs.length + xi], x, y, w: r.width };
  }
  const onMove = rafThrottle((ev) => {
    const at = cellAt(ev);
    if (!at || !at.c) { hover = null; tip.hidden = true; draw(); return; }
    hover = { xi: at.xi, yi: at.yi };
    const c = at.c, xAx = axisOf(result.xKey), yAx = axisOf(result.yKey);
    const lines = [`${xAx.label} ${result.xs[at.xi]}${xAx.unit ? ` ${xAx.unit}` : ''} · ${yAx.label} ${result.ys[at.yi]}${yAx.unit ? ` ${yAx.unit}` : ''}`];
    if (!c.valid) lines.push(c.reason || 'Invalid geometry');
    else {
      lines.push(c.bistable ? `Snaps: ${fmt(c.snapP, 2)} N, barrier ${fmt(c.barrier, 1)} mJ` : 'Single stable state');
      if (c.ratio !== null) lines.push(`Folded/deployed ${fmt(c.ratio, 2)} · stroke ${fmt(c.stroke, 1)} mm`);
      if (c.safety !== null) lines.push(`Buckling safety ×${fmt(c.safety, 1)}`);
      if (c.peakStrain !== null) lines.push(`Peak strain ${fmt(100 * c.peakStrain, 2)}%`);
      lines.push(`${c.score} of ${c.total} requirements · click to load`);
    }
    tip.replaceChildren(...lines.map((t) => el('div', { text: t })));
    tip.hidden = false;
    tip.style.left = `${Math.min(at.w - 250, at.x + 12)}px`;
    tip.style.top = `${Math.max(4, at.y - 20)}px`;
    draw();
  });
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; draw(); });
  canvas.addEventListener('click', (ev) => {
    const at = cellAt(ev);
    if (!at || !at.c) return;
    load(result.xs[at.xi], result.ys[at.yi], at.c);
  });

  function load(xv, yv, c) {
    const xAx = axisOf(result.xKey), yAx = axisOf(result.yKey);
    store.setParams({ [result.xKey]: xv, [result.yKey]: yv });
    app.toast(`Loaded ${xAx.label.toLowerCase()} ${xv}${xAx.unit ? ` ${xAx.unit}` : ''}, ${yAx.label.toLowerCase()} ${yv}${yAx.unit ? ` ${yAx.unit}` : ''}.${c && !c.valid ? ' That design is invalid.' : ''}`, c && c.valid ? 'ok' : 'warn');
  }

  function renderList() {
    list.replaceChildren();
    if (!result) return;
    const rows = [];
    result.cells.forEach((c, i) => {
      if (!c || !c.valid || c.total === 0 || c.score < c.total) return;
      rows.push({ c, x: result.xs[i % result.xs.length], y: result.ys[Math.floor(i / result.xs.length)] });
    });
    const key = sortSel.value;
    const v = (r) => (key === 'stroke' ? -(r.c.stroke ?? -Infinity) : key === 'safety' ? -(r.c.safety ?? -Infinity) : (r.c.snapP ?? Infinity));
    rows.sort((a, b) => v(a) - v(b));
    if (!rows.length) { list.append(el('li', { class: 'muted ex-none', text: 'No design in this scan meets every requirement. Widen the ranges or relax a requirement.' })); return; }
    const xAx = axisOf(result.xKey), yAx = axisOf(result.yKey);
    for (const r of rows.slice(0, 8)) {
      const btn = el('button', { type: 'button', class: 'btn btn-sm', text: 'Load' });
      btn.addEventListener('click', () => load(r.x, r.y, r.c));
      list.append(el('li', { class: 'ex-item' },
        el('span', { class: 'num', text: `${xAx.label} ${r.x} · ${yAx.label} ${r.y}` }),
        el('span', { class: 'muted num', text: `${r.c.snapP !== null ? `${fmt(r.c.snapP, 2)} N` : '–'} · stroke ${fmt(r.c.stroke, 0)} mm${r.c.safety !== null ? ` · ×${fmt(r.c.safety, 1)}` : ''}` }),
        btn));
    }
  }

  syncForm();
  return {
    update(change) {
      if (!change) return;
      if (change.kind === 'params') {
        syncForm();
        if (result && change.keys.some((k) => k !== result.xKey && k !== result.yKey)) markStale();
        else draw();
      } else if (change.kind === 'theme') draw();
    },
    resize() { if (active) draw(); },
    setActive(on) { active = on; if (on) { syncForm(); draw(); } },
  };
}

function parseColour(c) {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1, 7);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(',').slice(0, 3).map((x) => Number(x));
  return [128, 128, 128];
}
function mix(a, b, t) {
  const A = parseColour(a), B = parseColour(b);
  const k = clamp(t, 0, 1);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(', ')})`;
}
