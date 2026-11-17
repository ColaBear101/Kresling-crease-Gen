// Checks of the exact rigid-panel geometry in js/core/kresling.js.
import {
  chord, creaseLengths, stripFromState, stripFromHeights, stripFromFlat, flatAngle,
  rigidStates, ringVertex, foldAngle, TAU,
} from '../js/core/kresling.js';
import { test, near, ok, run } from './harness.mjs';

const deg = (x) => x * Math.PI / 180;

test('chord is 2R sin(pi/n)', () => {
  near(chord(6, 10), 10, 1e-12);          // hexagon side = R
  near(chord(4, 1), Math.SQRT2, 1e-12);
});

test('state -> strip -> states round trip recovers the deployed state', () => {
  for (const n of [3, 4, 5, 6, 8, 12]) {
    const R = 20, H = 18, phi = TAU / n + deg(25);
    const st = stripFromState(n, R, H, phi);
    const rs = rigidStates(n, R, st.s, st.h);
    ok(rs.states.length === 2, 'two solutions');
    near(rs.states[0].H, H, 1e-9, `n=${n} deployed H`);
    near(rs.states[0].phi, phi, 1e-9, `n=${n} deployed phi`);
    near(rs.states[0].phi + rs.states[1].phi, Math.PI + TAU / n, 1e-9, 'twists add to pi + 2pi/n');
    // both states really have the strip's crease lengths
    for (const s of rs.states.filter((x) => x.ok)) {
      const L = creaseLengths(n, R, s.H, s.phi);
      near(L.b, st.b, 1e-9); near(L.c, st.c, 1e-9);
    }
  }
});

test('design by two heights gives those two heights back', () => {
  const n = 6, R = 25;
  for (const [H0, H1] of [[30, 0], [30, 10], [22, 15], [40, 5]]) {
    const st = stripFromHeights(n, R, H0, H1);
    ok(st, `strip exists for ${H0}/${H1}`);
    const rs = rigidStates(n, R, st.s, st.h);
    near(rs.states[0].H, H0, 1e-8, 'H0');
    near(rs.states[1].H, H1, 1e-6, 'H1');
    ok(rs.states[0].ok && rs.states[1].ok, 'both reachable');
  }
});

test('flat angle round trip', () => {
  const n = 7, R = 12, h = 9;
  for (const g of [95, 105, 118, 130]) {
    const st = stripFromFlat(n, R, h, deg(g));
    near(flatAngle(st.a, st.s, st.h) * 180 / Math.PI, g, 1e-9);
  }
  // 90 deg means a vertical short diagonal: s == a
  const v = stripFromFlat(n, R, h, deg(90));
  near(v.s, v.a, 1e-9);
});

test('fold signs in the classic regime: rings and short diagonals mountain, long diagonals valley', () => {
  const n = 6, R = 10;
  const st = stripFromHeights(n, R, 14, 4);
  const { phi0 } = st;
  const H = 14;
  // three rings, same-handed floors: ring k at height kH, angle k*phi
  const P = (i) => ringVertex(R, n, i, 0, 0);
  const Q = (i) => ringVertex(R, n, i, H, phi0);
  const S = (i) => ringVertex(R, n, i, 2 * H, 2 * phi0);
  // Triangles of floor P->Q, CCW from outside: (P_i, P_{i+1}, Q_i) and (P_i, Q_i, Q_{i-1})
  const fb = foldAngle(P(0), Q(0), Q(-1), P(1));      // long diagonal P0-Q0
  const fc = foldAngle(P(0), Q(-1), P(-1), Q(0));     // short diagonal P0-Q_{-1}
  // ring edge Q0-Q1: lower triangle (P1, Q1, Q0) and upper triangle (Q0, Q1, S0)
  const fr = foldAngle(Q(0), Q(1), S(0), P(1));
  ok(fc > 0, `short diagonal mountain (${fc})`);
  ok(fb < 0, `long diagonal valley (${fb})`);
  ok(fr > 0, `ring edge mountain (${fr})`);
});

await run();
