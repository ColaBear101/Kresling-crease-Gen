// Regression tests for the geometry / bistability / material / modal math.
// Plain Node, no dependencies. Run with:  node test/regression.mjs
//
// This isn't exhaustive coverage — it's a checked-in version of the
// verification snippets used while developing each feature, so a future
// change that silently breaks one of these gets caught instead of shipped.

import assert from 'node:assert/strict';
import { computeGeometry, buildVerts, shapeAt, tubeRings, findBistableAngle, findMonostableAngle } from '../js/physics/geometry.js';
import { sheetMassGrams } from '../js/physics/material.js';
import { computeModalSweep } from '../js/physics/modal.js';
import { PRESETS } from '../js/constants.js';
import { exportMoldSTL, exportSTL } from '../js/exports.js';
import { cellAt, foldEnergyPath, snapForce } from '../js/physics/foldpath.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  - ${name}`); }
  catch (e) { fail++; console.log(`FAIL  - ${name}\n        ${e.message}`); }
}

console.log('geometry.js — exact rigid folding (Guest & Pellegrino 1994)');

// The printed crease pattern must not change: side = arc length pi*dia/n,
// rows offset by +-dx, red runs 2*dx*chir, green runs 2*dx*chir - b.
test('printed crease geometry is unchanged (side, floor height, red/green lengths, row offsets)', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const chir of [1, -1]) {
      const p = { ...preset, chir, scale: 1 };
      const g = computeGeometry(p);
      const b = p.dia * Math.PI / p.n, fh = p.height / p.floors, dx = fh / Math.tan(p.angle * Math.PI / 180);
      assert.ok(Math.abs(g.b - b) < 1e-12 && Math.abs(g.floor_h - fh) < 1e-12 && Math.abs(g.dx - dx) < 1e-12, `${name}: side/height/dx`);
      assert.ok(Math.abs(g.red_len - Math.hypot(2 * dx, fh)) < 1e-12, `${name}: red`);
      assert.ok(Math.abs(g.green_len - Math.hypot(2 * dx * chir - b, fh)) < 1e-12, `${name}: green`);
      const { verts } = buildVerts(p, g);
      const c = p.extcols;   // column 0 of the tube body
      assert.ok(Math.abs((verts[0][c + 1][0] - verts[0][c][0]) - b) < 1e-9, `${name}: side in the drawing`);
      assert.ok(Math.abs((verts[1][c][0] - verts[0][c][0]) - 2 * dx * chir) < 1e-9, `${name}: zig-zag offset`);
      assert.ok(Math.abs((verts[1][c][1] - verts[0][c][1]) - fh) < 1e-9, `${name}: floor height in the drawing`);
    }
  }
});

test('both strain-free shapes give every printed crease its printed length in 3-D', () => {
  const cases = [{ dia: 3, height: 20, n: 6, floors: 10, angle: 100, stack: 1 }, ...Object.values(PRESETS)];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let checked = 0;
  for (const base of cases) for (const chir of [1, -1]) for (const angle of [base.angle, 70, 80, 92, 96, 100, 104, 110, 120]) {
    const p = { ...base, chir, angle };
    const g = computeGeometry(p);
    for (const st of g.fold.states) {
      if (!st.ok) continue;
      // the real rings the 3-D view and the STL export both use
      const [r0, r1, r2] = tubeRings(p.n, 2, { R: g.fold.R3, H: st.H, psi: st.psi });
      assert.ok(Math.abs(dist(r0[0], r0[1]) - g.b) < 1e-9, 'polygon side');
      assert.ok(Math.abs(dist(r0[0], r1[0]) - g.red_len) < 1e-9, 'red, floor 0');
      assert.ok(Math.abs(dist(r0[1], r1[0]) - g.green_len) < 1e-9, 'green, floor 0 (goes left)');
      assert.ok(Math.abs(dist(r1[0], r2[0]) - g.red_len) < 1e-9, 'red, floor 1');
      assert.ok(Math.abs(dist(r1[0], r2[1]) - g.green_len) < 1e-9, 'green, floor 1 (goes right)');
      checked++;
    }
  }
  assert.ok(checked > 40, `only ${checked} shapes checked`);
});

test('default design is bistable: 1.80 cm -> 0.75 cm per floor', () => {
  const g = computeGeometry({ dia: 3, height: 20, n: 6, floors: 10, angle: 100, stack: 1, chir: 1 });
  assert.equal(g.bistable, true);
  assert.ok(Math.abs(g.fold.deployed.H - 1.8032) < 1e-3 && Math.abs(g.fold.folded.H - 0.7463) < 1e-3);
  assert.ok(Math.abs(g.extendLen - 18.032) < 1e-2 && Math.abs(g.foldLen - 7.463) < 1e-2);
  assert.ok(g.foldInnerValid && g.foldInnerDia > 0 && g.foldInnerDia < g.trueDia);
  assert.ok(Math.abs(g.trueDia - 3 * Math.PI / 6 / Math.sin(Math.PI / 6)) < 1e-12);
  assert.ok(Math.abs(g.drawnAngle - 109.43) < 0.01, `drawn angle ${g.drawnAngle}`);
});

test('stock presets under exact folding (preset values deliberately unchanged)', () => {
  // name: [bistable, has a strain-free shape]
  const expect = { bistable6: [false, false], bistable8: [false, true], tower: [false, true], monostable: [false, false], flat: [false, true], compact: [false, false] };
  for (const [name, [bi, rigid]] of Object.entries(expect)) {
    const g = computeGeometry({ ...PRESETS[name], chir: 1 });
    assert.equal(g.valid, true, `${name} valid`);
    assert.equal(g.bistable, bi, `${name} bistable`);
    assert.equal(g.rigidOk, rigid, `${name} strain-free shape`);
    assert.ok(typeof g.foldReason === 'string' && g.foldReason.length > 10, `${name} explains why`);
  }
  // "Bistable n=6" misses by 1.2 %: closing it needs |k| = 1.0117 > 1
  assert.ok(Math.abs(computeGeometry({ ...PRESETS.bistable6, chir: 1 }).fold.k + 1.0117) < 1e-3);
});

test('Cai et al. (2015) ratio is still computed, for reference only', () => {
  const p = { ...PRESETS.bistable6, chir: 1 };
  const g = computeGeometry(p);
  assert.ok(Math.abs(g.bistableMax - 1 / Math.sin(Math.PI / p.n)) < 1e-9);
  assert.equal(g.caiBistable, true);   // the ratio test says yes; no strain-free fold exists
  assert.equal(g.bistable, false);
});

test('dx sign fix: obtuse-angle default preset is geometrically valid', () => {
  // angle=100 (obtuse) => dx < 0 by construction; valid must use |dx| < b,
  // not a signed dx > 0 guard, or every stock obtuse-angle preset breaks.
  const p = { dia: 3, height: 20, n: 6, floors: 10, angle: 100, stack: 1, chir: 1 };
  const g = computeGeometry(p);
  assert.ok(g.dx < 0, 'expected negative dx for an obtuse angle');
  assert.equal(g.valid, true);
});

test('n < 3 is flagged invalid instead of silently producing NaN/Infinity geometry', () => {
  const base = { dia: 3, height: 20, floors: 10, angle: 100, stack: 1, chir: 1 };
  for (const n of [0, 1, 2]) {
    const g = computeGeometry({ ...base, n });
    assert.equal(g.valid, false, `n=${n} should be invalid`);
    assert.equal(g.bistable, false, `n=${n} should not be reported bistable`);
  }
  const g3 = computeGeometry({ ...base, n: 3 });
  assert.equal(g3.valid, true, 'n=3 is a legitimate polygon and should remain valid');
});

test('snap to bistable lands in the middle of the exact bistable range', () => {
  const base = { dia: 3, height: 20, n: 6, floors: 10, stack: 1, chir: 1 };
  const r = findBistableAngle(base, 60, 140);
  assert.ok(r && r.g.bistable, 'should land on a bistable angle');
  assert.ok(Math.abs(r.window.lo - 99.25) < 0.1 && Math.abs(r.window.hi - 101.1) < 0.1, JSON.stringify(r.window));
  assert.ok(Math.abs(r.angle - 100.2) < 0.15, `got ${r.angle}`);
  // the old ratio-window target, 72.7 deg, folds into a single stable shape
  assert.equal(computeGeometry({ ...base, angle: 72.7 }).bistable, false);
});

test('snap to monostable picks 90 deg for the default preset, away from the bistable range', () => {
  const base = { dia: 3, height: 20, n: 6, floors: 10, stack: 1, chir: 1 };
  const r = findMonostableAngle(base, 60, 140);
  assert.ok(r && !r.g.bistable && r.g.rigidOk && !r.marginal);
  assert.ok(Math.abs(r.angle - 90) < 1e-9, `got ${r.angle}`);
});

test('a second shape that needs a crease to turn past 180 deg is not reachable', () => {
  // The long diagonal's turn must stay below 180 deg on the way from the
  // deployed shape; wrapping it the short way round would wrongly accept
  // a folded shape that passes through the tube axis.
  const p = { ...PRESETS.monostable, chir: 1, angle: 81.8 };
  const g = computeGeometry(p);
  assert.equal(g.rigidOk, true);
  assert.equal(g.bistable, false);
  assert.ok(g.fold.folded.phi > Math.PI, `folded turn ${g.fold.folded.phi}`);
  assert.match(g.foldReason, /through the tube axis/);
  for (const st of g.fold.states) if (st.ok) assert.ok(st.phi < Math.PI);
});

test('3-D view: strain-free at both ends of the fold slider, red crease kept in between', () => {
  const g = computeGeometry({ dia: 3, height: 20, n: 6, floors: 10, angle: 100, stack: 1, chir: 1 });
  const a = shapeAt(g, 0), b = shapeAt(g, 1), m = shapeAt(g, 0.5);
  assert.ok(a.exact && b.exact && !m.exact);
  assert.ok(Math.abs(a.H - g.fold.deployed.H) < 1e-12 && Math.abs(b.H - g.fold.folded.H) < 1e-12);
  const red = (s) => Math.hypot(s.H, 2 * s.R * Math.sin(s.psi / 2));
  for (const s of [a, m, b]) assert.ok(Math.abs(red(s) - g.red_len) < 1e-9);
  const none = shapeAt(computeGeometry({ ...PRESETS.bistable6, chir: 1 }), 0);
  assert.ok(!none.exact && /no strain-free/.test(none.note));
});

console.log('\nmaterial.js — sheet mass');
test('sheetMassGrams: density x thickness x area, polyimide only', () => {
  const g = sheetMassGrams({ material: 'polyimide', thicknessUm: 50 }, 500); // 500 cm^2
  assert.ok(Math.abs(g - 3.55) < 1e-6, `expected 3.55g, got ${g}`);
  assert.equal(sheetMassGrams({ material: 'generic' }, 500), null);
});

console.log('\nfoldpath.js — energy along the exact fold path');
// Independent cross-check of cellAt()'s two dihedral angles against a
// standard 4-point torsion-angle formula, applied to the same panel corners.
function torsionAngle(p0, p1, p2, p3) {
  const sub   = ([ax,ay,az],[bx,by,bz]) => [ax-bx,ay-by,az-bz];
  const cross = ([ax,ay,az],[bx,by,bz]) => [ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];
  const dot   = ([ax,ay,az],[bx,by,bz]) => ax*bx+ay*by+az*bz;
  const norm  = v => { const l = Math.hypot(...v) || 1; return v.map(x => x/l); };
  const b1 = sub(p1,p0), b2 = sub(p2,p1), b3 = sub(p3,p2);
  const m1 = norm(cross(b1,b2)), m2 = norm(cross(b2,b3));
  return Math.acos(Math.max(-1, Math.min(1, dot(m1,m2))));
}
test('cellAt dihedrals match an independent torsion-angle formula', () => {
  for (const [n, R, H, psi] of [[6, 1.6, 1.8, 0.4], [6, 1.6, 0.7, 1.9], [8, 2.1, 1.1, -0.9], [5, 1.2, 0.4, 2.3]]) {
    const a = 2 * Math.PI / n;
    const bot = (k) => [R*Math.cos(k*a), R*Math.sin(k*a), 0];
    const top = (k) => [R*Math.cos(k*a+psi), R*Math.sin(k*a+psi), H];
    const c = cellAt(n, R, H, psi);
    // red crease A0-T0 between panels (A0,A1,T0) and (A0,T0,T-1)
    const m = Math.PI - torsionAngle(bot(1), bot(0), top(0), top(-1));
    // green crease A0-T-1 between panels (A-1,A0,T-1) and (A0,T0,T-1)
    const v = Math.PI - torsionAngle(bot(-1), top(-1), bot(0), top(0));
    assert.ok(Math.abs(c.psi_m - m) < 1e-9, `psi_m ${c.psi_m} vs ${m}`);
    assert.ok(Math.abs(c.psi_v - v) < 1e-9, `psi_v ${c.psi_v} vs ${v}`);
  }
});
test('green crease has its printed length at both strain-free shapes', () => {
  let checked = 0;
  for (const name of Object.keys(PRESETS)) for (const chir of [1, -1]) for (let angle = 60; angle <= 140; angle += 2.5) {
    const g = computeGeometry({ ...PRESETS[name], chir, angle });
    if (!g.valid || !g.rigidOk) continue;
    for (const st of g.fold.states) if (st.ok) {
      assert.ok(Math.abs(cellAt(g.n, g.fold.R3, st.H, st.psi).green - g.green_len) < 1e-9, `${name} ${chir} ${angle}`);
      checked++;
    }
  }
  assert.ok(checked > 40, `only ${checked} shapes checked`);
});
function pathMinima(path) {
  const out = [];
  const E = path.E, last = E.length - 1;
  if (E[0] < E[1]) out.push(path.H[0]);
  for (let i = 1; i < last; i++) if (E[i] < E[i-1] && E[i] <= E[i+1]) out.push(path.H[i]);
  if (E[last] < E[last-1]) out.push(path.H[last]);
  return out;
}
test('default bistable design: energy wells sit on the two strain-free shapes', () => {
  for (const material of ['generic', 'polyimide']) {
    const p = { dia: 3, height: 20, n: 6, floors: 10, angle: 100, stack: 1, chir: 1, material, thicknessUm: 50 };
    const g = computeGeometry(p);
    const path = foldEnergyPath(p, g);
    const mins = pathMinima(path);
    const step = path.H[1] - path.H[0];
    assert.equal(mins.length, 2, `${material}: minima at ${mins}`);
    assert.ok(Math.abs(mins[0] - g.fold.folded.H) < 3 * step, `${material}: folded well ${mins[0]} vs ${g.fold.folded.H}`);
    assert.ok(Math.abs(mins[1] - g.fold.deployed.H) < 3 * step, `${material}: deployed well ${mins[1]} vs ${g.fold.deployed.H}`);
    assert.equal(path.restH, g.fold.deployed.H);
    assert.equal(path.foldH, g.fold.folded.H);
  }
});
test('single-stable design: one energy well, at the deployed shape', () => {
  const p = { dia: 3, height: 20, n: 6, floors: 10, angle: 90, stack: 1, chir: 1, material: 'generic' };
  const g = computeGeometry(p);
  assert.equal(g.rigidOk, true); assert.equal(g.bistable, false);
  const path = foldEnergyPath(p, g);
  // Squashed flat, the green crease comes back towards its printed length at
  // the rejected second shape (through the tube axis), so the very bottom of
  // the sweep can dip; only wells above that count.
  const mins = pathMinima(path).filter(h => h > 0.1 * g.red_len);
  assert.equal(mins.length, 1, `minima at ${mins}`);
  assert.ok(Math.abs(mins[0] - g.fold.deployed.H) < 3 * (path.H[1] - path.H[0]));
  assert.equal(path.foldH, null);
});
test('snap force (polyimide) is in a sane range and grows with sheet thickness', () => {
  const base = { dia: 3, height: 20, n: 6, floors: 10, angle: 100, stack: 1, chir: 1, material: 'polyimide' };
  const f = [25, 50, 100].map(t => { const p = { ...base, thicknessUm: t }; return snapForce(p, computeGeometry(p)); });
  assert.ok(f[0] < f[1] && f[1] < f[2], `${f}`);
  assert.ok(f[1] > 1e-3 && f[1] < 50, `50 um snap force ${f[1]} N`);
});

console.log('\nmodal.js — Kidambi & Wang (2020) 6-DOF sweep, checked against their Fig. 7/13 examples (n=8, R0=0.917)');
test('delta0~20deg (region I): axial~1.0, off-axis~0.79', () => {
  const { results } = computeModalSweep({ n: 8 }, { R: 0.917, floor_h: 1, dx: 0 });
  const r = results.reduce((a,b) => Math.abs(b.deg-20) < Math.abs(a.deg-20) ? b : a);
  assert.ok(Math.abs(r.axialA - 1.0) < 0.05, `axialA=${r.axialA}`);
  assert.ok(Math.abs(r.offA - 0.79) < 0.05, `offA=${r.offA}`);
});
test('delta0~32deg (region II): branch B fully compressed (pB3~0)', () => {
  const { results } = computeModalSweep({ n: 8 }, { R: 0.917, floor_h: 1, dx: 0 });
  const r = results.reduce((a,b) => Math.abs(b.deg-32) < Math.abs(a.deg-32) ? b : a);
  assert.ok(r.pB3B !== undefined, 'expected a branch B to be found');
  assert.ok(r.pB3B < 0.05, `pB3B=${r.pB3B}`);
});
test('zero-stiffness point falls near their reported 67.5deg', () => {
  const { results } = computeModalSweep({ n: 8 }, { R: 0.917, floor_h: 1, dx: 0 });
  let best = results[0];
  for (const r of results) if (r.axialA < best.axialA) best = r;
  assert.ok(Math.abs(best.deg - 67.5) < 2.5, `zero-stiffness at deg=${best.deg}, axialA=${best.axialA}`);
  assert.ok(best.axialA < 0.02, `expected axialA near 0, got ${best.axialA}`);
});

console.log('\nexports.js — STL watertightness + orientation (mold + tube)');
// Both bugs were "clean" numerically (no NaN, sane bbox, correct facet
// count) but structurally broken: exportMoldSTL's ridge prisms were
// missing their floor face (open boundary at z=0 on every ridge) and the
// plate's top/bottom faces had swapped winding; exportSTL's tube was fully
// watertight but wound with every normal pointing inward. Neither shows up
// without an actual manifold check, so that's what these assert on: every
// edge must be shared by exactly one triangle in each direction (no holes,
// no duplicates), and the divergence-theorem signed volume must be
// positive (mesh is consistently oriented outward, not inside-out).
function checkSTL(stl) {
  const blocks = stl.split('facet normal').slice(1);
  const edges = new Map();
  let vol = 0;
  for (const b of blocks) {
    const vs = [...b.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map(m => [m[1], m[2], m[3]]);
    for (let i = 0; i < 3; i++) {
      const k = vs[i].join(',') + '|' + vs[(i+1)%3].join(',');
      edges.set(k, (edges.get(k)||0) + 1);
    }
    const [v1,v2,v3] = vs.map(p => p.map(Number));
    const cx=v2[1]*v3[2]-v2[2]*v3[1], cy=v2[2]*v3[0]-v2[0]*v3[2], cz=v2[0]*v3[1]-v2[1]*v3[0];
    vol += (v1[0]*cx + v1[1]*cy + v1[2]*cz) / 6;
  }
  let boundary = 0, dup = 0;
  for (const [k, c] of edges) {
    const [a, b] = k.split('|');
    const rev = edges.get(b+'|'+a) || 0;
    if (c > 1) dup++;
    if (c === 1 && rev === 0) boundary++;
  }
  return { facets: blocks.length, boundary, dup, vol };
}

// exportMoldSTL/exportSTL pull params via ui.js's getP(), which reads
// document.getElementById(...) — a minimal DOM shim, not real params.
function withDomShim(overrides, fn) {
  const P = { dia:5, height:20, n:8, floors:10, angle:100, ext:2, seaml:1.96, seamr:1.96,
    extcols:1, stack:1, scale:100, compress:0, wallmm:0.8, moldbase:3, ridgeh:1.2, ridgew:0.6,
    chir:1, material:'kapton', thick:25, showmv:true, showA4:true, showGrid:true,
    showMountain:true, showValley:true, showDiagonal:true, ...overrides };
  const fakeEl = id => {
    const v = id.startsWith('n-') ? P[id.slice(2)] : P[id];
    return { id, value: v!==undefined?String(v):'0', checked: !!v, style:{},
      classList:{add(){},remove(){},toggle(){},contains(){return false;}}, addEventListener(){}, click(){},
      getContext(){ return new Proxy({}, { get(){ return function(){ return {}; }; } }); },
      getBoundingClientRect(){ return {width:400,height:400,left:0,top:0}; },
      parentElement:{clientWidth:400,clientHeight:400}, offsetWidth:400, offsetHeight:400 };
  };
  let captured = null;
  global.document = { getElementById: id => fakeEl(id),
    createElement: tag => tag==='a' ? {click(){}, set href(v){}, get href(){return '';}, download:''} : fakeEl(tag),
    addEventListener(){} };
  global.window = global;
  global.URL = { createObjectURL(blob){ captured = blob.parts[0]; return 'blob:fake'; } };
  global.Blob = class { constructor(parts, opts){ this.parts = parts; this.type = opts && opts.type; } };
  fn();
  return captured;
}

for (const moldType of ['mountain', 'valley']) {
  test(`exportMoldSTL('${moldType}') is watertight and consistently oriented`, () => {
    const stl = withDomShim({}, () => exportMoldSTL(moldType));
    const r = checkSTL(stl);
    assert.equal(r.boundary, 0, `${r.boundary} open boundary edges (mesh has holes)`);
    assert.equal(r.dup, 0, `${r.dup} non-manifold edges`);
    assert.ok(r.vol > 0, `signed volume ${r.vol} should be positive (outward-oriented)`);
  });
}
test('exportSTL() (hollow tube) is watertight and consistently oriented', () => {
  const stl = withDomShim({}, () => exportSTL());
  const r = checkSTL(stl);
  assert.equal(r.boundary, 0, `${r.boundary} open boundary edges (mesh has holes)`);
  assert.equal(r.dup, 0, `${r.dup} non-manifold edges`);
  assert.ok(r.vol > 0, `signed volume ${r.vol} should be positive (outward-oriented)`);
});

// Ridge centerlines sit on a grid spaced by the scaled floor height (rows)
// and polygon side length (columns). At small enough pattern scale combined
// with many floors/sides, that spacing shrinks below the requested ridge
// width, so neighboring ridge prisms pack into each other and leave
// exactly-coincident (non-manifold) faces where they touch — found via this
// exact combination (dia=1, height=2, n=20, floors=20, scale=10%, all within
// their sliders' ranges): row spacing collapses to 0.01cm while even the
// minimum ridgew (0.3mm = 0.03cm) is already 3x wider than that.
test("exportMoldSTL('valley') stays manifold when ridges are packed tighter than ridgew (small scale, many floors/sides)", () => {
  const o = { dia:1, height:2, n:20, floors:20, angle:140, extcols:4, scale:10,
    seaml:6, seamr:6, ext:0, moldbase:1, ridgeh:5, ridgew:0.3, chir:1 };
  const stl = withDomShim(o, () => exportMoldSTL('valley'));
  const r = checkSTL(stl);
  assert.equal(r.boundary, 0, `${r.boundary} open boundary edges (mesh has holes)`);
  assert.equal(r.dup, 0, `${r.dup} non-manifold edges`);
  assert.ok(r.vol > 0, `signed volume ${r.vol} should be positive (outward-oriented)`);
});

console.log('\nbuckling.js — snap-through vs. Euler/shell buckling');
{
  const { bucklingCheck, snapThroughForce, eulerColumnBuckling, shellLocalBuckling } = await import('../js/physics/buckling.js');

  test('buckling check unavailable for generic (non-polyimide) material', () => {
    const p = { ...PRESETS.bistable6, chir: 1, material: 'generic' };
    const g = computeGeometry(p);
    const bc = bucklingCheck(p, g);
    assert.equal(bc.available, false);
  });

  test('buckling check available and positive for polyimide, physically-sane preset', () => {
    const p = { ...PRESETS.bistable6, chir: 1, material: 'polyimide', thicknessUm: 50 };
    const g = computeGeometry(p);
    const bc = bucklingCheck(p, g, 1.5, 'pinned');
    assert.equal(bc.available, true);
    assert.ok(bc.Fsnap > 0, 'snap-through force should be positive for a bistable design');
    assert.ok(bc.Pglobal > 0 && bc.Plocal > 0);
    assert.ok(Number.isFinite(bc.margin) && bc.margin > 0);
    assert.equal(bc.Pcr, Math.min(bc.Pglobal, bc.Plocal));
    assert.equal(bc.safe, bc.margin >= 1.5);
  });

  test('fixed-free end condition gives a lower (or equal) Euler load than pinned-pinned', () => {
    const p = { ...PRESETS.tower, chir: 1, material: 'polyimide', thicknessUm: 50 };
    const g = computeGeometry(p);
    const pinned = eulerColumnBuckling(p, g, 'pinned');
    const cantilever = eulerColumnBuckling(p, g, 'fixed-free');
    assert.ok(cantilever < pinned, 'cantilever (Le=2L) should buckle at a lower load than pinned-pinned (Le=L)');
  });

  test('buckling margin grows with sheet thickness (snap force ~ t from panel stretch, shell buckling ~ t^2)', () => {
    const base = { dia: 3, height: 20, n: 6, floors: 10, angle: 100, stack: 1, chir: 1, material: 'polyimide' };
    const margins = [15, 50, 110].map(t => {
      const p = { ...base, thicknessUm: t };
      const g = computeGeometry(p);
      return bucklingCheck(p, g, 1.5).margin;
    });
    assert.ok(margins[0] < margins[1] && margins[1] < margins[2],
      `expected strictly increasing margins with thickness, got ${margins}`);
  });

  test('shellLocalBuckling and eulerColumnBuckling scale with radius/height as expected', () => {
    const p = { ...PRESETS.bistable6, chir: 1, material: 'polyimide', thicknessUm: 50 };
    const gSmall = computeGeometry(p);
    const gBig = computeGeometry({ ...p, dia: p.dia * 2 }); // bigger R, same n -> bigger b too, but R doubles
    // Local shell buckling load scales ~ R * t (sigma_cr ~ t/R, Pcr = sigma_cr*2*pi*R*t = 2*pi*E*t^2/sqrt(3(1-nu^2)), independent of R)
    const local1 = shellLocalBuckling(p, gSmall), local2 = shellLocalBuckling(p, gBig);
    assert.ok(Math.abs(local1 - local2) / local1 < 1e-9, 'local shell buckling load should be independent of radius at fixed thickness');
  });
}

console.log('\nexplorer.js — Design Explorer grid search (axis generation + requirement gating)');
// explorer.js composes geometry.js/buckling.js over a 2-D grid the sidebar can
// only explore one point at a time; runExplorer()/evalCell() are its own
// logic (not re-tested physics) and had zero coverage. Driven through the
// real exported runExplorer() with a minimal DOM shim (same technique as the
// exports.js STL tests above) rather than re-implementing axisValues/evalCell
// here, so a regression in the actual grid-generation or requirement-gating
// code gets caught.
{
  const { runExplorer } = await import('../js/explorer.js');

  // Generic fake DOM: every element is created lazily and keeps whatever
  // value/checked/textContent is set on it, so runExplorer's reads/writes
  // round-trip exactly like a real form + canvas + status line would.
  function explorerDom(fields) {
    const store = new Map();
    function el(id) {
      if (!store.has(id)) {
        store.set(id, {
          id, value: '0', checked: false,
          classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
          style: {}, querySelectorAll: () => [], addEventListener(){},
          getContext: () => new Proxy({}, { get(){ return function(){ return {}; }; } }),
          getBoundingClientRect: () => ({ width: 400, height: 400, left: 0, top: 0 }),
          parentElement: { clientWidth: 400, clientHeight: 400 },
        });
      }
      return store.get(id);
    }
    for (const [id, v] of Object.entries(fields)) {
      const e = el(id);
      if (typeof v === 'boolean') e.checked = v; else e.value = String(v);
    }
    global.document = { getElementById: el };
    global.window = global;
    return { text: id => el(id).textContent };
  }

  const BASE_FIXED = {
    'exp-dia': 4, 'exp-height': 16, 'exp-floors': 8, 'exp-stack': 1, 'exp-n': 6, 'exp-angle': 105,
    'exp-thick': 50, 'exp-chir': 1,
    'n-dia': 4, 'n-height': 16, 'n-n': 6, 'n-floors': 8, 'n-angle': 105, 'n-ext': 1.5, 'n-seaml': 1.57,
    'n-seamr': 1.57, 'n-extcols': 1, 'n-stack': 1, 'n-scale': 100, 'n-compress': 0, 'n-wallmm': 0.8,
    'n-moldbase': 3, 'n-ridgeh': 1.2, 'n-ridgew': 0.6, 'n-thick': 50, chir: 1, material: 'polyimide',
    showmv: true, showA4: true, showGrid: true, showMountain: true, showValley: true, showDiagonal: true,
    'exp-req-bistable': false, 'exp-req-buckling': false, 'exp-req-a4': false,
    'exp-safety': 1.5, 'exp-endcond': 'pinned',
  };

  function gridTotals(text) {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(text || '');
    if (!m) throw new Error(`exp-status has no "x / y" summary: ${text}`);
    return { passers: Number(m[1]), total: Number(m[2]) };
  }

  test('integer axis (n) yields exactly one grid point per integer in [min,max]', () => {
    const dom = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'angle',
      'exp-xmin': 3, 'exp-xmax': 8, 'exp-xsteps': 999, // steps must be ignored for an integer axis
      'exp-ymin': 105, 'exp-ymax': 105, 'exp-ysteps': 4,
    });
    runExplorer();
    const { total } = gridTotals(dom.text('exp-status'));
    assert.equal(total, (8 - 3 + 1) * (4 + 1), `expected 6 n-values x 5 angle-values, got total=${total}`);
  });

  test('continuous axis keeps at least 2 divisions even when 0 or 1 steps are requested', () => {
    const dom = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'dia', 'exp-yaxis': 'thick',
      'exp-xmin': 1, 'exp-xmax': 1, 'exp-xsteps': 0,
      'exp-ymin': 10, 'exp-ymax': 10, 'exp-ysteps': 1,
    });
    runExplorer();
    const { total } = gridTotals(dom.text('exp-status'));
    assert.equal(total, 3 * 3, `expected steps clamped up to >=2 divisions each (3x3=9), got total=${total}`);
  });

  test('reqBistable gates passers: a bistable design passes, the monostable preset does not', () => {
    const domA = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'angle', 'exp-xmin': 6, 'exp-xmax': 6,
      'exp-ymin': 100, 'exp-ymax': 100, 'exp-ysteps': 3,
      'exp-dia': 3, 'exp-height': 20, 'exp-floors': 10, 'exp-stack': 1,
      'exp-req-bistable': true,
    }); // the app's default design: folds rigidly into two stable shapes (see geometry.js tests above)
    runExplorer();
    const a = gridTotals(domA.text('exp-status'));
    assert.equal(a.passers, a.total, `expected every cell to pass (known-bistable design), got ${a.passers}/${a.total}`);

    const domB = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'angle', 'exp-xmin': 6, 'exp-xmax': 6,
      'exp-ymin': 100, 'exp-ymax': 100, 'exp-ysteps': 3,
      'exp-dia': 3, 'exp-height': 24, 'exp-floors': 6, 'exp-stack': 1,
      'n-ext': 1, 'n-seaml': 0, 'n-seamr': 0, 'n-extcols': 0,
      'exp-req-bistable': true,
    }); // matches PRESETS.monostable exactly (known non-bistable)
    runExplorer();
    const b = gridTotals(domB.text('exp-status'));
    assert.equal(b.passers, 0, `expected no cells to pass (known-monostable preset), got ${b.passers}/${b.total}`);
  });

  test('reqA4 gates out an oversized design and keeps an undersized one', () => {
    // Sizes verified directly against geometry.js's own patternBounds()
    // (0.70x0.44cm vs 216.97x104.00cm against a 21x29.7cm A4 sheet) rather
    // than hand-derived, so this tracks the real formula, not a guess at it.
    const small = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'angle', 'exp-xmin': 6, 'exp-xmax': 6,
      'exp-ymin': 100, 'exp-ymax': 100, 'exp-ysteps': 2,
      'exp-dia': 1, 'exp-height': 2, 'exp-floors': 2, 'exp-stack': 1,
      'n-ext': 0.1, 'n-seaml': 0, 'n-seamr': 0, 'n-extcols': 0, 'n-scale': 20,
      'exp-req-a4': true,
    });
    runExplorer();
    const s = gridTotals(small.text('exp-status'));
    assert.equal(s.passers, s.total, `expected the tiny design to fit A4, got ${s.passers}/${s.total}`);

    const big = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'angle', 'exp-xmin': 6, 'exp-xmax': 6,
      'exp-ymin': 100, 'exp-ymax': 100, 'exp-ysteps': 2,
      'exp-dia': 50, 'exp-height': 100, 'exp-floors': 10, 'exp-stack': 1,
      'n-ext': 2, 'n-seaml': 2, 'n-seamr': 2, 'n-extcols': 1, 'n-scale': 100,
      'exp-req-a4': true,
    });
    runExplorer();
    const bstat = gridTotals(big.text('exp-status'));
    assert.equal(bstat.passers, 0, `expected the oversized design to fail A4 fit, got ${bstat.passers}/${bstat.total}`);
  });

  test('reqBuckling gates out a design whose margin falls below the safety factor', () => {
    // The default bistable design at 50um has a buckling margin of ~3.4x
    // (bucklingCheck: snap ~7.2 N vs local shell buckling ~24 N), so it
    // passes a 1.5x safety factor and fails a 5x one.
    const run = (safety) => {
      const dom = explorerDom({ ...BASE_FIXED,
        'exp-xaxis': 'n', 'exp-yaxis': 'angle', 'exp-xmin': 6, 'exp-xmax': 6,
        'exp-ymin': 100, 'exp-ymax': 100, 'exp-ysteps': 2,
        'exp-dia': 3, 'exp-height': 20, 'exp-floors': 10, 'exp-stack': 1, 'exp-thick': 50,
        'exp-req-buckling': true, 'exp-safety': safety,
      });
      runExplorer();
      return gridTotals(dom.text('exp-status'));
    };
    const ok = run(1.5);
    assert.equal(ok.passers, ok.total, `expected a 1.5x safety factor to pass, got ${ok.passers}/${ok.total}`);
    const strict = run(5);
    assert.equal(strict.passers, 0, `expected a 5x safety factor to fail, got ${strict.passers}/${strict.total}`);
  });

  test('same axis chosen for X and Y aborts the run instead of computing a degenerate grid', () => {
    const dom = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'n',
      'exp-xmin': 3, 'exp-xmax': 8, 'exp-xsteps': 12,
      'exp-ymin': 3, 'exp-ymax': 8, 'exp-ysteps': 12,
    });
    runExplorer();
    assert.equal(dom.text('exp-status'), undefined, 'exp-status should never be touched when the axis guard fires');
    assert.equal(dom.text('toast'), 'X and Y axis must be different');
  });
}

console.log('\npresets.js — preset import seam-auto wiring');
// handlePresetFile() defers to an injected applyAutoSeam(), which is itself a
// no-op unless seamAutoMode is true — so the call site must invoke it exactly
// when seamAutoMode ends up true after import, or an auto-seam preset's
// seaml/seamr never get recomputed for the newly-loaded geometry.
{
  const { PRESET_KEYS } = await import('../js/constants.js');

  function presetDom() {
    const store = new Map();
    function el(id) {
      if (!store.has(id)) {
        store.set(id, { id, value: '0', checked: false, textContent: '',
          classList: { add(){}, remove(){}, contains(){ return false; } } });
      }
      return store.get(id);
    }
    PRESET_KEYS.forEach(k => { el('r-' + k); el('n-' + k); });
    el('chir'); el('material'); el('seam-auto-cb'); el('toast');
    global.document = { getElementById: el };
    global.window = global;
    global.FileReader = class {
      readAsText(file) { this.onload({ target: { result: file.__content } }); }
    };
    return el;
  }

  function fakeInput(data) { return { files: [{ __content: JSON.stringify(data) }], value: 'x' }; }

  {
    const { handlePresetFile } = await import(`../js/presets.js?t=${Math.random()}`);
    presetDom();
    let calls = 0;
    test('seamAuto:true in the imported file triggers an applyAutoSeam recompute', () => {
      handlePresetFile(fakeInput({ n: 6, floors: 8, seamAuto: true }), { draw: () => {}, applyAutoSeam: () => calls++ });
      assert.equal(calls, 1);
    });
  }

  {
    const { handlePresetFile } = await import(`../js/presets.js?t=${Math.random()}`);
    presetDom();
    let calls = 0;
    test('seamAuto:false in the imported file leaves applyAutoSeam uncalled (manual seam values from the file stand)', () => {
      handlePresetFile(fakeInput({ n: 6, floors: 8, seamAuto: false, seaml: 1.23, seamr: 1.23 }), { draw: () => {}, applyAutoSeam: () => calls++ });
      assert.equal(calls, 0);
    });
  }
}

console.log('\nhistory.js — undo/redo state stack');
// history.js's captureState/undo/redo keep module-level history[]/historyIdx
// singletons, so each scenario below imports a fresh copy (via a unique
// query-string specifier — Node's ESM loader caches by full resolved URL,
// so this really does re-run the module and reset its state) instead of
// sharing state across tests.
{
  const { paramPairs } = await import('../js/constants.js');
  const ANGLE = 'n-angle';

  function historyDom() {
    const store = new Map();
    function el(id) {
      if (!store.has(id)) {
        store.set(id, { id, value: '0', checked: false,
          classList: { add(){}, remove(){}, contains(){ return false; } } });
      }
      return store.get(id);
    }
    paramPairs.forEach(([rid, nid]) => { el(rid); el(nid); });
    el('chir').value = '1';
    el('material').value = 'polyimide';
    el('seam-auto-cb').checked = true;
    global.document = { getElementById: el };
    global.window = global;
    return el;
  }

  {
    const { captureState, undo, redo } = await import(`../js/history.js?t=${Math.random()}`);
    const el = historyDom();
    let draws = 0; const draw = () => draws++;
    test('captureState + undo restores the previous value', () => {
      el(ANGLE).value = '100'; captureState();
      el(ANGLE).value = '105'; captureState();
      undo(draw);
      assert.equal(el(ANGLE).value, '100');
      assert.equal(draws, 1);
    });
    test('redo reapplies the value that was undone', () => {
      redo(draw);
      assert.equal(el(ANGLE).value, '105');
      assert.equal(draws, 2);
    });
  }

  {
    const { captureState, undo } = await import(`../js/history.js?t=${Math.random()}`);
    const el = historyDom();
    let draws = 0; const draw = () => draws++;
    test('undo below the oldest snapshot is a no-op', () => {
      el(ANGLE).value = '42'; captureState();
      undo(draw);
      assert.equal(el(ANGLE).value, '42', 'value should not change');
      assert.equal(draws, 0, 'draw should not be called when there is nothing to undo');
    });
  }

  {
    const { captureState, redo } = await import(`../js/history.js?t=${Math.random()}`);
    const el = historyDom();
    let draws = 0; const draw = () => draws++;
    test('redo past the newest snapshot is a no-op', () => {
      el(ANGLE).value = '10'; captureState();
      el(ANGLE).value = '20'; captureState();
      redo(draw);
      assert.equal(el(ANGLE).value, '20');
      assert.equal(draws, 0, 'draw should not be called when there is nothing to redo');
    });
  }

  {
    const { captureState, undo, redo } = await import(`../js/history.js?t=${Math.random()}`);
    const el = historyDom();
    let draws = 0; const draw = () => draws++;
    test('a fresh capture after an undo discards the redo branch', () => {
      el(ANGLE).value = '100'; captureState();
      el(ANGLE).value = '105'; captureState();
      undo(draw); // back to 100
      el(ANGLE).value = '999'; captureState(); // new branch, should discard the 105 snapshot
      redo(draw); // nothing to redo now
      assert.equal(el(ANGLE).value, '999', 'redo should not resurrect the discarded 105 branch');
      undo(draw); // should land on 100 (the state right before the new branch)...
      assert.equal(el(ANGLE).value, '100',
        'undo should land on the pre-branch value, not a stale 105 snapshot left over from the discarded redo branch');
      undo(draw); // ...and nowhere else, since 100 was the very first snapshot
      assert.equal(el(ANGLE).value, '100', 'should already be at the oldest snapshot');
    });
  }

  {
    const { captureState, undo } = await import(`../js/history.js?t=${Math.random()}`);
    const el = historyDom();
    const draw = () => {};
    test('history stack is capped, so undo cannot reach further back than the cap allows', () => {
      for (let i = 0; i < 100; i++) { el(ANGLE).value = String(i); captureState(); }
      let steps = 0;
      for (;;) {
        const before = el(ANGLE).value;
        undo(draw);
        if (el(ANGLE).value === before) break; // hit the no-op floor
        steps++;
        if (steps > 200) throw new Error('undo never reached the floor - is the cap gone?');
      }
      assert.ok(steps < 99, `uncapped history would let undo walk back all 99 steps; got ${steps}`);
      assert.equal(el(ANGLE).value, String(100 - 1 - steps), 'oldest reachable snapshot should be the earliest one the cap retained');
    });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
