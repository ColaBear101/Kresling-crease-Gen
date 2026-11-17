// Small canvas line chart: linear/log axes with 1-2-5 ticks, optional second
// y axis, shaded bands, vertical lines, labelled markers, legend, crosshair.
//
//   drawChart(ctx, w, h, spec) -> { plot: {x, y, w, h}, sx, sy, sy2, invertX(px), hasY2 }
//   spec = {
//     x:  { label, min, max, log, format },  y: {...},  y2: {...} (optional)
//     series:  [{ x[], y[], axis: 'y'|'y2', color, width, dash, fill, label }]   (null = gap)
//     bands:   [{ x0, x1, color }]
//     vlines:  [{ x, color, dash, label }]
//     markers: [{ x, y, axis, color, label, shape: 'dot'|'ring'|'diamond', place: 'above'|'below' }]
//     hoverX:  number | null      draws a crosshair at this x
//     legend:  true | false
//   }
// Colours come from the theme tokens (cssVar); pass colours as CSS strings.
// Coordinates are CSS pixels (use fitCanvas first).

import { cssVar } from '../ui/theme.js';

const FONT_SIZE = 10.5;

function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/** Tick values for an axis. */
export function axisTicks(min, max, log, target = 5) {
  if (!(max > min)) return [min];
  if (log) {
    const lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
    const decades = hi - lo;
    const mult = decades <= 1 ? [1, 2, 5] : decades <= 3 ? [1, 3] : [1];
    const out = [];
    for (let e = lo; e <= hi; e++) for (const m of mult) {
      const v = m * Math.pow(10, e);
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
    }
    return out.length >= 2 ? out : [min, max];
  }
  const step = niceStep(max - min, target);
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Default number format for tick labels. */
export function tickFormat(v, log) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (log || a >= 1e4 || a < 1e-3) {
    if (a >= 1e4 || a < 1e-3) {
      const e = Math.floor(Math.log10(a));
      const m = v / Math.pow(10, e);
      return Math.abs(m - 1) < 1e-9 ? `1e${e}` : `${Number(m.toPrecision(2))}e${e}`;
    }
  }
  return String(Number(v.toPrecision(4)));
}

/** Range of the finite values of the series on one axis, padded. */
export function autoRange(series, axis, key = 'y', { log = false, includeZero = false, pad = 0.06 } = {}) {
  let lo = Infinity, hi = -Infinity;
  for (const s of series) {
    if ((s.axis || 'y') !== axis && key === 'y') continue;
    for (const v of s[key]) {
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      if (log && v <= 0) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) return log ? [1, 10] : [0, 1];
  if (includeZero && !log) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (log) {
    if (hi / lo < 1.5) { lo /= 1.5; hi *= 1.5; }
    return [lo / Math.pow(hi / lo, pad), hi * Math.pow(hi / lo, pad)];
  }
  if (hi === lo) { const d = Math.abs(hi) || 1; return [lo - d * 0.5, hi + d * 0.5]; }
  const d = (hi - lo) * pad;
  return [lo === 0 && includeZero ? 0 : lo - d, hi + d];
}

function scaleOf(ax, a, b) {
  const { min, max, log } = ax;
  if (log) {
    const l0 = Math.log10(min), l1 = Math.log10(max);
    const f = (v) => a + ((Math.log10(Math.max(v, 1e-300)) - l0) / (l1 - l0)) * (b - a);
    f.invert = (p) => Math.pow(10, l0 + ((p - a) / (b - a)) * (l1 - l0));
    return f;
  }
  const f = (v) => a + ((v - min) / (max - min)) * (b - a);
  f.invert = (p) => min + ((p - a) / (b - a)) * (max - min);
  return f;
}

function measure(ctx, text) { return ctx.measureText(text).width; }

export function drawChart(ctx, w, h, spec) {
  const ink = cssVar('--ink'), ink2 = cssVar('--ink-2'), ink3 = cssVar('--ink-3');
  const line = cssVar('--line'), lineStrong = cssVar('--line-strong'), surface = cssVar('--surface');
  const mono = cssVar('--font-mono') || 'monospace';
  ctx.save();
  ctx.font = `${FONT_SIZE}px ${mono}`;
  ctx.textBaseline = 'middle';

  const X = spec.x, Y = spec.y, Y2 = spec.y2 || null;
  const fx = X.format || ((v) => tickFormat(v, X.log));
  const fy = Y.format || ((v) => tickFormat(v, Y.log));
  const fy2 = Y2 ? (Y2.format || ((v) => tickFormat(v, Y2.log))) : null;
  const yTicks = axisTicks(Y.min, Y.max, Y.log, Math.max(3, Math.round(h / 55)));
  const y2Ticks = Y2 ? axisTicks(Y2.min, Y2.max, Y2.log, Math.max(3, Math.round(h / 55))) : [];
  const yLabW = Math.max(...yTicks.map((v) => measure(ctx, fy(v))), 10);
  const y2LabW = Y2 ? Math.max(...y2Ticks.map((v) => measure(ctx, fy2(v))), 10) : 0;
  const legendItems = spec.legend === false ? [] : spec.series.filter((s) => s.label);
  const left = 8 + 14 + yLabW + 6;
  const right = Y2 ? 8 + 14 + y2LabW + 6 : 14;
  // legend rows: wrap entries across the plot width (at most 3 rows)
  const legendRows = [];
  {
    const avail = Math.max(60, w - left - right);
    let row = [], x = 0;
    for (const s of legendItems) {
      const iw = 20 + measure(ctx, s.label) + 14;
      if (row.length && x + iw > avail) { legendRows.push(row); row = []; x = 0; }
      row.push(s); x += iw;
    }
    if (row.length) legendRows.push(row);
    legendRows.splice(3);
  }
  const top = legendRows.length ? 8 + legendRows.length * 14 : 10;
  const bottom = 8 + 14 + 16;
  const plot = { x: left, y: top, w: Math.max(10, w - left - right), h: Math.max(10, h - top - bottom) };
  const sx = scaleOf(X, plot.x, plot.x + plot.w);
  const sy = scaleOf(Y, plot.y + plot.h, plot.y);
  const sy2 = Y2 ? scaleOf(Y2, plot.y + plot.h, plot.y) : null;

  // bands
  for (const b of spec.bands || []) {
    const x0 = Math.max(plot.x, Math.min(sx(b.x0), sx(b.x1))), x1 = Math.min(plot.x + plot.w, Math.max(sx(b.x0), sx(b.x1)));
    if (x1 <= x0) continue;
    ctx.fillStyle = b.color;
    ctx.fillRect(x0, plot.y, x1 - x0, plot.h);
  }
  // grid + ticks
  const xTicks = axisTicks(X.min, X.max, X.log, Math.max(3, Math.round(plot.w / 80)));
  ctx.lineWidth = 1;
  ctx.strokeStyle = line;
  ctx.beginPath();
  for (const v of xTicks) { const p = Math.round(sx(v)) + 0.5; ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y + plot.h); }
  for (const v of yTicks) { const p = Math.round(sy(v)) + 0.5; ctx.moveTo(plot.x, p); ctx.lineTo(plot.x + plot.w, p); }
  ctx.stroke();
  ctx.strokeStyle = lineStrong;
  ctx.strokeRect(Math.round(plot.x) + 0.5, Math.round(plot.y) + 0.5, Math.round(plot.w), Math.round(plot.h));

  ctx.fillStyle = ink2;
  ctx.textAlign = 'center';
  let lastRight = -Infinity;
  for (const v of xTicks) {
    const p = sx(v), t = fx(v), tw = measure(ctx, t);
    if (p - tw / 2 < lastRight + 6) continue;
    ctx.fillText(t, p, plot.y + plot.h + 10);
    lastRight = p + tw / 2;
  }
  ctx.textAlign = 'right';
  for (const v of yTicks) ctx.fillText(fy(v), plot.x - 6, sy(v));
  if (Y2) { ctx.textAlign = 'left'; for (const v of y2Ticks) ctx.fillText(fy2(v), plot.x + plot.w + 6, sy2(v)); }

  // axis labels
  ctx.fillStyle = ink3;
  ctx.textAlign = 'center';
  if (X.label) ctx.fillText(X.label, plot.x + plot.w / 2, h - 9);
  const vlabel = (text, x, color) => {
    ctx.save(); ctx.translate(x, plot.y + plot.h / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = color || ink3; ctx.fillText(text, 0, 0); ctx.restore();
  };
  if (Y.label) vlabel(Y.label, 10, Y.color);
  if (Y2 && Y2.label) vlabel(Y2.label, w - 10, Y2.color);

  // series (clipped to the plot)
  ctx.save();
  ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
  for (const s of spec.series) {
    const sY = (s.axis || 'y') === 'y2' && sy2 ? sy2 : sy;
    const axis = (s.axis || 'y') === 'y2' && Y2 ? Y2 : Y;
    const pts = [];
    for (let i = 0; i < s.x.length; i++) {
      const v = s.y[i];
      if (v === null || v === undefined || !Number.isFinite(v) || (axis.log && v <= 0) || (X.log && s.x[i] <= 0)) { pts.push(null); continue; }
      pts.push([sx(s.x[i]), sY(v)]);
    }
    if (s.fill) {
      ctx.fillStyle = s.fill;
      const base = sY(axis.log ? axis.min : Math.max(axis.min, Math.min(axis.max, 0)));
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          ctx.beginPath(); ctx.moveTo(run[0][0], base);
          for (const p of run) ctx.lineTo(p[0], p[1]);
          ctx.lineTo(run[run.length - 1][0], base); ctx.closePath(); ctx.fill();
        }
        run = [];
      };
      for (const p of pts) { if (p) run.push(p); else flush(); }
      flush();
    }
    ctx.strokeStyle = s.color || ink;
    ctx.lineWidth = s.width || 1.6;
    ctx.setLineDash(s.dash || []);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // vertical lines (their labels reserve space so marker labels move clear)
  const placed = [];
  for (const v of spec.vlines || []) {
    if (!(v.x >= Math.min(X.min, X.max) && v.x <= Math.max(X.min, X.max))) continue;
    const p = Math.round(sx(v.x)) + 0.5;
    ctx.strokeStyle = v.color || ink2;
    ctx.lineWidth = v.width || 1;
    ctx.setLineDash(v.dash || []);
    ctx.beginPath(); ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y + plot.h); ctx.stroke();
    ctx.setLineDash([]);
    if (v.label) {
      ctx.fillStyle = v.color || ink2;
      const tw = measure(ctx, v.label);
      const leftSide = p > plot.x + plot.w - tw - 8;
      ctx.textAlign = leftSide ? 'right' : 'left';
      const tx = p + (leftSide ? -4 : 4);
      ctx.fillText(v.label, tx, plot.y + 9);
      placed.push({ x: leftSide ? tx - tw / 2 : tx + tw / 2, y: plot.y + 9, w: tw });
    }
  }

  // markers with labels that avoid each other and the line labels
  for (const m of spec.markers || []) {
    const sY = (m.axis || 'y') === 'y2' && sy2 ? sy2 : sy;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    const px = sx(m.x), py = sY(m.y);
    if (px < plot.x - 1 || px > plot.x + plot.w + 1 || py < plot.y - 1 || py > plot.y + plot.h + 1) continue;
    ctx.fillStyle = m.color || ink;
    ctx.strokeStyle = m.color || ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (m.shape === 'diamond') { ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py); ctx.lineTo(px, py + 5); ctx.lineTo(px - 5, py); ctx.closePath(); ctx.fill(); }
    else if (m.shape === 'ring') { ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fillStyle = surface; ctx.fill(); ctx.stroke(); }
    else { ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); }
    if (m.label) {
      const tw = measure(ctx, m.label);
      let ly = m.place === 'below' ? py + 13 : py - 12;
      let lx = Math.min(plot.x + plot.w - tw / 2 - 2, Math.max(plot.x + tw / 2 + 2, px));
      for (let k = 0; k < 4; k++) {
        const hit = placed.find((r) => Math.abs(r.x - lx) < (r.w + tw) / 2 + 4 && Math.abs(r.y - ly) < 12);
        if (!hit) break;
        ly += m.place === 'below' ? 12 : -12;
      }
      ly = Math.min(plot.y + plot.h - 7, Math.max(plot.y + 7, ly));
      placed.push({ x: lx, y: ly, w: tw });
      ctx.fillStyle = surface;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(lx - tw / 2 - 2, ly - 7, tw + 4, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = m.color || ink;
      ctx.textAlign = 'center';
      ctx.fillText(m.label, lx, ly);
    }
  }

  // crosshair
  if (Number.isFinite(spec.hoverX)) {
    const p = Math.round(sx(spec.hoverX)) + 0.5;
    if (p >= plot.x && p <= plot.x + plot.w) {
      ctx.strokeStyle = ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y + plot.h); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // legend
  ctx.textAlign = 'left';
  legendRows.forEach((row, r) => {
    let x = plot.x;
    const y = 8 + r * 14;
    for (const s of row) {
      const tw = measure(ctx, s.label);
      ctx.strokeStyle = s.color || ink; ctx.lineWidth = s.width || 1.6; ctx.setLineDash(s.dash || []);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ink2; ctx.fillText(s.label, x + 20, y);
      x += 20 + tw + 14;
    }
  });
  ctx.restore();
  return { plot, sx, sy, sy2, hasY2: Boolean(Y2), invertX: (px) => sx.invert(px) };
}
