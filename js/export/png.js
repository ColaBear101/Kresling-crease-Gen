// PNG export: rasterises the pattern sheet (the SVG from svg.js) on a canvas.
//
//   patternPNG(design, pattern, layout, { dpi = 300 } = {}) -> Promise<Blob>   browser only
//   scenePNG(scene, { dpi = 300 } = {}) -> Promise<Blob>     any sheetScene / infoScene, the same way
//   pngSetDpi(bytes, dpi) -> Uint8Array    PNG with a pHYs chunk, so it prints at true size
//
// The sheet is the one patternSVG draws without a tile (layout.page when it fits,
// otherwise an enlarged sheet holding the whole pattern). Canvas = sheet mm x dpi /
// 25.4 px on a white background; dpi is clamped to 30..1200 and very large requests
// are scaled down to 16384 px per side and 120 Mpx (the pHYs chunk records the dpi
// actually used). The SVG is loaded into an Image through a data: URL.
// Rejects with an Error: invalid design, no browser canvas, render or encode failure.
// Touches the DOM only when patternPNG is called.

import { sheetScene, sceneSVG } from './svg.js';
import { crc32 } from './zip.js';

const MAX_SIDE = 16384;
const MAX_AREA = 120e6;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function patternPNG(design, pattern, layout, { dpi = 300 } = {}) {
  let scene;
  try {
    scene = sheetScene(design, pattern, layout);
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
  return scenePNG(scene, { dpi });
}

/** Any sheet scene (sheetScene, or infoScene for the legend page) as a PNG at true size. */
export function scenePNG(scene, { dpi = 300 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (message) => reject(new Error(message));
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      fail('PNG export needs a browser canvas.');
      return;
    }
    let res = Number(dpi);
    if (!Number.isFinite(res) || res <= 0) res = 300;
    res = Math.min(1200, Math.max(30, res));
    const pxW = (scene.w / 25.4) * res, pxH = (scene.h / 25.4) * res;
    const shrink = Math.min(1, MAX_SIDE / Math.max(pxW, pxH), Math.sqrt(MAX_AREA / (pxW * pxH)));
    const used = res * shrink;
    const W = Math.max(1, Math.round(pxW * shrink)), H = Math.max(1, Math.round(pxH * shrink));

    let canvas = null, ctx = null;
    try {
      canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) { fail(`Could not create a ${W} x ${H} px canvas. Try a lower resolution.`); return; }

    const img = new Image();
    img.onload = () => {
      try {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        canvas.toBlob((blob) => {
          if (!blob) { fail(`The browser could not encode a ${W} x ${H} px PNG. Try a lower resolution.`); return; }
          if (typeof blob.arrayBuffer !== 'function') { resolve(blob); return; }
          blob.arrayBuffer().then(
            (buf) => resolve(new Blob([pngSetDpi(new Uint8Array(buf), used)], { type: 'image/png' })),
            () => resolve(blob),
          );
        }, 'image/png');
      } catch (e) {
        fail(`PNG export failed: ${(e && e.message) || e}`);
      }
    };
    img.onerror = () => fail('PNG export failed: the browser could not draw the pattern SVG.');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sceneSVG(scene, { pixelWidth: W, pixelHeight: H }))}`;
  });
}

/**
 * Insert (or replace) the pHYs chunk right after IHDR, in pixels per metre.
 * Returns the input unchanged when it is not a well-formed PNG chunk stream.
 */
export function pngSetDpi(bytes, dpi) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33) return bytes;
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return bytes;
  const ppm = Math.round(Number(dpi) / 0.0254);
  if (!(ppm > 0 && ppm <= 0xffffffff)) return bytes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  let off = 8, inserted = false, ended = false;
  while (off + 12 <= bytes.length) {
    const len = dv.getUint32(off);
    const end = off + 12 + len;
    if (end > bytes.length) return bytes;
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    if (type !== 'pHYs') parts.push(bytes.subarray(off, end));
    if (type === 'IHDR' && !inserted) { parts.push(physChunk(ppm)); inserted = true; }
    off = end;
    if (type === 'IEND') { ended = true; break; }
  }
  if (!inserted || !ended) return bytes;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}

function physChunk(ppm) {
  const c = new Uint8Array(21);
  const dv = new DataView(c.buffer);
  dv.setUint32(0, 9);
  c.set([0x70, 0x48, 0x59, 0x73], 4);        // 'pHYs'
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  c[16] = 1;                                  // unit: metre
  dv.setUint32(17, crc32(c.subarray(4, 17)));
  return c;
}
