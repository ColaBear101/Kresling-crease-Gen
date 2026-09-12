# Kresling Crease Generator

A web app for designing and exporting Kresling origami crease patterns — the kind used for bistable, collapsible tubes and origami-inspired engineering structures. Pure vanilla HTML/CSS/JS, no build step, no external runtime dependencies. Everything renders with the Canvas 2D API.

**Live app:** [kreslinggen.vercel.app](https://kreslinggen.vercel.app)

## What it does

- Generates a physically accurate Kresling crease pattern from a few parameters: diameter, height, number of sides, floors, fold angle, chirality, and stacking.
- Lays the pattern out for A4 printing, with auto-fit scaling, seam allowances, and extra registration columns.
- Shows a live 3D preview of the folded tube (drag to rotate, scroll to zoom, slider to compress/animate).
- Plots the fold-energy curve — with an optional force (dE/dh) overlay for the polyimide preset — to check and visualize bistability.
- Sweeps crease stiffness vs. sheet thickness, and axial/off-axis modal frequencies vs. twist angle, for the two stable branches.
- Runs a requirements-driven **Design Explorer**: pick two design axes (e.g. sides × angle), set requirements (must be bistable, must not buckle, must fit an A4 sheet), and scan a grid of candidate designs instead of hand-tuning one point at a time.
- Checks buckling safety (Euler column + local shell buckling vs. snap-through force) for a given wall thickness and end condition.
- Previews a two-part press mold (mountain + valley plates) for pre-creasing the pattern by hand or machine.
- Exports to SVG, print-ready PDF, DXF, STL (tube), and STL (mountain/valley molds).
- Supports undo/redo, preset save/load, and keyboard shortcuts.

## Project structure

```
index.html             — markup only, loads js/main.js as an ES module

css/
  base.css             — @import font, * reset, :root custom properties, html/body/.app base rules
  toolbar.css          — top toolbar (title, tab buttons, shortcut hint, badge, GitHub link)
  sidebar.css          — left-panel form controls (sliders, number inputs, selects, checkboxes)
  main-panels.css      — main 3-column layout, flat-canvas area, stats bar, center tab bar, right panel + sub-panels
  explorer.css         — Design Explorer pane (.exp-*)
  modal.css            — Sources modal
  misc.css             — toast notification, bottom action bar
  responsive.css       — mobile/tablet + narrow-phone breakpoints (loaded last so it overrides everything above)

js/
  main.js              — entry point: wires up globals + boots the app
  constants.js         — A4 dimensions, parameter pairs, preset definitions, cited SOURCES
  state.js             — shared mutable state (3D/mold cameras, UI tabs, anim)
  ui.js                — DOM readers, toast, debounce, stats bar, info-box text
  presets.js           — preset load / import / export
  history.js           — undo / redo
  exports.js           — SVG / PNG / PDF / DXF / STL exporters
  explorer.js          — Design Explorer: requirements-driven grid search over design axes
  app.js               — event binding, tab switching, shortcuts, resize handles

  physics/
    geometry.js        — computeGeometry, patternBounds, buildVerts
                          (single source of truth for crease-pattern vertices)
    material.js        — sheet material constants + crease spring stiffness (k_m, k_v)
    energy.js          — fold-energy graph (dihedral-bending model) + hover
    modal.js           — axial/off-axis modal-frequency sweep (6-DOF truss model)
    stiffness.js       — crease stiffness (k) vs. thickness sweep
    buckling.js        — Euler column + local shell buckling vs. snap-through check

  render/
    render-flat.js     — flat crease-pattern canvas + pan/zoom/hover
    render-3d.js       — 3D tube preview
    render-mold.js     — press-mold preview

test/
  regression.mjs       — regression suite (geometry, material, modal, exports,
                          buckling, explorer, history) — run with `node test/regression.mjs`
  _mold_probe.mjs      — standalone probe script for mold-STL geometry
```

The JS is split by concern rather than kept as one file: each module owns one piece (geometry, a physics model, a renderer, exports, etc.), and there's a single shared `buildVerts`/`patternBounds` in `physics/geometry.js` that every renderer, exporter, and physics model calls into, instead of each one re-deriving crease-pattern vertices independently. `physics/energy.js` and `physics/modal.js` are intentionally *independent* models of the same structure (arc-length dihedral-bending vs. exact-chord axial-truss) rather than one reused elsewhere — see the Sources modal for why. Physics models live under `js/physics/` and canvas renderers under `js/render/`; app-level orchestration (state, UI wiring, presets, history, exports, the Design Explorer, and `app.js`/`main.js` themselves) stays at the `js/` root. The CSS is split the same way, one file per UI area, loaded in `index.html` in the cascade order shown above.

## Geometry & physics

Crease geometry and the physics models follow formulas from:

- **Alipour & Arghavani (2023)** — exact 3D crease lengths, polygon side length, and the designed-state scan used by `physics/geometry.js`
- **Cai et al. (2015)** — closed-form bistability criterion, `1 < red_len/side < 1/sin(π/n)`
- **Masana & Daqaq (2019)** — physical framing (strain energy vs. deployment height, multiple equilibria) motivating `physics/energy.js`'s energy-vs-height graph
- **Schenk & Guest (2011)** and **Filipov, Tachi & Paulino, *PNAS* (2015)** — bar-and-hinge crease convention and the thin-plate torsional-hinge stiffness formula, `k_fold = E·t³·L / (12·(1−ν²)·w)`
- **Kidambi & Wang (2020, *Physical Review E*)** — 6-DOF truss model, mass/stiffness matrices, and the axial/off-axis modal-frequency analysis behind `physics/modal.js`, checked against their published Fig. 7/13 numbers
- **DuPont™ Kapton® HN datasheet** — E ≈ 2.5 GPa, ν = 0.34, density 1.42 g/cc for the Polyimide (Kapton-type) preset

`physics/buckling.js`'s Euler-column/local-shell-buckling check is standard shell theory, not itself one of the Kresling-specific sources above — it's a structural safety check layered on top of the cited geometry/material models, used by the buckling requirement in the Design Explorer.

Full citations with DOIs are one click away via the **📖 Sources** button in the toolbar (`js/constants.js` → `SOURCES`, rendered by `js/ui.js` → `toggleSourcesModal`).

## Running locally

No build step required. Because the JS uses ES module `import`/`export`, it needs to be served over `http://` or `https://` rather than opened directly via `file://` — any static file server works, e.g.:

```
npx serve .
```

To check that geometry/material/physics/export changes haven't broken anything:

```
node test/regression.mjs
```

---

> "Nothing is permanent except change." — the Buddha
>
> A Kresling tube holds two stable equilibria and no others — it doesn't hover
> in between. Every other configuration is transient, snapping toward one
> resting state or the other the moment you let go, which happens to be
> exactly what `js/physics/energy.js`'s energy curve plots.

*(Vibecoded via Copilot in the beginning, now maintained by the lord Claude.)*
