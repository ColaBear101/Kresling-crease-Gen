import { A4_W, A4_H } from '../constants.js';

// ─── Core geometry ───────────────────────────────────────────────────────────
export function computeGeometry(p) {
  const { dia, height, n, floors, stack, angle, chir } = p;
  const R        = dia / 2;
  const b        = (dia * Math.PI) / n;
  const floor_h  = height / floors;
  const theta    = angle * Math.PI / 180;
  const dx       = floor_h / Math.tan(theta);
  const red_len  = Math.hypot(2 * dx, floor_h);
  const green_dx = 2 * dx * chir - b;
  const green_len = Math.hypot(green_dx, floor_h);
  const vg = [green_dx, floor_h], vr = [2 * dx * chir, floor_h];
  const gr_angle = Math.acos(
    Math.max(-1, Math.min(1, (vg[0]*vr[0] + vg[1]*vr[1]) / (Math.hypot(...vg) * Math.hypot(...vr))))
  ) * 180 / Math.PI;
  const h0r      = floor_h / R;
  // dx's sign only encodes which way theta sits relative to 90°; the fold
  // direction itself is carried separately by `chir`. The overlap/validity
  // check is about magnitude vs. the side length, so use |dx| — a signed
  // `dx > 0`/`dx < b` guard was silently failing for every obtuse angle
  // (theta > 90°, e.g. the 100°-120° defaults used by every stock preset).
  // n < 3 isn't a polygon at all (b = dia*PI/n blows up to Infinity at n=0,
  // and `Infinity > anything` makes the |dx| < b check pass vacuously —
  // buildVerts then silently emits NaN vertices instead of being flagged
  // invalid), so require n >= 3 and finite b/floor_h explicitly.
  const nOk      = n >= 3;
  const valid    = nOk && Number.isFinite(b) && Number.isFinite(floor_h) &&
                   Math.abs(dx) < b && floor_h > 0 && b > 0;

  // ─── Cai et al. (2015) length-ratio criterion, kept for reference only ────
  //   1 < red_len / b < 1 / sin(π/n)
  // It does not agree with the exact folding solution below for this
  // zig-zag pattern, so it no longer decides `bistable` (see `caiBistable`).
  const bLengthRatio = red_len / b;
  const bistableMax  = 1 / Math.sin(Math.PI / n);
  const caiBistable  = nOk && bLengthRatio > 1 && bLengthRatio < bistableMax && Math.abs(dx) > 0 && Math.abs(dx) < b;

  // ─── Exact rigid folding of the pattern exactly as it is drawn ────────────
  // Nothing here changes the crease pattern: it only works out which 3-D
  // shapes the printed creases can fold into without stretching the panels.
  // Floor 0's red crease runs 2·dx·chir across and its green crease runs one
  // side further (to the column on the left); odd floors are mirror images,
  // so solving floor 0 covers every floor.
  const fold = exactFold(n, b, floor_h, 2 * dx * (chir === -1 ? -1 : 1), -1);
  const totalFloors = (floors || 1) * (stack || 1);
  const dep = fold.deployed, fol = fold.folded;
  const rigidOk  = nOk && Number.isFinite(b) && Number.isFinite(floor_h) && floor_h > 0 && Boolean(dep && dep.ok);
  const bistable = rigidOk && Boolean(fol && fol.ok) && fol.H < dep.H * (1 - 1e-9);
  let foldReason = null;
  if (!nOk) foldReason = 'Fewer than 3 sides is not a polygon.';
  else if (!fold.deployed) foldReason = fold.reason;
  else if (!dep.ok) foldReason = `No strain-free folded shape: it ${dep.reason}.`;
  else if (!bistable) foldReason = fol && !fol.ok ? `Single stable state: the second shape ${fol.reason}.` : 'Single stable state.';

  // Lengths of the whole tube in its two stable shapes (null when a shape is missing).
  const extendLen = rigidOk ? dep.H * totalFloors : null;
  const foldLen   = bistable ? fol.H * totalFloors : null;
  const foldDx    = bistable ? fold.R3 * Math.abs(fol.psi) : null;   // arc length of the red crease's turn
  // Clear opening of the folded tube: the crease turning furthest round the
  // axis passes closest to it, at radius R3·cos(span/2).
  const foldSpan       = bistable ? Math.max(Math.abs(fol.psi), Math.abs(fol.spanGreen)) : null;
  const foldInnerR     = bistable ? fold.R3 * Math.cos(foldSpan / 2) : null;
  const foldInnerValid = bistable && foldInnerR > 0;
  const foldInnerDia   = foldInnerValid ? 2 * foldInnerR : null;

  // The tube really closes into an n-gon with the printed side b, so its
  // corner circle is b / sin(π/n), slightly wider than the `dia` typed in
  // (b is taken as an arc of that circle). Angle of the red crease as drawn:
  // the rows shift by ±dx, so it runs 2·dx per floor height.
  const trueDia    = 2 * fold.R3;
  const drawnAngle = Math.atan2(floor_h, 2 * dx) * 180 / Math.PI;

  return {
    b, floor_h, dx, red_len, green_len, gr_angle, h0r, bistable, valid, R, green_dx,
    extendLen, foldLen, foldDx, foldInnerDia, foldInnerValid,
    bLengthRatio, bistableMax, caiBistable,
    fold, rigidOk, foldReason, trueDia, drawnAngle, totalFloors, n,
  };
}

/**
 * Strain-free folded shapes of one floor of the drawn pattern.
 *   n        sides
 *   b        printed polygon side (cm)
 *   floor_h  printed floor height (cm)
 *   rho      horizontal run of the red crease (bottom vertex to the top vertex in the same column)
 *   delta    -1 when the green crease goes to the column on the left, +1 to the right
 *
 * Rolled up, the polygon edges close into a regular n-gon of circumradius
 * R3 = b / (2 sin(π/n)); the next ring sits H higher and turns by psi (the
 * red crease's turn around the axis). Rigid panels keep both diagonals at
 * their flat lengths:
 *   red²   = H² + 4·R3²·sin²(psi/2)
 *   green² = H² + 4·R3²·sin²((psi + delta·2π/n)/2)
 * Subtracting the two gives sin(psi + delta·π/n) = (2·rho + delta·b) / (2·R3) = k,
 * so a floor has exactly two strain-free shapes, or none when |k| > 1
 * (Guest & Pellegrino 1994).
 *
 * The two shapes are found in the standard form of the strip: mirror it if
 * needed so the green crease goes left, and call the longer diagonal's run
 * s (≥ b/2). That diagonal turns by phi = π/n + asin(|k|) (deployed) or
 * phi = π/n + π − asin(|k|) (folded) on the way round the tube. Turning it by
 * π or more would push it through the axis, so a shape is reachable only when
 * phi < π and H² ≥ 0. (Folding is continuous, so phi must not be wrapped to
 * the short way round; the two shapes always turn the same way.)
 * Returns { R3, k, states: [deployed, folded], deployed, folded, reason },
 * each state { psi, phi, H, H2, spanGreen, ok, reason }, psi being the red
 * crease's signed turn as the 3-D view uses it.
 */
export function exactFold(n, b, floor_h, rho, delta) {
  const R3 = b / (2 * Math.sin(Math.PI / n));
  const k = (2 * rho + delta * b) / (2 * R3);
  const out = { R3, k, states: [], deployed: null, folded: null, reason: null };
  if (!(n >= 3) || !Number.isFinite(k)) { out.reason = 'Not a valid polygon.'; return out; }
  if (Math.abs(k) > 1 + 1e-12) {
    out.reason = `No strain-free folded shape: closing this tube needs sin(ψ ± π/n) = ${Math.abs(k).toFixed(4)}, more than 1, so the panels must stretch.`;
    return out;
  }
  const alpha = 2 * Math.PI / n;
  const flip = delta > 0 ? -1 : 1;           // mirror so the green crease goes left
  const r = rho * flip;                      // red run in that frame
  const redIsLong = r >= b / 2;
  const s = redIsLong ? r : b - r;           // run of the longer diagonal (>= b/2)
  const long2 = s * s + floor_h * floor_h;
  const base = Math.asin(Math.min(1, Math.abs(k)));
  for (const phi of [Math.PI / n + base, Math.PI / n + Math.PI - base]) {
    const sh = Math.sin(phi / 2);
    const H2 = long2 - 4 * R3 * R3 * sh * sh;
    let reason = null;
    if (phi >= Math.PI - 1e-9) reason = 'would push a crease through the tube axis';
    else if (H2 < -1e-9 * long2) reason = 'would need a negative floor height';
    // red crease's turn in the drawn frame: phi when red is the long diagonal,
    // otherwise the short one, which turns by phi - 2π/n the opposite way
    const psi = flip * (redIsLong ? phi : alpha - phi);
    const spanGreen = psi + delta * alpha;
    out.states.push({ psi, phi, H: Math.sqrt(Math.max(0, H2)), H2, spanGreen, ok: reason === null, reason });
  }
  out.deployed = out.states[0];
  out.folded = out.states[1];
  return out;
}

/**
 * 3-D shape of one floor for the 3-D view at fold progress c in [0, 1]:
 * c = 0 is the deployed (tallest) strain-free shape, c = 1 the folded one, or
 * 40% of the deployed height when there is no second stable shape. In between,
 * the red crease keeps its printed length while the green one strains, as the
 * real panels do on the way through the snap. Returns
 * { R, H, psi, exact, note }: ring radius, floor height, the red crease's
 * turn (rad), whether this is a strain-free shape, and a note for the view.
 * When the pattern has no strain-free shape at all, the closest one is shown.
 */
export function shapeAt(g, c) {
  const t = Math.min(1, Math.max(0, Number.isFinite(c) ? c : 0));
  const f = g.fold;
  const R = f.R3;
  const red2 = g.red_len * g.red_len;
  const turnFor = (H, sign) => sign * 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, red2 - H * H)) / (2 * R)));
  let H0, H1, psi0, psi1 = null, note = null;
  if (g.rigidOk) {
    H0 = f.deployed.H; psi0 = f.deployed.psi;
    if (g.bistable) { H1 = f.folded.H; psi1 = f.folded.psi; }
    else { H1 = 0.4 * H0; note = 'single stable state: pressed shape is strained'; }
  } else {
    // closest shape: the red crease at full length with the turn clamped to |k| = 1
    const k = Math.max(-1, Math.min(1, Number.isFinite(f.k) ? f.k : 0));
    psi0 = Math.asin(k) + Math.PI / g.n;
    H0 = Math.sqrt(Math.max(1e-12, red2 - 4 * R * R * Math.sin(psi0 / 2) ** 2));
    H1 = 0.4 * H0;
    note = 'no strain-free folded shape: shown approximately';
  }
  const H = H0 + (H1 - H0) * t;
  let psi;
  if (psi1 !== null && Math.sign(psi1) !== Math.sign(psi0)) psi = psi0 + (psi1 - psi0) * t;
  else psi = turnFor(H, Math.sign(psi0) || 1);
  const exact = (g.rigidOk && t === 0) || (g.bistable && t === 1);
  return { R, H, psi, exact, note };
}

/** Fold progress for shapeAt from the compress slider (0..95 %; its end is the folded shape). */
export function foldProgress(p) {
  return Math.min(1, Math.max(0, (p.compress || 0) / 0.95));
}

/**
 * Vertex rings of the folded tube for `shape` (from shapeAt), one ring per
 * floor boundary, centred on the origin with y up. Floors alternate, so rings
 * turn by ±psi/2. `radius` defaults to the shape's ring radius (pass a smaller
 * one for the inner wall of a thick tube). Shared by the 3-D view and the
 * STL export so the exported mesh is exactly what is on screen.
 */
export function tubeRings(n, totalFloors, shape, radius = shape.R) {
  const rings = [];
  for (let f = 0; f <= totalFloors; f++) {
    const y = f * shape.H - (totalFloors * shape.H / 2);
    const ang = (f % 2 === 1) ? shape.psi / 2 : -shape.psi / 2;
    const row = [];
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k / n) + ang;
      row.push([radius * Math.cos(a), y, radius * Math.sin(a)]);
    }
    rings.push(row);
  }
  return rings;
}

/** Angles (deg, `step` apart) in [angMin, angMax] where the drawn pattern is bistable, as the widest contiguous run. */
export function bistableAngleWindow(p, angMin = 60, angMax = 140, step = 0.05) {
  let best = null, run = null;
  const count = Math.round((angMax - angMin) / step);
  for (let i = 0; i <= count; i++) {
    const angle = angMin + i * step;
    const g = computeGeometry({ ...p, angle });
    if (g.valid && g.bistable) {
      if (!run) run = { lo: angle, hi: angle };
      else run.hi = angle;
    } else if (run) {
      if (!best || run.hi - run.lo > best.hi - best.lo) best = run;
      run = null;
    }
  }
  if (run && (!best || run.hi - run.lo > best.hi - best.lo)) best = run;
  return best;
}

/**
 * Angle in the middle of the widest bistable window (rounded to 0.1°), or
 * null when no angle in range gives two stable shapes.
 */
export function findBistableAngle(p, angMin = 60, angMax = 140) {
  const w = bistableAngleWindow(p, angMin, angMax);
  if (!w) return null;
  let angle = Math.round(((w.lo + w.hi) / 2) * 10) / 10;
  let g = computeGeometry({ ...p, angle });
  if (!g.bistable) { angle = Math.round(w.lo * 10) / 10 + 0.1; g = computeGeometry({ ...p, angle }); }
  return { angle, g, window: w };
}

/**
 * Valid angle with a single stable shape, at least `margin` degrees away from
 * any bistable angle, closest to 90° (red crease vertical, the least twisted
 * pattern). Falls back to the closest such angle without the margin.
 */
export function findMonostableAngle(p, angMin = 60, angMax = 140, margin = 2) {
  const step = 0.05;
  const count = Math.round((angMax - angMin) / step);
  const rows = [];
  for (let i = 0; i <= count; i++) {
    const angle = angMin + i * step;
    const g = computeGeometry({ ...p, angle });
    rows.push({ angle, g, mono: g.valid && g.rigidOk && !g.bistable, bi: g.valid && g.bistable });
  }
  const biAngles = rows.filter((r) => r.bi).map((r) => r.angle);
  const farFromBi = (a) => biAngles.every((b) => Math.abs(b - a) >= margin);
  const mono = rows.filter((r) => r.mono);
  if (!mono.length) return null;
  const safe = mono.filter((r) => farFromBi(r.angle));
  const pool = safe.length ? safe : mono;
  let best = pool[0];
  for (const r of pool) if (Math.abs(r.angle - 90) < Math.abs(best.angle - 90)) best = r;
  const angle = Math.round(best.angle * 10) / 10;
  return { angle, g: computeGeometry({ ...p, angle }), marginal: !safe.length };
}

// ─── Pattern bounds (single memoised definition — fixes the duplicate-definition bug) ───
let _lastBoundsKey = '', _lastBounds = null;

export function patternBounds(p, g) {
  const key = `${p.n},${p.floors},${p.ext},${p.seaml},${p.seamr},${p.extcols},${p.stack},${p.chir},${p.scale},${g.b.toFixed(6)},${g.floor_h.toFixed(6)},${g.dx.toFixed(6)}`;
  if (key === _lastBoundsKey) return _lastBounds;
  _lastBoundsKey = key;

  const { n, floors, ext, seaml, seamr, extcols, stack } = p;
  const { b, floor_h, dx } = g;
  const totalFloors = floors * stack;
  const col_min = -extcols, col_max = n + extcols;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let f = 0; f <= totalFloors; f++) {
    for (let col = col_min; col <= col_max; col++) {
      let x = col * b, y = f * floor_h;
      if (f % 2 === 1) x += dx * p.chir; else x -= dx * p.chir;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  minX -= seaml; maxX += seamr; minY -= ext; maxY += ext;
  _lastBounds = { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  return _lastBounds;
}

// ─── Shared vertex builder ────────────────────────────────────────────────────
// Single source of truth for the 2-D crease-pattern vertices.
// Replaces the 6+ identical loops that were scattered across renders and exporters.
export function buildVerts(p, g) {
  const { n, floors, ext, seaml, seamr, extcols, stack, scale, chir } = p;
  const { b, floor_h, dx } = g;
  const col_min     = -extcols, col_max = n + extcols;
  const totalFloors = floors * stack;
  const bounds      = patternBounds(p, g);
  const scaledW     = bounds.w * scale, scaledH = bounds.h * scale;
  const patOriginX  = (A4_W - scaledW) / 2;
  const patOriginY  = (A4_H - scaledH) / 2;

  const verts = [];
  for (let f = 0; f <= totalFloors; f++) {
    const row = [];
    for (let col = col_min; col <= col_max; col++) {
      let x = col * b, y = f * floor_h;
      if (f % 2 === 1) x += dx * chir; else x -= dx * chir;
      row.push([(x - bounds.minX) * scale + patOriginX,
                (y - bounds.minY) * scale + patOriginY]);
    }
    verts.push(row);
  }

  return {
    verts, bounds, patOriginX, patOriginY, scaledW, scaledH,
    extS:   ext   * scale,
    seamlS: seaml * scale,
    seamrS: seamr * scale,
  };
}
