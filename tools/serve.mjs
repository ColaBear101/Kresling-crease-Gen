#!/usr/bin/env node
// Tiny static file server for local development (ES modules need http://).
//   node tools/serve.mjs [port]      then open http://localhost:8765/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

// Dev only: POST /__capture/<name>.png saves a canvas snapshot when
// CAPTURE_DIR is set (used to review canvases without a visible browser).
const CAPTURE_DIR = process.env.CAPTURE_DIR || '';

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && CAPTURE_DIR && /^\/__capture\/[a-z0-9-]{1,40}\.png$/.test(url.pathname)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir(CAPTURE_DIR, { recursive: true });
      await writeFile(join(CAPTURE_DIR, url.pathname.slice('/__capture/'.length)), Buffer.concat(chunks));
      res.writeHead(204).end();
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (path === '' || path.endsWith('/') || path.endsWith('\\')) path = join(path, 'index.html');
    const file = resolve(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => console.log(`serving ${ROOT} at http://localhost:${PORT}/`));
