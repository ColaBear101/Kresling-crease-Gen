// ─── Material properties for crease spring-stiffness modelling ──────────────
// Supplies real spring-constant values (k_m, k_v) to energy.js's dihedral-
// angle energy model, replacing the generic placeholder constants when an
// actual sheet material is selected.
//
// MODEL — thin-plate torsional hinge:
// Each crease is treated as a hinge running the length of the fold. A thin
// isotropic sheet of thickness t and Young's modulus E has flexural
// rigidity per unit width D = E t^3 / (12 (1 - nu^2))  (standard Kirchhoff
// thin-plate result). Treating the material adjacent to a crease of length
// L as bending over an effective transverse width w, the crease's
// rotational (torsional) spring constant is
//
//     k_fold = D * L / w = E t^3 L / (12 (1 - nu^2) w)      [N*m / rad]
//
// This is the same bar-and-hinge convention used to assign fold stiffness
// in rigid-origami tube models (Schenk & Guest 2011; Filipov, Tachi &
// Paulino, PNAS 2015 — origami tubes built from Kresling-like unit cells).
// Masana & Daqaq (2019) do not derive their own spring constant from a
// material — they normalise it to 1 ("all results are normalized with
// respect to the axial rigidity... EA is set to unity") — so real values
// are supplied here per-material rather than taken from the paper.
//
// "w" (effective bending width) is a modelling choice, not a measured
// quantity: real creases localise bending over a zone whose true width
// depends on how sharply they were pre-scored, which the flat pattern
// alone doesn't tell you. Absent a measured value, this uses the local
// panel dimension transverse to each crease as an order-of-magnitude
// default — the polygon side (g.b) for the mountain crease, the floor
// height (g.floor_h) for the diagonal.

export const MATERIALS = {
  polyimide: {
    label: 'Polyimide (Kapton-type) film',
    // DuPont Kapton(R) HN datasheet (ASTM D-882-91, Method A): tensile
    // modulus ~2.76 GPa at 23C, fairly flat across the 25-125um gauge
    // range; density 1.42 g/cc. 2.5 GPa is used below as a representative
    // round figure — commercial polyimide films run roughly 2.1-2.8 GPa
    // depending on grade and manufacturer.
    E_GPa: 2.5,
    nu: 0.34, // representative polyimide Poisson's ratio
    density_g_cm3: 1.42, // DuPont Kapton HN datasheet, ASTM D-1505
  },
};

const PA_PER_GPA = 1e9;
const M_PER_UM   = 1e-6;
const M_PER_CM   = 1e-2;
const NCM_PER_NM = 100; // 1 N*m = 100 N*cm

// Thin-plate torsional hinge stiffness for one crease, in N*cm/rad.
//   E_GPa     Young's modulus, GPa
//   nu        Poisson's ratio
//   thickUm   sheet thickness, micrometres
//   lenCm     crease length, cm
//   widthCm   effective bending width transverse to the crease, cm
function foldStiffness(E_GPa, nu, thickUm, lenCm, widthCm) {
  const E = E_GPa * PA_PER_GPA;
  const t = thickUm * M_PER_UM;
  const L = lenCm * M_PER_CM;
  const w = Math.max(widthCm, 1e-4) * M_PER_CM; // guard against /0 on degenerate geometry
  const k_Nm = (E * t ** 3 * L) / (12 * (1 - nu * nu) * w);
  return k_Nm * NCM_PER_NM;
}

// Returns {k_m, k_v} for energy.js's dihedral-angle energy model.
//   k_m scales the mountain-crease term  (length ~ g.red_len,   width ~ g.b)
//   k_v scales the diagonal/valley term  (length ~ g.green_len, width ~ g.floor_h)
// Falls back to the original generic constants (2.0 / 1.0) — i.e. unchanged
// behaviour — unless p.material === 'polyimide'.
export function springConstants(p, g) {
  if (p.material === 'polyimide') {
    const mat = MATERIALS.polyimide;
    const t   = p.thicknessUm || 50;
    return {
      k_m: foldStiffness(mat.E_GPa, mat.nu, t, g.red_len,   g.b),
      k_v: foldStiffness(mat.E_GPa, mat.nu, t, g.green_len, g.floor_h),
    };
  }
  return { k_m: 2.0, k_v: 1.0 };
}

// Mass of the physical sheet consumed by the flat crease pattern (the actual
// printed/cut piece — cut border + seams + end extension — since that's the
// material a person buys and cuts, whether or not every bit of it ends up on
// the folded tube). Returns grams, or null if material isn't polyimide (the
// generic material has no density, so a "mass" would be meaningless).
//   areaCm2   flat-pattern printed area in cm^2 (bounds.w*scale * bounds.h*scale)
export function sheetMassGrams(p, areaCm2) {
  if (p.material !== 'polyimide') return null;
  const t_cm = (p.thicknessUm || 50) * M_PER_UM / M_PER_CM; // um -> cm
  return MATERIALS.polyimide.density_g_cm3 * t_cm * areaCm2;
}
