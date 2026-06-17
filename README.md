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
index.html      — markup only
css/main.css    — all styles
js/main.js      — all application logic (geometry, rendering, exports, UI)
```

## Geometry & physics

Crease geometry and the fold-energy model follow formulas from:

- Alipour & Arghavani (2023) — exact 3D crease lengths and polygon side length
- Masana & Daqaq (2019) — axial truss energy model for bistability
- Fernandez et al. (2022) — additional geometric corrections

## Running locally

No build step required — just open `index.html` in a browser, or serve the folder with any static file server.

---

*(Vibecoded via Copilot in the beginning, now maintained by the lord Claude.)*
