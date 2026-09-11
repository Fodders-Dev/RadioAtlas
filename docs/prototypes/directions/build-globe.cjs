const esbuild=require('esbuild');
const path=require('node:path');
esbuild.buildSync({
  entryPoints:[path.join(__dirname,'globe-entry.tsx')],
  outfile:path.resolve(__dirname,'../../../.tmp/directions/globe-widget.js'),
  bundle:true,minify:true,format:'iife',jsx:'automatic',target:'es2022',
  define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},
  legalComments:'eof'
});
esbuild.buildSync({
  entryPoints:[path.join(__dirname,'explorer-entry.ts')],
  outfile:path.resolve(__dirname,'../../../.tmp/directions/explorer-widget.js'),
  bundle:true,minify:true,format:'iife',target:'es2022',
  define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},legalComments:'eof'
});
