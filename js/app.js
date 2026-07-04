import { paramPairs } from './constants.js';
import { getP, showToast, debounce, toggleSourcesModal } from './ui.js';
import { computeGeometry, patternBounds } from './geometry.js';
import { drawFlat, initFlatCanvasEvents } from './render-flat.js';
import { init3d, draw3d } from './render-3d.js';
import { initMold3d, drawMold3d } from './render-mold.js';
import { drawEnergy, initEnergyEvents } from './energy.js';
import { drawStiffness } from './stiffness.js';
import { captureState, undo as _undo, redo as _redo } from './history.js';
import {
  seamAutoMode, setSeamAutoMode, loadPreset as _loadPreset,
  exportPreset as _exportPreset, importPreset as _importPreset,
  handlePresetFile as _handlePresetFile,
} from './presets.js';
import { exportSVG, exportPNGA4, exportPDF, exportDXF, exportSTL, exportMoldSTL } from './exports.js';
import { ui, anim, cam3d, moldCam, flatCam } from './state.js';

// ─── Top-level draw orchestration ────────────────────────────────────────────
export function drawPanel() { draw3d(); drawEnergy(); drawStiffness(); }

export function draw() {
  if (ui.currentCenterTab === 'crease') {
    drawFlat();
  } else if (document.getElementById('center-pane-mold').offsetParent !== null) {
    drawMold3d();
  }
  drawPanel();
}

const drawEnergyDebounced = debounce(() => drawEnergy(), 120);

// ─── Auto-seam ────────────────────────────────────────────────────────────────
function computeAutoSeam(p, g) {
  const ec = p.extcols, b = g.b;
  if (ec === 0) return { seaml: 0, seamr: 0 };
  const val = parseFloat((ec * b).toFixed(3));
  return { seaml: val, seamr: val };
}

function applyAutoSeam() {
  if (!seamAutoMode) return;
  const p = getP(), g = computeGeometry(p);
  const { seaml, seamr } = computeAutoSeam(p, g);
  const setV = (id, v) => {
    const r = document.getElementById('r-' + id), n = document.getElementById('n-' + id);
    if (r) { r.max = Math.max(parseFloat(r.max), v); r.value = v; }
    if (n) { n.value = v; }
  };
  setV('seaml', seaml); setV('seamr', seamr);
}

// ─── Presets (wired with draw/applyAutoSeam dependencies) ───────────────────
function loadPreset(key)         { _loadPreset(key, { draw }); }
function exportPreset()          { _exportPreset(); }
function importPreset()          { _importPreset(); }
function handlePresetFile(input) { _handlePresetFile(input, { draw, applyAutoSeam }); }

function undo() { _undo(draw); }
function redo() { _redo(draw); }

// ─── Auto-rotate ──────────────────────────────────────────────────────────────
function toggleAutoRotate() {
  anim.autoRotate = !anim.autoRotate;
  const btn = document.getElementById('anim-btn');
  if (btn) {
    btn.style.color       = anim.autoRotate ? 'var(--accent2)' : '';
    btn.style.borderColor = anim.autoRotate ? 'var(--accent)'  : '';
    btn.title = anim.autoRotate ? 'Stop rotation [A]' : 'Auto-rotate [A]';
  }
  if (anim.autoRotate) { anim.lastTime = performance.now(); stepAutoRotate(); }
  else if (anim.frame) { cancelAnimationFrame(anim.frame); anim.frame = null; }
  showToast(anim.autoRotate ? 'Auto-rotate on' : 'Auto-rotate off', 1400);
}

function stepAutoRotate() {
  if (!anim.autoRotate) return;
  const now = performance.now();
  const dt  = Math.min((now - anim.lastTime) / 1000, 0.1);
  anim.lastTime = now;
  const speed = 0.5;
  cam3d.rotY += speed * dt;
  draw3d();
  if (ui.currentCenterTab === 'mold') { moldCam.rotY += speed * dt; drawMold3d(); }
  anim.frame = requestAnimationFrame(stepAutoRotate);
}

// ─── Center tab system ────────────────────────────────────────────────────────
function switchCenterTab(tab) {
  ui.currentCenterTab = tab;
  document.getElementById('ctab-crease').classList.toggle('active', tab === 'crease');
  document.getElementById('ctab-mold').classList.toggle('active', tab === 'mold');
  document.getElementById('center-pane-crease').style.display = tab === 'crease' ? 'flex' : 'none';
  document.getElementById('center-pane-mold').style.display   = tab === 'mold'   ? 'flex' : 'none';
  document.getElementById('mold-sub-tabs').style.display       = tab === 'mold'   ? 'flex' : 'none';
  if (tab === 'crease') drawFlat();
  else { initMold3d(); drawMold3d(); }
}

function switchMoldTab(tab) {
  ui.currentMoldTab = tab;
  ['mountain', 'valley', 'both'].forEach(t =>
    document.getElementById('mtab-' + t).classList.toggle('active', t === tab));
  drawMold3d();
}

// ─── Right-panel sub-panels (3D tube / energy / stiffness) ──────────────────
const SUBPANELS = {
  '3d':        { sp: 'sp3d',        btnTog: 'btn-tog-3d',        btnExp: 'btn-exp-3d',        wrap: 'wrap3d',        draw: () => { init3d(); draw3d(); } },
  'energy':    { sp: 'spEnergy',    btnTog: 'btn-tog-energy',    btnExp: 'btn-exp-energy',    wrap: 'wrapEnergy',    draw: () => drawEnergy() },
  'stiffness': { sp: 'spStiffness', btnTog: 'btn-tog-stiffness', btnExp: 'btn-exp-stiffness', wrap: 'wrapStiffness', draw: () => drawStiffness() },
};

function redrawAllVisibleSubPanels() {
  Object.values(SUBPANELS).forEach(c => {
    if (!document.getElementById(c.sp).classList.contains('collapsed')) c.draw();
  });
}

function toggleSubPanel(which) {
  const cfg = SUBPANELS[which];
  const sp  = document.getElementById(cfg.sp);
  const btn = document.getElementById(cfg.btnTog);
  const collapsed = sp.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▶' : '▼';
  // Toggling this panel's flex-basis reflows every sibling sharing flex:1 in
  // the same animated transition, so their canvases need resizing/redrawing
  // too — not just this one's, and not only when expanding.
  redrawAllVisibleSubPanels();
  function onEnd(e) {
    if (e.target !== sp) return; // ignore bubbled events (e.g. the toggle chevron's own rotation transition)
    sp.removeEventListener('transitionend', onEnd);
    redrawAllVisibleSubPanels();
  }
  sp.addEventListener('transitionend', onEnd);
}

function expandSubPanel(which) {
  const cfg = SUBPANELS[which];
  const sp  = document.getElementById(cfg.sp);
  const btn = document.getElementById(cfg.btnExp);
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl === sp) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
    return;
  }
  const req = sp.requestFullscreen || sp.webkitRequestFullscreen;
  if (!req) return;
  req.call(sp).then(() => {
    btn.textContent = '✕';
    const wrap = document.getElementById(cfg.wrap);
    const ro = new ResizeObserver(() => { ro.disconnect(); cfg.draw(); });
    ro.observe(wrap);
  }).catch(() => {});
}

function _fsChange() {
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    Object.values(SUBPANELS).forEach(cfg => {
      const b = document.getElementById(cfg.btnExp);
      if (b) b.textContent = '⛶';
    });
    setTimeout(() => { init3d(); draw3d(); drawEnergy(); drawStiffness(); }, 80);
  }
}

// ─── Auto-fit / reset ─────────────────────────────────────────────────────────
function autoFitA4() {
  const p = getP(), g = computeGeometry(p);
  const labelMarginCm = 1.2;
  const usableW = 21.0 - labelMarginCm * 2;
  const usableH = 29.7 - labelMarginCm * 2;
  const bounds = patternBounds(p, g);
  const ms = Math.min(usableW / bounds.w, usableH / bounds.h) * 100;
  const cl = Math.min(200, Math.max(10, Math.floor(ms)));
  document.getElementById('r-scale').value = cl;
  document.getElementById('n-scale').value = cl;
  draw();
}

function resetDefaults() {
  const defs = { dia:3, height:20, n:6, floors:10, angle:100, ext:2, seaml:1.4, seamr:0, extcols:1, stack:1, scale:100, compress:0, wallmm:0.8 };
  Object.entries(defs).forEach(([k, v]) => {
    const r = document.getElementById('r-' + k), n = document.getElementById('n-' + k);
    if (r) r.value = v; if (n) n.value = v;
  });
  setSeamAutoMode(true);
  const cb = document.getElementById('seam-auto-cb'); if (cb) cb.checked = true;
  applyAutoSeam(); draw();
}

// ─── Parameter binding ────────────────────────────────────────────────────────
function bindPairs() {
  paramPairs.forEach(([rid, nid]) => {
    const r = document.getElementById(rid), n = document.getElementById(nid);
    r.addEventListener('input', () => { n.value = parseFloat(r.value); applyAutoSeam(); draw(); drawEnergyDebounced(); });
    r.addEventListener('change', () => captureState());
    n.addEventListener('input', () => {
      let v = parseFloat(n.value);
      const mn = parseFloat(r.min), mx = parseFloat(r.max);
      if (!isNaN(mn) && v < mn) v = mn; if (!isNaN(mx) && v > mx) v = mx;
      r.value = v; n.value = v; applyAutoSeam(); draw(); drawEnergyDebounced();
    });
    n.addEventListener('change', () => captureState());
    n.addEventListener('keydown', e => { if (e.key === 'Enter') { n.blur(); captureState(); } });
  });

  ['r-seaml', 'n-seaml', 'r-seamr', 'n-seamr'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('pointerdown', () => {
      setSeamAutoMode(false);
      const cb = document.getElementById('seam-auto-cb'); if (cb) cb.checked = false;
    });
  });

  document.getElementById('seam-auto-cb').addEventListener('change', e => {
    setSeamAutoMode(e.target.checked);
    if (e.target.checked) { applyAutoSeam(); draw(); }
    captureState();
  });

  ['showmv', 'showA4', 'showGrid'].forEach(id => document.getElementById(id).addEventListener('change', draw));
  document.getElementById('chir').addEventListener('change', () => { draw(); captureState(); });
  document.getElementById('material').addEventListener('change', () => { draw(); captureState(); });
}

// ─── Sidebar / right-panel resize handles ────────────────────────────────────
function initSidebarResize() {
  const handle = document.getElementById('sidebarResize');
  const sidebar = document.getElementById('sidebar');
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('pointerdown', e => {
    dragging = true; startX = e.clientX; startW = sidebar.offsetWidth;
    handle.classList.add('dragging'); handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const w = Math.max(140, Math.min(480, startW + (e.clientX - startX)));
    sidebar.style.setProperty('--sidebar-w', w + 'px');
    sidebar.style.width = w + 'px';
    drawFlat();
  });
  handle.addEventListener('pointerup', () => { dragging = false; handle.classList.remove('dragging'); });
}

function initRightPanelResize() {
  const handle = document.getElementById('rightPanelResize');
  const panel  = document.getElementById('rightPanel');
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('pointerdown', e => {
    dragging = true; startX = e.clientX; startW = panel.offsetWidth;
    handle.classList.add('dragging'); handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const w = Math.max(180, Math.min(600, startW - (e.clientX - startX)));
    panel.style.width = w + 'px';
    drawPanel();
  });
  handle.addEventListener('pointerup', () => { dragging = false; handle.classList.remove('dragging'); });
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { toggleSourcesModal(false); return; }

    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    switch (e.key.toLowerCase()) {
      case 's': e.preventDefault(); exportSVG(); showToast('SVG exported'); break;
      case 'p': e.preventDefault(); exportPDF(); showToast('PDF print dialog…'); break;
      case 'f': e.preventDefault(); autoFitA4(); showToast('Auto-fit A4'); break;
      case 'r': e.preventDefault(); resetDefaults(); showToast('Reset to defaults'); break;
      case 'a': e.preventDefault(); toggleAutoRotate(); break;
      case 'z': flatCam.zoom = Math.min(flatCam.zoom * 1.2, 20); drawFlat(); break;
      case 'x':
        flatCam.zoom = Math.max(flatCam.zoom / 1.2, 1);
        if (flatCam.zoom <= 1) { flatCam.zoom = 1; flatCam.panX = 0; flatCam.panY = 0; }
        drawFlat();
        break;
      case 'arrowleft': {
        const el = document.getElementById('r-compress');
        el.value = Math.max(0, parseFloat(el.value) - 5);
        document.getElementById('n-compress').value = el.value;
        draw3d(); break;
      }
      case 'arrowright': {
        const el = document.getElementById('r-compress');
        el.value = Math.min(95, parseFloat(el.value) + 5);
        document.getElementById('n-compress').value = el.value;
        draw3d(); break;
      }
    }

    const num = parseInt(e.key);
    if (num >= 3 && num <= 9 && !e.ctrlKey && !e.metaKey) {
      document.getElementById('r-n').value = num;
      document.getElementById('n-n').value = num;
      applyAutoSeam(); draw(); captureState();
      showToast(`Sides = ${num}`, 1200);
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initApp() {
  bindPairs();
  initSidebarResize();
  initRightPanelResize();
  applyAutoSeam();
  initFlatCanvasEvents();
  initEnergyEvents();
  initKeyboardShortcuts();
  init3d();

  document.addEventListener('fullscreenchange', _fsChange);
  document.addEventListener('webkitfullscreenchange', _fsChange);

  window.addEventListener('resize', () => {
    if (ui.currentCenterTab === 'crease') drawFlat();
    else { initMold3d(); drawMold3d(); }
    init3d(); draw3d(); drawEnergy(); drawStiffness();
  });

  captureState(); // initial state for undo
  draw();
}

// ─── Expose handlers that index.html's inline onclick="" attributes call ────
export function exposeGlobals() {
  Object.assign(window, {
    loadPreset, exportPreset, importPreset, handlePresetFile,
    exportSVG, exportPNGA4, exportPDF, exportDXF, exportSTL, exportMoldSTL,
    autoFitA4, undo, redo, resetDefaults,
    switchCenterTab, switchMoldTab,
    toggleSubPanel, expandSubPanel, toggleAutoRotate,
    toggleSourcesModal,
  });
}
