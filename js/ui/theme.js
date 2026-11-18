// Theme access for canvas drawing. All colours live as CSS custom properties
// on :root (see css/app.css); canvases read them here so light and dark
// themes both work and nothing hard-codes a colour.

import { storage } from '../app/util.js';

const cache = new Map();

/** Value of a CSS custom property, e.g. cssVar('--ink'). */
export function cssVar(name) {
  if (cache.has(name)) return cache.get(name);
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  cache.set(name, v);
  return v;
}

/** Colours for drawing ON THE PAPER SHEET: print colours, identical in both themes. */
export const PRINT = Object.freeze({
  mountain: '#d0342c',
  valley: '#1f5fd1',
  cut: '#16181d',
  end: '#d0342c',
  glue: '#f2e6c9',          // seam-strip tint
  tab: '#8a8f98',
  text: '#16181d',
  textMuted: '#5b616b',
  grid: 'rgba(31, 95, 209, 0.08)',
  paper: '#ffffff',
});

/** Dash patterns (in mm at 100% scale) shared by the screen view and every exporter. */
export const DASH = Object.freeze({
  mountain: [],            // solid red
  valley: [2.4, 1.6],      // dashed blue
  end: [3, 1, 0.6, 1],     // dash-dot red: end-ring fold
  cut: [],                 // solid black
});

const listeners = new Set();
/** Call fn whenever the effective theme changes (system setting or data-theme attribute). */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function fire() { cache.clear(); for (const fn of listeners) fn(); }
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', fire);
  new MutationObserver(fire).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
}

// ── Theme preference: 'auto' (follow the system), 'light' or 'dark' ──
// Kept in this browser; index.html applies a saved choice before the first paint
// (same key), so the page does not flash in the other theme.
export const THEME_KEY = 'kresling-studio:v1:theme';
export const THEME_PREFS = ['auto', 'light', 'dark'];

export function themePref() {
  const v = storage.get(THEME_KEY, 'auto');
  return THEME_PREFS.includes(v) ? v : 'auto';
}

/** Apply and remember a preference. Canvases redraw through onThemeChange. */
export function setThemePref(pref) {
  const p = THEME_PREFS.includes(pref) ? pref : 'auto';
  if (p === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', p);
  storage.set(THEME_KEY, p);   // false in private mode: the choice then lasts for this visit
  return p;
}

/** auto -> light -> dark -> auto */
export function nextThemePref(pref = themePref()) {
  return THEME_PREFS[(THEME_PREFS.indexOf(pref) + 1) % THEME_PREFS.length];
}
