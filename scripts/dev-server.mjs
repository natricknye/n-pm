import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-env.mjs';
import { handle } from '../server/router.js';

loadLocalEnv();

const root = fileURLToPath(new URL('../dist', import.meta.url));
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      await handle(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
      console.error(error);
    }
    return;
  }

  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = normalize(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }

  try {
    const data = await readFile(file);
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.setHeader('cache-control', pathname === '/index.html' ? 'no-cache' : 'public, max-age=3600');
    res.end(data);
  } catch {
    const html = await readFile(join(root, 'index.html'));
    res.setHeader('content-type', types['.html']);
    res.setHeader('cache-control', 'no-cache');
    res.end(html);
  }
}).listen(port, host, () => {
  console.log(`N/PM local server: http://${host}:${port}`);
});
