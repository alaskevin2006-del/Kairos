import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
await build({entryPoints:['src/app.js'], bundle:true, minify:true, outfile:'dist/app.js', target:'chrome120', legalComments:'none'});
await copyFile('src/style.css','dist/style.css');
await copyFile('src/index.html','dist/index.html');
await copyFile('src/admin.html','dist/admin.html');
for(const file of ['logo.png','logo.ico'])await copyFile(`assets/${file}`,`dist/${file}`);
console.log('Kairos 网页已构建');
