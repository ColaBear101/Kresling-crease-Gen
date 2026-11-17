// Fast evaluation of one candidate design for the explorer grid.
//
//   EXPLORE_AXES -> [{ key, label, unit, min, max, step, integer, modes }]
//       parameters the explorer can scan; `modes` lists the designBy values
//       where the axis applies (ranges come from the params schema)
//   evaluateDesign(params, req) -> {
//       valid, status, reason, bistable, snapP (N), barrier (mJ/floor), stroke (mm),
//       ratio (folded/deployed), fits, fitScale, safety, peakStrain (fraction),
//       meets { bistable, buckling, fits, strain }, score, total }
//     req = { bistable, buckling, fits, strain, safety }: booleans say which
//     requirements count; `score` counts the met ones among them out of `total`.
// Uses a coarse energy path (81 samples) and computes buckling only when it is
// required and the design snaps, so one call stays around 10 ms.

import { normalizeParams, schemaFor } from '../core/params.js';
import { computeDesign } from '../core/design.js';
import { buildPattern } from '../core/pattern.js';
import { layoutPattern } from '../core/layout.js';
import { energyAnalysisWith, strainCheckOf } from './analysis.js';
import { bucklingFrom } from './buckling.js';

const AXIS_KEYS = [
  ['n', ['heights', 'flat']],
  ['dia', ['heights', 'flat']],
  ['H0', ['heights']],
  ['H1', ['heights']],
  ['hFlat', ['flat']],
  ['angle', ['flat']],
  ['floors', ['heights', 'flat']],
  ['thick', ['heights', 'flat']],
  ['hingeW', ['heights', 'flat']],
  ['restPct', ['heights', 'flat']],
];

// Width the explorer's default window is based on (15 % of it either side of the
// current value), where it differs from the control's range: the strip height and
// crease angle ranges were widened to open every Kresling-crease-Gen preset, and
// a wider default window would only make the default grid coarser.
const DEFAULT_SPAN = { hFlat: 148, angle: 115 };

export const EXPLORE_AXES = AXIS_KEYS.map(([key, modes]) => {
  const s = schemaFor(key);
  return { key, label: s.label, unit: s.unit || '', min: s.min, max: s.max, step: s.step, integer: s.step >= 1, modes,
    span: DEFAULT_SPAN[key] || s.max - s.min };
});

export function evaluateDesign(params, req = {}) {
  const want = {
    bistable: Boolean(req.bistable), buckling: Boolean(req.buckling),
    fits: Boolean(req.fits), strain: Boolean(req.strain),
  };
  const total = Object.values(want).filter(Boolean).length;
  const p = normalizeParams(params);
  const d = computeDesign(p);
  if (!d.valid) {
    return {
      valid: false, status: 'invalid', reason: d.errors[0] || 'Invalid design.',
      bistable: false, snapP: null, barrier: null, stroke: null, ratio: null, fits: false, fitScale: null,
      safety: null, peakStrain: null, meets: { bistable: false, buckling: false, fits: false, strain: false }, score: 0, total,
    };
  }
  const en = energyAnalysisWith(d, { samples: 81, scan: 36 });
  const bistable = Boolean(en.ok && en.bistable);
  const snapP = bistable && en.snapForce ? en.snapForce.P : null;
  const barrier = bistable ? en.barrierFromDeployed : null;
  const pattern = buildPattern(d);
  const layout = pattern ? layoutPattern(pattern, p) : null;
  const fits = Boolean(layout && layout.fits);
  const sc = strainCheckOf(d, en);
  const peakStrain = sc.ok ? sc.peak : null;
  let safety = null;
  if (want.buckling && bistable) {
    const bk = bucklingFrom(d, en);
    safety = bk.ok ? bk.safety : null;
  }
  const required = Number.isFinite(req.safety) ? req.safety : p.safety;
  const meets = {
    bistable,
    buckling: safety !== null && safety >= required,
    fits,
    strain: sc.ok && sc.pass,
  };
  const score = Object.keys(want).filter((k) => want[k] && meets[k]).length;
  return {
    valid: true, status: d.status, reason: en.ok ? null : en.reason,
    bistable, snapP, barrier,
    stroke: d.lengths.stroke, ratio: d.lengths.ratio,
    fits, fitScale: layout ? layout.fitScale : null,
    safety, peakStrain, meets, score, total,
  };
}
