// Seal the browser worker's static module graph before a zero-egress replay.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const patterns=[/\b(?:import|export)\s+[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bnew\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g];
export async function sealReplayStaticAssets(webRoot,{wasmPackageRoot=null,gpuBuildFile=null}={}){
  const result=new Map(),pending=['/session-gpu-replay-worker.js'];
  while(pending.length){const name=pending.pop();if(result.has(name))continue;
    if(!name.startsWith('/')||name.includes('?')||name.includes('#'))throw Error('static replay asset path '+name);
    let file;
    if(gpuBuildFile&&name==='/gpu-checkpoint-build.js')file=path.resolve(gpuBuildFile);
    else{
      const packageAsset=wasmPackageRoot&&name.startsWith('/pkg/');
      const root=path.resolve(packageAsset?wasmPackageRoot:webRoot);
      file=path.resolve(root,packageAsset?name.slice('/pkg/'.length):'.'+name);
      if(!file.startsWith(root+path.sep))throw Error('static replay asset escape '+name);
    }
    const bytes=await fs.readFile(file);result.set(name,{name,bytes:bytes.length,sha256:sha(bytes)});
    if(!/\.(?:js|mjs)$/.test(name))continue;
    const source=bytes.toString('utf8');
    for(const [kind,expression]of patterns.entries()){for(const match of source.matchAll(expression)){
      const spec=match[1];
      if(kind===2&&spec==='module')continue; // Emscripten's Node-only branch is unreachable in a browser worker.
      if(kind<3&&!spec.startsWith('.')&&!spec.startsWith('/'))throw Error('unsealed bare replay import '+spec+' in '+name);
      const child=spec.startsWith('/')?path.posix.normalize(spec):path.posix.resolve(path.posix.dirname(name),spec);
      if(!/\.(?:js|mjs|wasm|json)$/.test(child))throw Error('unsealed replay module type '+child);
      pending.push(child);
    }}
  }
  return [...result.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
