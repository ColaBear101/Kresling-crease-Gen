// Share links: a design carried in the URL hash.
//
//   shareHash(params)            -> '#v=1&n=8&dia=60'   (only values that differ from LINK_BASE)
//   shareUrl(params, location?)  -> full link: this page's address, or LIVE_URL when the page
//                                   is not served over http(s) (opened from disk, sandboxed host)
//   readShareHash(hash)          -> null when the hash carries no design,
//                                   { ok: true, params, ignored[] } or { ok: false, error }
//   LIVE_URL                     -> the hosted app
//
// The hash is plain `key=value` pairs, so a link can be read and edited by hand.
// Values are written relative to LINK_BASE, a frozen copy of the defaults at link
// version 1, not to DEFAULTS: if a later version changes a default, an old link still
// opens the same design. Parameters added after version 1 are not in LINK_BASE and
// take their defaults, as they do when an older design file is opened.
// A hand-made link that names a material but none of its values gets that
// material's values (as picking it in the sidebar does).
// Pure module: no DOM access (location is passed in).

import { SCHEMA, RENAMED_KEYS, normalizeParams, materialFields } from '../core/params.js';

export const LIVE_URL = 'https://kreslinggen.vercel.app/';
export const LINK_VERSION = '1';

export const LINK_BASE = Object.freeze({
  designBy: 'heights', n: 6, dia: 40, H0: 24, H1: 8, hFlat: 26, angle: 108.3, chir: 1,
  floors: 6, stack: 1, stacking: 'alternate',
  page: 'A4', orient: 'auto', scale: 100, margin: 8, ringBottom: 10, ringTop: 10,
  seamAuto: true, extcols: 1, seamL: 14, seamR: 0,
  material: 'paper80', thick: 100, E: 3.5, nu: 0.3, rho: 0.8, strainMax: 1.5,
  hingeW: 2, panel: 'thin', restPct: 50,
  payload: 5, endCond: 'fixed-free', safety: 1.5,
  wall: 0.8, moldBase: 3, ridgeH: 1.2, ridgeW: 0.8, ridgeGap: 1,
});

const SCHEMA_KEYS = SCHEMA.map((s) => s.key);
const KNOWN = new Set([...SCHEMA_KEYS, ...Object.keys(RENAMED_KEYS)]);
const MATERIAL_VALUES = ['thick', 'E', 'nu', 'rho', 'strainMax'];

function same(a, b) {
  return String(a) === String(b);
}

/** '#v=1&…' with every parameter that differs from LINK_BASE, in schema order. */
export function shareHash(params) {
  const p = normalizeParams(params || {});
  const q = new URLSearchParams();
  q.set('v', LINK_VERSION);
  for (const key of SCHEMA_KEYS) {
    const base = key in LINK_BASE ? LINK_BASE[key] : SCHEMA.find((s) => s.key === key).default;
    if (!same(p[key], base)) q.set(key, typeof p[key] === 'boolean' ? (p[key] ? '1' : '0') : String(p[key]));
  }
  return `#${q.toString()}`;
}

/**
 * The link to share. loc is window.location (or any { protocol, origin, pathname, search });
 * pages that are not served over http(s) link to the hosted app instead.
 */
export function shareUrl(params, loc) {
  const web = loc && /^https?:$/.test(loc.protocol || '') && loc.origin && loc.origin !== 'null';
  const base = web ? `${loc.origin}${loc.pathname || '/'}${loc.search || ''}` : LIVE_URL;
  return `${base}${shareHash(params)}`;
}

/** Read a design from a URL hash. null when the hash is not a share link. */
export function readShareHash(hash) {
  if (typeof hash !== 'string') return null;
  const text = hash.replace(/^#/, '').trim();
  if (!text) return null;
  let q;
  try { q = new URLSearchParams(text); } catch { return null; }
  if (!q.has('v')) return null;
  const v = q.get('v');
  if (v !== LINK_VERSION) {
    return { ok: false, error: `This link was made by a newer version of the app (link version ${v}). Open it on ${LIVE_URL}` };
  }
  const raw = {};
  const ignored = [];
  for (const [key, value] of q) {
    if (key === 'v') continue;
    if (KNOWN.has(key)) raw[key] = value;
    else ignored.push(key);
  }
  if ('material' in raw && !MATERIAL_VALUES.some((k) => k in raw)) Object.assign(raw, materialFields(raw.material));
  return { ok: true, params: normalizeParams({ ...LINK_BASE, ...raw }), ignored };
}
