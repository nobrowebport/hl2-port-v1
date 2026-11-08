import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(process.argv[2]||'build/install/chunks');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
const files=new Map(),models=new Map(),vertices=new Map(),indices=new Map();
let rawBytes=0;
for(const [chunkName,chunk]of Object.entries(manifest.chunks)){
 const packed=fs.readFileSync(path.join(root,chunk.file));
 assert.equal(packed.length,chunk.gzipBytes);
 const data=zlib.gunzipSync(packed);rawBytes+=data.length;
 assert.equal(data.length,chunk.bytes);
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),chunk.sha256);
 let offset=0;
 while(offset<data.length){
  assert.ok(offset+8<=data.length);
  const length=data.readUInt32LE(offset),size=data.readUInt32LE(offset+4);
  const name=data.toString('utf8',offset+8,offset+8+length);offset+=8+length;
  assert.ok(offset+size<=data.length);assert.ok(!files.has(name),`Duplicate ${name}`);
  assert.equal(manifest.assets[name],chunkName);files.set(name,size);
  const body=data.subarray(offset,offset+size);
  if(name.endsWith('.mdl')&&size>=240&&body.toString('ascii',0,4)==='IDST')models.set(name,{checksum:body.readUInt32LE(8),bodyparts:body.readInt32LE(232)});
  if(name.endsWith('.vvd')&&size>=12)vertices.set(name,body.readUInt32LE(8));
  if(name.endsWith('.dx90.vtx')&&size>=20)indices.set(name,body.readUInt32LE(16));
  offset+=size;
 }
 assert.equal(offset,data.length);
}
const modelIssues=[];
for(const[name,model]of models)if(model.bodyparts>0){
 for(const[extension,table]of [['.vvd',vertices],['.dx90.vtx',indices]]){
  const dependency=name.replace(/\.mdl$/,extension);
  if(table.get(dependency)!==model.checksum)modelIssues.push({model:name,dependency,reason:table.has(dependency)?'checksum mismatch':'missing'});
 }
}
for(const[mapName,chunks]of Object.entries(manifest.maps)){
 assert.ok(files.has(`/hl2/maps/${mapName}.bsp`));
 assert.ok(chunks.includes(manifest.assets[`/hl2/maps/${mapName}.bsp`]));
 for(const chunkName of chunks)assert.ok(manifest.chunks[chunkName]);
 for(const filename of ['/hl2/cfg/skill.cfg','/hl2/cfg/skill_manifest.cfg','/hl2/gameinfo.txt'])assert.ok(chunks.includes(manifest.assets[filename]));
}
assert.equal(Object.keys(manifest.assets).length,files.size);
const result={maps:Object.keys(manifest.maps).length,chunks:Object.keys(manifest.chunks).length,files:files.size,rawBytes,models:models.size,modelIssues};
console.log(JSON.stringify(result,null,2));
if(modelIssues.length)process.exitCode=1;
