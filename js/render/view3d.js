// 3-D view of the folded tube (mounted into #pane-3d).
//
//   mountView3d(container, app) -> { update(change), resize(), setActive(active) }
//   tubeViewMesh(design, compress, mode, phiOfH) -> flat-array mesh of one pose:
//     { n, N, nV, nF, nE, pos (Float64Array xyz), faces (Uint32Array, CCW from outside),
//       normals (unit, outward), edges (Uint32Array pairs), edgeKind (0 mountain,
//       1 valley, 2 cut edge: the open ends, or the rims of the end rings),
//       faceEdges, edgeFaces, edgeNeed (faces per edge), faceRing (0 body, 1 bottom
//       ring, 2 top ring), facePair (other triangle of a flat ring panel, or -1),
//       height (mm, folding part: ring N above ring 0), endRings { bottom, top } (mm), zMin, zMax,
//       endRotation (rad, top ring vs bottom ring, sense of design.twist), Hs, phis }
//   The end rings of the printed sheet (params.ringBottom, ringTop) stand on the end polygons
//   (see buildTube); the ground sits under the bottom ring.
//
// Rendering (canvas 2-D): faces are painter-sorted far to near (end rings by their
// end planes, see paintOrder; each flat ring panel filled in one path) and flat-shaded
// with Lambert ambient + key light (the light is fixed to the camera, so
// orbiting reads like a turntable). Outside faces take the paper tone of
// --sheet; faces seen from inside are darker. Each crease is stroked right after
// the nearer of its faces is filled, so paper in front hides it; its alpha fades
// with depth. Meshes are rebuilt only when the design, compress, fold mode or
// twist path change; projections only when the camera, viewport, mesh or theme
// change.
//
// In-between poses use the relaxed twist phiAtHeightFn(design) from
// js/physics/analysis.js, computed 120 ms after the design settles; until then,
// or when it is unavailable, the twist is interpolated linearly (foldStates).

import { el, fmt, clamp, debounce, fitCanvas } from '../app/util.js';
import { cssVar, onThemeChange, PRINT } from '../ui/theme.js';
import { buildTube, foldStates, ringHeights } from '../core/tube.js';
import * as analysis from '../physics/analysis.js';
import { OrbitCamera, bindOrbitControls, keyLight, parseColor, rgbCss, DEG } from './camera.js';

const HALF_CYCLE_MS = 3000;          // fold animation: 0 -> 1 in 3 s, back in 3 s
const SPIN_RATE = 18 * DEG;          // auto-rotate, rad/s
const SPIN_STEP = 30 * DEG;          // reduced motion: auto-rotate in steps ...
const SPIN_STEP_MS = 2500;           // ... one every 2.5 s
const PHI_DELAY_MS = 120;
const SHADES = 64;                   // quantised Lambert levels (cached fill strings)
const ALPHA_LEVELS = 12;             // quantised crease alpha levels
const AMBIENT = 0.58;
const INSIDE = 0.64;                 // inside paper, relative to outside
const VALLEY_DASH = [5, 3.5];        // px
const NO_DASH = [];
const RAIL_AT = 1.5;                 // height rail distance from the axis, in R
const FRAME_R = 1.65;                // horizontal radius framed by the camera, in R
const GROUND = [1.55, 1.3, 1.08];    // soft ground ellipse: ring radii in R
const GROUND_SEG = 48;
const FOLD_MODES = [['uniform', 'Uniform'], ['sequential', 'One floor at a time']];

const svg = (body) => `<svg class="v3d-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON_PLAY = svg('<path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/>');
const ICON_PAUSE = svg('<path d="M4.4 3h2.6v10H4.4zM9 3h2.6v10H9z" fill="currentColor"/>');
const ICON_RESET = svg('<path d="M3.4 8.6A4.7 4.7 0 1 0 5.2 4.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  + '<path d="M4.9 1.8v2.9h2.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>');
const ICON_SPIN = svg('<path d="M13.2 7.2A5.3 5.3 0 1 0 12 11.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  + '<path d="M13.6 3.9v3.6H10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>');

/** Flat-array mesh of the tube at fold progress `compress` (0 deployed .. 1 folded). */
export function tubeViewMesh(design, compress = 0, mode = 'uniform', phiOfH = null) {
  const plain = foldStates(design, compress, mode, null);
  const Hs = plain.Hs;
  let phis = plain.phis;
  if (typeof phiOfH === 'function') {
    try {
      const relaxed = foldStates(design, compress, mode, phiOfH);
      phis = relaxed.phis.map((x, k) => (Number.isFinite(x) ? x : plain.phis[k]));
    } catch { /* keep the linear twist */ }
  }
  const tube = buildTube(design, Hs, phis, { endRings: endRingsOf(design) });
  const { n, N } = tube;
  const nV = tube.rings.length * n;
  const pos = new Float64Array(3 * nV);
  for (let k = 0; k < tube.rings.length; k++) {
    for (let i = 0; i < n; i++) {
      const p = tube.rings[k][i], q = 3 * (k * n + i);
      pos[q] = p[0]; pos[q + 1] = p[1]; pos[q + 2] = p[2];
    }
  }
  const vid = (v) => v[0] * n + v[1];

  const nF = tube.faces.length;
  const faces = new Uint32Array(3 * nF);
  const normals = new Float64Array(3 * nF);
  for (let f = 0; f < nF; f++) {
    const [A, B, C] = tube.faces[f].v.map(vid);
    faces[3 * f] = A; faces[3 * f + 1] = B; faces[3 * f + 2] = C;
    const a = 3 * A, b = 3 * B, c = 3 * C;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-12) { normals[3 * f] = nx / l; normals[3 * f + 1] = ny / l; normals[3 * f + 2] = nz / l; }
  }
  // end rings: which ring a face belongs to (0 body, 1 bottom, 2 top) and the other
  // triangle of its flat panel (filled together, so no seam shows along the diagonal)
  const faceRing = new Uint8Array(nF);
  const facePair = new Int32Array(nF).fill(-1);
  const panelFirst = new Map();
  for (let f = 0; f < nF; f++) {
    const T = tube.faces[f];
    if (T.floor === -1) faceRing[f] = 1;
    else if (T.floor === N) faceRing[f] = 2;
    if (T.panel === undefined) continue;
    const g = panelFirst.get(T.panel);
    if (g === undefined) panelFirst.set(T.panel, f);
    else { facePair[f] = g; facePair[g] = f; }
  }

  const nE = tube.edges.length;
  const edges = new Uint32Array(2 * nE);
  const edgeKind = new Uint8Array(nE);
  const byPair = new Map();
  for (let e = 0; e < nE; e++) {
    const E = tube.edges[e];
    const a = vid(E.a), b = vid(E.b);
    edges[2 * e] = a; edges[2 * e + 1] = b;
    edgeKind[e] = E.kind === 'cut' ? 2 : E.kind === 'valley' ? 1 : 0;
    byPair.set(a < b ? a * nV + b : b * nV + a, e);
  }
  const faceEdges = new Int32Array(3 * nF).fill(-1);
  const edgeFaces = new Int32Array(2 * nE).fill(-1);
  const edgeNeed = new Uint8Array(nE);
  for (let f = 0; f < nF; f++) {
    for (let j = 0; j < 3; j++) {
      const a = faces[3 * f + j], b = faces[3 * f + (j + 1) % 3];
      const e = byPair.get(a < b ? a * nV + b : b * nV + a);
      if (e === undefined) continue;
      faceEdges[3 * f + j] = e;
      if (edgeNeed[e] < 2) edgeFaces[2 * e + edgeNeed[e]] = f;
      edgeNeed[e]++;
    }
  }

  const alt = design.stacking !== 'helical';
  let endRotation = 0;
  for (let k = 0; k < N; k++) endRotation += (alt && k % 2 === 1 ? -1 : 1) * phis[k];
  return {
    n, N, nV, nF, nE, pos, faces, normals, edges, edgeKind, faceEdges, edgeFaces, edgeNeed, faceRing, facePair,
    height: tube.height, endRings: tube.endRings, zMin: tube.zMin, zMax: tube.zMax, endRotation, Hs, phis,
  };
}

/**
 * Painter order: far to near by centroid depth, except that the end planes
 * z = 0 and z = height separate the end rings from the body. A ring on the far
 * side of its plane (seen from the eye) is drawn before the body, one on the
 * near side after it; inside a ring (a convex open prism) the faces seen from
 * inside go first. Both triangles of a ring panel sort as one, at its mean depth.
 *   depth: per-face sum of projected depths (larger = farther); front: 1 when the
 *   outside of the face is toward the eye; eyeZ: eye height. Returns face indices.
 */
export function paintOrder(mesh, depth, front, eyeZ) {
  const nF = mesh.nF;
  const key = Float64Array.from(depth);
  const pass = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) {
    const g = mesh.facePair ? mesh.facePair[f] : -1;
    if (g >= 0) key[f] = (depth[f] + depth[g]) / 2;
    const ring = mesh.faceRing ? mesh.faceRing[f] : 0;
    if (!ring) { pass[f] = 2; continue; }
    const far = ring === 1 ? eyeZ > 0 : eyeZ < mesh.height;
    pass[f] = (far ? 0 : 3) + (front[f] ? 1 : 0);
  }
  return Array.from({ length: nF }, (_, i) => i).sort((p, q) => pass[p] - pass[q] || key[q] - key[p]);
}

/** Heights { bottom, top } (mm) of the end rings on the printed sheet, drawn on the tube too; 0 = none. */
function endRingsOf(design) {
  const p = design && design.params ? design.params : {};
  return ringHeights({ bottom: p.ringBottom, top: p.ringTop });
}

/** Relaxed-twist function for in-between poses, or null (missing, invalid or failing). */
function relaxedTwist(design) {
  const make = analysis.phiAtHeightFn;
  if (typeof make !== 'function' || !design.valid) return null;
  try {
    const fn = make(design);
    if (typeof fn !== 'function') return null;
    const H0 = design.states.deployed.H;
    const fol = design.states.folded;
    const H1 = fol && fol.ok ? fol.H : 0.4 * H0;
    for (const H of [H0, (H0 + H1) / 2, H1]) if (!Number.isFinite(fn(H))) return null;
    return fn;
  } catch {
    return null;
  }
}

function reducedMotion() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

const UNIT_CIRCLE = Array.from({ length: GROUND_SEG }, (_, i) => [Math.cos((i / GROUND_SEG) * 2 * Math.PI), Math.sin((i / GROUND_SEG) * 2 * Math.PI)]);

export function mountView3d(container, app) {
  const store = app.store;

  // ── DOM ──
  const slider = el('input', {
    type: 'range', min: 0, max: 100, step: 1, value: 0, class: 'v3d-range',
    'aria-label': 'Compression: 0% deployed, 100% folded',
  });
  const sliderOut = el('output', { class: 'num v3d-range-val', 'aria-hidden': 'true' }, '0%');
  const readH = el('span', { class: 'num v3d-read-v' }, '–');
  const readRot = el('span', { class: 'num v3d-read-v' }, '–');
  const playBtn = el('button', { type: 'button', class: 'btn btn-sm v3d-play', 'aria-pressed': 'false' });
  const modeBtns = FOLD_MODES.map(([mode, label]) => el('button', {
    type: 'button', 'aria-pressed': 'false', 'data-mode': mode,
    onclick: () => { store.setView({ foldMode: mode }); syncControls(); schedule(); },
  }, label));
  const spinBtn = el('button', {
    type: 'button', class: 'icon-btn btn-sm v3d-spin', 'aria-pressed': 'false', 'aria-label': 'Auto-rotate',
    title: 'Auto-rotate the view', html: ICON_SPIN,
    onclick: () => { store.setView({ autoRotate: !store.view.autoRotate }); syncSpin(); syncControls(); },
  });
  const resetBtn = el('button', {
    type: 'button', class: 'icon-btn btn-sm v3d-reset', 'aria-label': 'Reset view', title: 'Reset view (double-click the view)',
    html: ICON_RESET, onclick: () => { cam.reset(); schedule(); },
  });
  const readHBox = el('span', { class: 'v3d-read', title: 'Total height of the tube in this pose' },
    el('span', { class: 'v3d-read-k' }, 'Height'), readH);
  const head = el('div', { class: 'v3d-head' },
    el('div', { class: 'v3d-titlebar' },
      el('h2', { class: 'v3d-title' }, 'Folded tube'),
      el('div', { class: 'v3d-readouts' },
        readHBox,
        el('span', { class: 'v3d-read', title: 'Rotation of the top ring relative to the bottom ring' },
          el('span', { class: 'v3d-read-k' }, 'End rotation'), readRot))),
    el('div', { class: 'v3d-toolbar' },
      playBtn,
      el('div', { class: 'v3d-slider' }, el('span', { class: 'v3d-read-k', 'aria-hidden': 'true' }, 'Fold'), slider, sliderOut),
      el('div', { class: 'seg v3d-seg', role: 'group', 'aria-label': 'Fold sequence' }, modeBtns),
      el('div', { class: 'v3d-viewctl' }, spinBtn, resetBtn)));

  const canvas = el('canvas', {
    class: 'v3d-canvas', tabindex: 0, role: 'img',
    'aria-label': 'Folded tube in 3-D. Drag or use the arrow keys to orbit, scroll or press + and - to zoom, double-click or press 0 to reset.',
  });
  const statusText = el('span', {});
  const status = el('span', { class: 'chip v3d-status' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), statusText);
  const hDep = el('dd', { class: 'num' }), hCur = el('dd', { class: 'num' }), hFol = el('dd', { class: 'num' });
  // end rings: one row when both are the same, else a row each
  const ringsK = el('dt', { hidden: true }, 'End rings'), ringsV = el('dd', { class: 'num', hidden: true });
  const ringBK = el('dt', { hidden: true }, 'Bottom ring'), ringBV = el('dd', { class: 'num', hidden: true });
  const ringTK = el('dt', { hidden: true }, 'Top ring'), ringTV = el('dd', { class: 'num', hidden: true });
  const note = el('p', { class: 'v3d-note', hidden: true });
  const overlay = el('div', { class: 'v3d-overlay' }, status,
    el('dl', { class: 'v3d-heights' }, el('dt', {}, 'Deployed'), hDep, el('dt', {}, 'Current'), hCur, el('dt', {}, 'Folded'), hFol, ringsK, ringsV, ringBK, ringBV, ringTK, ringTV),
    note);
  const hint = el('p', { class: 'v3d-hint', 'aria-hidden': 'true' }, 'Drag to orbit · Shift-drag to pan · Scroll to zoom · Double-click to reset');
  const emptyText = el('span', {});
  const empty = el('div', { class: 'empty-state bad v3d-empty', role: 'status', hidden: true },
    el('strong', { class: 'title' }, 'No tube to show'), emptyText);
  const stage = el('div', { class: 'v3d-stage' }, canvas, overlay, hint, empty);
  const root = el('div', { class: 'v3d v3d-tube' }, head, stage);
  container.append(root);

  // ── state ──
  const cam = new OrbitCamera({ yaw: -58 * DEG, pitch: 16 * DEG, fov: 28 * DEG, minPitch: -45 * DEG, maxPitch: 88 * DEG });
  let active = true;
  let raf = 0;
  let design = null;        // design the DOM and mesh belong to
  let mesh = null;
  let proj = null;
  let colors = null;
  let lastAnimShown = null;
  const phi = { design: null, fn: null, asked: null };
  const anim = { on: false, t0: null, u0: 0 };
  const spin = { on: false, last: null, timer: 0 };

  const controls = bindOrbitControls(canvas, cam, { onChange: schedule });

  function schedule() {
    if (!raf && active) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!active) return;
    let more = false;
    if (anim.on) { stepAnimation(now); more = anim.on; }
    if (spin.on) {
      if (spin.last !== null && !controls.dragging()) cam.orbit(-SPIN_RATE * Math.min(0.1, (now - spin.last) / 1000), 0);
      spin.last = now;
      more = true;
    }
    render();
    if (more) schedule();
  }

  // ── fold animation (view.animating) and auto-rotate (view.autoRotate) ──
  function stepAnimation(now) {
    if (anim.t0 === null) {
      const c = currentCompress();
      anim.u0 = c >= 0.999 ? 1 : Math.acos(1 - 2 * c) / Math.PI;   // start where the slider is
      anim.t0 = now;
    }
    const u = (anim.u0 + (now - anim.t0) / HALF_CYCLE_MS) % 2;
    const c = (1 - Math.cos(Math.PI * (u <= 1 ? u : 2 - u))) / 2;
    store.setView({ compress: Math.round(c * 1e4) / 1e4 });
  }

  function syncAnimation() {
    const v = store.view;
    if (v.animating && (!active || !store.design().valid)) {
      anim.on = false;
      store.setView({ animating: false });
    } else if (v.animating && reducedMotion()) {
      anim.on = false;
      store.setView({ animating: false, compress: currentCompress() < 0.5 ? 1 : 0 });
    } else if (v.animating) {
      if (!anim.on) { anim.on = true; anim.t0 = null; schedule(); }
    } else {
      anim.on = false;
    }
  }

  function syncSpin() {
    const want = !!store.view.autoRotate && active && store.design().valid;
    const reduced = reducedMotion();
    if (!want || !reduced) { clearTimeout(spin.timer); spin.timer = 0; }
    if (!want || reduced) spin.on = false;
    if (!want) return;
    if (reduced) {
      if (!spin.timer) spin.timer = setTimeout(stepSpinReduced, SPIN_STEP_MS);
    } else if (!spin.on) {
      spin.on = true; spin.last = null; schedule();
    }
  }

  function stepSpinReduced() {
    spin.timer = 0;
    if (!store.view.autoRotate || !active) return;
    if (!controls.dragging()) { cam.orbit(-SPIN_STEP, 0); schedule(); }
    spin.timer = setTimeout(stepSpinReduced, SPIN_STEP_MS);
  }

  const currentCompress = () => clamp(Number(store.view.compress) || 0, 0, 1);

  // ── controls ──
  slider.addEventListener('input', () => {
    store.setView({ compress: Number(slider.value) / 100, animating: false });
    syncAnimation(); syncControls(); schedule();
  });
  playBtn.addEventListener('click', () => {
    const v = store.view;
    if (!store.design().valid) return;
    if (v.animating) store.setView({ animating: false });
    else if (reducedMotion()) store.setView({ compress: currentCompress() < 0.5 ? 1 : 0 });
    else store.setView({ animating: true });
    syncAnimation(); syncControls(); schedule();
  });

  function syncControls() {
    const v = store.view;
    const valid = store.design().valid;
    const pct = Math.round(currentCompress() * 100);
    if (slider.value !== String(pct)) slider.value = String(pct);
    slider.style.setProperty('--pct', `${pct}%`);            // filled track (css/app.css)
    slider.setAttribute('aria-valuetext', `${pct}% folded`);
    sliderOut.textContent = `${pct}%`;
    const mode = v.foldMode === 'sequential' ? 'sequential' : 'uniform';
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    const on = !!v.animating;
    if (on !== lastAnimShown) {
      lastAnimShown = on;
      playBtn.innerHTML = `${on ? ICON_PAUSE : ICON_PLAY}<span>${on ? 'Pause' : 'Play'}</span>`;
      playBtn.setAttribute('aria-pressed', String(on));
      playBtn.setAttribute('aria-label', on ? 'Pause fold animation' : 'Play fold animation');
      playBtn.title = reducedMotion() ? 'Reduced motion: jumps between deployed and folded' : '';
    }
    spinBtn.setAttribute('aria-pressed', String(!!v.autoRotate));
    for (const c of [slider, playBtn, spinBtn, ...modeBtns]) c.disabled = !valid;
  }

  // ── design-dependent DOM ──
  function syncDesign() {
    const d = store.design();
    if (d === design) return;
    design = d;
    mesh = null;
    proj = null;
    if (!d.valid) {
      emptyText.textContent = d.errors[0] || 'This design has no valid tube shape.';
      empty.hidden = false;
      overlay.hidden = true;
      hint.hidden = true;
      readH.textContent = '–';
      readRot.textContent = '–';
      if (store.view.animating) store.setView({ animating: false });
      return;
    }
    empty.hidden = true;
    overlay.hidden = false;
    hint.hidden = false;
    const L = d.lengths;
    const e = endRingsOf(d), eSum = e.bottom + e.top;
    // frame the whole tube with its rings: z from -bottom to deployed + top
    cam.fit([0, 0, (L.deployed + e.top - e.bottom) / 2], Math.hypot(FRAME_R * d.R, (L.deployed + eSum) / 2));
    statusText.textContent = d.status === 'bistable' ? 'Bistable' : 'Monostable';
    status.className = `chip v3d-status ${d.status === 'bistable' ? 'ok' : 'warn'}`;
    hDep.textContent = fmt(L.deployed, 1, 'mm');
    hFol.textContent = L.folded === null ? 'none' : fmt(L.folded, 1, 'mm');
    const same = e.bottom === e.top;
    ringsK.hidden = ringsV.hidden = !(same && e.bottom > 0);
    ringBK.hidden = ringBV.hidden = ringTK.hidden = ringTV.hidden = same;
    ringsV.textContent = same && e.bottom > 0 ? `2 × ${fmt(e.bottom, 1, 'mm')}` : '';
    ringBV.textContent = e.bottom > 0 ? fmt(e.bottom, 1, 'mm') : 'none';
    ringTV.textContent = e.top > 0 ? fmt(e.top, 1, 'mm') : 'none';
    readHBox.title = eSum
      ? `Height of the folding part in this pose, between the end rings. With its end rings the tube is ${fmt(eSum, 1, 'mm')} taller.`
      : 'Total height of the tube in this pose';
    note.hidden = d.bistable;
    note.textContent = d.bistable ? '' : 'One stable state: the compressed shape is strained (no second stable state).';
  }

  function syncLive() {
    hCur.textContent = fmt(mesh.height, 1, 'mm');
    readH.textContent = fmt(mesh.height, 1, 'mm');
    readRot.textContent = `${fmt(mesh.endRotation / DEG, 1)}°`;
  }

  // ── relaxed twist path (debounced; heavy the first time for a design) ──
  const computePhi = debounce(() => {
    const d = store.design();
    if (d !== design || !active) { phi.asked = null; return; }   // asked again at the next render
    phi.fn = relaxedTwist(d);
    phi.design = d;
    schedule();
  }, PHI_DELAY_MS);

  function ensureMesh() {
    const c = currentCompress();
    const mode = store.view.foldMode === 'sequential' ? 'sequential' : 'uniform';
    if (phi.design !== design && phi.asked !== design) { phi.asked = design; computePhi(); }
    const fn = phi.design === design ? phi.fn : null;
    if (mesh && mesh.c === c && mesh.mode === mode && mesh.fn === fn) return;
    mesh = tubeViewMesh(design, c, mode, fn);
    mesh.c = c; mesh.mode = mode; mesh.fn = fn;
    proj = null;
    syncLive();
  }

  function themeColors() {
    if (colors) return colors;
    const sheet = parseColor(cssVar('--sheet'), parseColor(PRINT.paper));
    const outside = [], inside = [];
    for (let i = 0; i < SHADES; i++) {
      const k = AMBIENT + (1 - AMBIENT) * (i / (SHADES - 1));
      outside.push(rgbCss(sheet, k));
      inside.push(rgbCss(sheet, INSIDE * k));
    }
    const edgeCss = [];
    const kinds = [[cssVar('--mountain'), PRINT.mountain], [cssVar('--valley'), PRINT.valley], [cssVar('--ink'), PRINT.cut]];
    for (const [tok, fb] of kinds) {
      const rgb = parseColor(tok || fb, parseColor(fb));
      for (let l = 1; l <= ALPHA_LEVELS; l++) edgeCss.push(rgbCss(rgb, 1, l / ALPHA_LEVELS));
    }
    colors = {
      outside, inside, edgeCss,
      ink: parseColor(cssVar('--ink') || PRINT.text, parseColor(PRINT.text)),
      rail: cssVar('--ink-3') || PRINT.textMuted,
      accent: cssVar('--accent') || PRINT.text,
      font: cssVar('--font-mono') || 'monospace',
    };
    return colors;
  }

  // ── projection cache (per camera version, viewport, mesh and theme) ──
  function ensureProjection() {
    const C = themeColors();
    if (proj && proj.mesh === mesh && proj.cam === cam.version && proj.colors === C) return;
    const m = mesh;
    const F = cam.frame();
    const P = proj && proj.P.length === m.pos.length ? proj.P : new Float64Array(m.pos.length);
    cam.projectAll(m.pos, P);
    let dmin = Infinity, dmax = -Infinity;
    for (let i = 2; i < P.length; i += 3) { if (P[i] < dmin) dmin = P[i]; if (P[i] > dmax) dmax = P[i]; }
    const span = Math.max(1e-9, dmax - dmin);
    const L = keyLight(F);
    const E = F.eye;

    const depth = new Float64Array(m.nF);
    const front = new Uint8Array(m.nF);
    const fill = new Array(m.nF);
    for (let f = 0; f < m.nF; f++) {
      const a = 3 * m.faces[3 * f], b = 3 * m.faces[3 * f + 1], c = 3 * m.faces[3 * f + 2];
      depth[f] = P[a + 2] + P[b + 2] + P[c + 2];
      const nx = m.normals[3 * f], ny = m.normals[3 * f + 1], nz = m.normals[3 * f + 2];
      const out = nx * (E[0] - m.pos[a]) + ny * (E[1] - m.pos[a + 1]) + nz * (E[2] - m.pos[a + 2]) >= 0;
      const lam = Math.max(0, (out ? 1 : -1) * (nx * L[0] + ny * L[1] + nz * L[2]));
      const level = Math.round(lam * (SHADES - 1));
      front[f] = out ? 1 : 0;
      fill[f] = out ? C.outside[level] : C.inside[level];
    }
    const order = paintOrder(m, depth, front, E[2]);

    const edgeStyle = new Uint16Array(m.nE);
    for (let e = 0; e < m.nE; e++) {
      const a = 3 * m.edges[2 * e], b = 3 * m.edges[2 * e + 1];
      const t = clamp(((P[a + 2] + P[b + 2]) / 2 - dmin) / span, 0, 1);
      let al = 1 - 0.55 * t;
      const f0 = m.edgeFaces[2 * e], f1 = m.edgeFaces[2 * e + 1];
      if (!((f0 >= 0 && front[f0]) || (f1 >= 0 && front[f1]))) al *= 0.6;   // seen only from inside
      const level = clamp(Math.round(al * ALPHA_LEVELS) - 1, 0, ALPHA_LEVELS - 1);
      edgeStyle[e] = m.edgeKind[e] * ALPHA_LEVELS + level;
    }

    // soft ground ellipse under the tube (only while the eye is above the ground plane)
    let ground = null, groundCss = '';
    const lift = (E[2] - m.zMin) / F.dist;
    if (lift > 0.02) {
      const pts = new Float64Array(3 * GROUND.length * GROUND_SEG);
      let q = 0;
      for (const r of GROUND) {
        for (const [cx, sy] of UNIT_CIRCLE) { pts[q++] = r * design.R * cx; pts[q++] = r * design.R * sy; pts[q++] = m.zMin; }
      }
      ground = cam.projectAll(pts, pts);
      groundCss = rgbCss(C.ink, 1, 0.055 * Math.min(1, lift / 0.3));
    }

    // height rail beside the tube, on the camera's right
    const bx = F.right[0] * RAIL_AT * design.R, by = F.right[1] * RAIL_AT * design.R;
    const at = (z) => cam.project([bx, by, z]);
    const Ls = design.lengths;
    const rail = {
      bottom: at(0), dep: at(Ls.deployed), cur: at(m.height),
      fol: Ls.folded === null ? null : at(Ls.folded),
    };

    proj = {
      mesh: m, cam: cam.version, colors: C, P, order, fill, edgeStyle,
      cnt: proj && proj.cnt && proj.cnt.length === m.nE ? proj.cnt : new Uint8Array(m.nE),
      done: proj && proj.done && proj.done.length === m.nF ? proj.done : new Uint8Array(m.nF),
      ground, groundCss, rail,
    };
  }

  function render() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;          // hidden or collapsed
    const { ctx, w, h } = fitCanvas(canvas);
    cam.setViewport(w, h);
    syncDesign();
    ctx.clearRect(0, 0, w, h);
    if (!design.valid) return;
    ensureMesh();
    ensureProjection();
    draw(ctx, w);
  }

  function draw(ctx, w) {
    const m = mesh, C = colors, { P, order, fill, edgeStyle, cnt, done } = proj;
    if (proj.ground) {
      ctx.fillStyle = proj.groundCss;
      for (let r = 0; r < GROUND.length; r++) {
        const o = 3 * r * GROUND_SEG;
        ctx.beginPath();
        ctx.moveTo(proj.ground[o], proj.ground[o + 1]);
        for (let i = 1; i < GROUND_SEG; i++) ctx.lineTo(proj.ground[o + 3 * i], proj.ground[o + 3 * i + 1]);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    cnt.fill(0);
    let kind = -1, style = -1;
    const stroke = (e) => {
      const s = edgeStyle[e], k = m.edgeKind[e];
      if (k !== kind) {
        kind = k;
        ctx.lineWidth = k === 2 ? 1.6 : 1.25;
        ctx.setLineDash(k === 1 ? VALLEY_DASH : NO_DASH);
      }
      if (s !== style) { style = s; ctx.strokeStyle = C.edgeCss[s]; }
      const a = 3 * m.edges[2 * e], b = 3 * m.edges[2 * e + 1];
      ctx.beginPath();
      ctx.moveTo(P[a], P[a + 1]);
      ctx.lineTo(P[b], P[b + 1]);
      ctx.stroke();
    };
    const tri = (f) => {
      const a = 3 * m.faces[3 * f], b = 3 * m.faces[3 * f + 1], c = 3 * m.faces[3 * f + 2];
      ctx.moveTo(P[a], P[a + 1]);
      ctx.lineTo(P[b], P[b + 1]);
      ctx.lineTo(P[c], P[c + 1]);
      ctx.closePath();
    };
    const settle = (f) => {                  // creases whose faces are now all drawn
      done[f] = 1;
      for (let j = 0; j < 3; j++) {
        const e = m.faceEdges[3 * f + j];
        if (e >= 0 && ++cnt[e] === m.edgeNeed[e]) stroke(e);
      }
    };
    done.fill(0);
    for (let o = 0; o < order.length; o++) {
      const f = order[o];
      if (done[f]) continue;
      const g = m.facePair[f];               // other half of a flat ring panel: one fill, no seam
      ctx.beginPath();
      tri(f);
      if (g >= 0) tri(g);
      ctx.fillStyle = fill[f];
      ctx.fill();
      settle(f);
      if (g >= 0) settle(g);
    }
    for (let e = 0; e < m.nE; e++) if (m.edgeNeed[e] === 0) stroke(e);
    ctx.setLineDash(NO_DASH);
    drawRail(ctx, w);
  }

  function drawRail(ctx, w) {
    const r = proj.rail, C = colors;
    const len = Math.hypot(r.dep[0] - r.bottom[0], r.dep[1] - r.bottom[1]);
    if (len < 28) return;                    // seen end-on from above: no room
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.rail;
    ctx.fillStyle = C.rail;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(r.bottom[0], r.bottom[1]);
    ctx.lineTo(r.dep[0], r.dep[1]);
    ctx.stroke();
    const tick = (p) => { ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1]); ctx.lineTo(p[0] + 4, p[1]); ctx.stroke(); };
    tick(r.bottom);
    tick(r.dep);
    if (r.fol) tick(r.fol);
    ctx.font = `10px ${C.font}`;
    ctx.textBaseline = 'middle';
    const label = (text, p) => {
      const tw = ctx.measureText(text).width;
      if (p[0] + 7 + tw <= w - 2) { ctx.textAlign = 'left'; ctx.fillText(text, p[0] + 7, p[1]); }
      else { ctx.textAlign = 'right'; ctx.fillText(text, p[0] - 7, p[1]); }
    };
    label('deployed', r.dep);
    if (r.fol && Math.abs(r.fol[1] - r.dep[1]) > 12) label('folded', r.fol);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.accent;                // current height: marker pointing at the rail
    const [x, y] = r.cur;
    ctx.beginPath();
    ctx.moveTo(x - 2, y);
    ctx.lineTo(x - 9, y - 4.5);
    ctx.lineTo(x - 9, y + 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ── wiring ──
  onThemeChange(() => { colors = null; schedule(); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => schedule()).observe(stage);
  try {
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { syncAnimation(); syncSpin(); lastAnimShown = null; syncControls(); });
  } catch { /* no media queries */ }

  syncControls();
  syncSpin();
  schedule();

  return {
    update(change = {}) {
      const keys = Array.isArray(change.keys) ? change.keys : ['*'];
      const has = (k) => keys.includes('*') || keys.includes(k);
      if (change.kind === 'theme') colors = null;
      if (change.kind === 'params') { syncAnimation(); syncSpin(); }
      if (change.kind === 'view') {
        if (has('animating')) syncAnimation();
        if (has('autoRotate')) syncSpin();
      }
      syncControls();
      schedule();
    },
    resize() { schedule(); },
    setActive(on) {
      const was = active;
      active = !!on;
      if (!active) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        anim.on = false;
        spin.on = false;
        clearTimeout(spin.timer);
        spin.timer = 0;
        computePhi.cancel();
        if (phi.design !== design) phi.asked = null;
        if (store.view.animating) store.setView({ animating: false });
        return;
      }
      if (!was) { syncAnimation(); syncSpin(); }
      syncControls();
      schedule();
    },
  };
}
