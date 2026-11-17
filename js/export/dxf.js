// Crease pattern as an AutoCAD R12 ASCII DXF (laser cutters, plotters, CAD).
//
//   patternDXF(design, pattern, { scale = 1 } = {}) -> string
//
// Pattern frame: mm, x right, y up, bounding box from (0, 0); no page layout.
// `scale` is the sheet scale as a fraction (layout.scale): the app passes the
// print scale, so the DXF, the printed sheet and the press molds are one size,
// as in Kresling-crease-Gen. Dash lengths of the linetypes stay in mm.
// HEADER: $ACADVER AC1009, $INSUNITS 4 (mm), $MEASUREMENT 1
// (metric), $LTSCALE 1, extents and limits. TABLES: LTYPE with CONTINUOUS,
// DASHED and DASHDOT (the DASH patterns in mm: dash > 0, gap < 0, group 40 = total
// length) and LAYER with 0, CUT (7), MOUNTAIN (1, continuous), VALLEY (5, dashed),
// END_RING (1, dash-dot). An empty BLOCKS section, then ENTITIES: one LINE per pattern
// segment on its layer (colour and linetype BYLAYER). Group codes are right-aligned
// in 3 columns, every line ends in CRLF, plain ASCII throughout.
// Invalid designs throw an Error carrying design.errors[0].

import { DASH } from '../ui/theme.js';
import { segmentLayer } from './svg.js';

const LTYPES = [
  { name: 'CONTINUOUS', desc: 'Solid line', dash: [] },
  { name: 'DASHED', desc: 'Dashed __ __ __', dash: DASH.valley },
  { name: 'DASHDOT', desc: 'Dash dot __ . __ .', dash: DASH.end },
];

// scene layer id -> DXF layer (ACI colour, linetype)
const LAYERS = {
  cut: { name: 'CUT', colour: 7, ltype: 'CONTINUOUS' },
  mountain: { name: 'MOUNTAIN', colour: 1, ltype: 'CONTINUOUS' },
  valley: { name: 'VALLEY', colour: 5, ltype: 'DASHED' },
  endring: { name: 'END_RING', colour: 1, ltype: 'DASHDOT' },
};

export function patternDXF(design, pattern, { scale = 1 } = {}) {
  if (!design || !design.valid) {
    const why = design && Array.isArray(design.errors) && design.errors[0];
    throw new Error(why ? `Cannot export this design: ${why}` : 'Cannot export: the design is invalid.');
  }
  if (!pattern || !Array.isArray(pattern.segments)) throw new Error('Cannot export: there is no crease pattern.');
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;

  const out = [];
  const g = (code, value) => { out.push(String(code).padStart(3, ' '), String(value)); };
  const point = (code, x, y) => { g(code, real(x * k)); g(code + 10, real(y * k)); g(code + 20, '0.0'); };
  const W = pattern.width * k, H = pattern.height * k;

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSBASE'); point(10, 0, 0);
  g(9, '$EXTMIN'); point(10, 0, 0);
  g(9, '$EXTMAX'); point(10, pattern.width, pattern.height);   // point() applies the scale
  g(9, '$LIMMIN'); g(10, '0.0'); g(20, '0.0');
  g(9, '$LIMMAX'); g(10, real(W)); g(20, real(H));
  g(9, '$LTSCALE'); g(40, '1.0');
  g(9, '$INSUNITS'); g(70, 4);
  g(9, '$MEASUREMENT'); g(70, 1);
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, LTYPES.length);
  for (const lt of LTYPES) {
    g(0, 'LTYPE'); g(2, lt.name); g(70, 0); g(3, lt.desc); g(72, 65); g(73, lt.dash.length);
    g(40, real(lt.dash.reduce((a, b) => a + b, 0)));
    lt.dash.forEach((d, i) => g(49, real(i % 2 ? -d : d)));
  }
  g(0, 'ENDTAB');
  const layers = [{ name: '0', colour: 7, ltype: 'CONTINUOUS' }, ...Object.values(LAYERS)];
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const L of layers) { g(0, 'LAYER'); g(2, L.name); g(70, 0); g(62, L.colour); g(6, L.ltype); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'BLOCKS'); g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const s of pattern.segments) {
    g(0, 'LINE'); g(8, LAYERS[segmentLayer(s)].name);
    point(10, s.a[0], s.a[1]);
    point(11, s.b[0], s.b[1]);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return `${out.join('\r\n')}\r\n`;
}

// DXF real: up to 6 decimals, always with a decimal point, never exponent notation.
function real(x) {
  if (!Number.isFinite(x)) return '0.0';
  const s = String(Math.round(x * 1e6) / 1e6);
  return s.includes('.') ? s : `${s}.0`;
}
