// Pattern sheet as a hand-written PDF 1.4 (vector, no dependencies).
//
//   patternPDF(design, pattern, layout) -> Uint8Array
//   scenesPDF(scenes, { title, subject }) -> Uint8Array   one page per sheetScene()
//   pdfString(text) -> '(...)'   WinAnsi literal string: ( ) \ escaped, non-ASCII as \ddd
//
// One page when layout.fits, otherwise one page per layout.tiles entry, drawn from
// the same scenes as patternSVG(..., { tile }). When no pattern page has room for
// the info box (tiled, or the sheet nearly fills its page) a last page carries the
// legend, scale bar and print notes (infoScene). Page size = sheet mm x 72/25.4 pt;
// y is flipped (PDF origin bottom-left). Strokes: colour RG, width w, dash d (the
// phase continues across tile edges), round caps and joins for creases. Text in
// standard Helvetica with /WinAnsiEncoding; characters outside WinAnsi become ASCII.
// Uncompressed content streams, exact xref offsets, trailer /Size /Root /Info,
// /Info with /Title (UTF-16BE when it is not plain ASCII). Deterministic output.
// Invalid designs throw an Error carrying design.errors[0].

import { sheetScene, infoScene, needsInfoPage, winAnsiCodes, textWidth } from './svg.js';
import { APP_NAME, APP_VERSION } from '../core/params.js';

const PT = 72 / 25.4;                 // points per mm
const KAPPA = 0.5523;                 // cubic Bezier quarter-circle factor
const DEFAULT_STROKE = { stroke: '#000000', width: 0.2, dash: null, cap: 'butt' };

export function patternPDF(design, pattern, layout) {
  const tiles = layout && !layout.fits && Array.isArray(layout.tiles) ? layout.tiles : [];
  const scenes = tiles.length
    ? tiles.map((tile) => sheetScene(design, pattern, layout, { tile }))
    : [sheetScene(design, pattern, layout)];
  // no room for the legend and scale bar on the pattern page(s): they get the last page
  if (needsInfoPage(layout)) scenes.push(infoScene(design, pattern, layout));
  return scenesPDF(scenes, { title: scenes[0].title, subject: scenes[0].desc.split('\n').join('; ') });
}

/** Assemble a PDF with one page per scene (scenes from sheetScene in svg.js). */
export function scenesPDF(scenes, { title = '', subject = '' } = {}) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalogId = add('');
  const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  let info = `<< /Title ${infoString(title)}`;
  if (subject) info += ` /Subject ${infoString(subject)}`;
  info += ` /Creator ${infoString(`${APP_NAME} ${APP_VERSION}`)} /Producer ${infoString(APP_NAME)} >>`;
  const infoId = add(info);
  const kids = [];
  for (const scene of scenes) {
    const content = sceneContent(scene);
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pn(scene.w * PT)} ${pn(scene.h * PT)}] `
      + `/Resources << /Font << /F1 ${fontId} 0 R >> /ProcSet [/PDF /Text] >> /Contents ${contentId} 0 R >>`));
  }
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  // every character below is one byte (ASCII, plus the binary marker comment)
  let pdf = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/** PDF literal string in WinAnsi: ( ) \ escaped, bytes outside printable ASCII as octal \ddd. */
export function pdfString(text) {
  let out = '(';
  for (const c of winAnsiCodes(text)) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) out += `\\${String.fromCharCode(c)}`;
    else if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
    else out += `\\${c.toString(8).padStart(3, '0')}`;
  }
  return `${out})`;
}

// Document-information strings: ASCII literal, else UTF-16BE hex with BOM.
function infoString(text) {
  const s = String(text ?? '');
  if (/^[\x20-\x7e]*$/.test(s)) return pdfString(s);
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
  return `<${hex}>`;
}

// Content stream of one scene; graphics state is only re-emitted when it changes.
function sceneContent(scene) {
  const H = scene.h;
  const X = (x) => pn(x * PT);
  const Y = (y) => pn((H - y) * PT);
  const ops = ['q'];
  const cur = {};
  const set = (key, op) => { if (cur[key] !== op) { ops.push(op); cur[key] = op; } };
  const stroke = (st, phase = 0) => {
    set('RG', `${rgbOp(st.stroke)} RG`);
    set('w', `${pn(st.width * PT)} w`);
    set('d', st.dash && st.dash.length ? `[${st.dash.map((v) => pn(v * PT)).join(' ')}] ${pn(phase * PT)} d` : '[] 0 d');
    const round = st.cap === 'round';
    set('J', round ? '1 J' : '0 J');
    set('j', round ? '1 j' : '0 j');
  };
  for (const layer of scene.layers) {
    if (layer.id === 'sheet') continue;                    // the page itself is the white sheet
    for (const it of layer.items) {
      if (it.type === 'line') {
        stroke(it.style || layer.style || DEFAULT_STROKE, it.dashOffset || 0);
        ops.push(`${X(it.x1)} ${Y(it.y1)} m ${X(it.x2)} ${Y(it.y2)} l S`);
      } else if (it.type === 'rect') {
        const r = `${X(it.x)} ${Y(it.y + it.h)} ${pn(it.w * PT)} ${pn(it.h * PT)} re`;
        if (it.fill) { set('rg', `${rgbOp(it.fill)} rg`); ops.push(`${r} f`); }
        if (it.stroke) { stroke({ stroke: it.stroke, width: it.width || 0.15, dash: null, cap: 'butt' }); ops.push(`${r} S`); }
      } else if (it.type === 'circle') {
        stroke(it.style || DEFAULT_STROKE);
        ops.push(`${circlePath(it.cx, it.cy, it.r, X, Y)} S`);
      } else if (it.type === 'text') {
        const str = String(it.text ?? '');
        if (!str) continue;
        const w = textWidth(str, it.size);
        const x = it.anchor === 'end' ? it.x - w : it.anchor === 'middle' ? it.x - w / 2 : it.x;
        set('rg', `${rgbOp(it.fill || '#000000')} rg`);
        ops.push(`BT /F1 ${pn(it.size * PT)} Tf ${X(x)} ${Y(it.y)} Td ${pdfString(str)} Tj ET`);
      }
    }
  }
  ops.push('Q');
  return ops.join('\n');
}

function circlePath(cx, cy, r, X, Y) {
  const k = KAPPA * r;
  const p = (x, y) => `${X(x)} ${Y(y)}`;
  return [
    `${p(cx + r, cy)} m`,
    `${p(cx + r, cy + k)} ${p(cx + k, cy + r)} ${p(cx, cy + r)} c`,
    `${p(cx - k, cy + r)} ${p(cx - r, cy + k)} ${p(cx - r, cy)} c`,
    `${p(cx - r, cy - k)} ${p(cx - k, cy - r)} ${p(cx, cy - r)} c`,
    `${p(cx + k, cy - r)} ${p(cx + r, cy - k)} ${p(cx + r, cy)} c h`,
  ].join(' ');
}

// '#rrggbb' | '#rgb' | 'rgb(a)(r, g, b, ...)' -> 'r g b' in 0..1
function rgbOp(colour) {
  const s = String(colour || '').trim();
  let rgb = [0, 0, 0];
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const v = parseInt(m[1], 16);
    rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  } else if ((m = /^#([0-9a-f]{3})$/i.exec(s))) {
    rgb = [...m[1]].map((h) => parseInt(h + h, 16));
  } else if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s))) {
    rgb = [m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)));
  }
  return rgb.map((v) => String(Math.round((v / 255) * 1000) / 1000)).join(' ');
}

// number in points: 3 decimals, never exponent notation
function pn(x) {
  if (!Number.isFinite(x)) return '0';
  return String(Math.round(x * 1000) / 1000);
}
