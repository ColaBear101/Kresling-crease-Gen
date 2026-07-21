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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
