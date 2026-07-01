import { PRESETS, PRESET_KEYS } from './constants.js';
import { showToast } from './ui.js';

// seamAutoMode lives here since presets toggle it; app.js re-exports/imports as needed
export let seamAutoMode = true;
export function setSeamAutoMode(v) { seamAutoMode = v; }

export function loadPreset(key, { draw }) {
  if (!key) return;
  const pv = PRESETS[key];
  if (!pv) return;
  Object.entries(pv).forEach(([k, v]) => {
    const r = document.getElementById('r-' + k), n = document.getElementById('n-' + k);
    if (r) r.value = v; if (n) n.value = v;
  });
  seamAutoMode = false;
  const cb = document.getElementById('seam-auto-cb'); if (cb) cb.checked = false;
  document.getElementById('preset-select').value = '';
  draw();
  showToast('Preset loaded ✓', 1400);
}

export function exportPreset() {
  const data = {};
  PRESET_KEYS.forEach(k => {
    const el = document.getElementById('n-' + k);
    if (el) data[k] = parseFloat(el.value);
  });
  data.chir = parseInt(document.getElementById('chir').value);
  data.material = document.getElementById('material').value;
  data.seamAuto = document.getElementById('seam-auto-cb').checked;
  data._version = 1;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kresling_preset_n${data.n}_f${data.floors}.json`;
  a.click();
  showToast('Preset exported ✓');
}

export function importPreset() {
  document.getElementById('preset-file-input').click();
}

export function handlePresetFile(input, { draw, applyAutoSeam }) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      PRESET_KEYS.forEach(k => {
        if (data[k] === undefined) return;
        const r = document.getElementById('r-' + k), n = document.getElementById('n-' + k);
        if (r) r.value = data[k]; if (n) n.value = data[k];
      });
      if (data.chir !== undefined) document.getElementById('chir').value = data.chir;
      if (data.material !== undefined) document.getElementById('material').value = data.material;
      if (data.seamAuto !== undefined) {
        seamAutoMode = !!data.seamAuto;
        document.getElementById('seam-auto-cb').checked = seamAutoMode;
      }
      if (!seamAutoMode) applyAutoSeam();
      draw();
      showToast(`Preset loaded: n=${data.n || '?'} floors=${data.floors || '?'} ✓`);
    } catch (err) {
      showToast('⚠ Invalid preset file');
    }
    input.value = '';
  };
  reader.readAsText(file);
}
