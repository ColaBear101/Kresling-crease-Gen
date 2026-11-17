// Orbit camera and small shading helpers shared by the canvas 3-D views
// (js/render/view3d.js and js/render/moldview.js). No DOM access at import.
//
// World frame: mm, z up. The eye orbits `target` at the distance where the
// model's bounding sphere fills the shorter side of the view (fit). Zoom and
// pan act on the image plane (a focal-length zoom), so the eye never moves
// into the model and no near-plane clipping is needed.
//
//   const cam = new OrbitCamera({ yaw, pitch, fov, minPitch, maxPitch })   radians
//   cam.setViewport(w, h)        drawing area in CSS px
//   cam.fit(center, radius)      aim at center; keeps yaw, pitch, zoom and pan
//   cam.orbit(dYaw, dPitch)      pitch is clamped to [minPitch, maxPitch]
//   cam.zoomAt(k, x, y)          zoom by k keeping the image point under (x, y) fixed
//   cam.panBy(dx, dy)            px
//   cam.reset()                  home yaw/pitch, zoom 1, no pan
//   cam.frame()                  { eye, right, up, fwd, dist, f, s, cx, cy, ox, oy } cached per version
//   cam.project(p)               [sx, sy, depth]: px, px, mm along the view axis (> 0)
//   cam.projectAll(xyz, out)     Float64Array [x,y,z, ...] -> out [sx,sy,depth, ...]
//   cam.version                  changes on every camera change (use it as a cache key)
//
//   bindOrbitControls(el, cam, { onChange, onReset }) -> { dispose(), dragging() }
//     drag: orbit · shift-, right- or middle-drag: pan · wheel / pinch: zoom ·
//     double-click: reset · when focused: arrows orbit, + / - zoom, 0 or Home reset
//
//   keyLight(frame) -> unit vector toward the key light (upper left, on the viewer's
//                      side; fixed to the camera, so orbiting reads like a turntable)
//   parseColor(css, fallback) -> [r, g, b] (0..255) of any CSS colour, cached
//   mixRGB(a, b, t), rgbCss(rgb, k = 1, alpha = 1)

export const DEG = Math.PI / 180;

const TAU = 2 * Math.PI;
const clampN = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export class OrbitCamera {
  constructor(opts = {}) {
    this.fov = opts.fov ?? 30 * DEG;                 // vertical field of view
    this.minPitch = opts.minPitch ?? -80 * DEG;
    this.maxPitch = Math.min(opts.maxPitch ?? 88 * DEG, 89.5 * DEG);
    this.margin = opts.margin ?? 1.04;               // fit: sphere radius x margin
    this.minZoom = opts.minZoom ?? 0.3;
    this.maxZoom = opts.maxZoom ?? 16;
    this.home = { yaw: opts.yaw ?? -60 * DEG, pitch: opts.pitch ?? 20 * DEG };
    this.yaw = this.home.yaw;
    this.pitch = clampN(this.home.pitch, this.minPitch, this.maxPitch);
    this.zoom = 1;
    this.pan = [0, 0];                               // image-plane offset, in focal lengths
    this.target = [0, 0, 0];
    this.radius = 1;
    this.w = 1;
    this.h = 1;
    this.version = 1;
    this._frame = null;
  }

  _changed() { this.version++; this._frame = null; }

  setViewport(w, h) {
    w = Math.max(1, w); h = Math.max(1, h);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this._changed();
  }

  fit(center, radius) {
    const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
    const t = this.target;
    if (t[0] === center[0] && t[1] === center[1] && t[2] === center[2] && r === this.radius) return;
    this.target = [center[0], center[1], center[2]];
    this.radius = r;
    this._changed();
  }

  setHome(yaw, pitch) { this.home = { yaw, pitch }; }

  orbit(dYaw, dPitch = 0) {
    if (!dYaw && !dPitch) return;
    let y = this.yaw + dYaw;
    y -= TAU * Math.round(y / TAU);                  // keep in (-pi, pi]
    this.yaw = y;
    this.pitch = clampN(this.pitch + dPitch, this.minPitch, this.maxPitch);
    this._changed();
  }

  /** Focal length in px at zoom 1. */
  focal() { return (this.h / 2) / Math.tan(this.fov / 2); }

  /** Eye distance that fits the bounding sphere into the narrower field of view. */
  distance() {
    const tv = Math.tan(this.fov / 2);
    const half = Math.atan(Math.min(tv, tv * (this.w / this.h)));
    return (this.radius * this.margin) / Math.sin(half);
  }

  zoomAt(k, x, y) {
    if (!(k > 0) || !Number.isFinite(k)) return;
    const z1 = clampN(this.zoom * k, this.minZoom, this.maxZoom);
    const ke = z1 / this.zoom;
    if (Math.abs(ke - 1) < 1e-9) return;
    const f = this.focal();
    const mx = (x - this.w / 2) / f, my = (y - this.h / 2) / f;
    this.zoom = z1;
    this._setPan(mx * (1 - ke) + ke * this.pan[0], my * (1 - ke) + ke * this.pan[1]);
    this._changed();
  }

  panBy(dx, dy) {
    if (!dx && !dy) return;
    const f = this.focal();
    this._setPan(this.pan[0] + dx / f, this.pan[1] + dy / f);
    this._changed();
  }

  // Keep the model's centre within reach: at most half a view plus its own image radius off-centre.
  _setPan(px, py) {
    const f = this.focal();
    const rim = this.zoom * this.radius / this.distance();
    const lx = this.w / 2 / f + rim, ly = this.h / 2 / f + rim;
    this.pan = [clampN(px, -lx, lx), clampN(py, -ly, ly)];
  }

  reset() {
    this.yaw = this.home.yaw;
    this.pitch = clampN(this.home.pitch, this.minPitch, this.maxPitch);
    this.zoom = 1;
    this.pan = [0, 0];
    this._changed();
  }

  frame() {
    if (this._frame) return this._frame;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cw = Math.cos(this.yaw), sw = Math.sin(this.yaw);
    const dist = this.distance();
    const t = this.target;
    const f = this.focal();
    this._frame = {
      eye: [t[0] + dist * cp * cw, t[1] + dist * cp * sw, t[2] + dist * sp],
      fwd: [-cp * cw, -cp * sw, -sp],                // view direction (into the screen)
      right: [-sw, cw, 0],                           // screen right, always horizontal
      up: [-sp * cw, -sp * sw, cp],                  // screen up
      dist, f,
      s: f * this.zoom,                              // px per unit of x/depth
      cx: this.w / 2, cy: this.h / 2,
      ox: this.pan[0] * f, oy: this.pan[1] * f,
    };
    return this._frame;
  }

  project(p) {
    const out = new Float64Array(3);
    this.projectAll(p, out);
    return [out[0], out[1], out[2]];
  }

  projectAll(xyz, out) {
    const F = this.frame();
    const { eye, fwd, right, up, s, cx, cy, ox, oy } = F;
    const minZ = 1e-6 * F.dist;
    const n = xyz.length - (xyz.length % 3);
    for (let i = 0; i < n; i += 3) {
      const dx = xyz[i] - eye[0], dy = xyz[i + 1] - eye[1], dz = xyz[i + 2] - eye[2];
      const xc = dx * right[0] + dy * right[1];
      const yc = dx * up[0] + dy * up[1] + dz * up[2];
      let zc = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
      if (zc < minZ) zc = minZ;
      out[i] = cx + ox + (s * xc) / zc;
      out[i + 1] = cy + oy - (s * yc) / zc;
      out[i + 2] = zc;
    }
    return out;
  }
}

/**
 * Pointer, wheel, pinch and keyboard input for an OrbitCamera on element `el`
 * (give it tabindex="0" and CSS touch-action: none). onChange() runs after every
 * camera change; onReset() after a double-click or the reset key.
 */
export function bindOrbitControls(el, cam, { onChange = () => {}, onReset = null, speed = 0.008 } = {}) {
  const pts = new Map();            // pointerId -> [x, y] in element px
  let mode = 'orbit';
  let pinch = null;                 // { d, mx, my } of the last two-pointer sample

  const local = (e) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const pinchState = () => {
    const [a, b] = [...pts.values()];
    return { d: Math.hypot(b[0] - a[0], b[1] - a[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
  };
  const reset = () => { cam.reset(); if (onReset) onReset(); onChange(); };

  function down(e) {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pts.set(e.pointerId, local(e));
    if (pts.size === 1) mode = e.button === 1 || e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
    if (pts.size === 2) pinch = pinchState();
    e.preventDefault();
  }
  function move(e) {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    pts.set(e.pointerId, cur);
    if (pts.size >= 2) {
      const p = pinchState();
      if (pinch && pinch.d > 1 && p.d > 1) {
        cam.panBy(p.mx - pinch.mx, p.my - pinch.my);
        cam.zoomAt(p.d / pinch.d, p.mx, p.my);
      }
      pinch = p;
    } else {
      const dx = cur[0] - prev[0], dy = cur[1] - prev[1];
      if (mode === 'pan') cam.panBy(dx, dy);
      else cam.orbit(-dx * speed, dy * speed);
    }
    onChange();
  }
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    pinch = pts.size >= 2 ? pinchState() : null;
    if (pts.size === 1) mode = 'orbit';
  }
  function wheel(e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (el.clientHeight || 400) : 1;
    const k = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));   // ctrl: trackpad pinch
    const [x, y] = local(e);
    cam.zoomAt(k, x, y);
    onChange();
  }
  function key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = (e.shiftKey ? 22.5 : 7.5) * DEG;
    switch (e.key) {
      case 'ArrowLeft': cam.orbit(step, 0); break;
      case 'ArrowRight': cam.orbit(-step, 0); break;
      case 'ArrowUp': cam.orbit(0, -step); break;
      case 'ArrowDown': cam.orbit(0, step); break;
      case '+': case '=': cam.zoomAt(1.2, cam.w / 2, cam.h / 2); break;
      case '-': case '_': cam.zoomAt(1 / 1.2, cam.w / 2, cam.h / 2); break;
      case '0': case 'Home': reset(); e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    onChange();
  }
  const dbl = (e) => { e.preventDefault(); reset(); };
  const menu = (e) => e.preventDefault();

  const on = [
    ['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up],
    ['lostpointercapture', up], ['dblclick', dbl], ['contextmenu', menu], ['keydown', key],
  ];
  for (const [t, fn] of on) el.addEventListener(t, fn);
  el.addEventListener('wheel', wheel, { passive: false });
  return {
    dispose() {
      for (const [t, fn] of on) el.removeEventListener(t, fn);
      el.removeEventListener('wheel', wheel);
    },
    dragging: () => pts.size > 0,
  };
}

/** Unit vector toward the key light, fixed relative to the camera. */
export function keyLight(F) {
  const a = -0.42, b = 0.6, c = -0.68;               // right, up, forward weights
  const v = [
    a * F.right[0] + b * F.up[0] + c * F.fwd[0],
    a * F.right[1] + b * F.up[1] + c * F.fwd[1],
    a * F.right[2] + b * F.up[2] + c * F.fwd[2],
  ];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ── colours ──────────────────────────────────────────────────────────────────

const colorCache = new Map();
let probe = null;

function parseHex(s) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  else if (h.length === 6 || h.length === 8) h = h.slice(0, 6);
  else return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function parseRgbFn(s) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])].map((x) => clampN(Math.round(x), 0, 255)) : null;
}

/** [r, g, b] (0..255) of a CSS colour string; other syntaxes are resolved by a 1x1 canvas. */
export function parseColor(css, fallback = [128, 128, 128]) {
  const key = String(css || '').trim();
  if (!key) return fallback;
  const hit = colorCache.get(key);
  if (hit) return hit;
  let rgb = parseHex(key) || parseRgbFn(key);
  if (!rgb && typeof document !== 'undefined') {
    try {
      if (!probe) {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        probe = c.getContext('2d', { willReadFrequently: true });
      }
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#010203';
      probe.fillStyle = key;                          // ignored when invalid
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      if (!(d[0] === 1 && d[1] === 2 && d[2] === 3) && d[3] > 0) rgb = [d[0], d[1], d[2]];
    } catch { rgb = null; }
  }
  if (!rgb) return fallback;
  colorCache.set(key, rgb);
  return rgb;
}

export function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** CSS colour string of rgb scaled by k (shading), with optional alpha. */
export function rgbCss(rgb, k = 1, alpha = 1) {
  const r = clampN(Math.round(rgb[0] * k), 0, 255);
  const g = clampN(Math.round(rgb[1] * k), 0, 255);
  const b = clampN(Math.round(rgb[2] * k), 0, 255);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.max(0, alpha).toFixed(3)})`;
}
