import { shapeAt } from './geometry.js';
import { springConstants, MATERIALS } from './material.js';

// ─── Exact fold path: one floor squeezed from tall to flat ──────────────────
// Shared by the energy graph (energy.js) and the snap-through force in the
// buckling check (buckling.js), so both use the same geometry as the 3-D view
// and the Bistable flag (geometry.js exactFold / shapeAt).
//
// Along the path the rings keep the n-gon they really close into (corner
// radius R3 = b / (2 sin(π/n))) and the red crease keeps its printed length,
// so a floor of height H turns by
//   psi(H) = ±2·asin( √(red² − H²) / (2·R3) )
// (the same relation shapeAt uses). The green crease runs one column to the
// left (turn psi − 2π/n) and is the one that has to stretch between the two
// strain-free shapes, exactly as in the truss picture of Cai et al. (2015)
// and Kidambi & Wang (2020). Energy per floor and side:
//   k_m·(Δψ_m)² + k_v·(Δψ_v)²          crease hinges (material.js), rest = deployed shape
//   + ½·k_s·(L_green − L_green,printed)²  green crease stretch
// The stretch term is zero at both strain-free shapes, so for a bistable
// pattern the curve has a well at each of them.

const vsub   = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const vcross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const vdot   = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const vnorm  = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
const angleBetween = (n1, n2) => Math.acos(Math.max(-1, Math.min(1, vdot(n1, n2))));

/**
 * One floor at height H with the top ring turned by psi (ring radius R, n sides).
 * Returns { green, psi_m, psi_v }: green crease length and the dihedral angles
 * between the panels meeting at the red (mountain) and green (valley) creases.
 */
export function cellAt(n, R, H, psi) {
  const a = 2 * Math.PI / n;
  const bot = (k) => [R * Math.cos(k * a), R * Math.sin(k * a), 0];
  const top = (k) => [R * Math.cos(k * a + psi), R * Math.sin(k * a + psi), H];
  const Am = bot(-1), A0 = bot(0), A1 = bot(1);
  const Tm = top(-1), T0 = top(0);
  // Panels of the quad between columns -1 and 0, split by the green crease A0→T(-1):
  //   P1 = (A-1, A0, T-1)   P2 = (A0, T0, T-1)
  // Panel of the next quad that shares the red crease A0→T0: P3 = (A0, A1, T0)
  const n1 = vnorm(vcross(vsub(A0, Am), vsub(Tm, Am)));
  const n2 = vnorm(vcross(vsub(T0, A0), vsub(Tm, A0)));
  const n3 = vnorm(vcross(vsub(A1, A0), vsub(T0, A0)));
  return {
    green: Math.hypot(H, 2 * R * Math.sin((psi - a) / 2)),
    psi_m: angleBetween(n2, n3),  // across the red crease A0→T0
    psi_v: angleBetween(n1, n2),  // across the green crease A0→T-1
  };
}

/** Turn of a floor of height H with the red crease at its printed length, or null if unreachable. */
export function turnForHeight(red, R, H, sign) {
  const run = Math.sqrt(Math.max(0, red * red - H * H));
  if (run > 2 * R) return null;
  return sign * 2 * Math.asin(run / (2 * R));
}

/**
 * Axial stiffness of the green crease, N/cm for polyimide, arbitrary units
 * for the generic material: the truss of Cai et al. (2015) and Kidambi &
 * Wang (2020), a strip of panel of width w along the crease,
 *   k_s = E·t·w / L,   w = b/2
 * (w is an order-of-magnitude choice, like material.js's hinge width). It is
 * thousands of times stiffer than the hinges, so the folded well survives the
 * hinges' pull back towards the deployed shape. Close to the geometric limits
 * (floor nearly flat or the red crease vertical) the stretch, and so dE/dh,
 * climbs steeply; the snap force only uses the stretch between the two wells
 * (snapRange).
 * The generic material keeps the same stretch-to-hinge balance as 50 µm film:
 *   k_s / k_m = 12·w·b / (t²·L_green·L_red),  t = 0.005 cm
 */
export function stretchStiffness(p, g) {
  if (p.material === 'polyimide') {
    const E = MATERIALS.polyimide.E_GPa * 1e9;             // Pa
    const t = (p.thicknessUm || 50) * 1e-6;                // m
    const w = (g.b / 2) * 1e-2, L = g.green_len * 1e-2;    // m
    return (E * t * w / L) / 100;                          // N/m -> N/cm
  }
  const { k_m } = springConstants(p, g);
  const t = 0.005;
  return k_m * 12 * (g.b / 2) * g.b / (t * t * g.green_len * g.red_len);
}

/**
 * Energy along the exact fold path for the whole tube.
 * Returns null when there is nothing to sweep, otherwise
 *   { H: [...], E: [...], totalFloors, restH, foldH, units }
 * with H the floor height (cm) at each sample (ascending), E the total
 * energy, restH / foldH the floor heights of the strain-free shapes (foldH
 * null when there is no second one).
 */
export function foldEnergyPath(p, g, steps = 400) {
  const n = g.n || p.n;
  const red = g.red_len, R = g.fold && g.fold.R3;
  if (!(n >= 3) || !(red > 0) || !(R > 0) || !(g.green_len > 0)) return null;
  const totalFloors = (p.floors || 1) * (p.stack || 1);
  const dep = shapeAt(g, 0);
  // Fold the way the tube already leans; a deployed shape with its red crease
  // upright (psi = 0) folds the way its second shape lies.
  const lean = Math.abs(dep.psi) > 1e-9 ? dep.psi : (g.fold.folded ? g.fold.folded.psi : 0);
  const sign = Math.sign(lean) || 1;
  const rest = cellAt(n, R, dep.H, dep.psi);
  const { k_m, k_v } = springConstants(p, g);
  const k_s = stretchStiffness(p, g);
  const L0 = g.green_len;

  // Sweep up to the deployed shape even when it is the upright one (H = red).
  const hMax = Math.max(red * 0.999, dep.H), hMin = red * 0.02;
  const H = [], E = [];
  for (let i = 0; i <= steps; i++) {
    const h = hMin + (i / steps) * (hMax - hMin);
    const psi = turnForHeight(red, R, h, sign);
    if (psi === null) continue;           // too squashed: the red crease can't reach
    const c = cellAt(n, R, h, psi);
    const e = k_m * (c.psi_m - rest.psi_m) ** 2 + k_v * (c.psi_v - rest.psi_v) ** 2
            + 0.5 * k_s * (c.green - L0) ** 2;
    H.push(h); E.push(e * n * totalFloors);
  }
  if (H.length < 3) return null;
  return {
    H, E, totalFloors,
    restH: g.rigidOk ? g.fold.deployed.H : null,
    foldH: g.bistable ? g.fold.folded.H : null,
    k_m, k_v, k_s,
  };
}

/**
 * Floor-height range the snap force is measured over: between the two wells
 * for a bistable design, otherwise from the deployed shape down to the
 * pressed shape the 3-D view shows at full compression (shapeAt(g, 1)).
 */
export function snapRange(g) {
  return { lo: shapeAt(g, 1).H, hi: shapeAt(g, 0).H };
}

/**
 * Largest |dE/dH_total| along the path (N for polyimide) between floor
 * heights lo and hi (whole path when omitted): the force needed to push the
 * tube through that stretch of its fold.
 */
export function pathPeakForce(path, lo = -Infinity, hi = Infinity) {
  if (!path) return null;
  let peak = 0;
  for (let i = 1; i < path.H.length; i++) {
    if (path.H[i - 1] < lo - 1e-9 || path.H[i] > hi + 1e-9) continue;
    const dh = (path.H[i] - path.H[i - 1]) * path.totalFloors;
    if (dh > 0) peak = Math.max(peak, Math.abs((path.E[i] - path.E[i - 1]) / dh));
  }
  return peak;
}

/** Snap force (N for polyimide) of the design: pathPeakForce over snapRange. */
export function snapForce(p, g, steps = 400) {
  const path = foldEnergyPath(p, g, steps);
  if (!path) return null;
  const { lo, hi } = snapRange(g);
  return pathPeakForce(path, lo, hi);
}
