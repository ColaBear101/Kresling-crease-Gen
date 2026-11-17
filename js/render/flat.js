// Crease-pattern view (#pane-pattern): the printed page on a drafting desk.
// Canvas with pan / zoom, hover inspection of creases, a floating toolbar with
// view toggles, and a banner when the pattern needs several pages.
//
//   mountFlatView(container, app) -> { update(change), resize(), setActive(active) }
//   drawSheet(ctx, opts) -> { sheet }    paints one page; pure (no store or DOM access)
//     opts: design, pattern, layout (pattern/layout null or ignored when invalid),
//           zoom (screen px per page mm), panX, panY (screen px of page mm 0,0),
//           width, height (viewport px), view (store.view toggles),
//           colors { bg, ink2, ink3 } (desk), fonts { ui, mono },
//           hover (index into pattern.segments | null), background (default true)
//   sheetBounds(layout, params) -> { x, y, w, h }   paper in page mm (whole tile mosaic when tiled)
//   nearestCrease(pattern, layout, pt, maxDist, view) -> { index, dist } | null   (page mm)
//   describeCrease(design, layout, seg) -> { title, sub, rows: [[label, text]] }
//
// Screen px = page mm * zoom + pan; pattern mm -> page mm through layout.toPage.
// Everything on the paper uses PRINT / DASH; the desk around it uses theme tokens.

import { infoLines, legendFor, SCALE_BAR_MM } from '../core/info.js';
import { layoutPattern, autoFitPercent, TILE_OVERLAP } from '../core/layout.js';
import { PAGES } from '../core/params.js';
import { PRINT, DASH, cssVar, onThemeChange } from '../ui/theme.js';
import { el, rafThrottle, clamp, fitCanvas } from '../app/util.js';

const HIT_PX = 8;                                  // hover reach, screen px
const ACTUAL = 96 / 25.4;                          // CSS px per mm at actual size
const ZOOM_MIN = 0.05;                             // screen px per page mm
const ZOOM_MAX = 60;
const ZOOM_STEP = 1.25;
const TOGGLES = ['showGrid', 'showMV', 'showMountain', 'showValley', 'showLabels', 'showTiles'];
const NAMES = { ring: 'Polygon fold', long: 'Long diagonal', short: 'Short diagonal', end: 'End-ring fold' };
const LAYERS = ['valley', 'mountain', 'end', 'cut'];             // stroke order, last on top
const TEXT_MM = { title: 3, data: 2.5, note: 2.2, small: 2.3 };   // info box type sizes on paper
const FALLBACK_COLORS = { bg: '#e8ecea', ink2: '#44514b', ink3: '#5f6d67' };
const FALLBACK_FONTS = { ui: '"IBM Plex Sans", system-ui, sans-serif', mono: '"IBM Plex Mono", ui-monospace, monospace' };
const SHADOW = 'rgba(0, 0, 0, 0.22)';             // paper drop shadow, same in both themes
const DEG = 180 / Math.PI;
const segCache = new WeakMap();                    // layout -> { pattern, xy }
const labelCache = new WeakMap();                  // pattern -> representative segments
const ICONS = {
  minus: '<path d="M3.5 8h9"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  options: '<path d="M2.5 4.5h6M12.5 4.5h1M2.5 11.5h1M7.5 11.5h6"/><circle cx="10.5" cy="4.5" r="1.6"/><circle cx="5.5" cy="11.5" r="1.6"/>',
};
let mountCount = 0;

// ── shared helpers ──────────────────────────────────────────────────────────
const shown = (sg, v) => (sg.kind === 'mountain' ? v.showMountain !== false : sg.kind === 'valley' ? v.showValley !== false : true);
const layerOf = (sg) => (sg.kind === 'cut' ? 'cut' : sg.family === 'end' ? 'end' : sg.kind);
const inkOf = (layer, v) => (layer === 'cut' ? PRINT.cut : v.showMV === false ? PRINT.textMuted : PRINT[layer]);
const strokeAt = (S) => clamp(0.25 * S, 1, 2.4);   // crease line width in px at zoom S
const crisp = (v) => Math.floor(v) + 0.5;
const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
const percent = (f) => `${+(f * 100).toFixed(1)}%`;

/** Segment endpoints in page mm, [ax, ay, bx, by] per segment, cached per layout. */
function pageSegs(pattern, layout) {
  const hit = segCache.get(layout);
  if (hit && hit.pattern === pattern) return hit.xy;
  const xy = new Float64Array(pattern.segments.length * 4);
  pattern.segments.forEach((sg, i) => {
    const A = layout.toPage(sg.a), B = layout.toPage(sg.b);
    xy[4 * i] = A[0]; xy[4 * i + 1] = A[1]; xy[4 * i + 2] = B[0]; xy[4 * i + 3] = B[1];
  });
  segCache.set(layout, { pattern, xy });
  return xy;
}

/** Paper rectangle in page mm: the page, or every tile plus the outer margin when tiled. */
export function sheetBounds(layout, params = {}) {
  if (!layout) {
    const base = PAGES[params.page] || PAGES.A4;
    return params.orient === 'landscape' ? { x: 0, y: 0, w: base.h, h: base.w } : { x: 0, y: 0, w: base.w, h: base.h };
  }
  if (layout.fits || !layout.tiles || !layout.tiles.length) return { x: 0, y: 0, w: layout.page.w, h: layout.page.h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of layout.tiles) {
    x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
    x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h);
  }
  const m = layout.margin;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
}

/** Closest visible segment to pt (page mm) within maxDist (page mm); creases win near-ties with cuts. */
export function nearestCrease(pattern, layout, pt, maxDist, view = {}) {
  if (!pattern || !layout || !pt) return null;
  const xy = pageSegs(pattern, layout);
  let best = null;
  pattern.segments.forEach((sg, i) => {
    if (!shown(sg, view)) return;
    const ax = xy[4 * i], ay = xy[4 * i + 1], dx = xy[4 * i + 2] - ax, dy = xy[4 * i + 3] - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? clamp(((pt[0] - ax) * dx + (pt[1] - ay) * dy) / L2, 0, 1) : 0;
    const d = Math.hypot(pt[0] - ax - t * dx, pt[1] - ay - t * dy);
    if (d > maxDist) return;
    const score = d + maxDist * ((sg.kind === 'cut' ? 0.25 : 0) + (sg.tab ? 0.1 : 0));
    if (!best || score < best.score) best = { index: i, dist: d, score };
  });
  return best && { index: best.index, dist: best.dist };
}

/** Tooltip content for one segment: name, length, angle to the polygon folds, floor. */
export function describeCrease(design, layout, seg) {
  const title = seg.kind === 'cut' ? 'Cut line' : `${NAMES[seg.family] || 'Crease'}, ${seg.kind} fold`;
  const sc = layout ? layout.scale : 1;
  const mm = (x) => `${x.toFixed(2)} mm${Math.abs(sc - 1) > 1e-9 ? ` (${(x * sc).toFixed(2)} printed)` : ''}`;
  const rows = [['Length', mm(seg.len)]];
  if (seg.full) rows.push(['Whole crease', `${mm(seg.full)}, cut by the seam line or the sheet edge`]);
  const ang = creaseAngle(design, seg);
  rows.push(['Angle', ang === null ? 'parallel to polygon fold' : `${ang.toFixed(2)}° to polygon fold`]);
  const F = design.totalFloors;                   // the sheet holds the whole stack
  if (Number.isInteger(seg.floor)) rows.push(['Floor', `${seg.floor + 1} of ${F}`]);
  else if (Number.isInteger(seg.row)) {
    const where = seg.family !== 'end' ? `between ${seg.row} and ${seg.row + 1}` : seg.row === 0 ? `bottom end ring, under floor 1` : `top end ring, over floor ${F}`;
    rows.push(['Floor', where]);
  }
  return { title, sub: seg.tab ? 'Seam-strip copy: glued over the matching crease' : null, rows };
}

// Angle (deg) to the polygon folds measured inside the panel, as in design.strip
// (long: longAngleDeg; short: angleDeg, obtuse for the classic Kresling); null when parallel.
function creaseAngle(design, seg) {
  const dx = Math.abs(seg.b[0] - seg.a[0]), dy = Math.abs(seg.b[1] - seg.a[1]);
  if (dy <= 1e-9 * Math.max(1, dx)) return null;
  const acute = Math.atan2(dy, dx) * DEG;
  return seg.family === 'short' && design.strip && design.strip.angleDeg > 90 ? 180 - acute : acute;
}

// ── page painting ───────────────────────────────────────────────────────────
export function drawSheet(ctx, opts = {}) {
  const design = opts.design || null;
  const ok = !!(design && design.valid && opts.pattern && opts.layout);
  const pattern = ok ? opts.pattern : null, layout = ok ? opts.layout : null;
  const S = opts.zoom > 0 ? opts.zoom : 1, panX = opts.panX || 0, panY = opts.panY || 0;
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const dpr = (m && Math.hypot(m.a, m.b)) || 1;
  const T = {
    S, panX, panY, dpr,
    W: opts.width || (ctx.canvas ? ctx.canvas.width / dpr : 1e5),
    H: opts.height || (ctx.canvas ? ctx.canvas.height / dpr : 1e5),
    X: (x) => panX + x * S, Y: (y) => panY + y * S,
    view: opts.view || {},
    col: { ...FALLBACK_COLORS, ...(opts.colors || {}) },
    fonts: { ...FALLBACK_FONTS, ...(opts.fonts || {}) },
  };
  const sheet = sheetBounds(layout, design ? design.params : {});
  ctx.save();
  if (opts.background !== false) { ctx.fillStyle = T.col.bg; ctx.fillRect(0, 0, T.W, T.H); }
  paintPaper(ctx, sheet, T);
  if (T.view.showGrid !== false) paintGrid(ctx, sheet, T);
  paintRulers(ctx, sheet, T);
  if (!ok) {
    paintMessage(ctx, (design && design.errors && design.errors[0]) || 'This design has no crease pattern.', sheet, T);
  } else {
    paintMargin(ctx, layout, sheet, T);
    paintSeams(ctx, pattern, layout, T);
    paintCreases(ctx, pattern, layout, T);
    if (!layout.fits && T.view.showTiles !== false) paintTiles(ctx, layout, T);
    if (layout.info) paintInfo(ctx, design, pattern, layout, T);
    if (T.view.showLabels !== false) paintLabels(ctx, pattern, layout, T);
    if (Number.isInteger(opts.hover)) paintHover(ctx, pattern, layout, opts.hover, T);
  }
  ctx.restore();
  return { sheet };
}

function paintPaper(ctx, sh, T) {
  ctx.save();
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 16 * T.dpr;              // shadow sizes ignore the transform
  ctx.shadowOffsetY = 2 * T.dpr;
  ctx.fillStyle = PRINT.paper;
  ctx.fillRect(T.X(sh.x), T.Y(sh.y), sh.w * T.S, sh.h * T.S);
  ctx.restore();
}

/** Page-mm interval visible along one axis, clipped to [lo, hi]. */
function visible(T, axis, lo, hi) {
  const pan = axis === 'x' ? T.panX : T.panY, len = axis === 'x' ? T.W : T.H;
  return [Math.max(lo, -pan / T.S), Math.min(hi, (len - pan) / T.S)];
}

function paintGrid(ctx, sh, T) {
  const [x0, x1] = visible(T, 'x', sh.x, sh.x + sh.w), [y0, y1] = visible(T, 'y', sh.y, sh.y + sh.h);
  if (x0 >= x1 || y0 >= y1) return;
  ctx.save();
  ctx.strokeStyle = PRINT.grid;
  ctx.lineWidth = 1;
  for (const step of [5, 10]) {            // 10 mm lines are drawn twice, so they read stronger
    if (step * T.S < 4) continue;
    ctx.beginPath();
    for (let k = Math.max(1, Math.ceil((x0 - sh.x) / step)); sh.x + k * step < x1; k++) {
      const x = crisp(T.X(sh.x + k * step));
      ctx.moveTo(x, T.Y(y0)); ctx.lineTo(x, T.Y(y1));
    }
    for (let k = Math.max(1, Math.ceil((y0 - sh.y) / step)); sh.y + k * step < y1; k++) {
      const y = crisp(T.Y(sh.y + k * step));
      ctx.moveTo(T.X(x0), y); ctx.lineTo(T.X(x1), y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// mm rulers outside the top and left paper edges: ticks every 10 mm, labels every
// 50 mm; finer ticks and labels when zoomed in, coarser when zoomed far out.
function paintRulers(ctx, sh, T) {
  const S = T.S;
  const major = [10, 50, 100, 500, 1000].find((s) => s * S >= 4) || 1000;
  const minor = S >= 8 ? 1 : S >= 2.8 ? 5 : major;
  const label = 10 * S >= 40 ? 10 : [50, 100, 500, 1000, 5000].find((s) => s * S >= 34 && s % major === 0) || 5000;
  const tick = (mm) => (mm % 50 === 0 ? 9 : mm % 10 === 0 ? 6 : mm % 5 === 0 ? 4 : 2.5);
  const top = Math.round(T.Y(sh.y)) - 4, left = Math.round(T.X(sh.x)) - 4;
  ctx.save();
  ctx.strokeStyle = T.col.ink3;
  ctx.fillStyle = T.col.ink2;
  ctx.lineWidth = 1;
  ctx.font = `10px ${T.fonts.mono}`;
  ctx.beginPath();
  if (top > 0 && top < T.H + 20) {
    const [a, b] = visible(T, 'x', sh.x, sh.x + sh.w);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let mm = Math.ceil((a - sh.x) / minor) * minor; mm <= b - sh.x + 1e-6; mm += minor) {
      const x = crisp(T.X(sh.x + mm));
      ctx.moveTo(x, top); ctx.lineTo(x, top - tick(mm));
      if (mm % label === 0) ctx.fillText(String(mm), x, top - 11);
    }
  }
  if (left > 0 && left < T.W + 40) {
    const [a, b] = visible(T, 'y', sh.y, sh.y + sh.h);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let mm = Math.ceil((a - sh.y) / minor) * minor; mm <= b - sh.y + 1e-6; mm += minor) {
      const y = crisp(T.Y(sh.y + mm));
      ctx.moveTo(left, y); ctx.lineTo(left - tick(mm), y);
      if (mm % label === 0 && mm > 0) ctx.fillText(String(mm), left - 12, y);
    }
  }
  ctx.stroke();
  if (top > 0 && left > 0) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText('mm', left - 12, top - 11); }
  ctx.restore();
}

function paintMargin(ctx, layout, sh, T) {
  const m = layout.margin;
  if (!(m > 0.01)) return;
  const r = layout.fits ? layout.printable : { x: sh.x + m, y: sh.y + m, w: sh.w - 2 * m, h: sh.h - 2 * m };
  ctx.save();
  ctx.strokeStyle = PRINT.tab;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(crisp(T.X(r.x)), crisp(T.Y(r.y)), Math.round(r.w * T.S), Math.round(r.h * T.S));
  ctx.restore();
}

// Seam strips: tinted, so the glue overlap is easy to see on screen and on paper.
function paintSeams(ctx, pattern, layout, T) {
  if (!pattern.seams || !pattern.seams.length) return;
  ctx.save();
  ctx.fillStyle = PRINT.glue;
  for (const r of pattern.seams) {
    const A = layout.toPage([r.x, r.y]), B = layout.toPage([r.x + r.w, r.y + r.h]);
    const x = Math.min(A[0], B[0]), y = Math.min(A[1], B[1]);
    ctx.fillRect(T.X(x), T.Y(y), Math.abs(B[0] - A[0]) * T.S, Math.abs(B[1] - A[1]) * T.S);
  }
  ctx.restore();
}

// One stroke per style: body creases over the 60 % seam-strip copies, cuts on top.
function paintCreases(ctx, pattern, layout, T) {
  const xy = pageSegs(pattern, layout), k = layout.scale * T.S, lw = strokeAt(T.S);
  const groups = new Map();
  pattern.segments.forEach((sg, i) => {
    if (!shown(sg, T.view)) return;
    const key = `${sg.tab ? 'tab:' : ''}${layerOf(sg)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  ctx.save();
  for (const key of [...LAYERS.map((l) => `tab:${l}`), ...LAYERS]) {
    const list = groups.get(key);
    if (!list) continue;
    const layer = key.replace('tab:', '');
    ctx.globalAlpha = key === layer ? 1 : 0.6;
    ctx.strokeStyle = inkOf(layer, T.view);
    ctx.lineWidth = layer === 'cut' ? lw * 1.25 : lw;
    ctx.setLineDash(DASH[layer].map((d) => d * k));     // mm at 100 % -> screen px
    ctx.lineCap = DASH[layer].length ? 'butt' : 'round';
    ctx.beginPath();
    for (const i of list) {
      const ax = T.X(xy[4 * i]), ay = T.Y(xy[4 * i + 1]), bx = T.X(xy[4 * i + 2]), by = T.Y(xy[4 * i + 3]);
      if (Math.max(ax, bx) < -8 || Math.min(ax, bx) > T.W + 8 || Math.max(ay, by) < -8 || Math.min(ay, by) > T.H + 8) continue;
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function paintHover(ctx, pattern, layout, i, T) {
  const sg = pattern.segments[i];
  if (!sg || !shown(sg, T.view)) return;
  const xy = pageSegs(pattern, layout), layer = layerOf(sg), color = inkOf(layer, T.view);
  const ax = T.X(xy[4 * i]), ay = T.Y(xy[4 * i + 1]), bx = T.X(xy[4 * i + 2]), by = T.Y(xy[4 * i + 3]);
  const w = strokeAt(T.S) * 2.4 + 0.6;
  const line = () => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = PRINT.paper; ctx.lineWidth = w + 4; line();          // knock out neighbours
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.setLineDash(DASH[layer].map((d) => d * layout.scale * T.S));
  if (DASH[layer].length) ctx.lineCap = 'butt';
  line();
  ctx.fillStyle = color;
  for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.beginPath(); ctx.arc(x, y, w * 0.8 + 1, 0, 2 * Math.PI); ctx.fill(); }
  ctx.restore();
}

// Page windows of a tiled print: shaded glue overlaps, dashed outlines, page numbers.
function paintTiles(ctx, layout, T) {
  const S = T.S, ov = TILE_OVERLAP * S;
  ctx.save();
  ctx.fillStyle = PRINT.textMuted;
  ctx.globalAlpha = 0.07;
  for (const t of layout.tiles) {
    if (t.col > 0) ctx.fillRect(T.X(t.x), T.Y(t.y), ov, t.h * S);
    if (t.row > 0) ctx.fillRect(T.X(t.x), T.Y(t.y), t.w * S, ov);
  }
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = PRINT.textMuted;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  for (const t of layout.tiles) ctx.strokeRect(crisp(T.X(t.x)), crisp(T.Y(t.y)), Math.round(t.w * S), Math.round(t.h * S));
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (layout.tiles[0].w * S >= 48) {
    layout.tiles.forEach((t, i) => {
      const x = T.X(t.x) + (t.col > 0 ? ov : 0) + 6, y = T.Y(t.y) + (t.row > 0 ? ov : 0) + 6;
      pill(ctx, `Page ${i + 1}`, x, y, { font: `600 11px ${T.fonts.ui}`, fg: PRINT.text, bg: PRINT.paper, border: PRINT.tab, corner: true });
    });
  }
  ctx.restore();
}

// Overall width / height dimension lines and one length label per crease family.
function paintLabels(ctx, pattern, layout, T) {
  const b = layout.box, sc = layout.scale;
  const x0 = T.X(b.x), x1 = T.X(b.x + b.w), y0 = T.Y(b.y), y1 = T.Y(b.y + b.h);
  const style = { font: `11px ${T.fonts.mono}`, fg: PRINT.text, bg: PRINT.paper };
  const dim = (mm) => `${mm.toFixed(2)} mm${Math.abs(sc - 1) > 1e-9 ? ` (${(mm * sc).toFixed(1)} printed)` : ''}`;
  ctx.save();
  ctx.strokeStyle = PRINT.textMuted;
  ctx.fillStyle = PRINT.textMuted;
  ctx.lineWidth = 1;
  const dy = crisp(y0 - 16), dx = crisp(x0 - 16);
  ctx.beginPath();
  for (const x of [crisp(x0), crisp(x1)]) { ctx.moveTo(x, y0 - 3); ctx.lineTo(x, dy - 5); }
  for (const y of [crisp(y0), crisp(y1)]) { ctx.moveTo(x0 - 3, y); ctx.lineTo(dx - 5, y); }
  ctx.moveTo(x0, dy); ctx.lineTo(x1, dy);
  ctx.moveTo(dx, y0); ctx.lineTo(dx, y1);
  ctx.stroke();
  arrowHead(ctx, x0, dy, 1, 0); arrowHead(ctx, x1, dy, -1, 0);
  arrowHead(ctx, dx, y0, 0, 1); arrowHead(ctx, dx, y1, 0, -1);
  if (x1 - x0 > 40) pill(ctx, dim(pattern.width), (x0 + x1) / 2, dy, style);
  if (y1 - y0 > 40) {
    ctx.save();
    ctx.translate(dx, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    pill(ctx, dim(pattern.height), 0, 0, style);
    ctx.restore();
  }
  if (x1 - x0 >= 160) {
    const xy = pageSegs(pattern, layout);
    for (const { i, name } of labelSegments(pattern)) {
      const sg = pattern.segments[i];
      if (!shown(sg, T.view)) continue;
      const mx = T.X((xy[4 * i] + xy[4 * i + 2]) / 2), my = T.Y((xy[4 * i + 1] + xy[4 * i + 3]) / 2);
      pill(ctx, `${name} ${sg.len.toFixed(2)} mm`, mx, my, { ...style, border: inkOf(layerOf(sg), T.view) });
    }
  }
  ctx.restore();
}

/** Polygon (ring, else end-ring fold), long and short crease to label, spread over the sheet (whole creases only). */
function labelSegments(pattern) {
  if (labelCache.has(pattern)) return labelCache.get(pattern);
  const W = pattern.width, r = pattern.rowY, F = r.length - 1;
  const want = [
    { name: 'polygon', fams: ['ring', 'end'], at: [W * 0.5, r[Math.min(F, Math.max(1, Math.floor(F / 2)))]] },
    { name: 'long', fams: ['long'], at: [W * 0.2, (r[0] + r[Math.min(1, F)]) / 2] },
    { name: 'short', fams: ['short'], at: [W * 0.8, (r[Math.max(0, F - 1)] + r[F]) / 2] },
  ];
  const out = [];
  for (const w of want) {
    for (const fam of w.fams) {
      let best = -1, bd = Infinity;
      pattern.segments.forEach((sg, i) => {
        if (sg.family !== fam || sg.tab || sg.full) return;
        const d = Math.hypot((sg.a[0] + sg.b[0]) / 2 - w.at[0], (sg.a[1] + sg.b[1]) / 2 - w.at[1]);
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0) { out.push({ i: best, name: w.name }); break; }
    }
  }
  labelCache.set(pattern, out);
  return out;
}

function arrowHead(ctx, x, y, ux, uy) {      // tip at (x, y), body along (ux, uy)
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + ux * 6 - uy * 2.5, y + uy * 6 + ux * 2.5);
  ctx.lineTo(x + ux * 6 + uy * 2.5, y + uy * 6 - ux * 2.5);
  ctx.closePath();
  ctx.fill();
}

/** Text on a rounded plate, centred on (x, y) or with its top-left corner there. */
function pill(ctx, text, x, y, o) {
  ctx.save();
  ctx.font = o.font;
  const w = Math.ceil(ctx.measureText(text).width) + 10, h = 18;
  const left = o.corner ? x : x - w / 2, top = o.corner ? y : y - h / 2, r = 4;
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(left + w, top, left + w, top + h, r);
  ctx.arcTo(left + w, top + h, left, top + h, r);
  ctx.arcTo(left, top + h, left, top, r);
  ctx.arcTo(left, top, left + w, top, r);
  ctx.closePath();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = o.bg;
  ctx.fill();
  ctx.globalAlpha = 1;
  if (o.border) { ctx.strokeStyle = o.border; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = o.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, top + h / 2 + 0.5);
  ctx.restore();
}

// Info box: text column, legend and 50 mm scale bar (side by side when wide
// enough, stacked otherwise). Laid out in page mm, shrunk until it fits the box.
function paintInfo(ctx, design, pattern, layout, T) {
  const box = layout.info, lines = infoLines(design, pattern, layout);
  let lay = null;
  const legend = legendFor(pattern);
  for (const f of [1, 0.9, 0.8, 0.7, 0.6]) {
    lay = layoutInfo(ctx, lines, legend, box, layout.scale, f, T.fonts.ui);
    if (lay.h <= box.h) break;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(T.X(box.x), T.Y(box.y), box.w * T.S, box.h * T.S);
  ctx.clip();
  for (const op of lay.ops) {
    if (op.t === 'text') paintText(ctx, op, T);
    else if (op.t === 'swatch') paintSwatch(ctx, op, layout, T);
    else paintBar(ctx, op, T);
  }
  ctx.restore();
}

function layoutInfo(ctx, lines, legend, box, scale, f, font) {
  const ops = [], small = TEXT_MM.small * f, swatch = 8 * f, gap = 2 * f;
  const legendW = swatch + gap + Math.max(...legend.map((g) => measureMM(ctx, g.label, small, 400, font)));
  const side = Math.max(legendW, SCALE_BAR_MM * scale) + 2;
  const two = box.w >= side + 70;
  const textW = two ? box.w - side - 6 : box.w;
  let y = box.y + 1;
  for (const ln of lines) {
    const size = (TEXT_MM[ln.kind] || TEXT_MM.data) * f, weight = ln.kind === 'title' ? 600 : 400;
    const color = ln.kind === 'note' ? PRINT.textMuted : PRINT.text;
    for (const text of wrapWords(ln.text, textW, (s) => measureMM(ctx, s, size, weight, font))) {
      ops.push({ t: 'text', text, x: box.x, y, size, weight, color });
      y += size * 1.4;
    }
    if (ln.kind === 'title') y += size * 0.3;
  }
  const x = two ? box.x + box.w - side : box.x;
  let y2 = two ? box.y + 1 : y + 1.5 * f;
  const cols = !two && box.w >= 2 * legendW + 6 ? 2 : 1, rowH = small * 1.6;
  legend.forEach((g, i) => ops.push({
    t: 'swatch', kind: g.kind, text: g.label, size: small, len: swatch, gap,
    x: x + (i % cols) * (legendW + 6), y: y2 + Math.floor(i / cols) * rowH,
  }));
  y2 += Math.ceil(legend.length / cols) * rowH + 1.5 * f;
  ops.push({ t: 'bar', x, y: y2, len: SCALE_BAR_MM * scale, size: small });
  y2 += small * 1.4 + 2.5;
  return { ops, h: Math.max(y, y2) - box.y };
}

function measureMM(ctx, text, size, weight, font) {
  ctx.font = `${weight} ${size * 10}px ${font}`;      // measure at 10 px per mm
  return ctx.measureText(text).width / 10;
}

/** Greedy word wrap; keeps "·" and "a = b" with their neighbours. */
function wrapWords(text, maxW, measure) {
  const words = [];
  for (const w of String(text).split(' ')) {
    const last = words.length - 1;
    if (last >= 0 && (w === '·' || w === '=' || words[last].endsWith(' ='))) words[last] += ` ${w}`;
    else words.push(w);
  }
  const out = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > maxW) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

function paintText(ctx, op, T, align = 'left') {
  const px = op.size * T.S, x = T.X(op.x), y = T.Y(op.y);
  ctx.fillStyle = op.color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  if (px < 3.5) {                              // too small to read: a grey bar of the same length
    const w = measureMM(ctx, op.text, op.size, op.weight, T.fonts.ui) * T.S;
    ctx.save();
    ctx.globalAlpha *= 0.25;
    ctx.fillRect(align === 'center' ? x - w / 2 : x, y + px * 0.25, w, px * 0.55);
    ctx.restore();
  } else {
    ctx.font = `${op.weight} ${px}px ${T.fonts.ui}`;
    ctx.fillText(op.text, x, y);
  }
}

function paintSwatch(ctx, op, layout, T) {
  const x = T.X(op.x), y = T.Y(op.y + op.size * 0.55);
  ctx.save();
  if (op.kind === 'glue') {
    ctx.fillStyle = PRINT.glue;
    ctx.fillRect(x, y - op.size * 0.4 * T.S, op.len * T.S, op.size * 0.8 * T.S);
    ctx.restore();
    paintText(ctx, { text: op.text, x: op.x + op.len + op.gap, y: op.y, size: op.size, weight: 400, color: PRINT.text }, T);
    return;
  }
  ctx.strokeStyle = inkOf(op.kind, T.view);
  ctx.lineWidth = strokeAt(T.S) * (op.kind === 'cut' ? 1.25 : 1);
  ctx.setLineDash(DASH[op.kind].map((d) => d * layout.scale * T.S));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + op.len * T.S, y);
  ctx.stroke();
  ctx.restore();
  paintText(ctx, { text: op.text, x: op.x + op.len + op.gap, y: op.y, size: op.size, weight: 400, color: PRINT.text }, T);
}

function paintBar(ctx, op, T) {
  const S = T.S, x0 = T.X(op.x), x1 = T.X(op.x + op.len), yb = T.Y(op.y + op.size * 1.4 + 1.2);
  paintText(ctx, { text: `${SCALE_BAR_MM} mm`, x: op.x + op.len / 2, y: op.y, size: op.size, weight: 400, color: PRINT.text }, T, 'center');
  const n = Math.round(SCALE_BAR_MM / 10);
  ctx.save();
  ctx.strokeStyle = PRINT.text;
  ctx.lineWidth = Math.max(1, 0.25 * S);
  ctx.beginPath();
  ctx.moveTo(x0, yb); ctx.lineTo(x1, yb);
  for (let i = 0; i <= n; i++) {               // end ticks across the bar, 10 mm ticks below it
    const x = x0 + ((x1 - x0) * i) / n, end = i === 0 || i === n;
    ctx.moveTo(x, yb - (end ? 1 : 0) * S); ctx.lineTo(x, yb + (end ? 1 : 0.7) * S);
  }
  ctx.stroke();
  ctx.restore();
}

function paintMessage(ctx, text, sh, T) {
  const cx = T.X(sh.x + sh.w / 2), cy = T.Y(sh.y + sh.h / 2);
  const maxW = Math.max(140, Math.min(sh.w * T.S - 40, 380));
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `13px ${T.fonts.ui}`;
  const lines = wrapWords(text, maxW, (s) => ctx.measureText(s).width);
  const lh = 19, top = cy - (lines.length * lh + 4) / 2;
  ctx.fillStyle = PRINT.textMuted;
  lines.forEach((ln, i) => ctx.fillText(ln, cx, top + (i + 1) * lh + 4));
  ctx.font = `600 14px ${T.fonts.ui}`;
  ctx.fillStyle = PRINT.text;
  ctx.fillText('No crease pattern for this design', cx, top);
  ctx.restore();
}

// ── the mounted view ────────────────────────────────────────────────────────
export function mountFlatView(container, app) {
  const store = app.store;
  const id = `flat-${++mountCount}`;
  const cam = { S: 1, panX: 0, panY: 0, fitted: false, user: false, key: '', w: 0, h: 0 };
  const pts = new Map();                       // active pointers (pan / pinch)
  let active = true, hover = null, hoverPat = null, tipFor = -1, tipCursor = null, lastPt = null;
  let colors = null, fonts = null, statusFor, drag = null, pinch = null, gestureS = null;
  const requestRender = rafThrottle(() => render());
  const hoverLater = rafThrottle((p) => hoverAt(p));

  // ── DOM ──
  const toggles = [];
  const toggle = (key, label, title, cls) => {
    const b = el('button', { type: 'button', class: cls, 'data-key': key, 'aria-pressed': 'true', title, onclick: () => flip(key) }, label);
    toggles.push(b);
    return b;
  };
  const tool = (icon, label, key, fn, extra = {}) => el('button', {
    type: 'button', class: 'icon-btn flat-tool', 'aria-label': label, title: key ? `${label} (${key})` : label, onclick: fn, ...extra,
    html: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[icon]}</svg>`,
  });
  const canvas = el('canvas', { class: 'flat-canvas', tabindex: '0', role: 'img', 'aria-label': 'Crease pattern', 'aria-describedby': `${id}-help` });
  const tip = el('div', { class: 'flat-tip', hidden: true, 'aria-hidden': 'true' });
  const bannerText = el('p', { class: 'flat-banner-text' });
  const tilesBtn = toggle('showTiles', 'Page outlines', 'Show where each printed page begins', 'btn btn-sm btn-ghost flat-banner-btn');
  const banner = el('div', { class: 'flat-banner', role: 'status', hidden: true }, bannerText, tilesBtn);
  const zoomBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost flat-zoom', title: 'Show at actual size (100%)', onclick: () => zoomBy(ACTUAL / cam.S) }, '100%');
  const menu = el('div', { class: 'flat-menu', id: `${id}-menu`, hidden: true },
    el('div', { class: 'flat-menu-label', id: `${id}-show` }, 'Show'),
    el('div', { class: 'seg flat-menu-seg', role: 'group', 'aria-labelledby': `${id}-show` },
      toggle('showGrid', 'Grid', 'Millimetre grid on the sheet'),
      toggle('showMV', 'Colours', 'Colour creases by mountain and valley'),
      toggle('showLabels', 'Labels', 'Overall size and crease lengths'),
      toggle('showTiles', 'Pages', 'Page outlines when the pattern needs several pages')),
    el('div', { class: 'flat-menu-label', id: `${id}-folds` }, 'Folds'),
    el('div', { class: 'seg flat-menu-seg', role: 'group', 'aria-labelledby': `${id}-folds` },
      toggle('showMountain', 'Mountain', 'Show mountain folds'),
      toggle('showValley', 'Valley', 'Show valley folds')));
  const menuBtn = tool('options', 'View options', '', () => setMenu(menu.hidden),
    { 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': `${id}-menu` });
  const toolbar = el('div', { class: 'flat-toolbar', role: 'group', 'aria-label': 'Pattern view' },
    tool('minus', 'Zoom out', '−', () => zoomBy(1 / ZOOM_STEP)),
    zoomBtn,
    tool('plus', 'Zoom in', '+', () => zoomBy(ZOOM_STEP)),
    tool('fit', 'Fit page to view', '0 or double-click', () => fitNow()),
    el('span', { class: 'flat-sep', 'aria-hidden': 'true' }),
    menuBtn, menu);
  const help = el('p', { class: 'visually-hidden', id: `${id}-help` },
    'Drag to pan, scroll or pinch to zoom. Keys: plus and minus zoom, 0 fits the page, arrow keys pan. Point at a crease to see its length and angle.');
  container.append(el('div', { class: 'flat-view' }, canvas, toolbar, tip, banner, help));

  // ── state helpers ──
  function data() {
    const design = store.design(), pattern = store.pattern(), layout = store.layout();
    const ok = !!(design.valid && pattern && layout);
    return { design, pattern: ok ? pattern : null, layout: ok ? layout : null };
  }
  function flip(key) { store.setView({ [key]: store.view[key] === false }); syncToggles(); requestRender(); }
  function syncToggles() { for (const b of toggles) b.setAttribute('aria-pressed', String(store.view[b.dataset.key] !== false)); }
  function readTheme() {
    colors = { bg: cssVar('--bg') || FALLBACK_COLORS.bg, ink2: cssVar('--ink-2') || FALLBACK_COLORS.ink2, ink3: cssVar('--ink-3') || FALLBACK_COLORS.ink3 };
    fonts = { ui: cssVar('--font-ui') || FALLBACK_FONTS.ui, mono: cssVar('--font-mono') || FALLBACK_FONTS.mono };
  }

  // Banner and canvas label follow the layout (only rebuilt when it changes).
  // The banner speaks up whenever the printed pattern page(s) cannot carry the
  // legend and scale bar: a tiled print, or a sheet that nearly fills its page.
  function syncStatus({ design, pattern, layout }) {
    if ((layout || design) === statusFor) return;
    statusFor = layout || design;
    const tiled = !!(layout && !layout.fits);
    const crowded = !!(layout && layout.fits && !layout.info);
    if (tiled || crowded) {
      const page = layout.page.name, orient = design.params.orient;
      const fixed = orient === 'portrait' || orient === 'landscape';
      // Fit to page keeps the chosen orientation, so it is checked the same way
      const fit = autoFitPercent(pattern, design.params);
      const atFit = layoutPattern(pattern, { ...design.params, scale: fit });
      if (tiled) {
        const n = layout.tiles.length;
        const cols = 1 + Math.max(...layout.tiles.map((t) => t.col)), rows = 1 + Math.max(...layout.tiles.map((t) => t.row));
        const grid = cols === 1 ? `${rows} down` : rows === 1 ? `${cols} across` : `${cols} across × ${rows} down`;
        bannerText.replaceChildren(el('strong', {}, `Needs ${plural(n, 'page')}.`),
          ` At ${percent(layout.scale)} the pattern is larger than one ${page} page, so exports tile it ${grid} with ${TILE_OVERLAP} mm overlap. The PDF ends with a page for the legend and scale bar. `,
          atFit.fits ? `Fit to page in the action bar (or press F) scales it to ${fit}% so it prints on one page.`
            : `Even Fit to page in the action bar cannot fit it on one ${page}${fixed ? ` ${orient}` : ''} page; choose ${fixed ? 'Auto orientation, ' : ''}a larger paper size or fewer floors.`);
      } else {
        bannerText.replaceChildren(el('strong', {}, 'No room for the legend on this page.'),
          ` The sheet nearly fills the ${page} page, so the legend, scale bar and print notes go on a page of their own: the last page of the PDF, or a separate legend file with SVG and PNG. `,
          atFit.fits && atFit.info && fit < layout.scale * 100 ? `Fit to page in the action bar (or press F) scales the sheet to ${fit}% and makes room.` : '');
      }
    }
    banner.hidden = !(tiled || crowded);
    tilesBtn.hidden = !tiled;
    canvas.setAttribute('aria-label', layout
      ? `Crease pattern, ${design.n} sides, ${design.totalFloors} floors, ${pattern.width.toFixed(1)} × ${pattern.height.toFixed(1)} mm, ${tiled ? `tiled to ${plural(layout.tiles.length, `${layout.page.name} page`)}` : `on one ${layout.page.name} ${layout.page.orient} page`} at ${percent(layout.scale)}${crowded ? ', legend on a separate page' : ''}`
      : `No crease pattern: ${design.errors[0] || 'invalid design'}`);
  }

  function render() {
    if (!active) return;
    const r = canvas.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;           // hidden or not laid out yet
    const d = data();
    syncStatus(d);
    const { ctx, w, h } = fitCanvas(canvas);
    const sheet = sheetBounds(d.layout, d.design.params);
    const key = [sheet.x, sheet.y, sheet.w, sheet.h].map((v) => v.toFixed(1)).join();
    if (!cam.fitted || key !== cam.key) fitTo(sheet, w, h);
    else if (w !== cam.w || h !== cam.h) {
      if (!cam.user) fitTo(sheet, w, h);
      else { cam.panX += (w - cam.w) / 2; cam.panY += (h - cam.h) / 2; }   // keep the centre
    }
    cam.key = key; cam.w = w; cam.h = h;
    if (!colors) readTheme();
    try {
      drawSheet(ctx, {
        ...d, zoom: cam.S, panX: cam.panX, panY: cam.panY, width: w, height: h,
        view: store.view, colors, fonts, hover: d.pattern === hoverPat ? hover : null,
      });
    } catch (err) {
      console.error('Pattern view could not draw:', err);
    }
    const z = `${Math.round((cam.S / ACTUAL) * 100)}%`;
    if (zoomBtn.textContent !== z) { zoomBtn.textContent = z; zoomBtn.setAttribute('aria-label', `Zoom ${z}; show at actual size`); }
  }

  // ── camera ──
  function fitTo(sheet, w, h) {
    const below = banner.hidden ? 16 : banner.offsetHeight + 24;
    const L = 46, R = 16, Tp = 52;                     // room for rulers and the toolbar
    const aw = Math.max(40, w - L - R), ah = Math.max(40, h - Tp - below);
    cam.S = clamp(Math.min(aw / sheet.w, ah / sheet.h), ZOOM_MIN, ZOOM_MAX);
    cam.panX = L + (aw - sheet.w * cam.S) / 2 - sheet.x * cam.S;
    cam.panY = Tp + (ah - sheet.h * cam.S) / 2 - sheet.y * cam.S;
    cam.fitted = true; cam.user = false;
  }
  function fitNow() {
    const d = data();
    syncStatus(d);
    fitTo(sheetBounds(d.layout, d.design.params), cam.w || canvas.clientWidth, cam.h || canvas.clientHeight);
    requestRender();
    if (lastPt) hoverLater(lastPt);
  }
  function zoomAt(f, sx, sy) {
    const S = clamp(cam.S * f, ZOOM_MIN, ZOOM_MAX), k = S / cam.S;
    cam.panX = sx - (sx - cam.panX) * k;
    cam.panY = sy - (sy - cam.panY) * k;
    cam.S = S; cam.user = true;
    requestRender();
    if (lastPt) hoverLater(lastPt);
  }
  const zoomBy = (f) => zoomAt(f, cam.w / 2, cam.h / 2);
  function panBy(dx, dy) { cam.panX += dx; cam.panY += dy; cam.user = true; requestRender(); }

  // ── hover inspection ──
  function setHover(i) {
    if (i === null) { tip.hidden = true; tipFor = -1; }
    if (i !== hover) { hover = i; requestRender(); }
  }
  function hoverAt(p) {
    if (!active || pts.size || !p) return;
    const { design, pattern, layout } = data();
    if (!pattern) { setHover(null); return; }
    const pg = [(p.x - cam.panX) / cam.S, (p.y - cam.panY) / cam.S];
    const hit = nearestCrease(pattern, layout, pg, HIT_PX / cam.S, store.view);
    hoverPat = pattern;
    setHover(hit ? hit.index : null);
    if (!hit) return;
    if (tipFor !== hit.index) {
      const info = describeCrease(design, layout, pattern.segments[hit.index]);
      tipCursor = el('dd', {});
      tip.replaceChildren(...[
        el('div', { class: 'flat-tip-title' }, info.title),
        info.sub && el('div', { class: 'flat-tip-sub' }, info.sub),
        el('dl', { class: 'flat-tip-grid' }, info.rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]), el('dt', {}, 'Cursor'), tipCursor),
      ].filter(Boolean));
      tipFor = hit.index;
    }
    const b = layout.box, x = (pg[0] - b.x) / layout.scale, y = pattern.height - (pg[1] - b.y) / layout.scale;
    tipCursor.textContent = `x ${x.toFixed(2)}, y ${y.toFixed(2)} mm`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = p.x + 16, top = p.y + 18;
    if (left + tw > cam.w - 8) left = p.x - 16 - tw;
    if (top + th > cam.h - 8) top = p.y - 14 - th;
    tip.style.transform = `translate(${Math.round(Math.max(8, left))}px, ${Math.round(Math.max(8, top))}px)`;
  }

  // ── menu ──
  const outside = (e) => { if (!toolbar.contains(e.target)) setMenu(false); };
  function setMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) { syncToggles(); document.addEventListener('pointerdown', outside, true); }
    else document.removeEventListener('pointerdown', outside, true);
  }
  toolbar.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || menu.hidden) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(false);
    menuBtn.focus();
  });

  // ── pointer, wheel and keyboard ──
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pinchInfo = () => {
    const [a, b] = [...pts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!menu.hidden) setMenu(false);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) drag = { x: p.x, y: p.y, moved: false, touch: e.pointerType === 'touch' };
    if (pts.size === 2) { pinch = pinchInfo(); if (drag) drag.moved = true; }
    setHover(null);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!pts.has(e.pointerId)) {
      if (e.pointerType !== 'touch') { lastPt = p; hoverLater(p); }
      return;
    }
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const now = pinchInfo();
      cam.panX += now.x - pinch.x; cam.panY += now.y - pinch.y;
      zoomAt(now.d / pinch.d, now.x, now.y);
      pinch = now;
    } else if (drag) {
      if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 4) return;
      const from = drag.moved ? prev : drag;
      if (!drag.moved) { drag.moved = true; canvas.classList.add('is-panning'); }
      panBy(p.x - from.x, p.y - from.y);
    }
  });
  const endPointer = (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const [q] = pts.values(); drag = { x: q.x, y: q.y, moved: true }; }
    if (pts.size) return;
    const tap = drag && !drag.moved && drag.touch && e.type === 'pointerup';
    drag = null;
    canvas.classList.remove('is-panning');
    if (tap || e.pointerType !== 'touch') { lastPt = e.pointerType === 'touch' ? null : p; hoverAt(p); }  // tap inspects
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !pts.size) { lastPt = null; setHover(null); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cam.h : 1;
    const p = local(e);
    zoomAt(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { e.preventDefault(); fitNow(); });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {   // Safari trackpad pinch
    canvas.addEventListener(type, (e) => {
      e.preventDefault();
      if (type === 'gesturestart') gestureS = cam.S;
      else if (type === 'gestureend') gestureS = null;
      else if (gestureS && pts.size < 2) { const p = local(e); zoomAt((gestureS * e.scale) / cam.S, p.x, p.y); }
    });
  }
  canvas.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 160 : 40;
    switch (e.key) {
      case '+': case '=': zoomBy(ZOOM_STEP); break;
      case '-': case '_': zoomBy(1 / ZOOM_STEP); break;
      case '0': fitNow(); break;
      case 'ArrowLeft': panBy(step, 0); break;
      case 'ArrowRight': panBy(-step, 0); break;
      case 'ArrowUp': panBy(0, step); break;
      case 'ArrowDown': panBy(0, -step); break;
      default: return;
    }
    e.preventDefault();
  });

  onThemeChange(() => { colors = null; requestRender(); });
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => requestRender());
  syncToggles();
  render();

  return {
    update(change = {}) {
      if (change.kind === 'view') {
        const keys = change.keys || [];
        if (!keys.some((k) => k === '*' || TOGGLES.includes(k))) return;
        syncToggles();
        const p = store.pattern(), sg = hover !== null && p ? p.segments[hover] : null;
        if (hover !== null && (!sg || !shown(sg, store.view))) setHover(null);
      } else if (change.kind === 'theme') {
        colors = null;
      } else if (change.kind === 'params') {
        setHover(null);
        if (lastPt) hoverLater(lastPt);
      }
      requestRender();
    },
    resize() { render(); },
    setActive(on) {
      active = !!on;
      if (active) { render(); return; }
      setHover(null);
      if (!menu.hidden) setMenu(false);
      pts.clear(); drag = null; pinch = null;
      canvas.classList.remove('is-panning');
    },
  };
}
