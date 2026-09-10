// Portable, self-contained copy for opening locally or handing back to Claude.
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname,name),'utf8');
const assets = Object.fromEntries(['city','road','aurora','vinyl'].map(name => [name,`data:image/svg+xml;base64,${Buffer.from(read(`art/${name}.svg`)).toString('base64')}`]));
let script = read('app.js').replace('const art = (s) => `art/${s.art}.svg`;',`const assets = ${JSON.stringify(assets)};\nconst art = (s) => assets[s.art];`);
let html = read('index.html')
  .replace('<link rel="stylesheet" href="style.css">',`<style>${read('style.css')}</style>`)
  .replace('<script src="app.js" defer></script>','')
  .replace('</body>',`<script>${script}</script></body>`);
for(const [name,data] of Object.entries(assets))html=html.replaceAll(`art/${name}.svg`,data);
fs.writeFileSync(path.join(__dirname,'radioatlas-calm.html'),html);
console.log('Built radioatlas-calm.html (self-contained)');
