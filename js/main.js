// Boot: store, app object, views, tabs, shortcuts, share links, file drop.
//
// Every view follows the mount protocol in docs/ARCHITECTURE.md §7. A view that
// fails to mount shows an error in its own pane; the rest keeps working.
// Hidden panes are marked dirty and refreshed when they are shown again.
// A share link (#v=1&…, see js/app/share.js) opens its design on load and when
// the hash changes; the hash is then cleared so later edits do not contradict it.

import { createStore } from './app/store.js';
import { el } from './app/util.js';
import { readShareHash } from './app/share.js';
import { onThemeChange } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { saveFile, saveMessage, primeSaving } from './export/save.js';
import { mountControls } from './ui/controls.js';
import { mountToolbar, copyShareLink, cycleTheme } from './ui/toolbar.js';
import { installDropOpen } from './ui/openfile.js';
import { mountSectionNav } from './ui/sectionnav.js';
import { mountActions, makeExporter, fitToPage } from './ui/actions.js';
import { mountSources } from './ui/sources.js';
import { installShortcuts } from './ui/shortcuts.js';
import { mountFlatView } from './render/flat.js';
import { mountMoldView } from './render/moldview.js';
import { mountView3d } from './render/view3d.js';
import { mountAnalysis } from './ui/panels.js';
import { mountExplorer } from './ui/explorer.js';

const CENTER = { pattern: 'pane-pattern', mold: 'pane-mold', explorer: 'pane-explorer' };

function boot() {
  const store = createStore();
  const app = {
    store,
    toast: (message, kind = 'info', opts) => toast(message, kind, opts),
    async save(filename, data, mime) {
      const res = await saveFile(filename, data, mime);
      toast(saveMessage(res), res.ok ? 'ok' : res.code === 'declined' ? 'info' : 'warn');
      return res;
    },
    exportAs: null,
  };
  app.exportAs = makeExporter(app);
  primeSaving();

  const views = [];   // { name, view, el, active, dirty }

  function mount(name, id, fn, ...args) {
    const host = document.getElementById(id);
    if (!host) return null;
    try {
      const view = fn(host, app, ...args);
      const rec = { name, view, el: host, active: !host.hidden, dirty: false };
      views.push(rec);
      return rec;
    } catch (e) {
      console.error(`${name} failed to start`, e);
      host.replaceChildren(el('div', { class: 'empty-state pane-error' },
        el('strong', { text: `The ${name} could not start.` }),
        el('span', { class: 'muted', text: String(e && e.message ? e.message : e) })));
      return null;
    }
  }

  const sources = mountSources(document.getElementById('sources'));
  mount('top bar', 'topbar', mountToolbar, { onHelp: () => sources.open() });
  mount('controls', 'sidebar', mountControls);
  mount('pattern view', CENTER.pattern, mountFlatView);
  mount('mold view', CENTER.mold, mountMoldView);
  mount('explorer', CENTER.explorer, mountExplorer);
  mount('3-D view', 'pane-3d', mountView3d);
  mount('analysis panel', 'pane-analysis', mountAnalysis);
  mount('export bar', 'actions', mountActions);
  mount('section bar', 'section-nav', mountSectionNav);

  function deliver(rec, change) {
    try { rec.view.update(change); } catch (e) { console.error(`${rec.name} update failed`, e); }
  }

  // ── centre tabs ──
  const tabs = [...document.querySelectorAll('#center-tabs [data-tab]')];
  function showCenter(tab) {
    const key = CENTER[tab] ? tab : 'pattern';
    for (const t of tabs) {
      const on = t.dataset.tab === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    for (const [k, id] of Object.entries(CENTER)) {
      const host = document.getElementById(id);
      const on = k === key;
      host.hidden = !on;
      const rec = views.find((v) => v.el === host);
      if (!rec || rec.active === on) continue;
      rec.active = on;
      try { rec.view.setActive(on); } catch (e) { console.error(e); }
      if (on && rec.dirty) { rec.dirty = false; deliver(rec, { kind: 'params', keys: ['*'] }); }
      if (on) { try { rec.view.resize(); } catch (e) { console.error(e); } }
    }
  }
  for (const t of tabs) {
    t.addEventListener('click', () => store.setView({ centerTab: t.dataset.tab }));
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      store.setView({ centerTab: tabs[j].dataset.tab });
      tabs[j].focus();
    });
  }
  showCenter(store.view.centerTab);

  // ── store -> views ──
  store.subscribe((change) => {
    if (change.kind === 'view' && change.keys.includes('centerTab')) showCenter(store.view.centerTab);
    for (const rec of views) {
      if (!rec.active && change.kind === 'params') { rec.dirty = true; continue; }
      if (!rec.active) continue;
      deliver(rec, change);
    }
  });
  onThemeChange(() => { for (const rec of views) if (rec.active) deliver(rec, { kind: 'theme', keys: [] }); });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rec = views.find((v) => v.el === entry.target);
        if (rec && rec.active) { try { rec.view.resize(); } catch (e) { console.error(e); } }
      }
    });
    for (const rec of views) ro.observe(rec.el);
  }

  installShortcuts(app, {
    fit: () => fitToPage(app),
    share: () => copyShareLink(app),
    theme: () => cycleTheme(app),
    help: () => sources.open(),
  });
  installDropOpen(app);

  // ── share links ──
  function clearHash() {
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* sandboxed */ }
  }
  function openSharedLink() {
    const res = readShareHash(window.location.hash);
    if (!res) return false;
    clearHash();
    if (!res.ok) { toast(res.error, 'warn', { timeout: 0 }); return false; }
    const changed = store.load(res.params);   // recorded: Undo goes back to the design that was open
    const left = res.ignored.length ? ` Not used by this app and left out: ${res.ignored.join(', ')}.` : '';
    toast(`Opened the design from the link.${changed ? ' Undo goes back to the previous one.' : ''}${left}`, 'ok');
    return true;
  }
  window.addEventListener('hashchange', openSharedLink);
  openSharedLink();

  if (store.design().valid === false) toast(store.design().errors[0], 'warn');
  window.__kresling = app;   // handy in the console
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
