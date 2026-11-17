// Small vibrations of one floor carrying the top mass: a 6-DOF top-ring model
// in the style of Kidambi & Wang (2020), with the CST + hinge energy.
//
// Bottom ring clamped, top ring rigid. Each stable state is the true
// equilibrium: the relaxed energy E*(H) = min over phi of floorEnergy is
// minimised from the energy-path well (or the rigid state), so hinge prestress
// is included. Stiffness K = hessian6 of makePoseEnergy there, plus the
// ring-crease hinge term of floorEnergy as a function of (uz, rz), so the
// axial-torsional block matches the energy landscape. When a panel sits at its
// buckling strain (a corner of the energy) K is the unbuckled-side tangent,
// and K is averaged over the n rotations of the ring (exact n-fold symmetry).
// Mass: params.payload as a thin disc of radius R plus half of one floor's
// sheet as a thin ring, both in the top-ring plane: M = diag(m, m, m, Ixy, Ixy, Iz).
// K and M go to SI (N/m, N/rad, N*m/rad; kg, kg*m^2) and the eigenproblem is
// solved mass-normalised: M^-1/2 K M^-1/2 psi = w^2 psi, f = w / 2pi.
// Participation = share of psi in uz (axial), rz (torsion), ux+uy (lateral),
// rx+ry (rocking); lateral/rocking modes come in degenerate pairs. A flat state
// held by contact (H = 0) has no free vibration and is left out with a note.
// "deployed" is the tallest stable state, "folded" a second, lower one.
//
//   modalAnalysis(design) -> { ok, mass {top, ring, m, Iz, Ixy}, states:
//       [{ key, H, phi, E, stable, modes: [{ f, kind, participation }] }], notes }   memoised
//   modalSweep(design, { samples = 41 }) -> { ok, xLabel, x[], current, series }   memoised
//       n, R and strip height h fixed; the crease angle runs over the range
//       where a deployed state exists; x = rigid deployed twist (deg)
//   findEquilibrium(model, H, phi, { step }) -> { H, phi, E, contact }
//   poseStiffness(model, H, phi, { raw }) -> 6x6 K about the top-ring centre
//       (N/mm, N/rad, N*mm/rad; q = [ux, uy, uz, rx, ry, rz]); raw: no averaging
//   symmetricStiffness(model, H, phi) -> { HH (N/mm), Hp (N/rad), pp (N*mm/rad^2) }
//   modalMass(design) -> { top, ring, m (kg), Iz, Ixy (kg*m^2) }
//   modesOf(K, mass) -> 6 modes { f (Hz), kind, participation }, ascending
//   floorStates(model, seeds, scale) -> { states, notes }: free equilibria from seeds
//   deployedTwistRange(n, R, h, phiNow) -> { lo, hi } (rad) | null

import {
  floorEnergy, makeFloorModel, makePoseEnergy, makeCST, hessian6, jacobiEigen, foldAnglesSym, wrapAngle,
} from './mechanics.js';
import { energyAnalysis, floorModel, invalidResult, memoByParams, peakPanelStrain } from './analysis.js';
import { rigidStates, TAU } from '../core/kresling.js';

const DEG = 180 / Math.PI;
const GOLD = (Math.sqrt(5) - 1) / 2;
const AXIAL_KINDS = new Set(['axial', 'torsional', 'axial-torsional']);

/** Twist minimising floorEnergy at height H near phiC; follows the valley if it leaves the window. */
function relaxLocal(model, H, phiC, w = 0.3) {
  const E = (p) => floorEnergy(model, H, p).total;
  let lo = phiC - w, hi = phiC + w;
  for (let pass = 0; ; pass++) {
    const N = 8, step = (hi - lo) / N;
    let best = 0, bestE = Infinity;
    for (let k = 0; k <= N; k++) { const e = E(lo + k * step); if (e < bestE) { bestE = e; best = k; } }
    const c = lo + best * step;
    if ((best === 0 || best === N) && pass < 4) { lo = c - w; hi = c + w; continue; }
    let a = c - step, b = c + step;
    let x1 = b - GOLD * (b - a), x2 = a + GOLD * (b - a), f1 = E(x1), f2 = E(x2);
    for (let k = 0; k < 26; k++) {
      if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - GOLD * (b - a); f1 = E(x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + GOLD * (b - a); f2 = E(x2); }
    }
    const r = f1 < f2 ? { phi: x1, E: f1 } : { phi: x2, E: f2 };
    return r.E <= bestE ? r : { phi: c, E: bestE };
  }
}

/**
 * Stable equilibrium near (H, phi): walk downhill on the relaxed energy E*(H)
 * until it rises, then golden-section search; H stays in [0, 2 H]. contact =
 * true when the floor ends pressed flat (H = 0). step: first walking step (mm).
 */
export function findEquilibrium(model, H, phi, { step } = {}) {
  const scale = Math.max(H, 0.05 * model.R, 1e-6);
  const Hcap = 2 * scale;
  let phiRun = phi;
  const Estar = (h) => { const r = relaxLocal(model, h, phiRun); phiRun = r.phi; return r.E; };
  let d = step > 0 ? step : 0.005 * scale;
  const H0 = Math.min(Hcap, Math.max(0, H));
  const f0 = Estar(H0);
  const fUp = Estar(H0 + d);
  const fDn = H0 - d >= 0 ? Estar(H0 - d) : Infinity;
  let a, c;
  if (fUp >= f0 && fDn >= f0) { a = Math.max(0, H0 - d); c = H0 + d; }
  else {
    const dir = fUp < fDn ? 1 : -1;
    let prev = H0, b = H0 + dir * d, fb = dir > 0 ? fUp : fDn;
    for (;;) {
      d *= 1.6;
      let x = b + dir * d;
      if (dir < 0 && x <= 0) x = 0;
      if (dir > 0 && x >= Hcap) x = Hcap;
      const fx = Estar(x);
      if (fx >= fb) { a = Math.min(prev, x); c = Math.max(prev, x); break; }
      if (x === 0 || x === Hcap) { a = c = x; break; }     // still falling at the boundary
      prev = b; b = x; fb = fx;
    }
  }
  if (c > a) {
    let x1 = c - GOLD * (c - a), x2 = a + GOLD * (c - a), f1 = Estar(x1), f2 = Estar(x2);
    for (let k = 0; k < 30 && c - a > 1e-9 * scale; k++) {
      if (f1 < f2) { c = x2; x2 = x1; f2 = f1; x1 = c - GOLD * (c - a); f1 = Estar(x1); }
      else { a = x1; x1 = x2; f1 = f2; x2 = a + GOLD * (c - a); f2 = Estar(x2); }
    }
    a = c = f1 < f2 ? x1 : x2;
  }
  const r = relaxLocal(model, a, phiRun);
  const contact = a <= 1e-4 * scale;
  return { H: contact ? 0 : a, phi: r.phi, E: r.E, contact };
}

/**
 * Copy of the model for tangent stiffness at (H, phi), plus a finite-difference
 * step (mm) that stays on one side of the panel-buckling corner. Away from the
 * corner the Hessian does not depend on epsCr, so moving the corner just past
 * the stencil gives the exact one-sided (unbuckled) tangent at a stuck corner.
 */
function stiffnessSetup(model, H, phi) {
  const L = Math.min(model.a, model.b0, model.c0);
  if (!model.epsCr) return { m: model, d: 1e-5 * model.R };
  const band = 0.05 * model.epsCr;
  const e1 = peakPanelStrain(model, H, phi);
  const e2 = minPanelStrain(model, H, phi);
  let m = model, gap = Math.abs(e2 + model.epsCr);
  if (gap < band) {
    const eps = Math.max(model.epsCr, -e2) + band;
    m = { ...model, epsCr: eps, cst: makeCST([model.a, model.c0, model.b0], model.mat, eps) };
    gap = Math.abs(e2 + eps);
  }
  gap = Math.min(gap, Math.abs(e1 + m.epsCr));
  return { m, d: Math.min(1e-4 * model.R, 0.1 * gap * L) };
}

/** Smallest principal Green strain of the panels in the symmetric state (H, phi). */
function minPanelStrain(model, H, phi) {
  const { n, R, a } = model;
  const sb = Math.sin(phi / 2), sc = Math.sin((phi - TAU / n) / 2);
  const b = Math.sqrt(H * H + 4 * R * R * sb * sb);
  const c = Math.sqrt(H * H + 4 * R * R * sc * sc);
  const [gxx, gyy, gxy] = model.cst.strain([a, c, b]);
  return (gxx + gyy) / 2 - Math.hypot((gxx - gyy) / 2, gxy);
}

function ringHinge(model, H, phi) {
  if (!model.rest || !(model.kappa > 0)) return 0;
  const f = foldAnglesSym(model, H, phi);
  return 0.5 * model.kappa * model.n * model.a * wrapAngle(f.ring - model.rest.ring) ** 2;
}

function cyclicAverage(K, n) {
  const out = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let j = 0; j < n; j++) {
    const c = Math.cos((TAU * j) / n), s = Math.sin((TAU * j) / n);
    const T = [[c, -s, 0, 0, 0, 0], [s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, c, -s, 0], [0, 0, 0, s, c, 0], [0, 0, 0, 0, 0, 1]];
    for (let p = 0; p < 6; p++) {
      for (let q = 0; q < 6; q++) {
        let sum = 0;
        for (let i = 0; i < 6; i++) {
          if (T[i][p] === 0) continue;
          for (let k = 0; k < 6; k++) if (T[k][q] !== 0) sum += T[i][p] * K[i][k] * T[k][q];
        }
        out[p][q] += sum / n;
      }
    }
  }
  return out;
}

/** 6x6 stiffness of the top ring about its centre at the state (H, phi). */
export function poseStiffness(model, H, phi, { raw = false } = {}) {
  const { m, d } = stiffnessSetup(model, H, phi);
  const pose = makePoseEnergy(m, H, phi);
  const energy = m.rest && m.kappa > 0 ? (q) => pose(q) + ringHinge(m, H + q[2], phi + q[5]) : pose;
  const K = hessian6(energy, d, d / m.R);
  return raw ? K : cyclicAverage(K, m.n);
}

/** Hessian of floorEnergy in (H, phi) at the state (same one-sided tangent as poseStiffness). */
export function symmetricStiffness(model, H, phi) {
  const { m, d } = stiffnessSetup(model, H, phi);
  const dp = d / m.R;
  const f = (u, v) => floorEnergy(m, u, v).total;
  const f0 = f(H, phi);
  return {
    HH: (f(H + d, phi) - 2 * f0 + f(H - d, phi)) / (d * d),
    pp: (f(H, phi + dp) - 2 * f0 + f(H, phi - dp)) / (dp * dp),
    Hp: (f(H + d, phi + dp) - f(H + d, phi - dp) - f(H - d, phi + dp) + f(H - d, phi - dp)) / (4 * d * dp),
  };
}

/** Top-ring mass in SI: payload disc of radius R plus half of one floor's sheet as a ring. */
export function modalMass(design) {
  const R = design.R / 1000;
  const top = Math.max(0, design.params.payload) / 1000;
  const ring = (0.5 * design.sheet.mass) / design.totalFloors / 1000;
  return {
    top, ring, m: top + ring,
    Iz: (top * R * R) / 2 + ring * R * R,
    Ixy: (top * R * R) / 4 + (ring * R * R) / 2,
  };
}

function modeKind(p) {
  const top = ['axial', 'torsion', 'lateral', 'rocking'].reduce((best, k) => (p[k] > p[best] ? k : best), 'axial');
  if (top === 'axial' || top === 'torsion') {
    if (p.axial >= 0.25 && p.torsion >= 0.25) return 'axial-torsional';
    return top === 'axial' ? 'axial' : 'torsional';
  }
  if (p.lateral >= 0.25 && p.rocking >= 0.25) return 'lateral-rocking';
  return top;
}

// mm-based stiffness entries to SI: N/mm -> N/m (x1000), N*mm/rad -> N*m/rad (x1e-3), N/rad unchanged
const toSI = (i, j) => (i < 3 && j < 3 ? 1e3 : i >= 3 && j >= 3 ? 1e-3 : 1);

/** Natural frequencies and mode classes for stiffness K (mm units) and mass (SI). */
export function modesOf(K, mass) {
  const diag = [mass.m, mass.m, mass.m, mass.Ixy, mass.Ixy, mass.Iz];
  const w = diag.map((x) => 1 / Math.sqrt(x));
  const A = [];
  let scale = 0;
  for (let i = 0; i < 6; i++) {
    A.push([]);
    for (let j = 0; j < 6; j++) A[i].push(0.5 * (K[i][j] + K[j][i]) * toSI(i, j) * w[i] * w[j]);
    scale = Math.max(scale, Math.abs(A[i][i]));
  }
  scale = scale || 1;
  const { values, vectors } = jacobiEigen(A.map((row) => row.map((x) => x / scale)));
  return values.map((lam, k) => {
    const v = vectors[k];
    const nn = v.reduce((sum, x) => sum + x * x, 0) || 1;
    const participation = {
      axial: (v[2] * v[2]) / nn,
      torsion: (v[5] * v[5]) / nn,
      lateral: (v[0] * v[0] + v[1] * v[1]) / nn,
      rocking: (v[3] * v[3] + v[4] * v[4]) / nn,
    };
    const mode = { f: Math.sqrt(Math.max(0, lam * scale)) / TAU, kind: modeKind(participation), participation };
    if (lam < 0) mode.unstable = true;
    return mode;
  });
}

const sameState = (a, b, scale) => Math.abs(a.H - b.H) <= 0.02 * scale && Math.abs(a.phi - b.phi) <= 0.02;

const contactNote = (key) => `The ${key} state rests flat on contact (H = 0), so it has no free vibration.`;

/**
 * Free stable equilibria from seeds [{ key, H, phi, step }]: contact states are
 * dropped with a note, seeds sliding into one well are merged, and survivors
 * are relabelled by height (the tallest is 'deployed').
 */
export function floorStates(model, seeds, scale) {
  const states = [], notes = [];
  for (const seed of seeds) {
    const eq = findEquilibrium(model, seed.H, seed.phi, { step: seed.step });
    if (eq.contact) { notes.push(contactNote(seed.key)); continue; }
    if (states.some((s) => sameState(s, eq, scale))) continue;
    states.push({ key: seed.key, ...eq });
  }
  states.sort((p, q) => q.H - p.H);
  states.forEach((s, i) => { s.key = i === 0 ? 'deployed' : 'folded'; });
  return { states: states.slice(0, 2), notes };
}

function stateModes(model, eq, mass) {
  const modes = modesOf(poseStiffness(model, eq.H, eq.phi), mass);
  return { key: eq.key, H: eq.H, phi: eq.phi, E: eq.E, stable: modes.every((m) => !m.unstable), modes };
}

export const modalAnalysis = memoByParams((design) => {
  const bad = invalidResult(design);
  if (bad) return bad;
  const energy = energyAnalysis(design);
  if (!energy.ok) return { ok: false, reason: energy.reason };
  try {
    const model = floorModel(design);
    const mass = modalMass(design);
    const step = energy.H[1] - energy.H[0];
    const seeds = [];
    const seed = (key, w) => seeds.push({ key, H: energy.H[w.index], phi: energy.phi[w.index], step });
    if (energy.deployed) seed('deployed', energy.deployed);
    if (energy.bistable && energy.folded) seed('folded', energy.folded);
    const { states, notes } = floorStates(model, seeds, design.states.deployed.H);
    const out = states.map((eq) => stateModes(model, eq, mass));
    for (const s of out) if (!s.stable) notes.push(`The ${s.key} state is unstable in the 6-DOF model (a stiffness eigenvalue is negative).`);
    if (!out.length) return { ok: false, reason: notes[0] || 'No stable state to vibrate about.', mass, notes };
    return { ok: true, mass, states: out, notes };
  } catch (e) {
    return { ok: false, reason: `Modal analysis failed for this design (${e && e.message ? e.message : e}).` };
  }
});

/** Range of rigid deployed twist (rad) at fixed n, R, h where the deployed state exists. */
export function deployedTwistRange(n, R, h, phiNow) {
  const a = 2 * R * Math.sin(Math.PI / n);
  const lo0 = Math.PI / n, hi0 = Math.min(Math.PI, Math.PI / n + Math.PI / 2);
  const ok = (phi) => {
    const s = a / 2 + R * Math.sin(phi - Math.PI / n);
    const st = rigidStates(n, R, s, h).states[0];
    return Boolean(st && st.ok && st.H > 1e-3 * h);
  };
  const N = 720;
  const at = (k) => lo0 + ((hi0 - lo0) * k) / N;
  const good = [];
  for (let k = 0; k <= N; k++) good.push(ok(at(k)));
  // the valid run holding the current twist (or the nearest valid sample)
  let k0 = Math.min(N, Math.max(0, Math.round(((phiNow - lo0) / (hi0 - lo0)) * N)));
  if (!good[k0]) {
    let best = -1;
    for (let k = 0; k <= N; k++) if (good[k] && (best < 0 || Math.abs(k - k0) < Math.abs(best - k0))) best = k;
    if (best < 0) return null;
    k0 = best;
  }
  let i = k0, j = k0;
  while (i > 0 && good[i - 1]) i--;
  while (j < N && good[j + 1]) j++;
  const edge = (inside, outside) => {
    let p = inside, q = outside;
    for (let k = 0; k < 30; k++) { const m = (p + q) / 2; if (ok(m)) p = m; else q = m; }
    return p;
  };
  let lo = i > 0 ? edge(at(i), at(i - 1)) : at(i);
  let hi = j < N ? edge(at(j), at(j + 1)) : at(j);
  const inset = 0.005 * (hi - lo);
  lo += inset; hi -= inset;
  return hi > lo ? { lo, hi } : null;
}

const SWEEP_SERIES = [
  ['deployed-axial', 'Deployed: axial / torsion'],
  ['deployed-offaxis', 'Deployed: lateral / rocking'],
  ['folded-axial', 'Folded: axial / torsion'],
  ['folded-offaxis', 'Folded: lateral / rocking'],
];

const memoSweep = memoByParams((design, samples) => {
  const bad = invalidResult(design);
  if (bad) return bad;
  try {
    const { n, R, a } = design;
    const h = design.strip.h;
    const p = design.params;
    const range = deployedTwistRange(n, R, h, design.states.deployed.phi);
    if (!range) return { ok: false, reason: 'No crease angle gives a deployed state at this strip height.' };
    const mass = modalMass(design);
    const count = Math.max(2, samples | 0);
    const x = [];
    const ys = Object.fromEntries(SWEEP_SERIES.map(([key]) => [key, []]));
    for (let k = 0; k < count; k++) {
      const phi0 = range.lo + ((range.hi - range.lo) * k) / (count - 1);
      x.push(phi0 * DEG);
      const row = {};
      const s = a / 2 + R * Math.sin(phi0 - Math.PI / n);
      const [dep, fol] = rigidStates(n, R, s, h).states;
      if (dep && dep.ok) {
        const model = makeFloorModel({ n, R, s, h }, design.material, {
          stacking: design.stacking, panel: p.panel,
          restStates: fol && fol.ok ? [dep, fol] : [dep], restFrac: p.restPct / 100,
        });
        const seeds = [{ key: 'deployed', H: dep.H, phi: dep.phi }];
        if (fol && fol.ok) seeds.push({ key: 'folded', H: fol.H, phi: fol.phi });
        for (const eq of floorStates(model, seeds, dep.H).states) {
          const { modes } = stateModes(model, eq, mass);
          const axial = modes.find((m) => AXIAL_KINDS.has(m.kind));
          const off = modes.find((m) => !AXIAL_KINDS.has(m.kind));
          row[`${eq.key}-axial`] = axial ? axial.f : null;
          row[`${eq.key}-offaxis`] = off ? off.f : null;
        }
      }
      for (const [key] of SWEEP_SERIES) ys[key].push(row[key] ?? null);
    }
    return {
      ok: true,
      xLabel: 'Deployed twist (°)',
      x,
      current: design.twist.deployedDeg,
      series: SWEEP_SERIES.map(([key, label]) => ({ key, label, y: ys[key] })),
    };
  } catch (e) {
    return { ok: false, reason: `Modal sweep failed for this design (${e && e.message ? e.message : e}).` };
  }
});

export function modalSweep(design, { samples = 41 } = {}) {
  return memoSweep(design, samples);
}
