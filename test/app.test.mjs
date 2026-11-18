// Checks of the app-level helpers that run without a browser: share links
// (js/app/share.js), keyboard shortcuts (js/ui/shortcuts.js) and file names
// (fileStem in js/app/util.js).
import { shareHash, shareUrl, readShareHash, LINK_BASE, LIVE_URL } from '../js/app/share.js';
import { keyAction, SHORTCUTS } from '../js/ui/shortcuts.js';
import { fileStem } from '../js/app/util.js';
import { DEFAULTS, PRESETS, SCHEMA, MATERIALS, normalizeParams } from '../js/core/params.js';
import { test, ok, eq, run } from './harness.mjs';

const json = (x) => JSON.stringify(x);

test('LINK_BASE covers every parameter and equals the defaults it was frozen from', () => {
  for (const s of SCHEMA) ok(s.key in LINK_BASE, `LINK_BASE lacks ${s.key}`);
  for (const k of Object.keys(LINK_BASE)) ok(SCHEMA.some((s) => s.key === k), `LINK_BASE has unknown key ${k}`);
  // When a default changes on purpose, LINK_BASE must stay as it is (old links keep
  // their meaning); update this test then, not LINK_BASE.
  eq(json(normalizeParams(LINK_BASE)), json(DEFAULTS), 'defaults moved away from link version 1: ');
});

test('the default design makes the shortest link, and it opens the defaults', () => {
  eq(shareHash(DEFAULTS), '#v=1');
  const back = readShareHash('#v=1');
  ok(back && back.ok, 'opens');
  eq(json(back.params), json(DEFAULTS));
});

test('every preset survives a round trip through a link', () => {
  for (const [key, pr] of Object.entries(PRESETS)) {
    const params = normalizeParams({ ...DEFAULTS, ...pr.params });
    const back = readShareHash(shareHash(params));
    ok(back && back.ok, `${key} opens`);
    eq(json(back.params), json(params), `${key}: `);
  }
});

test('odd values survive too: left-handed, booleans, decimals, other materials', () => {
  const params = normalizeParams({
    ...DEFAULTS, chir: -1, seamAuto: false, dia: 37.5, angle: 101.7, material: 'custom',
    E: 2.25, page: 'Letter', orient: 'landscape', panel: 'stiff', wall: 0.01,
  });
  const hash = shareHash(params);
  ok(hash.includes('chir=-1') && hash.includes('seamAuto=0'), hash);
  eq(json(readShareHash(hash).params), json(params));
});

test('links are readable key=value pairs in schema order', () => {
  const hash = shareHash({ ...DEFAULTS, n: 8, dia: 60, floors: 4 });
  eq(hash, '#v=1&n=8&dia=60&floors=4');
});

test('a hand-made link that names a material gets that material\'s values', () => {
  const mat = Object.keys(MATERIALS).find((k) => k !== 'custom' && k !== DEFAULTS.material);
  const back = readShareHash(`#v=1&material=${mat}`);
  ok(back.ok);
  eq(back.params.material, mat);
  eq(back.params.E, MATERIALS[mat].E, 'E');
  eq(back.params.strainMax, MATERIALS[mat].strainMax, 'strain limit');
});

test('hashes that are not links are ignored; bad links say why', () => {
  for (const h of [undefined, '', '#', '#src-keys', '#n=8']) eq(readShareHash(h), null, `${h}: `);
  const newer = readShareHash('#v=2&n=8');
  ok(newer && !newer.ok && /newer version/.test(newer.error), 'newer link version');
  const extra = readShareHash('#v=1&n=8&colour=red');
  ok(extra.ok);
  eq(json(extra.ignored), json(['colour']));
  eq(extra.params.n, 8);
  const clamped = readShareHash('#v=1&n=99&dia=abc');
  eq(clamped.params.n, 20, 'clamped to the slider range');
  eq(clamped.params.dia, LINK_BASE.dia, 'unreadable value falls back');
});

test('share URLs point at this page over http(s), at the online app otherwise', () => {
  const params = { ...DEFAULTS, n: 7 };
  eq(shareUrl(params, { protocol: 'https:', origin: 'https://example.org', pathname: '/kresling/', search: '' }),
    'https://example.org/kresling/#v=1&n=7');
  eq(shareUrl(params, { protocol: 'file:', origin: 'null', pathname: '/C:/dist/kresling.html', search: '' }), `${LIVE_URL}#v=1&n=7`);
  eq(shareUrl(params, null), `${LIVE_URL}#v=1&n=7`);
});

test('keyboard: new shortcuts map to actions and are listed in the help', () => {
  const k = (key, extra = {}) => keyAction({ key, ...extra });
  eq(json(k('l')), json({ type: 'share' }));
  eq(json(k('L', { shiftKey: true })), json({ type: 'share' }));
  eq(json(k('t')), json({ type: 'theme' }));
  eq(json(k('?', { shiftKey: true })), json({ type: 'help' }));
  eq(k('l', { ctrlKey: true }), null, 'Ctrl+L stays with the browser');
  eq(k('t', { altKey: true }), null);
  eq(json(k('z', { ctrlKey: true })), json({ type: 'undo' }));
  eq(json(k('6')), json({ type: 'sides', arg: 6 }));
  const listed = SHORTCUTS.flatMap((s) => s.keys);
  for (const key of ['L', 'T', '?']) ok(listed.includes(key), `help lists ${key}`);
});

test('file names say what differs between prints of one design', () => {
  eq(fileStem(DEFAULTS), 'kresling_n6_d40_f6');
  eq(fileStem({ ...DEFAULTS, dia: 40.5, stack: 2 }), 'kresling_n6_d40p5_f6x2');
  eq(fileStem({ ...DEFAULTS, chir: -1 }), 'kresling_n6_d40_f6_left');
  eq(fileStem({ ...DEFAULTS, scale: 80 }), 'kresling_n6_d40_f6', 'design-size files ignore the print scale');
  eq(fileStem({ ...DEFAULTS, scale: 80 }, { scaled: true }), 'kresling_n6_d40_f6_80pct');
  eq(fileStem({ ...DEFAULTS, scale: 100 }, { scaled: true }), 'kresling_n6_d40_f6');
  eq(fileStem({ ...DEFAULTS, chir: -1, scale: 125 }, { scaled: true }), 'kresling_n6_d40_f6_left_125pct');
  for (const name of [fileStem({ ...DEFAULTS, dia: 12.5, chir: -1, scale: 55 }, { scaled: true })]) {
    ok(/^[a-z0-9_]+$/.test(name), `safe file name: ${name}`);
  }
});

run();
