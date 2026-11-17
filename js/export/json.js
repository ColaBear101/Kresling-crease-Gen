// Design files: the design parameters as pretty-printed JSON.
//
//   designFile(params) -> string
//     { "app": "Kresling Studio", "version": "1.1.0", "params": { ...normalised params } }
//   readDesignFile(text) -> { ok: true, params, ignored, source, notes, drawable? } | { ok: false, error }
//     source    'studio' | 'crease-gen'
//     notes     sentences the user should read after opening (what was converted or limited)
//     drawable  crease-gen only: false when this app draws no pattern for the preset
//               (it has no rigid fold); the first note then says why
//   fromCreaseGen(raw) -> the same result for a Kresling-crease-Gen preset object
//
// readDesignFile accepts that shape or a bare params object, as a string or as
// UTF-8 bytes (Uint8Array / ArrayBuffer), with or without a byte-order mark.
// Values are filled, coerced and clamped by normalizeParams; keys that are not
// design parameters are dropped and listed in `ignored`; older names (`ext`, one
// length for both end rings) are read as the current ones. It never throws: errors
// are one readable sentence, suitable for a toast.
//
// Presets exported by Kresling-crease-Gen (the app this one re-implements) are
// recognised and converted so that the printed creases stay exactly the same.
// Such a preset is a bare object in cm: dia, height (of one stack unit), n,
// floors, angle, ext, seaml, seamr, extcols, stack, scale, wallmm, thick, chir,
// material, seamAuto, _version. Its sheet is drawn as
//   polygon side  b  = pi * dia / n            (an arc of the entered circle)
//   floor height  fh = height / floors
//   rows shifted by -/+ dx with dx = fh / tan(angle), so the red crease, which
//   joins the same column of two rows, runs 2 * dx * chir sideways per floor;
//   the green crease starts at the same lower vertex and ends one column to the left.
// The same sheet here is "Design by: flat pattern" with
//   diameter      b / sin(pi / n)              (the tube really closes on side b)
//   strip height  fh
//   crease angle  the angle of the SHORT diagonal as drawn, and the handedness
//                 that leans the first floor the same way (see fromCreaseGen).
// A preset whose shape falls outside this app's ranges is refused with the
// reason, because opening it clamped would silently draw other creases.

import { APP_NAME, APP_VERSION, SCHEMA, RENAMED_KEYS, MATERIALS, normalizeParams, materialFields, schemaFor } from '../core/params.js';
import { computeDesign } from '../core/design.js';

const KNOWN = new Set([...SCHEMA.map((s) => s.key), ...Object.keys(RENAMED_KEYS)]);   // older names are read too
export const CREASE_GEN = 'Kresling-crease-Gen';
const LEGACY_KEYS = new Set(['dia', 'height', 'n', 'floors', 'angle', 'ext', 'seaml', 'seamr', 'extcols', 'stack',
  'scale', 'compress', 'wallmm', 'thick', 'chir', 'material', 'seamAuto', '_version']);
// what that app shows for a value its file does not carry
const LEGACY_DEFAULTS = { ext: 2, seaml: 1.4, seamr: 0, extcols: 1, stack: 1, scale: 100, wallmm: 0.8, thick: 50, chir: 1 };
const SHAPE_LABELS = { n: 'number of sides', dia: 'tube diameter', hFlat: 'floor height', angle: 'drawn crease angle', floors: 'number of floors', stack: 'stack count' };
const SOFT_LABELS = { scale: 'Print scale', ringBottom: 'Bottom ring', ringTop: 'Top ring', extcols: 'Seam panels', seamL: 'Seam strip left', seamR: 'Seam strip right', wall: 'Tube wall', thick: 'Thickness' };

export function designFile(params) {
  return `${JSON.stringify({ app: APP_NAME, version: APP_VERSION, params: normalizeParams(params || {}) }, null, 2)}\n`;
}

export function readDesignFile(text) {
  let src = text;
  if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) {
    try {
      src = new TextDecoder('utf-8', { fatal: true }).decode(src);
    } catch {
      return { ok: false, error: 'This file is not a text file, so it cannot be a design file.' };
    }
  }
  if (typeof src !== 'string') return { ok: false, error: 'Nothing to read: expected the text of a design file.' };
  src = src.replace(/^﻿/, '').trim();
  if (!src) return { ok: false, error: 'The file is empty.' };

  let data;
  try {
    data = JSON.parse(src);
  } catch (e) {
    const why = String((e && e.message) || '').replace(/\s+/g, ' ').slice(0, 80);
    return { ok: false, error: `This is not a design file: the text is not valid JSON${why ? ` (${why})` : ''}.` };
  }
  if (!isPlainObject(data)) {
    return { ok: false, error: 'This is not a design file: expected a JSON object with design parameters.' };
  }
  let raw = data;
  const wrapped = Object.prototype.hasOwnProperty.call(data, 'params');
  if (wrapped) {
    if (!isPlainObject(data.params)) return { ok: false, error: 'This is not a design file: "params" must be an object.' };
    raw = data.params;
  }
  if (!wrapped && isCreaseGen(raw)) return fromCreaseGen(raw);
  const keys = Object.keys(raw);
  if (!keys.some((k) => KNOWN.has(k))) {
    return { ok: false, error: `No ${APP_NAME} design parameters found in this file.` };
  }
  return { ok: true, params: normalizeParams(raw), ignored: keys.filter((k) => !KNOWN.has(k)), source: 'studio', notes: [] };
}

// A Kresling-crease-Gen preset gives the sheet height of one stack unit; this
// app's files never have `height` and always say how the shape is given.
function isCreaseGen(raw) {
  const has = (k) => Object.prototype.hasOwnProperty.call(raw, k);
  return has('height') && !['designBy', 'H0', 'H1', 'hFlat'].some(has);
}

/**
 * Convert a Kresling-crease-Gen preset (see the header) to this app's params,
 * keeping every crease where that app prints it.
 *
 * One floor of its sheet, seen from the printed side with row 0 at the bottom:
 * from a lower vertex the red crease runs `run` = 2 dx chir sideways and the
 * green one `run - b`. Here a floor is drawn (right-handed) with the long
 * diagonal running +s and the short one s - a, s >= a/2, and the crease angle
 * g is the short diagonal's: s = a - h / tan(g). So with a = b and h = fh:
 *   run >= b/2:  red is the long diagonal, s = run      -> right-handed, tan g = fh / (b - run)
 *   run <  b/2:  mirror image, green is the long one,
 *                s = b - run                            -> left-handed,  tan g = fh / run
 * (run < 0 is the usual case: angles above 90 deg lean the first floor to the left.)
 */
export function fromCreaseGen(raw) {
  if (!isPlainObject(raw)) return { ok: false, error: `This is not a ${CREASE_GEN} preset.` };
  const num = (k) => {
    let v = raw[k];
    if (v === undefined || v === null || v === '') v = LEGACY_DEFAULTS[k];
    if (typeof v === 'string') v = Number(v);
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  };
  const need = ['dia', 'height', 'n', 'floors', 'angle'];
  const missing = need.filter((k) => !Number.isFinite(num(k)));
  if (missing.length) {
    return { ok: false, error: `This ${CREASE_GEN} preset has no number for ${missing.join(', ')}, so its pattern cannot be rebuilt.` };
  }
  const dia = num('dia'), height = num('height'), angle = num('angle');
  const n = Math.round(num('n')), floors = Math.round(num('floors'));
  if (!(n >= 3 && floors >= 1 && dia > 0 && height > 0 && angle > 0 && angle < 180)) {
    return { ok: false, error: `This ${CREASE_GEN} preset does not describe a tube (sides, floors, diameter, height and angle must be positive).` };
  }

  const side = (Math.PI * dia) / n;                       // cm
  const fh = height / floors;                             // cm
  const hand = num('chir') === -1 ? -1 : 1;
  const run = ((2 * fh) / Math.tan((angle * Math.PI) / 180)) * hand;
  const rightHanded = run >= side / 2;
  const across = rightHanded ? side - run : run;          // short diagonal: fh up, `across` against the lean
  const gamma = (Math.atan2(fh, across) * 180) / Math.PI;
  const chir = rightHanded ? 1 : -1;

  const hasSeam = raw.seaml !== undefined || raw.seamr !== undefined;
  const seamAuto = raw.seamAuto === undefined ? !hasSeam : raw.seamAuto === true || raw.seamAuto === 'true' || raw.seamAuto === 1;
  const want = {
    designBy: 'flat', n, dia: (10 * side) / Math.sin(Math.PI / n), hFlat: 10 * fh, angle: gamma, chir,
    floors, stack: Math.round(num('stack')), stacking: 'alternate',
    scale: num('scale'), ringBottom: 10 * num('ext'), ringTop: 10 * num('ext'),
    seamAuto, extcols: Math.round(num('extcols')), seamL: 10 * num('seaml'), seamR: 10 * num('seamr'),
    wall: num('wallmm'),
  };
  const notes = [];
  if (raw.material === 'polyimide') Object.assign(want, { material: 'kapton', ...materialFields('kapton'), thick: num('thick') });
  const params = normalizeParams(want);

  // the shape must survive untouched: a clamped value would draw other creases
  const differs = (k) => !(Math.abs(params[k] - want[k]) <= 1e-9 * Math.max(1, Math.abs(want[k])));
  for (const key of Object.keys(SHAPE_LABELS)) {
    if (!differs(key)) continue;
    const s = schemaFor(key);
    const unit = s.unit ? (s.unit === '°' ? '°' : ` ${s.unit}`) : '';
    return {
      ok: false,
      error: `This ${CREASE_GEN} preset cannot be drawn here: its ${SHAPE_LABELS[key]} (${trim(want[key])}${unit}) is outside ${s.min}–${s.max}${unit}.`,
    };
  }

  // This app only draws patterns that fold with rigid panels; say so instead of
  // promising creases the pattern view will not show.
  const design = computeDesign(params);
  const drawable = design.valid;
  notes.push(drawable ? `${CREASE_GEN} preset, converted from cm to mm with the same creases.`
    : `${CREASE_GEN} preset, converted from cm to mm. ${APP_NAME} draws no pattern for it: ${design.errors[0] || 'the design is not valid.'}`);
  notes.push(`Diameter ${trim(10 * dia)} → ${trim(params.dia)} mm: the tube closes on the printed polygon side, which makes it this wide.`);
  if (Math.abs(gamma - angle) > 0.05) notes.push(`Crease angle ${trim(angle)}° → ${trim(gamma)}°: this app shows the angle as drawn.`);
  if (chir !== hand) notes.push(`Handedness reads ${chir > 0 ? 'right' : 'left'}-handed here: it is named by the way the first floor leans.`);
  if (raw.material !== 'polyimide') {
    notes.push(`The preset's sheet is "Generic (unmodeled)", so the analysis uses ${MATERIALS[params.material].label}.`);
  }
  const soft = ['scale', 'ringBottom', 'ringTop', 'wall', ...(seamAuto ? ['extcols'] : ['seamL', 'seamR']), ...(raw.material === 'polyimide' ? ['thick'] : [])];
  for (const key of soft) {
    if (!differs(key)) continue;
    const s = schemaFor(key);
    const unit = s.unit ? ` ${s.unit}` : '';
    notes.push(`${SOFT_LABELS[key]} limited to ${trim(params[key])}${unit} (the preset has ${trim(want[key])}${unit}).`);
  }
  return { ok: true, params, ignored: Object.keys(raw).filter((k) => !LEGACY_KEYS.has(k)), source: 'crease-gen', notes, drawable };
}

function trim(x) { return String(+Number(x).toFixed(2)); }

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
