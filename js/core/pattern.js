// Flat crease pattern of the whole tube on ONE sheet, in mm.
//
// The sheet holds every floor: F = floors x stack count rows of panels in one
// piece, as Kresling-crease-Gen draws it. Alternating stacking simply keeps
// alternating across the whole sheet, so nothing has to be printed mirrored.
//
// Pattern frame: x to the right, y UP, seen from the printed side, which
// becomes the OUTSIDE of the tube. Row r (0..F) is the polygon ring at
// y = r*h; the row offset X_r is r*s (helical) or (r mod 2)*s (alternating).
// Vertex V(r, i) = (i*a + X_r, r*h).
//
// The sheet is a rectangle, laid out like the original Kresling-crease-Gen:
//   body         x in [0, n*a]: exactly one turn of the tube at every height,
//                so rolled up, its two straight edges meet on the seam line
//   seam strips  x in [-left, 0] and [n*a, n*a + right]: straight glue strips
//                past the seam line. They carry copies of the creases they
//                are glued over (tab: true), so the overlap folds with the tube
//   end rings    y in [-ringBottom, 0] and [F*h, F*h + ringTop] (params.ringBottom,
//                params.ringTop, set separately): plain bands across the whole
//                sheet. Rolled up, each closes into a ring at that end. Row 0 /
//                row F is an end-ring fold (family 'end') when that end has a
//                ring; without one it is the sheet edge
// The periodic crease pattern is clipped to the sheet; a crease cut by the seam
// line or a sheet edge keeps its full length in `full`. Everything is finally
// translated so the bounding box starts at (0, 0), and mirrored in x for
// left-handed tubes (the left/right strip widths are those of the printed sheet).
//
// Segment: { a:[x,y], b:[x,y], kind, family, tab, floor | row, len, full? }
//   kind   'mountain' | 'valley' | 'cut'
//   family 'ring' | 'long' | 'short' | 'end' (end-ring fold) | 'outline'
//   tab    true for crease copies inside a seam strip
//   full   length of the whole crease when this piece is only part of it
// The result also carries floors (F), rings { bottom, top } (end-ring heights, mm)
// and creaseSpacing: the smallest distance (mm) between neighbouring parallel
// creases, which limits the mold ridge width.

const EPS = 1e-9;
const MIN_PIECE = 1e-6;     // mm; shorter clipped pieces are dropped

export function buildPattern(design) {
  if (!design || !design.valid) return null;
  const p = design.params;
  const { n, a } = design;
  const { s, h } = design.strip;
  const F = design.totalFloors;                          // floors x stack count, all on this sheet
  const folds = design.folds;
  const alt = design.stacking !== 'helical';
  const X = (r) => (alt ? (r % 2) * s : r * s);
  const V = (r, i) => [i * a + X(r), r * h];

  const mirror = design.chirEff < 0;
  const W = n * a;                                       // one turn of the tube
  const panels = p.seamAuto ? p.extcols : null;
  const left = p.seamAuto ? p.extcols * a : Math.max(0, p.seamL || 0);    // printed sheet
  const right = p.seamAuto ? p.extcols * a : Math.max(0, p.seamR || 0);
  const tabL = mirror ? right : left;                    // drawing frame (mirrored afterwards)
  const tabR = mirror ? left : right;
  const ringB = Math.max(0, p.ringBottom || 0);         // end rings: below row 0 ...
  const ringT = Math.max(0, p.ringTop || 0);            // ... and above row F
  const x0 = -tabL, x1 = W + tabR, top = F * h;

  // Creases live between rows 0 and F; each is split at the seam lines into the
  // body piece and the strip copies (body first, so dedupe keeps it).
  const parts = [[0, W, false], [x0, 0, true], [W, x1, true]].filter(([lo, hi]) => hi - lo > EPS);
  const segs = [];
  const add = (A, B, kind, family, extra) => {
    const full = Math.hypot(B[0] - A[0], B[1] - A[1]);
    for (const [lo, hi, tab] of parts) {
      const c = clipConvex(A, B, [[lo, 0], [hi, 0], [hi, top], [lo, top]]);
      if (!c) continue;
      const len = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
      if (len < MIN_PIECE) continue;
      const sg = { a: c[0], b: c[1], kind, family, tab, floor: null, len, ...extra };
      if (full - len > 1e-6) sg.full = full;
      segs.push(sg);
    }
  };
  // columns whose creases can reach the sheet, for rows with offsets in [lo, hi]
  const cols = (lo, hi) => [Math.floor((x0 - hi) / a) - 1, Math.ceil((x1 - lo) / a) + 1];

  // ── diagonals ──
  for (let r = 0; r < F; r++) {
    const fwd = X(r + 1) - X(r) > 0;
    const [i0, i1] = cols(Math.min(X(r), X(r + 1)), Math.max(X(r), X(r + 1)));
    for (let i = i0; i <= i1; i++) {
      add(V(r, i), V(r + 1, i), folds.long, 'long', { floor: r });
      add(V(r, i), V(r + 1, fwd ? i - 1 : i + 1), folds.short, 'short', { floor: r });
    }
  }
  // ── polygon folds; row 0 / row F is a fold too when that end has a ring ──
  for (let r = 0; r <= F; r++) {
    const end = r === 0 || r === F;
    if (end && !((r === 0 ? ringB : ringT) > EPS)) continue;
    const [i0, i1] = cols(X(r), X(r));
    for (let i = i0; i < i1; i++) {
      add(V(r, i), V(r, i + 1), end ? folds.end : folds.ring, end ? 'end' : 'ring', { row: r });
    }
  }
  dedupe(segs);

  // ── outline: the sheet rectangle (counter-clockwise in the drawing frame) ──
  const outline = [[x0, -ringB], [x1, -ringB], [x1, top + ringT], [x0, top + ringT]];
  for (let k = 0; k < 4; k++) {
    const A = outline[k], B = outline[(k + 1) % 4];
    segs.push({ a: A, b: B, kind: 'cut', family: 'outline', tab: false, floor: null, len: Math.hypot(B[0] - A[0], B[1] - A[1]) });
  }

  // ── vertices on the sheet ──
  const vertices = [];
  for (let r = 0; r <= F; r++) {
    const row = [];
    const [i0, i1] = cols(X(r), X(r));
    for (let i = i0; i <= i1; i++) {
      const v = V(r, i);
      if (v[0] >= x0 - EPS && v[0] <= x1 + EPS) row.push(v);
    }
    vertices.push(row);
  }

  // ── mirror for left-handed tubes, then move the bounding box to the origin ──
  const minX = mirror ? -x1 : x0, minY = -ringB;
  const T = (pt) => [(mirror ? -pt[0] : pt[0]) - minX, pt[1] - minY];
  for (const sg of segs) { sg.a = T(sg.a); sg.b = T(sg.b); }
  const width = x1 - x0, height = top + ringB + ringT;
  const seams = [];
  if (left > EPS) seams.push({ side: 'left', x: 0, y: 0, w: left, h: height });
  if (right > EPS) seams.push({ side: 'right', x: width - right, y: 0, w: right, h: height });
  // Smallest distance between neighbouring parallel creases: polygon folds are h
  // apart (when the sheet has at least two), diagonals a*h/length apart.
  const rowFolds = F - 1 + (ringB > EPS ? 1 : 0) + (ringT > EPS ? 1 : 0);
  const creaseSpacing = Math.min(rowFolds >= 2 ? h : Infinity, (a * h) / Math.hypot(s, h), (a * h) / Math.hypot(s - a, h));
  const out = {
    segments: segs,
    outline: outline.map(T),
    vertices: vertices.map((row) => row.map(T)),
    width,
    height,
    mirrored: mirror,
    floors: F,
    creaseSpacing,
    rowY: Array.from({ length: F + 1 }, (_, r) => r * h + ringB),
    rings: { bottom: ringB, top: ringT },
    endKind: ringB > EPS || ringT > EPS ? folds.end : null,
    body: { x: left, y: 0, w: W, h: height },
    seams,
    tabs: { panels, left, right },
  };
  out.area = Math.abs(polygonArea(out.outline));
  out.totals = { mountain: 0, valley: 0, cut: 0 };
  for (const sg of segs) out.totals[sg.kind] += sg.len;
  return out;
}

/** Signed area (positive = counter-clockwise). */
export function polygonArea(pts) {
  let A = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    A += x0 * y1 - x1 * y0;
  }
  return A / 2;
}

/** Clip segment AB to a convex polygon (any winding). Returns [P, Q] or null. */
export function clipConvex(A, B, poly) {
  const area = polygonArea(poly);
  const sgn = area >= 0 ? 1 : -1;
  let t0 = 0, t1 = 1;
  const d = [B[0] - A[0], B[1] - A[1]];
  for (let k = 0; k < poly.length; k++) {
    const P = poly[k], Q = poly[(k + 1) % poly.length];
    // inside: sgn * cross(Q-P, X-P) >= 0
    const ex = Q[0] - P[0], ey = Q[1] - P[1];
    const num = sgn * (ex * (A[1] - P[1]) - ey * (A[0] - P[0]));
    const den = sgn * (ex * d[1] - ey * d[0]);
    if (Math.abs(den) < 1e-15) { if (num < -1e-9) return null; continue; }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1 - 1e-9) return null;
  }
  return [[A[0] + d[0] * t0, A[1] + d[1] * t0], [A[0] + d[0] * t1, A[1] + d[1] * t1]];
}

// Drops repeated segments, keeping the first one added (body creases are added
// before their seam-strip copies).
function dedupe(segs) {
  const seen = new Set();
  const key = (P) => `${P[0].toFixed(4)},${P[1].toFixed(4)}`;
  const kept = segs.filter((s) => {
    const ka = key(s.a), kb = key(s.b);
    const id = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  segs.length = 0;
  segs.push(...kept);
}
