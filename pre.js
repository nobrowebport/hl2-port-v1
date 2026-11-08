Module.arguments = Module.arguments || [];
Module.arguments.push('+r_web_rtx_lighting',Module.rtxLighting?'1':'0');
if(Module.debugQA)Module.arguments.push('-web-lightmap-probe');
Module.arguments.push('-game', 'hl2', '-noip', '-novid', '-windowed', '-language', 'english',
  '-w', '1280', '-h', '720', '+mat_hdr_level', '0', '+mat_antialias', '0',
  '+mat_vsync', '0', '+touch_enable', '0', '+developer', '0', '+fps_max', '90', '+volume', '0.8', '+snd_musicvolume', '0.15', '+cl_showfps', '1', (Module.startMap||'').startsWith('background')?'+map_background':'+map', Module.startMap || 'd1_town_01');

class DataLoader {
  constructor() { this.pending = new Map(); this.manifest = null; }
  async getManifest() {
    if (!this.manifest) this.manifest = fetch('chunks/manifest.json').then(r => {
      if (!r.ok) throw new Error(`Asset manifest: HTTP ${r.status}`);
      return r.json();
    }).then(manifest=>{Module.onAssetManifest?.(manifest);return manifest;});
    return this.manifest;
  }
  async loadMapWithDeps(mapName) {
    if(this.currentMap!==mapName)this.prefetchAbort?.abort();
    const manifest = await this.getManifest();
    const chunks = manifest.maps[mapName];
    if (!chunks) throw new Error(`Map is not packaged: ${mapName}`);
    let next = 0;
    // Three independent chunk requests overlap network/cache latency with bounded memory.
    await Promise.all(Array.from({length: Math.min(3, chunks.length)}, async () => {
      while (next < chunks.length) await this.loadMapCached(chunks[next++]);
    }));
    this.currentMap=mapName;
  }
  scheduleNext(mapName){
    if(typeof setTimeout==='undefined')return;
    clearTimeout(this.prefetchTimer);
    this.prefetchTimer=setTimeout(()=>this.prefetchNext(mapName).catch(()=>{}),30000);
  }
  async prefetchNext(mapName){
    if(typeof caches==='undefined'||this.currentMap!==mapName)return;
    const manifest=await this.getManifest();
    const group=n=>n.includes('trainstation')?0:n.includes('canals')?1:n.includes('eli')?2:3;
    const ordered=Object.keys(manifest.maps).sort((a,b)=>group(a)-group(b)||a.localeCompare(b));
    const next=(manifest.transitions?.[mapName]||[]).filter(n=>ordered.indexOf(n)>ordered.indexOf(mapName)).sort((a,b)=>ordered.indexOf(a)-ordered.indexOf(b))[0];
    if(!next)return;
    const cache=await caches.open('hl2-assets-v1');this.prefetchAbort=new AbortController();let bytes=0;
    for(const name of manifest.maps[next]){
      const chunk=manifest.chunks[name],url=new URL(`chunks/${chunk.file}`,location.href).href;
      if(await cache.match(url))continue;
      if(bytes+chunk.gzipBytes>64*1024*1024)break;
      const response=await fetch(url,{priority:'low',signal:this.prefetchAbort.signal});
      if(response.ok){await cache.put(url,response);bytes+=chunk.gzipBytes;}
    }
  }
  async loadMapCached(name) {
    if (!this.pending.has(name)) {
      const task = this.loadChunk(name).catch(error => { this.pending.delete(name); throw error; });
      this.pending.set(name, task);
    }
    return this.pending.get(name);
  }
  async loadChunk(name) {
    const manifest = await this.getManifest();
    const chunk = manifest.chunks[name];
    if (!chunk) throw new Error(`Unknown asset chunk: ${name}`);
    const url = new URL(`chunks/${chunk.file}`, location.href).href;
    this.progress(`Loading ${name}…`);
    let cache;
    try { cache = await caches.open('hl2-assets-v1'); } catch {}
    let response = cache && await cache.match(url);
    if (!response) {
      response = await fetch(url);
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      if (cache) { try { await cache.put(url, response.clone()); } catch {} }
    }
    const body = chunk.encoding === 'gzip'
      ? new Response(response.body.pipeThrough(new DecompressionStream('gzip')))
      : response;
    const data = new Uint8Array(await body.arrayBuffer());
    if (data.byteLength !== chunk.bytes) throw new Error(`Incomplete asset chunk: ${name}`);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
      x => x.toString(16).padStart(2, '0')).join('');
    if (digest !== chunk.sha256) {
      if (cache) await cache.delete(url);
      throw new Error(`Asset checksum mismatch: ${name}. Retry loading.`);
    }
    const view = new DataView(data.buffer), decoder = new TextDecoder();
    let offset = 0;
    while (offset < data.length) {
      if (offset + 8 > data.length) throw new Error('Truncated asset header');
      const pathLength = view.getUint32(offset, true), size = view.getUint32(offset + 4, true);
      const end = offset + 8 + pathLength + size;
      if (end > data.length || pathLength > 4096) throw new Error('Invalid asset record');
      const path = decoder.decode(data.subarray(offset + 8, offset + 8 + pathLength));
      if (!/^\/(hl2|platform|bin)\//.test(path) || path.split('/').includes('..')) throw new Error('Invalid asset path');
      FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
      FS.writeFile(path, data.subarray(offset + 8 + pathLength, end), {canOwn: true});
      offset = end;
    }
    this.progress('');
  }
  progress(message) {
    if (typeof statusElement !== 'undefined') statusElement.textContent = message;
    if (typeof spinnerElement !== 'undefined') spinnerElement.hidden = !message;
  }
}
const dataLoader = new DataLoader();
Module.reportRuntimeError = message => {
  Module.silenceAudio?.();
  dataLoader.progress('Engine stopped. Reload after the build is ready.');
  console.error(message);
  if (typeof outputElement !== 'undefined') outputElement.value += '\n' + message;
};
Module.downloadMap = (lock, mapName) => {
  dataLoader.loadMapWithDeps(mapName).then(() => {
    Atomics.store(HEAP32, lock, 0); Atomics.notify(HEAP32, lock);
    dataLoader.scheduleNext(mapName);
  }).catch(error => {
    dataLoader.progress(error.message); console.error(error);
    Atomics.store(HEAP32, lock, -1); Atomics.notify(HEAP32, lock);
  });
};
Module.downloadAsset = async (lock, path) => {
  try {
    const manifest = await dataLoader.getManifest();
    const chunk = manifest.assets?.[path.toLowerCase()];
    if (!chunk) { Atomics.store(HEAP32,lock,-1); return; }
    await dataLoader.loadMapCached(chunk);
    Atomics.store(HEAP32,lock,0);
  } catch(error) {
    console.error(`Asset ${path}: ${error.message}`);
    Atomics.store(HEAP32,lock,-1);
  } finally { Atomics.notify(HEAP32,lock); }
};
