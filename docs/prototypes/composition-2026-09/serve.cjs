// Isolated composition prototype server. Catalog proxy is GET-only and narrowly allowlisted.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const root = __dirname;
const publicRoot = path.resolve(root, '../../../apps/webapp/public');
const apiRoot = 'http://127.0.0.1:4341';
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.woff2':'font/woff2' };
const apiPaths = new Set(['/catalog/search', '/catalog/points']);
const inside = (base, candidate) => { const rel = path.relative(base, candidate); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); };

http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1:4193'); } catch { res.writeHead(400).end(); return; }
  if (url.pathname.startsWith('/api/')) {
    const apiPath = url.pathname.slice(4);
    if (req.method !== 'GET' || !apiPaths.has(apiPath)) { res.writeHead(404).end(); return; }
    try {
      const upstream = new URL(apiPath, apiRoot);
      for (const [key, value] of url.searchParams) upstream.searchParams.append(key, value);
      const response = await fetch(upstream, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(502, { 'Content-Type':'application/json' }).end('{"error":"Локальный каталог недоступен"}'); }
    return;
  }
  let base = root;
  let pathname = url.pathname;
  if (pathname.startsWith('/public/')) { base = publicRoot; pathname = pathname.slice('/public'.length); }
  if (pathname === '/') pathname = '/index.html';
  let file;
  try { file = path.resolve(base, `.${decodeURIComponent(pathname)}`); } catch { res.writeHead(400).end(); return; }
  if (!inside(base, file) || !mime[path.extname(file)]) { res.writeHead(404).end(); return; }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'Cache-Control': 'no-store' }); res.end(body);
  });
}).listen(4193, '127.0.0.1', () => console.log('Composition prototype: http://127.0.0.1:4193'));
