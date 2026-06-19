# Kresling Crease Generator

A web app for designing and exporting Kresling origami crease patterns — the kind used for bistable, collapsible tubes and origami-inspired engineering structures. Pure vanilla HTML/CSS/JS, no build step, no external runtime dependencies. Everything renders with the Canvas 2D API.

**Live app:** [kreslinggen.vercel.app](https://kreslinggen.vercel.app)

## What it does

- Generates a physically accurate Kresling crease pattern from a few parameters: diameter, height, number of sides, floors, fold angle, chirality, and stacking.
- Lays the pattern out for A4 printing, with auto-fit scaling, seam allowances, and extra registration columns.
- Shows a live 3D preview of the folded tube (drag to rotate, scroll to zoom, slider to compress).
- Plots the fold energy curve to check and visualize bistability.
- Previews a two-part press mold (mountain + valley plates) for pre-creasing the pattern by hand or machine.
- Exports to SVG, print-ready PDF, DXF, STL (tube), and STL (mountain/valley molds).
- Supports undo/redo, preset save/load, and keyboard shortcuts.

## Project structure

```
index.html             — markup only, loads js/main.js as an ES module
css/main.css           — all styles

js/
  main.js              — entry point: wires up globals + boots the app
  constants.js         — A4 dimensions, parameter pairs, preset definitions
  state.js             — shared mutable state (3D/mold cameras, UI tabs, anim)
  geometry.js          — computeGeometry, patternBounds, buildVerts
                          (single source of truth for crease-pattern vertices)
  ui.js                — DOM readers, toast, debounce, stats bar, info-box text
  render-flat.js        — flat crease-pattern canvas + pan/zoom/hover
  render-3d.js          — 3D tube preview
  render-mold.js        — press-mold preview
  energy.js             — fold-energy graph + hover
  presets.js            — preset load / import / export
  history.js            — undo / redo
  exports.js            — SVG / PNG / PDF / DXF / STL exporters
  app.js                — event binding, tab switching, shortcuts, resize handles
```

The JS is split by concern rather than kept as one file: each module owns one piece (geometry, a renderer, exports, etc.), and there's a single shared `buildVerts`/`patternBounds` in `geometry.js` that every renderer and exporter calls into, instead of each one re-deriving crease-pattern vertices independently.

## Geometry & physics

Crease geometry and the fold-energy model follow formulas from:

- Alipour & Arghavani (2023) — exact 3D crease lengths and polygon side length
- Masana & Daqaq (2019) — axial truss energy model for bistability
- Fernandez et al. (2022) — additional geometric corrections

## Running locally

No build step required. Because the JS uses ES module `import`/`export`, it needs to be served over `http://` or `https://` rather than opened directly via `file://` — any static file server works, e.g.:

```
npx serve .
```

---

*(Vibecoded via Copilot in the beginning, now maintained by the lord Claude.)*
