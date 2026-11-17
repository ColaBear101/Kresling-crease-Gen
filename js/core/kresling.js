// Exact rigid-panel geometry of one Kresling floor.
//
// Every function here is pure and unit-agnostic (the app feeds it millimetres).
// Angles are radians unless a name ends in "Deg".
//
// ── Conventions ────────────────────────────────────────────────────────────
// A floor joins a bottom ring P and a top ring Q, both regular n-gons of
// circumradius R. The top ring sits H above the bottom one and is rotated by
// the twist phi (counter-clockwise seen from +z for a right-handed floor):
//
//   P_i = (R cos(i*alpha),       R sin(i*alpha),       0)      alpha = 2*pi/n
//   Q_i = (R cos(i*alpha + phi), R sin(i*alpha + phi), H)
//
// In the flat sheet the same floor is a strip of height h. Bottom vertex
// B_i = (i*a, 0), top vertex T_i = (i*a + s, h), where s is the shift:
//
//   polygon edges   B_i–B_{i+1}, T_i–T_{i+1}   length a = 2 R sin(pi/n)  (chord, not arc)
//   long diagonal   B_i–T_i                    length b = sqrt(s^2 + h^2)
//   short diagonal  B_i–T_{i-1}                length c = sqrt((s - a)^2 + h^2)
//
// Folding maps B_i -> P_i and T_i -> Q_i, so the 3-D crease lengths are
//
//   b^2 = H^2 + 4 R^2 sin^2(phi/2)
//   c^2 = H^2 + 4 R^2 sin^2((phi - alpha)/2)
//
// Subtracting gives b^2 - c^2 = 2 a R sin(phi - pi/n), and in the flat sheet
// b^2 - c^2 = a (2s - a). Hence every rigid (strain-free) configuration obeys
//
//   sin(phi - pi/n) = k,   k = (2s - a) / (2R)
//
// which has exactly two solutions per period, psi1 = asin(k) and
// psi2 = pi - psi1 (phi = pi/n + psi). Their twists always add up to
// pi + 2*pi/n. The height of each follows from H^2 = b^2 - 4R^2 sin^2(phi/2).
// This is the classical two-state result for triangulated cylinders
// (Guest & Pellegrino 1994; Cai et al. 2015; Reid et al. 2017).
//
// Mirror symmetry maps s -> a - s, so the canonical form keeps s >= a/2
// (the "long" diagonal b is then really the longer one) and carries the
// handedness separately as chirality +1 / -1.

export const TAU = 2 * Math.PI;
const EPS = 1e-12;

/** Side (chord) length of a regular n-gon with circumradius R. */
export function chord(n, R) {
  return 2 * R * Math.sin(Math.PI / n);
}

/** Circumradius of a regular n-gon with side a. */
export function circumradius(n, a) {
  return a / (2 * Math.sin(Math.PI / n));
}

/** Crease lengths of a floor with ring separation H and twist phi. */
export function creaseLengths(n, R, H, phi) {
  const alpha = TAU / n;
  const sb = Math.sin(phi / 2);
  const sc = Math.sin((phi - alpha) / 2);
  return {
    a: chord(n, R),
    b: Math.sqrt(H * H + 4 * R * R * sb * sb),
    c: Math.sqrt(H * H + 4 * R * R * sc * sc),
  };
}

/** Flat strip (s, h) that folds rigidly into the 3-D state (H, phi). */
export function stripFromState(n, R, H, phi) {
  const { a, b, c } = creaseLengths(n, R, H, phi);
  // b^2 = s^2 + h^2 and c^2 = (s - a)^2 + h^2  =>  s = a/2 + R sin(phi - pi/n)
  const s = a / 2 + R * Math.sin(phi - Math.PI / n);
  const h2 = b * b - s * s;
  return { a, b, c, s, h: Math.sqrt(Math.max(0, h2)) };
}

/**
 * Design by the two stable heights of one floor: deployed H0 and folded H1
 * (H1 = 0 gives the classic flat-foldable Kresling). Because the two twists add
 * up to pi + 2pi/n, cos(phi0 - pi/n) = (H0^2 - H1^2) / (4 R^2 cos(pi/n)).
 * Returns null if no rigid pair exists for these heights.
 */
export function stripFromHeights(n, R, H0, H1) {
  const X = (H0 * H0 - H1 * H1) / (4 * R * R * Math.cos(Math.PI / n));
  if (!(X >= -1 - EPS && X <= 1 + EPS)) return null;
  const beta = Math.acos(Math.max(-1, Math.min(1, X)));
  const phi0 = Math.PI / n + beta;
  return { ...stripFromState(n, R, H0, phi0), phi0, phi1: Math.PI + TAU / n - phi0 };
}

/**
 * Flat strip from the flat-sheet description: strip height h and the angle
 * gamma between a polygon fold and the short (mountain) diagonal, measured
 * inside the panel the way it is drawn: 90 deg = vertical short diagonal,
 * > 90 deg leans it away from the long diagonal (the classic Kresling look).
 */
export function stripFromFlat(n, R, h, gamma) {
  const a = chord(n, R);
  // short diagonal B_i -> T_{i-1} has horizontal run (s - a); its interior angle
  // with the polygon fold B_i -> B_{i-1} (pointing in -x) is gamma, so
  // atan2(h, s - a) = pi - gamma  =>  s = a - h / tan(gamma).
  const s = a - h / Math.tan(gamma);
  return { a, s, h, b: Math.hypot(s, h), c: Math.hypot(s - a, h) };
}

/** Inverse of stripFromFlat: the short-diagonal angle (radians) of a strip. */
export function flatAngle(a, s, h) {
  return Math.PI - Math.atan2(h, s - a);
}

/**
 * Both rigid configurations of a strip. Returns them sorted by height, tallest
 * (deployed) first, each with a reason when it is not physically reachable.
 */
export function rigidStates(n, R, s, h) {
  const a = chord(n, R);
  const b2 = s * s + h * h;
  const k = (2 * s - a) / (2 * R);
  const result = { a, b: Math.sqrt(b2), c: Math.hypot(s - a, h), k, states: [] };
  if (Math.abs(k) > 1 + EPS) return result;
  const psi1 = Math.asin(Math.max(-1, Math.min(1, k)));
  for (const psi of [psi1, Math.PI - psi1]) {
    const phi = Math.PI / n + psi;
    const sb = Math.sin(phi / 2);
    const H2 = b2 - 4 * R * R * sb * sb;
    let reason = null;
    if (H2 < -1e-9 * Math.max(1, b2)) reason = 'needs negative height (the panels cannot close up)';
    else if (phi >= Math.PI - 1e-9) reason = 'twist reaches 180 deg, so the long creases would cross the axis';
    result.states.push({ phi, H: Math.sqrt(Math.max(0, H2)), H2, ok: reason === null, reason });
  }
  result.states.sort((p, q) => q.H2 - p.H2);
  return result;
}

/** Vertex of ring `ring` at polygon index i for ring height z and ring angle theta. */
export function ringVertex(R, n, i, z, theta) {
  const t = i * TAU / n + theta;
  return [R * Math.cos(t), R * Math.sin(t), z];
}

// ── small vector helpers (exported for the physics and render modules) ──────
export const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
export const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
export const scale = (p, k) => [p[0] * k, p[1] * k, p[2] * k];
export const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
export const cross = (p, q) => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];
export const norm = (p) => Math.hypot(p[0], p[1], p[2]);
export const unit = (p) => { const l = norm(p) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };

/**
 * Signed fold angle along edge p->q between triangles (p, q, r) and (q, p, u),
 * both wound counter-clockwise seen from outside the tube. 0 = flat, positive =
 * mountain (convex seen from outside), negative = valley; magnitude in [0, pi].
 */
export function foldAngle(p, q, r, u) {
  const e = unit(sub(q, p));
  const n1 = cross(sub(q, p), sub(r, p));
  const n2 = cross(sub(p, q), sub(u, q));
  const y = dot(cross(n1, n2), e);
  const x = dot(n1, n2);
  return Math.atan2(y, x);
}
