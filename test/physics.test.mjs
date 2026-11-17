// Physics: energy analysis, vibration modes, buckling, sweeps, explorer evaluation.
import { computeDesign } from '../js/core/design.js';
import { DEFAULTS, PRESETS, normalizeParams } from '../js/core/params.js';
import { energyAnalysis, energyAnalysisWith, phiAtHeightFn, strainCheck } from '../js/physics/analysis.js';
import { modalAnalysis, modalSweep, poseStiffness, findEquilibrium } from '../js/physics/modal.js';
import { bucklingCheck, K_FACTORS } from '../js/physics/buckling.js';
import { thicknessSweep } from '../js/physics/sweeps.js';
import { evaluateDesign, EXPLORE_AXES } from '../js/physics/explore.js';
import { floorModel } from '../js/physics/analysis.js';
import { jacobiEigen } from '../js/physics/mechanics.js';
import { test, near, ok, eq, run } from './harness.mjs';

const D = (o = {}) => computeDesign(normalizeParams({ ...DEFAULTS, ...o }));

test('without hinges the wells sit on the two rigid states, at zero energy', () => {
  const d = D();
  const r = energyAnalysisWith(d, { hinges: false });
  ok(r.ok && r.bistable, 'bistable');
  const step = r.H[1] - r.H[0];
  near(r.deployed.H, d.states.deployed.H, step, 'deployed well');
  near(r.folded.H, d.states.folded.H, step, 'folded well');
  ok(r.E.every((e) => e >= -1e-12), 'energy never negative');
  // grid samples straddle the exact rigid heights, so allow the quadratic rise over half a sample
  ok(r.deployed.E < 0.01 * r.barrier.E && r.folded.E < 0.01 * r.barrier.E, 'wells near zero');
});

test('force is the derivative of the energy along the path', () => {
  const r = energyAnalysis(D());
  let checked = 0;
  for (let k = 5; k < r.H.length - 5; k += 7) {
    const fd = (r.E[k + 1] - r.E[k - 1]) / (r.H[k + 1] - r.H[k - 1]);
    // skip high-curvature stretches (around the barrier) where a central difference cannot follow F
    const smooth = Math.abs(r.F[k + 1] - r.F[k - 1]) < 0.1 * Math.abs(r.F[k]);
    if (!smooth || Math.abs(fd) < 0.05) continue;
    near(r.F[k], fd, 0.02 * Math.abs(fd) + 1e-3, `F at H=${r.H[k].toFixed(2)}`);
    checked++;
  }
  ok(checked > 10, `checked ${checked} samples`);
});

test('default paper design snaps with a realistic force and passes the strain check', () => {
  const d = D();
  const r = energyAnalysis(d);
  ok(r.bistable, 'bistable');
  ok(r.snapForce.P > 0.5 && r.snapForce.P < 30, `snap ${r.snapForce.P} N`);
  ok(r.barrierFromDeployed > 0 && r.barrierFromFolded > 0, 'barrier above both wells');
  const sc = strainCheck(d);
  ok(sc.ok && sc.peak > 0 && sc.peak < 0.05, `peak strain ${sc.peak}`);
  const phi = phiAtHeightFn(d);
  near(phi(r.deployed.H), r.phi[r.deployed.index], 1e-9);
});

test('stiffness is symmetric positive definite and lateral modes pair up', () => {
  const d = D();
  const m = floorModel(d);
  const eq0 = findEquilibrium(m, d.states.deployed.H, d.states.deployed.phi);
  const K = poseStiffness(m, eq0.H, eq0.phi);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) near(K[i][j], K[j][i], 1e-6 * Math.max(Math.abs(K[i][i]), Math.abs(K[j][j])));
  ok(jacobiEigen(K).values.every((v) => v > 0), 'positive definite');
  const mo = modalAnalysis(d);
  ok(mo.ok, mo.reason);
  for (const st of mo.states) {
    const lat = st.modes.filter((x) => !['axial', 'torsional', 'axial-torsional'].includes(x.kind)).map((x) => x.f).sort((a, b) => a - b);
    eq(lat.length, 4, `${st.key}: four off-axis modes`);
    near(lat[0], lat[1], 0.01 * lat[1], 'first pair degenerate');
    near(lat[2], lat[3], 0.01 * lat[3], 'second pair degenerate');
  }
});

test('frequencies scale as 1/sqrt(mass) when only the payload changes', () => {
  const a = modalAnalysis(D({ payload: 100 }));
  const b = modalAnalysis(D({ payload: 400 }));
  // sheet mass (~1.5 g) is small next to 100 g: ratio close to 2
  const fa = a.states[0].modes[0].f, fb = b.states[0].modes[0].f;
  near(fa / fb, 2, 0.03);
});

test('Euler load follows pi^2 EI/(KL)^2 and quarters when the stack doubles', () => {
  const b1 = bucklingCheck(D({ floors: 4 }));
  const b2 = bucklingCheck(D({ floors: 8 }));
  ok(b1.ok && b2.ok);
  near(b1.Pe, (Math.PI ** 2 * b1.EI) / (K_FACTORS[b1.endCond] * b1.length) ** 2, 1e-9 * b1.Pe);
  near(b2.EI, b1.EI, 1e-6 * b1.EI);
  near(b2.Pe / b1.Pe, 0.25, 1e-6);
  ok(b1.Pcr <= b1.Pe, 'shear only lowers the load');
  const pinned = bucklingCheck(D({ floors: 4, endCond: 'pinned' }));
  near(pinned.Pe / b1.Pe, 4, 1e-6);
});

test('thickness sweep: kappa scales with t^3 and the current thickness is inside', () => {
  const s = thicknessSweep(D());
  ok(s.ok);
  near(s.kappa[s.t.length - 1] / s.kappa[0], (s.t[s.t.length - 1] / s.t[0]) ** 3, 1e-6);
  ok(s.t[0] <= s.current && s.current <= s.t[s.t.length - 1]);
  ok(s.kAxial.every((k) => k === null || k > 0));
});

test('modal sweep returns the four series over a twist range containing the design', () => {
  const s = modalSweep(D(), { samples: 15 });
  ok(s.ok, s.reason);
  eq(s.series.length, 4);
  ok(s.x[0] <= s.current && s.current <= s.x[s.x.length - 1], 'current inside the range');
  ok(s.series.every((ser) => ser.y.length === s.x.length));
});

test('explorer evaluation: default meets everything, fast enough, invalid handled', () => {
  const req = { bistable: true, buckling: true, fits: true, strain: true, safety: 1.5 };
  const p = normalizeParams(DEFAULTS);
  const r = evaluateDesign(p, req);
  ok(r.valid && r.bistable && r.fits, JSON.stringify(r));
  eq(r.total, 4);
  for (let i = 0; i < 3; i++) evaluateDesign({ ...p, H1: 6 + i }, req);   // warm up
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) evaluateDesign({ ...p, H1: 5 + i * 0.3 }, req);
  const ms = (performance.now() - t0) / 20;
  ok(ms < 25, `${ms.toFixed(1)} ms per evaluation`);
  const bad = evaluateDesign({ ...p, H0: 10, H1: 12 }, req);
  ok(!bad.valid && bad.score === 0);
  ok(EXPLORE_AXES.some((a) => a.key === 'angle' && a.modes.includes('flat')));
});

test('every preset runs through every analysis without throwing', () => {
  for (const [key, pr] of Object.entries(PRESETS)) {
    for (const panel of ['thin', 'stiff']) {
      const d = D({ ...pr.params, panel });
      const e = energyAnalysis(d);
      ok(e.ok, `${key} energy: ${e.reason}`);
      ok(modalAnalysis(d).ok !== undefined, `${key} modal`);
      ok(bucklingCheck(d).ok !== undefined, `${key} buckling`);
      ok(strainCheck(d).ok !== undefined, `${key} strain`);
    }
  }
  const inv = D({ H0: 10, H1: 12 });
  for (const fn of [energyAnalysis, modalAnalysis, bucklingCheck, strainCheck, thicknessSweep]) {
    const r = fn(inv);
    ok(r.ok === false && typeof r.reason === 'string', 'invalid design gives a reason');
  }
});

test('timing: main energy analysis under 80 ms', () => {
  const t0 = performance.now();
  energyAnalysisWith(D({ n: 9, dia: 55 }));
  const ms = performance.now() - t0;
  ok(ms < 80, `${ms.toFixed(0)} ms`);
});

await run();
