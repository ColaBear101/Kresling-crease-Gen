// Does the tube bow sideways before it snaps?
//
// One floor at its deployed equilibrium, bottom ring clamped and top ring
// rigid, gives the 6x6 stiffness K of the top ring (modal.js). Its lateral-
// rocking blocks are matched to a Timoshenko cantilever of length H:
//   C = K_block^-1,  C = [[H^3/(3 EI) + H/GA, H^2/(2 EI)], [H^2/(2 EI), H/EI]]
//   EI = H / C_rr,   GA = H / (C_uu - H^3/(3 EI))
// averaged over the x-z plane (ux, ry) and the y-z plane (uy, -rx; rx turns z
// toward -y). The whole stack is a column of length L = N x H with effective
// length factor K (fixed-free 2, pinned 1, fixed-pinned 0.7, fixed-fixed 0.5):
//   Pe = pi^2 EI / (K L)^2,   Pcr = Pe / (1 + Pe / GA)   (Engesser shear correction)
// compared with the snap-through push from the energy path. Interior rings are
// folds, not rigid plates, so a real stack is softer: Pcr is an upper bound.
//
//   bucklingCheck(design) -> { ok, EI, GA, length, K, Pe, Pcr, snapP, safety,
//       required, pass, endCond, H, coupling, notes[] }                  memoised
//   bucklingFrom(design, energy) -> the same for an EnergyResult in hand
//   K_FACTORS -> { endCond: K }

import { energyAnalysis, floorModel, invalidResult, memoByParams } from './analysis.js';
import { findEquilibrium, poseStiffness } from './modal.js';

export const K_FACTORS = { 'fixed-free': 2, pinned: 1, 'fixed-pinned': 0.7, 'fixed-fixed': 0.5 };

const END_NOTE = {
  'fixed-free': 'Bottom clamped, top free to sway: the weakest support.',
  pinned: 'Both ends held on the axis but free to tilt.',
  'fixed-pinned': 'Bottom clamped, top held on the axis.',
  'fixed-fixed': 'Both ends clamped square: the stiffest support.',
};

function planeFit(K, u, r, sgn, H) {
  const kuu = K[u][u], kur = sgn * K[u][r], krr = K[r][r];
  const det = kuu * krr - kur * kur;
  if (!(det > 0) || !(kuu > 0) || !(krr > 0)) return null;
  const cuu = krr / det, cur = -kur / det, crr = kuu / det;
  const EI = H / crr;
  const bendOnly = (H * H * H) / (3 * EI);
  const shear = cuu - bendOnly;
  const GA = shear > 1e-9 * cuu ? H / shear : Infinity;
  // how far the truss coupling is from a beam's H^2/(2 EI): 0 = beam-like
  const coupling = Math.abs(cur - (H * H) / (2 * EI)) / ((H * H) / (2 * EI));
  return { EI, GA, coupling };
}

export function bucklingFrom(design, energy) {
  const bad = invalidResult(design);
  if (bad) return bad;
  try {
    const p = design.params;
    const model = floorModel(design);
    const dep = design.states.deployed;
    const eq = findEquilibrium(model, dep.H, dep.phi);
    if (eq.contact || !(eq.H > 0)) return { ok: false, reason: 'The deployed floor has no free equilibrium height.' };
    const K = poseStiffness(model, eq.H, eq.phi);
    const fits = [planeFit(K, 0, 4, +1, eq.H), planeFit(K, 1, 3, -1, eq.H)].filter(Boolean);
    if (!fits.length) return { ok: false, reason: 'The floor has no lateral stiffness here.' };
    const EI = fits.reduce((s, f) => s + f.EI, 0) / fits.length;
    const GAs = fits.map((f) => f.GA);
    const GA = GAs.every((g) => Number.isFinite(g)) ? GAs.reduce((s, g) => s + g, 0) / GAs.length : Infinity;
    const coupling = fits.reduce((s, f) => s + f.coupling, 0) / fits.length;

    const Kf = K_FACTORS[p.endCond] ?? 2;
    const length = design.totalFloors * eq.H;
    const Pe = (Math.PI * Math.PI * EI) / ((Kf * length) ** 2);
    const Pcr = Number.isFinite(GA) ? Pe / (1 + Pe / GA) : Pe;
    const snapP = energy && energy.ok && energy.bistable && energy.snapForce ? energy.snapForce.P : null;
    const safety = snapP && snapP > 0 ? Pcr / snapP : null;
    const notes = [END_NOTE[p.endCond] || ''];
    if (Number.isFinite(GA) && Pe / GA > 0.25) notes.push('Shear in the folded wall cuts the buckling load noticeably.');
    if (coupling > 0.25) notes.push('One floor bends unlike a slender beam here, so treat the column result as rough.');
    notes.push('Interior rings are folds rather than rigid plates, so a real stack is softer than this: read Pcr as an upper bound.');
    if (snapP === null) notes.push('There is no snap-through to compare against: the design has a single stable state.');
    return {
      ok: true, EI, GA, length, K: Kf, Pe, Pcr, snapP, safety,
      required: p.safety, pass: safety === null ? null : safety >= p.safety,
      endCond: p.endCond, H: eq.H, coupling, notes: notes.filter(Boolean),
    };
  } catch (e) {
    return { ok: false, reason: `The buckling check failed for this design (${e && e.message ? e.message : e}).` };
  }
}

export const bucklingCheck = memoByParams((design) => {
  const bad = invalidResult(design);
  return bad || bucklingFrom(design, energyAnalysis(design));
});
