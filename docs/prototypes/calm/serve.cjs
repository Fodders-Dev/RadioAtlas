// Serves this prototype only, on loopback. No repository files or API proxy.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };
http.createServer((req,res)=>{
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if(pathname==='/')pathname='/index.html';
  const file=path.resolve(__dirname,'.'+pathname);
  const relative=path.relative(__dirname,file);
  if(relative.startsWith('..') || path.isAbsolute(relative) || !types[path.extname(file)]){res.writeHead(404).end();return;}
  fs.readFile(file,(error,body)=>{
    if(error){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});res.end(body);
  });
}).listen(4179,'127.0.0.1',()=>console.log('RadioAtlas calm: http://127.0.0.1:4179'));
