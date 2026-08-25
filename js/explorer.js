import { computeGeometry, patternBounds } from './geometry.js';
import { bucklingCheck } from './buckling.js';
import { A4_W, A4_H } from './constants.js';
import { getP, showToast } from './ui.js';

// ─── Design Explorer ─────────────────────────────────────────────────────────
// A requirements-in, possibilities-out grid search over two chosen design
// axes (default: sides n × angle, the pair the bistability window in
// geometry.js is defined over), scoring every grid point against:
//   • valid flat-pattern geometry (geometry.js:valid)
//   • bistability, if required (Cai et al. 2015 criterion)
//   • buckling safety, if required (js/buckling.js — Euler column + local
//     shell buckling vs. snap-through force, standard shell theory, not
//     itself one of the Kresling-specific cited sources)
//   • A4 sheet fit, if required
// Not a new physics model — it's a search over the models already in the
// app, scanning what the sidebar can only explore one point at a time.

const AXIS_DEFS = {
  n:     { label: 'Sides (n)',        integer: true,  defMin: 3,  defMax: 14,  defSteps: 12 },
  angle: { label: 'Angle BR (\u00b0)', integer: false, defMin: 70, defMax: 135, defSteps: 48 },
  dia:   { label: 'Diameter (cm)',    integer: false, defMin: 1,  defMax: 10,  defSteps: 40 },
  thick: { label: 'Thickness (\u00b5m)', integer: false, defMin: 10, defMax: 120, defSteps: 40 },
};

let lastResult = null; // { xs, ys, xKey, yKey, grid, fixed, req }

function axisValues(key, min, max, steps) {
  const def = AXIS_DEFS[key];
  const vals = [];
  if (def.integer) {
    for (let v = Math.round(min); v <= Math.round(max); v++) vals.push(v);
  } else {
    const n = Math.max(2, Math.round(steps));
    for (let i = 0; i <= n; i++) vals.push(min + (i / n) * (max - min));
  }
  return vals;
}

function readFixedParams() {
  const g = id => document.getElementById(id);
  const cur = getP();
  return {
    dia:     parseFloat(g('exp-dia').value)     || cur.dia,
    height:  parseFloat(g('exp-height').value)  || cur.height,
    floors:  Math.round(parseFloat(g('exp-floors').value)) || cur.floors,
    stack:   Math.round(parseFloat(g('exp-stack').value))  || 1,
    n:       Math.round(parseFloat(g('exp-n').value))      || cur.n,
    angle:   parseFloat(g('exp-angle').value)   || cur.angle,
    thicknessUm: parseFloat(g('exp-thick').value) || 50,
    chir:    parseInt(g('exp-chir').value, 10) || 1,
    material: 'polyimide',
    ext: cur.ext, seaml: cur.seaml, seamr: cur.seamr, extcols: cur.extcols, scale: cur.scale,
  };
}

function readRequirements() {
  return {
    reqBistable:  document.getElementById('exp-req-bistable').checked,
    reqBuckling:  document.getElementById('exp-req-buckling').checked,
    reqA4:        document.getElementById('exp-req-a4').checked,
    safetyFactor: Math.max(0.1, parseFloat(document.getElementById('exp-safety').value) || 1.5),
    endCondition: document.getElementById('exp-endcond').value,
  };
}

function evalCell(p, req) {
  const g = computeGeometry(p);
  if (!g.valid) return { valid: false, g };
  const bounds = patternBounds(p, g);
  const sW = bounds.w * p.scale, sH = bounds.h * p.scale;
  const fitsA4 = sW <= A4_W && sH <= A4_H;
  const bc = req.reqBuckling
    ? bucklingCheck(p, g, req.safetyFactor, req.endCondition)
    : bucklingCheck(p, g, req.safetyFactor, req.endCondition); // always compute for tooltip, gate on req below

  const okBistable = !req.reqBistable || g.bistable;
  const okBuckling  = !req.reqBuckling || (bc.available && bc.safe);
  const okA4        = !req.reqA4 || fitsA4;
  const passes = okBistable && okBuckling && okA4;

  return { valid: true, g, bc, fitsA4, okBistable, okBuckling, okA4, passes };
}

export function runExplorer() {
  const xKey = document.getElementById('exp-xaxis').value;
  const yKey = document.getElementById('exp-yaxis').value;
  if (xKey === yKey) { showToast('X and Y axis must be different', 2200); return; }

  const xMin = parseFloat(document.getElementById('exp-xmin').value);
  const xMax = parseFloat(document.getElementById('exp-xmax').value);
  const xSteps = parseFloat(document.getElementById('exp-xsteps').value);
  const yMin = parseFloat(document.getElementById('exp-ymin').value);
  const yMax = parseFloat(document.getElementById('exp-ymax').value);
  const ySteps = parseFloat(document.getElementById('exp-ysteps').value);

  const xs = axisValues(xKey, xMin, xMax, xSteps);
  const ys = axisValues(yKey, yMin, yMax, ySteps);
  const fixed = readFixedParams();
  const req = readRequirements();

  const grid = [];
  const passers = [];
  for (let yi = 0; yi < ys.length; yi++) {
    const row = [];
    for (let xi = 0; xi < xs.length; xi++) {
      const p = { ...fixed, [xKey]: xs[xi], [yKey]: ys[yi] };
      const cell = evalCell(p, req);
      row.push(cell);
      if (cell.valid && cell.passes) {
        passers.push({ x: xs[xi], y: ys[yi], cell });
      }
    }
    grid.push(row);
  }

  lastResult = { xs, ys, xKey, yKey, grid, fixed, req };
  drawExplorerHeatmap();
  renderExplorerCandidates(passers, xKey, yKey);
  document.getElementById('exp-status').textContent =
    `${passers.length} / ${xs.length * ys.length} grid points meet all selected requirements.`;
}

function cellColor(cell) {
  if (!cell.valid) return '#2a2f3e';           // invalid geometry — dark gray
  if (cell.passes) return '#22c55e';           // meets every selected requirement — green
  // Partial credit shading so the map isn't just binary.
  let score = 0;
  if (cell.okBistable) score++;
  if (cell.okBuckling) score++;
  if (cell.okA4) score++;
  if (score === 0) return '#7f1d1d';
  if (score === 1) return '#b45309';
  return '#a16207'; // 2 of 3
}

export function drawExplorerHeatmap() {
  const canvas = document.getElementById('canvasExplorer');
  if (!canvas || !lastResult) return;
  const wrap = canvas.parentElement;
  const W = Math.max(200, Math.round(wrap.clientWidth) || 500);
  const H = Math.max(200, Math.round(wrap.clientHeight) || 360);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1d28'; ctx.fillRect(0, 0, W, H);

  const { xs, ys, grid, xKey, yKey } = lastResult;
  const PAD = { l: 54, r: 14, t: 14, b: 34 };
  const gW = W - PAD.l - PAD.r, gH = H - PAD.t - PAD.b;
  const cw = gW / xs.length, ch = gH / ys.length;

  for (let yi = 0; yi < ys.length; yi++) {
    for (let xi = 0; xi < xs.length; xi++) {
      const cell = grid[yi][xi];
      ctx.fillStyle = cellColor(cell);
      // y=0 row is the smallest value — plot with smallest at bottom.
      const py = PAD.t + gH - (yi + 1) * ch;
      ctx.fillRect(PAD.l + xi * cw, py, Math.ceil(cw) + 0.5, Math.ceil(ch) + 0.5);
    }
  }

  // Current sidebar design marker, if it falls within the scanned ranges.
  const cur = getP();
  if (cur[xKey] !== undefined && cur[yKey] !== undefined) {
    const xMin = xs[0], xMax = xs[xs.length - 1], yMin = ys[0], yMax = ys[ys.length - 1];
    if (cur[xKey] >= xMin && cur[xKey] <= xMax && cur[yKey] >= yMin && cur[yKey] <= yMax) {
      const cx = PAD.l + ((cur[xKey] - xMin) / (xMax - xMin || 1)) * gW;
      const cy = PAD.t + gH - ((cur[yKey] - yMin) / (yMax - yMin || 1)) * gH;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#facc15'; ctx.fill();
      ctx.strokeStyle = '#1a1d28'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // Axis ticks / labels
  ctx.strokeStyle = 'rgba(180,200,255,0.45)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + gH); ctx.lineTo(PAD.l + gW, PAD.t + gH); ctx.stroke();

  ctx.fillStyle = 'rgba(139,144,160,0.9)'; ctx.font = '10px "JetBrains Mono",monospace'; ctx.textAlign = 'center';
  ctx.fillText(AXIS_DEFS[xKey].label, PAD.l + gW / 2, H - 6);
  ctx.save(); ctx.translate(12, PAD.t + gH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(AXIS_DEFS[yKey].label, 0, 0); ctx.restore();

  ctx.font = '9px "JetBrains Mono",monospace';
  const XT = 5, YT = 5;
  for (let i = 0; i <= XT; i++) {
    const v = xs[0] + (i / XT) * (xs[xs.length - 1] - xs[0]);
    const x = PAD.l + (i / XT) * gW;
    ctx.fillStyle = 'rgba(139,144,160,0.7)';
    ctx.fillText(AXIS_DEFS[xKey].integer ? Math.round(v) : v.toFixed(1), x, PAD.t + gH + 12);
  }
  ctx.textAlign = 'right';
  for (let i = 0; i <= YT; i++) {
    const v = ys[0] + (i / YT) * (ys[ys.length - 1] - ys[0]);
    const y = PAD.t + gH - (i / YT) * gH;
    ctx.fillStyle = 'rgba(139,144,160,0.6)';
    ctx.fillText(AXIS_DEFS[yKey].integer ? Math.round(v) : v.toFixed(1), PAD.l - 4, y + 3);
  }

  canvas.onclick = e => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    if (px < PAD.l || px > PAD.l + gW || py < PAD.t || py > PAD.t + gH) return;
    const xi = Math.min(xs.length - 1, Math.floor((px - PAD.l) / cw));
    const yi = Math.min(ys.length - 1, Math.floor((PAD.t + gH - py) / ch));
    applyExplorerPoint(xs[xi], ys[yi]);
  };
  canvas.onmousemove = e => {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const tip = document.getElementById('exp-tooltip');
    if (px < PAD.l || px > PAD.l + gW || py < PAD.t || py > PAD.t + gH) { tip.style.display = 'none'; return; }
    const xi = Math.min(xs.length - 1, Math.floor((px - PAD.l) / cw));
    const yi = Math.min(ys.length - 1, Math.floor((PAD.t + gH - py) / ch));
    const cell = grid[yi][xi];
    tip.style.display = 'block';
    tip.style.left = (e.clientX - rect.left + 12) + 'px';
    tip.style.top  = (e.clientY - rect.top + 12) + 'px';
    tip.innerHTML = tooltipHTML(xs[xi], ys[yi], cell, xKey, yKey);
  };
  canvas.onmouseleave = () => { document.getElementById('exp-tooltip').style.display = 'none'; };
}

function fmtN(v) { return v === undefined || v === null ? '—' : (Math.abs(v) < 0.01 ? v.toExponential(2) : v.toFixed(3)); }

function tooltipHTML(x, y, cell, xKey, yKey) {
  const xl = AXIS_DEFS[xKey].label, yl = AXIS_DEFS[yKey].label;
  let lines = [`${xl}=${AXIS_DEFS[xKey].integer ? Math.round(x) : x.toFixed(2)}  ${yl}=${AXIS_DEFS[yKey].integer ? Math.round(y) : y.toFixed(2)}`];
  if (!cell.valid) { lines.push('invalid geometry (dx \u2265 side length)'); return lines.join('<br>'); }
  lines.push(`bistable: ${cell.g.bistable ? 'yes' : 'no'} (b/a=${cell.g.bLengthRatio.toFixed(3)})`);
  lines.push(`A4 fit: ${cell.fitsA4 ? 'yes' : 'no'}`);
  if (cell.bc && cell.bc.available) {
    lines.push(`buckling margin: ${cell.bc.margin.toFixed(2)}\u00d7 (limits: ${cell.bc.limitingMode})`);
    lines.push(`F_snap=${fmtN(cell.bc.Fsnap)}N  P_cr=${fmtN(cell.bc.Pcr)}N`);
  }
  lines.push(cell.passes ? '<b style="color:#4ade80">meets all requirements</b>' : '<b style="color:#fbbf24">does not meet all requirements</b>');
  return lines.join('<br>');
}

function renderExplorerCandidates(passers, xKey, yKey) {
  const el = document.getElementById('exp-candidates');
  if (!passers.length) { el.innerHTML = '<div class="exp-empty">No grid points meet every selected requirement \u2014 try widening the scan ranges, lowering the safety factor, or relaxing a requirement.</div>'; return; }
  const ranked = passers.slice().sort((a, b) => (b.cell.bc?.margin || 0) - (a.cell.bc?.margin || 0)).slice(0, 8);
  el.innerHTML = ranked.map(({ x, y, cell }) => {
    const marginTxt = cell.bc && cell.bc.available ? `margin ${cell.bc.margin.toFixed(2)}\u00d7` : '';
    return `<div class="exp-cand" data-x="${x}" data-y="${y}">
      <span class="exp-cand-main">${AXIS_DEFS[xKey].label.split(' ')[0]}=${AXIS_DEFS[xKey].integer ? Math.round(x) : x.toFixed(2)}, ${AXIS_DEFS[yKey].label.split(' ')[0]}=${AXIS_DEFS[yKey].integer ? Math.round(y) : y.toFixed(2)}</span>
      <span class="exp-cand-sub">b/a=${cell.g.bLengthRatio.toFixed(2)} \u00b7 ${marginTxt}</span>
    </div>`;
  }).join('');
  el.querySelectorAll('.exp-cand').forEach(row => {
    row.addEventListener('click', () => applyExplorerPoint(parseFloat(row.dataset.x), parseFloat(row.dataset.y)));
  });
}

// Applies a chosen (x,y) grid point — plus the explorer's fixed params — to
// the main sidebar; app.js's kresling:explorer-apply listener then switches
// back to the Crease pattern tab so the person lands on the result.
function applyExplorerPoint(x, y) {
  if (!lastResult) return;
  const { xKey, yKey, fixed } = lastResult;
  const setV = (id, v) => {
    const r = document.getElementById('r-' + id), n = document.getElementById('n-' + id);
    if (r) { if (v < parseFloat(r.min)) r.min = v; if (v > parseFloat(r.max)) r.max = v; r.value = v; }
    if (n) n.value = v;
  };
  const applied = { ...fixed, [xKey]: x, [yKey]: y };
  ['dia', 'height', 'floors', 'stack', 'n', 'angle'].forEach(k => setV(k, applied[k]));
  const thickR = document.getElementById('r-thick'), thickN = document.getElementById('n-thick');
  if (thickR) thickR.value = applied.thicknessUm; if (thickN) thickN.value = applied.thicknessUm;
  const matSel = document.getElementById('material'); if (matSel) matSel.value = 'polyimide';
  const chirSel = document.getElementById('chir'); if (chirSel) chirSel.value = String(applied.chir);

  window.dispatchEvent(new Event('kresling:explorer-apply'));
  showToast('Design applied \u2192 ' + AXIS_DEFS[xKey].label + '=' + (AXIS_DEFS[xKey].integer ? Math.round(x) : x.toFixed(2))
    + ', ' + AXIS_DEFS[yKey].label + '=' + (AXIS_DEFS[yKey].integer ? Math.round(y) : y.toFixed(2)), 2800);
}

// ─── Form init / sync ─────────────────────────────────────────────────────────
// Populates the "fixed design context" + default axis ranges from whatever
// is currently in the main sidebar. Called once at startup (so the fields
// are never blank/NaN — a real bug in an earlier version of this file, where
// the "only seed once" guard checked whether the hidden marker *element*
// existed rather than a flag on it, which is always true, so priming never
// actually ran) and again on demand via the "Sync from sidebar" button,
// since this panel is now always mounted rather than re-opened each time.
function seedDefaults() {
  const cur = getP();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('exp-dia', cur.dia); set('exp-height', cur.height); set('exp-floors', cur.floors);
  set('exp-stack', cur.stack); set('exp-n', cur.n); set('exp-angle', cur.angle);
  set('exp-thick', cur.thicknessUm || 50); set('exp-chir', cur.chir);
  set('exp-xmin', AXIS_DEFS.n.defMin); set('exp-xmax', AXIS_DEFS.n.defMax); set('exp-xsteps', AXIS_DEFS.n.defSteps);
  set('exp-ymin', AXIS_DEFS.angle.defMin); set('exp-ymax', AXIS_DEFS.angle.defMax); set('exp-ysteps', AXIS_DEFS.angle.defSteps);
}

export function primeExplorerForm() {
  seedDefaults();
  showToast('Synced from sidebar', 1200);
}

export function initExplorerEvents() {
  document.getElementById('exp-run').addEventListener('click', runExplorer);
  document.getElementById('exp-sync').addEventListener('click', primeExplorerForm);
  ['exp-xaxis', 'exp-yaxis'].forEach(id => {
    document.getElementById(id).addEventListener('change', e => {
      const key = e.target.value, def = AXIS_DEFS[key];
      const prefix = id === 'exp-xaxis' ? 'exp-x' : 'exp-y';
      document.getElementById(prefix + 'min').value = def.defMin;
      document.getElementById(prefix + 'max').value = def.defMax;
      document.getElementById(prefix + 'steps').value = def.defSteps;
      document.getElementById(prefix + 'steps').disabled = def.integer;
    });
  });
  // Seed real (non-blank) default values immediately — fixes the priming
  // bug above rather than waiting for a "first open" that no longer exists
  // now that this is a plain tab instead of a modal.
  seedDefaults();
}
