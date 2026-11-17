#!/usr/bin/env node
// Writes sample exports for every preset into samples/<preset>/ and prints a
// summary table (design numbers, physics, file sizes, mesh checks).
//   node tools/make-samples.mjs [presetKey ...]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, PRESETS, normalizeParams } from '../js/core/params.js';
import { computeDesign } from '../js/core/design.js';
import { buildPattern } from '../js/core/pattern.js';
import { layoutPattern } from '../js/core/layout.js';
import { moldLayout } from '../js/core/mold.js';
import { patternSVG } from '../js/export/svg.js';
import { patternPDF } from '../js/export/pdf.js';
import { patternDXF } from '../js/export/dxf.js';
import { designFile } from '../js/export/json.js';
import { tubeSTL, moldSTL, meshStats } from '../js/export/stl.js';
import { energyAnalysis, phiAtHeightFn, strainCheck } from '../js/physics/analysis.js';
import { modalAnalysis } from '../js/physics/modal.js';
import { bucklingCheck } from '../js/physics/buckling.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['default', ...Object.keys(PRESETS)];
const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));

for (const key of keys) {
  const params = normalizeParams({ ...DEFAULTS, ...(key === 'default' ? {} : PRESETS[key].params) });
  const design = computeDesign(params);
  const dir = join(ROOT, 'samples', key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'design.json'), designFile(params));
  if (!design.valid) { console.log(`${key}: invalid — ${design.errors.join(' ')}`); continue; }
  const pattern = buildPattern(design);
  const layout = layoutPattern(pattern, params);
  const svg = layout.fits ? patternSVG(design, pattern, layout) : patternSVG(design, pattern, layout, { tile: layout.tiles[0] });
  writeFileSync(join(dir, 'pattern.svg'), svg);
  const pdf = patternPDF(design, pattern, layout);
  writeFileSync(join(dir, 'pattern.pdf'), pdf);
  writeFileSync(join(dir, 'pattern.dxf'), patternDXF(design, pattern));
  const phiOfH = phiAtHeightFn(design);
  const tube = tubeSTL(design, { compress: 0, phiOfH });
  writeFileSync(join(dir, 'tube.stl'), Buffer.from(tube));
  const ml = moldLayout(pattern, params);
  const mm = moldSTL(ml, 'mountain'), mv = moldSTL(ml, 'valley');
  writeFileSync(join(dir, 'mold-mountain.stl'), Buffer.from(mm));
  writeFileSync(join(dir, 'mold-valley.stl'), Buffer.from(mv));
  const en = energyAnalysis(design);
  const sc = strainCheck(design);
  const mo = modalAnalysis(design);
  const bk = bucklingCheck(design);
  const ts = meshStats(tube), ms = meshStats(mm);
  const f0 = mo.ok ? mo.states[0].modes.map((m) => `${f(m.f, 1)}${m.kind[0]}`).join(' ') : '—';
  console.log([
    `${key.padEnd(10)} ${design.status.padEnd(10)} L ${f(design.lengths.deployed, 1)}→${f(design.lengths.folded, 1)} mm`,
    `page ${layout.page.name} ${layout.page.orient} fits=${layout.fits} tiles=${layout.tiles.length}`,
    `snap ${en.ok && en.snapForce ? f(en.snapForce.P) : '—'} N barrier ${en.ok && en.barrier ? f(en.barrierFromDeployed) : '—'} mJ strain ${sc.ok ? f(100 * sc.peak) : '—'}%/${sc.ok ? f(100 * sc.limit, 1) : '—'}%`,
    `buckling SF ${bk.ok && bk.safety ? f(bk.safety) : '—'}`,
    `modes(dep) ${f0}`,
    `tube ${ts.triangles} tri watertight=${ts.watertight} vol ${f(ts.volume, 0)} mm³`,
    `mold ${ms.triangles} tri watertight=${ms.watertight}`,
    `pdf ${(pdf.length / 1024).toFixed(0)} KB`,
  ].join(' | '));
}
