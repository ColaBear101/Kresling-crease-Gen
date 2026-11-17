#!/usr/bin/env node
// Bundles the app into single HTML files (no dependencies, no network).
//
//   node tools/build.mjs
//
// Outputs
//   dist/kresling.html   standalone document; opens straight from disk (file://)
//   dist/artifact.html   the same page without <!doctype>/<html>/<head>/<body>,
//                        for hosts that wrap the page in their own skeleton
//
// The source is plain ES modules, so the bundler only has to understand the
// subset this project uses (enforced below; anything else is a build error):
//   import { a, b as c } from './x.js';      import * as ns from './x.js';
//   export function f() {}   export async function f() {}   export class C {}
//   export const x = ...;    export let y = ...;            export { a, b as c };
// Each module becomes an IIFE whose return value is its export object, emitted
// in dependency order. Circular imports are rejected.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'js/main.js';
const HTML = 'index.html';

const rel = (abs) => relative(ROOT, abs).split('\\').join('/');

function fail(msg) {
  console.error(`build: ${msg}`);
  process.exit(1);
}

const IMPORT_RE = /^import\s+(?:(\{[\s\S]*?\})|\*\s+as\s+([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const BARE_IMPORT_RE = /^import\s+['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT_DECL_RE = /^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([\s\S]*?)\};?[ \t]*$/gm;

function parseModule(path, stack, graph, order) {
  if (graph.has(path)) {
    if (stack.includes(path)) fail(`circular import: ${[...stack, path].join(' -> ')}`);
    return;
  }
  const abs = join(ROOT, path);
  if (!existsSync(abs)) fail(`missing module ${path} (imported from ${stack[stack.length - 1] || 'entry'})`);
  let src = readFileSync(abs, 'utf8');
  if (/\bimport\s*\(/.test(src)) fail(`${path}: dynamic import() is not supported`);
  if (/\bimport\.meta\b/.test(src)) fail(`${path}: import.meta is not supported`);
  if (/^export\s+default\b/m.test(src)) fail(`${path}: export default is not supported (use named exports)`);

  const deps = [];
  const header = [];
  const exportsList = [];

  src = src.replace(IMPORT_RE, (m, braces, ns, spec) => {
    const dep = resolveSpec(path, spec);
    deps.push(dep);
    if (ns) {
      header.push(`const ${ns} = __m[${JSON.stringify(dep)}];`);
    } else {
      const names = braces.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        const mm = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (!mm) fail(`${path}: cannot parse import specifier "${s}"`);
        return mm[2] ? `${mm[1]}: ${mm[2]}` : mm[1];
      });
      header.push(`const { ${names.join(', ')} } = __m[${JSON.stringify(dep)}];`);
    }
    return '';
  });
  src = src.replace(BARE_IMPORT_RE, (m, spec) => {
    deps.push(resolveSpec(path, spec));
    return '';
  });
  if (/^import\b/m.test(src)) fail(`${path}: unsupported import form: ${src.match(/^import.*$/m)[0]}`);

  src = src.replace(EXPORT_DECL_RE, (m, kind, name) => {
    exportsList.push([name, name]);
    return m.replace(/^export\s+/, '');
  });
  src = src.replace(EXPORT_LIST_RE, (m, inner) => {
    for (const s of inner.split(',').map((x) => x.trim()).filter(Boolean)) {
      const mm = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!mm) fail(`${path}: cannot parse export specifier "${s}"`);
      exportsList.push([mm[2] || mm[1], mm[1]]);
    }
    return '';
  });
  if (/^export\b/m.test(src)) fail(`${path}: unsupported export form: ${src.match(/^export.*$/m)[0]}`);

  graph.set(path, { deps, header, src, exportsList });
  for (const d of deps) parseModule(d, [...stack, path], graph, order);
  order.push(path);
}

function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) fail(`${from}: only relative imports are supported ("${spec}")`);
  return posix.normalize(posix.join(posix.dirname(from), spec));
}

function bundle() {
  const graph = new Map();
  const order = [];
  parseModule(ENTRY, [], graph, order);
  const parts = ['"use strict";', 'const __m = Object.create(null);'];
  for (const path of order) {
    const { header, src, exportsList } = graph.get(path);
    const ret = exportsList.map(([pub, local]) => (pub === local ? local : `${pub}: ${local}`)).join(', ');
    parts.push(`// ── ${path} ──`);
    parts.push(`__m[${JSON.stringify(path)}] = (() => {\n${header.join('\n')}\n${src.trim()}\nreturn Object.freeze({ ${ret} });\n})();`);
  }
  return { code: parts.join('\n'), modules: order };
}

function inlineHtml(code) {
  let html = readFileSync(join(ROOT, HTML), 'utf8');
  // stylesheets: <link rel="stylesheet" href="css/...">  (Google Fonts links stay)
  html = html.replace(/<link\s+rel="stylesheet"\s+href="(?!https?:)([^"]+)"\s*\/?>/g, (m, href) => {
    const css = readFileSync(join(ROOT, href), 'utf8');
    return `<style>\n${css.trim()}\n</style>`;
  });
  const tag = '<script type="module" src="js/main.js"></script>';
  if (!html.includes(tag)) fail(`index.html must load the app with exactly: ${tag}`);
  // keep "</script" out of the inline script body
  const safe = code.replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, () => `<script>\n${safe}\n</script>`);
  return html;
}

function artifactVersion(full) {
  // strip the document skeleton but keep head content (title, meta, styles) first
  const head = (full.match(/<head>([\s\S]*?)<\/head>/i) || [, ''])[1];
  const body = (full.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, ''])[1];
  const keepHead = head
    .replace(/<meta\s+charset[^>]*>\s*/i, '')
    .replace(/<meta\s+name="viewport"[^>]*>\s*/i, '');
  return `${keepHead.trim()}\n${body.trim()}\n`;
}

const { code, modules } = bundle();
const full = inlineHtml(code);
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(join(ROOT, 'dist/kresling.html'), full);
writeFileSync(join(ROOT, 'dist/artifact.html'), artifactVersion(full));
console.log(`build: ${modules.length} modules -> dist/kresling.html (${(full.length / 1024).toFixed(0)} KB), dist/artifact.html`);
