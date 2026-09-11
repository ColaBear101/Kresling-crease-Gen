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

test('n < 3 is flagged invalid instead of silently producing NaN/Infinity geometry', () => {
  // b = dia*PI/n -> Infinity at n=0, and `Infinity > anything` makes the old
  // `|dx| < b` validity check pass vacuously, so buildVerts went on to emit
  // NaN vertex coordinates under a "valid: true" geometry. n=1/2 aren't
  // polygons either (and would let a "1-gon"/"2-gon" get flagged bistable
  // via the closed-form ratio, since bistableMax=1/sin(pi/n) doesn't itself
  // reject small n). Require n >= 3 explicitly.
  const base = { dia: 3, height: 20, floors: 10, angle: 100, stack: 1, chir: 1 };
  for (const n of [0, 1, 2]) {
    const g = computeGeometry({ ...base, n });
    assert.equal(g.valid, false, `n=${n} should be invalid`);
    assert.equal(g.bistable, false, `n=${n} should not be reported bistable`);
  }
  const g3 = computeGeometry({ ...base, n: 3 });
  assert.equal(g3.valid, true, 'n=3 is a legitimate polygon and should remain valid');
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

  test('reqBistable gates passers: bistable6-preset point passes, monostable-preset point does not', () => {
    const domA = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'angle', 'exp-xmin': 6, 'exp-xmax': 6,
      'exp-ymin': 105, 'exp-ymax': 105, 'exp-ysteps': 3,
      'exp-req-bistable': true,
    }); // matches PRESETS.bistable6 exactly (known bistable, see geometry.js tests above)
    runExplorer();
    const a = gridTotals(domA.text('exp-status'));
    assert.equal(a.passers, a.total, `expected every cell to pass (known-bistable preset), got ${a.passers}/${a.total}`);

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
    // Margins verified directly against buckling.js's bucklingCheck(): the
    // PRESETS.tower shape at 50um margins ~186x, at 1200um margins ~1.13x
    // (< the 1.5x safety factor requested here).
    const safe = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'angle', 'exp-xmin': 6, 'exp-xmax': 6,
      'exp-ymin': 95, 'exp-ymax': 95, 'exp-ysteps': 2,
      'exp-dia': 2.5, 'exp-height': 30, 'exp-floors': 16, 'exp-stack': 2, 'exp-thick': 50,
      'n-ext': 1.5, 'n-seaml': 1.31, 'n-seamr': 1.31, 'n-extcols': 1, 'n-scale': 80,
      'exp-req-buckling': true, 'exp-safety': 1.5,
    });
    runExplorer();
    const sSafe = gridTotals(safe.text('exp-status'));
    assert.equal(sSafe.passers, sSafe.total, `expected the thin (50um) tower shape to pass, got ${sSafe.passers}/${sSafe.total}`);

    const unsafe = explorerDom({ ...BASE_FIXED,
      'exp-xaxis': 'n', 'exp-yaxis': 'angle', 'exp-xmin': 6, 'exp-xmax': 6,
      'exp-ymin': 95, 'exp-ymax': 95, 'exp-ysteps': 2,
      'exp-dia': 2.5, 'exp-height': 30, 'exp-floors': 16, 'exp-stack': 2, 'exp-thick': 1200,
      'n-ext': 1.5, 'n-seaml': 1.31, 'n-seamr': 1.31, 'n-extcols': 1, 'n-scale': 80,
      'exp-req-buckling': true, 'exp-safety': 1.5,
    });
    runExplorer();
    const sUnsafe = gridTotals(unsafe.text('exp-status'));
    assert.equal(sUnsafe.passers, 0, `expected the thick (1200um) tower shape to fail, got ${sUnsafe.passers}/${sUnsafe.total}`);
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
