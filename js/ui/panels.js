// Analysis panel: a summary strip plus Energy / Stiffness / Vibration /
// Buckling tabs (store.view.rightTab).
//
//   mountAnalysis(container, app) -> { update(change), resize(), setActive(active) }
//
// The energy chart is linked to the 3-D view: the vertical line is the current
// fold position (view.compress) and clicking or dragging on the chart moves it.
// Heavy analyses are debounced and only run for the visible tab.

import { el, fmt, fmtSI, debounce, fitCanvas, rafThrottle, clamp } from '../app/util.js';
import { cssVar } from './theme.js';
import { drawChart, autoRange } from '../render/chart.js';
import { energyAnalysis, strainCheck } from '../physics/analysis.js';
import { modalAnalysis, modalSweep } from '../physics/modal.js';
import { bucklingCheck } from '../physics/buckling.js';
import { thicknessSweep } from '../physics/sweeps.js';

const TABS = [['energy', 'Energy'], ['stiffness', 'Stiffness'], ['modal', 'Vibration'], ['buckling', 'Buckling']];
const DEG = 180 / Math.PI;
const KIND_LABEL = {
  axial: 'axial', torsional: 'torsion', 'axial-torsional': 'axial + twist',
  lateral: 'sideways', rocking: 'rocking', 'lateral-rocking': 'sway + rock',
};

function chip(kind, text, title) {
  return el('span', { class: `chip ${kind}`, title }, el('span', { class: 'dot', 'aria-hidden': 'true' }), text);
}

function kvRows(rows) {
  const box = el('dl', { class: 'kv an-kv' });
  for (const [k, v, cls] of rows) box.append(el('dt', { text: k }), el('dd', { class: `num ${cls || ''}`, text: v }));
  return box;
}

/** Floor height H shown in the 3-D view for a fold progress c (matches foldStates). */
function heightOfCompress(design, c) {
  const H0 = design.states.deployed.H;
  const H1 = design.states.folded.ok ? design.states.folded.H : 0.4 * H0;
  return H0 + (H1 - H0) * c;
}
function compressOfHeight(design, H) {
  const H0 = design.states.deployed.H;
  const H1 = design.states.folded.ok ? design.states.folded.H : 0.4 * H0;
  return clamp((H0 - H) / (H0 - H1), 0, 1);
}

export function mountAnalysis(container, app) {
  const { store } = app;
  let active = true;
  container.replaceChildren();
  container.classList.add('an');

  const summary = el('div', { class: 'an-summary', role: 'status', 'aria-live': 'polite' });
  const tabBar = el('div', { class: 'tabs an-tabs', role: 'tablist', 'aria-label': 'Analysis' });
  const panes = {};
  const tabBtns = {};
  for (const [key, label] of TABS) {
    const b = el('button', { type: 'button', class: 'tab', role: 'tab', id: `an-tab-${key}`, 'aria-controls': `an-pane-${key}`, text: label });
    b.addEventListener('click', () => store.setView({ rightTab: key }));
    b.addEventListener('keydown', (e) => {
      const keys = TABS.map((t) => t[0]);
      const i = keys.indexOf(key);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % keys.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + keys.length) % keys.length;
      if (j === null) return;
      e.preventDefault();
      store.setView({ rightTab: keys[j] });
      tabBtns[keys[j]].focus();
    });
    tabBtns[key] = b;
    tabBar.append(b);
    panes[key] = el('section', { class: 'an-pane scroll', role: 'tabpanel', id: `an-pane-${key}`, 'aria-labelledby': `an-tab-${key}` });
  }
  container.append(summary, tabBar, ...Object.values(panes));

  // ── shared state ──
  let design = store.design();
  let energy = null;
  let mode = { stack: false, parts: false };
  let hoverH = null;
  const dirty = { energy: true, stiffness: true, modal: true, buckling: true, summary: true };

  // ── summary strip ──
  function renderSummary() {
    summary.replaceChildren();
    if (!design.valid) { summary.append(chip('bad', 'No valid design', design.errors[0])); return; }
    const en = energyAnalysis(design);
    energy = en;
    if (!en.ok) { summary.append(chip('bad', 'Analysis unavailable', en.reason)); return; }
    if (en.bistable) summary.append(chip('ok', 'Snaps between two states', 'The energy has two wells: the tube stays deployed or folded on its own.'));
    else if (design.bistable) summary.append(chip('warn', 'Springs back', 'Two strain-free shapes exist, but the creases pull the folded one open: soften the creases (wider hinge, rest position nearer folded) or deepen the fold.'));
    else summary.append(chip('warn', 'Single stable state', 'Only the deployed shape is stable: it springs back after compression.'));
    if (en.bistable && en.snapForce) summary.append(el('span', { class: 'an-stat', title: 'Peak push needed to collapse one floor' }, el('span', { class: 'muted', text: 'Snap ' }), el('b', { class: 'num', text: fmt(en.snapForce.P, en.snapForce.P < 10 ? 2 : 1, 'N') })));
    if (en.bistable) summary.append(el('span', { class: 'an-stat', title: 'Energy barrier per floor, seen from the deployed state' }, el('span', { class: 'muted', text: 'Barrier ' }), el('b', { class: 'num', text: fmt(en.barrierFromDeployed, en.barrierFromDeployed < 10 ? 2 : 1, 'mJ') })));
    const sc = strainCheck(design);
    if (sc.ok) summary.append(chip(sc.pass ? 'ok' : 'warn', `Strain ${fmt(100 * sc.peak, 2)}% of ${fmt(100 * sc.limit, 1)}%`, sc.pass ? 'Peak panel stretch along the snap stays below the sheet limit.' : 'Snapping stretches the panels past the sheet limit: expect creasing or tearing.'));
    if (en.bistable) {
      const bk = bucklingCheck(design);
      if (bk.ok && bk.safety !== null) summary.append(chip(bk.pass ? 'ok' : 'bad', `Buckling ×${fmt(bk.safety, bk.safety < 10 ? 1 : 0)}`, `Critical load ÷ snap force. Required ${bk.required}.`));
    }
  }

  // ── energy tab ──
  const eTools = el('div', { class: 'an-tools' });
  const segStack = el('div', { class: 'seg', role: 'group', 'aria-label': 'Scale' });
  const btnFloor = el('button', { type: 'button', 'aria-pressed': 'true', text: 'Per floor' });
  const btnStack = el('button', { type: 'button', 'aria-pressed': 'false', text: 'Whole stack' });
  segStack.append(btnFloor, btnStack);
  const btnParts = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'aria-pressed': 'false', text: 'Show parts' });
  btnFloor.addEventListener('click', () => { mode.stack = false; syncTools(); drawEnergy(); });
  btnStack.addEventListener('click', () => { mode.stack = true; syncTools(); drawEnergy(); });
  btnParts.addEventListener('click', () => { mode.parts = !mode.parts; syncTools(); drawEnergy(); });
  function syncTools() {
    btnFloor.setAttribute('aria-pressed', String(!mode.stack));
    btnStack.setAttribute('aria-pressed', String(mode.stack));
    btnParts.setAttribute('aria-pressed', String(mode.parts));
  }
  eTools.append(segStack, btnParts);
  const eWrap = el('div', { class: 'an-chart an-chart-main' });
  const eCanvas = el('canvas', { 'aria-label': 'Energy and force versus floor height. Click to set the fold position.', role: 'img', tabindex: '0' });
  const eTip = el('div', { class: 'an-tip', hidden: true });
  eWrap.append(eCanvas, eTip);
  const eRead = el('div', { class: 'an-read' });
  const eNote = el('p', { class: 'an-note muted' });
  panes.energy.append(eTools, eWrap, eRead, eNote);
  let eChart = null;

  function energySpec() {
    const en = energy;
    const N = mode.stack ? en.floors : 1;
    // Stretching a floor past its deployed height costs orders of magnitude more
    // than the snap itself, so scale the axes on [0, deployed well] and let that
    // wall run off the top of the plot.
    const Hdep = en.deployed ? en.deployed.H : design.states.deployed.H;
    const xMax = Math.min(en.Hmax, Hdep * 1.08);
    let kEnd = en.H.length - 1;
    while (kEnd > 1 && en.H[kEnd] > xMax) kEnd--;
    let kFit = kEnd;
    while (kFit > 1 && en.H[kFit] > Hdep * 1.005) kFit--;
    const cut = (arr, k = kEnd) => arr.slice(0, k + 1);
    const H = cut(en.H).map((h) => h * N);
    const series = [
      { x: H, y: cut(en.E).map((e) => e * N), color: cssVar('--accent'), width: 2, fill: cssVar('--accent-soft'), label: mode.stack ? 'Energy, stack (mJ)' : 'Energy per floor (mJ)' },
      { x: H, y: cut(en.F).map((f) => -f), axis: 'y2', color: cssVar('--ink-2'), width: 1.4, dash: [5, 3], label: 'Push needed (N)' },
    ];
    if (mode.parts) {
      series.push({ x: H, y: cut(en.membrane).map((e) => e * N), color: cssVar('--valley'), width: 1.2, label: 'Panels' });
      series.push({ x: H, y: cut(en.hinge).map((e) => e * N), color: cssVar('--mountain'), width: 1.2, label: 'Creases' });
    }
    const fitSeries = series.map((s) => ({ ...s, x: s.x.slice(0, kFit + 1), y: s.y.slice(0, kFit + 1) }));
    const [y0, y1] = autoRange(fitSeries.filter((s) => !s.axis), 'y', 'y', { includeZero: true, pad: 0.12 });
    const [p0, p1] = autoRange(fitSeries.filter((s) => s.axis === 'y2'), 'y2', 'y', { pad: 0.12 });
    const pLo = Math.min(p0, -0.05 * Math.abs(p1)), pHi = Math.max(p1, 0.05 * Math.abs(p0));
    const markers = [];
    const bands = [];
    if (en.deployed) markers.push({ x: en.deployed.H * N, y: en.deployed.E * N, color: cssVar('--ok'), label: 'Deployed', place: 'below' });
    if (en.folded) markers.push({ x: en.folded.H * N, y: en.folded.E * N, color: cssVar('--ok'), label: 'Folded', place: 'below' });
    if (en.barrier) markers.push({ x: en.barrier.H * N, y: en.barrier.E * N, color: cssVar('--warn'), shape: 'diamond', label: `Barrier ${fmt(en.barrierFromDeployed * N, 1)} mJ` });
    if (en.snapForce) markers.push({ x: en.snapForce.H * N, y: en.snapForce.P, axis: 'y2', color: cssVar('--ink'), shape: 'ring', label: `Snap ${fmt(en.snapForce.P, 2)} N`, place: 'below' });
    if (en.folded && en.deployed) bands.push({ x0: en.folded.H * N, x1: en.deployed.H * N, color: cssVar('--surface-2') });
    const cur = heightOfCompress(design, store.view.compress) * N;
    return {
      x: { label: mode.stack ? 'Stack height (mm)' : 'Floor height (mm)', min: 0, max: en.H[kEnd] * N },
      y: { label: 'Energy (mJ)', min: y0, max: y1, color: cssVar('--accent') },
      y2: { label: 'Push (N)', min: pLo, max: pHi },
      series, markers, bands,
      vlines: [{ x: cur, color: cssVar('--mountain'), label: '3-D view' }],
      hoverX: hoverH === null ? null : hoverH * N,
    };
  }

  function drawEnergy() {
    if (!design.valid || !energy || !energy.ok) {
      const { ctx, w, h } = fitCanvas(eCanvas);
      ctx.clearRect(0, 0, w, h);
      return;
    }
    const { ctx, w, h } = fitCanvas(eCanvas);
    ctx.clearRect(0, 0, w, h);
    eChart = drawChart(ctx, w, h, energySpec());
  }

  function renderEnergy() {
    eRead.replaceChildren(); eNote.textContent = '';
    if (!design.valid) { energy = null; eRead.append(el('p', { class: 'empty-state', text: design.errors[0] })); drawEnergy(); return; }
    energy = energyAnalysis(design);
    if (!energy.ok) { eRead.append(el('p', { class: 'empty-state', text: energy.reason })); drawEnergy(); return; }
    const en = energy;
    const sc = strainCheck(design);
    const rows = [];
    if (en.bistable) {
      rows.push(['Barrier from deployed', fmt(en.barrierFromDeployed, 2, 'mJ')]);
      rows.push(['Barrier from folded', fmt(en.barrierFromFolded, 2, 'mJ')]);
      rows.push(['Snap force (push)', fmt(en.snapForce.P, 2, 'N')]);
      if (en.releaseForce) rows.push(['Release force (pull)', fmt(en.releaseForce.P, 2, 'N')]);
      rows.push(['Stable floor heights', `${fmt(en.folded.H, 1)} / ${fmt(en.deployed.H, 1)} mm`]);
    } else rows.push(['Stable floor height', en.deployed ? fmt(en.deployed.H, 1, 'mm') : '–']);
    if (sc.ok) rows.push(['Peak panel strain', `${fmt(100 * sc.peak, 2)}% (limit ${fmt(100 * sc.limit, 1)}%)`, sc.pass ? '' : 'warn']);
    rows.push(['Crease stiffness', fmtSI(design.material.kappa, 'N/rad')]);
    eRead.append(kvRows(rows));
    const panel = en.model.panel === 'thin'
      ? `Thin panels: compression past ${fmt(en.model.epsCr * 100, 3)}% strain wrinkles them instead of storing energy.`
      : 'Stiff panels: stretch only. This overstates forces for paper and film by orders of magnitude.';
    eNote.textContent = `Per floor, ends free to twist. ${panel} Crease rest position ${Math.round(en.model.restFrac * 100)}%. A stack of ${en.floors} floors snaps one floor at a time: the force stays the same and the energies add up.`;
    drawEnergy();
  }

  function energyAt(px) {
    if (!eChart || !energy || !energy.ok) return null;
    const N = mode.stack ? energy.floors : 1;
    const H = eChart.invertX(px) / N;
    if (!(H >= 0 && H <= energy.Hmax)) return null;
    if (px < eChart.plot.x || px > eChart.plot.x + eChart.plot.w) return null;
    const k = clamp(Math.round((H / energy.Hmax) * (energy.H.length - 1)), 0, energy.H.length - 1);
    return { H, k };
  }
  const moveTip = rafThrottle((ev) => {
    const r = eCanvas.getBoundingClientRect();
    const at = energyAt(ev.clientX - r.left);
    if (!at) { hoverH = null; eTip.hidden = true; drawEnergy(); return; }
    hoverH = energy.H[at.k];
    const en = energy, k = at.k, N = mode.stack ? en.floors : 1;
    eTip.replaceChildren(
      el('div', { class: 'num', text: `H ${fmt(en.H[k] * N, 2)} mm · twist ${fmt(en.phi[k] * DEG, 1)}°` }),
      el('div', { class: 'num', text: `E ${fmt(en.E[k] * N, 2)} mJ (panels ${fmt(en.membrane[k] * N, 2)}, creases ${fmt(en.hinge[k] * N, 2)})` }),
      el('div', { class: 'num', text: `push ${fmt(-en.F[k], 2)} N · strain ${fmt(100 * en.strain[k], 2)}%` }),
    );
    eTip.hidden = false;
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    eTip.style.left = `${Math.min(r.width - 230, x + 12)}px`;
    eTip.style.top = `${Math.max(4, y - 70)}px`;
    if (dragging) setCompressFrom(ev);
    drawEnergy();
  });
  let dragging = false;
  function setCompressFrom(ev) {
    const r = eCanvas.getBoundingClientRect();
    const at = energyAt(ev.clientX - r.left);
    if (!at || !design.valid) return;
    store.setView({ compress: Math.round(compressOfHeight(design, at.H) * 1000) / 1000 });
  }
  eCanvas.addEventListener('pointerdown', (ev) => { dragging = true; eCanvas.setPointerCapture(ev.pointerId); setCompressFrom(ev); });
  eCanvas.addEventListener('pointermove', moveTip);
  eCanvas.addEventListener('pointerup', () => { dragging = false; });
  eCanvas.addEventListener('pointercancel', () => { dragging = false; });
  eCanvas.addEventListener('pointerleave', () => { if (!dragging) { hoverH = null; eTip.hidden = true; drawEnergy(); } });
  eCanvas.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const d = (e.key === 'ArrowRight' ? -1 : 1) * (e.shiftKey ? 0.1 : 0.02);
    store.setView({ compress: clamp(Math.round((store.view.compress + d) * 1000) / 1000, 0, 1) });
  });

  // ── stiffness tab ──
  const sWrap1 = el('div', { class: 'an-chart' }, el('canvas', { role: 'img', 'aria-label': 'Crease and axial stiffness versus sheet thickness' }));
  const sWrap2 = el('div', { class: 'an-chart' }, el('canvas', { role: 'img', 'aria-label': 'Snap force and barrier versus sheet thickness' }));
  const sNote = el('p', { class: 'an-note muted' });
  panes.stiffness.append(el('h3', { class: 'section-label', text: 'Stiffness vs sheet thickness' }), sWrap1,
    el('h3', { class: 'section-label', text: 'Snap force and barrier vs thickness' }), sWrap2, sNote);
  let sweep = null;
  function drawStiffness() {
    for (const wrap of [sWrap1, sWrap2]) { const { ctx, w, h } = fitCanvas(wrap.firstChild); ctx.clearRect(0, 0, w, h); }
    if (!sweep || !sweep.ok) return;
    const t = sweep.t;
    const cur = [{ x: sweep.current, color: cssVar('--mountain'), label: 'current' }];
    {
      const { ctx, w, h } = fitCanvas(sWrap1.firstChild);
      const s1 = { x: t, y: sweep.kappa, color: cssVar('--accent'), width: 2, label: 'Crease κ (N/rad)' };
      const s2 = { x: t, y: sweep.kAxial, axis: 'y2', color: cssVar('--valley'), width: 1.6, dash: [5, 3], label: 'Axial, stack (N/mm)' };
      const [a0, a1] = autoRange([s1], 'y', 'y', { log: true });
      const [b0, b1] = autoRange([s2], 'y2', 'y', { log: true });
      drawChart(ctx, w, h, {
        x: { label: 'Thickness (µm)', min: t[0], max: t[t.length - 1], log: true },
        y: { label: 'κ (N/rad)', min: a0, max: a1, log: true, color: cssVar('--accent') },
        y2: { label: 'Axial (N/mm)', min: b0, max: b1, log: true },
        series: [s1, s2], vlines: cur,
      });
    }
    {
      const { ctx, w, h } = fitCanvas(sWrap2.firstChild);
      const s1 = { x: t, y: sweep.snap, color: cssVar('--ink'), width: 2, label: 'Snap force (N)' };
      const s2 = { x: t, y: sweep.barrier, axis: 'y2', color: cssVar('--accent'), width: 1.6, dash: [5, 3], label: 'Barrier (mJ)' };
      const bands = [];
      for (let i = 0; i < t.length; i++) {
        if (!sweep.bistable[i]) continue;
        const x0 = i > 0 ? Math.sqrt(t[i - 1] * t[i]) : t[i], x1 = i < t.length - 1 ? Math.sqrt(t[i] * t[i + 1]) : t[i];
        bands.push({ x0, x1, color: cssVar('--ok-soft') });
      }
      const anyPos = (arr) => arr.some((v) => v > 0);
      const [a0, a1] = anyPos(sweep.snap) ? autoRange([s1], 'y', 'y', { log: true }) : [0.01, 1];
      const [b0, b1] = anyPos(sweep.barrier) ? autoRange([s2], 'y2', 'y', { log: true }) : [0.01, 1];
      drawChart(ctx, w, h, {
        x: { label: 'Thickness (µm)', min: t[0], max: t[t.length - 1], log: true },
        y: { label: 'Snap (N)', min: a0, max: a1, log: true },
        y2: { label: 'Barrier (mJ)', min: b0, max: b1, log: true, color: cssVar('--accent') },
        series: [s1, s2], bands, vlines: cur,
      });
    }
  }
  function renderStiffness() {
    if (!design.valid) { sweep = null; sNote.textContent = design.errors[0]; drawStiffness(); return; }
    sweep = thicknessSweep(design);
    if (!sweep.ok) { sNote.textContent = sweep.reason; drawStiffness(); return; }
    const nb = sweep.bistable.filter(Boolean).length;
    sNote.textContent = `Shaded: thicknesses where the tube still snaps (${nb} of ${sweep.t.length}). Crease stiffness grows with t³; panels resist with t (stretch) and t³ (buckling), so geometry and the crease rest position decide most of the bistability.`;
    drawStiffness();
  }

  // ── vibration tab ──
  const mTable = el('div', { class: 'an-modes' });
  const mWrap = el('div', { class: 'an-chart' }, el('canvas', { role: 'img', 'aria-label': 'Lowest vibration frequencies versus deployed twist' }));
  const mNote = el('p', { class: 'an-note muted' });
  panes.modal.append(el('h3', { class: 'section-label', text: 'Vibration modes of one floor' }), mTable,
    el('h3', { class: 'section-label', text: 'Lowest frequencies vs deployed twist' }), mWrap, mNote);
  let msweep = null;
  function drawModal() {
    const { ctx, w, h } = fitCanvas(mWrap.firstChild);
    ctx.clearRect(0, 0, w, h);
    if (!msweep || !msweep.ok) return;
    const colors = {
      'deployed-axial': [cssVar('--accent'), []], 'deployed-offaxis': [cssVar('--accent'), [5, 3]],
      'folded-axial': [cssVar('--mountain'), []], 'folded-offaxis': [cssVar('--mountain'), [5, 3]],
    };
    const short = { 'deployed-axial': 'Deployed axial', 'deployed-offaxis': 'Deployed sway', 'folded-axial': 'Folded axial', 'folded-offaxis': 'Folded sway' };
    const series = msweep.series.map((s) => ({ x: msweep.x, y: s.y, color: colors[s.key][0], dash: colors[s.key][1], width: 1.6, label: short[s.key] || s.label }));
    const has = series.some((s) => s.y.some((v) => v > 0));
    const [y0, y1] = has ? autoRange(series, 'y', 'y', { log: true }) : [1, 10];
    drawChart(ctx, w, h, {
      x: { label: msweep.xLabel, min: msweep.x[0], max: msweep.x[msweep.x.length - 1] },
      y: { label: 'Frequency (Hz)', min: y0, max: y1, log: true },
      series, vlines: [{ x: msweep.current, color: cssVar('--ink-2'), dash: [3, 3], label: 'this design' }],
    });
  }
  function renderModal() {
    mTable.replaceChildren(); mNote.textContent = '';
    if (!design.valid) { mTable.append(el('p', { class: 'empty-state', text: design.errors[0] })); msweep = null; drawModal(); return; }
    const mo = modalAnalysis(design);
    if (!mo.ok) { mTable.append(el('p', { class: 'empty-state', text: mo.reason })); }
    else {
      const head = el('tr', {}, el('th', { scope: 'col', text: 'Mode' }), ...mo.states.map((s) => el('th', { scope: 'col', text: `${s.key === 'deployed' ? 'Deployed' : 'Folded'} (${fmt(s.H, 1)} mm)` })));
      const rows = [];
      for (let i = 0; i < 6; i++) {
        rows.push(el('tr', {}, el('th', { scope: 'row', class: 'num', text: String(i + 1) }),
          ...mo.states.map((s) => {
            const m = s.modes[i];
            return el('td', {}, el('span', { class: 'num', text: m ? fmt(m.f, m.f < 100 ? 1 : 0, 'Hz') : '–' }), m ? el('span', { class: 'an-kind muted', text: ` ${KIND_LABEL[m.kind] || m.kind}` }) : '');
          })));
      }
      mTable.append(el('table', { class: 'an-table' }, el('thead', {}, head), el('tbody', {}, ...rows)));
      const mass = mo.mass;
      mNote.textContent = `One floor, bottom ring clamped, top ring rigid and carrying ${fmt(design.params.payload, 1)} g plus ${fmt(mass.ring * 1000, 2)} g of sheet. Change "Top mass" under Analysis. ${(mo.notes || []).join(' ')}`;
    }
    msweep = modalSweep(design);
    drawModal();
  }

  // ── buckling tab ──
  const bBody = el('div', { class: 'an-buckle' });
  panes.buckling.append(bBody);
  function renderBuckling() {
    bBody.replaceChildren();
    if (!design.valid) { bBody.append(el('p', { class: 'empty-state', text: design.errors[0] })); return; }
    const bk = bucklingCheck(design);
    if (!bk.ok) { bBody.append(el('p', { class: 'empty-state', text: bk.reason })); return; }
    const end = { 'fixed-free': 'Fixed – free', pinned: 'Pinned – pinned', 'fixed-pinned': 'Fixed – pinned', 'fixed-fixed': 'Fixed – fixed' }[bk.endCond];
    const verdict = bk.safety === null
      ? chip('warn', 'No snap-through to compare', 'This design has a single stable state.')
      : chip(bk.pass ? 'ok' : 'bad', bk.pass ? `Safe: ×${fmt(bk.safety, 1)} (need ×${bk.required})` : `Buckles first: ×${fmt(bk.safety, 2)} (need ×${bk.required})`);
    bBody.append(el('div', { class: 'an-verdict' }, verdict));
    if (bk.snapP) {
      const max = Math.max(bk.Pcr, bk.snapP);
      const lg = max / Math.min(bk.Pcr, bk.snapP) > 30;
      const width = (v) => `${Math.max(2, lg ? (100 * Math.log10(1 + 9 * v / max)) : (100 * v) / max)}%`;
      bBody.append(el('div', { class: 'an-bars', role: 'img', 'aria-label': `Critical load ${fmt(bk.Pcr, 1)} newtons versus snap force ${fmt(bk.snapP, 2)} newtons` },
        el('div', { class: 'an-bar-row' }, el('span', { class: 'muted', text: 'Critical load' }), el('span', { class: 'an-bar ok', style: { width: width(bk.Pcr) } }), el('span', { class: 'num', text: fmtSI(bk.Pcr, 'N') })),
        el('div', { class: 'an-bar-row' }, el('span', { class: 'muted', text: 'Snap force' }), el('span', { class: 'an-bar', style: { width: width(bk.snapP) } }), el('span', { class: 'num', text: fmtSI(bk.snapP, 'N') })),
        lg ? el('p', { class: 'an-note muted', text: 'Bars on a log scale.' }) : ''));
    }
    bBody.append(kvRows([
      ['End supports', `${end} (K = ${bk.K})`],
      ['Column length', fmt(bk.length, 1, 'mm')],
      ['Bending stiffness EI', fmtSI(bk.EI / 1e6, 'N·m²')],
      ['Shear stiffness GA', Number.isFinite(bk.GA) ? fmtSI(bk.GA, 'N') : 'rigid'],
      ['Euler load', fmtSI(bk.Pe, 'N')],
      ['Critical load (with shear)', fmtSI(bk.Pcr, 'N')],
      ['Snap force', bk.snapP ? fmtSI(bk.snapP, 'N') : '–'],
    ]));
    bBody.append(el('ul', { class: 'an-notes' }, ...bk.notes.map((n) => el('li', { class: 'muted', text: n }))));
  }

  // ── orchestration ──
  const RENDER = { energy: renderEnergy, stiffness: renderStiffness, modal: renderModal, buckling: renderBuckling };
  const DRAW = { energy: drawEnergy, stiffness: drawStiffness, modal: drawModal, buckling: () => {} };
  function showTab() {
    const cur = store.view.rightTab in RENDER ? store.view.rightTab : 'energy';
    for (const [key] of TABS) {
      const on = key === cur;
      tabBtns[key].setAttribute('aria-selected', String(on));
      tabBtns[key].tabIndex = on ? 0 : -1;
      panes[key].hidden = !on;
    }
    return cur;
  }
  function refresh() {
    if (!active) return;
    const cur = showTab();
    if (dirty.summary) { dirty.summary = false; renderSummary(); }
    if (dirty[cur]) { dirty[cur] = false; RENDER[cur](); }
    else DRAW[cur]();
  }
  const refreshSoon = debounce(refresh, 90);
  const refreshSlow = debounce(refresh, 260);

  syncTools();
  refresh();

  return {
    update(change) {
      if (!change) return;
      if (change.kind === 'params') {
        design = store.design();
        if (!design.valid) energy = null;
        for (const k of Object.keys(dirty)) dirty[k] = true;
        const cur = store.view.rightTab;
        (cur === 'stiffness' || cur === 'modal' ? refreshSlow : refreshSoon)();
      } else if (change.kind === 'view') {
        if (change.keys.includes('rightTab')) refresh();
        else if (change.keys.includes('compress') && store.view.rightTab === 'energy') drawEnergy();
      } else if (change.kind === 'theme') {
        dirty.summary = true;
        refresh();
      }
    },
    resize() { if (active) DRAW[showTab()](); },
    setActive(on) { active = on; if (on) refresh(); },
  };
}
