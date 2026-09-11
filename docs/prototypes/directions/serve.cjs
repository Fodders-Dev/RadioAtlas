// Standalone design study. Only public catalog GETs reach the existing local API.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.jpg':'image/jpeg'};
http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://127.0.0.1');
  if(req.method !== 'GET'){res.writeHead(405).end();return;}
  if(url.pathname === '/api/catalog/search') {
    try { const r=await fetch('http://127.0.0.1:5184'+url.pathname+url.search,{signal:AbortSignal.timeout(15000)});res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text()); }
    catch {res.writeHead(502,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Local catalog unavailable'}));} return;
  }
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  const assets={'/font.woff2':'../../../apps/webapp/public/fonts/manrope-cyrillic.woff2','/earth.jpg':'../../../apps/webapp/public/globe/earth-blue-marble-2048.jpg'};
  const file=assets[pathname]?path.resolve(__dirname,assets[pathname]):path.resolve(__dirname,'.'+(pathname==='/'?'/index.html':pathname));
  const relative=path.relative(__dirname,file);
  if((!assets[pathname]&&(relative.startsWith('..')||path.isAbsolute(relative)))||!types[path.extname(file)]){res.writeHead(404).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'}).end(data);});
}).listen(4180,'127.0.0.1',()=>console.log('Design comparison: http://127.0.0.1:4180'));
