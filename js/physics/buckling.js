import { MATERIALS, springConstants } from './material.js';

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
//            bistable snap-through path — dE/dh peak, same physics as
//            energy.js's Force curve, re-derived here standalone.
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

// Self-contained re-derivation of energy.js's dihedral-angle energy path —
// kept standalone (rather than imported) because energy.js's version is
// wired directly into canvas rendering / hover state.
export function snapThroughForce(p, g) {
  const totalFloors = (p.floors || 1) * (p.stack || 1);
  const { n } = p;
  const L_r0 = g.red_len, R = g.R;
  if (!(L_r0 > 0) || !(R > 0)) return null;
  const h_max = L_r0 * 0.999, h_min = L_r0 * 0.02;
  const STEPS = 160;

  function getDihedral(h) {
    if (h <= 0 || h >= L_r0) return null;
    const dxH = Math.sqrt(Math.max(0, L_r0 * L_r0 - h * h));
    const phi = dxH / R, alpha = Math.PI / n;
    const vsub  = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
    const vcross= (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const vdot  = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    const vnorm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
    const A = [R, 0, 0];
    const B = [R*Math.cos(2*alpha), R*Math.sin(2*alpha), 0];
    const C = [R*Math.cos(phi)*Math.cos(alpha) - R*Math.sin(phi)*Math.sin(alpha),
               R*Math.cos(phi)*Math.sin(alpha) + R*Math.sin(phi)*Math.cos(alpha), h];
    const D = [R*Math.cos(phi + 2*alpha), R*Math.sin(phi + 2*alpha), h];
    const n1 = vnorm(vcross(vsub(B, A), vsub(C, A)));
    const n2 = vnorm(vcross(vsub(C, A), vsub(D, A)));
    const n3 = vnorm(vcross(vsub(C, B), vsub(A, B)));
    return {
      psi_m: Math.acos(Math.max(-1, Math.min(1,  vdot(n1, n2)))),
      psi_v: Math.acos(Math.max(-1, Math.min(1, -vdot(n1, n3)))),
    };
  }

  const rest = getDihedral(g.floor_h);
  if (!rest) return null;
  const { psi_m: psi_m0, psi_v: psi_v0 } = rest;
  const { k_m, k_v } = springConstants(p, g);

  let maxAbsF = 0, prevE = null, prevH = null;
  for (let i = 0; i <= STEPS; i++) {
    const h = h_min + (i / STEPS) * (h_max - h_min);
    const ang = getDihedral(h);
    const E = ang ? (k_m*(ang.psi_m-psi_m0)**2 + k_v*(ang.psi_v-psi_v0)**2) * n * totalFloors : 0;
    const hTot = h * totalFloors;
    if (prevE !== null) {
      const dh = hTot - prevH;
      if (dh !== 0) maxAbsF = Math.max(maxAbsF, Math.abs((E - prevE) / dh));
    }
    prevE = E; prevH = hTot;
  }
  return maxAbsF; // Newtons
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
