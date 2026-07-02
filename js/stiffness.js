import { getP } from './ui.js';
import { computeGeometry } from './geometry.js';
import { springConstants, MATERIALS } from './material.js';

// ─── CREASE STIFFNESS GRAPH ──────────────────────────────────────────────────
// Shows how k_m / k_v (the crease spring constants feeding energy.js) scale
// with sheet thickness, for the current material + geometry.
//
// k_fold = E t^3 L / (12 (1-nu^2) w)  — see material.js for the full model.
//
// Two things this graph is meant to answer:
//   1. k scales with thickness CUBED, not linearly — a small change in
//      material gauge has an outsized effect on crease compliance. The
//      curve makes that visible instead of just stating it.
//   2. k also scales LINEARLY with crease length L (a longer hinge is a
//      stiffer rotational spring overall, because more material resists
//      the same rotation). L and w are held fixed at the CURRENT
//      geometry's values while thickness is swept here, so this curve is
//      specific to the current n/floors/angle/etc — the true
//      material+geometry constant, independent of L, is the per-length
//      density k' = E t^3 / (12(1-nu^2) w); k_shown = k' * L.

export function drawStiffness() {
  const canvas = document.getElementById('canvasStiffness');
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const W = Math.max(200, Math.round(wrap.clientWidth) || 340);
  const H = Math.max(200, Math.round(wrap.clientHeight) || 300);
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a1d28'; ctx.fillRect(0, 0, W, H);

  const p = getP(), g = computeGeometry(p);

  if (p.material !== 'polyimide') {
    ctx.fillStyle = 'rgba(139,144,160,0.75)';
    ctx.font = '11px "JetBrains Mono",monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Set Sheet material = Polyimide to see the', W / 2, H / 2 - 8);
    ctx.fillText('thickness \u2192 stiffness curve.', W / 2, H / 2 + 8);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(139,144,160,0.5)';
    ctx.font = '9px "JetBrains Mono",monospace';
    ctx.fillText('Generic material uses fixed k_m=2.0, k_v=1.0 (no thickness dependence).', 8, H - 10);
    return;
  }

  const T_MIN = 6, T_MAX = 125; // matches the Thickness slider range, um
  const STEPS = 200;

  const ts = [], km = [], kv = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = T_MIN + (i / STEPS) * (T_MAX - T_MIN);
    const r = springConstants({ material: 'polyimide', thicknessUm: t }, g);
    ts.push(t); km.push(r.k_m); kv.push(r.k_v);
  }

  const allK = [...km, ...kv].filter(v => v > 0);
  const logMin = Math.log10(Math.min(...allK));
  const logMax = Math.log10(Math.max(...allK));

  const PAD = { l: 58, r: 14, t: 34, b: 40 };
  const gW = W - PAD.l - PAD.r, gH = H - PAD.t - PAD.b;
  const toX = t => PAD.l + (t - T_MIN) / (T_MAX - T_MIN) * gW;
  const toY = k => PAD.t + gH - (Math.log10(Math.max(k, 1e-12)) - logMin) / (logMax - logMin + 1e-12) * gH;

  // Grid
  ctx.strokeStyle = 'rgba(59,130,246,0.1)'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) { const y = PAD.t + i * (gH / 4); ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + gW, y); ctx.stroke(); }
  for (let i = 0; i <= 5; i++) { const x = PAD.l + i * (gW / 5); ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + gH); ctx.stroke(); }

  // Axes
  ctx.strokeStyle = 'rgba(180,200,255,0.45)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t); ctx.lineTo(PAD.l, PAD.t + gH); ctx.lineTo(PAD.l + gW, PAD.t + gH); ctx.stroke();

  ctx.fillStyle = 'rgba(139,144,160,0.9)'; ctx.font = '10px "JetBrains Mono",monospace'; ctx.textAlign = 'center';
  ctx.fillText('Thickness (\u00b5m)', PAD.l + gW / 2, H - 6);
  ctx.save(); ctx.translate(12, PAD.t + gH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('k (N\u00b7cm/rad, log scale)', 0, 0); ctx.restore();

  ctx.font = '9px "JetBrains Mono",monospace'; ctx.textAlign = 'center';
  for (let i = 0; i <= 5; i++) { const t = T_MIN + (i / 5) * (T_MAX - T_MIN); ctx.fillStyle = 'rgba(139,144,160,0.7)'; ctx.fillText(t.toFixed(0), toX(t), PAD.t + gH + 13); }
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) { const lg = logMin + (1 - i / 4) * (logMax - logMin); const y = PAD.t + (i / 4) * gH; ctx.fillStyle = 'rgba(139,144,160,0.6)'; ctx.fillText((10 ** lg).toExponential(0), PAD.l - 4, y + 3); }

  function drawCurve(vals, color) {
    ctx.beginPath();
    for (let i = 0; i <= STEPS; i++) { const x = toX(ts[i]), y = toY(vals[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke();
  }
  drawCurve(km, '#e05252'); // matches mountain-crease red
  drawCurve(kv, '#3dba6e'); // matches diagonal-crease green

  // Current thickness marker
  const curT = Math.min(T_MAX, Math.max(T_MIN, p.thicknessUm || 50));
  const curR = springConstants(p, g);
  const cx = toX(curT);
  ctx.beginPath(); ctx.moveTo(cx, PAD.t); ctx.lineTo(cx, PAD.t + gH);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
  [[curR.k_m, '#e05252'], [curR.k_v, '#3dba6e']].forEach(([k, col]) => {
    const cy = toY(k);
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#1a1d28'; ctx.lineWidth = 1.5; ctx.stroke();
  });

  // Legend + readout
  ctx.textAlign = 'left'; ctx.font = '10px "JetBrains Mono",monospace';
  ctx.fillStyle = '#e05252'; ctx.fillText(`k_m (mountain)  @ ${curT.toFixed(0)}\u00b5m = ${curR.k_m.toExponential(2)} N\u00b7cm/rad`, PAD.l, PAD.t - 20);
  ctx.fillStyle = '#3dba6e'; ctx.fillText(`k_v (valley)    @ ${curT.toFixed(0)}\u00b5m = ${curR.k_v.toExponential(2)} N\u00b7cm/rad`, PAD.l, PAD.t - 8);

  ctx.fillStyle = 'rgba(139,144,160,0.55)'; ctx.font = '9px "JetBrains Mono",monospace'; ctx.textAlign = 'left';
  ctx.fillText(`L,w fixed @ current geometry (n=${p.n}, floors=${p.floors})  \u2014  k \u221d thickness\u00b3, \u221d crease length`, PAD.l, H - 10);
}
