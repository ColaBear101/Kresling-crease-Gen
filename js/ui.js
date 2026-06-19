import { A4_W, A4_H } from './constants.js';
import { patternBounds } from './geometry.js';

// ─── DOM parameter readers ────────────────────────────────────────────────────
export function getV(id)   { return parseFloat(document.getElementById('n-' + id).value); }
export function getBool(id){ return document.getElementById(id).checked; }

export function getP() {
  return {
    dia:     getV('dia'),
    height:  getV('height'),
    n:       Math.round(getV('n')),
    floors:  Math.round(getV('floors')),
    angle:   getV('angle'),
    ext:     getV('ext'),
    seaml:   getV('seaml'),
    seamr:   getV('seamr'),
    extcols: Math.round(getV('extcols')),
    stack:   Math.round(getV('stack')),
    scale:   getV('scale') / 100,
    compress:getV('compress') / 100,
    wallmm:  getV('wallmm'),
    moldbase:getV('moldbase'),
    ridgeh:  getV('ridgeh'),
    ridgew:  getV('ridgew'),
    showmv:  getBool('showmv'),
    chir:    parseInt(document.getElementById('chir').value),
    showA4:  getBool('showA4'),
    showGrid:getBool('showGrid'),
  };
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;
export function showToast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ─── Debounce ─────────────────────────────────────────────────────────────────
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Stats bar ───────────────────────────────────────────────────────────────
export function updateStats(p, g) {
  const bounds = patternBounds(p, g);
  const sW = bounds.w * p.scale, sH = bounds.h * p.scale;
  const fitW = (sW / A4_W * 100).toFixed(1), fitH = (sH / A4_H * 100).toFixed(1);
  const fits = sW <= A4_W && sH <= A4_H;

  document.getElementById('s-fh').textContent    = g.floor_h.toFixed(3)   + ' cm';
  document.getElementById('s-b').textContent     = g.b.toFixed(3)         + ' cm';
  document.getElementById('s-red').textContent   = g.red_len.toFixed(3)   + ' cm';
  document.getElementById('s-green').textContent = g.green_len.toFixed(3) + ' cm';
  document.getElementById('s-pw').textContent    = bounds.w.toFixed(2)    + ' cm';
  document.getElementById('s-ph').textContent    = bounds.h.toFixed(2)    + ' cm';
  document.getElementById('s-h0r').textContent   = g.h0r.toFixed(4);
  document.getElementById('s-bi').textContent    = g.bistable ? '✓ Yes' : '✗ No';
  document.getElementById('s-scale').textContent = (p.scale * 100).toFixed(0) + '%';
  document.getElementById('s-fit').textContent   = fits
    ? `✓ ${fitW}%W ${fitH}%H` : `✗ ${fitW}%W ${fitH}%H`;
  document.getElementById('s-fit').style.color   = fits ? '#4ade80' : '#f87171';

  const badge = document.getElementById('validity-badge');
  const warn  = document.getElementById('warn-bar');
  if (!g.valid) {
    badge.className = 'badge bad'; badge.textContent = 'Invalid';
    warn.style.display = 'block';
    warn.textContent = '⚠ dx ≥ side length — angle too shallow.';
  } else if (g.h0r > 1.8) {
    badge.className = 'badge warn'; badge.textContent = 'Marginal';
    warn.style.display = 'block';
    warn.textContent = '⚠ h₀/R high — may not fold cleanly.';
  } else {
    badge.className = 'badge ok'; badge.textContent = 'Foldable';
    warn.style.display = 'none';
  }
}

// ─── Info-box helpers (shared by flat renderer AND all SVG/PDF exporters) ────
export function infoBoxLines(p, g, bounds) {
  const totalLen = (p.dia * Math.PI).toFixed(3);
  const left = [
    `Floor height: ${g.floor_h.toFixed(2)} cm`,
    `One side: ${g.b.toFixed(3)} cm`,
    `Red line: ${g.red_len.toFixed(2)} cm`,
    `Blue-Red Angle: ${p.angle.toFixed(1)}\u00b0`,
    `Green-Red angle: ${g.gr_angle.toFixed(2)}\u00b0`,
    `h0/R: ${g.h0r.toFixed(4)}`,
    `Bistable: ${g.bistable ? 'yes' : 'no'}`,
  ];
  const right = [
    `Diameter: ${p.dia.toFixed(2)} cm`,
    `Height: ${p.height.toFixed(2)} cm`,
    `Total length ${totalLen} cm`,
    `Floors: ${p.floors}`,
    `Sides: ${p.n}`,
    `Stack: \u00d7${p.stack}`,
    `Scale: ${(p.scale * 100).toFixed(0)}%`,
  ];
  return { left, right };
}

export function drawInfoBoxCanvas(ctx, toC, sc, x0, x1, gapHiCm, gapLoCm, p, g, bounds, forPrint) {
  const { left, right } = infoBoxLines(p, g, bounds);
  const lineCount = Math.max(left.length, right.length);
  const [px0, cy_hi] = toC(x0, gapHiCm);
  const [px1, cy_lo] = toC(x1, gapLoCm);
  const rectTop = Math.min(cy_hi, cy_lo), rectBot = Math.max(cy_hi, cy_lo);
  const gapH = rectBot - rectTop, gapW = px1 - px0;
  if (gapH < 4 || gapW < 20) return;

  const padPx  = Math.max(2, Math.round(gapH * 0.06));
  const availH = gapH - padPx * 2;
  const fs     = Math.max(5, Math.min(11, Math.floor(availH / lineCount) - 2));
  const lh     = Math.floor(availH / lineCount);
  const startY = rectTop + padPx + Math.floor((availH - lineCount * lh) / 2) + fs;

  ctx.save();
  ctx.font          = `${fs}px "Courier New",Courier,monospace`;
  ctx.textBaseline  = 'alphabetic';
  ctx.fillStyle     = forPrint ? '#111111' : 'rgba(200,220,255,0.85)';
  ctx.textAlign     = 'left';
  left.forEach ((t, i) => ctx.fillText(t, px0 + padPx + 2, startY + i * lh));
  ctx.textAlign     = 'right';
  right.forEach((t, i) => ctx.fillText(t, px1 - padPx - 2, startY + i * lh));
  ctx.restore();
}

export function escSVG(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function infoBoxSVGText(p, g, bounds, CM, olX, orX, _unused, botYsvg, lastCreaseYsvg) {
  const { left, right } = infoBoxLines(p, g, bounds);
  const lineCount = Math.max(left.length, right.length);
  const gapTop = lastCreaseYsvg, gapBot = botYsvg;
  const gapH = gapBot - gapTop, gapW = orX - olX;
  if (gapH < 4 || gapW < 20) return '';

  const padPx  = Math.max(2, Math.round(gapH * 0.06));
  const availH = gapH - padPx * 2;
  const fs     = Math.max(5, Math.min(11, Math.floor(availH / lineCount) - 2));
  const lh     = Math.floor(availH / lineCount);
  const startY = gapTop + padPx + Math.floor((availH - lineCount * lh) / 2) + fs;

  let out = `<g font-family="'Courier New',Courier,monospace" font-size="${fs}" fill="#111111">\n`;
  left.forEach ((t, i) => { out += `<text x="${(olX + padPx + 2).toFixed(1)}" y="${(startY + i * lh).toFixed(1)}">${escSVG(t)}</text>\n`; });
  right.forEach((t, i) => { out += `<text x="${(orX - padPx - 2).toFixed(1)}" y="${(startY + i * lh).toFixed(1)}" text-anchor="end">${escSVG(t)}</text>\n`; });
  return out + '</g>\n';
}
