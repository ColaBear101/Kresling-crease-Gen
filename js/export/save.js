// Saving files: a plain browser download when the app runs on its own, or
// the claude.ai artifact "downloads" capability when it runs inside the
// claude.ai viewer (where page-initiated downloads are blocked). That
// capability only accepts some extensions, so other formats (DXF, STL) are
// delivered inside a .zip there.
//
//   await saveFile('pattern.svg', svgText)                -> { ok, status, filename } | { ok:false, code, message }
//   await saveFile('pack.zip', uint8Array, 'application/zip')

import { zipFiles, toBytes } from './zip.js';

const HOSTED_EXTS = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov', 'txt', 'json', 'md',
  'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip', 'fig']);

const MIME = {
  svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf', json: 'application/json',
  dxf: 'application/dxf', stl: 'model/stl', zip: 'application/zip', txt: 'text/plain',
};

let downloadsPromise = null;
function hostedDownloads() {
  if (!downloadsPromise) {
    const c = typeof window !== 'undefined' ? window.claude : undefined;
    downloadsPromise = c && typeof c.use === 'function'
      ? Promise.resolve(c.use('downloads')).catch(() => null)
      : Promise.resolve(null);
  }
  return downloadsPromise;
}

/** Start resolving the hosted capability early (call once at boot). */
export function primeSaving() { hostedDownloads(); }

/** True when files will be saved through the claude.ai viewer. */
export async function isHosted() { return Boolean(await hostedDownloads()); }

function toBlob(data, mime) {
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data;
  return new Blob([typeof data === 'string' ? data : toBytes(data)], { type: mime || 'application/octet-stream' });
}

export async function saveFile(filename, data, mime) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  mime = mime || MIME[ext];
  const hosted = await hostedDownloads();
  if (hosted) {
    let name = filename, payload = data, type = mime;
    if (!HOSTED_EXTS.has(ext)) {
      const bytes = typeof Blob !== 'undefined' && data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
      payload = zipFiles([{ name: filename, data: bytes }]);
      name = `${filename}.zip`;
      type = MIME.zip;
    }
    try {
      const r = await hosted.save({ filename: name, data: toBlob(payload, type) });
      return { ok: true, status: r && r.status, filename: name, zipped: name !== filename };
    } catch (e) {
      return { ok: false, code: (e && e.code) || 'unavailable', message: (e && e.message) || String(e) };
    }
  }
  const blob = toBlob(data, mime);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { ok: true, status: 'saved', filename };
}

/** Human message for a saveFile() result, for toasts. */
export function saveMessage(res) {
  if (res.ok) return res.zipped ? `Saved ${res.filename} (zipped for this viewer)` : `Saved ${res.filename}`;
  switch (res.code) {
    case 'declined': return 'Download cancelled.';
    case 'rate_limited': return 'A download prompt is already open. Try again in a moment.';
    case 'too_large': return 'That file is too large to save here.';
    default: return 'Downloads are not available in this view.';
  }
}
