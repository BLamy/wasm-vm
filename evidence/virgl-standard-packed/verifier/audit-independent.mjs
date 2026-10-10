#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {criticModel,criticPixels} from '../../../tools/virgl-command/standard-packed-adversarial-oracle.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const {default:createModule}=await import(pathToFileURL(path.join(here,'unpacked/hot-generated/renderer/virgl-shader/build/wasm/virgl-shader.mjs'))),compiler=await createModule(),cache=new Map();
function pair(vertex,fragment,masks){const key=JSON.stringify([vertex,fragment,masks]);if(cache.has(key))return cache.get(key);const p=[];try{for(const text of [vertex,fragment]){const a=compiler._malloc(text.length+1);assert.ok(a);p.push(a);compiler.HEAPU8.set(Buffer.from(text+'\0'),a);}const r=JSON.parse(compiler.UTF8ToString(compiler._bridge_translate_standard_pair_vertex_formats(p[0],vertex.length,p[1],fragment.length,...masks)));assert.equal(r.ok,true);cache.set(key,r);return r;}finally{p.reverse().forEach(a=>compiler._free(a));}}
const out={schema:'standard-packed-critic-independent-audit-v1',status:'running',records:[],frames:0,pixels:0,faults:0,storage:0,nativeShaderComparisons:0,readRanges:0};
for(const name of ['hardware','fault-native-normalize','fault-constant-field','fault-shader-sign']){
 const dir=path.join(here,'promoted',name),reportBytes=await fs.readFile(path.join(dir,'report.json')),report=JSON.parse(reportBytes),fault=name!=='hardware',result=fault?report.partial:report.browserResult.result;
 assert.equal(report.gitHead,'520dbc10ad15f3ae328de577db724b1ff99cb32a');assert.equal(report.status,fault?'failed':'passed');assert.equal(report.browser.headless,false);assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
 for(const pin of report.sources)assert.equal(sha(await fs.readFile(path.join(repo,pin.path))),pin.sha256,'final promoted source pin '+pin.path);
 for(const pin of report.servedFiles){if(pin.path==='/')continue;const original=report.sources.find(s=>'/'+s.path===pin.path);assert.ok(original);assert.equal(pin.sha256,report.mutation?.path===original.path?report.mutation.servedSha256:original.sha256);}
 const blobs=new Map(result.blobs.map(b=>[b.key,b]));async function raw(ref){const b=blobs.get(ref.key),gz=await fs.readFile(path.join(dir,b.path));assert.equal(sha(gz),b.gzipSha256);const bytes=gunzipSync(gz);assert.equal(bytes.length,b.bytes);assert.equal(sha(bytes),b.sha256);assert.equal(b.sha256,ref.sha256);return new Uint8Array(bytes);}
 const rows=[];
 for(const [ordinal,frame]of result.frames.entries()){
  const buffers=new Map(),native=new Map();for(const b of frame.native.buffers){const bytes=await raw(b.blob);buffers.set(b.resourceId,new Uint8Array(bytes.length));native.set(b.resourceId,bytes);}
  for(const b of frame.inputs){const bytes=await raw(b.blob);assert.equal(b.layout.rowCount,1);assert.equal(b.layout.rowBytes,bytes.length);buffers.get(b.resource.id).set(bytes,b.layout.offset);}
  for(const [id,bytes]of native){assert.deepEqual(bytes,buffers.get(id));out.storage++;}
  const m=criticModel(frame.history,buffers,frame.range),pixels=criticPixels(await raw(frame.pixels),m,frame.width,frame.height),draw=frame.history.at(-1).result.draws.at(-1),masks=[0,0,0,0];
  for(const f of m.fetches){if(f.integer)masks[f.signed?0:1]|=2**f.attributeIndex;else if([172,173].includes(f.sourceFormat)&&f.stride){masks[2]|=2**f.attributeIndex;if(f.sourceFormat===173)masks[3]|=2**f.attributeIndex;}}
  const source=pair(m.shaders.get(0),m.shaders.get(1),masks),state=frame.native.state.at(-1);
  assert.equal(frame.history.at(-1).result.gpuComplete,true);assert.equal(frame.native.calls.length,1);assert.deepEqual(frame.predicted.fetches,JSON.parse(JSON.stringify(m.fetches)));assert.deepEqual(frame.predicted.points,JSON.parse(JSON.stringify(m.points)));
  assert.equal(pixels.held,!fault);assert.equal(pixels.nanPixels,0);
  for(const fetch of m.fetches){const a=state.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),got=draw.vertexFetches.find(a=>a.attributeIndex===fetch.attributeIndex);
   for(const k of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(got[k],fetch[k]);
   assert.equal(a.shaderType,fetch.integer?fetch.shaderType:35666);assert.equal(a.enabled,!fetch.constant);assert.equal(a.integer,Boolean(fetch.integer));assert.equal(a.divisor,fetch.nativeDivisor);
   if(fetch.constant){if(fault&&name==='fault-constant-field'&&fetch.attributeIndex===15)assert.notDeepEqual(a.genericValues,fetch.genericValues);else{assert.deepEqual(a.genericValues,fetch.genericValues);assert.deepEqual(got.componentWords,fetch.componentWords);assert.equal(a.genericKind,fetch.integer?fetch.signed?'Int32Array':'Uint32Array':'Float32Array');}
    const run=result.runs.find(run=>run.history.at(-1)?.label===frame.label);if(run){const storage=frame.native.buffers.find(b=>b.resourceId===fetch.resourceId),copies=run.events.filter(e=>e.label===frame.label&&e.name==='copyBufferSubData'&&e.source===storage.nativeBuffer&&e.args[2]===fetch.offset&&e.args[4]===fetch.elementBytes);assert.equal(copies.length,1,'exactly one retained original source copy per constant');out.readRanges++;}
   }else{assert.deepEqual([a.type,a.normalized,a.components,a.stride,a.offset],[fetch.nativeType,fault&&name==='fault-native-normalize'&&fetch.sourceFormat===8?false:fetch.normalized,fetch.components,fetch.stride,fetch.offset]);assert.equal(a.buffer,frame.native.buffers.find(b=>b.resourceId===fetch.resourceId).nativeBuffer);}
  }
  assert.equal(state.shaders.find(s=>s.type===35632).source,source.fragment.glsl);assert.equal(state.shaders.find(s=>s.type===35633).source,fault&&name==='fault-shader-sign'?source.vertex.glsl.replaceAll('vec4(1024.0,1024.0,1024.0,4.0)','vec4(1024.0,1024.0,1024.0,0.0)'):source.vertex.glsl);out.nativeShaderComparisons++;
  rows.push({ordinal,label:frame.label,reportSha256:sha(reportBytes),masks,pixels:pixels.pixels,maxError:pixels.maxError,held:pixels.held,misses:pixels.misses,pixelSha256:frame.pixels.sha256,
   nativeStorage:frame.native.buffers.map(b=>({resourceId:b.resourceId,generation:b.generation,sha256:b.blob.sha256})),fetches:m.fetches});
  if(fault)out.faults++;else{out.frames++;out.pixels+=pixels.pixels;}
 }
 const auditPath='promoted-'+name+'-audit.jsonl';await fs.writeFile(path.join(here,auditPath),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');out.records.push({name,reportSha256:sha(reportBytes),auditPath,frames:result.frames.length});
}
assert.equal(out.frames,92);assert.equal(out.pixels,23552);assert.equal(out.faults,3);out.compilerVariants=cache.size;out.status='passed';
await fs.writeFile(path.join(here,'independent-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
