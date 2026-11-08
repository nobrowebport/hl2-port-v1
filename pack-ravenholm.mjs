import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const root = path.resolve(process.argv[2] || '');
const output = path.resolve(process.argv[3] || 'build/install/chunks');
if (!fs.existsSync(path.join(root, 'hl2/maps/d1_town_01.bsp'))) throw new Error('Pass the installed Half-Life 2 directory');
fs.mkdirSync(output, {recursive:true});
fs.writeFileSync(path.join(output,'.pack-in-progress'),'');
const index = new Map(), handles = new Map(), selected = new Map(), missing = new Set();
const uses=new Map(),transitions={};let currentMap='core',seenMaterials=new Set(),seenModels=new Set();
const mapNames=fs.readdirSync(path.join(root,'hl2/maps')).filter(x=>/^(d1_(trainstation|canals|eli|town)_\w+|background0[1-4])\.bsp$/.test(x)).map(x=>x.slice(0,-4));
function used(key){if(currentMap){if(!uses.has(key))uses.set(key,new Set());uses.get(key).add(currentMap);}}
function put(key,b){index.set(key,{embedded:b});selected.set(key,b.length);used(key);}
const clean = x => x.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\/+/, '').toLowerCase();
const cstr = (b, p) => b.toString('utf8', p, b.indexOf(0, p));
function archive(filename, prefix) {
  const b = fs.readFileSync(filename);
  if (b.readUInt32LE(0) !== 0x55aa1234) throw new Error('Invalid VPK signature');
  const version = b.readUInt32LE(4), header = version === 1 ? 12 : version === 2 ? 28 : 0;
  if (!header) throw new Error(`Unsupported VPK version ${version}`);
  const treeEnd = header + b.readUInt32LE(8);
  let p = header;
  function string() { const s = cstr(b,p); p += Buffer.byteLength(s)+1; return s; }
  for (let ext; (ext = string());) for (let dir; (dir = string());) for (let name; (name = string());) {
    const crc = b.readUInt32LE(p), preload = b.readUInt16LE(p+4), number = b.readUInt16LE(p+6);
    const offset = b.readUInt32LE(p+8), length = b.readUInt32LE(p+12);
    if (b.readUInt16LE(p+16) !== 0xffff) throw new Error('Malformed VPK entry');
    p += 18;
    const lead = b.subarray(p,p+preload); p += preload;
    const file = number === 0x7fff ? filename : filename.replace(/_dir\.vpk$/, `_${String(number).padStart(3,'0')}.vpk`);
    const key = clean(`${prefix}/${dir === ' ' ? '' : dir+'/'}${name}.${ext}`);
    index.set(key, {file,offset:offset+(number===0x7fff?treeEnd:0),length,lead,crc});
  }
}
for (const prefix of ['platform','hl2']) {
  const dir = path.join(root,prefix);
  for (const file of fs.readdirSync(dir).filter(x=>x.endsWith('_dir.vpk'))) archive(path.join(dir,file),prefix);
  function loose(at,relative='') {
    for (const ent of fs.readdirSync(at,{withFileTypes:true})) {
      const rel = `${relative}${ent.name}`, filename = path.join(at,ent.name);
      if (ent.isDirectory()) {
        if (!['bin','custom','download','save','screenshots','maps','media'].includes(ent.name)) loose(filename,rel+'/');
      } else if (!/\.(vpk|dll|exe|log|sav)$/i.test(ent.name)) index.set(clean(`${prefix}/${rel}`), {loose:filename});
    }
  }
  loose(dir);
}
if(process.argv[4]) {
  const compatibleRoot=path.resolve(process.argv[4]);
  for(const file of fs.readdirSync(compatibleRoot).filter(x=>/^(hl2_.*|content_hl2)_dir\.vpk$/.test(x)))archive(path.join(compatibleRoot,file),'compat');
  let count=0;
  for(const[key,value]of [...index])if(/^compat\/(shaders|materials|models|sound|expressions|scenes)\//.test(key)){index.set(key.replace(/^compat\//,'hl2/'),value);count++;}
  console.log(`Legacy shared-content compatibility overlay: ${count} files`);
}
function read(key) {
  const entry=index.get(clean(key)); if (!entry) return null;
  if (entry.embedded) return entry.embedded;
  if (entry.loose) return fs.readFileSync(entry.loose);
  if (!handles.has(entry.file)) handles.set(entry.file,fs.openSync(entry.file,'r'));
  const b=Buffer.alloc(entry.length);
  if (fs.readSync(handles.get(entry.file),b,0,b.length,entry.offset)!==b.length) throw new Error('Short VPK read');
  const result=entry.lead.length ? Buffer.concat([entry.lead,b]) : b;
  if(zlib.crc32(result)!==entry.crc)throw new Error(`VPK checksum failed: ${key}`);
  return result;
}
function add(key,required=false) {
  key=clean(key);used(key);
  const b=read(key);
  if (!b) { if(required) missing.add(key); return null; }
  selected.set(key,b.length); return b;
}
function material(name) {
  name=clean(name).replace(/^materials\//,'').replace(/\.vmt$/,'');
  const key=`hl2/materials/${name}.vmt`;
  if(seenMaterials.has(key))return;seenMaterials.add(key);
  const b=add(key,true); if(!b)return;
  const text=b.toString().replace(/\/\/[^\n]*/g,'');
  for (const match of text.matchAll(/(?:"(\$[\w]+|include)"|(\$[\w]+|include))\s+(?:"([^"\r\n]*)"|([^\s{}]+))/g)) {
    const param=match[1]||match[2],value=match[3]??match[4];
    if(param==='include') material(value);
    else if(/^\$(basetexture[2]?|bumpmap[2]?|normalmap|envmap|envmapmask|detail|flowmap|lightwarptexture|phongexponenttexture|selfillummask|blendmodulatetexture|dudvmap|refracttinttexture)$/.test(param.toLowerCase()) && !value.startsWith('_') && value!=='env_cubemap' && !/[\[{}\]]/.test(value)) {
      add(`hl2/materials/${clean(value).replace(/\.vtf$/,'')}.vtf`,true);
    }
  }
}
function model(name) {
  name=clean(name); const key=`hl2/${name}`;
  if(seenModels.has(key))return;seenModels.add(key);
  const b=add(key,true);if(!b || b.length<240 || b.toString('ascii',0,4)!=='IDST')return;
  for(const ext of ['.vvd','.dx90.vtx','.phy','.ani']) {
    const dependency=add(key.replace(/\.mdl$/,ext));
    // Breakable prop gibs are named in the PHY KeyValues, often without
    // either the models/ prefix or the .mdl extension.
    if(ext==='.phy'&&dependency)for(const match of dependency.toString('latin1').matchAll(/"model"\s+"([^"]+)"/gi)) {
      const gib=clean(match[1]).replace(/^models\//,'').replace(/\.mdl$/,'');
      model(`models/${gib}.mdl`);
    }
  }
  const count=b.readInt32LE(204), tex=b.readInt32LE(208), dirs=b.readInt32LE(212), dirTable=b.readInt32LE(216);
  if(count<0||count>4096||dirs<0||dirs>256)return;
  const paths=[];
  for(let i=0;i<dirs;i++)paths.push(cstr(b,b.readInt32LE(dirTable+4*i)));
  for(let i=0;i<count;i++) {
    const at=tex+i*64, texture=cstr(b,at+b.readInt32LE(at));
    for(const dir of [...paths,'']) {
      const candidate=clean(`${dir}/${texture}`).replace(/^\//,'');
      if(index.has(`hl2/materials/${candidate}.vmt`)){material(candidate);break;}
    }
  }
  for(const match of b.toString('latin1').matchAll(/models\/[a-zA-Z0-9_./ -]+\.mdl/g))model(match[0]);
}
// Small engine/UI/script baseline. Gameplay models/textures are selected below.
for(const key of index.keys()) {
  const nonEnglish= /_(brazilian|bulgarian|czech|danish|dutch|finnish|french|german|greek|hungarian|italian|japanese|koreana?|latam|norwegian|polish|portuguese|romanian|russian|schinese|spanish|swedish|tchinese|thai|turkish|ukrainian)\./.test(key);
  const localSettings=/\/cfg\/(config|video|userconfig|autoexec)\./.test(key);
  const unusedFont=/notosans(cjk|thai)/.test(key);
  if(/^(hl2|platform)\/(resource|scripts|cfg|particles|shaders|expressions)\//.test(key) && !/\.(mp3|wav)$/i.test(key) && !nonEnglish && !localSettings && !unusedFont)add(key);
  if(/^(hl2|platform)\/materials\/(vgui|console|debug|engine|dev|effects|sprites|particle|cable|detail|sun|scripted|decals|voice)\/.*\.vmt$/.test(key)) {
    if(key.startsWith('hl2/'))material(key.slice('hl2/materials/'.length));else add(key);
  }
}
function selectMap(mapName){
currentMap=mapName;seenMaterials=new Set();seenModels=new Set();
const bsp=fs.readFileSync(path.join(root,`hl2/maps/${mapName}.bsp`));
index.set(`hl2/maps/${mapName}.bsp`,{loose:path.join(root,`hl2/maps/${mapName}.bsp`)});add(`hl2/maps/${mapName}.bsp`);
function lump(n) {const at=8+n*16;return bsp.subarray(bsp.readInt32LE(at),bsp.readInt32LE(at)+bsp.readInt32LE(at+4));}
// Resolve cubemap material patches and their dependencies from the BSP's ZIP pak lump.
const pak=lump(40);
const eocd=pak.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
if(eocd>=0) {
  let p=pak.readUInt32LE(eocd+16);
  for(let i=0;i<pak.readUInt16LE(eocd+10);i++) {
    if(pak.readUInt32LE(p)!==0x02014b50)throw new Error('Invalid BSP ZIP directory');
    const method=pak.readUInt16LE(p+10),compressed=pak.readUInt32LE(p+20),nameLength=pak.readUInt16LE(p+28);
    const name=pak.toString('utf8',p+46,p+46+nameLength),local=pak.readUInt32LE(p+42);
    const start=local+30+pak.readUInt16LE(local+26)+pak.readUInt16LE(local+28);
    const data=pak.subarray(start,start+compressed);
    if(method===0||method===8)index.set(clean('hl2/'+name),{embedded:method===0?data:zlib.inflateRawSync(data)});
    p+=46+nameLength+pak.readUInt16LE(p+30)+pak.readUInt16LE(p+32);
  }
}
for(const name of lump(43).toString().split('\0').filter(Boolean))material(name);
for(const match of bsp.toString('latin1').matchAll(/models\/[a-zA-Z0-9_./ -]+\.mdl/g))model(match[0]);
const entities=lump(0).toString();
transitions[mapName]=[...new Set([...entities.matchAll(/"map"\s+"(d1_[a-z0-9_]+)"/gi)].map(m=>m[1].toLowerCase()).filter(n=>mapNames.includes(n)))];
for(const match of entities.matchAll(/"skyname"\s+"([^"]+)"/g))for(const side of ['bk','dn','ft','lf','rt','up'])material(`skybox/${match[1]}${side}`);
console.log(`Selected ${mapName}`);
}
// Resolve Ravenholm first so its initial chunks remain small and focused.
selectMap('d1_town_01');
for(const mapName of mapNames)if(mapName!=='d1_town_01')selectMap(mapName);
currentMap='core';seenMaterials=new Set();seenModels=new Set();
// Models spawned by code, weapons, breakable gibs, and NPC variants need no map entity model key.
for(const key of index.keys())if(/^hl2\/models\/(weapons\/|items\/|gibs\/|zombie\/|headcrab|monk|player)/.test(key)&&key.endsWith('.mdl'))model(key.slice(4));
for(const name of ['crow','pigeon','seagull','crossbow_bolt','healthvial','effects/combineball'])model(`models/${name}.mdl`);
// Shared debris precached by the server independently of map entities/PHYs.
for(const key of index.keys())if(/^hl2\/models\/props_debris\/concrete_chunk.*\.mdl$/.test(key))model(key.slice(4));
for(const key of ['hl2/steam.inf','hl2/scenes/scenes.image','hl2/materials/debug/debugluxelsnoalpha.vtf','hl2/materials/dev/identitylightwarp.vtf','hl2/materials/engine/normalizedrandomdirections2d.vtf','hl2/materials/effects/flashlight_border.vtf'])add(key);
model('models/error.mdl');
for(const font of ['dejavusans.ttf','dejavusansmono.ttf','dejavusans-bold.ttf'])put(`platform/resource/linux_fonts/${font}`,fs.readFileSync(new URL(`fonts/${font}`,import.meta.url)));
for(const filename of ['dxsupport.cfg','dxsupport_linux.cfg']){
  const source=path.join(root,'bin',filename);if(fs.existsSync(source))put(`bin/${filename}`,fs.readFileSync(source));
}
put('hl2/gameinfo.txt',Buffer.from('"GameInfo" { game "HALF-LIFE 2" title "HALF-LIFE 2" type singleplayer_only FileSystem { SteamAppId 220 SearchPaths { "Game+Mod+Mod_Write+Default_Write_Path" "|gameinfo_path|." Game hl2 GameBin hl2/bin Platform platform } } }'));
put('hl2/cfg/autoexec.cfg',Buffer.from('volume 0.8\nsnd_musicvolume 0.15\ntouch_enable 0\nmat_hdr_level 0\nmat_antialias 0\nmat_vsync 0\nsv_unlockedchapters 6\n'));
// Keep the full shared content available without forcing every sound/model
// into the initial download. Filesystem misses request their indexed chunk.
currentMap=null;
for(const[key,entry]of index)if(/^(hl2|platform)\/(models|materials|sound|scenes)\//.test(key)&&!/^hl2\/sound\/vo\/(novaprospekt|citadel|coast|outland|episode)/.test(key)&&!selected.has(key))selected.set(key,entry.embedded?.length??(entry.loose?fs.statSync(entry.loose).size:entry.length+entry.lead.length));
const manifest={version:2,maps:Object.fromEntries(mapNames.map(n=>[n,[]])),transitions,chunks:{},assets:{},files:selected.size,missing:[...missing].sort()};
let batch=[],size=0,sequence=0,batchFiles=[],batchMaps=new Set(),owner;
function flush() {
  if(!batch.length)return;
  const data=Buffer.concat(batch),hash=crypto.createHash('sha256').update(data).digest('hex');
  const name=`ravenholm-${sequence++}`,file=`asset.${hash.slice(0,16)}.data`;
  fs.writeFileSync(path.join(output,file),data);
  const compressed=zlib.gzipSync(data,{level:6});fs.writeFileSync(path.join(output,file+'.gz'),compressed);
  manifest.chunks[name]={file:file+'.gz',encoding:'gzip',bytes:data.length,gzipBytes:compressed.length,sha256:hash};
  for(const key of batchFiles)manifest.assets['/'+key]=name;
  for(const mapName of mapNames)if(batchMaps.has('core')||batchMaps.has(mapName))manifest.maps[mapName].push(name);
  batch=[];size=0;batchFiles=[];batchMaps=new Set();
}
function assetOwner(key){const maps=uses.get(key);return maps?.has('core')?'core':maps?.values().next().value??`deferred/${key.split('/')[1]}`;}
const orderedFiles=[...selected.keys()].sort((a,b)=>assetOwner(a).localeCompare(assetOwner(b))||a.localeCompare(b));
for(const key of orderedFiles) {
  const nextOwner=assetOwner(key);
  if(owner!==nextOwner){flush();owner=nextOwner;}
  const blob=read(key);
  const name=Buffer.from('/'+key),head=Buffer.alloc(8);head.writeUInt32LE(name.length);head.writeUInt32LE(blob.length,4);
  const limit=nextOwner==='deferred/sound'?2:nextOwner.startsWith('deferred/')?8:16;
  if(size && size+8+name.length+blob.length>limit*1024*1024)flush();
  batch.push(head,name,blob);size+=8+name.length+blob.length;
  batchFiles.push(key);for(const mapName of uses.get(key)||[])batchMaps.add(mapName);
}
flush();
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
const groups={};for(const[key,bytes]of selected){const group=key.split('/').slice(0,3).join('/');groups[group]=(groups[group]||0)+bytes;}
fs.writeFileSync(path.join(output,'asset-report.json'),JSON.stringify({groups,files:[...selected].map(([name,bytes])=>({name,bytes})),missing:[...missing]},null,2));
for(const fd of handles.values())fs.closeSync(fd);
fs.unlinkSync(path.join(output,'.pack-in-progress'));
console.log(JSON.stringify({files:selected.size,chunks:sequence,rawMB:Object.values(manifest.chunks).reduce((n,c)=>n+c.bytes,0)/1048576,gzipMB:Object.values(manifest.chunks).reduce((n,c)=>n+c.gzipBytes,0)/1048576,unresolvedReferences:missing.size},null,2));
