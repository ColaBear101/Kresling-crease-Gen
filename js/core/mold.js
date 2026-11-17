// Embossing plates for pre-creasing the printed sheet.
//
// Two flat plates with ridges along the creases, each pressed onto the sheet
// over a soft backing (craft foam, a mouse mat):
//   mountain plate: goes UNDER the sheet (printed side up); its ridges push the
//                   mountain creases up toward the printed side.
//   valley plate:   goes ON TOP of the printed side; its ridges push valley
//                   creases down. It is modelled ridges-up for printing, so its
//                   layout is mirrored in x: flip it over and it lines up.
// The plates are made for the sheet AS PRINTED: crease positions follow the
// print scale (params.scale), so a sheet printed at 50% gets plates at 50%.
// Ridge height, width and the corner clearance are tool sizes in mm and do not
// scale. Ridges stop `gap` short of each end so vertices are not crushed.
// The ridge width is limited to RIDGE_FILL x the smallest distance between
// neighbouring parallel creases (as printed), so ridges never merge into a block.
// Each plate also carries a low border along the sheet outline (BORDER_HEIGHT x
// the ridge height, BORDER_WIDTH x the ridge width) that shows where the sheet
// edge sits, as in Kresling-crease-Gen. Along the bottom or top edge it is left
// out when that end ring, as printed, is too narrow for it and the end-fold ridge
// (the same RIDGE_FILL clearance as between crease ridges).
// Plate frame: mm, origin at the plate corner, y up (same sense as the pattern).
//
//   moldLayout(pattern, params) -> {
//     w, h, margin, scale (fraction), base, ridgeH, gap,
//     ridgeW (used), ridgeWRequested, ridgeClamped, spacing (mm as printed, or null),
//     mountain: [{ a:[x,y], b:[x,y] }], valley: [{ a, b }],
//     border: [{ a, b }]           the sheet outline (same on both plates), less any edge in
//     borderDropped: ['bottom' | 'top']   ... left out beside a too narrow end ring
//     borderH, borderW, rings { bottom, top } (end-ring heights in mm as printed),
//     outline: [[x,y]...]   pattern outline in mountain-plate coordinates (for the preview)
//     toPlate([x, y]) -> [X, Y]    pattern mm -> mountain-plate mm
//   }
//   moldNotes(layout) -> string[]   what the user should know about these plates

export const MOLD_MARGIN = 5;
export const RIDGE_FILL = 0.9;          // widest ridge / smallest crease spacing
export const MIN_RIDGE_W = 0.05;        // mm; the clamp never goes below this
export const BORDER_HEIGHT = 0.5;       // border ridge height / ridge height
export const BORDER_WIDTH = 0.8;        // border ridge width / ridge width

export function moldLayout(pattern, params) {
  const margin = MOLD_MARGIN;
  const pct = Number(params.scale);
  const k = Number.isFinite(pct) && pct > 0 ? pct / 100 : 1;
  const w = pattern.width * k + 2 * margin;
  const h = pattern.height * k + 2 * margin;
  const toPlate = ([x, y]) => [x * k + margin, y * k + margin];
  const gap = params.ridgeGap;

  const requested = params.ridgeW;
  const spacing = Number.isFinite(pattern.creaseSpacing) && pattern.creaseSpacing > 0 ? pattern.creaseSpacing * k : null;
  const ridgeW = spacing === null ? requested : Math.min(requested, Math.max(MIN_RIDGE_W, RIDGE_FILL * spacing));
  const ridgeClamped = ridgeW < requested - 1e-9;

  const shorten = (s) => {
    const A = toPlate(s.a), B = toPlate(s.b);
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = Math.hypot(dx, dy);
    if (L - 2 * gap < Math.max(ridgeW, 0.5)) return null;
    const ux = dx / L, uy = dy / L;
    return { a: [A[0] + ux * gap, A[1] + uy * gap], b: [B[0] - ux * gap, B[1] - uy * gap] };
  };
  const mountain = [], valley = [];
  for (const s of pattern.segments) {
    if (s.kind === 'cut') continue;
    const r = shorten(s);
    if (!r) continue;
    if (s.kind === 'mountain') mountain.push(r);
    else valley.push({ a: [w - r.a[0], r.a[1]], b: [w - r.b[0], r.b[1]] });
  }
  // The outline is a rectangle centred on the plate, so its mirror image (valley
  // plate) is the same rectangle: one border list serves both plates. Along the
  // bottom and top edges the border runs beside that end ring's fold, the ring's
  // printed height away.
  const outline = pattern.outline.map(toPlate);
  const borderW = BORDER_WIDTH * ridgeW;
  const rings = pattern.rings || { bottom: 0, top: 0 };
  const ys = outline.map((q) => q[1]);
  const yLo = Math.min(...ys), yHi = Math.max(...ys);
  const tooNarrow = (ring) => ring > 0 && RIDGE_FILL * ring * k < (ridgeW + borderW) / 2;
  const border = [], borderDropped = [];
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const side = Math.abs(p[1] - q[1]) > 1e-9 ? null : Math.abs(p[1] - yLo) < 1e-9 ? 'bottom' : Math.abs(p[1] - yHi) < 1e-9 ? 'top' : null;
    if (side && tooNarrow(rings[side])) borderDropped.push(side);
    else border.push({ a: p, b: q });
  });
  return {
    w, h, margin, scale: k,
    base: params.moldBase, ridgeH: params.ridgeH, gap,
    ridgeW, ridgeWRequested: requested, ridgeClamped, spacing,
    mountain, valley,
    border, borderDropped, borderH: BORDER_HEIGHT * params.ridgeH, borderW,
    rings: { bottom: rings.bottom * k, top: rings.top * k },
    outline, toPlate,
  };
}

const trim = (x, d = 2) => String(+x.toFixed(d));

/** Short sentences about a mold layout that differ from what the controls say. */
export function moldNotes(layout) {
  const out = [];
  if (!layout) return out;
  if (Math.abs(layout.scale - 1) > 1e-9) {
    out.push(`Sized for the sheet printed at ${trim(layout.scale * 100, 1)}%.`);
  }
  if (layout.ridgeClamped) {
    out.push(`Ridge width reduced from ${trim(layout.ridgeWRequested)} to ${trim(layout.ridgeW)} mm: neighbouring creases are only ${trim(layout.spacing)} mm apart.`);
  }
  for (const side of layout.borderDropped || []) {
    out.push(`No border ridge along the ${side} edge: the ${side} ring is only ${trim(layout.rings[side])} mm wide as printed.`);
  }
  return out;
}
