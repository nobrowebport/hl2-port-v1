import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]||'build/install');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.so':'application/wasm','.json':'application/json','.data':'application/octet-stream'};
http.createServer((req,res)=>{
  let relative;
  try{relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  const filename=path.resolve(root,'.'+relative+(relative.endsWith('/')?'index.html':''));
  if(filename!==root&&!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404).end('Not found');return;}
  const zipped=/\bgzip\b/.test(req.headers['accept-encoding']||'')&&fs.existsSync(filename+'.gz');
  const target=zipped?filename+'.gz':filename;
  const sourceStat=fs.statSync(filename),etag=`W/"${sourceStat.size}-${Math.floor(sourceStat.mtimeMs)}-${zipped?'gz':'raw'}"`;
  res.setHeader('ETag',etag);
  res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');
  res.setHeader('Vary','Accept-Encoding');if(zipped)res.setHeader('Content-Encoding','gzip');
  res.setHeader('Cache-Control',/\.[a-f0-9]{16}\.data(?:\.gz)?$/.test(filename)?'public, max-age=31536000, immutable':'no-cache');
  res.setHeader('Content-Length',fs.statSync(target).size);
  if(req.headers['if-none-match']===etag){res.writeHead(304).end();return;}
  if(req.method==='HEAD'){res.end();return;}
  fs.createReadStream(target).pipe(res);
}).listen(8088,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8088/'));
