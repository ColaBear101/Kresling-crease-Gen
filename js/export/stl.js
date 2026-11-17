// Binary STL export (mm): the printable tube as a closed shell, the two
// embossing mold plates, and a reader that checks what was written.
//
//   tubeSTL(design, { compress = 0, mode = 'uniform', wall, phiOfH, endRings }) -> ArrayBuffer
//       endRings: end-ring heights (mm), one number for both or { bottom, top }; default the
//       sheet's (params.ringBottom, params.ringTop); 0 = none
//   moldSTL(layout, which) -> ArrayBuffer      layout from moldLayout(); which 'mountain' | 'valley'
//   meshStats(buffer) -> { triangles, volume (mm³, signed), area (mm²), watertight,
//                          bbox: { min: [x,y,z], max: [x,y,z], size: [x,y,z] } | null,
//                          vertices (after welding), openEdges, degenerate }
//   tubeMesh(design, opts) -> { positions: Float64Array, triangles: Uint32Array, header,
//                               wall, wallRequested, clamped, clearRadius, splitVertices,
//                               thickness: { min, max } }   (mm, wall measured normal to each face)
//   moldMesh(layout, which) -> { positions, triangles, header, ridges, borders,
//                                shells: [{ start, count, role: 'slab' | 'ridge' | 'border' }] }
//   binarySTL(mesh, header) -> ArrayBuffer    80-byte ASCII header, uint32 count, 50 bytes/triangle
//
// Tube. Outer surface = buildTube() at foldStates(design, compress, mode, phiOfH),
// with the end rings of the sheet standing on the two end polygons (prisms of
// the bottom ring's height below ring 0 and the top ring's above ring N), triangles counter-clockwise
// seen from outside. The inner surface has the same
// topology (apart from split folds, below); each vertex moves inward to the point that puts every incident face
// plane `wall` behind the outer one as closely as possible (weighted least
// squares, see wallOffset). Kresling ring vertices join six faces folded up to
// ~110 deg, so no single offset fits them all: the plain rule "along the vertex
// normal by wall / max(0.5, cos theta)" gave 1.0-1.7 x wall on the default tube
// and 0.3-0.6 x wall on the 12-gon disc; the fit keeps the body of every preset
// at about 0.9-1.5 x wall when deployed. Where one shared inner vertex still
// leaves a face thinner than SPLIT_BELOW x wall and the vertex joins two floors (a
// polygon fold, or where an end ring meets the body), each floor gets its own
// inner vertex and a band of triangles joins the two along the fold. That was
// needed where an end ring meets the 12-gon disc (0.45 x wall with 60 mm rings)
// and with same-hand floors (0.03-0.6 x wall: the floor above a ring is a
// half-turn copy of the floor below, which forces one shared offset straight
// inward); with it every preset keeps 0.8 x wall or more in both stackings.
// Offsets are capped at MITER_MAX x wall, half the shortest edge at the vertex
// and 0.9 x the clear radius; the upright edge of an end ring (as short as the
// ring is tall) only limits the vertical part, to half its length. At the two open rings
// (the rim of each end ring, or ring 0 / ring N where there is none) the offset stays in
// the end plane, so the ends are flat (z = -bottom ring and z = height + top ring)
// and are closed by planar annular strips. Indexed construction: every edge
// belongs to exactly two triangles with opposite directions; signed volume > 0.
// The wall is capped at WALL_CLEAR_MAX x the clear radius (closest approach of
// any crease to the axis) so the bore of a thin tube never closes.
// Limits: in-between fold states are not rigid shapes; near the folded state
// (compress > 0.9) panels are nearly flat, so the wall can get thin or
// self-intersect, and a flat-folding design at compress 1 is degenerate (rings
// coincide). Export compress = 0 for printing. The tube is exported at design
// size; params.scale only applies to paper.
//
// Mold plates. Slab w x h x base (z = 0..base) plus one closed prism per ridge:
// trapezoid section ridgeW wide at the bottom and 0.4 ridgeW on top, standing
// ridgeH above the slab, its bottom MOLD_SINK below the slab top so slicers merge
// the overlapping shells; square ends. Then the registration border: one lower,
// narrower prism (layout.borderH, layout.borderW) per edge of the sheet outline,
// meeting at the corners. 12 + 12 x (ridges + borders) triangles.
//
// Invalid input (invalid design, missing layout, unknown plate) throws an Error
// whose message can be shown to the user as is.

import { buildTube, foldStates, ringHeights } from '../core/tube.js';
import { APP_NAME } from '../core/params.js';

export const MOLD_SINK = 0.05;        // mm a ridge prism reaches down into the slab
export const WALL_CLEAR_MAX = 0.45;   // largest wall as a fraction of the clear radius
export const MITER_MAX = 6;           // largest inner-vertex offset, in walls (sharp creases)
export const SPLIT_BELOW = 0.75;      // thinner than this x wall: each floor at the fold gets its own inner vertex
const EDGE_FRACTION = 0.5;            // ... and at most this fraction of the shortest edge there
const LSQ_REG = 1e-3;                 // weak pull toward the vertex normal (keeps the solve well posed)
const LSQ_UNDER = 4;                  // extra weight on faces whose wall came out too thin
const LSQ_PASSES = 6;
const WELD_TOL = 1e-5;                // mm, vertex welding in meshStats
const MIN_WALL = 0.01;                // mm, the clear-radius cap never goes below this

// ── tube ────────────────────────────────────────────────────────────────────

export function tubeSTL(design, opts = {}) {
  const mesh = tubeMesh(design, opts);
  return binarySTL(mesh, mesh.header);
}

export function tubeMesh(design, opts = {}) {
  if (!design || !design.valid || !design.states || !design.states.deployed) {
    const why = design && Array.isArray(design.errors) && design.errors[0];
    throw new Error(why || 'This design has no valid tube shape to export.');
  }
  const o = opts || {};
  const c = Math.min(1, Math.max(0, finiteOr(Number(o.compress), 0)));
  const mode = o.mode === 'sequential' ? 'sequential' : 'uniform';
  const requested = positiveOr(o.wall, positiveOr(design.params && design.params.wall, 0.8));

  const { Hs, phis } = shapeAt(design, c, mode, o.phiOfH);
  const prm = design.params || {};
  const endRings = ringHeights(o.endRings === undefined ? { bottom: prm.ringBottom, top: prm.ringTop } : o.endRings);
  const tube = buildTube(design, Hs, phis, { endRings });
  const { n, N, rings } = tube;
  const nv = rings.length * n;                   // outer vertices; the inner copy of v is v + nv
  // open rings, kept flat when offset: the rim of each end ring, else ring 0 / ring N
  const openBottom = tube.rimBottom === null ? 0 : tube.rimBottom;
  const openTop = tube.rimTop === null ? N : tube.rimTop;
  const openRing = (k) => k === openBottom || k === openTop;
  const pos = new Float64Array(6 * nv);
  for (let k = 0; k < rings.length; k++) {
    for (let i = 0; i < n; i++) {
      const p = rings[k][i], q = 3 * (k * n + i);
      pos[q] = p[0]; pos[q + 1] = p[1]; pos[q + 2] = p[2];
    }
  }
  for (let q = 0; q < 3 * nv; q++) {
    if (!Number.isFinite(pos[q])) throw new Error('The tube shape at this fold state is not finite.');
  }
  const F = tube.faces.length;
  const outer = new Uint32Array(3 * F);
  for (let j = 0; j < F; j++) {
    const fv = tube.faces[j].v;
    for (let m = 0; m < 3; m++) outer[3 * j + m] = fv[m][0] * n + fv[m][1];
  }

  // face normals (length = 2 x area) and area-weighted vertex normals
  const fnrm = new Float64Array(3 * F);
  const vnrm = new Float64Array(3 * nv);
  for (let j = 0; j < F; j++) {
    const a = 3 * outer[3 * j], b = 3 * outer[3 * j + 1], d = 3 * outer[3 * j + 2];
    const [x, y, z] = triNormal(pos, a, b, d);
    fnrm[3 * j] = x; fnrm[3 * j + 1] = y; fnrm[3 * j + 2] = z;
    for (const v of [a, b, d]) { vnrm[v] += x; vnrm[v + 1] += y; vnrm[v + 2] += z; }
  }
  // faces around each vertex, as compressed rows: incident[start[v] .. start[v+1])
  const start = new Uint32Array(nv + 1);
  for (let q = 0; q < 3 * F; q++) start[outer[q] + 1]++;
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const incident = new Uint32Array(3 * F);
  const fillAt = start.slice(0, nv);
  for (let q = 0; q < 3 * F; q++) incident[fillAt[outer[q]]++] = Math.floor(q / 3);

  // wall, capped so the inner surface cannot reach the axis
  let clear = Infinity;
  for (const e of tube.edges) {
    clear = Math.min(clear, axisDistance(rings[e.a[0]][e.a[1]], rings[e.b[0]][e.b[1]]));
  }
  const wall = Math.min(requested, Math.max(MIN_WALL, WALL_CLEAR_MAX * clear));
  const clamped = wall < requested;

  // inner vertices: one per outer vertex (v + nv), placed by wallOffset. Where that
  // shared inner vertex leaves the wall thinner than SPLIT_BELOW x wall and the vertex
  // joins exactly two floors (a polygon fold, or where an end ring meets the body),
  // each floor gets its own inner vertex and a band of triangles joins the two along
  // the fold (below). Same-hand floors need this: the floor above a ring is a
  // half-turn copy of the floor below, which forces one shared offset to point
  // straight inward, so nearly flat panels kept almost no wall.
  const tiny = 1e-12 * Math.max(1, design.R * design.R);
  const faceFloor = Int32Array.from(tube.faces, (fc) => fc.floor);
  const upper = new Int32Array(nv).fill(-1);     // inner vertex of the upper floor at a split vertex
  const upperFloor = new Int32Array(nv);
  const extra = [];                              // xyz of those extra inner vertices
  let thickMin = Infinity, thickMax = 0, splits = 0;
  const near = [];                               // incident faces of the current vertex
  for (let k = 0; k < rings.length; k++) {
    const end = openRing(k);
    for (let i = 0; i < n; i++) {
      const v = k * n + i, q = 3 * v;
      near.length = 0;
      let edgeMin = Infinity, upright = Infinity;
      for (let r = start[v]; r < start[v + 1]; r++) {
        const j = incident[r], f = 3 * j;
        const fl = Math.hypot(fnrm[f], fnrm[f + 1], fnrm[f + 2]);
        for (let m = 0; m < 3; m++) {
          const u = outer[f + m];
          if (u === v) continue;
          const d = Math.sqrt(dist2(pos, u, v));
          // the upright edge of an end ring (rim vertex straight above/below an end-ring
          // vertex) is as short as the ring is tall; it only limits the vertical offset
          if (u % n === i && (Math.floor(u / n) > N) !== (k > N)) upright = Math.min(upright, d);
          else edgeMin = Math.min(edgeMin, d);
        }
        if (fl > tiny) near.push({ x: fnrm[f] / fl, y: fnrm[f + 1] / fl, z: fnrm[f + 2] / fl, area: fl, thin: false, floor: faceFloor[j] });
      }
      const capLen = Math.min(MITER_MAX * wall, EDGE_FRACTION * edgeMin, 0.9 * clear);
      // inner offset for these faces about the normal (mx, my, mz), capped:
      // [dx, dy, dz, thinnest wall, thickest wall] over the faces
      const solve = (faces, mx, my, mz) => {
        for (const fc of faces) fc.thin = false;
        if (end) mz = 0;                         // kept in the end plane on the two open rings
        let len = Math.hypot(mx, my, mz);
        if (!(len > tiny)) {                     // degenerate (flat) neighbourhood: go radially
          mx = pos[q]; my = pos[q + 1]; mz = 0;
          len = Math.hypot(mx, my) || 1;
        }
        let [dx, dy, dz] = wallOffset(faces, mx / len, my / len, mz / len, wall, end);
        const dl = Math.hypot(dx, dy, dz);
        if (dl > capLen) { dx *= capLen / dl; dy *= capLen / dl; dz *= capLen / dl; }
        // keep the inner copy of a short end ring from folding over (rims are planar: dz = 0)
        if (Math.abs(dz) > EDGE_FRACTION * upright) dz = Math.sign(dz) * EDGE_FRACTION * upright;
        let lo = Infinity, hi = 0;
        for (const fc of faces) { const th = fc.x * dx + fc.y * dy + fc.z * dz; lo = Math.min(lo, th); hi = Math.max(hi, th); }
        return [dx, dy, dz, lo, hi];
      };
      const sideOf = (faces) => {                // area-weighted normal of some of the faces
        let sx = 0, sy = 0, sz = 0;
        for (const fc of faces) { sx += fc.x * fc.area; sy += fc.y * fc.area; sz += fc.z * fc.area; }
        return solve(faces, sx, sy, sz);
      };
      let off = solve(near, vnrm[q], vnrm[q + 1], vnrm[q + 2]), up = null, top = 0;
      if (!end && off[3] < SPLIT_BELOW * wall) {
        const floors = [...new Set(near.map((fc) => fc.floor))];
        if (floors.length === 2) {
          top = Math.max(floors[0], floors[1]);
          const lower = sideOf(near.filter((fc) => fc.floor !== top)), higher = sideOf(near.filter((fc) => fc.floor === top));
          if (Math.min(lower[3], higher[3]) > off[3]) { off = lower; up = higher; }
        }
      }
      for (const s of up ? [off, up] : [off]) { thickMin = Math.min(thickMin, s[3]); thickMax = Math.max(thickMax, s[4]); }
      const qi = q + 3 * nv;
      pos[qi] = pos[q] - off[0];
      pos[qi + 1] = pos[q + 1] - off[1];
      pos[qi + 2] = pos[q + 2] - off[2];
      if (up) {
        upper[v] = 2 * nv + extra.length / 3;
        upperFloor[v] = top;
        extra.push(pos[q] - up[0], pos[q + 1] - up[1], pos[q + 2] - up[2]);
        splits++;
      }
    }
  }
  const all = extra.length ? new Float64Array(6 * nv + extra.length) : pos;
  if (extra.length) { all.set(pos); all.set(extra, 6 * nv); }
  const innerOf = (v, j) => (upper[v] >= 0 && faceFloor[j] === upperFloor[v] ? upper[v] : v + nv);

  // rim: directed outer edges u -> w with no reverse (the two end rings)
  const M = 2 * nv;
  const directed = new Set();
  for (let j = 0; j < F; j++) {
    for (let m = 0; m < 3; m++) directed.add(outer[3 * j + m] * M + outer[3 * j + (m + 1) % 3]);
  }
  const rim = [];
  for (let j = 0; j < F; j++) {
    for (let m = 0; m < 3; m++) {
      const u = outer[3 * j + m], w = outer[3 * j + (m + 1) % 3];
      if (!directed.has(w * M + u)) rim.push(u, w);
    }
  }

  // band along a split fold, ring k: the lower floor's inner surface ends at d = v + nv,
  // the upper floor's starts at u = upper[v]. Seen from outside, the lower floor runs
  // along the ring from i + 1 to i and the upper floor from i to i + 1 (buildTube), so
  // the band d(i+1) -> d(i) -> u(i) -> u(i+1) closes the shell; a mirrored tube runs the
  // other way. An unsplit end (u = d) leaves one triangle of the quad.
  const band = [];
  for (let k = 0; k <= N; k++) {
    for (let i = 0; i < n; i++) {
      const v0 = k * n + i, v1 = k * n + (i + 1) % n;
      if (upper[v0] < 0 && upper[v1] < 0) continue;
      const d0 = v0 + nv, d1 = v1 + nv;
      const u0 = upper[v0] >= 0 ? upper[v0] : d0, u1 = upper[v1] >= 0 ? upper[v1] : d1;
      const quad = dist2(all, d1, u0) <= dist2(all, d0, u1) ? [[d1, d0, u0], [d1, u0, u1]] : [[d1, d0, u1], [d0, u0, u1]];
      for (const [a, b, e] of quad) {
        if (a === b || b === e || e === a) continue;
        if (design.chirEff < 0) band.push(a, e, b); else band.push(a, b, e);
      }
    }
  }

  const T = 2 * F + rim.length + band.length / 3;   // outer + inner + 2 per rim edge + band
  const tri = new Uint32Array(3 * T);
  let t = 0;
  const put = (a, b, d) => { tri[t++] = a; tri[t++] = b; tri[t++] = d; };
  for (let j = 0; j < F; j++) put(outer[3 * j], outer[3 * j + 1], outer[3 * j + 2]);
  for (let j = 0; j < F; j++) put(innerOf(outer[3 * j], j), innerOf(outer[3 * j + 2], j), innerOf(outer[3 * j + 1], j));
  for (let r = 0; r < rim.length; r += 2) {
    // end-cap quad w -> u -> iu -> iw runs against both rims; split on the shorter diagonal
    const u = rim[r], w = rim[r + 1], iu = u + nv, iw = w + nv;
    if (dist2(all, w, iu) <= dist2(all, u, iw)) { put(w, u, iu); put(w, iu, iw); }
    else { put(w, u, iw); put(u, iu, iw); }
  }
  for (let b = 0; b < band.length; b += 3) put(band[b], band[b + 1], band[b + 2]);

  const header = tubeHeader(design, wall, clamped, tube.endRings, stateTag(c, mode));
  return {
    positions: all, triangles: tri, header, endRings: tube.endRings,
    wall, wallRequested: requested, clamped, clearRadius: clear,
    thickness: { min: Number.isFinite(thickMin) ? thickMin : 0, max: thickMax },
    splitVertices: splits,
  };
}

/**
 * Inward offset (dx, dy, dz) of one vertex: the point that puts every incident
 * face plane `wall` behind the outer surface as closely as possible, i.e. it
 * minimises sum A_f (n_f . d - wall)^2 + reg |d - wall m|^2, re-weighting faces
 * that came out thinner than `wall` (LSQ_UNDER) so the wall errs on the thick
 * side. Exact where up to three faces meet; best fit at the six-face ring
 * vertices. `planar` keeps dz = 0 (the open rings). Falls back to the plain normal
 * rule wall / max(0.5, cos theta) along m if the solution does not point inward.
 * faces: [{ x, y, z (unit normal), area, thin }], m: unit area-weighted normal.
 */
function wallOffset(faces, mx, my, mz, wall, planar) {
  if (!faces.length) return [wall * mx, wall * my, wall * mz];
  let total = 0;
  for (const f of faces) total += f.area;
  let dx = wall * mx, dy = wall * my, dz = wall * mz;
  for (let pass = 0; pass < LSQ_PASSES; pass++) {
    let a11 = LSQ_REG, a12 = 0, a13 = 0, a22 = LSQ_REG, a23 = 0, a33 = LSQ_REG;
    let b1 = LSQ_REG * wall * mx, b2 = LSQ_REG * wall * my, b3 = LSQ_REG * wall * mz;
    for (const f of faces) {
      const w = (f.area / total) * (f.thin ? LSQ_UNDER : 1);
      a11 += w * f.x * f.x; a12 += w * f.x * f.y; a13 += w * f.x * f.z;
      a22 += w * f.y * f.y; a23 += w * f.y * f.z; a33 += w * f.z * f.z;
      b1 += w * wall * f.x; b2 += w * wall * f.y; b3 += w * wall * f.z;
    }
    if (planar) {
      const det = a11 * a22 - a12 * a12;
      dx = (b1 * a22 - b2 * a12) / det;
      dy = (a11 * b2 - a12 * b1) / det;
      dz = 0;
    } else {
      const c11 = a22 * a33 - a23 * a23, c12 = a13 * a23 - a12 * a33, c13 = a12 * a23 - a13 * a22;
      const det = a11 * c11 + a12 * c12 + a13 * c13;
      dx = (c11 * b1 + c12 * b2 + c13 * b3) / det;
      dy = (c12 * b1 + (a11 * a33 - a13 * a13) * b2 + (a12 * a13 - a11 * a23) * b3) / det;
      dz = (c13 * b1 + (a12 * a13 - a11 * a23) * b2 + (a11 * a22 - a12 * a12) * b3) / det;
    }
    for (const f of faces) f.thin = f.x * dx + f.y * dy + f.z * dz < wall;
  }
  if (Number.isFinite(dx + dy + dz) && dx * mx + dy * my + dz * mz > 0) return [dx, dy, dz];
  let cosMin = 1;
  for (const f of faces) cosMin = Math.min(cosMin, f.x * mx + f.y * my + f.z * mz);
  const d = wall / Math.max(0.5, cosMin);
  return [d * mx, d * my, d * mz];
}

// Per-floor heights and twists; a twist callback that throws or returns a
// non-finite value falls back to the linear twist of foldStates().
function shapeAt(design, c, mode, phiOfH) {
  const plain = foldStates(design, c, mode, null);
  if (typeof phiOfH !== 'function') return plain;
  let relaxed = null;
  try { relaxed = foldStates(design, c, mode, phiOfH); } catch (e) { relaxed = null; }
  if (!relaxed) return plain;
  return { Hs: plain.Hs, phis: relaxed.phis.map((x, k) => (Number.isFinite(x) ? x : plain.phis[k])) };
}

function designTag(design) {
  const p = design.params || {};
  const dia = Number.isFinite(p.dia) ? String(Math.round(p.dia * 100) / 100) : String(design.D);
  return `n${design.n}_d${dia}_f${design.floors}${design.stack > 1 ? `x${design.stack}` : ''}`;
}

const trimNum = (x) => String(+x.toFixed(2));

// Header of the tube STL. The STL header holds 80 bytes, so long ones drop
// "units mm" first, then shorten "rings" to "r", and the fold state is never cut.
// End rings read "rings 10" when both are 10 mm, else "rings 10/20" (bottom/top).
function tubeHeader(design, wall, clamped, endRings, state) {
  const { bottom = 0, top = 0 } = endRings || {};
  const ringTag = !bottom && !top ? '' : bottom === top ? trimNum(bottom) : `${trimNum(bottom)}/${trimNum(top)}`;
  const wallTag = `wall ${wall.toFixed(2)}${clamped ? ' (max)' : ''}`;
  const options = [[true, 'rings '], [false, 'rings '], [false, 'r']];
  let text = '';
  for (const [units, ringWord] of options) {
    const parts = [`${APP_NAME} tube ${designTag(design)}`];
    if (units) parts.push('units mm');
    parts.push(wallTag);
    if (ringTag) parts.push(`${ringWord}${ringTag}`);
    parts.push(state);
    text = parts.join(', ');
    if (text.length <= 80) return text;
  }
  return text;
}

function stateTag(c, mode) {
  if (c === 0) return 'deployed';
  if (c === 1) return 'folded';
  return `folded ${Math.round(c * 100)}%${mode === 'sequential' ? ' seq' : ''}`;
}

/** Distance from the z axis to segment p-q (closest approach in plan view). */
function axisDistance(p, q) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.min(1, Math.max(0, -(p[0] * dx + p[1] * dy) / L2)) : 0;
  return Math.hypot(p[0] + t * dx, p[1] + t * dy);
}

// ── mold plates ─────────────────────────────────────────────────────────────

export function moldSTL(layout, which) {
  const mesh = moldMesh(layout, which);
  return binarySTL(mesh, mesh.header);
}

export function moldMesh(layout, which = 'mountain') {
  if (!layout) throw new Error('No mold plates: the design has no valid crease pattern.');
  if (which !== 'mountain' && which !== 'valley') {
    throw new Error(`Unknown mold plate "${which}": use 'mountain' or 'valley'.`);
  }
  const { w, h, base, ridgeH, ridgeW } = layout;
  if (![w, h, base, ridgeH, ridgeW].every((x) => Number.isFinite(x) && x > 0)) {
    throw new Error('The mold layout has missing or non-positive dimensions.');
  }
  const segs = Array.isArray(layout[which]) ? layout[which] : [];
  const pos = [], tri = [], shells = [];
  const solid = (role, bottom, top) => {
    shells.push({ start: tri.length / 3, count: 12, role });
    addHexahedron(pos, tri, bottom, top);
  };
  const rect = (z) => [[0, 0, z], [w, 0, z], [w, h, z], [0, h, z]];
  solid('slab', rect(0), rect(base));

  const z0 = base - MOLD_SINK;
  // one closed prism per segment: `width` at the slab, 0.4 x width on top, `height` above the slab
  const prisms = (list, role, height, width) => {
    const wb = width / 2, wt = 0.2 * width, z1 = base + height;
    let count = 0;
    for (const s of list) {
      if (!s || !s.a || !s.b) continue;
      const [ax, ay] = s.a, [bx, by] = s.b;
      const L = Math.hypot(bx - ax, by - ay);
      if (!(L > 1e-6)) continue;
      const px = (ay - by) / L, py = (bx - ax) / L;           // left normal of a -> b
      const section = (hw, z) => [
        [ax - px * hw, ay - py * hw, z], [bx - px * hw, by - py * hw, z],
        [bx + px * hw, by + py * hw, z], [ax + px * hw, ay + py * hw, z],
      ];
      solid(role, section(wb, z0), section(wt, z1));
      count++;
    }
    return count;
  };
  const ridges = prisms(segs, 'ridge', ridgeH, ridgeW);
  // registration border along the sheet outline (the same on both plates)
  const { borderH, borderW } = layout;
  const borders = Array.isArray(layout.border) && borderH > 0 && borderW > 0
    ? prisms(layout.border, 'border', borderH, borderW) : 0;
  // The STL header holds 80 bytes: shorter wordings keep the print scale readable.
  const scaleTag = Number.isFinite(layout.scale) && Math.abs(layout.scale - 1) > 1e-9
    ? `, sheet at ${+(layout.scale * 100).toFixed(1)}%` : '';
  const size = `${f1(w)}x${f1(h)}x${f1(base)}`;
  const headers = [
    `${APP_NAME} ${which} mold, units mm, ${size}, ${ridges} ridges ${f1(ridgeH)} high${scaleTag}`,
    `${APP_NAME} ${which} mold, ${size} mm, ${ridges} ridges${scaleTag}`,
    `${which} mold ${size} mm${scaleTag}`,
  ];
  const header = headers.find((t) => t.length <= 80) || headers[headers.length - 1];
  return { positions: Float64Array.from(pos), triangles: Uint32Array.from(tri), header, shells, ridges, borders };
}

/**
 * Closed six-sided solid from a bottom and a top quad (top[k] above bottom[k]),
 * 12 outward triangles. The bottom is reordered to run counter-clockwise from +z.
 */
function addHexahedron(pos, tri, bottom, top) {
  let area = 0;
  for (let k = 0; k < 4; k++) {
    const p = bottom[k], q = bottom[(k + 1) % 4];
    area += p[0] * q[1] - q[0] * p[1];
  }
  if (area < 0) { bottom = [...bottom].reverse(); top = [...top].reverse(); }
  const b = pos.length / 3;
  for (const p of [...bottom, ...top]) pos.push(p[0], p[1], p[2]);
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  for (const [q0, q1, q2, q3] of quads) tri.push(b + q0, b + q1, b + q2, b + q0, b + q2, b + q3);
}

function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }

// ── binary STL writer ───────────────────────────────────────────────────────

export function binarySTL(mesh, header = '') {
  const P = mesh.positions, T = mesh.triangles;
  const count = Math.floor(T.length / 3);
  const buf = new ArrayBuffer(84 + 50 * count);
  const dv = new DataView(buf);
  const text = headerText(header);
  for (let i = 0; i < 80; i++) dv.setUint8(i, text.charCodeAt(i));
  dv.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < count; t++) {
    const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2];
    const [nx, ny, nz] = triNormal(P, a, b, c);
    const l = Math.hypot(nx, ny, nz) || 1;     // degenerate triangle -> zero normal
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    dv.setFloat32(o + 12, P[a], true); dv.setFloat32(o + 16, P[a + 1], true); dv.setFloat32(o + 20, P[a + 2], true);
    dv.setFloat32(o + 24, P[b], true); dv.setFloat32(o + 28, P[b + 1], true); dv.setFloat32(o + 32, P[b + 2], true);
    dv.setFloat32(o + 36, P[c], true); dv.setFloat32(o + 40, P[c + 1], true); dv.setFloat32(o + 44, P[c + 2], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return buf;
}

// Printable ASCII, padded to 80 bytes; never starts with "solid" (that marks ASCII STL).
function headerText(s) {
  let t = String(s || APP_NAME).replace(/[^\x20-\x7e]/g, '?');
  if (/^\s*solid/i.test(t)) t = `STL ${t}`;
  return t.slice(0, 80).padEnd(80, ' ');
}

/** Cross product (b - a) x (c - a) of the points at offsets a, b, c in P (length = 2 x area). */
function triNormal(P, a, b, c) {
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function dist2(P, i, j) {
  const dx = P[3 * i] - P[3 * j], dy = P[3 * i + 1] - P[3 * j + 1], dz = P[3 * i + 2] - P[3 * j + 2];
  return dx * dx + dy * dy + dz * dz;
}

// ── reader / statistics ─────────────────────────────────────────────────────

/**
 * Parses a binary STL. volume = signed divergence-theorem sum (positive when the
 * normals point outward); watertight = after welding vertices closer than 1e-5 mm,
 * every directed edge is matched by as many reversed copies (so every undirected
 * edge is used an even number of times). openEdges counts the undirected edges
 * that break this; degenerate counts triangles with two welded corners.
 */
export function meshStats(buffer) {
  const out = {
    triangles: 0, volume: 0, area: 0, watertight: false, bbox: null,
    vertices: 0, openEdges: 0, degenerate: 0,
  };
  const bytes = asBytes(buffer);
  if (!bytes || bytes.byteLength < 84) return out;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const T = Math.min(dv.getUint32(80, true), Math.floor((bytes.byteLength - 84) / 50));
  out.triangles = T;
  if (T === 0) return out;

  const xyz = new Float64Array(9 * T);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let finite = true;
  for (let t = 0; t < T; t++) {
    const o = 84 + 50 * t + 12;
    for (let k = 0; k < 9; k++) {
      const x = dv.getFloat32(o + 4 * k, true);
      xyz[9 * t + k] = x;
      if (!Number.isFinite(x)) { finite = false; continue; }
      const ax = k % 3;
      if (x < min[ax]) min[ax] = x;
      if (x > max[ax]) max[ax] = x;
    }
  }
  if (!finite) { out.volume = NaN; out.area = NaN; return out; }
  out.bbox = { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };

  // signed volume about the bbox centre (less cancellation than about the origin)
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
  let vol = 0, area = 0;
  for (let t = 0; t < T; t++) {
    const q = 9 * t;
    const ax = xyz[q] - cx, ay = xyz[q + 1] - cy, az = xyz[q + 2] - cz;
    const bx = xyz[q + 3] - cx, by = xyz[q + 4] - cy, bz = xyz[q + 5] - cz;
    const ex = xyz[q + 6] - cx, ey = xyz[q + 7] - cy, ez = xyz[q + 8] - cz;
    vol += ax * (by * ez - bz * ey) + ay * (bz * ex - bx * ez) + az * (bx * ey - by * ex);
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = ex - ax, wy = ey - ay, wz = ez - az;
    area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
  }
  out.volume = vol / 6;
  out.area = area / 2;

  const weld = makeWelder(WELD_TOL);
  const ids = new Uint32Array(3 * T);
  for (let q = 0; q < 3 * T; q++) ids[q] = weld.id(xyz[3 * q], xyz[3 * q + 1], xyz[3 * q + 2]);
  const V = weld.count();
  out.vertices = V;

  const edges = new Map();                       // directed edge u -> w (key u*V + w) -> uses
  for (let t = 0; t < T; t++) {
    const a = ids[3 * t], b = ids[3 * t + 1], c = ids[3 * t + 2];
    if (a === b || b === c || c === a) out.degenerate++;
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      if (u === w) continue;
      const key = u * V + w;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let open = 0;
  for (const [key, uses] of edges) {
    const u = Math.floor(key / V), w = key - u * V;
    const back = edges.get(w * V + u);
    if (back === undefined) open++;                // reverse missing entirely
    else if (u < w && back !== uses) open++;       // both present: count the pair once
  }
  out.openEdges = open;
  out.watertight = open === 0;
  return out;
}

function asBytes(buffer) {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return null;
}

// Greedy vertex welding on a hash grid of cell size tol (checks the 27 nearest cells).
function makeWelder(tol) {
  const cells = new Map();
  const xs = [], ys = [], zs = [];
  const tol2 = tol * tol;
  const find = (list, x, y, z) => {
    if (!list) return -1;
    for (const v of list) {
      const dx = xs[v] - x, dy = ys[v] - y, dz = zs[v] - z;
      if (dx * dx + dy * dy + dz * dz <= tol2) return v;
    }
    return -1;
  };
  return {
    count: () => xs.length,
    id(x, y, z) {
      const i = Math.round(x / tol), j = Math.round(y / tol), k = Math.round(z / tol);
      const home = `${i},${j},${k}`;
      let v = find(cells.get(home), x, y, z);
      if (v >= 0) return v;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let dk = -1; dk <= 1; dk++) {
            if (!di && !dj && !dk) continue;
            v = find(cells.get(`${i + di},${j + dj},${k + dk}`), x, y, z);
            if (v >= 0) return v;
          }
        }
      }
      v = xs.length;
      xs.push(x); ys.push(y); zs.push(z);
      const list = cells.get(home);
      if (list) list.push(v); else cells.set(home, [v]);
      return v;
    },
  };
}

function finiteOr(x, fallback) { return Number.isFinite(x) ? x : fallback; }

function positiveOr(x, fallback) {
  const v = Number(x);
  return x !== null && x !== undefined && x !== '' && Number.isFinite(v) && v > 0 ? v : fallback;
}
