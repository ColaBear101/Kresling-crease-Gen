// Application state: design params (with undo/redo) and view state (no history).
//
//   const store = createStore();
//   store.params, store.view                  current values (treat as read-only)
//   store.setParams({ n: 8 })                 normalises, records history, notifies
//   store.setView({ centerTab: '3d' })        notifies, no history
//   store.subscribe(({ kind, keys }) => ...)  kind: 'params' | 'view'
//   store.undo(), store.redo(), store.canUndo(), store.canRedo()
//   store.design(), store.pattern(), store.layout()   memoised derived data

import { normalizeParams, migrateParams, DEFAULTS, materialFields } from '../core/params.js';
import { computeDesign, convertMode } from '../core/design.js';
import { buildPattern } from '../core/pattern.js';
import { layoutPattern } from '../core/layout.js';
import { storage, debounce } from './util.js';

export const STORAGE_KEY = 'kresling-studio:v1';

export const VIEW_DEFAULTS = Object.freeze({
  centerTab: 'pattern',     // 'pattern' | 'mold' | 'explorer'
  rightTab: 'energy',       // 'energy' | 'stiffness' | 'modal' | 'buckling'
  moldTab: 'both',          // 'mountain' | 'valley' | 'both'
  compress: 0,              // 0 = deployed .. 1 = folded (3-D view)
  foldMode: 'uniform',      // 'uniform' | 'sequential'
  animating: false,         // 3-D fold animation running
  autoRotate: false,
  showGrid: true,
  showMV: true,             // colour creases by mountain/valley on screen
  showMountain: true,
  showValley: true,
  showLabels: true,         // dimension labels on the pattern view
  showTiles: true,          // page tiling overlay when the pattern does not fit
});

const MATERIAL_KEYS = new Set(['E', 'nu', 'rho', 'strainMax']);
const COALESCE_MS = 800;

export function createStore(initial) {
  const saved = storage.get(`${STORAGE_KEY}:params`, null);
  // older key names are moved before DEFAULTS fill the gaps (see migrateParams)
  let params = normalizeParams({ ...DEFAULTS, ...migrateParams(saved, { autosaved: true }), ...migrateParams(initial) });
  let view = { ...VIEW_DEFAULTS, ...(storage.get(`${STORAGE_KEY}:view`, null) || {}), animating: false };
  const past = [];
  const future = [];
  let last = { key: null, time: 0 };
  const subs = new Set();
  let memo = {};

  const persist = debounce(() => {
    storage.set(`${STORAGE_KEY}:params`, params);
    const { animating, ...v } = view;
    storage.set(`${STORAGE_KEY}:view`, v);
  }, 250);

  function emit(kind, keys) {
    for (const fn of [...subs]) {
      try { fn({ kind, keys }); } catch (e) { console.error(e); }
    }
  }

  function apply(next, record, coalesceKey) {
    const keys = Object.keys(next).filter((k) => next[k] !== params[k]);
    if (!keys.length) return false;
    if (record) {
      const now = Date.now();
      const same = coalesceKey && keys.length === 1 && last.key === coalesceKey && now - last.time < COALESCE_MS;
      if (!same) {
        past.push(params);
        if (past.length > 200) past.shift();
      }
      last = { key: coalesceKey || null, time: now };
      future.length = 0;
    }
    params = next;
    memo = {};
    persist();
    emit('params', keys);
    return true;
  }

  const store = {
    get params() { return params; },
    get view() { return view; },

    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    /** Change design params. opts.record=false skips history (e.g. while previewing). */
    setParams(partial, opts = {}) {
      let next = { ...params, ...partial };
      if ('designBy' in partial && partial.designBy !== params.designBy) {
        next = { ...next, ...convertMode(params, partial.designBy) };
      }
      if ('material' in partial && partial.material !== params.material) {
        next = { ...next, ...materialFields(partial.material) };
      } else if (Object.keys(partial).some((k) => MATERIAL_KEYS.has(k)) && params.material !== 'custom') {
        next.material = 'custom';
      }
      next = normalizeParams(next);
      const keys = Object.keys(partial);
      return apply(next, opts.record !== false, keys.length === 1 ? keys[0] : null);
    },

    /** Replace all params (preset load, import, reset). */
    load(newParams) {
      return apply(normalizeParams({ ...DEFAULTS, ...migrateParams(newParams) }), true, null);
    },

    reset() { return store.load(DEFAULTS); },

    setView(partial) {
      const keys = Object.keys(partial).filter((k) => partial[k] !== view[k]);
      if (!keys.length) return;
      view = { ...view, ...partial };
      persist();
      emit('view', keys);
    },

    undo() {
      if (!past.length) return false;
      future.push(params);
      params = past.pop();
      memo = {}; last = { key: null, time: 0 };
      persist();
      emit('params', ['*']);
      return true;
    },
    redo() {
      if (!future.length) return false;
      past.push(params);
      params = future.pop();
      memo = {}; last = { key: null, time: 0 };
      persist();
      emit('params', ['*']);
      return true;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    design() { return memo.design || (memo.design = computeDesign(params)); },
    pattern() {
      if (!('pattern' in memo)) memo.pattern = buildPattern(store.design());
      return memo.pattern;
    },
    layout() {
      if (!('layout' in memo)) { const p = store.pattern(); memo.layout = p ? layoutPattern(p, params) : null; }
      return memo.layout;
    },

    /** User presets saved in this browser: { name: params } */
    userPresets() { return storage.get(`${STORAGE_KEY}:presets`, {}) || {}; },
    saveUserPreset(name) {
      const all = store.userPresets();
      all[name] = params;
      return storage.set(`${STORAGE_KEY}:presets`, all);
    },
    deleteUserPreset(name) {
      const all = store.userPresets();
      delete all[name];
      return storage.set(`${STORAGE_KEY}:presets`, all);
    },
  };
  return store;
}
