// Energy landscape of one Kresling floor under axial load with free twist.
//
// Per floor, H from 0 to 1.15 x the deployed height (241 samples): relaxed
// twist phi (rad), energy E (mJ), force F = dE/dH (N; the compressive load that
// holds height H is P = -F), its membrane and hinge parts, and the largest
// principal Green strain in the panels. Wells, barrier and snap/release
// forces come from analysePath (mechanics.js): "deployed" is the tallest well,
// "folded" the lowest one when there are two.
//
// A well at H = 0 (floor pressed flat, held by contact) only counts when the
// panels can take it: a contact well needing more strain than
// params.strainMax is dropped, because the sheet would tear or yield first
// (stiff panels on monostable designs produce such artefacts).
//
//   energyAnalysis(design) -> EnergyResult (CONTRACT §5)              memoised
//   energyAnalysisWith(design, { samples = 241, scan = 72, hinges = true })
//       -> EnergyResult, not memoised (coarser paths for sweeps and the
//          explorer; hinges: false leaves only the membranes)
//   phiAtHeightFn(design) -> (H) => phi, or null when invalid          memoised
//   strainCheck(design) -> { ok, peak, atH, limit, pass }              memoised
//   strainCheckOf(design, energy) -> the same for an EnergyResult in hand
//   floorModel(design, { hinges = true }) -> makeFloorModel(...) of one floor
//   peakPanelStrain(model, H, phi) -> largest principal Green strain (fraction)
//   memoByParams(fn, size = 8) -> fn(design, ...args) memoised on
//       JSON.stringify(design.params) and the extra arguments
//   invalidResult(design) -> { ok: false, reason } or null when usable
//
// Units: mm, rad, mJ, N. Results are shared between callers: treat them as
// read-only. `floors` is the number of floors in the whole stack (uniform
// folding multiplies energies by it and leaves forces unchanged).

import { makeFloorModel, energyPath, analysePath } from './mechanics.js';
import { TAU } from '../core/kresling.js';

export const MEMO_SIZE = 8;
export const HMAX_FACTOR = 1.15;

/** Memoise fn(design, ...args) on the design params plus the extra arguments (LRU). */
export function memoByParams(fn, size = MEMO_SIZE) {
  const cache = new Map();
  return function memoised(design, ...args) {
    const key = JSON.stringify(design && design.params ? design.params : null) + '|' + JSON.stringify(args);
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const value = fn(design, ...args);
    cache.set(key, value);
    while (cache.size > size) cache.delete(cache.keys().next().value);
    return value;
  };
}

/** { ok: false, reason } for designs the mechanics cannot use, otherwise null. */
export function invalidResult(design) {
  if (!design || !design.params) return { ok: false, reason: 'No design to analyse.' };
  if (!design.valid || !design.strip || !design.states || !design.material) {
    return { ok: false, reason: (design.errors && design.errors[0]) || 'This design is not valid.' };
  }
  if (!(design.states.deployed.H > 0)) return { ok: false, reason: 'The deployed floor has no height.' };
  return null;
}

/** Mechanics model of one floor with the design's panel model and crease rest angles. */
export function floorModel(design, { hinges = true } = {}) {
  const { deployed, folded } = design.states;
  const opts = { stacking: design.stacking, panel: design.params.panel };
  if (hinges) {
    opts.restStates = folded.ok ? [deployed, folded] : [deployed];
    opts.restFrac = design.params.restPct / 100;
  }
  const geo = { n: design.n, R: design.R, s: design.strip.s, h: design.strip.h };
  return makeFloorModel(geo, design.material, opts);
}

/** Largest principal Green strain of the (congruent) panels in the symmetric state (H, phi). */
export function peakPanelStrain(model, H, phi) {
  const { n, R, a } = model;
  const sb = Math.sin(phi / 2), sc = Math.sin((phi - TAU / n) / 2);
  const b = Math.sqrt(H * H + 4 * R * R * sb * sb);
  const c = Math.sqrt(H * H + 4 * R * R * sc * sc);
  const [gxx, gyy, gxy] = model.cst.strain([a, c, b]);
  return (gxx + gyy) / 2 + Math.hypot((gxx - gyy) / 2, gxy);
}

function errorReason(e) {
  return `The mechanics model failed for this design (${e && e.message ? e.message : e}).`;
}

/** Energy path with chosen resolution; see the header for the result. */
export function energyAnalysisWith(design, { samples = 241, scan = 72, hinges = true } = {}) {
  const bad = invalidResult(design);
  if (bad) return bad;
  try {
    const model = floorModel(design, { hinges });
    const { deployed, folded } = design.states;
    const Hmax = HMAX_FACTOR * deployed.H;
    const rigid = folded.ok ? [deployed, folded] : [deployed];
    const path = energyPath(model, rigid, { Hmin: 0, Hmax, samples: Math.max(3, samples | 0), scan: Math.max(4, scan | 0) });
    const strain = path.H.map((H, k) => peakPanelStrain(model, H, path.phi[k]));
    const limit = design.params.strainMax / 100;
    let wells = path;
    if (path.minima.length && path.minima[0].index === 0 && strain[0] > limit) {
      wells = analysePath(path.H, path.E, path.F, { contact: false });
    }
    const restFrac = hinges ? Math.min(1, Math.max(0, design.params.restPct / 100)) : null;
    return {
      ok: true,
      H: path.H, phi: path.phi, E: path.E, F: path.F,
      membrane: path.membrane, hinge: path.hinge, strain,
      minima: wells.minima, maxima: wells.maxima,
      deployed: wells.deployed, folded: wells.bistable ? wells.folded : null,
      bistable: wells.bistable,
      barrier: wells.bistable ? wells.barrier : null,
      barrierFromDeployed: wells.bistable ? wells.barrierFromDeployed : null,
      barrierFromFolded: wells.bistable ? wells.barrierFromFolded : null,
      snapForce: wells.snapForce, releaseForce: wells.releaseForce,
      floors: design.totalFloors,
      model: { panel: model.panel, epsCr: model.epsCr, kappa: model.kappa, restFrac },
      Hmax,
    };
  } catch (e) {
    return { ok: false, reason: errorReason(e) };
  }
}

export const energyAnalysis = memoByParams((design) => energyAnalysisWith(design));

/** Peak panel strain between the two wells (deployed well down to H = 0 when monostable). */
export function strainCheckOf(design, energy) {
  if (!energy || !energy.ok) return { ok: false, reason: energy ? energy.reason : 'No energy analysis.' };
  const last = energy.H.length - 1;
  const hi = energy.deployed ? energy.deployed.index : last;
  const lo = energy.bistable && energy.folded ? energy.folded.index : 0;
  let at = lo;
  for (let k = lo; k <= hi; k++) if (energy.strain[k] > energy.strain[at]) at = k;
  const peak = energy.strain[at];
  const limit = design.params.strainMax / 100;
  return { ok: true, peak, atH: energy.H[at], limit, pass: peak <= limit };
}

export const strainCheck = memoByParams((design) => {
  const bad = invalidResult(design);
  return bad || strainCheckOf(design, energyAnalysis(design));
});

/** Relaxed twist as a function of floor height (linear interpolation, clamped to the path). */
export const phiAtHeightFn = memoByParams((design) => {
  const r = energyAnalysis(design);
  if (!r.ok) return null;
  const { H, phi } = r;
  const m = H.length;
  const H0 = H[0], H1 = H[m - 1], step = (H1 - H0) / (m - 1);
  return function phiAtHeight(h) {
    if (!(h > H0)) return phi[0];
    if (h >= H1) return phi[m - 1];
    const u = (h - H0) / step;
    const k = Math.min(m - 2, Math.floor(u));
    return phi[k] + (phi[k + 1] - phi[k]) * (u - k);
  };
});
