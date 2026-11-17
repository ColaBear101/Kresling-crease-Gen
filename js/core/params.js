// Design parameters: schema (drives the sidebar), defaults, materials, presets.
// Units in the schema are what the user types; computeDesign() converts.

export const APP_NAME = 'Kresling Studio';
export const APP_VERSION = '1.1.0';

export const MATERIALS = {
  paper80: { label: 'Copy paper 80 g/m²', thick: 100, E: 3.5, nu: 0.30, rho: 0.80, strainMax: 1.5,
    note: 'Typical office paper; E varies 2–6 GPa with fibre direction.' },
  card200: { label: 'Cardstock 200 g/m²', thick: 250, E: 3.0, nu: 0.30, rho: 0.80, strainMax: 1.5,
    note: 'Typical folding cardstock.' },
  kapton: { label: 'Polyimide film (Kapton HN)', thick: 50, E: 2.5, nu: 0.34, rho: 1.42, strainMax: 3,
    note: 'DuPont Kapton HN datasheet: E ≈ 2.5 GPa, ν ≈ 0.34, 1.42 g/cm³.' },
  pet: { label: 'PET film (Mylar)', thick: 100, E: 4.0, nu: 0.38, rho: 1.39, strainMax: 2.5,
    note: 'Typical biaxially oriented PET film.' },
  pp: { label: 'Polypropylene sheet', thick: 300, E: 1.5, nu: 0.42, rho: 0.90, strainMax: 5,
    note: 'Typical PP craft sheet.' },
  custom: { label: 'Custom', thick: 100, E: 3.0, nu: 0.30, rho: 1.00, strainMax: 2, note: 'Enter your own values.' },
};

export const PAGES = {
  A4: { w: 210, h: 297, label: 'A4' },
  Letter: { w: 215.9, h: 279.4, label: 'US Letter' },
  A3: { w: 297, h: 420, label: 'A3' },
};

// type: 'range' (slider + number), 'select', 'check'
// when: optional (params) => boolean, hides the control when false
export const SCHEMA = [
  // ── Shape ──
  { key: 'designBy', group: 'shape', type: 'select', label: 'Design by', default: 'heights',
    options: [['heights', 'Folded heights'], ['flat', 'Flat pattern']],
    help: 'Folded heights: give the two stable heights of a floor. Flat pattern: give the strip height and crease angle as drawn.' },
  { key: 'n', group: 'shape', type: 'range', label: 'Sides', unit: '', min: 3, max: 20, step: 1, default: 6,
    help: 'Number of polygon sides (panels around the tube).' },
  { key: 'dia', group: 'shape', type: 'range', label: 'Diameter', unit: 'mm', min: 10, max: 250, step: 0.5, default: 40,
    help: 'Diameter of the circle through the polygon corners.' },
  { key: 'H0', group: 'shape', type: 'range', label: 'Deployed floor height', unit: 'mm', min: 2, max: 150, step: 0.1, default: 24,
    when: (p) => p.designBy === 'heights', help: 'Height of one floor in the open (deployed) stable state.' },
  { key: 'H1', group: 'shape', type: 'range', label: 'Folded floor height', unit: 'mm', min: 0, max: 100, step: 0.1, default: 8,
    when: (p) => p.designBy === 'heights', help: 'Height of one floor in the collapsed stable state. 0 = folds completely flat.' },
  { key: 'hFlat', group: 'shape', type: 'range', label: 'Strip height', unit: 'mm', min: 2, max: 150, step: 0.1, default: 26,
    when: (p) => p.designBy === 'flat', help: 'Height of one floor strip on the flat sheet.' },
  { key: 'angle', group: 'shape', type: 'range', label: 'Crease angle', unit: '°', min: 45, max: 160, step: 0.1, default: 108.3,
    when: (p) => p.designBy === 'flat',
    help: 'Angle between a polygon fold and the short (mountain) diagonal, as drawn. 90° is vertical; above 90° gives the classic Kresling.' },
  { key: 'chir', group: 'shape', type: 'select', label: 'Handedness', default: 1,
    options: [[1, 'Right-handed'], [-1, 'Left-handed']], help: 'Mirror image of the pattern.' },

  // ── Floors ──
  { key: 'floors', group: 'floors', type: 'range', label: 'Floors', unit: '', min: 1, max: 30, step: 1, default: 6 },
  { key: 'stack', group: 'floors', type: 'range', label: 'Stack count', unit: '', min: 1, max: 6, step: 1, default: 1,
    help: 'Repeats the floors on the same sheet: the tube has floors × stack count floors in one piece, as in Kresling-crease-Gen.' },
  { key: 'stacking', group: 'floors', type: 'select', label: 'Floor stacking', default: 'alternate',
    options: [['alternate', 'Alternating'], ['helical', 'Same hand']],
    help: 'Alternating mirrors every other floor, so the twists cancel and the ends do not rotate against each other. Same hand: every floor twists the same way and the end rotations add up.' },

  // ── Sheet & print ──
  { key: 'page', group: 'sheet', type: 'select', label: 'Paper', default: 'A4',
    options: [['A4', 'A4'], ['Letter', 'US Letter'], ['A3', 'A3']] },
  { key: 'orient', group: 'sheet', type: 'select', label: 'Orientation', default: 'auto',
    options: [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
  { key: 'scale', group: 'sheet', type: 'range', label: 'Print scale', unit: '%', min: 10, max: 200, step: 1, default: 100,
    help: 'Scales the whole pattern. At anything but 100% the folded tube is scaled too.' },
  { key: 'margin', group: 'sheet', type: 'range', label: 'Page margin', unit: 'mm', min: 0, max: 25, step: 0.5, default: 8 },
  { key: 'ringBottom', group: 'sheet', type: 'range', label: 'Bottom ring', unit: 'mm', min: 0, max: 60, step: 0.5, default: 10,
    help: 'Plain band across the whole sheet below the first polygon fold. Rolled up, it closes into a ring at the bottom of the tube, for gluing an end cap, mounting it, or joining another tube. 0 = no ring.' },
  { key: 'ringTop', group: 'sheet', type: 'range', label: 'Top ring', unit: 'mm', min: 0, max: 60, step: 0.5, default: 10,
    help: 'Plain band across the whole sheet above the last polygon fold. Rolled up, it closes into a ring at the top of the tube. 0 = no ring.' },
  { key: 'seamAuto', group: 'sheet', type: 'check', label: 'Seam strips made of whole panels', default: true,
    help: 'Straight glue strips on both sides of the sheet for closing the tube when you roll it. On: each strip is a whole number of panels wide. Off: set each width in mm. Either way the strip carries copies of the creases, so the glued overlap folds with the tube.' },
  { key: 'extcols', group: 'sheet', type: 'range', label: 'Seam panels', unit: '', min: 0, max: 4, step: 1, default: 1,
    when: (p) => p.seamAuto, help: 'Width of each seam strip in panels, on the left and the right. 0 = no strips (tape the seam).' },
  { key: 'seamL', group: 'sheet', type: 'range', label: 'Seam strip left', unit: 'mm', min: 0, max: 60, step: 0.5, default: 14,
    when: (p) => !p.seamAuto, help: 'Glue strip on the left edge of the printed sheet. 0 = none.' },
  { key: 'seamR', group: 'sheet', type: 'range', label: 'Seam strip right', unit: 'mm', min: 0, max: 60, step: 0.5, default: 0,
    when: (p) => !p.seamAuto, help: 'Glue strip on the right edge of the printed sheet. 0 = none.' },

  // ── Material ──
  { key: 'material', group: 'material', type: 'select', label: 'Sheet', default: 'paper80',
    options: Object.entries(MATERIALS).map(([k, m]) => [k, m.label]) },
  { key: 'thick', group: 'material', type: 'range', label: 'Thickness', unit: 'µm', min: 6, max: 1000, step: 1, default: 100 },
  { key: 'E', group: 'material', type: 'range', label: "Young's modulus", unit: 'GPa', min: 0.1, max: 10, step: 0.05, default: 3.5 },
  { key: 'nu', group: 'material', type: 'range', label: "Poisson's ratio", unit: '', min: 0, max: 0.49, step: 0.01, default: 0.30 },
  { key: 'rho', group: 'material', type: 'range', label: 'Density', unit: 'g/cm³', min: 0.1, max: 3, step: 0.01, default: 0.80 },
  { key: 'strainMax', group: 'material', type: 'range', label: 'Strain limit', unit: '%', min: 0.2, max: 20, step: 0.1, default: 1.5,
    help: 'Stretch at which the sheet yields or tears. The analysis warns when snapping needs more.' },
  { key: 'hingeW', group: 'material', type: 'range', label: 'Crease hinge width', unit: 'mm', min: 0.2, max: 20, step: 0.1, default: 2,
    help: 'Effective width of a crease when it acts as a hinge, k = E·t³/(12(1−ν²)·w). Wider = softer creases.' },

  { key: 'panel', group: 'material', type: 'select', label: 'Panel model', default: 'thin',
    options: [['thin', 'Thin sheet (panels buckle)'], ['stiff', 'Stiff panels (stretch only)']],
    help: 'Thin: panels wrinkle once compression passes their plate-buckling stress, which is how paper and film behave. Stiff: panels only stretch, an upper bound that overstates forces by orders of magnitude for thin sheets.' },
  { key: 'restPct', group: 'material', type: 'range', label: 'Crease rest position', unit: '%', min: 0, max: 100, step: 1, default: 50,
    help: 'Where the creases are relaxed: 0% = deployed shape, 100% = folded shape. Pre-creasing flat pushes this up.' },

  // ── Analysis ──
  { key: 'payload', group: 'analysis', type: 'range', label: 'Top mass', unit: 'g', min: 0, max: 500, step: 0.5, default: 5,
    help: 'Mass carried by the top ring (end cap plus payload), for the vibration modes.' },
  { key: 'endCond', group: 'analysis', type: 'select', label: 'End supports', default: 'fixed-free',
    options: [['fixed-free', 'Fixed – free'], ['pinned', 'Pinned – pinned'], ['fixed-pinned', 'Fixed – pinned'], ['fixed-fixed', 'Fixed – fixed']] },
  { key: 'safety', group: 'analysis', type: 'range', label: 'Required safety factor', unit: '', min: 1, max: 5, step: 0.1, default: 1.5 },

  // ── 3-D printing ──
  { key: 'wall', group: 'fab', type: 'range', label: 'Tube wall', unit: 'mm', min: 0.4, max: 5, step: 0.1, default: 0.8 },
  { key: 'moldBase', group: 'fab', type: 'range', label: 'Mold plate', unit: 'mm', min: 1, max: 10, step: 0.5, default: 3 },
  { key: 'ridgeH', group: 'fab', type: 'range', label: 'Ridge height', unit: 'mm', min: 0.3, max: 5, step: 0.1, default: 1.2 },
  { key: 'ridgeW', group: 'fab', type: 'range', label: 'Ridge width', unit: 'mm', min: 0.3, max: 3, step: 0.1, default: 0.8 },
  { key: 'ridgeGap', group: 'fab', type: 'range', label: 'Clearance at corners', unit: 'mm', min: 0, max: 5, step: 0.1, default: 1,
    help: 'Ridges stop this far short of each vertex so the sheet is not crushed where creases meet.' },
];

export const GROUPS = [
  ['shape', 'Shape'],
  ['floors', 'Floors'],
  ['sheet', 'Sheet & print'],
  ['material', 'Material'],
  ['analysis', 'Analysis'],
  ['fab', '3-D printing'],
];

export const DEFAULTS = Object.freeze(Object.fromEntries(SCHEMA.map((s) => [s.key, s.default])));

export const PRESETS = {
  classic6: { label: 'Bistable hexagon', params: { designBy: 'heights', n: 6, dia: 40, H0: 24, H1: 8, floors: 6, stack: 1 } },
  flatfold6: { label: 'Flat-folding hexagon', params: { designBy: 'heights', n: 6, dia: 40, H0: 26, H1: 0, floors: 6, stack: 1 } },
  tower8: { label: 'Octagon tower (2 × 7 floors)', params: { designBy: 'heights', n: 8, dia: 44, H0: 20, H1: 6, floors: 7, stack: 2 } },
  compact5: { label: 'Compact pentagon', params: { designBy: 'heights', n: 5, dia: 30, H0: 16, H1: 5, floors: 4, stack: 1 } },
  disc12: { label: 'Wide 12-gon disc', params: { designBy: 'heights', n: 12, dia: 90, H0: 14, H1: 3, floors: 3, stack: 1, page: 'A3' } },
  antiprism: { label: 'Monostable (crease angle < 90°)', params: { designBy: 'flat', n: 6, dia: 40, hFlat: 30, angle: 80, floors: 5, stack: 1 } },
  kapton: { label: 'Kapton film spring', params: { designBy: 'heights', n: 6, dia: 30, H0: 18, H1: 7, floors: 5, stack: 1,
    material: 'kapton', thick: 50, E: 2.5, nu: 0.34, rho: 1.42, strainMax: 3, hingeW: 1 } },
};

/**
 * Older names of design parameters, still read from design files, saved designs
 * and presets. `ext` (Kresling Studio 1.0-1.1) was one length for both end rings.
 */
export const RENAMED_KEYS = Object.freeze({ ext: Object.freeze(['ringBottom', 'ringTop']) });

// What `ext` defaulted to before the rings were split; the rings now start at 10 mm.
const OLD_DEFAULTS = Object.freeze({ ext: 20 });

/**
 * Copy of `input` with older key names moved to the current ones; a current key
 * that is already there wins. Apply it to a stored or imported object BEFORE
 * merging it with DEFAULTS (normalizeParams applies it too, for direct calls).
 * opts.autosaved: the object is the working design the app saved by itself, so an
 * old value that is still the old default takes the new default instead.
 */
export function migrateParams(input, { autosaved = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = { ...input };
  for (const [old, keys] of Object.entries(RENAMED_KEYS)) {
    if (!Object.prototype.hasOwnProperty.call(out, old)) continue;
    const v = out[old];
    delete out[old];
    if (v === undefined || v === null || v === '') continue;
    if (autosaved && Number(v) === OLD_DEFAULTS[old]) continue;
    for (const k of keys) if (out[k] === undefined || out[k] === null || out[k] === '') out[k] = v;
  }
  return out;
}

/** Fill in defaults, coerce types and clamp to the schema ranges (older key names too, see migrateParams). */
export function normalizeParams(input = {}) {
  const src = migrateParams(input);
  const out = {};
  for (const s of SCHEMA) {
    let v = src[s.key];
    if (v === undefined || v === null || v === '') v = s.default;
    if (s.type === 'range') {
      v = Number(v);
      if (!Number.isFinite(v)) v = s.default;
      v = Math.min(s.max, Math.max(s.min, v));
      if (s.step >= 1) v = Math.round(v);
    } else if (s.type === 'check') {
      v = v === true || v === 'true' || v === 1 || v === '1';
    } else if (s.type === 'select') {
      const opts = s.options.map((o) => o[0]);
      const hit = opts.find((o) => String(o) === String(v));
      v = hit === undefined ? s.default : hit;
    }
    out[s.key] = v;
  }
  return out;
}

/** Material fields implied by picking a material preset. */
export function materialFields(key) {
  const m = MATERIALS[key];
  if (!m || key === 'custom') return {};
  return { thick: m.thick, E: m.E, nu: m.nu, rho: m.rho, strainMax: m.strainMax };
}

export function schemaFor(key) {
  return SCHEMA.find((s) => s.key === key);
}
