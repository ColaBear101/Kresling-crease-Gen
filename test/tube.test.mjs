// 3-D tube mesh and mold layout checks.
import { computeDesign } from '../js/core/design.js';
import { buildPattern } from '../js/core/pattern.js';
import { buildTube, foldStates, point, ringHeights } from '../js/core/tube.js';
import { moldLayout, moldNotes, MOLD_MARGIN, RIDGE_FILL } from '../js/core/mold.js';
import { DEFAULTS, PRESETS, normalizeParams, migrateParams, schemaFor } from '../js/core/params.js';
import { sub, cross, dot, norm } from '../js/core/kresling.js';
import { tubeMesh, moldMesh, moldSTL, meshStats, binarySTL, SPLIT_BELOW } from '../js/export/stl.js';
import { tubeViewMesh, paintOrder } from '../js/render/view3d.js';
import { test, near, ok, eq, run } from './harness.mjs';

const P = (o = {}) => normalizeParams({ ...DEFAULTS, ...migrateParams(o) });   // `ext`: both end rings

for (const stacking of ['alternate', 'helical']) {
  for (const chir of [1, -1]) {
    test(`deployed tube (${stacking}, chir ${chir}) has the flat crease lengths and outward faces`, () => {
      const d = computeDesign(P({ stacking, chir, stack: 2 }));
      const { Hs, phis } = foldStates(d, 0);
      const t = buildTube(d, Hs, phis);
      eq(t.rings.length, d.totalFloors + 1);
      eq(t.faces.length, 2 * d.n * d.totalFloors);
      for (const e of t.edges) {
        const L = norm(sub(point(t, e.a), point(t, e.b)));
        if (e.family === 'long') near(L, d.strip.b, 1e-9, 'long');
        if (e.family === 'short') near(L, d.strip.c, 1e-9, 'short');
        if (e.family === 'ring' || e.family === 'end') near(L, d.a, 1e-9, 'ring');
      }
      for (const f of t.faces) {
        const [A, B, C] = f.v.map((v) => point(t, v));
        const nrm = cross(sub(B, A), sub(C, A));
        const ctr = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, 0];
        ok(dot(nrm, ctr) > 0, 'face normal points outward');
      }
      near(t.height, d.lengths.deployed * 1, 1e-9);
    });
  }
}

test('folded tube (uniform) has the folded state lengths', () => {
  const d = computeDesign(P());
  const { Hs, phis } = foldStates(d, 1);
  const t = buildTube(d, Hs, phis);
  near(t.height, d.lengths.folded, 1e-9);
  for (const e of t.edges) {
    const L = norm(sub(point(t, e.a), point(t, e.b)));
    if (e.family === 'long') near(L, d.strip.b, 1e-9);
    if (e.family === 'short') near(L, d.strip.c, 1e-9);
  }
});

test('sequential folding collapses the top floor first', () => {
  const d = computeDesign(P({ floors: 4 }));
  const { Hs } = foldStates(d, 0.25, 'sequential');
  near(Hs[3], d.states.folded.H, 1e-9); near(Hs[0], d.states.deployed.H, 1e-9);
});

for (const stacking of ['alternate', 'helical']) {
  for (const chir of [1, -1]) {
    test(`end rings stand upright on the end polygons (${stacking}, chir ${chir})`, () => {
      const e = 15;
      const d = computeDesign(P({ stacking, chir, stack: 2, ext: e }));
      const N = d.totalFloors, n = d.n;
      for (const c of [0, 0.5, 1]) {
        const { Hs, phis } = foldStates(d, c);
        const bare = buildTube(d, Hs, phis);
        const t = buildTube(d, Hs, phis, { endRings: e });
        eq(t.rings.length, N + 3, 'two rims added');
        eq(t.faces.length, bare.faces.length + 4 * n, 'two triangles per polygon edge at each end');
        eq(t.endRings.bottom, e); eq(t.endRings.top, e); eq(t.rimBottom, N + 1); eq(t.rimTop, N + 2); near(t.zMin, -e, 1e-12); near(t.zMax, t.height + e, 1e-12); near(t.height, bare.height, 1e-12);
        for (let i = 0; i < n; i++) {
          const [b, p0] = [t.rings[N + 1][i], t.rings[0][i]], [top, pN] = [t.rings[N + 2][i], t.rings[N][i]];
          near(b[0], p0[0], 1e-12); near(b[1], p0[1], 1e-12); near(b[2], p0[2] - e, 1e-12);
          near(top[0], pN[0], 1e-12); near(top[1], pN[1], 1e-12); near(top[2], pN[2] + e, 1e-12);
        }
        // ring faces: vertical, outward; every face of the mesh still CCW from outside
        for (const f of t.faces) {
          const [A, B, C] = f.v.map((v) => point(t, v));
          const nrm = cross(sub(B, A), sub(C, A));
          if (f.floor === -1 || f.floor === N) {
            near(nrm[2] / norm(nrm), 0, 1e-12, 'ring face is vertical');
            ok(dot(nrm, [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, 0]) > 0, 'ring face points outward');
          }
        }
        // closed surface except the two rims: every other directed edge has its reverse
        const id = (v) => v[0] * n + v[1];
        const dir = new Set();
        for (const f of t.faces) for (let m = 0; m < 3; m++) dir.add(`${id(f.v[m])}>${id(f.v[(m + 1) % 3])}`);
        let open = 0;
        for (const k of dir) { const [a, b] = k.split('>'); if (!dir.has(`${b}>${a}`)) open++; }
        eq(open, 2 * n, 'only the rims are open');
        // the fold where a ring meets the body is an end-ring fold; the rims are cuts; all polygon length
        for (const E of t.edges) {
          if (E.family === 'end') eq(E.kind, d.folds.end, 'end-ring fold');
          if (E.family === 'rim') eq(E.kind, 'cut', 'rim is a cut edge');
          if (E.family === 'end' || E.family === 'rim') near(norm(sub(point(t, E.a), point(t, E.b))), d.a, 1e-9);
        }
        eq(t.edges.filter((E) => E.family === 'rim').length, 2 * n);
        for (const E of bare.edges) if (E.family === 'end') eq(E.kind, 'cut', 'no rings: the ends are cut edges');
      }
    });
  }
}

test('3-D view mesh shows the end rings of the sheet with the ground under them', () => {
  const d = computeDesign(P({ ext: 20 }));
  const m = tubeViewMesh(d, 0, 'uniform', null);
  eq(m.nV, (d.totalFloors + 3) * d.n);
  near(m.zMin, -20, 1e-12); near(m.zMax, d.lengths.deployed + 20, 1e-9); near(m.height, d.lengths.deployed, 1e-9);
  let cuts = 0;
  for (let e = 0; e < m.nE; e++) {
    if (m.edgeKind[e] === 2) { cuts++; eq(m.edgeNeed[e], 1, 'a rim borders one face'); }
    else eq(m.edgeNeed[e], 2, 'every fold borders two faces');
  }
  eq(cuts, 2 * d.n, 'the rims are the only cut edges');
  const none = tubeViewMesh(computeDesign(P({ ext: 0 })), 0, 'uniform', null);
  eq(none.nV, (d.totalFloors + 1) * d.n); eq(none.zMin, 0);
});

test('tube STL carries the end rings: closed shell from -ext to height + ext', () => {
  for (const [key, over] of [['default', {}], ['disc12', PRESETS.disc12.params], ['tower8', PRESETS.tower8.params]]) {
    const d = computeDesign(P({ ...over, ext: 20 }));
    const ringed = tubeMesh(d, { compress: 0 });
    const plain = tubeMesh(d, { compress: 0, endRings: 0 });
    const s1 = meshStats(binarySTL(ringed, ringed.header)), s0 = meshStats(binarySTL(plain, plain.header));
    ok(s1.watertight && s0.watertight, `${key} watertight`);
    eq(s1.degenerate, 0, `${key} no degenerate triangles`);
    near(s1.bbox.min[2], -20, 1e-3, `${key} bottom ring`); near(s1.bbox.max[2], d.lengths.deployed + 20, 1e-3, `${key} top ring`);
    near(s0.bbox.min[2], 0, 1e-3); near(s0.bbox.max[2], d.lengths.deployed, 1e-3);
    // the two rings add about a thin prism wall of polygon perimeter x wall x 2 ext
    const w = ringed.wall, shell = d.n * d.a * w - d.n * w * w * Math.tan(Math.PI / d.n);
    const added = s1.volume - s0.volume, expect = shell * 2 * 20;
    // (the difference also counts the floor walls next to the rings, which are offset differently
    // with a ring there and without one, so it is checked loosely; the shell check below is tight)
    ok(Math.abs(added - expect) < 0.15 * expect, `${key}: rings add ${added.toFixed(0)} mm3, about ${expect.toFixed(0)}`);
    ok(ringed.header.includes('rings 20') && !plain.header.includes('rings'), `${key} header`);
    eq(ringed.endRings.bottom, 20); eq(ringed.endRings.top, 20); eq(plain.endRings.bottom + plain.endRings.top, 0);
    ok(ringed.thickness.min > 0.5 * w, `${key}: wall stays above half the nominal (${ringed.thickness.min.toFixed(2)} mm)`);
  }
});

test('short end rings keep the STL wall (the upright ring edge only limits the vertical offset)', () => {
  for (const [key, over] of [['default', {}], ['disc12', PRESETS.disc12.params], ['tower8', PRESETS.tower8.params]]) {
    for (const [wall, exts] of [[0.8, [0.5, 1, 2]], [2, [5]]]) {
      const d0 = computeDesign(P({ ...over, wall, ext: 0 }));
      const bare = tubeMesh(d0, { compress: 0 });
      for (const ext of exts) {
        const d = computeDesign(P({ ...over, wall, ext }));
        const m = tubeMesh(d, { compress: 0 });
        const s = meshStats(binarySTL(m, m.header));
        ok(s.watertight && s.degenerate === 0, `${key} wall ${wall} ext ${ext} watertight`);
        ok(m.thickness.min > 0.6 * m.wall, `${key} wall ${wall} ext ${ext}: thinnest ${m.thickness.min.toFixed(3)} mm (no rings ${bare.thickness.min.toFixed(3)})`);
        near(s.bbox.min[2], -ext, 1e-3); near(s.bbox.max[2], d.lengths.deployed + ext, 1e-3);
        ok(s.volume > meshStats(binarySTL(bare, bare.header)).volume, `${key} ext ${ext}: rings add material`);
      }
    }
  }
});

test('bottom and top rings of different lengths, or only one: closed STL from -bottom to height + top', () => {
  for (const [rb, rt] of [[10, 30], [0, 15], [25, 0], [0.5, 60]]) {
    for (const over of [{}, { chir: -1 }, { stacking: 'helical' }, PRESETS.tower8.params, PRESETS.disc12.params, { ...PRESETS.disc12.params, stacking: 'helical' }]) {
      const tag = `${rb}/${rt} ${JSON.stringify(over)}`;
      const d = computeDesign(P({ ...over, ringBottom: rb, ringTop: rt }));
      const N = d.totalFloors, n = d.n;
      const { Hs, phis } = foldStates(d, 0);
      const t = buildTube(d, Hs, phis, { endRings: { bottom: rb, top: rt } });
      eq(t.rings.length, N + 1 + (rb > 0) + (rt > 0), `${tag}: one rim per ring`);
      eq(t.rimBottom, rb > 0 ? N + 1 : null); eq(t.rimTop, rt > 0 ? N + 1 + (rb > 0) : null);
      near(t.zMin, -rb, 1e-12); near(t.zMax, t.height + rt, 1e-9);
      for (const E of t.edges) {
        if (E.family !== 'end') continue;
        eq(E.kind, (E.a[0] === 0 ? rb : rt) > 0 ? d.folds.end : 'cut', `${tag}: an end with a ring folds, one without is the cut edge`);
      }
      eq(t.faces.filter((f) => f.floor === -1).length, rb > 0 ? 2 * n : 0, `${tag}: bottom ring faces`);
      eq(t.faces.filter((f) => f.floor === N).length, rt > 0 ? 2 * n : 0, `${tag}: top ring faces`);
      const m = tubeMesh(d, { compress: 0 });
      const s = meshStats(binarySTL(m, m.header));
      ok(s.watertight && s.degenerate === 0, `${tag}: watertight`);
      near(s.bbox.min[2], -rb, 1e-3, `${tag}: bottom`); near(s.bbox.max[2], d.lengths.deployed + rt, 1e-3, `${tag}: top`);
      eq(m.endRings.bottom, rb); eq(m.endRings.top, rt);
      ok(m.header.length <= 80 && m.header.includes(`${rb}/${rt}`), `${tag}: header ${m.header}`);
      // a ring under 3 mm limits how far its inner corner may move up or down (see the short-ring test)
      const least = Math.min(rb || Infinity, rt || Infinity) < 3 ? 0.6 : 0.74;
      ok(m.thickness.min > least * m.wall, `${tag}: wall ${m.thickness.min.toFixed(2)} mm`);
      const v = tubeViewMesh(d, 0, 'uniform', null);
      eq(v.nV, t.rings.length * n); near(v.zMin, -rb, 1e-12); near(v.zMax, d.lengths.deployed + rt, 1e-9);
      eq(Array.from(v.faceRing).filter((r) => r === 1).length, rb > 0 ? 2 * n : 0, `${tag}: bottom ring in the 3-D view`);
      eq(Array.from(v.faceRing).filter((r) => r === 2).length, rt > 0 ? 2 * n : 0, `${tag}: top ring in the 3-D view`);
      let cuts = 0;
      for (let e = 0; e < v.nE; e++) if (v.edgeKind[e] === 2) { cuts++; eq(v.edgeNeed[e], 1, 'a cut edge borders one face'); }
      eq(cuts, 2 * n, `${tag}: two open ends`);
    }
  }
  eq(JSON.stringify(ringHeights(12)), JSON.stringify({ bottom: 12, top: 12 }));
  eq(JSON.stringify(ringHeights({ bottom: 3, top: -1 })), JSON.stringify({ bottom: 3, top: 0 }));
  eq(JSON.stringify(ringHeights(undefined)), JSON.stringify({ bottom: 0, top: 0 }));
  // tubeSTL takes the sheet's rings by default, and one number still means both
  const d = computeDesign(P({ ringBottom: 8, ringTop: 22 }));
  const byDefault = tubeMesh(d, { compress: 0 }), both = tubeMesh(d, { compress: 0, endRings: 5 });
  eq(byDefault.endRings.bottom, 8); eq(byDefault.endRings.top, 22);
  eq(both.endRings.bottom, 5); eq(both.endRings.top, 5);
  ok(byDefault.header.includes('rings 8/22') && both.header.includes('rings 5,'), `${byDefault.header} | ${both.header}`);
});

test('mold border is left out beside an end ring too narrow for both ridges, and says so', () => {
  const cases = [
    [{ ringBottom: 0.5, ringTop: 10 }, ['bottom']], [{ ringBottom: 10, ringTop: 0.5 }, ['top']],
    [{ ringBottom: 1, ringTop: 1, scale: 50 }, ['bottom', 'top']], [{ ringBottom: 0, ringTop: 0 }, []], [{}, []],
    [{ chir: -1, ringBottom: 0.5 }, ['bottom']], [{ ringBottom: 2, ringTop: 2, scale: 25 }, ['bottom', 'top']],
  ];
  for (const [over, dropped] of cases) {
    const tag = JSON.stringify(over);
    const p = P(over);
    const m = moldLayout(buildPattern(computeDesign(p)), p);
    eq([...m.borderDropped].sort().join(), [...dropped].sort().join(), `${tag}: edges left out`);
    eq(m.border.length, 4 - dropped.length, `${tag}: border edges kept`);
    const notes = moldNotes(m).join(' ');
    for (const side of dropped) ok(notes.includes(`No border ridge along the ${side} edge`), `${tag}: ${notes}`);
    const yLo = Math.min(...m.outline.map((q) => q[1]));
    for (const e of m.border) {
      if (Math.abs(e.a[1] - e.b[1]) > 1e-9) continue;              // the two side edges
      const ring = m.rings[Math.abs(e.a[1] - yLo) < 1e-9 ? 'bottom' : 'top'];
      ok(ring === 0 || RIDGE_FILL * ring >= (m.ridgeW + m.borderW) / 2 - 1e-12, `${tag}: a kept border clears the end-fold ridge`);
    }
    for (const which of ['mountain', 'valley']) {
      const mesh = moldMesh(m, which);
      eq(mesh.borders, 4 - dropped.length, `${tag}: ${which} border prisms`);
      ok(meshStats(moldSTL(m, which)).watertight, `${tag}: ${which} plate closed`);
    }
  }
});

test('tube STL keeps its wall where floors meet: same-hand floors and end-ring corners split the inner vertex', () => {
  const shell = (m) => {     // volume / (outer area x wall): about 1 for a shell of even thickness
    const P = m.positions, T = m.triangles, nv = (P.length / 3 - m.splitVertices) / 2;
    let area = 0;
    for (let t = 0; t < T.length / 3; t++) {
      const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2];
      if (a >= 3 * nv || b >= 3 * nv || c >= 3 * nv) break;            // outer faces come first
      const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      area += norm(cross(u, v)) / 2;
    }
    return meshStats(binarySTL(m, m.header)).volume / (area * m.wall);
  };
  const designs = { default: {}, ...Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.params])) };
  let splitSome = 0;
  for (const [key, pr] of Object.entries(designs)) {
    for (const stacking of ['alternate', 'helical']) {
      for (const chir of [1, -1]) {
        for (const [rb, rt] of [[0, 0], [10, 10], [0, 25], [60, 5]]) {
          const tag = `${key} ${stacking} ${chir} rings ${rb}/${rt}`;
          const d = computeDesign(P({ ...pr, stacking, chir, ringBottom: rb, ringTop: rt }));
          const m = tubeMesh(d, { compress: 0 });
          const s = meshStats(binarySTL(m, m.header));
          ok(s.watertight && s.degenerate === 0, `${tag}: closed, no degenerate triangles`);
          ok(m.thickness.min >= 0.74 * m.wall, `${tag}: thinnest wall ${(m.thickness.min / m.wall).toFixed(2)} x`);
          const r = shell(m);
          ok(r > 0.93 && r < 1.07, `${tag}: volume ${r.toFixed(3)} x outer area x wall`);
          if (m.splitVertices) splitSome++;
        }
      }
    }
  }
  ok(splitSome > 20, `${splitSome} meshes needed split folds`);
  // the default alternating tube needs none, so its STL is as before
  eq(tubeMesh(computeDesign(P()), { compress: 0 }).splitVertices, 0);
  // the 12-gon disc with same-hand floors: 0.03 x wall before the split
  const disc = tubeMesh(computeDesign(P({ ...PRESETS.disc12.params, stacking: 'helical' })), { compress: 0 });
  ok(disc.splitVertices > 0 && disc.thickness.min > 0.9 * disc.wall, `disc ${(disc.thickness.min / disc.wall).toFixed(2)} x`);
  ok(SPLIT_BELOW > 0.5 && SPLIT_BELOW < 1);
});

test('tube wall can be as thin as 0.01 mm, in 0.01 mm steps', () => {
  const ws = schemaFor('wall');
  eq(ws.min, 0.01); eq(ws.step, 0.01); eq(ws.max, 5); eq(ws.default, 0.8);
  eq(normalizeParams({ wall: 0.05 }).wall, 0.05, 'kept as typed');
  eq(normalizeParams({ wall: 0.004 }).wall, 0.01, 'never below 0.01 mm');
  for (const wall of [0.01, 0.05, 0.09]) {
    for (const over of [{}, { stacking: 'helical' }, PRESETS.disc12.params, { ...PRESETS.disc12.params, stacking: 'helical' }, PRESETS.tower8.params]) {
      const tag = `wall ${wall} ${JSON.stringify(over)}`;
      const m = tubeMesh(computeDesign(P({ ...over, wall })), { compress: 0 });
      const s = meshStats(binarySTL(m, m.header));
      eq(m.wall, wall, `${tag}: used as set`);
      ok(s.watertight && s.degenerate === 0, `${tag}: closed, no degenerate triangles`);
      ok(m.thickness.min > 0.74 * wall && m.thickness.max < 2 * wall, `${tag}: ${(m.thickness.min / wall).toFixed(2)}-${(m.thickness.max / wall).toFixed(2)} x wall`);
      ok(m.header.includes(`wall ${wall.toFixed(2)}`), `${tag}: header ${m.header}`);
    }
  }
});

test('tube STL header fits 80 bytes without cutting the fold state', () => {
  const d = computeDesign(P({ n: 3, dia: 10, H0: 2.5, H1: 1, floors: 30, stack: 6, ext: 0.5 }));
  ok(d.valid, 'long-tag design is valid');
  for (const ext of [0.5, 12.5]) {
    const m = tubeMesh(computeDesign(P({ n: 3, dia: 10, H0: 2.5, H1: 1, floors: 30, stack: 6, ext })), { compress: 0 });
    ok(m.header.length <= 80, `${m.header.length} chars: ${m.header}`);
    ok(m.header.endsWith('deployed'), `state tag kept: ${m.header}`);
    ok(/rings? ?[\d.]+|r[\d.]+/.test(m.header), 'ring height kept');
  }
  const short = tubeMesh(computeDesign(P({ ext: 20 })), { compress: 0 });
  ok(short.header.includes('units mm') && short.header.includes('rings 20'), 'short headers keep every part');
});

test('3-D paint order: end planes separate the rings from the body; ring panels sort as one', () => {
  for (const over of [{}, { chir: -1 }, { stacking: 'helical', stack: 2 }]) {
    const d = computeDesign(P({ ...over, ext: 20 }));
    const m = tubeViewMesh(d, 0, 'uniform', null);
    // any depths and facing will do: the rule is about groups, not about this pose
    const depth = Float64Array.from({ length: m.nF }, (_, f) => ((f * 7919) % 101) / 7);
    const front = new Uint8Array(m.nF);
    for (let f = 0; f < m.nF; f++) front[f] = m.faceRing[f] ? (m.facePair[f] >= 0 ? Math.min(f, m.facePair[f]) % 3 === 0 : 1) : f % 2;
    const pos = (order) => { const p = new Int32Array(m.nF); order.forEach((f, i) => { p[f] = i; }); return p; };
    const firstBody = (p) => Math.min(...Array.from(p).filter((_, f) => !m.faceRing[f]));
    const lastBody = (p) => Math.max(...Array.from(p).filter((_, f) => !m.faceRing[f]));
    for (const [eyeZ, bottomFar, topFar] of [[m.height / 2, true, true], [m.height + 500, true, false], [-500, false, true]]) {
      const p = pos(paintOrder(m, depth, front, eyeZ));
      const fb = firstBody(p), lb = lastBody(p);
      for (let f = 0; f < m.nF; f++) {
        if (!m.faceRing[f]) continue;
        const far = m.faceRing[f] === 1 ? bottomFar : topFar;
        ok(far ? p[f] < fb : p[f] > lb, `ring face ${f} ${far ? 'before' : 'after'} the body (eye z ${eyeZ})`);
        const g = m.facePair[f];
        ok(g >= 0 && Math.abs(p[f] - p[g]) === 1, 'both halves of a ring panel are drawn together');
        for (let h = 0; h < m.nF; h++) {
          if (m.faceRing[h] === m.faceRing[f] && front[h] && !front[f]) ok(p[f] < p[h], 'inside of a ring before its outside');
        }
      }
    }
    const plain = tubeViewMesh(computeDesign(P({ ...over, ext: 0 })), 0, 'uniform', null);
    const dz = Float64Array.from({ length: plain.nF }, (_, f) => (f * 37) % 11);
    const o = paintOrder(plain, dz, new Uint8Array(plain.nF), 50);
    for (let i = 1; i < o.length; i++) ok(dz[o[i - 1]] >= dz[o[i]], 'without rings: plain far-to-near order');
  }
});

test('mold layout splits creases by kind and mirrors the valley plate', () => {
  const p = P();
  const pat = buildPattern(computeDesign(p));
  const m = moldLayout(pat, p);
  const nm = pat.segments.filter((s) => s.kind === 'mountain').length;
  const nv = pat.segments.filter((s) => s.kind === 'valley').length;
  ok(m.mountain.length > 0.9 * nm && m.mountain.length <= nm);
  ok(m.valley.length > 0.9 * nv && m.valley.length <= nv);
  for (const r of [...m.mountain, ...m.valley]) for (const q of [r.a, r.b]) ok(q[0] > 0 && q[0] < m.w && q[1] > 0 && q[1] < m.h);
});

test('mold plates are made for the sheet as printed: they follow the print scale', () => {
  const base = P();
  const pat = buildPattern(computeDesign(base));
  const full = moldLayout(pat, base);
  eq(full.scale, 1); eq(moldNotes(full).length, 0, 'nothing to say at 100%');
  for (const pct of [50, 80, 200]) {
    const k = pct / 100;
    const p = P({ scale: pct });
    const m = moldLayout(buildPattern(computeDesign(p)), p);
    near(m.w, pat.width * k + 2 * MOLD_MARGIN, 1e-9, `${pct}%: plate width`);
    near(m.h, pat.height * k + 2 * MOLD_MARGIN, 1e-9, `${pct}%: plate height`);
    eq(m.ridgeH, base.ridgeH, 'ridge height is a tool size'); eq(m.gap, base.ridgeGap, 'corner clearance is a tool size');
    // every ridge lies on a printed crease of its kind, with its ends `gap` short of the crease ends
    for (const [kind, list, flip] of [['mountain', m.mountain, false], ['valley', m.valley, true]]) {
      ok(list.length > 0, `${pct}% ${kind}: has ridges`);
      const creases = pat.segments.filter((s) => s.kind === kind).map((s) => ({ a: m.toPlate(s.a), b: m.toPlate(s.b) }));
      for (const r of list) {
        const a = flip ? [m.w - r.a[0], r.a[1]] : r.a, b = flip ? [m.w - r.b[0], r.b[1]] : r.b;
        const hit = creases.find((c) => Math.abs(Math.hypot(a[0] - c.a[0], a[1] - c.a[1]) - m.gap) < 1e-6 && Math.abs(Math.hypot(b[0] - c.b[0], b[1] - c.b[1]) - m.gap) < 1e-6);
        ok(hit, `${pct}% ${kind}: ridge sits on a printed crease`);
        const L = Math.hypot(hit.b[0] - hit.a[0], hit.b[1] - hit.a[1]);
        near(Math.hypot(b[0] - a[0], b[1] - a[1]), L - 2 * m.gap, 1e-6, `${pct}% ${kind}: ridge length`);
      }
    }
    // the sheet sits centred on the plate, MOLD_MARGIN inside it
    const xs = m.outline.map((q) => q[0]), ys = m.outline.map((q) => q[1]);
    near(Math.min(...xs), MOLD_MARGIN, 1e-9); near(Math.max(...xs), m.w - MOLD_MARGIN, 1e-9);
    near(Math.min(...ys), MOLD_MARGIN, 1e-9); near(Math.max(...ys), m.h - MOLD_MARGIN, 1e-9);
    ok(moldNotes(m).some((t) => t.includes(`${pct}%`)), `${pct}%: the notes name the print scale`);
    ok(moldMesh(m, 'mountain').header.includes(`sheet at ${pct}%`) && moldMesh(m, 'mountain').header.length <= 80, `${pct}%: STL header names the scale`);
  }
  ok(!full.ridgeClamped && full.ridgeW === base.ridgeW, 'default ridges keep the requested width');
});

test('mold ridge width is limited to the crease spacing, and says so', () => {
  const p = P({ n: 20, dia: 10, H0: 2, H1: 1, floors: 3, ridgeW: 3 });
  const pat = buildPattern(computeDesign(p));
  const m = moldLayout(pat, p);
  ok(m.ridgeClamped, 'clamped');
  near(m.ridgeW, RIDGE_FILL * pat.creaseSpacing, 1e-9, '0.9 x the smallest gap between parallel creases');
  ok(m.ridgeW < pat.creaseSpacing && m.ridgeW < 3, 'ridges cannot merge');
  eq(m.ridgeWRequested, 3);
  near(m.borderW, 0.8 * m.ridgeW, 1e-12, 'border follows the width actually used');
  ok(moldNotes(m).some((t) => /Ridge width reduced from 3 to /.test(t)), moldNotes(m).join(' '));
  // scaling the sheet down packs creases closer, so the clamp follows the print scale
  const small = P({ scale: 10, ridgeW: 3 });
  const ms = moldLayout(buildPattern(computeDesign(small)), small);
  ok(ms.ridgeClamped && Math.abs(ms.spacing - 0.1 * buildPattern(computeDesign(small)).creaseSpacing) < 1e-9, 'spacing as printed');
  for (const which of ['mountain', 'valley']) ok(meshStats(moldSTL(m, which)).watertight, `${which} plate with clamped ridges is closed`);
});

test('mold plates carry a low registration border on the sheet outline, and export closed shells', () => {
  for (const over of [{}, { chir: -1 }, { scale: 60 }, { ext: 0, extcols: 0 }, PRESETS.tower8.params, PRESETS.antiprism.params]) {
    const p = P(over);
    const pat = buildPattern(computeDesign(p));
    const m = moldLayout(pat, p);
    eq(m.border.length, 4, 'four border ridges');
    near(m.borderH, 0.5 * p.ridgeH, 1e-12, 'half the ridge height');
    const corners = m.outline.map((q) => q.map((v) => v.toFixed(6)).join());
    for (const e of m.border) for (const q of [e.a, e.b]) ok(corners.includes(q.map((v) => v.toFixed(6)).join()), 'border ends at the outline corners');
    const perimeter = m.border.reduce((t, e) => t + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), 0);
    near(perimeter, 2 * (pat.width + pat.height) * m.scale, 1e-6, 'border runs round the printed sheet');
    for (const which of ['mountain', 'valley']) {
      const mesh = moldMesh(m, which);
      eq(mesh.ridges, m[which].length, `${which}: one prism per crease ridge`);
      eq(mesh.borders, 4, `${which}: four border prisms`);
      eq(mesh.shells.map((s) => s.role).join().replace(/(ridge,)+/, 'ridges,'), 'slab,ridges,border,border,border,border', `${which}: slab, ridges, then the border`);
      eq(mesh.triangles.length / 3, 12 * (1 + mesh.ridges + 4), `${which}: 12 triangles per solid`);
      // heights: crease ridges reach base + ridgeH, the border only base + ridgeH / 2
      const top = (sh) => { let z = -Infinity; for (let t = 3 * sh.start; t < 3 * (sh.start + sh.count); t++) z = Math.max(z, mesh.positions[3 * mesh.triangles[t] + 2]); return z; };
      for (const sh of mesh.shells) near(top(sh), sh.role === 'slab' ? p.moldBase : sh.role === 'border' ? p.moldBase + m.borderH : p.moldBase + p.ridgeH, 1e-9, `${which} ${sh.role} height`);
      const st = meshStats(moldSTL(m, which));
      ok(st.watertight && st.volume > m.w * m.h * p.moldBase, `${which}: closed, with more material than the bare slab`);
      near(st.bbox.size[0], m.w, 1e-3); near(st.bbox.size[1], m.h, 1e-3); near(st.bbox.size[2], p.moldBase + p.ridgeH, 1e-3);
      ok(mesh.header.length <= 80 && !/^\s*solid/i.test(mesh.header), 'STL header fits');
    }
  }
});

await run();
