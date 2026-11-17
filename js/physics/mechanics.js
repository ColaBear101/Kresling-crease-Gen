// Elastic energy of a Kresling floor: membrane panels + crease hinges.
//
// Units: lengths mm, moduli MPa (N/mm^2), thickness mm  =>  energy mJ (N*mm),
// force N, stiffness N/mm.
//
// Panels are constant-strain triangles (CST) with a plane-stress St Venant–
// Kirchhoff law, driven by the Green strain recovered exactly from the three
// side lengths. Panels carry the in-plane stretching that makes the two rigid
// states the only zero-energy configurations, so this is what produces
// bistability (Guest & Pellegrino 1994; Cai et al. 2015). Creases are linear
// torsion springs, energy 1/2 * kappa * L * (rho - rho0)^2 with
// kappa = E t^3 / (12 (1 - nu^2) w) per unit length (Filipov et al. 2015), w
// being the effective hinge width. Rings stay rigid regular n-gons (the usual
// truss-model assumption, Kidambi & Wang 2020).

import { chord, ringVertex, foldAngle, sub, norm, cross, dot, TAU } from '../core/kresling.js';

function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) throw new Error('degenerate triangle');
  const k = 1 / det;
  return [
    [A * k, -(b * i - c * h) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, -(a * f - c * d) * k],
    [C * k, -(a * h - b * g) * k, (a * e - b * d) * k],
  ];
}

/** Wrap an angle difference into (-pi, pi]; fold angles live on [-pi, pi]. */
export function wrapAngle(x) {
  return x - TAU * Math.round(x / TAU);
}

/**
 * Membrane energy of one triangle with rest sides [AB, BC, CA].
 * Returns { energy(cur), strain(cur), minPrincipalStress(cur), area } for
 * current sides cur = [AB, BC, CA].
 *
 * epsCr (optional): compressive buckling strain of the panel. A thin panel
 * cannot carry more compression than its plate-buckling stress; past that it
 * wrinkles and carries a constant stress. With epsCr set, each principal
 * strain below -epsCr is capped and the extra shortening costs only that
 * plateau stress (energy stays C1). Without it the panel is a plain
 * St Venant–Kirchhoff membrane: an upper bound that ignores buckling.
 */
export function makeCST(rest, { E, nu, t }, epsCr = null) {
  const [l0, l1, l2] = rest;
  const cx = (l0 * l0 + l2 * l2 - l1 * l1) / (2 * l0);
  const cy = Math.sqrt(Math.max(0, l2 * l2 - cx * cx));
  const area = 0.5 * l0 * cy;
  const edges = [[l0, 0], [cx - l0, cy], [-cx, -cy]];
  const Minv = inv3(edges.map(([x, y]) => [x * x, y * y, 2 * x * y]));
  const k = (E * t * area) / (2 * (1 - nu * nu));
  const r2 = [l0 * l0, l1 * l1, l2 * l2];
  function strain(cur) {
    const d0 = (cur[0] * cur[0] - r2[0]) / 2, d1 = (cur[1] * cur[1] - r2[1]) / 2, d2 = (cur[2] * cur[2] - r2[2]) / 2;
    return [
      Minv[0][0] * d0 + Minv[0][1] * d1 + Minv[0][2] * d2,
      Minv[1][0] * d0 + Minv[1][1] * d1 + Minv[1][2] * d2,
      Minv[2][0] * d0 + Minv[2][1] * d1 + Minv[2][2] * d2,
    ];
  }
  function energy(cur) {
    const [gxx, gyy, gxy] = strain(cur);
    if (epsCr === null) {
      const tr = gxx + gyy;
      return k * ((1 - nu) * (gxx * gxx + gyy * gyy + 2 * gxy * gxy) + nu * tr * tr);
    }
    const m = (gxx + gyy) / 2, r = Math.hypot((gxx - gyy) / 2, gxy);
    const e1 = m + r, e2 = m - r;
    const c1 = Math.max(e1, -epsCr), c2 = Math.max(e2, -epsCr);
    const x1 = Math.max(0, -e1 - epsCr), x2 = Math.max(0, -e2 - epsCr);
    return k * (c1 * c1 + c2 * c2 + 2 * nu * c1 * c2 + 2 * epsCr * (x1 + x2));
  }
  /** Most compressive principal membrane stress (MPa, negative = compression). */
  function minPrincipalStress(cur) {
    const [gxx, gyy, gxy] = strain(cur);
    const f = E / (1 - nu * nu);
    const sxx = f * (gxx + nu * gyy), syy = f * (gyy + nu * gxx), sxy = (E / (1 + nu)) * gxy;
    const m = (sxx + syy) / 2, r = Math.hypot((sxx - syy) / 2, sxy);
    return m - r;
  }
  return { energy, strain, minPrincipalStress, area };
}

/** Rotational stiffness per unit crease length, N*mm/(mm*rad) = N/rad. */
export function hingeStiffness({ E, nu, t, hingeWidth }) {
  return (E * t * t * t) / (12 * (1 - nu * nu) * hingeWidth);
}

/**
 * Compressive buckling strain of a triangular panel: plate buckling
 * sigma_cr = k pi^2 E t^2 / (12 (1 - nu^2) w^2) with k = 4 (simply supported
 * edges) and w the panel's shortest altitude.
 */
export function panelBucklingStrain(sides, { nu, t }) {
  const [p, q, r] = sides;
  const sp = (p + q + r) / 2;
  const area = Math.sqrt(Math.max(0, sp * (sp - p) * (sp - q) * (sp - r)));
  const w = (2 * area) / Math.max(p, q, r);
  return (4 * Math.PI * Math.PI * t * t) / (12 * (1 - nu * nu) * w * w);
}

/**
 * Build the mechanical model of one floor.
 *   geo: { n, R, s, h }           canonical strip (js/core/kresling.js)
 *   mat: { E, nu, t, hingeWidth } MPa, -, mm, mm
 *   opts.stacking: 'alternate' | 'helical'   (affects the ring-fold angle only)
 *   opts.panel: 'thin' (default, panels buckle) | 'stiff' (stretch only, upper bound)
 *   opts.rest: { H, phi }          stress-free hinge state (omit for no hinges), or
 *   opts.restStates: [{H,phi}, {H,phi}] with opts.restFrac in [0,1]: hinge rest
 *                    angles interpolated between deployed (0) and folded (1)
 */
export function makeFloorModel(geo, mat, opts = {}) {
  const { n, R, s, h } = geo;
  const a = chord(n, R);
  const b0 = Math.hypot(s, h);
  const c0 = Math.hypot(s - a, h);
  // every panel is congruent: sides [a, b0, c0] in this order around the triangle
  // T1 = (P_i, P_{i+1}, Q_i): P_iP_{i+1} = a, P_{i+1}Q_i = c, Q_iP_i = b
  const sides = [a, c0, b0];
  const panel = opts.panel === 'stiff' ? 'stiff' : 'thin';
  const epsCr = panel === 'thin' ? panelBucklingStrain(sides, mat) : null;
  const cst = makeCST(sides, mat, epsCr);
  const kappa = hingeStiffness(mat);
  const stacking = opts.stacking || 'alternate';
  const model = { n, R, a, b0, c0, s, h, mat, kappa, cst, stacking, panel, epsCr, rest: null };
  if (opts.rest) model.rest = foldAnglesSym(model, opts.rest.H, opts.rest.phi);
  else if (opts.restStates && opts.restStates.length) {
    const f = Math.min(1, Math.max(0, opts.restFrac ?? 0));
    const A = foldAnglesSym(model, opts.restStates[0].H, opts.restStates[0].phi);
    const B = opts.restStates[1] ? foldAnglesSym(model, opts.restStates[1].H, opts.restStates[1].phi) : A;
    model.rest = {
      long: (1 - f) * A.long + f * B.long,
      short: (1 - f) * A.short + f * B.short,
      ring: (1 - f) * A.ring + f * B.ring,
    };
  }
  return model;
}

/** Fold angles (rad, + mountain) of the three crease families in the symmetric state (H, phi). */
export function foldAnglesSym(model, H, phi) {
  const { n, R, stacking } = model;
  const P = (i) => ringVertex(R, n, i, 0, 0);
  const Q = (i) => ringVertex(R, n, i, H, phi);
  const long = foldAngle(P(0), Q(0), Q(-1), P(1));
  const short = foldAngle(P(0), Q(-1), P(-1), Q(0));
  // ring Q: lower triangle (P1, Q1, Q0); upper triangle depends on stacking
  const S = stacking === 'helical'
    ? ringVertex(R, n, 0, 2 * H, 2 * phi)        // (Q0, Q1, S0) of a same-handed floor
    : ringVertex(R, n, 1, 2 * H, 0);             // (Q0, Q1, S1) of the mirrored floor
  const ring = foldAngle(Q(0), Q(1), S, P(1));
  return { long, short, ring };
}

/**
 * Energy of one floor in the symmetric state (H, phi), counting its 2n panels,
 * n long + n short creases and the n ring creases of one interior ring.
 */
export function floorEnergy(model, H, phi) {
  const { n, R, a, cst, kappa, rest, b0, c0 } = model;
  const sb = Math.sin(phi / 2), sc = Math.sin((phi - TAU / n) / 2);
  const b = Math.sqrt(H * H + 4 * R * R * sb * sb);
  const c = Math.sqrt(H * H + 4 * R * R * sc * sc);
  const membrane = 2 * n * cst.energy([a, c, b]);
  let hinge = 0;
  if (rest && kappa > 0) {
    const f = foldAnglesSym(model, H, phi);
    hinge = 0.5 * kappa * n * (
      b0 * wrapAngle(f.long - rest.long) ** 2 +
      c0 * wrapAngle(f.short - rest.short) ** 2 +
      a * wrapAngle(f.ring - rest.ring) ** 2
    );
  }
  return { total: membrane + hinge, membrane, hinge, b, c };
}

function golden(f, lo, hi, iters = 48) {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo);
  let f1 = f(x1), f2 = f(x2);
  for (let k = 0; k < iters; k++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = f(x1); }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = f(x2); }
  }
  return f1 < f2 ? { x: x1, f: f1 } : { x: x2, f: f2 };
}

/** Twist that minimises the floor energy at fixed height H (ends free to rotate). */
export function relaxTwist(model, H, phiLo, phiHi, scan = 72) {
  const E = (p) => floorEnergy(model, H, p).total;
  let best = phiLo, bestE = Infinity;
  const step = (phiHi - phiLo) / scan;
  for (let k = 0; k <= scan; k++) {
    const p = phiLo + k * step;
    const e = E(p);
    if (e < bestE) { bestE = e; best = p; }
  }
  const r = golden(E, Math.max(phiLo, best - step), Math.min(phiHi, best + step));
  return r.f <= bestE ? { phi: r.x, E: r.f } : { phi: best, E: bestE };
}

/**
 * Energy landscape along axial compression with free twist.
 *   states: rigid states from rigidStates() (used to bracket the twist range)
 * Returns samples plus detected minima/maxima, barrier and snap forces.
 */
export function energyPath(model, states, { Hmin = 0, Hmax, samples = 241, scan = 72 } = {}) {
  const phis = states.map((s) => s.phi);
  const phiLo = Math.max(1e-4, Math.min(...phis) - 0.6);
  const phiHi = Math.min(Math.PI - 1e-4, Math.max(...phis) + 0.6);
  const H = [], phi = [], E = [], F = [], membrane = [], hinge = [];
  for (let k = 0; k < samples; k++) {
    const h = Hmin + ((Hmax - Hmin) * k) / (samples - 1);
    const r = relaxTwist(model, h, phiLo, phiHi, scan);
    const parts = floorEnergy(model, h, r.phi);
    H.push(h); phi.push(r.phi); E.push(r.E); membrane.push(parts.membrane); hinge.push(parts.hinge);
  }
  // force = dE*/dH by the envelope theorem: partial derivative at the relaxed twist
  for (let k = 0; k < samples; k++) {
    const dh = Math.max(1e-6, (Hmax - Hmin) * 1e-4);
    const lo = Math.max(0, H[k] - dh), hi = H[k] + dh;
    F.push((floorEnergy(model, hi, phi[k]).total - floorEnergy(model, lo, phi[k]).total) / (hi - lo));
  }
  return { H, phi, E, F, membrane, hinge, ...analysePath(H, E, F) };
}

/**
 * Stable states (local minima, including a contact-supported minimum at H = 0),
 * barrier between the two outermost wells, and peak forces. F = dE/dH, so the
 * external compressive load needed to hold height H is P = -F (positive = push).
 * snapForce: largest push needed between the deployed well and the barrier;
 * releaseForce: largest pull needed between the folded well and the barrier.
 * opts.contact = false ignores the contact-supported minimum at H = 0.
 */
export function analysePath(H, E, F, { contact = true } = {}) {
  const m = H.length;
  const minima = [], maxima = [];
  for (let k = 1; k < m - 1; k++) {
    if (E[k] <= E[k - 1] && E[k] < E[k + 1]) minima.push(k);
    if (E[k] >= E[k - 1] && E[k] > E[k + 1]) maxima.push(k);
  }
  if (contact && m > 1 && H[0] <= 1e-9 && E[1] > E[0]) minima.unshift(0); // flat, held by contact
  if (m > 1 && E[m - 1] < E[m - 2]) minima.push(m - 1);                   // still falling at Hmax
  const wells = minima.map((k) => ({ index: k, H: H[k], E: E[k] }));
  const result = { minima: wells, maxima: maxima.map((k) => ({ index: k, H: H[k], E: E[k] })) };
  const deployed = wells.length ? wells[wells.length - 1] : null;
  const folded = wells.length > 1 ? wells[0] : null;
  result.deployed = deployed;
  result.folded = folded;
  result.bistable = Boolean(deployed && folded && deployed.index !== folded.index);
  if (result.bistable) {
    let top = folded.index;
    for (let k = folded.index; k <= deployed.index; k++) if (E[k] > E[top]) top = k;
    result.barrier = { index: top, H: H[top], E: E[top] };
    result.barrierFromDeployed = E[top] - deployed.E;
    result.barrierFromFolded = E[top] - folded.E;
    let pk = deployed.index, tk = folded.index;
    for (let k = top; k <= deployed.index; k++) if (-F[k] > -F[pk]) pk = k;     // compressive peak
    for (let k = folded.index; k <= top; k++) if (F[k] > F[tk]) tk = k;          // tensile peak
    result.snapForce = { index: pk, H: H[pk], P: -F[pk] };
    result.releaseForce = { index: tk, H: H[tk], P: F[tk] };
  } else {
    result.barrier = null;
    result.snapForce = null;        // no snap-through without a second well
    result.releaseForce = null;
  }
  return result;
}

/**
 * Energy of one floor for an arbitrary rigid motion of the top ring
 * (bottom ring clamped), for stiffness / modal analysis.
 *   q = [ux, uy, uz, rx, ry, rz]  translations (mm) and rotation vector (rad)
 *   about the top ring centre of the reference state (H, phi).
 * Ring creases are clamped to rigid end plates and carry no hinge energy here;
 * long and short creases do.
 */
export function makePoseEnergy(model, H, phi) {
  const { n, R, cst, kappa, rest, b0, c0 } = model;
  const P = [], Q0 = [];
  for (let i = 0; i < n; i++) { P.push(ringVertex(R, n, i, 0, 0)); Q0.push(ringVertex(R, n, i, H, phi)); }
  const ctr = [0, 0, H];
  const mod = (i) => ((i % n) + n) % n;
  return function energy(q) {
    const [ux, uy, uz, rx, ry, rz] = q;
    // Rodrigues rotation
    const th = Math.hypot(rx, ry, rz);
    let Rm;
    if (th < 1e-14) Rm = [[1, -rz, ry], [rz, 1, -rx], [-ry, rx, 1]];
    else {
      const kx = rx / th, ky = ry / th, kz = rz / th, c = Math.cos(th), s = Math.sin(th), v = 1 - c;
      Rm = [
        [c + kx * kx * v, kx * ky * v - kz * s, kx * kz * v + ky * s],
        [ky * kx * v + kz * s, c + ky * ky * v, ky * kz * v - kx * s],
        [kz * kx * v - ky * s, kz * ky * v + kx * s, c + kz * kz * v],
      ];
    }
    const Q = Q0.map((p) => {
      const d = sub(p, ctr);
      return [
        ctr[0] + ux + Rm[0][0] * d[0] + Rm[0][1] * d[1] + Rm[0][2] * d[2],
        ctr[1] + uy + Rm[1][0] * d[0] + Rm[1][1] * d[1] + Rm[1][2] * d[2],
        ctr[2] + uz + Rm[2][0] * d[0] + Rm[2][1] * d[1] + Rm[2][2] * d[2],
      ];
    });
    let e = 0;
    for (let i = 0; i < n; i++) {
      const Pi = P[i], Pn = P[mod(i + 1)], Qi = Q[i], Qp = Q[mod(i - 1)];
      // T1 = (P_i, P_{i+1}, Q_i): sides [P_iP_{i+1}, P_{i+1}Q_i, Q_iP_i]
      e += cst.energy([model.a, norm(sub(Qi, Pn)), norm(sub(Pi, Qi))]);
      // T2 = (P_i, Q_i, Q_{i-1}) has sides [Q_iQ_{i-1}=a, Q_{i-1}P_i=c, P_iQ_i=b]; same rest order [a, c, b]
      e += cst.energy([norm(sub(Qp, Qi)), norm(sub(Pi, Qp)), norm(sub(Qi, Pi))]);
      if (rest && kappa > 0) {
        const fl = foldAngle(Pi, Qi, Qp, Pn);
        const fs = foldAngle(Pi, Qp, P[mod(i - 1)], Qi);
        e += 0.5 * kappa * (b0 * wrapAngle(fl - rest.long) ** 2 + c0 * wrapAngle(fs - rest.short) ** 2);
      }
    }
    return e;
  };
}

/** 6x6 stiffness matrix (central differences) of a pose-energy function at q = 0. */
export function hessian6(energy, scaleT, scaleR = 1e-4) {
  const hs = [scaleT, scaleT, scaleT, scaleR, scaleR, scaleR];
  const K = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const q = new Array(6).fill(0);
  const E0 = energy(q);
  const at = (i, di, j, dj) => {
    const x = q.slice(); x[i] += di; if (j >= 0) x[j] += dj; return energy(x);
  };
  for (let i = 0; i < 6; i++) {
    const hi = hs[i];
    K[i][i] = (at(i, hi, -1, 0) - 2 * E0 + at(i, -hi, -1, 0)) / (hi * hi);
    for (let j = i + 1; j < 6; j++) {
      const hj = hs[j];
      const v = (at(i, hi, j, hj) - at(i, hi, j, -hj) - at(i, -hi, j, hj) + at(i, -hi, j, -hj)) / (4 * hi * hj);
      K[i][j] = v; K[j][i] = v;
    }
  }
  return K;
}

/** Symmetric eigen-decomposition by cyclic Jacobi rotations. Returns ascending values. */
export function jacobiEigen(A, maxSweeps = 100) {
  const m = A.length;
  const a = A.map((r) => r.slice());
  const V = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < m; p++) {
      for (let r = p + 1; r < m; r++) {
        if (Math.abs(a[p][r]) < 1e-300) continue;
        const theta = (a[r][r] - a[p][p]) / (2 * a[p][r]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < m; k++) {
          const akp = a[k][p], akr = a[k][r];
          a[k][p] = c * akp - s * akr; a[k][r] = s * akp + c * akr;
        }
        for (let k = 0; k < m; k++) {
          const apk = a[p][k], ark = a[r][k];
          a[p][k] = c * apk - s * ark; a[r][k] = s * apk + c * ark;
        }
        for (let k = 0; k < m; k++) {
          const vkp = V[k][p], vkr = V[k][r];
          V[k][p] = c * vkp - s * vkr; V[k][r] = s * vkp + c * vkr;
        }
      }
    }
  }
  const idx = [...Array(m).keys()].sort((i, j) => a[i][i] - a[j][j]);
  return { values: idx.map((i) => a[i][i]), vectors: idx.map((i) => V.map((row) => row[i])) };
}

export { cross, dot };
