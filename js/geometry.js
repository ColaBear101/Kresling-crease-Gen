import { A4_W, A4_H } from './constants.js';

// ─── Core geometry ───────────────────────────────────────────────────────────
export function computeGeometry(p) {
  const { dia, height, n, floors, stack, angle, chir } = p;
  const R        = dia / 2;
  const b        = (dia * Math.PI) / n;
  const floor_h  = height / floors;
  const theta    = angle * Math.PI / 180;
  const dx       = floor_h / Math.tan(theta);
  const red_len  = Math.hypot(2 * dx, floor_h);
  const green_dx = 2 * dx * chir - b;
  const green_len = Math.hypot(green_dx, floor_h);
  const vg = [green_dx, floor_h], vr = [2 * dx * chir, floor_h];
  const gr_angle = Math.acos(
    Math.max(-1, Math.min(1, (vg[0]*vr[0] + vg[1]*vr[1]) / (Math.hypot(...vg) * Math.hypot(...vr))))
  ) * 180 / Math.PI;
  const h0r      = floor_h / R;
  const bistable = h0r > 0 && h0r < 2 * Math.sin(Math.PI / n) && dx > 0 && dx < b;
  const valid    = dx < b && floor_h > 0 && b > 0;

  // ─── Theoretical extend / fold limits ──────────────────────────────────────
  // Model: the mountain (red) crease is the inextensible constraint that ties
  // floor height to twist offset — same relation already used by the energy
  // graph: dx(h) = √(red_len² − h²). Extended state = no twist (dx → 0), so
  // floor height is maximal and equal to the crease length itself. Folded
  // state = the largest dx the flat pattern allows before adjacent columns
  // overlap (dx = b, the same boundary the "valid" check already enforces).
  const totalFloors   = (floors || 1) * (stack || 1);
  const extFloor_h    = red_len;                       // dx → 0 (fully untwisted)
  const foldDx        = Math.min(b, red_len);          // dx at the self-overlap limit
  const foldFloor_h   = Math.sqrt(Math.max(0, red_len * red_len - foldDx * foldDx));
  const extendLen     = extFloor_h  * totalFloors;     // theoretical max deployed length
  const foldLen       = foldFloor_h * totalFloors;     // theoretical min (collapsed) length

  // Compressed inner diameter: at the fold limit, ring f and ring f+1 are
  // twisted ±(foldDx/R) about the axis (alternating convention used by the
  // 3-D renderer), so the relative twist between them is 2·(foldDx/R). For a
  // straight edge joining two points on circles of radius R separated by
  // height h and relative twist angle ψ, the closest approach to the axis
  // occurs at the edge midpoint, at radius R·cos(ψ/2) — here ψ/2 = foldDx/R.
  const foldAng        = foldDx / R;
  const foldInnerR     = R * Math.cos(foldAng);
  const foldInnerValid = foldInnerR > 0;               // false ⇒ neck would self-intersect the axis
  const foldInnerDia   = foldInnerValid ? 2 * foldInnerR : null;

  return {
    b, floor_h, dx, red_len, green_len, gr_angle, h0r, bistable, valid, R, green_dx,
    extendLen, foldLen, foldDx, foldInnerDia, foldInnerValid,
  };
}

// ─── Pattern bounds (single memoised definition — fixes the duplicate-definition bug) ───
let _lastBoundsKey = '', _lastBounds = null;

export function patternBounds(p, g) {
  const key = `${p.n},${p.floors},${p.ext},${p.seaml},${p.seamr},${p.extcols},${p.stack},${p.chir},${p.scale},${g.b.toFixed(6)},${g.floor_h.toFixed(6)},${g.dx.toFixed(6)}`;
  if (key === _lastBoundsKey) return _lastBounds;
  _lastBoundsKey = key;

  const { n, floors, ext, seaml, seamr, extcols, stack } = p;
  const { b, floor_h, dx } = g;
  const totalFloors = floors * stack;
  const col_min = -extcols, col_max = n + extcols;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let f = 0; f <= totalFloors; f++) {
    for (let col = col_min; col <= col_max; col++) {
      let x = col * b, y = f * floor_h;
      if (f % 2 === 1) x += dx * p.chir; else x -= dx * p.chir;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  minX -= seaml; maxX += seamr; minY -= ext; maxY += ext;
  _lastBounds = { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  return _lastBounds;
}

// ─── Shared vertex builder ────────────────────────────────────────────────────
// Single source of truth for the 2-D crease-pattern vertices.
// Replaces the 6+ identical loops that were scattered across renders and exporters.
export function buildVerts(p, g) {
  const { n, floors, ext, seaml, seamr, extcols, stack, scale, chir } = p;
  const { b, floor_h, dx } = g;
  const col_min     = -extcols, col_max = n + extcols;
  const totalFloors = floors * stack;
  const bounds      = patternBounds(p, g);
  const scaledW     = bounds.w * scale, scaledH = bounds.h * scale;
  const patOriginX  = (A4_W - scaledW) / 2;
  const patOriginY  = (A4_H - scaledH) / 2;

  const verts = [];
  for (let f = 0; f <= totalFloors; f++) {
    const row = [];
    for (let col = col_min; col <= col_max; col++) {
      let x = col * b, y = f * floor_h;
      if (f % 2 === 1) x += dx * chir; else x -= dx * chir;
      row.push([(x - bounds.minX) * scale + patOriginX,
                (y - bounds.minY) * scale + patOriginY]);
    }
    verts.push(row);
  }

  return {
    verts, bounds, patOriginX, patOriginY, scaledW, scaledH,
    extS:   ext   * scale,
    seamlS: seaml * scale,
    seamrS: seamr * scale,
  };
}
