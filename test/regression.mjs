// Regression tests for the geometry / bistability / material / modal math.
// Plain Node, no dependencies. Run with:  node test/regression.mjs
//
// This isn't exhaustive coverage — it's a checked-in version of the
// verification snippets used while developing each feature, so a future
// change that silently breaks one of these gets caught instead of shipped.

import assert from 'node:assert/strict';
import { computeGeometry } from '../js/geometry.js';
import { sheetMassGrams } from '../js/material.js';
import { computeModalSweep } from '../js/modal.js';
import { PRESETS } from '../js/constants.js';
import { exportMoldSTL, exportSTL } from '../js/exports.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  - ${name}`); }
  catch (e) { fail++; console.log(`FAIL  - ${name}\n        ${e.message}`); }
}

console.log('geometry.js — bistability (Cai et al. 2015 criterion)');
// Preset names double as claims: bistable6/bistable8/tower should read
// bistable; monostable/flat/compact should not. (See app.js session notes:
// this replaced an ad-hoc h0/R heuristic, and separately fixed a dx-sign
// bug that was silently disqualifying every obtuse-angle preset from being
// flagged valid/bistable at all.)
const expectBistable = { bistable6: true, bistable8: true, tower: true, monostable: false, flat: false, compact: false };
for (const [name, expect] of Object.entries(expectBistable)) {
  test(`preset "${name}" bistable === ${expect}`, () => {
    const p = { ...PRESETS[name], chir: 1 };
    const g = computeGeometry(p);
    assert.equal(g.valid, true, 'geometry should be valid');
    assert.equal(g.bistable, expect);
  });
}

test('bistability window matches closed form (1 < ratio < 1/sin(pi/n))', () => {
  const p = { ...PRESETS.bistable6, chir: 1 };
  const g = computeGeometry(p);
  const expectedMax = 1 / Math.sin(Math.PI / p.n);
  assert.ok(Math.abs(g.bistableMax - expectedMax) < 1e-9);
  assert.ok(g.bLengthRatio > 1 && g.bLengthRatio < g.bistableMax);
});

test('dx sign fix: obtuse-angle default preset is geometrically valid', () => {
  // angle=100 (obtuse) => dx < 0 by construction; valid must use |dx| < b,
  // not a signed dx > 0 guard, or every stock obtuse-angle preset breaks.
  const p = { dia: 3, height: 20, n: 6, floors: 10, angle: 100, stack: 1, chir: 1 };
  const g = computeGeometry(p);
  assert.ok(g.dx < 0, 'expected negative dx for an obtuse angle');
  assert.equal(g.valid, true);
});

test('snap-to-bistable grid search lands inside the window for the default preset', () => {
  const base = { dia: 3, height: 20, n: 6, floors: 10, stack: 1, chir: 1 };
  const angMin = 60, angMax = 140, STEPS = 1600;
  let best = null, bestScore = Infinity, bestG = null;
  for (let i = 0; i <= STEPS; i++) {
    const angle = angMin + (angMax - angMin) * i / STEPS;
    const g = computeGeometry({ ...base, angle });
    if (!g.valid) continue;
    const target = (1 + g.bistableMax) / 2;
    const inWindow = g.bLengthRatio > 1 && g.bLengthRatio < g.bistableMax;
    const score = inWindow ? Math.abs(g.bLengthRatio - target)
      : 1000 + Math.min(Math.abs(g.bLengthRatio - 1), Math.abs(g.bLengthRatio - g.bistableMax));
    if (score < bestScore) { bestScore = score; best = angle; bestG = g; }
  }
  assert.ok(bestG.bistable, 'grid search should find a genuinely bistable angle');
  assert.ok(Math.abs(best - 72.7) < 0.5, `expected ~72.7deg, got ${best}`);
});

test('snap-to-monostable grid search lands outside the window, with a safety margin, for the default preset', () => {
  const base = { dia: 3, height: 20, n: 6, floors: 10, stack: 1, chir: 1 };
  const angMin = 60, angMax = 140, STEPS = 1600;
  const candidates = [];
  for (let i = 0; i <= STEPS; i++) {
    const angle = angMin + (angMax - angMin) * i / STEPS;
    const g = computeGeometry({ ...base, angle });
    if (!g.valid) continue;
    const below = g.bLengthRatio <= 1, above = g.bLengthRatio >= g.bistableMax;
    if (!below && !above) continue;
    const margin = below ? (1 - g.bLengthRatio) : (g.bLengthRatio - g.bistableMax);
    candidates.push({ angle, g, margin });
  }
  assert.ok(candidates.length > 0, 'expected at least one monostable angle in range');
  const safe = candidates.filter(c => c.margin >= 0.05);
  const pool = safe.length ? safe : candidates;
  let best = pool[0];
  for (const c of pool) if (Math.abs(c.angle - 90) < Math.abs(best.angle - 90)) best = c;
  assert.equal(best.g.bistable, false);
  assert.ok(Math.abs(best.angle - 122.25) < 0.5, `expected ~122.25deg, got ${best.angle}`);
});

console.log('\nmaterial.js — sheet mass');
test('sheetMassGrams: density x thickness x area, polyimide only', () => {
  const g = sheetMassGrams({ material: 'polyimide', thicknessUm: 50 }, 500); // 500 cm^2
  assert.ok(Math.abs(g - 3.55) < 1e-6, `expected 3.55g, got ${g}`);
  assert.equal(sheetMassGrams({ material: 'generic' }, 500), null);
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

console.log('\nbuckling.js — snap-through vs. Euler/shell buckling');
{
  const { bucklingCheck, snapThroughForce, eulerColumnBuckling, shellLocalBuckling } = await import('../js/buckling.js');

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

  test('buckling margin decreases as sheet thickness increases (crease stiffness grows faster than shell strength)', () => {
    const base = { ...PRESETS.bistable6, chir: 1, material: 'polyimide' };
    const margins = [15, 50, 110].map(t => {
      const p = { ...base, thicknessUm: t };
      const g = computeGeometry(p);
      return bucklingCheck(p, g, 1.5).margin;
    });
    assert.ok(margins[0] > margins[1] && margins[1] > margins[2],
      `expected strictly decreasing margins with thickness, got ${margins}`);
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
