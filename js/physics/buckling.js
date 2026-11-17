import { MATERIALS } from './material.js';
import { snapForce } from './foldpath.js';

// ─── Structural check: does the tube buckle before it snaps? ────────────────
// This module is deliberately NOT presented as being derived from the
// Kresling-specific papers cited elsewhere in this app (Cai et al., Masana &
// Daqaq, Kidambi & Wang) — none of those give a buckling criterion. It's a
// standard textbook thin-shell/Euler-column check (Timoshenko & Gere,
// "Theory of Elastic Stability") applied to the tube as a simplified
// order-of-magnitude structural screen, not a substitute for physical
// testing or a Kresling-specific buckling analysis.
//
// Three quantities, all in Newtons, all requiring material==='polyimide'
// (the generic material's k_m/k_v are unitless placeholders, so no real
// force in Newtons can be derived from them):
//
//   Fsnap    quasi-static axial force needed to drive the tube through its
//            snap: dE/dh peak along the exact fold path, the same curve
//            energy.js draws (foldpath.js snapForce).
//   Pglobal  Euler column-buckling load, treating the tube as a thin
//            cylindrical shell strut: I = pi*R^3*t (thin-wall), Pcr =
//            pi^2*E*I/Le^2.
//   Plocal   classical local axial shell-buckling load (Timoshenko):
//            sigma_cr = E*t / (R*sqrt(3*(1-nu^2))), Pcr = sigma_cr*2*pi*R*t.
//
// A design is "buckling-safe" if min(Pglobal,Plocal) exceeds Fsnap by at
// least `safetyFactor` — i.e. the tube can actually be pushed through its
// snap-through transition without the wall collapsing first.

const GPA_TO_PA = 1e9;
const UM_TO_M   = 1e-6;
const CM_TO_M   = 1e-2;

// Force needed to push the tube through its snap: the largest |dE/dh| along
// the exact fold path the energy graph draws, between the two wells for a
// bistable design or from deployed down to the 3-D view's pressed shape
// otherwise (foldpath.js snapRange). Outside that range the curve steepens
// towards the geometric limits, which nobody pushes the tube into.
export function snapThroughForce(p, g) {
  return snapForce(p, g, 160); // Newtons for polyimide
}

export function eulerColumnBuckling(p, g, endCondition = 'pinned') {
  if (p.material !== 'polyimide') return null;
  if (!(g.R > 0) || !(p.height > 0)) return null;
  const { E_GPa } = MATERIALS.polyimide;
  const E  = E_GPa * GPA_TO_PA;
  const t  = (p.thicknessUm || 50) * UM_TO_M;
  const R  = g.R * CM_TO_M;
  const L  = p.height * CM_TO_M;
  const Le = endCondition === 'fixed-free' ? 2 * L : L; // pinned-pinned : cantilever
  const I  = Math.PI * R ** 3 * t; // thin cylindrical shell, second moment of area
  return (Math.PI ** 2 * E * I) / (Le ** 2); // Newtons
}

export function shellLocalBuckling(p, g) {
  if (p.material !== 'polyimide') return null;
  if (!(g.R > 0)) return null;
  const { E_GPa, nu } = MATERIALS.polyimide;
  const E = E_GPa * GPA_TO_PA;
  const t = (p.thicknessUm || 50) * UM_TO_M;
  const R = g.R * CM_TO_M;
  const sigma_cr = (E * t) / (R * Math.sqrt(3 * (1 - nu * nu)));
  return sigma_cr * 2 * Math.PI * R * t; // Newtons
}

// Combined verdict. Returns { available:false } when material isn't
// polyimide (no real Newtons to compare). safetyFactor is the minimum
// acceptable Pcr/Fsnap ratio — 1.0 means "just barely doesn't buckle
// first", values above 1 build in margin against manufacturing variance.
export function bucklingCheck(p, g, safetyFactor = 1.5, endCondition = 'pinned') {
  const Fsnap   = snapThroughForce(p, g);
  const Pglobal = eulerColumnBuckling(p, g, endCondition);
  const Plocal  = shellLocalBuckling(p, g);
  if (Fsnap === null || Pglobal === null || Plocal === null) return { available: false };
  const Pcr = Math.min(Pglobal, Plocal);
  const margin = Fsnap > 0 ? Pcr / Fsnap : Infinity;
  return {
    available: true,
    Fsnap, Pglobal, Plocal, Pcr,
    limitingMode: Pglobal <= Plocal ? 'global (Euler column)' : 'local (shell)',
    margin,
    safe: margin >= safetyFactor,
  };
}
