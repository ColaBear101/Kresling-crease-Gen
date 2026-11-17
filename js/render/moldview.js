// Press-mold view (mounted into #pane-mold): 3-D preview of the embossing plates.
//
//   mountMoldView(container, app) -> { update(change), resize(), setActive(active) }
//   moldScene(layout, which, pattern) -> { pos (Float64Array xyz), normals (per triangle),
//     tris (Uint32Array), solids: [{ role, tri0, triN, v0, v1 }], groups, sheet,
//     center, radius, stats }      which: 'mountain' | 'valley' | 'both'
//
// Plates are the meshes the STL export writes (moldMesh in js/export/stl.js, from
// moldLayout(store.pattern(), params)): a slab plus one closed trapezoid prism per
// ridge, ridges up, the valley layout mirrored for printing. 'mountain' and
// 'valley' show one plate as printed. 'both' shows the press stack exploded along
// z: the mountain plate at the bottom (ridges up), the sheet (printed side up) as a
// translucent white polygon with its creases, and the valley plate on top, flipped
// ridges-down so its ridges sit over the valley creases.
//
// Drawing order is exact for this scene: layers are separated by horizontal
// planes, so they are drawn by decreasing height distance from the eye; inside a
// plate the slab goes first when the eye is on its ridge side (then the ridges,
// depth-sorted), otherwise last. Prisms are convex, so their visible faces never
// overlap. Projections are cached per camera version and viewport.

import { el, fmt, clamp, fitCanvas } from '../app/util.js';
import { cssVar, onThemeChange, PRINT } from '../ui/theme.js';
import { moldLayout, moldNotes } from '../core/mold.js';
import { moldMesh } from '../export/stl.js';
import { OrbitCamera, bindOrbitControls, keyLight, parseColor, mixRGB, rgbCss, DEG } from './camera.js';

const SHADES = 48;
const AMBIENT = 0.55;
const SHEET_ALPHA = 0.62;
const CREASE_DASH = [4, 3];                // px, valley creases on the sheet
const MOLD_TABS = [['mountain', 'Mountain plate'], ['valley', 'Valley plate'], ['both', 'Both']];
const NOTES = {
  mountain: 'Mountain plate: ridges up under the sheet (printed side up); lay a soft backing on top and press.',
  valley: 'Valley plate is printed mirrored: flip it ridges-down onto the printed side, sheet on a soft backing, and press.',
  both: 'Press each plate onto the sheet over a soft backing: mountain plate ridges up underneath; the valley plate is mirrored, flip it ridges-down onto the printed side.',
};
const LAYER_LABELS = { mountain: 'Mountain plate, ridges up', sheet: 'Sheet, printed side up', valley: 'Valley plate, flipped ridges down' };

const svg = (body) => `<svg class="v3d-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON_RESET = svg('<path d="M3.4 8.6A4.7 4.7 0 1 0 5.2 4.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  + '<path d="M4.9 1.8v2.9h2.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>');

const segLength = (s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);

/** Geometry of the preview for one tab (throws like moldMesh on a missing layout). */
export function moldScene(layout, which = 'both', pattern = null) {
  const tab = which === 'mountain' || which === 'valley' ? which : 'both';
  const { w, h, base, ridgeH } = layout;
  const gap = clamp(0.14 * Math.max(w, h), 8, 60);          // exploded spacing
  const zSheet = base + ridgeH + gap;
  const zValley = zSheet + gap + ridgeH;                     // underside of the flipped valley slab
  const plates = tab === 'both' ? ['mountain', 'valley'] : [tab];

  const pos = [], tris = [], solids = [], groups = [];
  for (const kind of plates) {
    const mm = moldMesh(layout, kind);
    const flip = tab === 'both' && kind === 'valley';
    const vBase = pos.length / 3, tBase = tris.length / 3;
    const P = mm.positions;
    for (let i = 0; i < P.length; i += 3) {
      // flipping = 180 deg turn about a y-parallel axis: undoes the print mirror in x
      if (flip) pos.push(w - P[i], P[i + 1], zValley + base - P[i + 2]);
      else pos.push(P[i], P[i + 1], P[i + 2]);
    }
    for (let i = 0; i < mm.triangles.length; i++) tris.push(mm.triangles[i] + vBase);
    const group = {
      kind: 'plate', role: kind, slab: -1, ridges: [],
      faceZ: flip ? zValley : base,                          // slab face that carries the ridges
      side: flip ? -1 : 1,                                   // ridges above (+1) or below (-1) it
      zMid: flip ? zValley + (base - ridgeH) / 2 : (base + ridgeH) / 2,
      anchorZ: flip ? zValley + base / 2 : base / 2,
    };
    mm.shells.forEach((sh, k) => {
      let v0 = Infinity, v1 = -Infinity;
      for (let t = 3 * (sh.start + tBase); t < 3 * (sh.start + tBase + sh.count); t++) {
        v0 = Math.min(v0, tris[t]); v1 = Math.max(v1, tris[t]);
      }
      // slab first, then the crease ridges (coloured by plate), then the border ridges
      const role = k === 0 ? 'slab' : sh.role === 'border' ? 'border' : kind;
      const s = { role, tri0: sh.start + tBase, triN: sh.count, v0, v1 };
      if (k === 0) group.slab = solids.length; else group.ridges.push(solids.length);
      solids.push(s);
    });
    groups.push(group);
  }

  let sheet = null;
  if (tab === 'both') {
    // the sheet as printed: pattern mm -> plate mm (print scale, then the plate margin)
    const m = layout.margin, k = Number.isFinite(layout.scale) && layout.scale > 0 ? layout.scale : 1;
    const at = ([x, y]) => [x * k + m, y * k + m];
    const outline = layout.outline.map(([x, y]) => [x, y]);
    const creases = pattern ? pattern.segments.filter((s) => s.kind !== 'cut')
      .map((s) => ({ a: at(s.a), b: at(s.b), kind: s.kind, tab: !!s.tab })) : [];
    sheet = { z: zSheet, outline, creases, start: pos.length / 3 };
    for (const [x, y] of outline) pos.push(x, y, zSheet);
    for (const c of creases) pos.push(c.a[0], c.a[1], zSheet, c.b[0], c.b[1], zSheet);
    groups.push({ kind: 'sheet', role: 'sheet', zMid: zSheet, anchorZ: zSheet });
  }

  const posArr = Float64Array.from(pos);
  const triArr = Uint32Array.from(tris);
  const normals = new Float64Array(triArr.length);
  for (let t = 0; t < triArr.length; t += 3) {
    const a = 3 * triArr[t], b = 3 * triArr[t + 1], c = 3 * triArr[t + 2];
    const ux = posArr[b] - posArr[a], uy = posArr[b + 1] - posArr[a + 1], uz = posArr[b + 2] - posArr[a + 2];
    const vx = posArr[c] - posArr[a], vy = posArr[c + 1] - posArr[a + 1], vz = posArr[c + 2] - posArr[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[t] = nx / l; normals[t + 1] = ny / l; normals[t + 2] = nz / l;
  }
  const zTop = tab === 'both' ? zValley + base : base + ridgeH;
  const lenOf = (list) => list.reduce((s, r) => s + segLength(r), 0);
  return {
    tab, w, h, pos: posArr, tris: triArr, normals, solids, groups, sheet,
    center: [w / 2, h / 2, zTop / 2],
    radius: 0.5 * Math.hypot(w, h, zTop),
    stats: {
      mountain: { count: layout.mountain.length, length: lenOf(layout.mountain) },
      valley: { count: layout.valley.length, length: lenOf(layout.valley) },
    },
  };
}

export function mountMoldView(container, app) {
  const store = app.store;

  // ── DOM ──
  const tabBtns = MOLD_TABS.map(([key, label]) => el('button', {
    type: 'button', 'aria-pressed': 'false', 'data-tab': key,
    onclick: () => { store.setView({ moldTab: key }); syncControls(); schedule(); },
  }, label));
  const readSize = el('span', { class: 'num v3d-read-v' }, '–');
  const readCount = el('span', { class: 'num v3d-read-v' }, '–');
  const readLen = el('span', { class: 'num v3d-read-v' }, '–');
  const sizeRead = el('span', { class: 'v3d-read' }, el('span', { class: 'v3d-read-k' }, 'Plate'), readSize);
  const resetBtn = el('button', {
    type: 'button', class: 'icon-btn v3d-reset', 'aria-label': 'Reset view', title: 'Reset view (double-click the view)',
    html: ICON_RESET, onclick: () => { cam.reset(); schedule(); },
  });
  const usage = el('p', { class: 'v3d-usage' });
  const head = el('div', { class: 'v3d-head' },
    el('div', { class: 'v3d-titlebar' },
      el('h2', { class: 'v3d-title' }, 'Press molds'),
      el('div', { class: 'v3d-readouts' },
        sizeRead,
        el('span', { class: 'v3d-read', title: 'Ridges on the plate(s) shown' }, el('span', { class: 'v3d-read-k' }, 'Ridges'), readCount),
        el('span', { class: 'v3d-read', title: 'Total ridge length on the plate(s) shown' }, el('span', { class: 'v3d-read-k' }, 'Ridge length'), readLen))),
    el('div', { class: 'v3d-toolbar' },
      el('div', { class: 'seg v3d-seg', role: 'group', 'aria-label': 'Plate' }, tabBtns),
      resetBtn),
    usage);
  const canvas = el('canvas', {
    class: 'v3d-canvas', tabindex: 0, role: 'img',
    'aria-label': 'Press-mold plates in 3-D. Drag or use the arrow keys to orbit, scroll or press + and - to zoom, double-click or press 0 to reset.',
  });
  const hint = el('p', { class: 'v3d-hint', 'aria-hidden': 'true' }, 'Drag to orbit · Shift-drag to pan · Scroll to zoom · Double-click to reset');
  const empty = el('div', { class: 'empty-state v3d-empty', role: 'status', hidden: true });
  const stage = el('div', { class: 'v3d-stage' }, canvas, hint, empty);
  const root = el('div', { class: 'v3d v3d-mold' }, head, stage);
  container.append(root);

  // ── state ──
  const cam = new OrbitCamera({ yaw: -118 * DEG, pitch: 38 * DEG, fov: 28 * DEG, minPitch: -85 * DEG, maxPitch: 89 * DEG });
  let active = true;
  let raf = 0;
  let scene = null;
  let sceneKey = null;      // { params, tab } the scene was built for
  let message = null;       // why there is no scene
  let notes = [];           // moldNotes() of the current layout
  let proj = null;
  let colors = null;

  bindOrbitControls(canvas, cam, { onChange: schedule });

  function schedule() {
    if (!raf && active) raf = requestAnimationFrame(() => { raf = 0; if (active) render(); });
  }

  const currentTab = () => {
    const t = store.view.moldTab;
    return t === 'mountain' || t === 'valley' ? t : 'both';
  };

  function syncControls() {
    const tab = currentTab();
    for (const b of tabBtns) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    // how to use the plate(s), then what differs from the controls (print scale, clamped ridges)
    usage.replaceChildren(NOTES[tab], ...(notes.length ? [' ', el('strong', {}, notes.join(' '))] : []));
  }

  // ── scene (rebuilt when params or the tab change) ──
  function ensureScene() {
    const params = store.params, tab = currentTab();
    if (sceneKey && sceneKey.params === params && sceneKey.tab === tab) return;
    sceneKey = { params, tab };
    scene = null;
    proj = null;
    message = null;
    notes = [];
    let layout = null;
    const design = store.design();
    const pattern = store.pattern();
    if (!design.valid || !pattern) {
      message = (design.errors && design.errors[0]) || 'This design has no crease pattern to emboss.';
    } else {
      try {
        layout = moldLayout(pattern, params);
        scene = moldScene(layout, tab, pattern);
        notes = moldNotes(layout);
      } catch (e) {
        message = (e && e.message) || 'The mold plates could not be built for this design.';
      }
    }
    empty.hidden = !message;
    empty.textContent = message || '';
    hint.hidden = !!message;
    syncControls();
    if (!scene) {
      readSize.textContent = '–'; readCount.textContent = '–'; readLen.textContent = '–';
      return;
    }
    cam.fit(scene.center, scene.radius);
    const st = scene.stats;
    readSize.textContent = `${fmt(scene.w, 1)} × ${fmt(scene.h, 1)} mm`;
    sizeRead.title = `Plate ${fmt(params.moldBase, 1)} mm thick, ridges ${fmt(params.ridgeH, 1)} mm high and ${fmt(layout.ridgeW, 2)} mm wide, `
      + `border ${fmt(layout.borderH, 1)} mm high along the sheet outline`;
    const count = tab === 'both' ? st.mountain.count + st.valley.count : st[tab].count;
    readCount.textContent = tab === 'both' ? `${count} (${st.mountain.count} M + ${st.valley.count} V)` : String(count);
    readLen.textContent = fmt(tab === 'both' ? st.mountain.length + st.valley.length : st[tab].length, 0, 'mm');
  }

  function themeColors() {
    if (colors) return colors;
    const sheet = parseColor(cssVar('--sheet'), parseColor(PRINT.paper));
    const ink3 = parseColor(cssVar('--ink-3'), parseColor(PRINT.textMuted));
    const bases = {
      slab: mixRGB(sheet, ink3, 0.42),                       // printed plastic, same in both themes
      border: mixRGB(sheet, ink3, 0.68),                     // registration border: darker plastic
      mountain: parseColor(cssVar('--mountain'), parseColor(PRINT.mountain)),
      valley: parseColor(cssVar('--valley'), parseColor(PRINT.valley)),
    };
    const fills = {}, lines = {};
    for (const [role, rgb] of Object.entries(bases)) {
      fills[role] = Array.from({ length: SHADES }, (_, i) => rgbCss(rgb, AMBIENT + (1 - AMBIENT) * (i / (SHADES - 1))));
      lines[role] = rgbCss(rgb, 0.55, 0.9);
    }
    colors = {
      fills, lines,
      paper: rgbCss(parseColor(PRINT.paper), 1, SHEET_ALPHA),
      label: cssVar('--ink-2') || PRINT.textMuted,
      font: cssVar('--font-ui') || 'sans-serif',
    };
    return colors;
  }

  // ── projection: painter-ordered draw list, cached per camera version ──
  function ensureProjection() {
    const C = themeColors();
    if (proj && proj.scene === scene && proj.cam === cam.version && proj.colors === C) return;
    const S = scene, F = cam.frame(), E = F.eye, L = keyLight(F);
    const P = proj && proj.scene === S ? proj.P : new Float64Array(S.pos.length);
    cam.projectAll(S.pos, P);
    const depth = new Float64Array(S.solids.length);
    S.solids.forEach((s, i) => {
      let d = 0;
      for (let v = s.v0; v <= s.v1; v++) d += P[3 * v + 2];
      depth[i] = d / (s.v1 - s.v0 + 1);
    });

    const ops = [];
    const pushSolid = (si) => {
      const s = S.solids[si];
      let op = null, nx0 = 0, ny0 = 0, nz0 = 0;
      for (let t = s.tri0; t < s.tri0 + s.triN; t++) {
        const nx = S.normals[3 * t], ny = S.normals[3 * t + 1], nz = S.normals[3 * t + 2];
        const a = 3 * S.tris[3 * t];
        if (nx * (E[0] - S.pos[a]) + ny * (E[1] - S.pos[a + 1]) + nz * (E[2] - S.pos[a + 2]) <= 0) continue;
        if (op && nx * nx0 + ny * ny0 + nz * nz0 > 0.99999) { op.tris.push(t); continue; }   // other half of a quad
        const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        op = { tris: [t], fill: C.fills[s.role][Math.round(lam * (SHADES - 1))], line: s.role === 'slab' ? C.lines.slab : null };
        nx0 = nx; ny0 = ny; nz0 = nz;
        ops.push(op);
      }
    };
    const eyeZ = E[2];
    const groups = S.groups.slice().sort((a, b) => Math.abs(eyeZ - b.zMid) - Math.abs(eyeZ - a.zMid));
    for (const g of groups) {
      if (g.kind === 'sheet') { ops.push({ sheet: true }); continue; }
      const ridges = g.ridges.slice().sort((a, b) => depth[b] - depth[a]);
      if ((eyeZ - g.faceZ) * g.side > 0) { pushSolid(g.slab); ridges.forEach(pushSolid); }
      else { ridges.forEach(pushSolid); pushSolid(g.slab); }
    }

    // layer labels for the exploded stack, beside the right-most corner of each layer
    const labels = [];
    if (S.tab === 'both') {
      for (const g of S.groups) {
        let best = null;
        for (const [x, y] of [[0, 0], [S.w, 0], [S.w, S.h], [0, S.h]]) {
          const p = cam.project([x, y, g.anchorZ]);
          if (!best || p[0] > best[0]) best = p;
        }
        labels.push({ text: LAYER_LABELS[g.role], x: best[0] + 10, y: best[1] });
      }
    }
    proj = { scene: S, cam: cam.version, colors: C, P, ops, labels };
  }

  function render() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    const { ctx, w, h } = fitCanvas(canvas);
    cam.setViewport(w, h);
    ensureScene();
    ctx.clearRect(0, 0, w, h);
    if (!scene) return;
    ensureProjection();
    draw(ctx, w);
  }

  function draw(ctx, w) {
    const S = scene, { P, ops } = proj, C = colors;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    for (const op of ops) {
      if (op.sheet) { drawSheet(ctx); continue; }
      ctx.beginPath();
      for (const t of op.tris) {
        const a = 3 * S.tris[3 * t], b = 3 * S.tris[3 * t + 1], c = 3 * S.tris[3 * t + 2];
        ctx.moveTo(P[a], P[a + 1]);
        ctx.lineTo(P[b], P[b + 1]);
        ctx.lineTo(P[c], P[c + 1]);
        ctx.closePath();
      }
      ctx.fillStyle = op.fill;
      ctx.fill();
      if (op.line) strokeBoundary(ctx, op.tris, op.line);
    }
    if (proj.labels.length) {
      ctx.font = `11px ${C.font}`;
      ctx.fillStyle = C.label;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (const lb of proj.labels) if (lb.x + ctx.measureText(lb.text).width <= w - 4) ctx.fillText(lb.text, lb.x, lb.y);
    }
  }

  // Outline of a face made of triangles: edges used by exactly one of them.
  function strokeBoundary(ctx, triList, color) {
    const S = scene, P = proj.P;
    const seen = new Map();
    for (const t of triList) {
      for (let j = 0; j < 3; j++) {
        const a = S.tris[3 * t + j], b = S.tris[3 * t + (j + 1) % 3];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        seen.set(k, seen.has(k) ? null : [a, b]);
      }
    }
    ctx.beginPath();
    for (const ab of seen.values()) {
      if (!ab) continue;
      ctx.moveTo(P[3 * ab[0]], P[3 * ab[0] + 1]);
      ctx.lineTo(P[3 * ab[1]], P[3 * ab[1] + 1]);
    }
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // The paper between the plates: on-paper colours (PRINT/DASH style) in both themes.
  function drawSheet(ctx) {
    const sh = scene.sheet, P = proj.P, C = colors;
    if (!sh) return;
    const at = (v) => 3 * (sh.start + v);
    const nO = sh.outline.length;
    ctx.beginPath();
    for (let v = 0; v < nO; v++) {
      const q = at(v);
      if (v === 0) ctx.moveTo(P[q], P[q + 1]); else ctx.lineTo(P[q], P[q + 1]);
    }
    ctx.closePath();
    ctx.fillStyle = C.paper;
    ctx.fill();
    ctx.save();
    ctx.lineWidth = 1;
    for (const [kind, color, dash] of [['mountain', PRINT.mountain, []], ['valley', PRINT.valley, CREASE_DASH]]) {
      for (const tab of [false, true]) {
        ctx.beginPath();
        sh.creases.forEach((c, i) => {
          if (c.kind !== kind || c.tab !== tab) return;
          const a = at(nO + 2 * i), b = at(nO + 2 * i + 1);
          ctx.moveTo(P[a], P[a + 1]);
          ctx.lineTo(P[b], P[b + 1]);
        });
        ctx.globalAlpha = tab ? 0.4 : 0.7;
        ctx.strokeStyle = color;
        ctx.setLineDash(dash);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = PRINT.cut;
    ctx.beginPath();
    for (let v = 0; v < nO; v++) {
      const q = at(v);
      if (v === 0) ctx.moveTo(P[q], P[q + 1]); else ctx.lineTo(P[q], P[q + 1]);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // ── wiring ──
  onThemeChange(() => { colors = null; schedule(); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => schedule()).observe(stage);
  syncControls();
  schedule();

  return {
    update(change = {}) {
      if (change.kind === 'theme') colors = null;
      if (change.kind === 'view') {
        const keys = Array.isArray(change.keys) ? change.keys : ['*'];
        if (!keys.includes('*') && !keys.includes('moldTab')) return;   // other view keys do not affect molds
      }
      syncControls();
      schedule();
    },
    resize() { schedule(); },
    setActive(on) {
      active = !!on;
      if (!active) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        return;
      }
      syncControls();
      schedule();
    },
  };
}
