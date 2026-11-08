import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const source=fs.readFileSync(new URL('./pre.js',import.meta.url),'utf8');
function record(name,body='test'){
 const p=Buffer.from(name),b=Buffer.from(body),h=Buffer.alloc(8);h.writeUInt32LE(p.length);h.writeUInt32LE(b.length,4);return Buffer.concat([h,p,b]);
}
function setup(data=record('/hl2/maps/d1_town_01.bsp'),status=200,settings={}){
 const hits=[],files=new Map(),heap=new Int32Array(new SharedArrayBuffer(16));
 const hash=crypto.createHash('sha256').update(data).digest('hex');
 const manifest={maps:{d1_town_01:['ravenholm']},chunks:{ravenholm:{file:'ravenholm.data',bytes:data.length,sha256:hash}}};
 const context={Module:{...settings},HEAP32:heap,Atomics,Map,URL,TextDecoder,Uint8Array,DataView,crypto:crypto.webcrypto,console:{error(){}},location:{href:'http://localhost/'},FS:{mkdirTree(){},writeFile(name,b){files.set(name,Buffer.from(b));}},
 fetch:async(url)=>{hits.push(url);return String(url).endsWith('manifest.json')?new Response(JSON.stringify(manifest)):new Response(manifest.chunks.ravenholm.encoding==='gzip'?zlib.gzipSync(data):data,{status});},Response,DecompressionStream};
 vm.createContext(context);vm.runInContext(source+'\nglobalThis.loader=dataLoader;',context);
 return{context,hits,files,heap,manifest};
}
test('Ravenholm loads only declared chunks and concurrent requests coalesce',async()=>{
 const s=setup();await Promise.all([s.context.loader.loadMapWithDeps('d1_town_01'),s.context.loader.loadMapWithDeps('d1_town_01')]);
 assert.equal(s.hits.length,2);assert.equal(s.files.get('/hl2/maps/d1_town_01.bsp').toString(),'test');
 assert.equal(s.context.Module.arguments.at(-1),'d1_town_01');
});

test('RTX Lighting defaults off and restores an enabled preference',()=>{
 for(const enabled of [false,true]){
  const s=setup(undefined,200,{rtxLighting:enabled});
  const index=s.context.Module.arguments.indexOf('+r_web_rtx_lighting');
  assert.equal(s.context.Module.arguments[index+1],enabled?'1':'0');
 }
});
test('missing map fails without fetching other campaign maps',async()=>{
 const s=setup();await assert.rejects(s.context.loader.loadMapWithDeps('d1_town_02'),/not packaged/);assert.equal(s.hits.length,1);
});
test('HTTP failure releases waiting engine thread',async()=>{
 const s=setup(undefined,404);s.heap[0]=1;s.context.Module.downloadMap(0,'d1_town_01');
 await new Promise(r=>setTimeout(r,40));assert.equal(s.heap[0],-1);
});
test('truncated archive is rejected',async()=>{
 const s=setup(Buffer.from([1,2,3]));await assert.rejects(s.context.loader.loadMapWithDeps('d1_town_01'),/Truncated/);
});
test('asset paths cannot escape game directories',async()=>{
 const s=setup(record('/hl2/../../escape'));await assert.rejects(s.context.loader.loadMapWithDeps('d1_town_01'),/Invalid asset path/);assert.equal(s.files.size,0);
});
test('checksum corruption is rejected before writing files',async()=>{
 const s=setup();s.manifest.chunks.ravenholm.sha256='bad';await assert.rejects(s.context.loader.loadMapWithDeps('d1_town_01'),/checksum/);assert.equal(s.files.size,0);
});
test('compressed chunks decode before checksum and filesystem writes',async()=>{
 const s=setup();s.manifest.chunks.ravenholm.encoding='gzip';await s.context.loader.loadMapWithDeps('d1_town_01');assert.equal(s.files.get('/hl2/maps/d1_town_01.bsp').toString(),'test');
});
test('deferred sounds load their indexed chunk and wake the engine',async()=>{
 const s=setup(record('/hl2/sound/npc/zombie/zo_attack1.wav'));
 s.manifest.assets={'/hl2/sound/npc/zombie/zo_attack1.wav':'ravenholm'};
 s.heap[0]=1;await s.context.Module.downloadAsset(0,'/hl2/sound/npc/zombie/zo_attack1.wav');
 assert.equal(s.heap[0],0);assert.equal(s.files.size,1);assert.equal(s.hits.length,2);
});
test('unknown deferred assets wake the engine without downloading other files',async()=>{
 const s=setup();s.manifest.assets={};s.heap[0]=1;
 await s.context.Module.downloadAsset(0,'/hl2/sound/missing.wav');
 assert.equal(s.heap[0],-1);assert.equal(s.hits.length,1);
});
test('deferred asset network failure releases the waiting engine',async()=>{
 const s=setup(undefined,404);s.manifest.assets={'/hl2/sound/test.wav':'ravenholm'};s.heap[0]=1;
 await s.context.Module.downloadAsset(0,'/hl2/sound/test.wav');assert.equal(s.heap[0],-1);
});

test('next-map prefetch stays within its budget and does not inflate assets',async()=>{
 const s=setup();
 s.manifest.maps.d1_town_02=['small','large'];
 s.manifest.transitions={d1_town_01:['d1_town_02']};
 s.manifest.chunks.small={file:'small.gz',gzipBytes:2*1024*1024};
 s.manifest.chunks.large={file:'large.gz',gzipBytes:64*1024*1024};
 const cached=[];
 s.context.caches={open:async()=>({match:async()=>undefined,put:async(url)=>cached.push(url)})};
 s.context.AbortController=AbortController;
 s.context.loader.currentMap='d1_town_01';
 await s.context.loader.prefetchNext('d1_town_01');
 assert.equal(cached.length,1);assert.ok(cached[0].endsWith('/chunks/small.gz'));
 assert.equal(s.files.size,0);assert.equal(s.hits.length,2);
});

test('stale next-map prefetch does not fetch after changing maps',async()=>{
 const s=setup();s.context.caches={};s.context.loader.currentMap='d1_canals_01';
 await s.context.loader.prefetchNext('d1_town_01');assert.equal(s.hits.length,0);
});
