import { paramPairs } from './constants.js';
import { showToast } from './ui.js';
import { seamAutoMode, setSeamAutoMode } from './presets.js';

const MAX_HISTORY = 60;
let history = [];
let historyIdx = -1;
let _suppressHistory = false;

export function captureState() {
  if (_suppressHistory) return;
  const state = {};
  paramPairs.forEach(([, nid]) => {
    const el = document.getElementById(nid);
    if (el) state[nid] = el.value;
  });
  state['chir'] = document.getElementById('chir').value;
  state['seam-auto-cb'] = document.getElementById('seam-auto-cb').checked;

  history = history.slice(0, historyIdx + 1);
  history.push(state);
  if (history.length > MAX_HISTORY) history.shift();
  historyIdx = history.length - 1;
}

function restoreState(state, draw) {
  _suppressHistory = true;
  paramPairs.forEach(([rid, nid]) => {
    if (state[nid] === undefined) return;
    const r = document.getElementById(rid), n = document.getElementById(nid);
    if (r) r.value = state[nid]; if (n) n.value = state[nid];
  });
  if (state['chir'] !== undefined) document.getElementById('chir').value = state['chir'];
  if (state['seam-auto-cb'] !== undefined) {
    setSeamAutoMode(state['seam-auto-cb']);
    document.getElementById('seam-auto-cb').checked = state['seam-auto-cb'];
  }
  _suppressHistory = false;
  draw();
}

export function undo(draw) {
  if (historyIdx <= 0) { showToast('Nothing to undo', 1200); return; }
  historyIdx--;
  restoreState(history[historyIdx], draw);
  showToast('Undo ✓', 1000);
}

export function redo(draw) {
  if (historyIdx >= history.length - 1) { showToast('Nothing to redo', 1200); return; }
  historyIdx++;
  restoreState(history[historyIdx], draw);
  showToast('Redo ✓', 1000);
}
