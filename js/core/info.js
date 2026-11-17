// Text printed in the info box on the sheet (screen view, SVG, PDF, PNG).
//   infoLines(design, pattern, layout) -> [{ text, kind }]   kind: 'title' | 'data' | 'note'
//   LEGEND -> [{ kind: 'mountain'|'valley'|'end'|'glue'|'cut', label }]   every entry
//   legendFor(pattern) -> the entries that appear on this sheet ('end' only with
//     end rings, labelled with their fold direction; 'glue' only with seam strips)
//   SCALE_BAR_MM = 50

import { APP_NAME, APP_VERSION } from './params.js';

export const SCALE_BAR_MM = 50;

export const LEGEND = [
  { kind: 'mountain', label: 'Mountain fold' },
  { kind: 'valley', label: 'Valley fold' },
  { kind: 'end', label: 'End-ring fold' },
  { kind: 'glue', label: 'Seam strip (glue)' },
  { kind: 'cut', label: 'Cut' },
];

export function legendFor(pattern) {
  const out = [];
  for (const e of LEGEND) {
    if (e.kind === 'end') {
      const r = pattern && pattern.rings;
      if (!(r && (r.bottom > 0 || r.top > 0))) continue;
      out.push(pattern.endKind ? { kind: 'end', label: `End-ring fold (${pattern.endKind})` } : e);
    } else if (e.kind === 'glue') {
      if (pattern && pattern.seams && pattern.seams.length) out.push(e);
    } else out.push(e);
  }
  return out;
}

const f1 = (x) => (x === null || x === undefined ? '–' : x.toFixed(1));
const f2 = (x) => (x === null || x === undefined ? '–' : x.toFixed(2));

export function infoLines(design, pattern, layout) {
  const p = design.params;
  const lines = [];
  const hand = design.chir > 0 ? 'right-handed' : 'left-handed';
  // the sheet holds the whole stack: floors x stack count
  const floors = p.stack > 1 ? `${p.floors * p.stack} floors (${p.stack} × ${p.floors})` : `${p.floors} floors`;
  lines.push({ kind: 'title', text: `Kresling tube · n = ${design.n} · Ø ${f1(design.D)} mm · ${floors} · ${hand}` });
  if (design.valid) {
    const L = design.lengths;
    const fold = L.folded === null ? 'single stable state' : `folded ${f1(L.folded)} mm · stroke ${f1(L.stroke)} mm`;
    lines.push({ kind: 'data', text: `Deployed ${f1(L.deployed)} mm · ${fold}` });
    lines.push({ kind: 'data', text: `Creases: polygon ${f2(design.a)} · long ${f2(design.strip.b)} · short ${f2(design.strip.c)} mm · angle ${f2(design.strip.angleDeg)}°` });
  }
  const scale = layout ? layout.scale * 100 : p.scale;
  // the drawing already carries the scale, so the printer always prints at 100 %
  const drawn = Math.abs(scale - 100) > 1e-9 ? ` The sheet is drawn at ${f1(scale)}%.` : '';
  lines.push({ kind: 'note', text: `Print at 100% (actual size), no "fit to page".${drawn} The bar should measure ${f1((SCALE_BAR_MM * scale) / 100)} mm. Printed side = outside of the tube.` });
  lines.push({ kind: 'note', text: `${APP_NAME} ${APP_VERSION}` });
  return lines;
}
