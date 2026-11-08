import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root=path.resolve('build/install');
for(const file of fs.readdirSync(root)){
 if(/\.(wasm|so|js)$/.test(file))fs.writeFileSync(path.join(root,file+'.gz'),zlib.gzipSync(fs.readFileSync(path.join(root,file)),{level:9}));
}
const chunkRoot=path.join(root,'chunks'),manifest=JSON.parse(fs.readFileSync(path.join(chunkRoot,'manifest.json')));
const keep=new Set(['manifest.json','asset-report.json',...Object.values(manifest.chunks).map(c=>c.file)]);
// Prune only obsolete generated chunks in this build directory.
if(!fs.existsSync(path.join(chunkRoot,'.pack-in-progress')))
for(const file of fs.readdirSync(chunkRoot))if(/^(ravenholm-\d+|asset)\.[a-f0-9]{16}\.data(?:\.gz)?$/.test(file)&&!keep.has(file))fs.unlinkSync(path.join(chunkRoot,file));
fs.writeFileSync(path.join(root,'_headers'),'/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n  Cross-Origin-Resource-Policy: same-origin\n');
console.log('Compressed engine files and removed obsolete generated chunks.');
