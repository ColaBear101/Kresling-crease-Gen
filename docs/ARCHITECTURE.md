# Kresling Studio: architecture and code rules

How the app is put together and the rules every module follows: units and frames,
the module map, the design object, the physics and export APIs, the DOM and mount
protocol, and the visual direction. Read it before changing code; the header comment
of each source file is the authoritative API doc for that file.

Kresling Studio designs Kresling origami tubes: exact crease pattern, 3-D fold preview,
mechanics (energy, snap force, vibration modes, buckling), a design explorer, and
fabrication exports (SVG, PDF, PNG, DXF, STL, press-mold STL). It replaced Kresling
Crease Generator, the earlier app in this repository (last version: commit fb4f988),
and was written from scratch with exact geometry rather than adapted from that code.

Project root = the folder containing this file's parent (`index.html` lives there).
Commands: `npm start` (dev server), `npm test` (every test file), `npm run build`
(the single-file app in `dist/`), `npm run samples`. No dependencies; `npm install`
is never needed.

## 1. Rules for all code

- Plain ES modules, browser + Node 23. **No dependencies, no CDN libraries, no network.**
- Only these import/export forms (the bundler `tools/build.mjs` rejects anything else):
  `import { a, b as c } from './x.js';` · `import * as ns from './x.js';`
  `export function` · `export async function` · `export class` · `export const` · `export let` · `export { a, b as c };`
  No `export default`, no dynamic `import()`, no `import.meta`, no circular imports,
  relative paths with `.js` extension only. Don't reassign an exported `let` after load.
- Module scope must not touch the DOM at import time (Node tests import physics/export
  modules). Pure modules (`js/core`, `js/physics`, `js/export`) must not use `window`/`document`
  at all, except `js/export/png.js` and `js/export/save.js`.
- Every top-level name is unique per module; keep files focused (< ~700 lines).
- No `alert/confirm/prompt`, no `window.open`, no `window.print` (they are blocked where
  the app is hosted). Use `app.toast()` for messages and in-page UI for confirmations.
- `localStorage` only through `storage` in `js/app/util.js` (never throws). One exception: the
  inline script in `index.html` that applies a saved theme before the first paint.
- Canvas code: use `fitCanvas()` from `js/app/util.js` (devicePixelRatio aware), redraw on
  resize via the `resize()` hook, and read colours with `cssVar('--token')` from
  `js/ui/theme.js` (theme can change at runtime; `onThemeChange(fn)` exists).
  On-paper drawing uses `PRINT` and `DASH` from `js/ui/theme.js` in both themes.
- Invalid designs are normal input: when `design.valid` is false (or a pattern is null),
  views show a short, specific message (use `design.errors[0]`), never throw.
- Keyboard focus must be visible; controls need labels; respect `prefers-reduced-motion`
  for automatic animation.

## 2. Units and frames

- Lengths **mm**, angles **radians** in code (fields ending `Deg` are degrees), moduli
  **MPa** (N/mm²), thickness **mm** inside `design.material` (params use µm), energy **mJ**
  (N·mm), force **N**, stiffness **N/mm**, mass **g** in `design.sheet.mass`.
- Pattern frame: mm, x right, **y up**, seen from the printed side (= outside of tube),
  bounding box starts at (0,0). Page frame: mm, origin top-left, **y down**; convert with
  `layout.toPage([x,y])`.
- 3-D frame: tube axis +z, bottom ring at z = 0.

## 3. Existing modules (done: do not rewrite; extend only if your brief says so)

| file | what it gives you |
|---|---|
| `js/core/kresling.js` | exact rigid-panel geometry, vector helpers, `foldAngle` |
| `js/core/params.js` | `SCHEMA` (every control: key, group, type, label, unit, min/max/step, default, options, help, `when`), `GROUPS`, `DEFAULTS`, `PRESETS`, `MATERIALS`, `PAGES`, `normalizeParams`, `migrateParams` and `RENAMED_KEYS` (older key names: `ext` → `ringBottom`/`ringTop`), `materialFields`, `APP_NAME`, `APP_VERSION` |
| `js/core/design.js` | `computeDesign(params)` → design (see §4), `convertMode`, `bistableAngleWindow`, `foldedHeightWindow`, `foldAnglesAt` |
| `js/core/pattern.js` | `buildPattern(design)` → pattern of the WHOLE stack on one sheet (`floors` = floors × stack count, `creaseSpacing`; segments with kind/family/tab/len/full, outline (the sheet rectangle), vertices, width, height, rowY, rings {bottom, top}, endKind, body, seams, tabs, totals, area); `clipConvex`, `polygonArea` |
| `js/core/layout.js` | `layoutPattern(pattern, params)` → page placement, `fits`, `info` rect, `tiles`; `autoFitPercent`; `INFO_H`, `TILE_OVERLAP` |
| `js/core/tube.js` | `buildTube(design, Hs, phis, { endRings })` (end rings: one height or `{ bottom, top }`; upright prisms on the end polygons, one rim ring each after ring N (`rimBottom`, `rimTop`), `zMin`/`zMax`), `ringHeights(spec)`, `foldStates(design, compress, mode, phiOfH)`, `point` |
| `js/core/mold.js` | `moldLayout(pattern, params)` → ridge segments for the two embossing plates, at the print scale, ridge width limited to the crease spacing, plus the registration `border` on the sheet outline; `moldNotes(layout)` |
| `js/core/info.js` | `infoLines(design, pattern, layout)`, `LEGEND`, `SCALE_BAR_MM` |
| `js/physics/mechanics.js` | floor energy model (CST panels + hinges): `makeFloorModel`, `floorEnergy`, `relaxTwist`, `energyPath`, `analysePath`, `makePoseEnergy`, `hessian6`, `jacobiEigen`, `panelBucklingStrain`, `hingeStiffness`, `wrapAngle` |
| `js/app/store.js` | `createStore()`; params with undo/redo, view state, memoised `design()`, `pattern()`, `layout()`, user presets; `VIEW_DEFAULTS` lists every view key |
| `js/app/util.js` | `el`, `debounce`, `rafThrottle`, `fmt`, `fmtSI`, `clamp`, `fitCanvas`, `storage`, `fileStem(params, { scaled })` (adds `_left` for a mirrored pattern and, for files at the print scale, `_80pct` when the scale is not 100 %) |
| `js/app/share.js` | share links: `shareHash(params)` → `#v=1&key=value…` (values that differ from the frozen `LINK_BASE`), `shareUrl(params, location)`, `readShareHash(hash)` → `null` \| `{ ok, params, ignored }` \| `{ ok: false, error }`, `LIVE_URL` |
| `js/ui/theme.js` | `cssVar`, `PRINT`, `DASH`, `onThemeChange`, theme preference `themePref()`, `setThemePref('auto'\|'light'\|'dark')`, `nextThemePref()` (index.html applies a saved choice before the first paint) |
| `js/ui/openfile.js` | `openDesignFile(app, file)` (Open button and drop), `installDropOpen(app)` (drop a design file anywhere on the page) |
| `js/ui/sectionnav.js` | `mountSectionNav(container)`: the bottom section bar on phones (Design, Pattern, 3-D, Analysis) |
| `js/ui/shortcuts.js` | `keyAction(event)`, `installShortcuts(app, { fit, share, theme, help })`, `SHORTCUTS` (listed in the help dialog) |
| `js/export/save.js` | `saveFile(filename, data, mime)`, `saveMessage(result)`, `primeSaving()`, `isHosted()` |
| `js/export/zip.js` | `zipFiles([{name, data}])`, `crc32`, `toBytes` |
| `test/harness.mjs` | `test`, `ok`, `near`, `eq`, `run` (run tests with `node test/<file>.test.mjs`) |

Crease styling everywhere (screen, SVG, PDF, PNG): mountain = `PRINT.mountain` solid;
valley = `PRINT.valley` dashed `DASH.valley`; end-ring fold (`family === 'end'`) =
`PRINT.end` dash-dot `DASH.end`; cut = `PRINT.cut` solid. Dash lengths are mm at 100 %.
Seam strips (`pattern.seams`) are filled with `PRINT.glue`. Creases with `tab === true`
are copies inside a seam strip: same style, drawn at 60 % opacity on screen (full
strength in exports).

## 4. The design object (from `computeDesign`)

`params` (normalised), `n`, `D`, `R`, `a` (polygon side), `chir`, `chirEff`, `floors`,
`stack`, `totalFloors`, `stacking`, `errors[]`, `warnings[]`, `notes[]`, `valid`,
`status` ('bistable'|'monostable'|'invalid'), and when valid:
`strip {s, h, b, c, angleDeg, longAngleDeg, apexDeg}`,
`states {deployed {H, phi, ok, reason}, folded {H, phi, ok, reason}}` (per floor),
`regime` ('classic'|'antiprism'), `bistable`, `flatFoldable`,
`folds {ring, long, short, end}` ('mountain'|'valley'), `foldAngles`,
`lengths {floorDeployed, floorFolded, deployed, folded, stroke, ratio}` (whole stack),
`twist {deployedDeg, foldedDeg, endRotationDeployedDeg, endRotationFoldedDeg, snapRotationDeg}`,
`inner {deployed, folded, apothem}` (clear opening diameters), `tolerance {foldedPerDeg}`,
`material {key, label, E (MPa), nu, t (mm), rho (g/mm³), hingeWidth (mm), kappa}`,
`sheet {bodyArea (mm²), mass (g)}`.

Relevant params for physics: `panel` ('thin'|'stiff'), `restPct` (0–100: hinge rest angles
between deployed and folded), `strainMax` (%), `payload` (g), `endCond`, `safety`.

## 5. Physics API (agent "physics" implements; others consume exactly this)

All functions take a `design` and memoise on a key built from `JSON.stringify(design.params)`
(keep the last ~8 results). Never throw for invalid designs: return `{ ok: false, reason }`.

`js/physics/analysis.js`
- `energyAnalysis(design)` → `EnergyResult`
  `{ ok: true, H[], phi[], E[], F[], membrane[], hinge[], strain[], minima[], maxima[],
  deployed, folded, bistable, barrier, barrierFromDeployed, barrierFromFolded,
  snapForce, releaseForce, floors, model {panel, epsCr, kappa, restFrac}, Hmax }`.
  Per floor. H ascending from 0 to 1.15·H_deployed, 241 samples. `F = dE/dH` (N); the
  compressive load to hold a height is `P = −F`. `strain[k]` = largest principal Green
  strain in the panels at sample k. `snapForce = {index, H, P}` (compressive peak between
  deployed well and barrier) or null; `releaseForce` likewise (tensile peak). Uses
  `makeFloorModel(geo, design.material, { stacking, panel: params.panel,
  restStates: [deployed, folded(if ok)], restFrac: params.restPct/100 })` and `energyPath`.
- `phiAtHeightFn(design)` → `(H) => phi` (linear interpolation of the relaxed twist on the
  energy path) or `null` when invalid. Used by the 3-D view and STL for in-between shapes.
- `strainCheck(design)` → `{ ok, peak (fraction), atH, limit (fraction), pass }`: peak
  panel strain along the path between the two wells (between deployed well and H = 0 if
  monostable), vs `params.strainMax/100`.

`js/physics/modal.js` (Kidambi & Wang 2020-style 6-DOF top-ring model, generalised to the
CST + hinge energy): one floor, bottom ring clamped, top ring rigid. Stiffness = `hessian6`
of `makePoseEnergy` at each stable state (true equilibrium when hinges shift it). Mass:
top ring carries `params.payload` g as a thin disc of radius R plus half of one floor's
sheet mass as a thin ring. **Convert to SI before the eigenproblem** (K translational
N/mm→N/m ×1000, rotational N·mm/rad→N·m/rad ×1e-3, coupling N/rad unchanged; masses kg,
inertias kg·m²).
- `modalAnalysis(design)` → `{ ok, mass {top, ring, Iz, Ixy}, states: [{ key: 'deployed'|'folded',
  H, phi, modes: [{ f (Hz), kind, participation {axial, torsion, lateral, rocking} }] }] }`
  with 6 modes ascending; `kind` ∈ 'axial','torsional','axial-torsional','lateral',
  'rocking','lateral-rocking' from the dominant participation (≥ 0.25 counts).
- `modalSweep(design, { samples = 41 })` → `{ ok, xLabel: 'Deployed twist (°)', x[], current,
  series: [{ key, label, y[] }] }`: hold n, R and strip height h, vary the crease angle over the
  range where the design is valid; keys 'deployed-axial', 'deployed-offaxis', 'folded-axial',
  'folded-offaxis' (lowest frequency of each family, `null` where the state does not exist).

`js/physics/buckling.js`
- `bucklingCheck(design)` → `{ ok, reason?, EI (N·mm²), GA (N, Infinity if shear-rigid), length,
  K, Pe, Pcr, snapP, safety, required, pass, endCond, notes[] }`. EI/GA from the lateral–rocking
  2×2 flexibility of one floor at the deployed state (Timoshenko cantilever fit:
  EI = H / C_rr, GA = H / (C_uu − H³/(3EI)), average the x/y planes; note rx turns z toward −y).
  Column length = whole stack deployed length; K: fixed-free 2, pinned 1, fixed-pinned 0.7,
  fixed-fixed 0.5; Pe = π²EI/(KL)²; Pcr = Pe/(1 + Pe/GA). snapP from `energyAnalysis`.
  safety = Pcr / snapP; pass = safety ≥ params.safety (null when monostable).

`js/physics/sweeps.js`
- `thicknessSweep(design, { samples = 21 })` → `{ ok, t[] (µm, log-spaced ¼× … 4× current,
  clamped to 6–1000), kappa[], kAxial[] (N/mm, whole stack at deployed state), barrier[]
  (mJ/floor or null), snap[] (N or null), bistable[], current }` (use coarser energy paths).

`js/physics/explore.js`
- `EXPLORE_AXES` → `[{ key, label, unit, min, max, integer, modes: ['heights'|'flat'...] }]`
  covering n, dia, H0, H1, hFlat, angle, floors, thick, hingeW, restPct.
- `evaluateDesign(params, req)` → `{ valid, status, bistable, snapP, barrier, stroke, ratio,
  fits, fitScale, safety, peakStrain, meets {bistable, buckling, fits, strain}, score, total,
  reason }`; `req = { bistable, buckling, fits, strain, safety }` (booleans + number).
  Fast: ≤ ~15 ms per design (fewer samples).

## 6. Exporters (pure functions; the shell saves the bytes)

`js/export/svg.js`: `patternSVG(design, pattern, layout, { tile } = {})` → string. One page
(`width/height` in mm, `viewBox` in mm), white sheet, groups `<g id="cut">`, `<g id="mountain">`,
`<g id="valley">`, `<g id="endring">`, `<g id="glue">`, `<g id="info">` (Inkscape-friendly layer attributes), info box
(`infoLines`, `legendFor`, 50 mm scale bar) in `layout.info`. With `tile` (one of `layout.tiles`)
render that page window plus overlap/alignment marks and a page label.
`js/export/pdf.js`: `patternPDF(design, pattern, layout)` → `Uint8Array`: hand-written
PDF 1.4, vector, one page when it fits, otherwise one page per tile; Helvetica (standard 14,
WinAnsi), correct xref byte offsets, dashes via `d` operator, mm→pt ×72/25.4, y flipped.
`js/export/dxf.js`: `patternDXF(design, pattern, { scale })` → string (the app passes `layout.scale`): AutoCAD R12 ASCII, units mm
(pattern frame, y up), layers CUT (7), MOUNTAIN (1), VALLEY (5), END_RING (1); LTYPE table with
CONTINUOUS, DASHED, DASHDOT; LINE entities.
`js/export/png.js`: `patternPNG(design, pattern, layout, { dpi = 300 })` → `Promise<Blob>`
(render the SVG to an offscreen canvas; browser only).
`js/export/json.js`: `designFile(params)` → string `{ app, version, params }`;
`readDesignFile(text)` → `{ ok, params, ignored, source, notes }` | `{ ok: false, error }` (validate, normalise; presets exported by Kresling-crease-Gen are converted crease for crease, `source: 'crease-gen'`).
`js/export/stl.js`: `tubeSTL(design, { compress = 0, mode = 'uniform', wall, phiOfH, endRings = { bottom: params.ringBottom, top: params.ringTop } })` →
`ArrayBuffer` (binary STL, closed solid with wall thickness, outward normals, mm, with the end rings);
`moldSTL(moldLayout, which)` → `ArrayBuffer` ('mountain' | 'valley': base slab + one closed
prism per ridge). `meshStats(arrayBuffer)` → `{ triangles, volume, watertight, bbox }`.

## 7. DOM, CSS and the mount protocol (agent "shell" builds; others mount into it)

`index.html` (root) loads `css/app.css`, `css/flat.css`, `css/view3d.css`, `css/panels.css`,
`css/explorer.css`, the Google Fonts link (IBM Plex Sans, IBM Plex Sans Condensed,
IBM Plex Mono), and exactly `<script type="module" src="js/main.js"></script>`.

Containers (ids): `#app`, `#topbar`, `#sidebar`, `#center` with `#center-tabs` and panes
`#pane-pattern`, `#pane-mold`, `#pane-explorer`; `#right` with `#pane-3d` and `#pane-analysis`;
`#actions`; `#section-nav` (phones only); `#toast-root`; `#sources` (dialog). Panes are flex/grid children that fill their
area; a view fills its container (`width/height: 100%`) and must not set page-level styles.

Each view module exports `mountX(container, app)` returning
`{ update(change), resize(), setActive(active) }`:
- `update({ kind: 'params'|'view'|'theme', keys })`: called by the shell after store changes.
  Recompute only what is affected; debounce heavy work (energy/modal ≥ 100 ms trailing).
- `resize()`: container size changed (the shell uses a ResizeObserver).
- `setActive(bool)`: pane shown/hidden; skip work while hidden, refresh when shown.

Mount functions: `mountFlatView` (js/render/flat.js) → `#pane-pattern`;
`mountMoldView` (js/render/moldview.js) → `#pane-mold`; `mountView3d` (js/render/view3d.js) →
`#pane-3d`; `mountAnalysis` (js/ui/panels.js) → `#pane-analysis`; `mountExplorer`
(js/ui/explorer.js) → `#pane-explorer`; `mountToolbar` (js/ui/toolbar.js) → `#topbar`;
`mountControls` (js/ui/controls.js) → `#sidebar`; `mountActions` (js/ui/actions.js) → `#actions`;
`mountSectionNav` (js/ui/sectionnav.js) → `#section-nav`.

`app` object (built in `js/main.js`):
`{ store, toast(message, kind = 'info'|'ok'|'warn'|'error', opts), save(filename, data, mime) → Promise<result> (saves and toasts), exportAs(format) → Promise (format: 'svg'|'pdf'|'png'|'dxf'|'stl-tube'|'stl-molds'|'json'|'pack') }`.
Views communicate only through `app.store` (e.g. the energy chart sets
`store.setView({ compress })`; the 3-D view reads `store.view.compress`).

Shared CSS (defined in `css/app.css`; other CSS files use these and add only their own
`.flat-*`, `.v3d-*`, `.an-*`, `.ex-*` classes):
tokens `--bg --surface --surface-2 --surface-3 --line --line-strong --ink --ink-2 --ink-3
--accent --accent-ink --accent-soft --mountain --valley --cut --ok --warn --bad --ok-soft
--warn-soft --bad-soft --sheet --grid --focus --font-ui --font-mono --font-display
--radius-s --radius-m --shadow-1`; classes `.btn` (+ `.btn-primary`, `.btn-ghost`, `.btn-sm`),
`.icon-btn`, `.seg` (segmented control: buttons with `aria-pressed`), `.tabs`/`.tab`
(`aria-selected`), `.field` (label + control row), `.chip`, `.badge` (+ `.ok .warn .bad`),
`.muted`, `.num` (tabular mono numbers), `.kv` (2-column key/value grid), `.empty-state`,
`.scroll` (scrollable region), `.visually-hidden`. Dark theme: tokens redefined under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and
`:root[data-theme="dark"] {…}`; never put a colour only inside those blocks.

## 8. Visual direction

Subject: a technical drawing desk for paper engineering. Workspace in cool, slightly green-grey
neutrals; the paper sheet stays white in both themes with a faint mm grid; crease colours follow
origami convention (mountain red solid, valley blue dashed). Accent: cutting-mat green
(light `#2e6b4f`, dark `#5fb98f`) used sparingly for primary actions and selection.
Type: IBM Plex Sans (UI, 13–14 px), IBM Plex Mono (all numbers/units, tabular),
IBM Plex Sans Condensed (wordmark, section labels in small caps-like uppercase with letter-spacing).
Dense but calm: 8 px spacing grid, 1 px hairlines, radius 6 px, no gradients, no emoji, no glows.
Status uses chips (bistable = ok, monostable = warn, invalid = bad). Plain, specific copy
("Snap force 3.1 N", "Folded state unreachable: twist reaches 180°").

## 9. Done means

- Your files exist, follow §1, and import only what exists (or what this contract defines).
- Pure modules have Node tests in `test/<area>.test.mjs` using `test/harness.mjs`, and they pass.
- `node tools/build.mjs` succeeds (if the shell is not finished yet, at least your modules
  parse: `node --check file.js` for each).
- You report: files written, exported API (exact), tests run with results, known gaps.
