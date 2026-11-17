// How the design responds to sheet thickness, everything else fixed.
//
// For thicknesses log-spaced from 1/4x to 4x the current one (clamped to
// 6–1000 µm): crease hinge stiffness kappa = E t^3 / (12 (1 - nu^2) w), the
// axial stiffness of the whole stack at the deployed equilibrium with the ends
// free to twist (one floor: k = E_HH - E_Hphi^2 / E_phiphi; N floors in
// series: k / N), and the energy barrier / snap force from a coarse energy path.
// Membrane stiffness grows like t and both bending terms like t^3, so the
// thin-panel barrier tends to scale like t^3 while bistability is mostly
// decided by geometry and by the hinge rest position.
//
//   thicknessSweep(design, { samples = 21 }) -> { ok, t[] (µm), kappa[] (N/rad),
//       kAxial[] (N/mm), barrier[] (mJ per floor | null), snap[] (N | null),
//       bistable[], current (µm) }                                          memoised

import { energyAnalysisWith, floorModel, invalidResult, memoByParams } from './analysis.js';
import { findEquilibrium, symmetricStiffness } from './modal.js';
import { hingeStiffness } from './mechanics.js';

function withThickness(design, tUm) {
  const t = tUm / 1000;
  const material = { ...design.material, t };
  material.kappa = hingeStiffness({ E: material.E, nu: material.nu, t, hingeWidth: material.hingeWidth });
  return { ...design, params: { ...design.params, thick: tUm }, material };
}

function axialStiffness(design) {
  const model = floorModel(design);
  const dep = design.states.deployed;
  const eq = findEquilibrium(model, dep.H, dep.phi);
  if (eq.contact || !(eq.H > 0)) return null;
  const k = symmetricStiffness(model, eq.H, eq.phi);
  const kFree = k.pp > 0 ? k.HH - (k.Hp * k.Hp) / k.pp : k.HH;
  return kFree > 0 ? kFree / design.totalFloors : null;
}

export const thicknessSweep = memoByParams((design, opts = {}) => {
  const bad = invalidResult(design);
  if (bad) return bad;
  const samples = Math.max(3, (opts && opts.samples) | 0 || 21);
  const current = design.params.thick;
  const lo = Math.max(6, current / 4), hi = Math.min(1000, current * 4);
  const t = [], kappa = [], kAxial = [], barrier = [], snap = [], bistable = [];
  try {
    for (let i = 0; i < samples; i++) {
      const tUm = lo * Math.pow(hi / lo, i / (samples - 1));
      const d = withThickness(design, tUm);
      const en = energyAnalysisWith(d, { samples: 81, scan: 36 });
      t.push(tUm);
      kappa.push(d.material.kappa);
      kAxial.push(axialStiffness(d));
      bistable.push(Boolean(en.ok && en.bistable));
      barrier.push(en.ok && en.bistable ? en.barrierFromDeployed : null);
      snap.push(en.ok && en.bistable && en.snapForce ? en.snapForce.P : null);
    }
  } catch (e) {
    return { ok: false, reason: `The thickness sweep failed (${e && e.message ? e.message : e}).` };
  }
  return { ok: true, t, kappa, kAxial, barrier, snap, bistable, current };
});
