// Export bar and the export pipeline.
//
//   makeExporter(app) -> exportAs(format) -> Promise<result | null>
//       format: 'svg' | 'pdf' | 'png' | 'dxf' | 'stl-tube' | 'stl-molds' | 'json' | 'pack'
//       Builds the files for the current design and saves them through app.save
//       (several files go into one .zip).
//   fitToPage(app) -> sets params.scale so the pattern fits one page
//   mountActions(container, app) -> { update(change), resize(), setActive() }
//   assemblyNotes(design, pattern, layout) -> README text for the fabrication pack

import { el, fileStem, fmt } from '../app/util.js';
import { autoFitPercent, layoutPattern } from '../core/layout.js';
import { moldLayout, moldNotes } from '../core/mold.js';
import { APP_NAME, APP_VERSION } from '../core/params.js';
import { patternSVG, sceneSVG, infoScene, needsInfoPage } from '../export/svg.js';
import { patternPDF } from '../export/pdf.js';
import { patternPNG, scenePNG } from '../export/png.js';
import { patternDXF } from '../export/dxf.js';
import { designFile } from '../export/json.js';
import { tubeSTL, moldSTL } from '../export/stl.js';
import { zipFiles } from '../export/zip.js';
import { phiAtHeightFn, energyAnalysis } from '../physics/analysis.js';

const f1 = (x) => fmt(x, 1);
const f2 = (x) => fmt(x, 2);

/**
 * File names of the SVG export: one sheet, or one per page when it is tiled, plus
 * the legend page whenever no pattern page has room for it.
 */
export function svgNames(layout, base) {
  const pages = layout.fits ? [`${base}.svg`] : layout.tiles.map((_, i) => `${base}_page${i + 1}.svg`);
  return needsInfoPage(layout) ? [...pages, `${base}_legend.svg`] : pages;
}

// One FILES row of the pack README: names in a 40-character column, then the text
// (names that do not fit go on a line of their own).
function fileRow(names, text) {
  return names.length < 40 ? [`  ${names.padEnd(40)}${text}`] : [`  ${names}`, `  ${''.padEnd(40)}${text}`];
}

// "10.0 mm end rings", "end rings (bottom 10.0 mm, top 20.0 mm)", "10.0 mm bottom ring", "20.0 mm top ring"
function ringWords(rb, rt) {
  if (rb > 0 && rt > 0) return rb === rt ? `${f1(rb)} mm end rings` : `end rings (bottom ${f1(rb)} mm, top ${f1(rt)} mm)`;
  if (rb > 0) return `${f1(rb)} mm bottom ring`;
  return rt > 0 ? `${f1(rt)} mm top ring` : '';
}

// Numbered folding steps for the sheet as drawn (seam strips and end rings optional).
function foldSteps(design, pattern) {
  const L = design.lengths;
  const steps = [
    ['Score every crease with a dull point (an empty ballpoint) against a ruler.'],
    ['Cut along the solid black outline.'],
    ['Printed side up: fold the red solid lines as mountains (ridge toward you) and the',
      'blue dashed lines as valleys. Folding each line both ways once makes the final fold easier.'],
  ];
  const { bottom: rb, top: rt } = pattern.rings;
  if (rb > 0 && rt > 0) {
    steps.push([`Fold the red dash-dot lines, where the ${ringWords(rb, rt)} meet the body, as ${pattern.endKind}s.`]);
  } else if (rb > 0 || rt > 0) {
    steps.push([`Fold the red dash-dot line, where the ${ringWords(rb, rt)} meets the body, as a ${pattern.endKind}.`]);
  }
  const strips = pattern.seams ? pattern.seams.length : 0;
  steps.push(strips
    ? [`Roll the sheet into a tube with the print outside. Glue the shaded seam strip${strips > 1 ? 's' : ''} over the other end`,
      'of the sheet, crease on crease, so the creases run on unbroken across the seam.']
    : ['Roll the sheet into a tube with the print outside and tape its two straight edges together.']);
  if (rb > 0 && rt > 0) {
    steps.push(['The plain bands at the top and bottom now close into rings. Use them to glue on end caps,',
      'mount the tube, or join it to another tube.']);
  } else if (rb > 0 || rt > 0) {
    steps.push([`The plain band at the ${rb > 0 ? 'bottom' : 'top'} now closes into a ring. Use it to glue on an end cap,`,
      'mount the tube, or join it to another tube.']);
  }
  steps.push(design.bistable
    ? [`Push the ends together with a twist: each floor turns ${f1(Math.abs(design.twist.foldedDeg - design.twist.deployedDeg))}° and drops from ${f1(L.floorDeployed)} mm to ${f1(L.floorFolded)} mm.`]
    : ['Push the ends together with a twist: each floor turns and shortens; this design has one stable state and springs back.']);
  return steps.flatMap((s, i) => s.map((line, j) => (j === 0 ? `  ${i + 1}. ${line}` : `     ${line}`)));
}

// The pack's SVG files for the README (page files as a range).
function svgList(layout) {
  const names = svgNames(layout, 'pattern');
  if (layout.fits) return names.join(', ');
  const n = layout.tiles.length;
  return [`pattern_page1.svg ... pattern_page${n}.svg`, ...names.slice(n)].join(', ');
}

export function assemblyNotes(design, pattern, layout) {
  const p = design.params;
  const L = design.lengths;
  const hand = design.chir > 0 ? 'right-handed' : 'left-handed';
  const en = energyAnalysis(design);
  const scaled = Math.abs(layout.scale - 1) > 1e-9;
  const pct = `${f1(layout.scale * 100)}%`;
  const floors = p.stack > 1 ? `${p.floors * p.stack} floors (${p.stack} x ${p.floors}) on one sheet` : `${p.floors} floors`;
  const legendPage = needsInfoPage(layout);
  const ml = moldLayout(pattern, p);
  const lines = [
    `Kresling tube: n = ${design.n}, diameter ${f1(design.D)} mm, ${floors}, ${hand}`,
    `Made with ${APP_NAME} ${APP_VERSION}`,
    '',
    'FILES',
    ...fileRow(`pattern.pdf, ${svgList(layout)}`, `crease pattern${scaled ? ` at ${pct}` : ''}, the whole tube on one sheet`),
    `  pattern.dxf                             the same sheet for cutters and CAD, in mm${scaled ? ` at ${pct}` : ''}`,
    '  tube.stl                                the tube in its deployed state, wall ' + f1(p.wall) + ' mm'
      + (p.ringBottom > 0 || p.ringTop > 0 ? `, with its ${ringWords(p.ringBottom, p.ringTop)}` : '') + (scaled ? ' (design size, not scaled)' : ''),
    `  mold-mountain.stl, mold-valley.stl      embossing plates for pre-creasing${scaled ? `, made for the sheet at ${pct}` : ''}`,
    '  design.json                             open in Kresling Studio to keep editing',
    '',
    'PRINT',
    `  Print at 100% (actual size), no "fit to page"${scaled ? `: the files are already drawn at ${pct}` : ''}. The scale bar must measure ${f1(50 * layout.scale)} mm.`,
    layout.fits ? `  One ${layout.page.name} page, ${layout.page.orient}.`
      : `  ${layout.tiles.length} ${layout.page.name} pages: trim the overlap strips and tape the pages so the alignment crosses meet.`,
    legendPage ? '  The last page of the PDF has the legend and the scale bar.' : '',
    ...(design.notes || []).map((n) => `  Note: ${n}`),
    ...moldNotes(ml).filter((n) => !/^Sized for/.test(n)).map((n) => `  Molds: ${n}`),
    '',
    'FOLD',
    ...foldSteps(design, pattern),
    '',
    'NUMBERS',
    `  Deployed length ${f1(L.deployed)} mm` + (L.folded === null ? '' : `, folded ${f1(L.folded)} mm, stroke ${f1(L.stroke)} mm`),
    `  Crease lengths: polygon ${f2(design.a)} mm, long diagonal ${f2(design.strip.b)} mm, short diagonal ${f2(design.strip.c)} mm`,
    `  Crease angle ${f2(design.strip.angleDeg)}°` + (design.tolerance ? `; 1° of error moves the folded floor height by about ${f1(design.tolerance.foldedPerDeg)} mm` : ''),
    `  Sheet: ${design.material.label}, ${p.thick} µm` + (en.ok && en.snapForce ? `; predicted snap force about ${f1(en.snapForce.P)} N` : ''),
    '  Forces come from an idealised model; sharp, well-scored creases snap more easily.',
  ];
  return lines.filter((l) => l !== '').join('\n').replace(/\n(FILES|PRINT|FOLD|NUMBERS)/g, '\n\n$1') + '\n';
}

export function makeExporter(app) {
  const { store } = app;

  function current() {
    const design = store.design();
    if (!design.valid) {
      app.toast(design.errors[0] || 'Fix the design before exporting.', 'warn');
      return null;
    }
    return { design, pattern: store.pattern(), layout: store.layout(), params: store.params };
  }

  // The files svgNames() names: the sheet or its pages, then the legend page when needed.
  function svgFiles(c, base) {
    const names = svgNames(c.layout, base);
    const files = c.layout.fits
      ? [{ name: names[0], data: patternSVG(c.design, c.pattern, c.layout) }]
      : c.layout.tiles.map((t, i) => ({ name: names[i], data: patternSVG(c.design, c.pattern, c.layout, { tile: t }) }));
    if (needsInfoPage(c.layout)) files.push({ name: names[names.length - 1], data: sceneSVG(infoScene(c.design, c.pattern, c.layout)) });
    return files;
  }

  // The PNG is one sheet (a tiled pattern is drawn whole, its legend underneath); a
  // sheet that fills its page gets the legend page as a second PNG.
  async function pngFiles(c, stem) {
    const files = [{ name: `${stem}.png`, data: await patternPNG(c.design, c.pattern, c.layout, { dpi: 300 }) }];
    if (c.layout.fits && needsInfoPage(c.layout)) {
      files.push({ name: `${stem}_legend.png`, data: await scenePNG(infoScene(c.design, c.pattern, c.layout), { dpi: 300 }) });
    }
    return files;
  }

  function molds(c, prefix) {
    const ml = moldLayout(c.pattern, c.params);
    const notes = moldNotes(ml);
    if (notes.length) app.toast(`Mold plates: ${notes.join(' ')}`, ml.ridgeClamped ? 'warn' : 'info');
    return [
      { name: `${prefix}mold-mountain.stl`, data: moldSTL(ml, 'mountain') },
      { name: `${prefix}mold-valley.stl`, data: moldSTL(ml, 'valley') },
    ];
  }

  async function build(format, c, stem) {
    switch (format) {
      case 'svg': return svgFiles(c, stem);
      case 'pdf': return [{ name: `${stem}.pdf`, data: patternPDF(c.design, c.pattern, c.layout) }];
      case 'png': return pngFiles(c, stem);
      case 'dxf': return [{ name: `${stem}.dxf`, data: patternDXF(c.design, c.pattern, { scale: c.layout.scale }) }];
      case 'json': return [{ name: `${stem}.json`, data: designFile(c.params) }];
      case 'stl-tube': return [{ name: `${stem}_tube.stl`, data: tubeSTL(c.design, { compress: 0, phiOfH: phiAtHeightFn(c.design) }) }];
      case 'stl-molds': return molds(c, `${stem}_`);
      case 'pack': return [
        ...svgFiles(c, 'pattern'),
        { name: 'pattern.pdf', data: patternPDF(c.design, c.pattern, c.layout) },
        { name: 'pattern.dxf', data: patternDXF(c.design, c.pattern, { scale: c.layout.scale }) },
        { name: 'tube.stl', data: tubeSTL(c.design, { compress: 0, phiOfH: phiAtHeightFn(c.design) }) },
        ...molds(c, ''),
        { name: 'design.json', data: designFile(c.params) },
        { name: 'README.txt', data: assemblyNotes(c.design, c.pattern, c.layout) },
      ];
      default: throw new Error(`Unknown export format "${format}".`);
    }
  }

  const ZIP_NAME = { svg: '_svg-pages', png: '_png', 'stl-molds': '_molds', pack: '_fabrication-pack' };

  return async function exportAs(format) {
    const c = current();
    if (!c) return null;
    const stem = fileStem(c.params);
    let files;
    try {
      files = await build(format, c, stem);
    } catch (e) {
      app.toast(`Could not build the ${format.toUpperCase()} file: ${e && e.message ? e.message : e}`, 'error');
      return null;
    }
    if (files.length === 1) return app.save(files[0].name, files[0].data);
    const entries = [];
    for (const f of files) {
      const data = typeof Blob !== 'undefined' && f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
      entries.push({ name: f.name, data });
    }
    return app.save(`${stem}${ZIP_NAME[format] || ''}.zip`, zipFiles(entries), 'application/zip');
  };
}

export function fitToPage(app) {
  const { store } = app;
  const pattern = store.pattern();
  if (!pattern) { app.toast('Fix the design first: there is no pattern to fit.', 'warn'); return; }
  const p = store.params;
  const pct = autoFitPercent(pattern, p);                  // whole percent, in the chosen orientation
  const atFit = layoutPattern(pattern, { ...p, scale: pct });
  if (!atFit.fits) {
    const fixed = p.orient === 'portrait' || p.orient === 'landscape';
    app.toast(`Even at ${pct}% the pattern does not fit one ${atFit.page.name} page. Choose ${fixed ? 'Auto orientation, ' : ''}a larger paper size or fewer floors.`, 'warn');
    return;
  }
  if (pct === p.scale) { app.toast(`Already at the largest scale that fits: ${pct}%.`, 'info'); return; }
  store.setParams({ scale: pct });
  app.toast(pct < 100 ? `Scaled to ${pct}% to fit one page. The folded tube shrinks by the same factor.` : `Scaled to ${pct}%.`, pct < 100 ? 'warn' : 'ok');
}

const ICON = {
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
  fit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg>',
  reset: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v3h3"/></svg>',
};

export function mountActions(container, app) {
  const { store } = app;
  container.replaceChildren();

  const busy = async (btn, fn) => {
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try { await fn(); } finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
  };
  const exportBtn = (label, format, title, primary = false) => {
    const b = el('button', { type: 'button', class: `btn btn-sm${primary ? ' btn-primary' : ''}`, title });
    b.innerHTML = ICON.down;
    b.append(document.createTextNode(label));
    b.addEventListener('click', () => busy(b, () => app.exportAs(format)));
    return b;
  };

  const pattern = el('div', { class: 'act-group', role: 'group', 'aria-label': 'Save the pattern' },
    el('span', { class: 'act-label section-label', text: 'Pattern' }),
    exportBtn('PDF', 'pdf', 'Vector PDF for printing (tiles across pages when needed)', true),
    exportBtn('SVG', 'svg', 'SVG with mountain, valley, end-ring, cut and seam-strip layers'),
    exportBtn('PNG', 'png', 'PNG at 300 dpi (with a legend PNG when the sheet fills its page)'),
    exportBtn('DXF', 'dxf', 'DXF (R12, mm) for cutters and CAD, at the print scale'),
  );
  const tubeBtn = exportBtn('Tube STL', 'stl-tube', 'The deployed tube as a printable solid');
  const fab = el('div', { class: 'act-group', role: 'group', 'aria-label': 'Save 3-D models' },
    el('span', { class: 'act-label section-label', text: '3-D' }),
    tubeBtn,
    exportBtn('Mold STL', 'stl-molds', 'Mountain and valley embossing plates (zip)'),
    exportBtn('Everything', 'pack', 'Pattern, models, design file and folding instructions in one zip'),
  );

  const info = el('span', { class: 'act-info num' });
  const fitBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Scale the pattern to fit one page (F)' });
  fitBtn.innerHTML = ICON.fit;
  fitBtn.append(document.createTextNode('Fit to page'));
  fitBtn.addEventListener('click', () => fitToPage(app));

  const resetBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Back to the default design' });
  let armTimer = null;
  const disarm = () => {
    clearTimeout(armTimer);
    resetBtn.removeAttribute('data-armed');
    resetBtn.innerHTML = ICON.reset;
    resetBtn.append(document.createTextNode('Reset'));
  };
  disarm();
  resetBtn.addEventListener('click', () => {
    if (resetBtn.getAttribute('data-armed') === 'true') {
      disarm();
      store.reset();
      app.toast('Design reset. Undo brings it back.', 'info');
      return;
    }
    resetBtn.setAttribute('data-armed', 'true');
    resetBtn.textContent = 'Click again to reset';
    armTimer = setTimeout(disarm, 3000);
  });
  resetBtn.addEventListener('blur', () => { if (resetBtn.getAttribute('data-armed') === 'true') setTimeout(disarm, 150); });

  container.append(pattern, fab, el('span', { class: 'act-spacer' }), info, fitBtn, resetBtn);

  function sync() {
    const d = store.design();
    const L = store.layout();
    const valid = d.valid && L;
    for (const b of container.querySelectorAll('.act-group .btn')) {
      if (b.getAttribute('aria-busy') !== 'true') b.disabled = !valid;
    }
    fitBtn.disabled = !valid;
    const rb = d.params ? d.params.ringBottom : 0, rt = d.params ? d.params.ringTop : 0;
    tubeBtn.title = `The deployed tube as a printable solid${rb > 0 || rt > 0 ? `, with its ${ringWords(rb, rt)}` : ''}`;
    if (!valid) { info.textContent = 'No pattern'; info.className = 'act-info num warn'; return; }
    const pct = Math.round(L.scale * 1000) / 10;
    const legend = needsInfoPage(L) ? ' + legend' : '';
    info.textContent = L.fits
      ? `${L.page.name} ${L.page.orient} · ${pct}% · 1 page${legend}`
      : `${L.page.name} · ${pct}% · ${L.tiles.length} pages${legend}`;
    info.className = `act-info num${L.fits && pct === 100 ? '' : ' warn'}`;
    // promise what Fit to page really does (it keeps the chosen orientation)
    const fit = autoFitPercent(store.pattern(), store.params);
    const atFit = layoutPattern(store.pattern(), { ...store.params, scale: fit });
    info.title = !L.fits
      ? `At ${pct}% the pattern needs ${L.tiles.length} pages, and the PDF adds a page for the legend and scale bar.${atFit.fits ? ` Fit to page (${fit}%) makes it fit one.` : ''}`
      : legend ? `The sheet nearly fills the page: the legend and scale bar go on a page of their own.${atFit.fits && atFit.info && fit < pct ? ` Fit to page (${fit}%) makes room.` : ''}` : '';
  }
  sync();

  return {
    update(change) { if (!change || change.kind !== 'view') sync(); },
    resize() {},
    setActive() {},
  };
}
