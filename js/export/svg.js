// Printable sheet of the crease pattern: one drawing model (the "scene") shared
// by the SVG, PDF and PNG exporters, plus its SVG serialisation.
//
//   patternSVG(design, pattern, layout, { tile } = {}) -> string     SVG 1.1, width/height in mm
//   sheetScene(design, pattern, layout, { tile } = {}) -> scene      page mm, origin top-left, y down
//   sceneSVG(scene, { pixelWidth, pixelHeight } = {}) -> string      pixel size only for rasterising
//   needsInfoPage(layout) -> boolean       no pattern page has room for the info box
//   infoScene(design, pattern, layout) -> scene      the legend page used in that case
//   lineStyles(scale) -> { mountain, valley, endring, cut }          print styles at a layout scale
//   segmentLayer(segment) -> 'mountain' | 'valley' | 'endring' | 'cut'
//   textWidth(text, sizeMm) -> mm          Helvetica metrics (Arial has the same widths)
//   winAnsiCodes(text) -> number[]         WinAnsi byte codes; other characters become ASCII
//   wrapText(text, sizeMm, maxWidthMm) -> string[]
//   xmlEscape(text) -> string
//
// scene = { w, h, title, desc, tile, layers: [{ id, label, locked?, style?, items }] }
//   item  { type: 'line', x1, y1, x2, y2, style?, dashOffset?, id? }
//         { type: 'rect', x, y, w, h, fill?, stroke?, width? }
//         { type: 'circle', cx, cy, r, style }
//         { type: 'text', x, y (baseline), size (mm), text, fill, anchor: 'start'|'middle'|'end' }
//   style { stroke: '#rrggbb', width (mm), dash: mm[] | null, cap: 'round' | 'butt' }
//
// Layers in drawing order: sheet, glue, mountain, valley, endring, cut, info (+ tiling).
// glue holds the tinted seam strips (filled rectangles, no lines); hide it for laser jobs.
// Creases come before the cut so laser and plotter jobs score before cutting out.
// Lines use PRINT colours and DASH patterns; stroke widths (0.25 mm creases,
// 0.35 mm cut) and dash lengths scale with layout.scale, widths never below 0.1 mm.
// Without a tile the sheet is layout.page when the pattern fits; otherwise it is
// enlarged to hold the whole pattern (one sheet for plotters and laser cutters).
// With a tile (one of layout.tiles) the sheet is layout.page showing that window
// in its printable area: segments are clipped to it (dash phase kept), plus dashed
// overlap lines, corner alignment crosses and the label "Page r,c of R x C".
// Invalid designs throw an Error carrying design.errors[0].

import { PRINT, DASH } from '../ui/theme.js';
import { infoLines, legendFor, SCALE_BAR_MM } from '../core/info.js';
import { INFO_H, TILE_OVERLAP } from '../core/layout.js';

const CREASE_W = 0.25;        // stroke widths, mm at 100 %
const CUT_W = 0.35;
const MIN_W = 0.1;            // thinnest printed line at small scales
const MARK_W = 0.15;          // info frame, scale-bar ticks and tiling marks
const FONT = 'Helvetica, Arial, sans-serif';
const NS_INKSCAPE = 'http://www.inkscape.org/namespaces/inkscape';
const NS_SODIPODI = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd';

const LINE_LAYERS = [
  { id: 'mountain', label: 'Mountain folds', colour: 'mountain', dash: 'mountain', width: CREASE_W },
  { id: 'valley', label: 'Valley folds', colour: 'valley', dash: 'valley', width: CREASE_W },
  { id: 'endring', label: 'End-ring folds', colour: 'end', dash: 'end', width: CREASE_W },
  { id: 'cut', label: 'Cut', colour: 'cut', dash: 'cut', width: CUT_W },
];
const LEGEND_LAYER = { mountain: 'mountain', valley: 'valley', end: 'endring', cut: 'cut' };

// info box typography, mm
const TEXT_SIZE = { title: 3, data: 2.5, note: 2.2 };
const LEGEND_SIZE = 2.3;
const BAR_LABEL_SIZE = 2.2;
const TILE_LABEL_SIZE = 2.6;
const LEAD = 1.32;            // line advance / font size
const ASC = 0.74;             // line top to baseline / font size
const PAD = 2.5;              // inside the info frame
const FIT_STEPS = [1, 0.92, 0.84, 0.76, 0.68, 0.6];

/** Which exported layer a pattern segment belongs to. */
export function segmentLayer(s) {
  if (s.kind === 'cut') return 'cut';
  if (s.family === 'end') return 'endring';
  return s.kind === 'valley' ? 'valley' : 'mountain';
}

/** Print styles of the four line layers at a layout scale (fraction, 1 = 100 %). */
export function lineStyles(scale = 1) {
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const out = {};
  for (const L of LINE_LAYERS) {
    const dash = (DASH[L.dash] || []).map((d) => d * k);
    out[L.id] = { stroke: PRINT[L.colour], width: Math.max(MIN_W, L.width * k), dash: dash.length ? dash : null, cap: 'round' };
  }
  return out;
}

export function patternSVG(design, pattern, layout, { tile = null } = {}) {
  return sceneSVG(sheetScene(design, pattern, layout, { tile }));
}

/** The drawing model of one printed sheet (see the header for its shape). */
export function sheetScene(design, pattern, layout, { tile = null } = {}) {
  checkInput(design, pattern, layout);
  const lines = infoLines(design, pattern, layout);
  const styles = lineStyles(layout.scale);
  const frame = sheetFrame(layout, tile);

  const groups = { mountain: [], valley: [], endring: [], cut: [] };
  for (const s of pattern.segments) {
    const id = segmentLayer(s);
    const item = placeSegment(frame.map(s.a), frame.map(s.b), frame.clip, styles[id].dash);
    if (item) groups[id].push(item);
  }
  const glue = [];
  for (const r of pattern.seams || []) {
    const item = placeRect(frame.map([r.x, r.y]), frame.map([r.x + r.w, r.y + r.h]), frame.clip);
    if (item) glue.push({ ...item, fill: PRINT.glue });
  }

  const layers = [{ id: 'sheet', label: 'Sheet', locked: true, items: [{ type: 'rect', x: 0, y: 0, w: frame.w, h: frame.h, fill: PRINT.paper }] }];
  layers.push({ id: 'glue', label: 'Seam strips (glue)', locked: true, items: glue });
  for (const L of LINE_LAYERS) layers.push({ id: L.id, label: L.label, style: styles[L.id], items: groups[L.id] });
  const info = { id: 'info', label: 'Info', items: frame.info ? infoItems(frame.info, lines, legendFor(pattern), layout.scale, styles) : [] };
  layers.push(info);
  if (tile) {
    const t = tileMarks(tile, layout, frame.clip, lines[0].text);
    info.items.push(...t.labels);
    layers.push({ id: 'tiling', label: 'Tiling marks', items: t.marks });
  }
  return {
    w: frame.w,
    h: frame.h,
    title: lines[0].text,
    desc: lines.slice(1).map((l) => l.text).join('\n'),
    tile: tile ? { row: tile.row, col: tile.col } : null,
    layers,
  };
}

/**
 * True when no pattern page can carry the info box: a tiled print, or a sheet
 * that fits its page with no room left beside or below it. The legend, scale
 * bar and print notes then go on a page of their own (infoScene).
 */
export function needsInfoPage(layout) {
  return !!layout && (!layout.fits || !layout.info);
}

/**
 * The legend page: heading, the info box (text, legend, scale bar) and the
 * printed size of the sheet outline, on a page the size of the pattern pages.
 * A printer scales it exactly like them, so its scale bar still checks the print.
 */
export function infoScene(design, pattern, layout) {
  checkInput(design, pattern, layout);
  const lines = infoLines(design, pattern, layout);
  const { page, scale } = layout;
  const m = Math.max(layout.margin, 8);                  // keep clear of the printer's own margin
  const outline = `${trim(pattern.width * scale)} × ${trim(pattern.height * scale)} mm`;
  const more = [{ kind: 'data', text: `Sheet outline as printed: ${outline}.` }];
  if (!layout.fits) {
    let rows = 1, cols = 1;
    for (const t of layout.tiles || []) { rows = Math.max(rows, t.row + 1); cols = Math.max(cols, t.col + 1); }
    more.push({ kind: 'note', text: `The pattern is printed on ${rows * cols} pages (${rows} x ${cols}). Trim the overlap strips and tape the pages so the alignment crosses meet.` });
  } else {
    more.push({ kind: 'note', text: 'The sheet fills its page, so this legend is printed separately.' });
  }
  const all = [lines[0], ...lines.slice(1, -1), ...more, lines[lines.length - 1]];
  const headSize = 4;
  const heading = { type: 'text', x: m, y: m + headSize * ASC, size: headSize, text: 'Legend and print check', fill: PRINT.text, anchor: 'start' };
  const top = m + headSize * LEAD + 2;
  const R = { x: m, y: top, w: page.w - 2 * m, h: Math.max(10, Math.min(page.h - m - top, 80)) };
  const items = [heading, ...infoItems(R, all, legendFor(pattern), scale, lineStyles(scale))];
  return {
    w: page.w,
    h: page.h,
    title: `${lines[0].text} · legend`,
    desc: all.slice(1).map((l) => l.text).join('\n'),
    tile: null,
    layers: [
      { id: 'sheet', label: 'Sheet', locked: true, items: [{ type: 'rect', x: 0, y: 0, w: page.w, h: page.h, fill: PRINT.paper }] },
      { id: 'info', label: 'Info', items },
    ],
  };
}

/** Serialise a scene as an SVG 1.1 document (Inkscape layers, mm user units). */
export function sceneSVG(scene, { pixelWidth = 0, pixelHeight = 0 } = {}) {
  const w = pixelWidth > 0 ? String(Math.round(pixelWidth)) : `${num(scene.w)}mm`;
  const h = pixelHeight > 0 ? String(Math.round(pixelHeight)) : `${num(scene.h)}mm`;
  const out = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="${NS_INKSCAPE}" xmlns:sodipodi="${NS_SODIPODI}" version="1.1" width="${w}" height="${h}" viewBox="0 0 ${num(scene.w)} ${num(scene.h)}">`,
    `<title>${xmlEscape(scene.title || '')}</title>`,
  ];
  if (scene.desc) out.push(`<desc>${xmlEscape(scene.desc)}</desc>`);
  out.push('<sodipodi:namedview id="namedview" pagecolor="#ffffff" bordercolor="#666666" inkscape:document-units="mm"/>');
  for (const layer of scene.layers) {
    let attrs = `id="${xmlEscape(layer.id)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(layer.label)}"`;
    if (layer.locked) attrs += ' sodipodi:insensitive="true"';
    if (layer.style) attrs += strokeAttrs(layer.style, false);
    if (layer.items.some((it) => it.type === 'text')) attrs += ` font-family="${xmlEscape(FONT)}"`;
    if (!layer.items.length) { out.push(`<g ${attrs}/>`); continue; }
    out.push(`<g ${attrs}>`);
    for (const it of layer.items) {
      const s = itemSVG(it);
      if (s) out.push(`  ${s}`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

// ── text ─────────────────────────────────────────────────────────────────

/** Escape text for XML content and attribute values; drops characters XML 1.0 forbids. */
export function xmlEscape(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDFFF]/gu, '')       // lone surrogates (pairs are one code point under /u)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Helvetica advance widths (1/1000 em), WinAnsi codes 32..126 and 128..255 (0 = undefined).
const W_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const W_HIGH = [
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];
// Unicode -> WinAnsi for the 0x80..0x9F block (the rest of 0xA0..0xFF is Latin-1).
const CP1252 = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);
// ASCII stand-ins for characters outside WinAnsi.
const SUBST = new Map(Object.entries({
  'π': 'pi', 'Π': 'Pi', 'ν': 'nu', 'ε': 'eps', 'κ': 'kappa', 'φ': 'phi', 'θ': 'theta', 'α': 'alpha',
  'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'Δ': 'Delta', 'λ': 'lambda', 'ρ': 'rho', 'σ': 'sigma',
  'τ': 'tau', 'ω': 'omega', 'Ω': 'Ohm', '≈': '~', '≤': '<=', '≥': '>=', '≠': '!=', '−': '-',
  '‐': '-', '‑': '-', '‒': '-', '′': "'", '″': '"', '→': '->', '←': '<-', '↔': '<->', '⇒': '=>',
  '√': 'sqrt', '∞': 'inf', '∙': '·', '⋅': '·', '⁴': '^4', 'ⁿ': '^n', '✓': 'ok', '✗': 'x',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '',
}));

/** WinAnsi byte codes for a string; characters outside WinAnsi become ASCII ('pi', '~', '?'). */
export function winAnsiCodes(text) {
  const out = [];
  for (const ch of String(text ?? '')) pushWinAnsi(out, ch, true);
  return out;
}

function pushWinAnsi(out, ch, substitute) {
  const cp = ch.codePointAt(0);
  if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) { out.push(cp); return; }
  if (CP1252.has(cp)) { out.push(CP1252.get(cp)); return; }
  if (cp === 0x09 || cp === 0x0a || cp === 0x0d) { out.push(0x20); return; }
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return;              // other control characters
  if (!substitute) { out.push(0x3f); return; }
  if (SUBST.has(ch)) { for (const c of SUBST.get(ch)) pushWinAnsi(out, c, false); return; }
  const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  if (base && base !== ch) { for (const c of base) pushWinAnsi(out, c, false); return; }
  out.push(0x3f);                                                     // '?'
}

/** Width in mm of a single line of text in Helvetica at `size` mm. */
export function textWidth(text, size) {
  let units = 0;
  for (const c of winAnsiCodes(text)) units += (c < 128 ? W_ASCII[c - 32] : W_HIGH[c - 128]) || 556;
  return (units / 1000) * size;
}

/** Greedy word wrap; keeps "n = 6", "40.0 mm" and trailing "·" together. */
export function wrapText(text, size, maxWidth) {
  const lines = [];
  let cur = '';
  for (const w of wrapTokens(text)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size) > maxWidth) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  const out = [];
  for (const line of lines) {
    if (textWidth(line, size) <= maxWidth) { out.push(line); continue; }
    let part = '';                                       // a single token wider than the column
    for (const ch of line) {
      if (part && textWidth(part + ch, size) > maxWidth) { out.push(part); part = ch.trim() ? ch : ''; } else part += ch;
    }
    if (part) out.push(part);
  }
  return out;
}

const UNIT_RE = /^(?:mm|cm|µm|m|%|°|N|mN|mJ|J|g|kg|MPa|GPa|Hz|mm²|mm³|N\/mm)[.,;:)]?$/;
function wrapTokens(text) {
  const out = [];
  let glueNext = false;
  for (const w of String(text ?? '').split(/\s+/)) {
    if (!w) continue;
    const prev = out.length ? out[out.length - 1] : null;
    if (prev !== null && (glueNext || /^[·•–—=×]$/.test(w) || (UNIT_RE.test(w) && /\d$/.test(prev)))) out[out.length - 1] = `${prev} ${w}`;
    else out.push(w);
    glueNext = /^[=Ø×]$/.test(w);
  }
  return out;
}

// ── scene internals ──────────────────────────────────────────────────────

function checkInput(design, pattern, layout) {
  if (!design || !design.valid) {
    const why = design && Array.isArray(design.errors) && design.errors[0];
    throw new Error(why ? `Cannot export this design: ${why}` : 'Cannot export: the design is invalid.');
  }
  if (!pattern || !Array.isArray(pattern.segments)) throw new Error('Cannot export: there is no crease pattern.');
  if (!layout || !layout.page || typeof layout.toPage !== 'function') throw new Error('Cannot export: the page layout is missing.');
}

// Sheet size, pattern -> sheet mapping, optional clip window and info rectangle.
function sheetFrame(layout, tile) {
  const { page, margin } = layout;
  if (tile) {
    const px = layout.printable ? layout.printable.x : margin;
    const py = layout.printable ? layout.printable.y : margin;
    const dx = px - tile.x, dy = py - tile.y;
    return {
      w: page.w, h: page.h, info: null,
      map: (pt) => { const q = layout.toPage(pt); return [q[0] + dx, q[1] + dy]; },
      clip: { x: px, y: py, w: tile.w, h: tile.h },
    };
  }
  if (layout.fits) return { w: page.w, h: page.h, map: layout.toPage, clip: null, info: layout.info };
  // does not fit one page: an enlarged sheet with the whole pattern and the info box below it
  const box = layout.box;
  const w = Math.max(page.w, box.w + 2 * margin);
  const infoTop = margin + box.h + 4;
  const h = Math.max(page.h, infoTop + INFO_H + margin);
  const ox = (w - box.w) / 2, oy = margin;
  return {
    w, h, clip: null,
    map: (pt) => { const q = layout.toPage(pt); return [q[0] - box.x + ox, q[1] - box.y + oy]; },
    info: { x: margin, y: infoTop, w: w - 2 * margin, h: Math.min(h - margin - infoTop, INFO_H + 10) },
  };
}

// A segment in sheet mm, clipped to the tile window; the dash phase continues
// from the segment's true start so dashes line up across neighbouring pages.
function placeSegment(A, B, clip, dash) {
  let x1 = A[0], y1 = A[1], x2 = B[0], y2 = B[1];
  let dashOffset = 0;
  if (clip) {
    const t = clipToRect(x1, y1, x2, y2, clip);
    if (!t) return null;
    const dx = x2 - x1, dy = y2 - y1;
    if (dash && t[0] > 0) {
      const period = dash.reduce((a, b) => a + b, 0);
      if (period > 0) dashOffset = (t[0] * Math.hypot(dx, dy)) % period;
    }
    [x1, y1, x2, y2] = [x1 + dx * t[0], y1 + dy * t[0], x1 + dx * t[1], y1 + dy * t[1]];
  }
  const item = { type: 'line', x1, y1, x2, y2 };
  if (dashOffset > 1e-6) item.dashOffset = dashOffset;
  return item;
}

// The axis-aligned rectangle spanned by two corners in sheet mm, clipped to the tile window.
function placeRect(A, B, clip) {
  let x0 = Math.min(A[0], B[0]), y0 = Math.min(A[1], B[1]), x1 = Math.max(A[0], B[0]), y1 = Math.max(A[1], B[1]);
  if (clip) {
    x0 = Math.max(x0, clip.x); y0 = Math.max(y0, clip.y);
    x1 = Math.min(x1, clip.x + clip.w); y1 = Math.min(y1, clip.y + clip.h);
  }
  return x1 - x0 > 1e-6 && y1 - y0 > 1e-6 ? { type: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// Liang-Barsky against an axis-aligned rectangle: [t0, t1] or null.
function clipToRect(x1, y1, x2, y2, r) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const edges = [[-dx, x1 - r.x], [dx, r.x + r.w - x1], [-dy, y1 - r.y], [dy, r.y + r.h - y1]];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) { if (q < -1e-9) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
  }
  return (t1 - t0) * Math.hypot(dx, dy) > 1e-6 ? [t0, t1] : null;
}

// Info box: text lines, legend swatches and the scale bar, shrunk to fit the box.
function infoItems(R, lines, legend, scale, styles) {
  const box = { x: R.x + PAD, y: R.y + PAD, w: R.w - 2 * PAD, h: R.h - 2 * PAD };
  const frame = { type: 'rect', x: R.x, y: R.y, w: R.w, h: R.h, stroke: PRINT.tab, width: MARK_W };
  if (box.w < 20 || box.h < 4) return [frame];
  let res = null;
  for (const f of FIT_STEPS) {
    res = composeInfo(box, lines, legend, scale, styles, f);
    if (res.height <= box.h + 1e-6) break;
  }
  const limit = box.y + box.h + 0.5;
  const kept = res.placed.filter((p) => p.bottom <= limit);
  const used = Math.max(0, ...kept.map((p) => p.bottom)) - box.y;
  frame.h = Math.min(R.h, Math.max(used, 0) + 2 * PAD);
  return [frame, ...kept.map((p) => p.item)];
}

function composeInfo(box, lines, legend, scale, styles, f) {
  const placed = [];
  const put = (item, bottom) => placed.push({ item, bottom });
  const legendSize = LEGEND_SIZE * f, labelSize = BAR_LABEL_SIZE * f;
  const swatch = Math.min(20, Math.max(8, 12.32 * scale));   // about two dash-dot periods
  const labelW = Math.max(...legend.map((e) => textWidth(e.label, legendSize)));
  const cellW = swatch + 1.5 + labelW + 3.5;
  // scale bar: SCALE_BAR_MM of pattern, shortened in 10 mm steps only if the column is too narrow
  const barFor = (avail) => {
    let mm = SCALE_BAR_MM;
    if (mm * scale > avail) mm = Math.max(10, Math.floor(avail / scale / 10) * 10);
    const label = `${trim(mm * scale)} mm`;
    return { mm, len: mm * scale, label, w: Math.max(mm * scale, textWidth(label, labelSize)) };
  };
  let bar = barFor(Infinity);
  const legend2 = 2 * cellW - 3.5;
  const gW = Math.max(legend2, bar.w);
  const two = box.w >= 120 && gW <= 0.55 * box.w;      // text left, legend + bar right
  const textW = two ? box.w - gW - 5 : box.w;
  if (!two) bar = barFor(box.w);
  const cols = two ? 2 : Math.max(1, Math.min(legend.length, Math.floor((box.w + 3.5) / cellW)));

  let y = box.y;
  for (const ln of lines) {
    const size = (TEXT_SIZE[ln.kind] || TEXT_SIZE.data) * f;
    const fill = ln.kind === 'note' ? PRINT.textMuted : PRINT.text;
    for (const part of wrapText(ln.text, size, textW)) {
      put({ type: 'text', x: box.x, y: y + size * ASC, size, text: part, fill, anchor: 'start' }, y + size * LEAD);
      y += size * LEAD;
    }
    if (ln.kind === 'title') y += 0.6 * f;
  }
  const textH = y - box.y;

  const gap = 2.2 * f;
  const gx = two ? box.x + box.w - gW : box.x;
  const gy = two ? box.y : box.y + textH + gap;
  const rowH = legendSize * 1.5;
  legend.forEach((e, i) => {
    const x = gx + (i % cols) * cellW, top = gy + Math.floor(i / cols) * rowH;
    const base = top + legendSize * ASC, mid = base - legendSize * 0.32;
    if (e.kind === 'glue') put({ type: 'rect', x, y: mid - legendSize * 0.4, w: swatch, h: legendSize * 0.8, fill: PRINT.glue }, top + rowH);
    else put({ type: 'line', x1: x, y1: mid, x2: x + swatch, y2: mid, style: styles[LEGEND_LAYER[e.kind]] || styles.mountain }, top + rowH);
    put({ type: 'text', x: x + swatch + 1.5, y: base, size: legendSize, text: e.label, fill: PRINT.text, anchor: 'start' }, top + rowH);
  });
  const legendH = Math.ceil(legend.length / cols) * rowH;

  const by = gy + legendH + gap;
  const labelBase = by + labelSize * ASC;
  const tickBig = 2.2 * f, tickSmall = 1.2 * f;
  const yb = labelBase + 0.8 * f + tickBig;
  const bottom = yb + 0.3;
  const barStyle = { stroke: PRINT.text, width: 0.2, dash: null, cap: 'butt' };
  const tickStyle = { stroke: PRINT.text, width: MARK_W, dash: null, cap: 'butt' };
  put({ type: 'text', x: gx, y: labelBase, size: labelSize, text: bar.label, fill: PRINT.text, anchor: 'start' }, bottom);
  put({ type: 'line', id: 'scale-bar', x1: gx, y1: yb, x2: gx + bar.len, y2: yb, style: barStyle }, bottom);
  const steps = Math.max(1, Math.round(bar.mm / 10));
  for (let i = 0; i <= steps; i++) {
    const x = gx + (bar.len * i) / steps;
    put({ type: 'line', x1: x, y1: yb, x2: x, y2: yb - (i === 0 || i === steps ? tickBig : tickSmall), style: tickStyle }, bottom);
  }
  const height = two ? Math.max(textH, bottom - gy) : bottom - box.y;
  return { placed, height };
}

// Overlap lines, alignment crosses and labels for one tile page.
function tileMarks(tile, layout, win, title) {
  let rows = tile.row + 1, cols = tile.col + 1;
  for (const t of layout.tiles || []) { rows = Math.max(rows, t.row + 1); cols = Math.max(cols, t.col + 1); }
  const L = tile.col > 0, R = tile.col < cols - 1, U = tile.row > 0, D = tile.row < rows - 1;
  const ov = Math.min(TILE_OVERLAP, win.w / 2, win.h / 2);
  const x0 = win.x, y0 = win.y, x1 = win.x + win.w, y1 = win.y + win.h;
  const overlap = { stroke: PRINT.tab, width: MARK_W, dash: [1.5, 1.5], cap: 'butt' };
  const cross = { stroke: PRINT.text, width: MARK_W, dash: null, cap: 'butt' };
  const marks = [];
  const seg = (ax, ay, bx, by, style) => marks.push({ type: 'line', x1: ax, y1: ay, x2: bx, y2: by, style });
  // where the neighbouring page's window starts: the strip outside the line is printed on both pages
  if (L) seg(x0 + ov, y0, x0 + ov, y1, overlap);
  if (R) seg(x1 - ov, y0, x1 - ov, y1, overlap);
  if (U) seg(x0, y0 + ov, x1, y0 + ov, overlap);
  if (D) seg(x0, y1 - ov, x1, y1 - ov, overlap);
  // crosses in the middle of the overlap strips, at the same pattern point on both pages
  const inset = ov / 2, arm = Math.min(2.5, inset * 0.9);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (!((sx < 0 ? L : R) || (sy < 0 ? U : D))) continue;
    const cx = sx < 0 ? x0 + inset : x1 - inset, cy = sy < 0 ? y0 + inset : y1 - inset;
    seg(cx - arm, cy, cx + arm, cy, cross);
    seg(cx, cy - arm, cx, cy + arm, cross);
    marks.push({ type: 'circle', cx, cy, r: arm / 2, style: cross });
  }
  const label = `Page ${tile.row + 1},${tile.col + 1} of ${rows} x ${cols}`;
  const hint = `Overlap ${trim(TILE_OVERLAP)} mm: align the crosses`;
  const small = BAR_LABEL_SIZE;
  const inMargin = layout.margin >= 4.5;                   // else inside the window, clear of the crosses
  const base = inMargin ? y0 - 1.2 : y1 - 1.5;
  const lx = inMargin ? x0 : x0 + ov + 1;
  const right = inMargin ? x1 : x1 - ov - 1;
  const hx = lx + textWidth(label, TILE_LABEL_SIZE) + 3;
  const labels = [
    { type: 'text', x: lx, y: base, size: TILE_LABEL_SIZE, text: label, fill: PRINT.text, anchor: 'start' },
    { type: 'text', x: hx, y: base, size: small, text: hint, fill: PRINT.textMuted, anchor: 'start' },
  ];
  if (hx + textWidth(hint, small) + 4 + textWidth(title, small) <= right) {
    labels.push({ type: 'text', x: right, y: base, size: small, text: title, fill: PRINT.textMuted, anchor: 'end' });
  }
  return { marks, labels };
}

// ── SVG serialisation helpers ────────────────────────────────────────────

function num(x) {
  if (!Number.isFinite(x)) return '0';
  return String(Math.round(x * 1000) / 1000);
}

function trim(x) { return String(Math.round(x * 100) / 100); }

function strokeAttrs(st, item) {
  const round = st.cap === 'round';
  let a = ` fill="none" stroke="${xmlEscape(st.stroke)}" stroke-width="${num(st.width)}" stroke-linecap="${round ? 'round' : 'butt'}"`;
  if (round) a += ' stroke-linejoin="round"';
  if (st.dash && st.dash.length) a += ` stroke-dasharray="${st.dash.map(num).join(' ')}"`;
  else if (item) a += ' stroke-dasharray="none"';
  return a;
}

function itemSVG(it) {
  const id = it.id ? ` id="${xmlEscape(it.id)}"` : '';
  switch (it.type) {
    case 'line': {
      let a = `<line${id} x1="${num(it.x1)}" y1="${num(it.y1)}" x2="${num(it.x2)}" y2="${num(it.y2)}"`;
      if (it.style) a += strokeAttrs(it.style, true);
      if (it.dashOffset) a += ` stroke-dashoffset="${num(it.dashOffset)}"`;
      return `${a}/>`;
    }
    case 'rect': {
      let a = `<rect${id} x="${num(it.x)}" y="${num(it.y)}" width="${num(it.w)}" height="${num(it.h)}" fill="${it.fill ? xmlEscape(it.fill) : 'none'}"`;
      if (it.stroke) a += ` stroke="${xmlEscape(it.stroke)}" stroke-width="${num(it.width || MARK_W)}"`;
      return `${a}/>`;
    }
    case 'circle':
      return `<circle${id} cx="${num(it.cx)}" cy="${num(it.cy)}" r="${num(it.r)}"${strokeAttrs(it.style, true)}/>`;
    case 'text': {
      if (!it.text) return '';
      const anchor = it.anchor === 'middle' || it.anchor === 'end' ? ` text-anchor="${it.anchor}"` : '';
      return `<text${id} x="${num(it.x)}" y="${num(it.y)}" font-size="${num(it.size)}" fill="${xmlEscape(it.fill || PRINT.text)}"${anchor}>${xmlEscape(it.text)}</text>`;
    }
    default:
      return '';
  }
}
