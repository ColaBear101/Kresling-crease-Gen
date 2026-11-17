// 3-D mesh of the folded tube (whole stack), shared by the 3-D view and STL export.
//
// Ring k (0..N) has n vertices at height z_k and angle offset theta_k:
//   z_{k+1} = z_k + H_k,  theta_{k+1} = theta_k + sigma_k * phi_k
// sigma_k = +1 for a right-handed floor, -1 for a mirrored one (alternating
// stacking mirrors every odd floor). Left-handed designs mirror the result.
//
// End rings (opts.endRings: one band height in mm for both ends, or { bottom, top };
// 0 = none): the plain bands of the printed sheet, glued into loops. Each stands
// upright on its end polygon, a prism of n vertical rectangles through the polygon
// edges: below ring 0 (z from -bottom to 0) and above ring N (z from height to
// height + top). Each ring that is not 0 adds one ring of vertices after ring N:
// the bottom rim first (index rimBottom), then the top rim (rimTop). Ring 0 / ring N
// is then an end-ring fold (family 'end', kind design.folds.end) and its rim the
// cut edge (family 'rim'); an end without a ring is itself the cut edge (family
// 'end', kind 'cut'). With a stack count the rings are at the two ends of the whole
// tube only.
//
//   buildTube(design, Hs, phis, { endRings = 0 } = {}) -> {
//     n, N, rings: [[ [x,y,z] x n ] x (N+1, plus one rim per end ring)],
//     faces: [{ v: [[ring, i], [ring, i], [ring, i]], floor, panel? }]   CCW seen from outside;
//                         floor -1 / N: end rings, whose two triangles per flat panel share `panel`
//     edges: [{ a: [ring, i], b: [ring, i], family, kind }]        family: ring|end|rim|long|short
//     height (ring N above ring 0), radius, endRings { bottom, top } (mm),
//     rimBottom, rimTop (ring index, or null without that ring), zMin, zMax (whole mesh)
//   }
//   ringHeights(spec) -> { bottom, top }   spec: one height for both rings, or { bottom, top }
//   foldStates(design, compress, mode, phiOfH) -> { Hs, phis }   per-floor heights and twists
//   point(tube, [ring, i]) -> [x, y, z]

const TAU = Math.PI * 2;

export function buildTube(design, Hs, phis, opts = {}) {
  const { n, R, totalFloors: N } = design;
  const { bottom: eB, top: eT } = ringHeights(opts.endRings);
  const alt = design.stacking !== 'helical';
  const mirror = design.chirEff < 0 ? -1 : 1;
  const rings = [];
  let z = 0, theta = 0;
  const sig = [];
  for (let k = 0; k <= N; k++) {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const t = mirror * (i * TAU / n + theta);
      ring.push([R * Math.cos(t), R * Math.sin(t), z]);
    }
    rings.push(ring);
    if (k < N) {
      const s = alt && k % 2 === 1 ? -1 : 1;
      sig.push(s);
      z += Hs[k];
      theta += s * phis[k];
    }
  }
  const mod = (i) => ((i % n) + n) % n;
  const faces = [];
  const edges = [];
  const folds = design.folds || { ring: 'mountain', long: 'valley', short: 'mountain', end: 'mountain' };
  for (let k = 0; k < N; k++) {
    const P = (i) => [k, mod(i)], Q = (i) => [k + 1, mod(i)];
    for (let i = 0; i < n; i++) {
      if (sig[k] > 0) {
        faces.push({ v: [P(i), P(i + 1), Q(i)], floor: k });
        faces.push({ v: [P(i), Q(i), Q(i - 1)], floor: k });
        edges.push({ a: P(i), b: Q(i), family: 'long', kind: folds.long });
        edges.push({ a: P(i), b: Q(i - 1), family: 'short', kind: folds.short });
      } else {
        faces.push({ v: [P(i), P(i + 1), Q(i + 1)], floor: k });
        faces.push({ v: [P(i), Q(i + 1), Q(i)], floor: k });
        edges.push({ a: P(i), b: Q(i), family: 'long', kind: folds.long });
        edges.push({ a: P(i), b: Q(i + 1), family: 'short', kind: folds.short });
      }
    }
  }
  for (let k = 0; k <= N; k++) {
    const end = k === 0 || k === N;
    const ringed = (k === 0 ? eB : eT) > 0;               // this end carries an end ring
    for (let i = 0; i < n; i++) {
      edges.push({ a: [k, i], b: [k, mod(i + 1)], family: end ? 'end' : 'ring', kind: end ? (ringed ? folds.end : 'cut') : folds.ring });
    }
  }
  // rims: ring 0 moved down by the bottom ring, ring N up by the top ring (no twist:
  // the bands are straight); each only when that ring is not 0
  const B = eB ? rings.push(rings[0].map(([x, y, zz]) => [x, y, zz - eB])) - 1 : null;
  const T = eT ? rings.push(rings[N].map(([x, y, zz]) => [x, y, zz + eT])) - 1 : null;
  for (let i = 0; i < n; i++) {
    const j = mod(i + 1);
    // in the unmirrored frame i runs anticlockwise seen from above, i.e. left to right seen from outside;
    // `panel` pairs the two triangles of one flat ring panel (bottom 0..n-1, top n..2n-1)
    if (B !== null) {
      faces.push({ v: [[B, i], [B, j], [0, j]], floor: -1, panel: i });
      faces.push({ v: [[B, i], [0, j], [0, i]], floor: -1, panel: i });
    }
    if (T !== null) {
      faces.push({ v: [[N, i], [N, j], [T, j]], floor: N, panel: n + i });
      faces.push({ v: [[N, i], [T, j], [T, i]], floor: N, panel: n + i });
    }
    if (B !== null) edges.push({ a: [B, i], b: [B, j], family: 'rim', kind: 'cut' });
    if (T !== null) edges.push({ a: [T, i], b: [T, j], family: 'rim', kind: 'cut' });
  }
  if (mirror < 0) for (const f of faces) f.v = [f.v[0], f.v[2], f.v[1]];   // keep CCW from outside
  return {
    n, N, rings, faces, edges, height: z, radius: R,
    endRings: { bottom: eB, top: eT }, rimBottom: B, rimTop: T, zMin: -eB, zMax: z + eT,
  };
}

/** End-ring heights { bottom, top } (mm, 0 = none) from one height for both, or { bottom, top }. */
export function ringHeights(spec) {
  const pos = (x) => { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : 0; };
  if (spec && typeof spec === 'object') return { bottom: pos(spec.bottom), top: pos(spec.top) };
  const v = pos(spec);
  return { bottom: v, top: v };
}

export function point(tube, [ring, i]) {
  return tube.rings[ring][i];
}

/**
 * Per-floor heights/twists for a fold progress `compress` in [0, 1].
 *   mode 'uniform': every floor at the same height, from deployed (0) to folded (1)
 *   mode 'sequential': floors collapse one after another, top floor first
 *   phiOfH(H): relaxed twist at floor height H (from the energy analysis). If
 *   omitted, the twist is interpolated linearly between the two states.
 * Monostable designs (no folded state) compress to 40% of the deployed height.
 */
export function foldStates(design, compress, mode = 'uniform', phiOfH = null) {
  const N = design.totalFloors;
  const dep = design.states.deployed;
  const fol = design.states.folded;
  const H0 = dep.H;
  const H1 = fol && fol.ok ? fol.H : 0.4 * H0;
  const phi1 = fol && fol.ok ? fol.phi : dep.phi;
  const at = (u) => {
    const H = H0 + (H1 - H0) * u;
    const phi = phiOfH ? phiOfH(H) : dep.phi + (phi1 - dep.phi) * u;
    return [H, phi];
  };
  const c = Math.min(1, Math.max(0, compress));
  const Hs = [], phis = [];
  for (let k = 0; k < N; k++) {
    let u = c;
    if (mode === 'sequential') {
      const order = N - 1 - k;                  // top floor folds first
      u = Math.min(1, Math.max(0, c * N - order));
    }
    const [H, phi] = at(u);
    Hs.push(H); phis.push(phi);
  }
  return { Hs, phis };
}
