# Kresling Studio

**Live app:** [kreslinggen.vercel.app](https://kreslinggen.vercel.app)

Design Kresling origami tubes: an exact crease pattern you can print and fold, a 3-D
preview that folds the way the paper does, a mechanics model of the snap (energy,
force, vibration, buckling), a two-parameter design explorer, and fabrication files
(PDF, SVG, PNG, DXF, STL tube, STL embossing plates, and a zip with all of them plus
folding instructions).

It replaces Kresling Crease Generator, the earlier app in this repository: the same
sheet layout and feature set, rebuilt around exact rigid-panel geometry. The earlier app
is still in the git history; its last version (v25) is commit fb4f988. Plain HTML/CSS/JS,
no dependencies, no build tools beyond Node for the bundler and tests.

## Run it

- **No server:** open `dist/kresling.html` in a browser. It is one self-contained file
  (the source modules bundled), so it also works from disk.
- **From source:** `node tools/serve.mjs` and open http://localhost:8765/, or use any static
  file server (`npx serve .`). ES modules need http.
- **Build the single file:** `node tools/build.mjs` writes `dist/kresling.html` and
  `dist/artifact.html` (the same page without the document skeleton).
- **Tests:** `node test/<name>.test.mjs` for `core`, `pattern`, `tube`, `mechanics`,
  `physics`, `export`. `node tools/make-samples.mjs` writes every preset's exports to
  `samples/` and prints a summary table.

## How it works

**Geometry** (`js/core/kresling.js`). A floor joins two regular n-gons of circumradius R;
the top one is raised by H and twisted by φ. The flat strip has polygon side
a = 2R·sin(π/n) (the chord, not the arc), height h and shift s; its long and short diagonals
have lengths b² = s² + h² and c² = (s − a)² + h². Folding without stretching requires
b² = H² + 4R²sin²(φ/2) and c² = H² + 4R²sin²((φ − 2π/n)/2), which gives
sin(φ − π/n) = (2s − a)/(2R): exactly two rigid states whose twists add up to π + 2π/n
(Guest & Pellegrino 1994). The app solves these in closed form, so a design can be given
either as the two stable floor heights you want, or as the flat strip (height and crease angle).

**Mountain and valley** come from the dihedral angles of the real folded shape. With
the printed side outside: polygon rings and short diagonals are mountain folds, long
diagonals are valley folds (classic regime, crease angle above 90°).

**Pattern** (`js/core/pattern.js`): alternating or same-handed floors, a true mirror for
left-handed tubes, and the sheet layout of the earlier Kresling Crease Generator: a straight
seam with glue strips on both sides (whole panels, or widths in mm) that carry copies of the
creases they are glued over, and plain end rings across the top and bottom of the sheet
(set separately, 0–60 mm each, 10 mm by default).
The sheet holds the whole tube: floors × stack count floors in one piece, as the original
draws it. Patterns that do not fit the page are tiled across several pages with 10 mm
overlap. When no pattern page has room for the legend and scale bar (a tiled print, or a
sheet that nearly fills its page), the PDF ends with a legend page.

**Print scale.** The printed sheet, the DXF and the press molds all follow the print
scale, so they stay one size; the 3-D printed tube (STL) stays at design size. The mold
plates carry a low border along the sheet outline for lining the sheet up, and their
ridge width is limited to 0.9 × the gap between neighbouring creases.

**Presets from Kresling Crease Generator.** Open reads the preset files the earlier app exports and
converts them (cm to mm, arc side to chord, entered angle to drawn angle) so that every
crease lands where that app prints it. Presets that have no rigid fold open too, but this
app draws no pattern for them and says why.

**Mechanics** (`js/physics/`). Each panel is a constant-strain triangle (plane-stress
St Venant–Kirchhoff, strain recovered exactly from its three side lengths). By default
panels are *thin*: compression beyond the plate-buckling strain kπ²t²/(12(1−ν²)w²) is
carried at constant stress, the way paper and film wrinkle. Creases are torsion springs
k = E·t³/(12(1−ν²)·w) per unit length (Filipov et al. 2015) with an adjustable rest
position between the deployed and folded shapes. The energy path relaxes the twist at
each height (ends free to rotate) and reports the wells, barrier, snap and release
forces, and peak panel strain against the sheet's limit. Vibration uses one floor with a
rigid top ring and payload, 6 degrees of freedom (in the style of Kidambi & Wang 2020).
Buckling fits a Timoshenko column to the lateral stiffness of one floor and compares the
Euler/Engesser load of the stack with the snap force.

Limits: rings are rigid polygons, deformation is symmetric, and interior rings are
treated like rigid plates for buckling (so that load is an upper bound). Forces are
idealised; real creases vary with how sharply they are scored.

## Compared with Kresling Crease Generator v24

| | Kresling Crease Generator v24 | Kresling Studio |
|---|---|---|
| Polygon side | arc length πD/n (true tube 2.6–7 % wider than entered) | chord 2R·sin(π/n) |
| Stable states | criterion 1 < red/side < 1/sin(π/n) | both rigid states solved exactly |
| Ring folds | drawn as valley | mountain (from the folded shape) |
| Left-handed | switches the green diagonal (changes crease lengths) | true mirror image |
| 3-D view | flat strip height used as folded height | exact folded shape, same crease lengths as the print |
| Energy model | dihedral bending along an assumed path | panel stretch + buckling + crease hinges, relaxed twist |
| PDF | print dialog of an HTML page | real vector PDF, tiled across pages when needed |
| Stack count | floors × stack on one sheet | the same |
| Scale | sheet, DXF and molds | the same (the tube STL stays at design size) |

v25, the last version of that app (commit fb4f988), already takes the stable states from the
exact two-state solution, shows the true diameter, and draws the 3-D view and the energy curve
along the exact fold path; its creases, ring folds and left-handed pattern are as in v24.

Checking its presets with the exact solver: "Bistable n=6", "Monostable" and
"Compact unit" have no strain-free folded shape at all (for "Bistable n=6" the shift
exceeds the limit by 1.2 %), and "Bistable n=8" and "Tall tower" have a single stable state.

## Project layout

```
index.html              page shell (loads css/*.css and js/main.js)
css/                    app.css (tokens, layout, shared components), flat, view3d, panels, explorer
js/main.js              boot: store, views, tabs, shortcuts
js/app/                 store (params + undo/redo + view state), util
js/core/                kresling (geometry), params (schema, presets, materials), design,
                        pattern, layout (page placement, tiling), tube (3-D mesh), mold, info
js/physics/             mechanics (CST + hinge energy), analysis (energy path), modal,
                        buckling, sweeps (thickness), explore (explorer evaluation)
js/render/              flat (pattern view), view3d, moldview, camera, chart
js/ui/                  controls (sidebar), toolbar, actions (exports), panels (analysis),
                        explorer, sources (help dialog), shortcuts, toast, theme
js/export/              svg, pdf, png, dxf, stl, json, zip, save
tools/                  build.mjs (bundler), serve.mjs (dev server), make-samples.mjs
test/                   node tests (harness.mjs)
dist/kresling.html      the whole app in one file (node tools/build.mjs)
docs/CONTRACT.md        module contract the code follows
```

## References

- Guest & Pellegrino (1994), The folding of triangulated cylinders, Part I. J. Appl. Mech. 61(4) 773–777. doi:10.1115/1.2901553
- Cai, Deng, Zhou, Feng & Tu (2015), Bistable behavior of the cylindrical origami structure with Kresling pattern. J. Mech. Des. 137(6) 061406. doi:10.1115/1.4030158
- Reid, Lechenault, Rica & Adda-Bedia (2017), Geometry and design of origami bellows with tunable response. Phys. Rev. E 95 013002. doi:10.1103/PhysRevE.95.013002
- Kidambi & Wang (2020), Dynamics of Kresling origami deployment. Phys. Rev. E 101 063003. doi:10.1103/PhysRevE.101.063003
- Filipov, Tachi & Paulino (2015), Origami tubes assembled into stiff, yet reconfigurable structures and metamaterials. PNAS 112(40) 12321–12326. doi:10.1073/pnas.1509465112
- Filipov, Liu, Tachi, Schenk & Paulino (2017), Bar and hinge models for scalable analysis of origami. Int. J. Solids Struct. 124 26–45. doi:10.1016/j.ijsolstr.2017.05.028
- Schenk & Guest (2011), Origami folding: a structural engineering approach. Origami 5, 291–304. doi:10.1201/b10971-27
- Timoshenko & Gere (1961), Theory of Elastic Stability, McGraw-Hill.
- DuPont Kapton HN technical data sheet.

## License

MIT, see [LICENSE](LICENSE).

---

> "Nothing is permanent except change." (the Buddha)
>
> A Kresling tube holds two stable equilibria and no others; it doesn't hover
> in between. Every other configuration is transient, snapping toward one
> resting state or the other the moment you let go, which happens to be
> exactly what the energy curve in `js/physics/analysis.js` plots.

*(Vibecoded via Copilot in the beginning, now maintained by the lord Claude.)*
