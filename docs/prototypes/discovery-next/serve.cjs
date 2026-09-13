const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const publicRoot = path.resolve(__dirname, '../../../..', 'apps/webapp/public');
const routes = {
  '/': [path.join(__dirname, 'index.html'), 'text/html; charset=utf-8'],
  '/style.css': [path.join(__dirname, 'style.css'), 'text/css; charset=utf-8'],
  '/app.js': [path.join(__dirname, 'app.js'), 'text/javascript; charset=utf-8'],
  '/font.woff2': [path.join(publicRoot, 'fonts/manrope-cyrillic.woff2'), 'font/woff2'],
  '/latin.woff2': [path.join(publicRoot, 'fonts/manrope-latin.woff2'), 'font/woff2'],
  '/lira.webp': [path.join(publicRoot, 'lira/portrait-illustrated-v1.webp'), 'image/webp'],
};
http.createServer((req, res) => {
  const route = routes[new URL(req.url, 'http://localhost').pathname];
  if (req.method !== 'GET' || !route) { res.writeHead(404).end(); return; }
  fs.readFile(route[0], (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' }).end(data);
  });
}).listen(4192, '127.0.0.1', () => console.log('Concept: http://127.0.0.1:4192'));
