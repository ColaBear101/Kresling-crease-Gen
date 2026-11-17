// Independent checks of js/physics/mechanics.js (CST membrane + hinge model).
import { makeCST, makeFloorModel, floorEnergy, foldAnglesSym, makePoseEnergy, hessian6, jacobiEigen, wrapAngle, panelBucklingStrain } from '../js/physics/mechanics.js';
import { computeDesign } from '../js/core/design.js';
import { DEFAULTS, normalizeParams } from '../js/core/params.js';
import { test, near, ok, run } from './harness.mjs';

// deterministic pseudo-random numbers
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

test('CST strain from side lengths equals the Green strain of an affine map', () => {
  for (let trial = 0; trial < 50; trial++) {
    const l0 = 10 + 20 * rnd();
    const C = [l0 * (0.2 + 0.6 * rnd()), 5 + 15 * rnd()];
    const A = [0, 0], B = [l0, 0];
    const rest = [Math.hypot(B[0] - A[0], B[1] - A[1]), Math.hypot(C[0] - B[0], C[1] - B[1]), Math.hypot(A[0] - C[0], A[1] - C[1])];
    const F = [[1 + 0.1 * (rnd() - 0.5), 0.1 * (rnd() - 0.5)], [0.1 * (rnd() - 0.5), 1 + 0.1 * (rnd() - 0.5)]];
    const map = ([x, y]) => [F[0][0] * x + F[0][1] * y, F[1][0] * x + F[1][1] * y];
    const a = map(A), b = map(B), c = map(C);
    const cur = [Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1])];
    const cst = makeCST(rest, { E: 1000, nu: 0.3, t: 0.1 });
    const [gxx, gyy, gxy] = cst.strain(cur);
    // G = 1/2 (F^T F - I)
    const FtF = [
      [F[0][0] ** 2 + F[1][0] ** 2, F[0][0] * F[0][1] + F[1][0] * F[1][1]],
      [F[0][0] * F[0][1] + F[1][0] * F[1][1], F[0][1] ** 2 + F[1][1] ** 2],
    ];
    near(gxx, (FtF[0][0] - 1) / 2, 1e-10, 'gxx');
    near(gyy, (FtF[1][1] - 1) / 2, 1e-10, 'gyy');
    near(gxy, FtF[0][1] / 2, 1e-10, 'gxy');
    // energy against the closed form E t A / (2(1 - nu^2)) [(1-nu) tr(G^2) + nu tr(G)^2]
    const Aarea = 0.5 * l0 * C[1];
    const k = (1000 * 0.1 * Aarea) / (2 * (1 - 0.09));
    const expect = k * (0.7 * (gxx * gxx + gyy * gyy + 2 * gxy * gxy) + 0.3 * (gxx + gyy) ** 2);
    near(cst.energy(cur), expect, 1e-9 * Math.max(1, expect));
  }
});

test('buckling-capped CST equals plain CST in tension and is softer in compression', () => {
  const rest = [20, 25, 30];
  const plain = makeCST(rest, { E: 3500, nu: 0.3, t: 0.1 });
  const capped = makeCST(rest, { E: 3500, nu: 0.3, t: 0.1 }, 2e-4);
  const grow = rest.map((L) => L * 1.01);
  near(capped.energy(grow), plain.energy(grow), 1e-9 * plain.energy(grow));
  const shrink = rest.map((L) => L * 0.99);
  ok(capped.energy(shrink) < 0.1 * plain.energy(shrink), 'compression mostly relieved by buckling');
  ok(capped.energy(shrink) > 0, 'but not free');
});

test('pose energy is zero at the rigid deployed state and K is symmetric positive definite', () => {
  const d = computeDesign(normalizeParams(DEFAULTS));
  const m = makeFloorModel({ n: d.n, R: d.R, s: d.strip.s, h: d.strip.h }, d.material, { stacking: d.stacking, panel: 'thin' });
  const E = makePoseEnergy(m, d.states.deployed.H, d.states.deployed.phi);
  near(E([0, 0, 0, 0, 0, 0]), 0, 1e-12);
  near(floorEnergy(m, d.states.deployed.H, d.states.deployed.phi).total, 0, 1e-12);
  near(floorEnergy(m, d.states.folded.H, d.states.folded.phi).total, 0, 1e-12);
  const K = hessian6(E, 1e-3 * d.R, 1e-4);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) near(K[i][j], K[j][i], 1e-6 * Math.abs(K[i][i]) + 1e-9);
  const eig = jacobiEigen(K);
  ok(eig.values.every((v) => v > 0), 'positive definite');
});

test('symmetric-state energy agrees with the pose energy along a pure axial/twist motion', () => {
  const d = computeDesign(normalizeParams(DEFAULTS));
  const m = makeFloorModel({ n: d.n, R: d.R, s: d.strip.s, h: d.strip.h }, d.material,
    { stacking: d.stacking, panel: 'thin', restStates: [d.states.deployed, d.states.folded], restFrac: 0.3 });
  const { H, phi } = d.states.deployed;
  const Epose = makePoseEnergy(m, H, phi);
  for (const [dz, dr] of [[-0.5, 0.01], [-2, 0.05], [0.3, -0.02]]) {
    // pose energy omits ring hinges (end plates are rigid): subtract them from the symmetric energy
    const sym = floorEnergy(m, H + dz, phi + dr);
    const f = foldAnglesSym(m, H + dz, phi + dr);
    const ring = 0.5 * m.kappa * m.n * m.a * wrapAngle(f.ring - m.rest.ring) ** 2;
    near(Epose([0, 0, dz, 0, 0, dr]), sym.total - ring, 1e-6 * Math.max(1, sym.total));
  }
});

test('wrapAngle keeps fold differences continuous across ±pi', () => {
  near(wrapAngle(Math.PI - 0.01 - (-Math.PI + 0.01)), -0.02, 1e-12);
  near(wrapAngle(0.3), 0.3, 1e-15);
});

test('panel buckling strain scales with (t / w)^2', () => {
  const e1 = panelBucklingStrain([20, 25, 30], { nu: 0.3, t: 0.1 });
  const e2 = panelBucklingStrain([20, 25, 30], { nu: 0.3, t: 0.2 });
  near(e2 / e1, 4, 1e-9);
});

await run();
