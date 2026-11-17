// Exporter checks: SVG structure, styling, info box and tiles; PDF syntax, xref
// and pages; DXF groups, tables and lines; JSON round trip; PNG pHYs chunk.
// Runs for the default design (fits A4) and PRESETS.disc12 on A4 (tiles).
import { deflateSync } from 'node:zlib';
import { computeDesign } from '../js/core/design.js';
import { buildPattern, clipConvex } from '../js/core/pattern.js';
import { layoutPattern } from '../js/core/layout.js';
import { DEFAULTS, PRESETS, APP_NAME, APP_VERSION, normalizeParams, migrateParams } from '../js/core/params.js';
import { infoLines, legendFor } from '../js/core/info.js';
import { PRINT, DASH } from '../js/ui/theme.js';
import { patternSVG, sheetScene, sceneSVG, infoScene, needsInfoPage, segmentLayer, xmlEscape, winAnsiCodes, textWidth, wrapText } from '../js/export/svg.js';
import { patternPDF, pdfString } from '../js/export/pdf.js';
import { patternDXF } from '../js/export/dxf.js';
import { patternPNG, pngSetDpi } from '../js/export/png.js';
import { designFile, readDesignFile, fromCreaseGen } from '../js/export/json.js';
import { crc32 } from '../js/export/zip.js';
import { assemblyNotes, svgNames } from '../js/ui/actions.js';
import { test, ok, near, eq, run } from './harness.mjs';

const P = (over = {}) => normalizeParams({ ...DEFAULTS, ...migrateParams(over) });   // `ext`: both end rings
function setup(over = {}) {
  const params = P(over);
  const design = computeDesign(params);
  const pattern = buildPattern(design);
  const layout = pattern ? layoutPattern(pattern, params) : null;
  return { params, design, pattern, layout };
}
const CASES = {
  default: setup(),
  'disc12 on A4': setup({ ...PRESETS.disc12.params, page: 'A4' }),
};
const LINE_LAYERS = ['mountain', 'valley', 'endring', 'cut'];

// ── tiny XML parser: tag balance, attribute syntax, entities ─────────────
function parseXML(src) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const OPEN = /<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  const CLOSE = /<\/([A-Za-z_][\w:.-]*)\s*>/y;
  const ATTR = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/y;
  const decode = (t, where) => {
    for (let k = 0; k < t.length; k++) {
      if (t[k] === '<') throw new Error(`raw "<" in ${where}`);
      if (t[k] === '&') { ENTITY.lastIndex = k; if (!ENTITY.test(t)) throw new Error(`bad entity in ${where}: ${t.slice(k, k + 12)}`); }
    }
    return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  };
  let i = 0;
  if (src.startsWith('<?xml')) { i = src.indexOf('?>') + 2; ok(i > 1, 'unterminated XML declaration'); }
  while (i < src.length) {
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); if (e < 0) throw new Error('unterminated comment'); i = e + 3; continue; }
    if (src.startsWith('<?', i) || src.startsWith('<!', i)) throw new Error(`unexpected markup at ${i}`);
    if (src.startsWith('</', i)) {
      CLOSE.lastIndex = i;
      const m = CLOSE.exec(src);
      if (!m) throw new Error(`malformed end tag at ${i}: ${src.slice(i, i + 30)}`);
      const top = stack.pop();
      if (top === root || top.name !== m[1]) throw new Error(`</${m[1]}> closes <${top.name}>`);
      i = CLOSE.lastIndex;
      continue;
    }
    if (src[i] === '<') {
      OPEN.lastIndex = i;
      const m = OPEN.exec(src);
      if (!m) throw new Error(`malformed tag at ${i}: ${src.slice(i, i + 60)}`);
      const attrs = {};
      for (const a of m[2].matchAll(ATTR)) {
        if (a[1] in attrs) throw new Error(`duplicate attribute ${a[1]} on <${m[1]}>`);
        attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3], `attribute ${a[1]}`);
      }
      const node = { name: m[1], attrs, children: [], text: '' };
      if (stack.length === 1 && root.children.length) throw new Error('second root element');
      stack[stack.length - 1].children.push(node);
      if (!m[3]) stack.push(node);
      i = OPEN.lastIndex;
      continue;
    }
    const e = src.indexOf('<', i);
    const end = e < 0 ? src.length : e;
    const t = decode(src.slice(i, end), 'text');
    if (stack.length === 1 && t.trim()) throw new Error('text outside the root element');
    stack[stack.length - 1].text += t;
    i = end;
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].name}>`);
  eq(root.children.length, 1, 'one root element');
  return root.children[0];
}
const walk = (node, fn) => { fn(node); for (const c of node.children) walk(c, fn); };
const findAll = (node, pred) => { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; };
const byId = (node, id) => findAll(node, (n) => n.attrs.id === id)[0];
const allText = (node) => findAll(node, (n) => n.name === 'text').map((n) => n.text);
const lineCoords = (n) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(n.attrs[k]));

// ── SVG ──────────────────────────────────────────────────────────────────
for (const [name, c] of Object.entries(CASES)) {
  test(`svg (${name}): well-formed, inkscape layers, one stroked line per segment`, () => {
    const svg = patternSVG(c.design, c.pattern, c.layout);
    const root = parseXML(svg);
    eq(root.name, 'svg');
    eq(root.attrs.xmlns, 'http://www.w3.org/2000/svg');
    eq(root.attrs['xmlns:inkscape'], 'http://www.inkscape.org/namespaces/inkscape');
    const sc = sheetScene(c.design, c.pattern, c.layout);
    eq(root.attrs.viewBox, `0 0 ${+sc.w.toFixed(3)} ${+sc.h.toFixed(3)}`, 'viewBox');
    eq(root.attrs.width, `${+sc.w.toFixed(3)}mm`, 'width in mm');
    eq(root.attrs.height, `${+sc.h.toFixed(3)}mm`, 'height in mm');
    if (c.layout.fits) {
      eq(sc.w, c.layout.page.w, 'page width'); eq(sc.h, c.layout.page.h, 'page height');
    } else {
      ok(sc.w >= c.layout.box.w + 2 * c.layout.margin - 1e-9, 'enlarged sheet holds the pattern width');
      ok(sc.h >= c.layout.box.h + 2 * c.layout.margin - 1e-9, 'enlarged sheet holds the pattern height');
    }
    for (const id of [...LINE_LAYERS, 'glue', 'info']) {
      const g = byId(root, id);
      ok(g && g.name === 'g', `<g id="${id}">`);
      eq(g.attrs['inkscape:groupmode'], 'layer', `${id} groupmode`);
      ok(g.attrs['inkscape:label'], `${id} label`);
    }
    let total = 0;
    for (const id of LINE_LAYERS) {
      const g = byId(root, id);
      const segs = c.pattern.segments.filter((s) => segmentLayer(s) === id);
      eq(g.children.length, segs.length, `${id} element count`);
      ok(g.children.every((n) => n.name === 'line'), `${id} holds only <line>`);
      total += g.children.length;
      // coordinates follow the layout (only when the sheet is the layout page)
      if (c.layout.fits) {
        g.children.forEach((n, k) => {
          const [x1, y1, x2, y2] = lineCoords(n);
          const A = c.layout.toPage(segs[k].a), B = c.layout.toPage(segs[k].b);
          near(x1, A[0], 1e-3); near(y1, A[1], 1e-3); near(x2, B[0], 1e-3); near(y2, B[1], 1e-3);
        });
      }
      for (const n of g.children) {
        for (const v of lineCoords(n)) ok(Number.isFinite(v), 'finite coordinate');
        const [x1, y1, x2, y2] = lineCoords(n);
        ok(Math.min(x1, x2) >= -1e-6 && Math.max(x1, x2) <= sc.w + 1e-6, `${id} line inside the sheet (x)`);
        ok(Math.min(y1, y2) >= -1e-6 && Math.max(y1, y2) <= sc.h + 1e-6, `${id} line inside the sheet (y)`);
      }
    }
    eq(total, c.pattern.segments.length, 'one stroked element per segment');
    // seam strips: one tinted rectangle each, where the pattern puts them
    const glue = byId(root, 'glue');
    ok(c.pattern.seams.length > 0, 'default sheet has seam strips');
    eq(glue.children.length, c.pattern.seams.length, 'one tinted rect per seam strip');
    ok(glue.children.every((n) => n.name === 'rect' && n.attrs.fill === PRINT.glue), 'seam strips filled with PRINT.glue');
    if (c.layout.fits) {
      c.pattern.seams.forEach((r, k) => {
        const A = c.layout.toPage([r.x, r.y]), B = c.layout.toPage([r.x + r.w, r.y + r.h]);
        const n = glue.children[k];
        near(Number(n.attrs.x), Math.min(A[0], B[0]), 1e-3); near(Number(n.attrs.y), Math.min(A[1], B[1]), 1e-3);
        near(Number(n.attrs.width), Math.abs(B[0] - A[0]), 1e-3); near(Number(n.attrs.height), Math.abs(B[1] - A[1]), 1e-3);
      });
    }
  });
}

test('svg: crease styling matches PRINT/DASH and scales with the layout', () => {
  for (const pct of [100, 50, 200]) {
    const c = setup({ scale: pct });
    const root = parseXML(patternSVG(c.design, c.pattern, c.layout, c.layout.fits ? {} : { tile: c.layout.tiles[0] }));
    const k = pct / 100;
    const expect = {
      mountain: [PRINT.mountain, 0.25, DASH.mountain],
      valley: [PRINT.valley, 0.25, DASH.valley],
      endring: [PRINT.end, 0.25, DASH.end],
      cut: [PRINT.cut, 0.35, DASH.cut],
    };
    for (const [id, [colour, w, dash]] of Object.entries(expect)) {
      const g = byId(root, id);
      eq(g.attrs.stroke, colour, `${id} colour at ${pct}%`);
      near(Number(g.attrs['stroke-width']), Math.max(0.1, w * k), 1e-9, `${id} width at ${pct}%`);
      eq(g.attrs['stroke-linecap'], 'round', `${id} caps`);
      eq(g.attrs.fill, 'none');
      if (dash.length) eq(g.attrs['stroke-dasharray'], dash.map((d) => +(d * k).toFixed(3)).join(' '), `${id} dashes at ${pct}%`);
      else ok(!('stroke-dasharray' in g.attrs), `${id} solid`);
    }
  }
});

test('svg (default): info box has the info lines, legend swatches and a 50 mm scale bar', () => {
  const c = CASES.default;
  const root = parseXML(patternSVG(c.design, c.pattern, c.layout));
  const info = byId(root, 'info');
  const texts = allText(info);
  const joined = texts.join(' ');
  for (const ln of infoLines(c.design, c.pattern, c.layout)) ok(joined.includes(ln.text), `info text: ${ln.text}`);
  const legend = legendFor(c.pattern);
  eq(legend.map((e) => e.kind).join(), 'mountain,valley,end,glue,cut', 'legend entries for a sheet with end rings and seam strips');
  for (const e of legend) ok(texts.includes(e.label), `legend label ${e.label}`);
  ok(texts.includes(`End-ring fold (${c.design.folds.end})`), 'end-ring fold direction in the legend');
  // cut swatches share the text colour, so pick legend swatches by their layer styling, not by colour
  const swatches = info.children.filter((n) => n.name === 'line' && n.attrs.y1 === n.attrs.y2 && !n.attrs.id);   // horizontal, not the scale bar
  eq(swatches.length, legend.length - 1, 'one line swatch per legend entry except the glue tint');
  ok(info.children.some((n) => n.name === 'rect' && n.attrs.fill === PRINT.glue), 'glue swatch');
  ok(swatches.some((n) => n.attrs.stroke === PRINT.valley && n.attrs['stroke-dasharray'] === DASH.valley.join(' ')), 'valley swatch dashed');
  ok(swatches.some((n) => n.attrs.stroke === PRINT.end && n.attrs['stroke-dasharray'] === DASH.end.join(' ')), 'end-ring swatch dash-dot');
  const plain = setup({ ext: 0, extcols: 0 });
  eq(legendFor(plain.pattern).map((e) => e.kind).join(), 'mountain,valley,cut', 'no end-ring or glue entries without rings and strips');
  const bar = byId(info, 'scale-bar');
  const [x1, y1, x2, y2] = lineCoords(bar);
  near(Math.hypot(x2 - x1, y2 - y1), 50, 1e-6, 'scale bar length');
  ok(texts.includes('50 mm'), 'scale bar label states its printed length');
  const ticks = info.children.filter((n) => n.name === 'line' && n.attrs.x1 === n.attrs.x2 && n.attrs.id !== 'scale-bar');   // vertical tick marks
  eq(ticks.length, 6, 'ticks every 10 mm');
  // everything inside layout.info
  const R = c.layout.info;
  for (const n of info.children) {
    if (n.name === 'line') {
      const [ax, ay, bx, by] = lineCoords(n);
      ok(Math.min(ax, bx) >= R.x - 1e-6 && Math.max(ax, bx) <= R.x + R.w + 1e-6 && Math.min(ay, by) >= R.y - 1e-6 && Math.max(ay, by) <= R.y + R.h + 1e-6, 'info line inside the box');
    } else if (n.name === 'text') {
      const x = Number(n.attrs.x), y = Number(n.attrs.y), w = textWidth(n.text, Number(n.attrs['font-size']));
      ok(x >= R.x && x + w <= R.x + R.w + 1e-6 && y > R.y && y <= R.y + R.h, `info text inside the box: ${n.text}`);
    }
  }
});

test('svg: scale bar is 50 mm x scale, info wraps into a narrow side box', () => {
  const half = setup({ scale: 50 });
  ok(half.layout.fits, '50% fits');
  const bar = byId(parseXML(patternSVG(half.design, half.pattern, half.layout)), 'scale-bar');
  const [x1, , x2] = lineCoords(bar);
  near(x2 - x1, 25, 1e-6, 'bar at 50%');
  const side = setup({ n: 3, dia: 30, floors: 25, page: 'A3', H0: 15, H1: 4.5, ext: 5 });
  ok(side.layout.fits && side.layout.info && side.layout.info.x > side.layout.margin + 1, 'side info box case');
  const R = side.layout.info;
  const info = byId(parseXML(patternSVG(side.design, side.pattern, side.layout)), 'info');
  const texts = info.children.filter((n) => n.name === 'text');
  ok(texts.length > infoLines(side.design, side.pattern, side.layout).length, 'long lines wrapped');
  for (const n of texts) {
    const x = Number(n.attrs.x), y = Number(n.attrs.y), w = textWidth(n.text, Number(n.attrs['font-size']));
    ok(x >= R.x && x + w <= R.x + R.w + 1e-6 && y <= R.y + R.h, `side text inside the box: ${n.text}`);
  }
  const sb = lineCoords(byId(info, 'scale-bar'));
  near(sb[2] - sb[0], 50, 1e-6, 'full 50 mm bar in the side box');
});

test('svg (disc12 on A4): tiled pages clip to the window with overlap marks and labels', () => {
  const c = CASES['disc12 on A4'];
  const L = c.layout;
  ok(!L.fits && L.tiles.length > 1, 'needs tiles');
  const rows = Math.max(...L.tiles.map((t) => t.row)) + 1, cols = Math.max(...L.tiles.map((t) => t.col)) + 1;
  const drawn = {};
  for (const tile of L.tiles) {
    const root = parseXML(patternSVG(c.design, c.pattern, L, { tile }));
    eq(root.attrs.viewBox, `0 0 ${L.page.w} ${L.page.h}`, 'tile page viewBox');
    eq(root.attrs.width, `${L.page.w}mm`);
    const win = { x: L.printable.x, y: L.printable.y, w: tile.w, h: tile.h };
    const rect = [[win.x, win.y], [win.x + win.w, win.y], [win.x + win.w, win.y + win.h], [win.x, win.y + win.h]];
    const map = (pt) => { const q = L.toPage(pt); return [q[0] - tile.x + win.x, q[1] - tile.y + win.y]; };
    for (const id of LINE_LAYERS) {
      const g = byId(root, id);
      const segs = c.pattern.segments.filter((s) => segmentLayer(s) === id);
      const expected = segs.map((s) => [s, map(s.a), map(s.b)]).filter(([, A, B]) => {
        const q = clipConvex(A, B, rect);
        return q && Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) > 1e-6;
      });
      eq(g.children.length, expected.length, `tile ${tile.row},${tile.col} ${id} line count`);
      for (const n of g.children) {
        const [x1, y1, x2, y2] = lineCoords(n);
        for (const [x, y] of [[x1, y1], [x2, y2]]) {
          ok(x >= win.x - 1e-3 && x <= win.x + win.w + 1e-3 && y >= win.y - 1e-3 && y <= win.y + win.h + 1e-3, `${id} line inside the window`);
        }
        drawn[id] = (drawn[id] || 0) + Math.hypot(x2 - x1, y2 - y1);
      }
      // a dashed line cut by the window keeps the phase of the whole segment
      if (id === 'valley') {
        const period = DASH.valley.reduce((a, b) => a + b, 0) * L.scale;
        for (const [, A, B] of expected) {
          const q = clipConvex(A, B, rect);
          const t0 = Math.hypot(q[0][0] - A[0], q[0][1] - A[1]);
          if (t0 < 1e-6) continue;
          const n = g.children.find((e) => Math.abs(Number(e.attrs.x1) - q[0][0]) < 2e-3 && Math.abs(Number(e.attrs.y1) - q[0][1]) < 2e-3);
          ok(n, 'clipped valley line present');
          const off = Number(n.attrs['stroke-dashoffset'] || 0);
          const want = t0 % period;
          ok(Math.abs(off - want) < 2e-3 || Math.abs(Math.abs(off - want) - period) < 2e-3, `dash offset ${off} vs ${want}`);
        }
      }
    }
    const texts = allText(root);
    ok(texts.includes(`Page ${tile.row + 1},${tile.col + 1} of ${rows} x ${cols}`), `page label for ${tile.row},${tile.col}`);
    const tiling = byId(root, 'tiling');
    ok(tiling, 'tiling layer');
    const dashed = tiling.children.filter((n) => n.name === 'line' && n.attrs['stroke-dasharray'] && n.attrs['stroke-dasharray'] !== 'none');
    const neighbours = (tile.col > 0) + (tile.col < cols - 1) + (tile.row > 0) + (tile.row < rows - 1);
    eq(dashed.length, neighbours, 'one dashed overlap line per neighbour');
    ok(tiling.children.filter((n) => n.name === 'circle').length >= 2, 'alignment crosses');
    eq(byId(root, 'info').children.filter((n) => n.name === 'rect').length, 0, 'no info box on tiles');
  }
  // the pages together draw every crease (overlaps counted twice)
  for (const id of LINE_LAYERS) {
    const full = c.pattern.segments.filter((s) => segmentLayer(s) === id).reduce((a, s) => a + s.len, 0) * L.scale;
    ok((drawn[id] || 0) >= full - 1e-6, `${id}: tiles cover the pattern (${drawn[id]} >= ${full})`);
  }
});

test('svg: alignment crosses sit at the same pattern point on neighbouring tiles', () => {
  const c = setup({ scale: 200 });
  const L = c.layout;
  ok(L.tiles.length >= 4, '2 x 2 tiles at 200%');
  const pts = new Map();
  for (const tile of L.tiles) {
    const root = parseXML(patternSVG(c.design, c.pattern, L, { tile }));
    const circles = findAll(byId(root, 'tiling'), (n) => n.name === 'circle');
    // back to layout page coordinates
    const pagePts = circles.map((n) => [Number(n.attrs.cx) + tile.x - L.printable.x, Number(n.attrs.cy) + tile.y - L.printable.y]);
    pts.set(`${tile.row},${tile.col}`, pagePts);
  }
  const has = (list, p) => list.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6);
  for (const p of pts.get('0,0')) {
    ok(has(pts.get('0,1'), p) || has(pts.get('1,0'), p), 'cross shared with a neighbour');
  }
});

test('svg: XML escaping and text helpers', () => {
  eq(xmlEscape(`a & b < c > d " e ' f`), 'a &amp; b &lt; c &gt; d &quot; e &apos; f');
  eq(xmlEscape('ok\u0001\u0008text'), 'oktext', 'control characters dropped');
  eq(xmlEscape('lone \ud800 surrogate'), 'lone  surrogate');
  eq(xmlEscape('pair 😀'), 'pair 😀');
  parseXML(`<t a="${xmlEscape('<&>"\'')}">${xmlEscape('<&>"\'')}</t>`);
  eq(winAnsiCodes('° Ø · × µ ² – —').filter((c) => c !== 32).join(','), [0xb0, 0xd8, 0xb7, 0xd7, 0xb5, 0xb2, 0x96, 0x97].join(','));
  eq(String.fromCharCode(...winAnsiCodes('π ≈ 3 ≤ ő 中')), 'pi ~ 3 <= o ?');
  near(textWidth('Hello', 10), (722 + 556 + 222 + 222 + 556) / 100, 1e-9, 'Helvetica widths');
  const lines = wrapText('Kresling tube · n = 6 · Ø 40.0 mm · 6 floors · right-handed', 3, 40);
  ok(lines.length > 1 && lines.every((l) => textWidth(l, 3) <= 40), 'wrapped to the width');
  eq(lines.join(' '), 'Kresling tube · n = 6 · Ø 40.0 mm · 6 floors · right-handed', 'wrap keeps the words');
  ok(lines.every((l) => !l.startsWith('·') && !/(^|\s)=$/.test(l) && !/^mm/.test(l)), 'no break before ·, after =, or inside "40.0 mm"');
});

test('exporters reject invalid designs with the design error', async () => {
  const bad = setup({ H0: 10, H1: 12 });
  eq(bad.design.valid, false);
  const good = CASES.default;
  for (const fn of [() => patternSVG(bad.design, null, good.layout), () => patternPDF(bad.design, null, good.layout), () => patternDXF(bad.design, null)]) {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    ok(err instanceof Error && err.message.includes(bad.design.errors[0]), `readable error: ${err && err.message}`);
  }
  const e = await patternPNG(bad.design, null, good.layout).then(() => null, (x) => x);
  ok(e instanceof Error && e.message.includes(bad.design.errors[0]), 'png rejects with the design error');
  let err = null;
  try { patternSVG(good.design, good.pattern, null); } catch (x) { err = x; }
  ok(err instanceof Error && /layout/.test(err.message), 'missing layout');
});

// ── PDF ──────────────────────────────────────────────────────────────────
function latin1(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }

function parsePDF(bytes) {
  ok(bytes instanceof Uint8Array, 'Uint8Array');
  const s = latin1(bytes);
  ok(s.startsWith('%PDF-1.4\n'), 'PDF 1.4 header');
  const bin = s.indexOf('\n', 9);
  ok([...s.slice(10, bin)].every((ch) => ch.charCodeAt(0) >= 128), 'binary marker comment');
  for (let i = bin; i < s.length; i++) if (s.charCodeAt(i) > 126) throw new Error(`non-ASCII byte at ${i}`);
  ok(/%%EOF\n?$/.test(s), '%%EOF at the end');
  const m = /startxref\n(\d+)\n%%EOF\n?$/.exec(s);
  ok(m, 'startxref');
  const xref = Number(m[1]);
  ok(s.startsWith('xref\n', xref), 'startxref points at the xref table');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(xref, xref + 32));
  ok(head, 'xref subsection header');
  const size = Number(head[1]);
  const offsets = [];
  let p = xref + head[0].length;
  for (let i = 0; i < size; i++, p += 20) {
    const e = s.slice(p, p + 20);
    ok(/^\d{10} \d{5} [nf](?: \n|\r\n)$/.test(e), `xref entry ${i} is 20 bytes: ${JSON.stringify(e)}`);
    if (i === 0) { ok(e.startsWith('0000000000 65535 f'), 'free list head'); continue; }
    offsets[i] = Number(e.slice(0, 10));
    ok(s.startsWith(`${i} 0 obj`, offsets[i]), `xref ${i} points at "${i} 0 obj"`);
  }
  ok(s.startsWith('trailer', p), 'trailer after the xref table');
  const trailer = s.slice(p, s.indexOf('startxref', p));
  eq(Number(/\/Size (\d+)/.exec(trailer)[1]), size, 'trailer /Size');
  const obj = (i) => {
    ok(offsets[i] !== undefined, `object ${i} exists`);
    const start = offsets[i] + `${i} 0 obj\n`.length;
    return s.slice(start, s.indexOf('\nendobj', start));
  };
  const ref = (body, key) => Number(new RegExp(`/${key} (\\d+) 0 R`).exec(body)[1]);
  const catalog = obj(ref(trailer, 'Root'));
  ok(catalog.includes('/Type /Catalog'), 'catalog');
  const info = obj(ref(trailer, 'Info'));
  ok(/\/Title (\(|<FEFF)/.test(info), '/Info has /Title');
  const pages = obj(ref(catalog, 'Pages'));
  ok(pages.includes('/Type /Pages'), 'page tree');
  const kids = [.../\/Kids \[([^\]]*)\]/.exec(pages)[1].matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));
  eq(Number(/\/Count (\d+)/.exec(pages)[1]), kids.length, '/Count = kids');
  const pageList = kids.map((k) => {
    const page = obj(k);
    ok(/\/Type \/Page\b/.test(page), 'page object');
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(page);
    const font = obj(Number(/\/F1 (\d+) 0 R/.exec(page)[1]));
    ok(font.includes('/BaseFont /Helvetica') && font.includes('/Encoding /WinAnsiEncoding'), 'Helvetica WinAnsi');
    const cs = obj(ref(page, 'Contents'));
    const lm = /^<< \/Length (\d+) >>\nstream\n/.exec(cs);
    ok(lm, 'content stream dictionary');
    ok(cs.endsWith('\nendstream'), 'endstream');
    const data = cs.slice(lm[0].length, cs.length - '\nendstream'.length);
    eq(data.length, Number(lm[1]), 'stream /Length');
    return { w: Number(box[1]), h: Number(box[2]), content: data };
  });
  return { s, size, info, count: kids.length, pages: pageList };
}

// Decodes every (...) literal string; fails on unescaped parentheses or raw bytes.
function pdfStrings(content) {
  const out = [];
  const ESC = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '(') continue;
    const bytes = [];
    let j = i + 1;
    for (;;) {
      const ch = content[j];
      ok(ch !== undefined, 'unterminated string');
      if (ch === '\\') {
        const oct = /^[0-7]{1,3}/.exec(content.slice(j + 1, j + 4));
        if (oct) { bytes.push(parseInt(oct[0], 8)); j += 1 + oct[0].length; continue; }
        ok(content[j + 1] in ESC, `bad escape \\${content[j + 1]}`);
        bytes.push(ESC[content[j + 1]]); j += 2; continue;
      }
      ok(ch !== '(', 'unescaped "(" inside a string');
      if (ch === ')') break;
      const code = ch.charCodeAt(0);
      ok(code >= 32 && code < 127, `raw byte ${code} inside a string`);
      bytes.push(code); j++;
    }
    out.push(bytes);
    i = j;
  }
  return out;
}

const PT = 72 / 25.4;
for (const [name, c] of Object.entries(CASES)) {
  test(`pdf (${name}): header, xref offsets, pages and escaped text`, () => {
    const pdf = parsePDF(patternPDF(c.design, c.pattern, c.layout));
    const L = c.layout;
    // the pattern page(s), plus the legend page when none of them has room for the info box
    eq(pdf.count, (L.fits ? 1 : L.tiles.length) + (needsInfoPage(L) ? 1 : 0), '/Count');
    for (const pg of pdf.pages) {
      near(pg.w, L.page.w * PT, 1e-3, 'MediaBox width');
      near(pg.h, L.page.h * PT, 1e-3, 'MediaBox height');
    }
    const title = infoLines(c.design, c.pattern, L)[0].text;
    const strings = pdf.pages.flatMap((pg) => pdfStrings(pg.content));
    ok(strings.length > 0, 'page text');
    const want = winAnsiCodes(title).join(',');
    ok(strings.some((b) => b.join(',') === want), 'title drawn in WinAnsi (info box, or the legend page of a tiled print)');
    if (needsInfoPage(L)) {
      const last = pdfStrings(pdf.pages[pdf.count - 1].content).map((b) => String.fromCharCode(...b));
      ok(last.includes('Legend and print check'), 'legend page heading');
      for (const e of legendFor(c.pattern)) ok(last.includes(e.label), `legend page has "${e.label}"`);
      ok(last.includes(`${+(50 * L.scale).toFixed(2)} mm`), 'legend page has the scale-bar label');
    }
    ok(pdf.pages[0].content.includes('\\267') && pdf.pages[0].content.includes('\\330'), '· and Ø as octal escapes');
    // drawing operators
    const content = pdf.pages.map((pg) => pg.content).join('\n');
    ok(content.includes('0.816 0.204 0.173 RG'), 'mountain red');
    ok(content.includes('0.122 0.373 0.82 RG'), 'valley blue');
    const k = L.scale * PT;
    ok(content.includes(`[${DASH.valley.map((d) => +(d * k).toFixed(3)).join(' ')}] 0 d`), 'valley dash');
    ok(content.includes(`[${DASH.end.map((d) => +(d * k).toFixed(3)).join(' ')}] `), 'end-ring dash-dot');
    ok(content.includes(`${+(0.25 * L.scale * PT).toFixed(3)} w`) && content.includes(`${+(0.35 * L.scale * PT).toFixed(3)} w`), 'crease and cut widths');
    ok(content.includes('1 J'), 'round caps');
    // one stroked path per scene line, scene lines = pattern segments (fit case)
    const scenes = L.fits ? [sheetScene(c.design, c.pattern, L)] : L.tiles.map((tile) => sheetScene(c.design, c.pattern, L, { tile }));
    scenes.forEach((sc, i) => {
      const lines = sc.layers.filter((ly) => ly.id !== 'sheet').flatMap((ly) => ly.items).filter((it) => it.type === 'line').length;
      eq((pdf.pages[i].content.match(/ l S$/gm) || []).length, lines, `stroked lines on page ${i + 1}`);
      if (L.fits) eq(sc.layers.filter((ly) => LINE_LAYERS.includes(ly.id)).reduce((a, ly) => a + ly.items.length, 0), c.pattern.segments.length);
    });
    if (!L.fits) {
      L.tiles.forEach((t, i) => {
        const bytes = pdfStrings(pdf.pages[i].content).map((b) => String.fromCharCode(...b));
        ok(bytes.includes(`Page ${t.row + 1},${t.col + 1} of 1 x ${L.tiles.length}`), `tile label on page ${i + 1}`);
      });
    }
  });
}

test('pdf: string escaping', () => {
  eq(pdfString('a(b)c\\d'), '(a\\(b\\)c\\\\d)');
  eq(pdfString('° Ø · × µ ² – —'), '(\\260 \\330 \\267 \\327 \\265 \\262 \\226 \\227)');
  eq(pdfString('π ≈ 3'), '(pi ~ 3)');
  eq(pdfString('tab\there'), '(tab here)');
  const strs = pdfStrings(`${pdfString('x (y) \\ z°')} Tj`);
  eq(String.fromCharCode(...strs[0]), 'x (y) \\ z°');
});

// ── DXF ──────────────────────────────────────────────────────────────────
function parseDXF(text) {
  ok(typeof text === 'string', 'string');
  ok(/^[\x00-\x7f]*$/.test(text), 'ASCII only');
  const lines = text.split('\r\n');
  eq(lines.pop(), '', 'ends with CRLF');
  ok(!lines.some((l) => l.includes('\n')), 'CRLF line ends only');
  eq(lines.length % 2, 0, 'even number of lines');
  const records = [];
  for (let i = 0; i < lines.length; i += 2) {
    ok(/^ *-?\d+$/.test(lines[i]), `group code on line ${i + 1} is an integer: "${lines[i]}"`);
    const code = Number(lines[i]), value = lines[i + 1];
    if (code === 0) records.push({ type: value, g: [] });
    else { ok(records.length, 'group before the first 0'); records[records.length - 1].g.push([code, value]); }
  }
  return records;
}
const gv = (rec, code) => (rec.g.find(([c]) => c === code) || [])[1];
const gall = (rec, code) => rec.g.filter(([c]) => c === code).map(([, v]) => v);

for (const [name, c] of Object.entries(CASES)) {
  test(`dxf (${name}): R12 sections, tables, one LINE per segment`, () => {
    const recs = parseDXF(patternDXF(c.design, c.pattern));
    eq(recs[recs.length - 1].type, 'EOF', 'ends with EOF');
    const sections = recs.filter((r) => r.type === 'SECTION').map((r) => gv(r, 2));
    for (const s of ['HEADER', 'TABLES', 'ENTITIES']) ok(sections.includes(s), `${s} section`);
    eq(recs.filter((r) => r.type === 'ENDSEC').length, sections.length, 'every section closed');
    const header = recs.find((r) => r.type === 'SECTION' && gv(r, 2) === 'HEADER');
    const hv = (name) => { const i = header.g.findIndex(([code, v]) => code === 9 && v === name); return i < 0 ? null : header.g[i + 1]; };
    eq(hv('$ACADVER')[1], 'AC1009', 'R12');
    eq(hv('$INSUNITS').join(':'), '70:4', '$INSUNITS mm');
    const tables = recs.filter((r) => r.type === 'TABLE').map((r) => gv(r, 2));
    ok(tables.includes('LTYPE') && tables.includes('LAYER'), 'LTYPE and LAYER tables');
    eq(recs.filter((r) => r.type === 'ENDTAB').length, tables.length, 'every table closed');
    const lt = Object.fromEntries(recs.filter((r) => r.type === 'LTYPE').map((r) => [gv(r, 2), r]));
    for (const n of ['CONTINUOUS', 'DASHED', 'DASHDOT']) ok(lt[n], `linetype ${n}`);
    eq(gall(lt.DASHED, 49).map(Number).join(' '), '2.4 -1.6', 'DASHED elements (mm)');
    near(Number(gv(lt.DASHED, 40)), 4, 1e-9, 'DASHED length');
    eq(gall(lt.DASHDOT, 49).map(Number).join(' '), '3 -1 0.6 -1', 'DASHDOT elements (mm)');
    near(Number(gv(lt.DASHDOT, 40)), 5.6, 1e-9, 'DASHDOT length');
    eq(Number(gv(lt.DASHED, 73)), 2); eq(Number(gv(lt.DASHED, 72)), 65);
    const layers = Object.fromEntries(recs.filter((r) => r.type === 'LAYER').map((r) => [gv(r, 2), r]));
    const want = { CUT: [7, 'CONTINUOUS'], MOUNTAIN: [1, 'CONTINUOUS'], VALLEY: [5, 'DASHED'], END_RING: [1, 'DASHDOT'] };
    for (const [n, [col, ltype]] of Object.entries(want)) {
      ok(layers[n], `layer ${n}`);
      eq(Number(gv(layers[n], 62)), col, `${n} colour`);
      eq(gv(layers[n], 6), ltype, `${n} linetype`);
    }
    const lines = recs.filter((r) => r.type === 'LINE');
    eq(lines.length, c.pattern.segments.length, 'LINE count = segments');
    const names = { cut: 'CUT', mountain: 'MOUNTAIN', valley: 'VALLEY', endring: 'END_RING' };
    lines.forEach((r, i) => {
      const s = c.pattern.segments[i];
      eq(gv(r, 8), names[segmentLayer(s)], 'line layer');
      near(Number(gv(r, 10)), s.a[0], 1e-5); near(Number(gv(r, 20)), s.a[1], 1e-5);
      near(Number(gv(r, 11)), s.b[0], 1e-5); near(Number(gv(r, 21)), s.b[1], 1e-5);
      for (const code of [10, 20, 30, 11, 21, 31]) ok(/^-?\d+\.\d+$/.test(gv(r, code)), `real value ${gv(r, code)}`);
      ok(Number(gv(r, 10)) >= -1e-6 && Number(gv(r, 10)) <= c.pattern.width + 1e-6, 'x within the pattern');
      ok(Number(gv(r, 20)) >= -1e-6 && Number(gv(r, 20)) <= c.pattern.height + 1e-6, 'y within the pattern');
    });
  });
}

// ── JSON ─────────────────────────────────────────────────────────────────
test('json: design file round trip', () => {
  for (const params of [CASES.default.params, CASES['disc12 on A4'].params, P({ n: 8, chir: -1, seamAuto: false, seamR: 7.5, material: 'kapton', stacking: 'helical' })]) {
    const text = designFile(params);
    const obj = JSON.parse(text);
    eq(obj.app, APP_NAME); eq(obj.version, APP_VERSION);
    ok(text.includes('\n  "params": {'), 'pretty printed');
    const back = readDesignFile(text);
    ok(back.ok, back.error);
    eq(JSON.stringify(back.params), JSON.stringify(params), 'params survive the round trip');
    eq(back.ignored.length, 0);
  }
});

test('json: bare params, normalisation, BOM and bytes', () => {
  const r = readDesignFile(JSON.stringify({ n: 99, dia: '55', chir: '-1', floors: 3.6, extra: 1 }));
  ok(r.ok, r.error);
  eq(r.params.n, 20, 'clamped'); eq(r.params.dia, 55, 'coerced'); eq(r.params.chir, -1, 'select coerced'); eq(r.params.floors, 4, 'rounded');
  eq(r.params.H0, DEFAULTS.H0, 'defaults filled');
  eq(r.ignored.join(','), 'extra');
  const file = designFile(P({ n: 7 }));
  eq(readDesignFile(`﻿${file}`).params.n, 7, 'byte-order mark');
  eq(readDesignFile(new TextEncoder().encode(file)).params.n, 7, 'UTF-8 bytes');
});

test('json: rejects non-JSON and non-design input with readable errors', () => {
  const cases = ['', '   ', 'not json', '{"n": 6', '[]', '[1,2]', '42', 'null', '"text"', 'true',
    '{"params": 5}', '{"params": null}', '{"params": [1]}', '{"foo": 1}', '{"app": "Kresling Studio", "params": {}}'];
  for (const text of cases) {
    const r = readDesignFile(text);
    ok(r.ok === false, `rejects ${JSON.stringify(text)}`);
    ok(typeof r.error === 'string' && r.error.length > 10 && r.error.length < 200, `readable error for ${JSON.stringify(text)}: ${r.error}`);
  }
  for (const v of [undefined, null, 42, {}, new Uint8Array([0xff, 0xfe, 0x00])]) {
    const r = readDesignFile(v);
    ok(r.ok === false && typeof r.error === 'string', `rejects ${String(v)}`);
  }
});

// ── presets from Kresling-crease-Gen ─────────────────────────────────────
// The sheet that app draws for a preset (vertices as in its buildVerts, creases
// as in its exporters), in mm with row 0 at the bottom, clipped to the body
// between the two seam lines and moved so the left seam line is x = 0.
function creaseGenBody(p) {
  const b = ((Math.PI * p.dia) / p.n) * 10, fh = (p.height / p.floors) * 10;
  const dx = fh / Math.tan((p.angle * Math.PI) / 180);
  const F = p.floors * p.stack;
  const V = (f, col) => [col * b + (f % 2 === 1 ? dx : -dx) * p.chir, f * fh];
  const x0 = V(0, 0)[0], W = p.n * b, H = F * fh;
  const body = [[x0, 0], [x0 + W, 0], [x0 + W, H], [x0, H]];
  const segs = [];
  const add = (A, B, colour) => {
    const c = clipConvex(A, B, body);
    if (c && Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) > 1e-6) segs.push({ colour, a: [c[0][0] - x0, c[0][1]], b: [c[1][0] - x0, c[1][1]] });
  };
  for (let f = 0; f < F; f++) {
    for (let col = -4; col <= p.n + 4; col++) {
      add(V(f, col), V(f + 1, col), 'red');                                    // its mountain zigzag
      if ((f * p.chir) % 2 === 0) add(V(f, col + 1), V(f + 1, col), 'green');  // its valley diagonal
      else add(V(f, col), V(f + 1, col + 1), 'green');
    }
  }
  return { segs, W, H, b, fh, F };
}
const CG = {   // that app's start-up design and three of its built-in presets, as its Export writes them
  default: { dia: 3, height: 20, n: 6, floors: 10, angle: 100, ext: 2, seaml: 1.4, seamr: 0, extcols: 1, stack: 1, scale: 100, compress: 0, wallmm: 0.8, thick: 50, chir: 1, material: 'polyimide', seamAuto: false, _version: 1 },
  bistable8: { dia: 5, height: 20, n: 8, floors: 10, angle: 100, ext: 2, seaml: 1.96, seamr: 1.96, extcols: 1, stack: 1, scale: 100, compress: 0, wallmm: 0.8, thick: 50, chir: 1, material: 'generic', seamAuto: false, _version: 1 },
  tower: { dia: 2.5, height: 30, n: 6, floors: 16, angle: 95, ext: 1.5, seaml: 1.31, seamr: 1.31, extcols: 1, stack: 2, scale: 80, compress: 0, wallmm: 0.8, thick: 25, chir: 1, material: 'polyimide', seamAuto: true, _version: 1 },
  bistable6: { dia: 4, height: 16, n: 6, floors: 8, angle: 105, ext: 1.5, seaml: 1.57, seamr: 1.57, extcols: 1, stack: 1, scale: 100, compress: 0, wallmm: 0.8, thick: 50, chir: 1, material: 'generic', seamAuto: false, _version: 1 },
};

test('json: a Kresling-crease-Gen preset opens as the same sheet, crease for crease', () => {
  const segKey = (a, b) => [a, b].map((q) => q.map((v) => String(Math.round(v * 1e4) + 0)).join(',')).sort().join('|');
  const variants = [CG.default, { ...CG.default, chir: -1 }, { ...CG.default, floors: 9 }, { ...CG.default, angle: 80 },
    CG.bistable8, { ...CG.bistable8, chir: -1, floors: 7 }, CG.tower, { ...CG.default, angle: 97.5, n: 7, dia: 4.5 },
    { ...CG.default, angle: 60 }];    // the last one leans so far that the red crease is the long diagonal
  for (const p of variants) {
    const tag = JSON.stringify({ dia: p.dia, n: p.n, floors: p.floors, stack: p.stack, angle: p.angle, chir: p.chir });
    const r = readDesignFile(JSON.stringify(p));
    ok(r.ok, `${tag}: ${r.error}`);
    eq(r.source, 'crease-gen', tag); eq(r.drawable, true, tag); eq(r.ignored.length, 0, `${tag}: nothing left out`);
    ok(/same creases/.test(r.notes[0]), `${tag}: says the creases are kept`);
    const q = r.params;
    eq(q.designBy, 'flat'); eq(q.n, p.n); eq(q.floors, p.floors); eq(q.stack, p.stack); eq(q.stacking, 'alternate');
    eq(q.scale, p.scale); near(q.ringBottom, 10 * p.ext, 1e-9, 'bottom ring in mm'); near(q.ringTop, 10 * p.ext, 1e-9, 'top ring in mm'); eq(q.wall, p.wallmm);
    near(q.dia, (10 * Math.PI * p.dia) / (p.n * Math.sin(Math.PI / p.n)), 1e-9, `${tag}: true tube diameter`);
    near(q.hFlat, (10 * p.height) / p.floors, 1e-9, `${tag}: floor height`);
    eq(JSON.stringify(normalizeParams(q)), JSON.stringify(q), `${tag}: already normalised`);
    const back = readDesignFile(designFile(q));            // saved again, it is an ordinary design file
    eq(back.source, 'studio'); eq(JSON.stringify(back.params), JSON.stringify(q), `${tag}: survives Save design`);

    const ref = creaseGenBody(p);
    const d = computeDesign(q);
    ok(d.valid, `${tag}: valid here`);
    const pat = buildPattern(d);
    eq(pat.floors, ref.F, `${tag}: floors x stack on one sheet`);
    const left = p.seamAuto ? p.extcols * ref.b : 10 * p.seaml, right = p.seamAuto ? p.extcols * ref.b : 10 * p.seamr;
    near(pat.width, ref.W + left + right, 1e-6, `${tag}: sheet width with both seam strips`);
    near(pat.height, ref.H + 20 * p.ext, 1e-6, `${tag}: sheet height with both end rings`);
    near(pat.body.x, left, 1e-6, `${tag}: left strip stays on the left`);
    pat.rowY.forEach((y, f) => near(y - pat.rings.bottom, f * ref.fh, 1e-6, `${tag}: polygon fold ${f}`));
    // diagonals: identical sets (pieces lying exactly on a seam line appear on either edge, so skip them)
    const onSeam = (a, b) => [0, ref.W].some((x) => Math.abs(a[0] - x) < 1e-6 && Math.abs(b[0] - x) < 1e-6);
    const theirs = new Map(ref.segs.filter((s) => !onSeam(s.a, s.b)).map((s) => [segKey(s.a, s.b), s.colour]));
    const ox = pat.body.x, oy = pat.rings.bottom;
    const mine = new Map(pat.segments.filter((s) => !s.tab && (s.family === 'long' || s.family === 'short'))
      .map((s) => ({ ...s, a: [s.a[0] - ox, s.a[1] - oy], b: [s.b[0] - ox, s.b[1] - oy] }))
      .filter((s) => !onSeam(s.a, s.b)).map((s) => [segKey(s.a, s.b), s]));
    eq(mine.size, theirs.size, `${tag}: number of diagonal creases in the body`);
    for (const k of theirs.keys()) ok(mine.has(k), `${tag}: crease ${k} of the original is on the sheet`);
  }
  // the start-up design: numbers the toast reports, material, and the fold directions of the diagonals
  const r = readDesignFile(JSON.stringify(CG.default));
  near(r.params.angle, (Math.atan2(1, 2 / Math.tan((100 * Math.PI) / 180)) * 180) / Math.PI, 1e-9, 'angle as drawn');
  near(r.params.angle, 109.43, 0.01); near(r.params.dia, 31.416, 0.001);
  eq(r.params.chir, -1, 'first floor leans left: left-handed here');
  const steep = readDesignFile(JSON.stringify({ ...CG.default, angle: 60 }));
  eq(steep.params.chir, 1, 'a first floor that leans right stays right-handed');
  ok(!steep.notes.some((t) => /Handedness/.test(t)), 'no handedness note when the name does not change');
  eq(r.params.material, 'kapton'); eq(r.params.thick, 50); eq(r.params.E, 2.5); eq(r.params.rho, 1.42);
  eq(r.params.seamAuto, false); near(r.params.seamL, 14, 1e-9); eq(r.params.seamR, 0);
  ok(r.notes.some((t) => /Diameter 30 → 31\.42 mm/.test(t)), r.notes.join(' | '));
  ok(r.notes.some((t) => /Crease angle 100° → 109\.43°/.test(t)), 'angle note');
  ok(r.notes.some((t) => /left-handed/.test(t)), 'handedness note');
  const d = computeDesign(r.params);
  eq(d.status, 'bistable');
  eq(d.folds.short, 'mountain', 'its red creases are the short diagonals: mountain in both apps');
  eq(d.folds.long, 'valley', 'its green creases are the long diagonals: valley in both apps');
  eq(readDesignFile(JSON.stringify(CG.tower)).params.seamAuto, true);
  eq(readDesignFile(JSON.stringify(CG.tower)).params.thick, 25, 'polyimide keeps its thickness');
  ok(readDesignFile(JSON.stringify(CG.bistable8)).notes.some((t) => /Generic \(unmodeled\)/.test(t)), 'generic material note');
});

test('json: Kresling-crease-Gen presets that cannot be drawn or rebuilt say why', () => {
  const b6 = readDesignFile(JSON.stringify(CG.bistable6));       // no rigid fold: opens, but nothing is drawn
  ok(b6.ok && b6.drawable === false, 'opens');
  ok(/draws no pattern/.test(b6.notes[0]) && !/same creases/.test(b6.notes.join(' ')), b6.notes[0]);
  eq(computeDesign(b6.params).valid, false);
  for (const [over, re] of [
    [{ height: 2, floors: 20 }, /floor height \(1 mm\) is outside 2–150 mm/],
    [{ dia: 8, height: 6, floors: 6, angle: 60 }, /drawn crease angle \(40\.89°\) is outside 45–160°/],
    [{ n: 2 }, /does not describe a tube/],
    [{ dia: null }, /no number for dia/],
    [{ angle: 'steep' }, /no number for angle/],
  ]) {
    const r = readDesignFile(JSON.stringify({ ...CG.default, ...over }));
    ok(r.ok === false && re.test(r.error), `${JSON.stringify(over)} -> ${r.error || 'opened'}`);
    ok(r.error.length < 200, 'one readable sentence');
  }
  eq(readDesignFile(JSON.stringify({ height: 20, n: 6 })).ok, false, 'height alone is not enough');
  // values outside this app's ranges that do not move a crease are limited, and the note says so
  const soft = readDesignFile(JSON.stringify({ ...CG.default, seaml: 7, wallmm: 9, flap: 1 }));
  ok(soft.ok, soft.error);
  eq(soft.params.seamL, 60); eq(soft.params.wall, 5);
  ok(soft.notes.some((t) => /Seam strip left limited to 60 mm \(the preset has 70 mm\)/.test(t)), soft.notes.join(' | '));
  ok(soft.notes.some((t) => /Tube wall limited to 5 mm/.test(t)), 'wall note');
  eq(soft.ignored.join(), 'flap', 'unknown keys are reported');
  // a file of this app is never mistaken for one, wrapped or bare
  eq(readDesignFile(designFile(P())).source, 'studio');
  eq(readDesignFile(JSON.stringify({ n: 8, angle: 100, hFlat: 20, height: 5 })).source, 'studio', 'bare object with this app\'s shape keys');
  eq(fromCreaseGen(null).ok, false); eq(fromCreaseGen([1]).ok, false);
});

// ── legend page ──────────────────────────────────────────────────────────
test('legend page: a sheet with no room for the info box still prints its legend and scale bar', () => {
  ok(!needsInfoPage(CASES.default.layout), 'default: the info box is on the pattern page');
  const c = setup({ floors: 8, ext: 30 });
  ok(c.layout.fits && !c.layout.info && needsInfoPage(c.layout), 'fits its page with no room beside or below');
  eq(byId(parseXML(patternSVG(c.design, c.pattern, c.layout)), 'info').children.length, 0, 'nothing squeezed onto the pattern page');
  const pdf = parsePDF(patternPDF(c.design, c.pattern, c.layout));
  eq(pdf.count, 2, 'pattern page + legend page');
  for (const pg of pdf.pages) { near(pg.w, c.layout.page.w * PT, 1e-3, 'same page width'); near(pg.h, c.layout.page.h * PT, 1e-3, 'same page height'); }
  for (const [name, k] of [['crowded', c], ['tiled', CASES['disc12 on A4']], ['enlarged and tiled', setup({ scale: 150 })]]) {
    const L = k.layout;
    if (name !== 'crowded') ok(!L.fits, `${name} is tiled`);
    const sc = infoScene(k.design, k.pattern, L);
    eq(sc.w, L.page.w, `${name}: page width`); eq(sc.h, L.page.h, `${name}: page height`);
    const info = byId(parseXML(sceneSVG(sc)), 'info');
    const texts = allText(info), joined = texts.join(' ');
    ok(texts.includes('Legend and print check'), `${name}: heading`);
    for (const ln of infoLines(k.design, k.pattern, L)) ok(joined.includes(ln.text), `${name}: info text: ${ln.text}`);
    for (const e of legendFor(k.pattern)) ok(texts.includes(e.label), `${name}: legend label ${e.label}`);
    ok(joined.includes(`Sheet outline as printed: ${+(k.pattern.width * L.scale).toFixed(2)} × ${+(k.pattern.height * L.scale).toFixed(2)} mm.`), `${name}: printed size of the outline`);
    ok(L.fits ? joined.includes('printed separately') : joined.includes(`printed on ${L.tiles.length} pages`), `${name}: says why it is separate`);
    const bar = lineCoords(byId(info, 'scale-bar'));
    near(bar[2] - bar[0], 50 * L.scale, 1e-6, `${name}: scale bar is 50 mm of pattern`);
    const m = Math.max(L.margin, 8) - 1e-6;
    for (const n of info.children) {
      if (n.name === 'line') {
        const [ax, ay, bx, by] = lineCoords(n);
        ok(Math.min(ax, bx) >= m && Math.max(ax, bx) <= sc.w - m && Math.min(ay, by) >= m && Math.max(ay, by) <= sc.h - m, `${name}: line inside the margins`);
      } else if (n.name === 'text') {
        const x = Number(n.attrs.x), y = Number(n.attrs.y), w = textWidth(n.text, Number(n.attrs['font-size']));
        ok(x >= m && x + w <= sc.w - m && y >= m && y <= sc.h - m, `${name}: text inside the margins: ${n.text}`);
      }
    }
  }
});

test('stacked designs: info box and pack instructions describe one sheet with every floor', () => {
  const c = setup(PRESETS.tower8.params);                       // 7 floors x 2, alternating
  eq(c.pattern.floors, 14);
  const title = infoLines(c.design, c.pattern, c.layout)[0].text;
  ok(title.includes('14 floors (2 × 7)'), title);
  ok(!/module|print 2/i.test(title), 'no "print N copies"');
  const notes = assemblyNotes(c.design, c.pattern, c.layout);
  ok(notes.includes('14 floors (2 x 7) on one sheet'), 'README names the whole stack');
  ok(!/copies|one per module|mirror image/i.test(notes), 'README no longer asks for copies or mirrored prints');
  ok(/^[\x20-\x7e\n°µ²×·–]*$/.test(notes), 'README stays plain text');
  eq(needsInfoPage(c.layout), notes.includes('The last page of the PDF has the legend and the scale bar.'), 'README mentions the legend page exactly when there is one');
  const one = assemblyNotes(CASES.default.design, CASES.default.pattern, CASES.default.layout);
  ok(one.includes('6 floors,') && !one.includes('last page of the PDF'), 'single stack, info box on the page');
  // at another print scale the README says which files follow it
  const half = setup({ scale: 50 });
  const scaled = assemblyNotes(half.design, half.pattern, half.layout);
  ok(scaled.includes('made for the sheet at 50.0%') && scaled.includes('(design size, not scaled)') && /pattern\.dxf .* at 50\.0%/.test(scaled), 'README: molds and DXF follow the scale, the tube does not');
  ok(half.design.warnings.some((w) => /press molds and the DXF follow the print scale/.test(w)), 'design warning says the same');
});

test('json: designs saved before the rings were split open with both rings at their old length', () => {
  const { ringBottom, ringTop, ...rest } = P({ n: 7 });
  ok(ringBottom === 10 && ringTop === 10, 'new default');
  const r = readDesignFile(JSON.stringify({ app: APP_NAME, version: '1.0.0', params: { ...rest, ext: 32.5 } }));
  ok(r.ok, r.error); eq(r.source, 'studio');
  eq(r.params.ringBottom, 32.5); eq(r.params.ringTop, 32.5); eq(r.params.n, 7);
  eq(r.ignored.length, 0, 'ext is read, not reported as left out');
  ok(!('ext' in r.params), 'not carried on');
  const again = JSON.parse(designFile(r.params)).params;
  ok(!('ext' in again) && again.ringBottom === 32.5 && again.ringTop === 32.5, 'saved again with the two rings');
  const bare = readDesignFile(JSON.stringify({ n: 5, ext: 0 }));
  eq(bare.params.ringBottom, 0); eq(bare.params.ringTop, 0);
  const split = readDesignFile(designFile(P({ ringBottom: 4, ringTop: 44 })));
  eq(split.params.ringBottom, 4); eq(split.params.ringTop, 44);
});

test('pack instructions and the legend follow each end ring', () => {
  const both = setup({ ringBottom: 12, ringTop: 12 }), diff = setup({ ringBottom: 8, ringTop: 30 });
  const onlyB = setup({ ringBottom: 15, ringTop: 0 }), onlyT = setup({ ringBottom: 0, ringTop: 25 }), none = setup({ ringBottom: 0, ringTop: 0 });
  const notes = (c) => assemblyNotes(c.design, c.pattern, c.layout);
  ok(notes(both).includes('where the 12.0 mm end rings meet the body, as mountains.'), notes(both));
  ok(notes(diff).includes('where the end rings (bottom 8.0 mm, top 30.0 mm) meet the body'), 'different rings named');
  ok(notes(diff).includes('with its end rings (bottom 8.0 mm, top 30.0 mm)'), 'tube.stl line');
  ok(notes(onlyB).includes('Fold the red dash-dot line, where the 15.0 mm bottom ring meets the body, as a mountain.'), notes(onlyB));
  ok(notes(onlyB).includes('The plain band at the bottom now closes into a ring.'), 'one ring closes');
  ok(notes(onlyT).includes('25.0 mm top ring') && notes(onlyT).includes('The plain band at the top now closes into a ring.'), 'top only');
  ok(!/end ring|dash-dot|closes into/.test(notes(none)), 'no rings, no ring steps');
  for (const c of [both, diff, onlyB, onlyT]) ok(legendFor(c.pattern).some((e) => e.kind === 'end'), 'legend has the end-ring fold');
  ok(!legendFor(none.pattern).some((e) => e.kind === 'end'), 'no end-ring legend without rings');
});

test('dxf: follows the sheet scale', () => {
  const c = CASES.default;
  const lines = (text) => parseDXF(text).filter((r) => r.type === 'LINE');
  const full = lines(patternDXF(c.design, c.pattern)), half = lines(patternDXF(c.design, c.pattern, { scale: 0.5 }));
  eq(half.length, full.length, 'same lines');
  full.forEach((r, i) => {
    for (const code of [10, 20, 11, 21]) near(Number(gv(half[i], code)), 0.5 * Number(gv(r, code)), 1e-6, `group ${code} of line ${i}`);
    eq(gv(half[i], 8), gv(r, 8), 'same layer');
  });
  const maxX = (list) => Math.max(...list.flatMap((r) => [Number(gv(r, 10)), Number(gv(r, 11))]));
  near(maxX(half), 0.5 * c.pattern.width, 1e-6, 'half-size sheet');
  for (const bad of [NaN, 0, -1, undefined]) eq(patternDXF(c.design, c.pattern, { scale: bad }), patternDXF(c.design, c.pattern), `scale ${bad} falls back to 100%`);
  eq(patternDXF(c.design, c.pattern, { scale: 1 }), patternDXF(c.design, c.pattern));
  // header extents and limits match the drawing at every scale
  for (const k of [0.5, 1, 1.6]) {
    const recs = parseDXF(patternDXF(c.design, c.pattern, { scale: k }));
    const hdr = recs.find((r) => r.type === 'SECTION' && gv(r, 2) === 'HEADER');
    const at = (name) => { const i = hdr.g.findIndex(([code, v]) => code === 9 && v === name); return [Number(hdr.g[i + 1][1]), Number(hdr.g[i + 2][1])]; };
    const ents = recs.filter((r) => r.type === 'LINE');
    const maxOf = (codes) => Math.max(...ents.flatMap((r) => codes.map((cd) => Number(gv(r, cd)))));
    for (const name of ['$EXTMAX', '$LIMMAX']) {
      const [x, y] = at(name);
      near(x, c.pattern.width * k, 1e-6, `${name} x at ${k}`); near(y, c.pattern.height * k, 1e-6, `${name} y at ${k}`);
    }
    near(maxOf([10, 11]), c.pattern.width * k, 1e-6, `drawing width at ${k}`); near(maxOf([20, 21]), c.pattern.height * k, 1e-6, `drawing height at ${k}`);
  }
});

test('printed note: print at 100%, the drawing carries the scale, the bar length is a clean number', () => {
  for (let pct = 10; pct <= 200; pct++) {
    const c = setup({ scale: pct });
    const note = infoLines(c.design, c.pattern, c.layout).find((l) => /The bar should measure/.test(l.text)).text;
    ok(note.startsWith('Print at 100% (actual size), no "fit to page".'), note);
    ok(!/\d\.\d{3,}/.test(note), `no long decimals at ${pct}%: ${note}`);
    ok(note.includes(`measure ${(pct / 2).toFixed(1)} mm`), `bar ${pct / 2} mm at ${pct}%: ${note}`);
    eq(note.includes(`drawn at ${pct.toFixed(1)}%`), pct !== 100, `scale named at ${pct}%`);
  }
  const big = setup({ scale: 160 });
  const readme = assemblyNotes(big.design, big.pattern, big.layout);
  ok(readme.includes('Print at 100% (actual size), no "fit to page": the files are already drawn at 160.0%.'), readme);
  ok(!/Print at 160/.test(readme), 'never asks the printer for 160%');
});

test('pack README names the SVG files the pack holds', () => {
  for (const [label, over] of [['fits', {}], ['crowded', { floors: 8, ext: 30 }], ['tiled', { scale: 160 }], ['tiled tall', { floors: 14, ringTop: 40 }]]) {
    const c = setup(over);
    const names = svgNames(c.layout, 'pattern');
    const readme = assemblyNotes(c.design, c.pattern, c.layout);
    const row = readme.split('\n').find((l) => l.includes('pattern.pdf'));
    eq(names.includes('pattern_legend.svg'), needsInfoPage(c.layout), `${label}: a legend SVG exactly when the sheet has no room for it`);
    if (c.layout.fits) {
      eq(names[0], 'pattern.svg', label);
      ok(row.includes(`pattern.pdf, ${names.join(', ')}`), `${label}: ${row}`);
    } else {
      const n = c.layout.tiles.length;
      eq(names.length, n + 1, `${label}: one SVG per page plus the legend`);
      eq(names[0], 'pattern_page1.svg'); eq(names[n - 1], `pattern_page${n}.svg`);
      ok(!readme.includes('pattern.svg'), `${label}: no pattern.svg in a tiled pack`);
      ok(row.includes(`pattern_page1.svg ... pattern_page${n}.svg, pattern_legend.svg`), `${label}: ${row}`);
    }
  }
  eq(needsInfoPage(setup({ floors: 8, ext: 30 }).layout) && setup({ floors: 8, ext: 30 }).layout.fits, true, 'the crowded case fits with no room');
});

// ── PNG ──────────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}

test('png: pHYs chunk carries the dpi, browser-only export rejects in Node', async () => {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 1);
  new DataView(ihdr.buffer).setUint32(4, 1);
  ihdr[8] = 8;
  const oldPhys = new Uint8Array(9); oldPhys[3] = 1; oldPhys[7] = 1;
  const png = concatBytes([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk('IHDR', ihdr), pngChunk('pHYs', oldPhys),
    pngChunk('IDAT', new Uint8Array(deflateSync(Uint8Array.of(0, 255)))), pngChunk('IEND', new Uint8Array(0))]);
  const out = pngSetDpi(png, 300);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const types = [];
  for (let off = 8; off < out.length;) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...out.subarray(off + 4, off + 8));
    eq(dv.getUint32(off + 8 + len), crc32(out.subarray(off + 4, off + 8 + len)), `${type} CRC`);
    if (type === 'pHYs') {
      eq(dv.getUint32(off + 8), Math.round(300 / 0.0254), 'pixels per metre x');
      eq(dv.getUint32(off + 12), Math.round(300 / 0.0254), 'pixels per metre y');
      eq(out[off + 16], 1, 'unit metre');
    }
    types.push(type);
    off += 12 + len;
  }
  eq(types.join(','), 'IHDR,pHYs,IDAT,IEND', 'one pHYs right after IHDR');
  ok(pngSetDpi(Uint8Array.of(1, 2, 3), 300).length === 3, 'non-PNG input unchanged');
  const c = CASES.default;
  const err = await patternPNG(c.design, c.pattern, c.layout).then(() => null, (e) => e);
  ok(err instanceof Error && /browser/.test(err.message), `rejects outside a browser: ${err && err.message}`);
});

// ── robustness across presets and options ────────────────────────────────
test('every preset exports valid SVG, PDF and DXF (fit, tiled, mirrored, custom seam strips)', () => {
  for (const [key, pr] of Object.entries(PRESETS)) {
    for (const extra of [{}, { page: 'A4', scale: 180 }, { chir: -1, stacking: 'helical' }, { seamAuto: false, seamL: 6, seamR: 9, ext: 0, margin: 2 }]) {
      const c = setup({ ...pr.params, ...extra });
      ok(c.design.valid, `${key} valid`);
      const label = `${key} ${JSON.stringify(extra)}`;
      parseXML(patternSVG(c.design, c.pattern, c.layout));
      for (const tile of c.layout.tiles) parseXML(patternSVG(c.design, c.pattern, c.layout, { tile }));
      const pdf = parsePDF(patternPDF(c.design, c.pattern, c.layout));
      eq(pdf.count, (c.layout.fits ? 1 : c.layout.tiles.length) + (needsInfoPage(c.layout) ? 1 : 0), `${label} pages`);
      if (needsInfoPage(c.layout)) parseXML(sceneSVG(infoScene(c.design, c.pattern, c.layout)));
      const recs = parseDXF(patternDXF(c.design, c.pattern, { scale: c.layout.scale }));
      eq(recs.filter((r) => r.type === 'LINE').length, c.pattern.segments.length, `${label} DXF lines`);
    }
  }
});

await run();
