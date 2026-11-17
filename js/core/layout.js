// Places a pattern on paper. Page coordinates: mm, origin top-left, y DOWN.
//
//   layoutPattern(pattern, params) -> {
//     page: { w, h, name, orient }, scale (fraction), margin,
//     toPage([x, y]) -> [X, Y]          pattern mm (y up) -> page mm (y down)
//     box: { x, y, w, h }               pattern bounding box on the page
//     printable: { x, y, w, h }
//     fits, fitScale                    largest scale (fraction) that fits one page
//     info: { x, y, w, h } | null       free area for the printed info box
//     tiles: [{ row, col, x, y, w, h }] page windows when it does not fit (one page each)
//   }

import { PAGES } from './params.js';

export const INFO_H = 30;          // mm needed for the printed info box (legend, scale bar, data)
export const TILE_OVERLAP = 10;    // mm shared by neighbouring tiles

export function layoutPattern(pattern, params) {
  const base = PAGES[params.page] || PAGES.A4;
  const margin = params.margin;
  const scale = params.scale / 100;
  const pw = pattern.width * scale, ph = pattern.height * scale;

  const fitFor = (W, H) => Math.min((W - 2 * margin) / pattern.width, (H - 2 * margin - INFO_H) / pattern.height);
  const portrait = { w: base.w, h: base.h, orient: 'portrait' };
  const landscape = { w: base.h, h: base.w, orient: 'landscape' };
  let sheet;
  if (params.orient === 'portrait') sheet = portrait;
  else if (params.orient === 'landscape') sheet = landscape;
  else {
    const fp = fitFor(portrait.w, portrait.h), fl = fitFor(landscape.w, landscape.h);
    const okP = fp >= scale, okL = fl >= scale;
    sheet = okP ? portrait : okL ? landscape : fp >= fl ? portrait : landscape;
  }
  const page = { ...sheet, name: base.label };
  const printable = { x: margin, y: margin, w: page.w - 2 * margin, h: page.h - 2 * margin };
  const fitScale = Math.min(printable.w / pattern.width, printable.h / pattern.height);
  const fits = pw <= printable.w + 1e-6 && ph <= printable.h + 1e-6;

  // centre horizontally; top-align when an info box goes underneath
  const roomBelow = printable.h - ph;
  const ox = margin + (printable.w - pw) / 2;
  const oy = margin + (roomBelow >= INFO_H ? (roomBelow - INFO_H) / 2 : Math.max(0, roomBelow / 2));
  const box = { x: ox, y: oy, w: pw, h: ph };
  const toPage = ([x, y]) => [ox + x * scale, oy + (pattern.height - y) * scale];

  let info = null;
  if (fits) {
    const below = page.h - margin - (oy + ph);
    if (below >= INFO_H - 1e-6) info = { x: margin, y: oy + ph + 4, w: printable.w, h: Math.min(below - 4, INFO_H + 10) };
    else {
      const side = page.w - margin - (ox + pw);
      if (side >= 70) info = { x: ox + pw + 4, y: oy, w: side - 4, h: Math.min(ph, 90) };
    }
  }

  const tiles = [];
  if (!fits) {
    const stepW = printable.w - TILE_OVERLAP, stepH = printable.h - TILE_OVERLAP;
    const cols = Math.max(1, Math.ceil((pw - TILE_OVERLAP) / stepW));
    const rows = Math.max(1, Math.ceil((ph - TILE_OVERLAP) / stepH));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tiles.push({ row: r, col: c, x: ox + c * stepW, y: oy + r * stepH, w: printable.w, h: printable.h });
      }
    }
  }
  return { page, scale, margin, printable, box, toPage, fits, fitScale, info, tiles };
}

/**
 * The largest whole scale percentage (10-200) at which the pattern fits one page
 * with room for the info box, in the chosen orientation ('auto': the better one).
 * Whole percents, rounded down: the scale control has step 1, and a value rounded
 * up would no longer fit.
 */
export function autoFitPercent(pattern, params) {
  const base = PAGES[params.page] || PAGES.A4;
  const m = params.margin;
  const f = (W, H) => Math.min((W - 2 * m) / pattern.width, (H - 2 * m - INFO_H) / pattern.height);
  const portrait = f(base.w, base.h), landscape = f(base.h, base.w);
  const best = params.orient === 'portrait' ? portrait : params.orient === 'landscape' ? landscape : Math.max(portrait, landscape);
  return Math.max(10, Math.min(200, Math.floor(best * 100 + 1e-9)));
}
