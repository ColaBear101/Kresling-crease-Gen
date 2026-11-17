// Top bar: wordmark, design status, presets (built-in and saved in this
// browser), undo/redo, open/save a design file, help.
//
//   mountToolbar(container, app, { onHelp }) -> { update(change), resize(), setActive() }

import { el } from '../app/util.js';
import { PRESETS, normalizeParams, migrateParams, DEFAULTS } from '../core/params.js';
import { readDesignFile } from '../export/json.js';
import { statusInfo } from './controls.js';

const ICONS = {
  // a Kresling floor seen from the side: two rings joined by slanted creases
  mark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 18h16"/><path d="M4 6l6 12M10 6l6 12M16 6l4 8"/><path d="M4 6v12M20 6v12" stroke-opacity=".35"/></svg>',
  chevron: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>',
  undo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 2.5 7 6 10.5"/><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H8"/></svg>',
  redo: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5 13.5 7 10 10.5"/><path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H8"/></svg>',
  open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.5h4l1.5 1.5H14V13H2z"/></svg>',
  save: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
  help: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/></svg>',
  check: '<svg class="pop-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
};

function iconButton(icon, label, extra = {}) {
  const b = el('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, ...extra });
  b.innerHTML = icon;
  return b;
}

/** True when params match a preset's params (defaults filled in). */
function matches(params, presetParams) {
  const pp = migrateParams(presetParams);            // presets saved under older key names
  const want = normalizeParams({ ...DEFAULTS, ...pp });
  return Object.keys(pp).every((k) => String(want[k]) === String(params[k]));
}

export function mountToolbar(container, app, { onHelp } = {}) {
  const { store } = app;
  container.replaceChildren();

  const mark = el('span', { class: 'wordmark' });
  mark.innerHTML = ICONS.mark;
  mark.append(document.createTextNode('Kresling Studio'));

  const status = el('span', { class: 'chip tb-status', role: 'status' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), el('span'));

  // ── presets popover ──
  const presetBtn = el('button', { type: 'button', class: 'btn btn-sm', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
  presetBtn.append(document.createTextNode('Presets'));
  presetBtn.insertAdjacentHTML('beforeend', ICONS.chevron);
  const pop = el('div', { class: 'popover', role: 'menu', 'aria-label': 'Presets', hidden: true });
  const presets = el('div', { class: 'tb-group tb-presets' }, presetBtn, pop);

  function closePop() {
    pop.hidden = true;
    presetBtn.setAttribute('aria-expanded', 'false');
  }
  function openPop() {
    renderPop();
    pop.hidden = false;
    presetBtn.setAttribute('aria-expanded', 'true');
    const first = pop.querySelector('.pop-item');
    if (first) first.focus();
  }
  presetBtn.addEventListener('click', () => (pop.hidden ? openPop() : closePop()));
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !presets.contains(e.target)) closePop(); });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closePop(); presetBtn.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...pop.querySelectorAll('.pop-item, .pop-del, .pop-form input, .pop-form button')];
      const i = items.indexOf(document.activeElement);
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (next) { next.focus(); e.preventDefault(); }
    }
  });

  function item(label, current, onPick) {
    const b = el('button', { type: 'button', class: 'pop-item', role: 'menuitem' });
    b.innerHTML = ICONS.check;
    b.append(el('span', { class: 'pop-text', text: label }));
    if (current) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', onPick);
    return b;
  }

  function renderPop() {
    const params = store.params;
    const builtIn = el('ul', { class: 'pop-list' }, ...Object.entries(PRESETS).map(([key, pr]) => el('li', {},
      item(pr.label, matches(params, pr.params), () => {
        store.load({ ...DEFAULTS, ...pr.params });
        closePop();
        app.toast(`Loaded "${pr.label}". Undo goes back.`, 'ok');
      }))));
    const saved = store.userPresets();
    const names = Object.keys(saved).sort((a, b) => a.localeCompare(b));
    const userList = names.length
      ? el('ul', { class: 'pop-list' }, ...names.map((name) => {
        const del = iconButton(ICONS.trash, `Delete "${name}"`, { class: 'icon-btn pop-del' });
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          if (del.getAttribute('data-armed') === 'true') {
            store.deleteUserPreset(name);
            app.toast(`Deleted "${name}".`, 'info');
            renderPop();
            return;
          }
          del.setAttribute('data-armed', 'true');
          del.textContent = 'Delete?';
          setTimeout(() => { if (del.isConnected) { del.removeAttribute('data-armed'); del.innerHTML = ICONS.trash; } }, 3000);
        });
        return el('li', { class: 'pop-row' }, item(name, matches(params, saved[name]), () => {
          store.load(saved[name]);
          closePop();
          app.toast(`Loaded "${name}".`, 'ok');
        }), del);
      }))
      : el('p', { class: 'pop-empty muted', text: 'Designs you save here stay in this browser.' });

    const nameInput = el('input', { type: 'text', class: 'num-box', 'aria-label': 'Name for the current design', placeholder: 'Name this design', maxlength: '60' });
    const saveBtn = el('button', { type: 'submit', class: 'btn btn-sm btn-primary', text: 'Save' });
    const form = el('form', { class: 'pop-form' }, nameInput, saveBtn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); app.toast('Type a name first.', 'warn'); return; }
      if (store.saveUserPreset(name)) {
        app.toast(`Saved "${name}" in this browser.`, 'ok');
        renderPop();
      } else app.toast('This browser blocked saving (private mode?). Use Save design instead.', 'warn');
    });

    pop.replaceChildren(
      el('div', { class: 'pop-section section-label', text: 'Examples' }), builtIn,
      el('div', { class: 'pop-divider', role: 'separator' }),
      el('div', { class: 'pop-section section-label', text: 'Saved in this browser' }), userList, form,
    );
  }

  // ── history ──
  const undo = iconButton(ICONS.undo, 'Undo (Ctrl+Z)');
  const redo = iconButton(ICONS.redo, 'Redo (Ctrl+Shift+Z)');
  undo.addEventListener('click', () => store.undo());
  redo.addEventListener('click', () => store.redo());

  // ── files ──
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const res = readDesignFile(await file.text());
      if (!res.ok) { app.toast(`Could not open ${file.name}: ${res.error}`, 'error'); return; }
      store.load(res.params);
      // say what was converted, limited or left out: a plain "Opened" would hide it
      const said = [...(res.notes || [])];
      if (res.ignored && res.ignored.length) {
        const names = res.ignored.slice(0, 6).join(', ') + (res.ignored.length > 6 ? ', …' : '');
        said.push(`Not used by this app and left out: ${names}.`);
      }
      if (!said.length) app.toast(`Opened ${file.name}.`, 'ok');
      else app.toast(`Opened ${file.name}. ${said.join(' ')} Undo goes back.`, res.source === 'crease-gen' && res.drawable !== false ? 'info' : 'warn', { timeout: 0 });
    } catch (e) {
      app.toast(`Could not read ${file.name}.`, 'error');
    }
  });
  const openBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Open a design file (.json)' });
  openBtn.innerHTML = ICONS.open;
  openBtn.append(el('span', { class: 'tb-label', text: 'Open' }));
  openBtn.addEventListener('click', () => fileInput.click());
  const saveBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Save this design as a file (.json)' });
  saveBtn.innerHTML = ICONS.save;
  saveBtn.append(el('span', { class: 'tb-label', text: 'Save design' }));
  saveBtn.addEventListener('click', () => app.exportAs('json'));

  const help = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'How it works, shortcuts and sources' });
  help.innerHTML = ICONS.help;
  help.append(el('span', { class: 'tb-label', text: 'Help & sources' }));
  help.addEventListener('click', () => onHelp && onHelp());

  container.append(
    mark, status, el('span', { class: 'tb-spacer' }),
    presets, el('span', { class: 'tb-sep', 'aria-hidden': 'true' }),
    el('div', { class: 'tb-group', role: 'group', 'aria-label': 'History' }, undo, redo),
    el('span', { class: 'tb-sep', 'aria-hidden': 'true' }),
    el('div', { class: 'tb-group', role: 'group', 'aria-label': 'Design file' }, openBtn, saveBtn, fileInput),
    help,
  );

  function sync() {
    const info = statusInfo(store.design());
    status.className = `chip tb-status ${info.kind}`;
    status.lastChild.textContent = info.label;
    status.title = info.title;
    status.setAttribute('aria-label', info.aria);
    undo.disabled = !store.canUndo();
    redo.disabled = !store.canRedo();
  }
  sync();

  return {
    update(change) { if (!change || change.kind === 'params') sync(); },
    resize() {},
    setActive() {},
  };
}
