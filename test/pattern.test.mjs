// Design + pattern + layout checks.
import { computeDesign, convertMode, bistableAngleWindow } from '../js/core/design.js';
import { buildPattern, polygonArea } from '../js/core/pattern.js';
import { layoutPattern, autoFitPercent } from '../js/core/layout.js';
import { DEFAULTS, PRESETS, SCHEMA, normalizeParams, migrateParams } from '../js/core/params.js';
import { creaseLengths } from '../js/core/kresling.js';
import { test, near, ok, eq, run } from './harness.mjs';

const P = (over = {}) => normalizeParams({ ...DEFAULTS, ...migrateParams(over) });   // `ext`: both end rings

function segsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
function isSimple(poly) {
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 2; j < poly.length; j++) {
      if (i === 0 && j === poly.length - 1) continue;
      if (segsIntersect(poly[i], poly[(i + 1) % poly.length], poly[j], poly[(j + 1) % poly.length])) return false;
    }
  }
  return true;
}
function onSegment(Q, s, tol = 1e-6) {
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
  const t = ((Q[0] - s.a[0]) * dx + (Q[1] - s.a[1]) * dy) / (dx * dx + dy * dy);
  if (t < -1e-9 || t > 1 + 1e-9) return false;
  return Math.hypot(s.a[0] + t * dx - Q[0], s.a[1] + t * dy - Q[1]) < tol;
}
function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

test('default design is bistable with the requested heights', () => {
  const d = computeDesign(P());
  eq(d.status, 'bistable');
  near(d.states.deployed.H, 24, 1e-6); near(d.states.folded.H, 8, 1e-6);
  eq(d.folds.ring, 'mountain'); eq(d.folds.short, 'mountain'); eq(d.folds.long, 'valley');
  eq(d.folds.end, 'mountain', 'end rings meet the body in mountain folds');
  ok(d.regime === 'classic');
  const L = creaseLengths(d.n, d.R, d.states.deployed.H, d.states.deployed.phi);
  near(L.b, d.strip.b, 1e-9); near(L.c, d.strip.c, 1e-9);
});

test('every preset computes, and patterns are simple polygons containing their creases', () => {
  for (const [key, pr] of Object.entries(PRESETS)) {
    for (const stacking of ['alternate', 'helical']) {
      for (const chir of [1, -1]) {
        const d = computeDesign(P({ ...pr.params, stacking, chir }));
        ok(d.valid, `${key} valid`);
        const pat = buildPattern(d);
        ok(pat.outline.length >= 4, `${key} outline`);
        ok(isSimple(pat.outline), `${key}/${stacking}/${chir} outline is simple`);
        for (const s of pat.segments) {
          if (s.kind === 'cut') continue;
          const mid = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
          ok(inside(mid, pat.outline), `${key}/${stacking}/${chir}: ${s.family} crease midpoint inside outline`);
        }
        near(pat.area, Math.abs(polygonArea(pat.outline)), 1e-6);
      }
    }
  }
});

test('sheet layout: straight seam strips and end rings, as in the original Kresling-crease-Gen', () => {
  const designs = { default: {}, ...Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.params])) };
  const sheets = [{}, { extcols: 2 }, { seamAuto: false, seamL: 9, seamR: 0 }, { seamAuto: false, seamL: 0, seamR: 31 }, { ext: 0, extcols: 0 },
    { ringBottom: 25, ringTop: 0 }, { ringBottom: 0, ringTop: 12.5 }, { ringBottom: 5, ringTop: 60 }];
  for (const [key, over] of Object.entries(designs)) {
    for (const stacking of ['alternate', 'helical']) {
      for (const chir of [1, -1]) {
        for (const sheet of sheets) {
          const params = P({ ...over, stacking, chir, ...sheet });
          const d = computeDesign(params);
          const pat = buildPattern(d);
          const tag = `${key}/${stacking}/${chir}/${JSON.stringify(sheet)}`;
          const { n, a, totalFloors: F } = d;             // the sheet holds the whole stack
          const W = n * a, h = d.strip.h, rb = params.ringBottom, rt = params.ringTop;
          const left = params.seamAuto ? params.extcols * a : params.seamL;
          const right = params.seamAuto ? params.extcols * a : params.seamR;
          // a rectangle: one full turn of the tube, the strips on the printed left/right, the rings
          near(pat.width, W + left + right, 1e-9, `${tag} width`);
          near(pat.height, F * h + rb + rt, 1e-9, `${tag} height`);
          eq(pat.outline.length, 4, `${tag} rectangle`);
          near(pat.area, pat.width * pat.height, 1e-6, `${tag} area`);
          near(pat.body.x, left, 1e-9, `${tag} body starts after the left strip`); near(pat.body.w, W, 1e-9);
          eq(pat.seams.map((s) => s.side).join(), [left > 0 && 'left', right > 0 && 'right'].filter(Boolean).join(), `${tag} strips`);
          eq(pat.rings.bottom, rb); eq(pat.rings.top, rt); eq(pat.endKind, rb > 0 || rt > 0 ? d.folds.end : null);
          near(pat.rowY[0], rb, 1e-9, `${tag} row 0 above the bottom ring`);
          // the body holds exactly one turn of every crease family
          const sum = (fam, tab) => pat.segments.filter((s) => s.family === fam && s.tab === tab).reduce((t, s) => t + s.len, 0);
          near(sum('ring', false), (F - 1) * n * a, 1e-6, `${tag} polygon folds`);
          near(sum('long', false), F * n * d.strip.b, 1e-6, `${tag} long diagonals`);
          near(sum('short', false), F * n * d.strip.c, 1e-6, `${tag} short diagonals`);
          near(sum('end', false), ((rb > 0) + (rt > 0)) * n * a, 1e-6, `${tag} end-ring folds`);
          for (const s of pat.segments.filter((x) => x.family === 'end')) {
            ok(Math.abs(s.a[1] - (s.row === 0 ? rb : rb + F * h)) < 1e-9 && (s.row === 0 ? rb > 0 : rt > 0), `${tag}: end-ring fold only where that end has a ring`);
          }
          // rolled up, every strip copy lies on a body crease of the same family and kind
          const body = pat.segments.filter((s) => !s.tab && s.kind !== 'cut');
          for (const s of pat.segments.filter((x) => x.tab)) {
            const shift = (s.a[0] + s.b[0]) / 2 < pat.body.x ? W : -W;
            const A = [s.a[0] + shift, s.a[1]], B = [s.b[0] + shift, s.b[1]];
            ok(body.some((t) => t.family === s.family && t.kind === s.kind && onSegment(A, t) && onSegment(B, t)), `${tag}: ${s.family} copy lands on a body crease`);
          }
          for (const s of pat.segments) {
            if (s.kind === 'cut') continue;
            for (const Q of [s.a, s.b]) ok(Q[1] >= rb - 1e-9 && Q[1] <= rb + F * h + 1e-9, `${tag}: no creases on the end rings`);
            const mx = (s.a[0] + s.b[0]) / 2;
            eq(s.tab, mx < pat.body.x || mx > pat.body.x + W, `${tag}: copies only inside the strips`);
            if (s.full) ok(s.full > s.len, `${tag}: a clipped piece remembers the whole crease`);
            else if (s.family === 'long') near(s.len, d.strip.b, 1e-9);
            else if (s.family === 'short') near(s.len, d.strip.c, 1e-9);
            else near(s.len, a, 1e-9);
          }
        }
      }
    }
  }
});

test('stack count: the whole stack is one sheet, the same as that many floors', () => {
  const key = (s) => [s.kind, s.family, s.tab, ...[s.a, s.b].map((q) => q.map((v) => v.toFixed(6)).join(',')).sort()].join('|');
  for (const stacking of ['alternate', 'helical']) {
    for (const chir of [1, -1]) {
      for (const [floors, stack] of [[7, 2], [3, 4], [1, 6], [5, 1]]) {
        const tag = `${floors} x ${stack} ${stacking} ${chir}`;
        const stacked = computeDesign(P({ floors, stack, stacking, chir }));
        const single = computeDesign(P({ floors: floors * stack, stack: 1, stacking, chir }));
        const a = buildPattern(stacked), b = buildPattern(single);
        eq(a.floors, floors * stack, `${tag}: floors on the sheet`);
        eq(a.rowY.length, floors * stack + 1, `${tag}: one row per polygon ring`);
        near(a.height, floors * stack * stacked.strip.h + stacked.params.ringBottom + stacked.params.ringTop, 1e-9, `${tag}: end rings only at the two ends`);
        eq(a.segments.length, b.segments.length, `${tag}: segment count`);
        eq(a.segments.map(key).sort().join('\n'), b.segments.map(key).sort().join('\n'), `${tag}: identical creases`);
        // end-ring folds only at the two ends of the sheet; every ring in between is an ordinary polygon fold
        const total = (fam) => a.segments.filter((s) => s.family === fam && !s.tab).reduce((t, s) => t + s.len, 0);
        near(total('end'), 2 * stacked.n * stacked.a, 1e-6, `${tag}: end-ring folds only at the two ends`);
        near(total('ring'), (floors * stack - 1) * stacked.n * stacked.a, 1e-6, `${tag}: polygon folds between all floors`);
        // what the sheet folds into is what the 3-D model and the analysis use
        near(stacked.lengths.deployed, floors * stack * stacked.states.deployed.H, 1e-9, `${tag}: length of the whole stack`);
      }
    }
  }
  // alternating floors keep alternating across stack units, so the ends do not rotate for an even total
  const odd = computeDesign(P({ floors: 7, stack: 2 }));
  near(odd.twist.endRotationDeployedDeg, 0, 1e-9, '7 x 2 alternating floors: twists cancel');
  ok(!odd.notes.some((t) => /mirror/i.test(t)), 'nothing has to be printed mirrored');
});

test('creaseSpacing is the smallest gap between neighbouring parallel creases', () => {
  for (const over of [{}, PRESETS.disc12.params, PRESETS.antiprism.params, { n: 20, dia: 10, H0: 2, H1: 1, floors: 3 }]) {
    const d = computeDesign(P(over));
    const pat = buildPattern(d);
    const { a } = d, { h, b, c } = d.strip;
    near(pat.creaseSpacing, Math.min(h, (a * h) / b, (a * h) / c), 1e-9, 'formula');
    // measured on the drawing: perpendicular distance between two neighbouring whole diagonals of floor 0
    for (const [fam, want] of [['long', (a * h) / b], ['short', (a * h) / c]]) {
      const list = pat.segments.filter((s) => s.family === fam && !s.tab && !s.full && s.floor === 0)
        .sort((p, q) => (p.a[0] + p.b[0]) - (q.a[0] + q.b[0]));
      ok(list.length >= 2, `${fam}: two whole creases on floor 0`);
      const [s0, s1] = list;
      const ux = (s0.b[0] - s0.a[0]) / s0.len, uy = (s0.b[1] - s0.a[1]) / s0.len;
      const dist = Math.abs((s1.a[0] - s0.a[0]) * uy - (s1.a[1] - s0.a[1]) * ux);
      near(dist, want, 1e-6, `${fam} diagonals are ${want.toFixed(3)} mm apart`);
      ok(pat.creaseSpacing <= dist + 1e-9, `${fam}: spacing not above the measured gap`);
    }
    near(pat.rowY[1] - pat.rowY[0], h, 1e-9, 'polygon folds are h apart');
  }
});

test('end rings: bottom and top set separately, 0-60 mm each, 10 mm to start', () => {
  for (const key of ['ringBottom', 'ringTop']) {
    const s = SCHEMA.find((x) => x.key === key);
    ok(s && s.type === 'range' && s.group === 'sheet', `${key} is a sidebar slider`);
    eq(s.min, 0); eq(s.max, 60); eq(s.default, 10); eq(DEFAULTS[key], 10);
  }
  ok(!SCHEMA.some((x) => x.key === 'ext'), 'the single End rings control is gone');
  // older designs (`ext`: one length for both rings) keep their rings
  eq(JSON.stringify(migrateParams({ ext: 25, n: 7 })), JSON.stringify({ n: 7, ringBottom: 25, ringTop: 25 }));
  eq(migrateParams({ ext: 25, ringTop: 5 }).ringTop, 5, 'a current key wins');
  const old = normalizeParams({ n: 7, ext: 35 });
  eq(old.ringBottom, 35); eq(old.ringTop, 35); ok(!('ext' in old), 'ext is not carried on');
  eq(normalizeParams({ ext: 75 }).ringTop, 60, 'clamped to 60 mm');
  eq(normalizeParams({}).ringBottom, 10, 'default 10 mm');
  eq(JSON.stringify(migrateParams(null)), '{}');
  // the working design the app saved by itself: an untouched old default (20 mm) starts at 10 mm now
  eq(migrateParams({ ext: 20 }, { autosaved: true }).ringBottom, undefined, 'old default left to the new default');
  eq(migrateParams({ ext: 35 }, { autosaved: true }).ringTop, 35, 'a length the user chose is kept');
  eq(normalizeParams({ ...DEFAULTS, ...migrateParams({ ext: 20 }, { autosaved: true }) }).ringTop, 10);
  eq(normalizeParams({ ...DEFAULTS, ...migrateParams({ ext: 20 }) }).ringTop, 20, 'a saved file or preset keeps 20 mm');
  // a sheet with a short bottom ring and a long top ring
  const d = computeDesign(P({ ringBottom: 15, ringTop: 35 }));
  const pat = buildPattern(d);
  const F = d.totalFloors, h = d.strip.h;
  near(pat.height, F * h + 50, 1e-9);
  const ys = pat.outline.map((q) => q[1]);
  near(Math.min(...ys), 0, 1e-12); near(Math.max(...ys), pat.height, 1e-9);
  near(pat.rowY[0], 15, 1e-9); near(pat.height - pat.rowY[F], 35, 1e-9, 'top ring above the last row');
  // only the bottom ring: the top row is the sheet edge, not a fold
  const one = buildPattern(computeDesign(P({ ringBottom: 20, ringTop: 0 })));
  ok(one.segments.some((s) => s.family === 'end' && s.row === 0) && !one.segments.some((s) => s.family === 'end' && s.row === F), 'end fold at the bottom only');
  near(one.height - one.rowY[F], 0, 1e-9, 'sheet ends at the last row');
  eq(buildPattern(computeDesign(P({ ringBottom: 0, ringTop: 0 }))).endKind, null, 'no rings, no end folds');
});

test('mirroring keeps lengths and kinds but flips x', () => {
  const r = buildPattern(computeDesign(P({ chir: 1 })));
  const l = buildPattern(computeDesign(P({ chir: -1 })));
  eq(r.segments.length, l.segments.length);
  near(r.width, l.width, 1e-9); near(r.area, l.area, 1e-9);
  ok(l.mirrored && !r.mirrored);
});

test('flat mode and heights mode describe the same pattern after conversion', () => {
  const p0 = P();
  const conv = convertMode(p0, 'flat');
  const d1 = computeDesign(P({ ...p0, ...conv }));
  near(d1.states.deployed.H, 24, 0.05); near(d1.states.folded.H, 8, 0.1);
});

test('antiprism preset is monostable, bistable window exists for default strip', () => {
  const d = computeDesign(P(PRESETS.antiprism.params));
  eq(d.status, 'monostable'); eq(d.regime, 'antiprism');
  eq(d.folds.end, d.folds.ring, 'end-ring folds follow the polygon folds here (valley)');
  const w = bistableAngleWindow(6, 20, 26);
  ok(w && w.lo > 90 && w.hi > w.lo, JSON.stringify(w));
});

test('layout fits the default on A4 and auto-fit makes big patterns fit', () => {
  const p = P();
  const pat = buildPattern(computeDesign(p));
  const L = layoutPattern(pat, p);
  ok(L.fits, 'fits'); ok(L.info, 'has info box');
  const big = P({ ...PRESETS.disc12.params, page: 'A4' });
  const patB = buildPattern(computeDesign(big));
  const LB = layoutPattern(patB, big);
  ok(!LB.fits && LB.tiles.length > 1, 'big pattern tiles');
  const pct = autoFitPercent(patB, big);
  const fitted = normalizeParams({ ...big, scale: pct });       // as the store applies it
  eq(fitted.scale, pct, 'a whole percent survives the scale control');
  const LB2 = layoutPattern(patB, fitted);
  ok(LB2.fits && LB2.info, `fits at ${pct}% with room for the info box`);
});

test('fit to page: a whole percent that really fits with room for the legend, in the chosen orientation', () => {
  let fitted = 0;
  const designs = { default: {}, ...Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.params])) };
  for (const [key, pr] of Object.entries(designs)) {
    for (const page of ['A4', 'Letter', 'A3']) {
      for (const orient of ['auto', 'portrait', 'landscape']) {
        for (const margin of [0, 8, 20]) {
          for (const over of [{}, { floors: 12 }, { stack: 3 }, { ringBottom: 60, ringTop: 45 }]) {
            const p = P({ ...pr, ...over, page, orient, margin });
            const pat = buildPattern(computeDesign(p));
            if (!pat) continue;
            const tag = `${key} ${page} ${orient} m${margin} ${JSON.stringify(over)}`;
            const pct = autoFitPercent(pat, p);
            ok(Number.isInteger(pct) && pct >= 10 && pct <= 200, `${tag}: whole percent ${pct}`);
            const q = normalizeParams({ ...p, scale: pct });
            eq(q.scale, pct, `${tag}: kept by the scale control`);
            const L = layoutPattern(pat, q);
            if (orient !== 'auto') eq(L.page.orient, orient, `${tag}: orientation kept`);
            if (pct > 10 && pct < 200) { ok(L.fits && L.info, `${tag}: fits at ${pct}% with room for the legend`); fitted++; }
          }
        }
      }
    }
  }
  ok(fitted > 300, `${fitted} cases checked`);
});

test('invalid inputs give errors, not crashes', () => {
  eq(computeDesign(P({ H0: 10, H1: 12 })).status, 'invalid');
  eq(computeDesign(P({ H0: 120, H1: 1, dia: 20 })).status, 'invalid');
  eq(buildPattern(computeDesign(P({ H0: 10, H1: 12 }))), null);
});

await run();
