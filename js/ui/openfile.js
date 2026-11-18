// Opening design files: from the Open button, or dropped anywhere on the page.
//
//   openDesignFile(app, file)  -> Promise<boolean>   reads a File, loads it, says what happened
//   installDropOpen(app)       -> uninstall()        drag a .json file onto the window to open it
//
// Both go through readDesignFile (js/export/json.js), so the app's own design files and
// presets exported by Kresling-crease-Gen open the same way. The drop target is the whole
// window; an overlay shows while a file is dragged over it. Dragging text or links is
// left alone.

import { el } from '../app/util.js';
import { readDesignFile } from '../export/json.js';

/** Read and load a design file. Resolves to true when the design was loaded. */
export async function openDesignFile(app, file) {
  if (!file) return false;
  try {
    const res = readDesignFile(await file.text());
    if (!res.ok) { app.toast(`Could not open ${file.name}: ${res.error}`, 'error'); return false; }
    app.store.load(res.params);
    // say what was converted, limited or left out: a plain "Opened" would hide it
    const said = [...(res.notes || [])];
    if (res.ignored && res.ignored.length) {
      const names = res.ignored.slice(0, 6).join(', ') + (res.ignored.length > 6 ? ', …' : '');
      said.push(`Not used by this app and left out: ${names}.`);
    }
    if (!said.length) app.toast(`Opened ${file.name}. Undo goes back.`, 'ok');
    else app.toast(`Opened ${file.name}. ${said.join(' ')} Undo goes back.`, res.source === 'crease-gen' && res.drawable !== false ? 'info' : 'warn', { timeout: 0 });
    return true;
  } catch (e) {
    app.toast(`Could not read ${file.name}.`, 'error');
    return false;
  }
}

function carriesFiles(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  return Boolean(types) && [...types].includes('Files');
}

export function installDropOpen(app) {
  const overlay = el('div', { class: 'drop-overlay', hidden: true, 'aria-hidden': 'true' },
    el('div', { class: 'drop-card' },
      el('strong', { text: 'Drop to open the design' }),
      el('span', { text: 'A design file (.json) saved by this app, or a Kresling-crease-Gen preset' })));
  document.body.append(overlay);
  let depth = 0;   // dragenter/dragleave fire for every child element crossed

  const show = (on) => { overlay.hidden = !on; };
  function onEnter(e) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth += 1;
    show(true);
  }
  function onOver(e) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
  function onLeave(e) {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) show(false);
  }
  async function onDrop(e) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth = 0;
    show(false);
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    if (document.querySelector('dialog[open]')) return;
    if (files.length > 1) app.toast(`Opening ${files[0].name}; one design opens at a time.`, 'info');
    await openDesignFile(app, files[0]);
  }
  window.addEventListener('dragenter', onEnter);
  window.addEventListener('dragover', onOver);
  window.addEventListener('dragleave', onLeave);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('dragenter', onEnter);
    window.removeEventListener('dragover', onOver);
    window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('drop', onDrop);
    overlay.remove();
  };
}
