#!/usr/bin/env node
// Runs every test file (test/*.test.mjs), each in its own Node process, and
// prints one summary line per file.
//
//   node tools/test.mjs              all files
//   node tools/test.mjs tube export  only the files whose names contain these words
//   node tools/test.mjs --verbose    also print every passing test
//
// Exit code 1 when any file fails. A failing file prints its whole output.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const words = args.filter((a) => !a.startsWith('--'));

const files = readdirSync(join(ROOT, 'test'))
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !words.length || words.some((w) => f.includes(w)))
  .sort();

if (!files.length) {
  console.error(`test: no test file matches ${words.join(', ')}`);
  process.exit(1);
}

let failedFiles = 0;
let passed = 0;
let total = 0;
const started = Date.now();
for (const f of files) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [join('test', f)], { cwd: ROOT, encoding: 'utf8' });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const m = out.match(/(\d+)\/(\d+) passed/);
  const ok = res.status === 0 && Boolean(m);
  if (m) { passed += Number(m[1]); total += Number(m[2]); }
  const name = f.replace('.test.mjs', '').padEnd(10);
  const secs = `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name} ${m ? `${m[1]}/${m[2]}`.padStart(7) : '    ---'}   ${secs}`);
  if (!ok) { failedFiles += 1; console.log(out.replace(/^/gm, '      ')); }
  else if (verbose) console.log(out.trimEnd().replace(/^/gm, '      '));
}
console.log(`\n${passed}/${total} tests passed in ${files.length} files (${((Date.now() - started) / 1000).toFixed(1)} s)`);
if (failedFiles) process.exitCode = 1;
