// params -> design: everything the views, physics and exporters share.
//
// Lengths in mm, angles in radians (fields ending in Deg are degrees),
// material in MPa / mm / g per mm^3.

import {
  chord, stripFromHeights, stripFromFlat, flatAngle, rigidStates, ringVertex, foldAngle, TAU,
} from './kresling.js';
import { normalizeParams, MATERIALS } from './params.js';

const DEG = 180 / Math.PI;

/**
 * Fold angles (rad, + = mountain seen from outside) of the three crease families,
 * plus `end`: the fold where an end ring meets the first floor. The ring is the
 * band glued into a loop, standing upright on the end polygon (its faces are
 * vertical planes through the polygon edges); the last floor matches by symmetry.
 */
export function foldAnglesAt(n, R, H, phi, stacking) {
  const P = (i) => ringVertex(R, n, i, 0, 0);
  const Q = (i) => ringVertex(R, n, i, H, phi);
  const S = stacking === 'helical' ? ringVertex(R, n, 0, 2 * H, 2 * phi) : ringVertex(R, n, 1, 2 * H, 0);
  const below = [(P(0)[0] + P(1)[0]) / 2, (P(0)[1] + P(1)[1]) / 2, -1];   // on the ring, under edge P0-P1
  return {
    long: foldAngle(P(0), Q(0), Q(-1), P(1)),
    short: foldAngle(P(0), Q(-1), P(-1), Q(0)),
    ring: foldAngle(Q(0), Q(1), S, P(1)),
    end: foldAngle(P(0), P(1), Q(0), below),
  };
}

/** Range of crease angles (deg) at strip height h for which both stable states exist. */
export function bistableAngleWindow(n, R, h) {
  let lo = null, hi = null;
  for (let g = 45; g <= 170.0001; g += 0.05) {
    const st = stripFromFlat(n, R, h, g / DEG);
    const s = st.s >= st.a / 2 ? st.s : st.a - st.s;
    const rs = rigidStates(n, R, s, h);
    const ok = rs.states.length === 2 && rs.states[0].ok && rs.states[1].ok;
    if (ok) { if (lo === null) lo = g; hi = g; }
    else if (lo !== null) break;
  }
  return lo === null ? null : { lo, hi, mid: (lo + hi) / 2 };
}

/** Folded heights that keep the folded state reachable for deployed height H0. */
export function foldedHeightWindow(n, R, H0) {
  const lim = 2 * R * Math.cos(Math.PI / n);
  const minH1 = Math.sqrt(Math.max(0, H0 * H0 - lim * lim)) + 1e-6;
  return { min: minH1, max: H0, maxStroke: lim };
}

export function computeDesign(raw) {
  const p = normalizeParams(raw);
  const n = p.n;
  const D = p.dia;
  const R = D / 2;
  const a = chord(n, R);
  const errors = [];
  const warnings = [];
  const notes = [];

  // ── strip (flat geometry of one floor) ──
  let s, h;
  if (p.designBy === 'heights') {
    if (!(p.H1 < p.H0)) {
      errors.push('The folded height must be smaller than the deployed height.');
    } else {
      const st = stripFromHeights(n, R, p.H0, p.H1);
      if (!st) {
        const lim = 2 * R * Math.cos(Math.PI / n);
        errors.push(`Too much stroke for this diameter: H0² − H1² must stay below ${lim.toFixed(1)}² mm² (the polygon's inscribed diameter squared).`);
      } else { s = st.s; h = st.h; }
    }
  } else {
    const st = stripFromFlat(n, R, p.hFlat, p.angle / DEG);
    s = st.s; h = st.h;
  }

  let chirEff = p.chir;
  if (s !== undefined && s < a / 2) { s = a - s; chirEff = -chirEff; }   // canonical: long diagonal really is longer

  const design = {
    params: p, n, D, R, a, chir: p.chir, chirEff,
    floors: p.floors, stack: p.stack, totalFloors: p.floors * p.stack,
    stacking: p.stacking,
    errors, warnings, notes,
    valid: false,
  };
  if (s === undefined || errors.length) return finish(design);

  const b = Math.hypot(s, h), c = Math.hypot(s - a, h);
  design.strip = {
    s, h, b, c,
    angleDeg: flatAngle(a, s, h) * DEG,                 // short diagonal vs polygon fold (interior)
    longAngleDeg: Math.atan2(h, s) * DEG,               // long diagonal vs polygon fold
    apexDeg: Math.acos(Math.max(-1, Math.min(1, (b * b + c * c - a * a) / (2 * b * c)))) * DEG,
  };

  const rs = rigidStates(n, R, s, h);
  design.k = rs.k;
  if (rs.states.length < 2) {
    errors.push('This strip cannot close into a tube with rigid panels: the diagonals lean too far for this diameter.');
    return finish(design);
  }
  const [dep, fol] = rs.states;
  design.states = { deployed: dep, folded: fol };
  if (!dep.ok) {
    errors.push(`No reachable folded shape: ${dep.reason}.`);
    return finish(design);
  }
  design.valid = true;
  design.regime = s > a + 1e-9 ? 'classic' : 'antiprism';
  design.bistable = fol.ok && fol.H < dep.H - 1e-9;
  design.flatFoldable = fol.ok && fol.H < 1e-3 * Math.max(1, dep.H);

  if (!fol.ok) {
    if (design.regime === 'antiprism') {
      warnings.push('Crease angle at or below 90°: both diagonals lean opposite ways, so the tube has only one stable state.');
    } else {
      warnings.push(`Only one stable state: the folded state ${fol.reason}.`);
    }
  }
  if (design.flatFoldable) notes.push('Folds completely flat in its collapsed state.');

  // ── fold assignment from the real 3-D deployed shape ──
  const fa = foldAnglesAt(n, R, dep.H, dep.phi, p.stacking);
  design.foldAngles = fa;
  design.folds = {
    ring: fa.ring >= 0 ? 'mountain' : 'valley',
    long: fa.long >= 0 ? 'mountain' : 'valley',
    short: fa.short >= 0 ? 'mountain' : 'valley',
    end: fa.end >= 0 ? 'mountain' : 'valley',     // where the end rings meet the body
  };

  // ── derived quantities ──
  const N = design.totalFloors;
  const lenDep = N * dep.H;
  const lenFol = fol.ok ? N * fol.H : null;
  design.lengths = {
    floorDeployed: dep.H, floorFolded: fol.ok ? fol.H : null,
    deployed: lenDep, folded: lenFol,
    stroke: lenFol === null ? null : lenDep - lenFol,
    ratio: lenFol === null ? null : lenFol / lenDep,
  };
  const twistTotal = (phi) => (p.stacking === 'helical' ? N * phi : (N % 2) * phi);
  design.twist = {
    deployedDeg: dep.phi * DEG,
    foldedDeg: fol.ok ? fol.phi * DEG : null,
    endRotationDeployedDeg: twistTotal(dep.phi) * DEG,
    endRotationFoldedDeg: fol.ok ? twistTotal(fol.phi) * DEG : null,
    snapRotationDeg: fol.ok ? (twistTotal(fol.phi) - twistTotal(dep.phi)) * DEG : null,
  };
  design.inner = {
    deployed: 2 * R * Math.cos(dep.phi / 2),
    folded: fol.ok ? 2 * R * Math.cos(fol.phi / 2) : null,
    apothem: R * Math.cos(Math.PI / n),
  };

  // Fabrication tolerance: how far the folded height moves if the printed
  // crease angle is off by one degree (central difference on the strip).
  if (fol.ok) {
    const dg = 0.05 / DEG;
    const g0 = flatAngle(a, s, h);
    const H1at = (g) => {
      const st = stripFromFlat(n, R, h, g);
      const r2 = rigidStates(n, R, st.s, h);
      return r2.states.length === 2 && r2.states[1].ok ? r2.states[1].H : null;
    };
    const up = H1at(g0 + dg), dn = H1at(g0 - dg);
    design.tolerance = up !== null && dn !== null ? { foldedPerDeg: Math.abs(up - dn) / (2 * 0.05) } : null;
  } else design.tolerance = null;

  // ── material ──
  const mat = MATERIALS[p.material] || MATERIALS.custom;
  const t = p.thick / 1000;
  design.material = {
    key: p.material, label: mat.label,
    E: p.E * 1000, nu: p.nu, t, rho: p.rho * 1e-3, hingeWidth: p.hingeW,
    kappa: (p.E * 1000 * t ** 3) / (12 * (1 - p.nu * p.nu) * p.hingeW),
  };
  const bodyArea = N * n * a * h;                                // mm^2 of the folding body
  design.sheet = { bodyArea, mass: bodyArea * t * design.material.rho };   // grams

  if (p.scale !== 100) {
    warnings.push(`Printing at ${p.scale}% scales the folded tube to ${p.scale}% too. The press molds and the DXF follow the print scale; the tube STL stays at design size.`);
  }
  if (design.inner.deployed < 0.15 * D) warnings.push('Very small clear opening through the deployed tube.');
  return finish(design);
}

function finish(d) {
  d.status = !d.valid ? 'invalid' : d.bistable ? 'bistable' : 'monostable';
  return d;
}

/**
 * Parameters for the other design mode that describe the same pattern, so
 * switching "Design by" keeps the current tube. Returns a partial params object.
 */
export function convertMode(params, toMode) {
  const d = computeDesign(params);
  if (!d.valid) return { designBy: toMode };
  // 0.01 precision: the folded height reacts strongly to the crease angle
  if (toMode === 'flat') {
    return { designBy: 'flat', hFlat: round(d.strip.h, 0.01), angle: round(d.strip.angleDeg, 0.01), chir: d.chirEff };
  }
  if (d.bistable) {
    return { designBy: 'heights', H0: round(d.states.deployed.H, 0.01), H1: round(d.states.folded.H, 0.01), chir: d.chirEff };
  }
  return { designBy: 'heights', H0: round(d.states.deployed.H, 0.01), H1: 0, chir: d.chirEff };
}

function round(x, step) { return Math.round(x / step) * step; }

export { TAU };
