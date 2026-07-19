export const A4_W = 21.0;
export const A4_H = 29.7;

export const paramPairs = [
  ['r-dia','n-dia'],       ['r-height','n-height'],   ['r-n','n-n'],         ['r-floors','n-floors'],
  ['r-angle','n-angle'],   ['r-ext','n-ext'],          ['r-seaml','n-seaml'], ['r-seamr','n-seamr'],
  ['r-extcols','n-extcols'],['r-stack','n-stack'],     ['r-scale','n-scale'], ['r-compress','n-compress'],
  ['r-wallmm','n-wallmm'], ['r-moldbase','n-moldbase'],['r-ridgeh','n-ridgeh'],['r-ridgew','n-ridgew'],
  ['r-thick','n-thick'],
];

export const PRESET_KEYS = [
  'dia','height','n','floors','angle','ext','seaml','seamr','extcols','stack','scale','compress','wallmm','thick',
];

export const PRESETS = {
  bistable6:  {dia:4,   height:16, n:6,  floors:8,  angle:105, ext:1.5, seaml:1.57, seamr:1.57, extcols:1, stack:1, scale:100, compress:0, wallmm:0.8},
  bistable8:  {dia:5,   height:20, n:8,  floors:10, angle:100, ext:2,   seaml:1.96, seamr:1.96, extcols:1, stack:1, scale:100, compress:0, wallmm:0.8},
  monostable: {dia:3,   height:24, n:6,  floors:6,  angle:100, ext:1,   seaml:0,    seamr:0,    extcols:0, stack:1, scale:100, compress:0, wallmm:0.8},
  tower:      {dia:2.5, height:30, n:6,  floors:16, angle:95,  ext:1.5, seaml:1.31, seamr:1.31, extcols:1, stack:2, scale:80,  compress:0, wallmm:0.8},
  flat:       {dia:8,   height:8,  n:12, floors:4,  angle:90,  ext:1,   seaml:0,    seamr:0,    extcols:0, stack:1, scale:60,  compress:0, wallmm:0.8},
  compact:    {dia:3,   height:6,  n:5,  floors:4,  angle:110, ext:1,   seaml:1.88, seamr:1.88, extcols:1, stack:1, scale:100, compress:0, wallmm:0.8},
};

// ─── Academic & data sources cited by the geometry / energy / material models ──
// Single source of truth for the in-app "Sources" panel (rendered by
// ui.js:toggleSourcesModal). Every entry here is a citation actually verified
// against the publisher/DOI record — nothing invented. (Note: README.md's
// "Geometry & physics" section previously also listed a "Fernandez et al.
// (2022)" reference; it isn't used anywhere in this codebase and couldn't be
// verified against any findable publication, so it's intentionally omitted
// here and has been dropped from the README too.)
export const SOURCES = [
  {
    cite: 'Alipour, S. M., & Arghavani, J. (2023). On the starting point in designing Kresling origami. Aerospace Science and Technology, 138, 108301.',
    url:  'https://doi.org/10.1016/j.ast.2023.108301',
    use:  'Exact 3D crease lengths, polygon side length, and the designed-state φ scan used by geometry.js',
  },
  {
    cite: 'Masana, R., & Daqaq, M. F. (2019). Equilibria and bifurcations of a foldable paper-based spring inspired by Kresling-pattern origami. Physical Review E, 100(6), 063001.',
    url:  'https://doi.org/10.1103/PhysRevE.100.063001',
    use:  'Axial truss strain-energy model E(h, φ) behind the energy graph and bistability check',
  },
  {
    cite: 'Schenk, M., & Guest, S. D. (2011). Origami folding: A structural engineering approach. In Origami5: Fifth International Meeting of Origami Science, Mathematics, and Education (p. 291). A K Peters.',
    url:  'https://doi.org/10.1201/b10971-27',
    use:  'Bar-and-hinge convention for treating a crease as a rotational spring',
  },
  {
    cite: 'Filipov, E. T., Tachi, T., & Paulino, G. H. (2015). Origami tubes assembled into stiff, yet reconfigurable structures and metamaterials. PNAS, 112(40), 12321–12326.',
    url:  'https://doi.org/10.1073/pnas.1509465112',
    use:  'Thin-plate torsional-hinge crease-stiffness formula, k_fold = E·t³·L / (12·(1−ν²)·w)',
  },
  {
    cite: 'DuPont™ Kapton® HN polyimide film — Technical Data Sheet (ASTM D-882 / D-5213).',
    url:  'https://www.beta.dupont.com/content/dam/electronics/amer/us/en/electronics/public/documents/en/EI-10206-Kapton-HN-Data-Sheet.pdf',
    use:  'E ≈ 2.5 GPa, ν = 0.34 material constants for the Polyimide (Kapton-type) preset',
  },
  {
    cite: 'Cai, J., Deng, X., Zhou, Y., Feng, J., & Tu, Y. (2015). Bistable behavior of the cylindrical origami structure with Kresling pattern. Journal of Mechanical Design, 137(6), 061406.',
    url:  'https://doi.org/10.1115/1.4030158',
    use:  'Closed-form bistability criterion 1 < red_len/side < 1/sin(π/n), replacing the previous ad-hoc h0/R heuristic in geometry.js',
  },
];
