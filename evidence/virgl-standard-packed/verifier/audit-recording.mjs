#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {criticModel,criticPixels} from '../../../tools/virgl-command/standard-packed-adversarial-oracle.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),base=path.join(here,'unpacked'),sha=b=>createHash('sha256').update(b).digest('hex');
const {default:createModule}=await import(pathToFileURL(path.join(base,'hot-generated/renderer/virgl-shader/build/wasm/virgl-shader.mjs')));
const compiler=await createModule();assert.equal(compiler.HEAPU8.byteLength,16777216);
const compiled=new Map();
function pair(vertex,fragment,masks){
 const key=JSON.stringify([vertex,fragment,masks]);if(compiled.has(key))return compiled.get(key);
 const owned=[];try{
  for(const text of [vertex,fragment]){const p=compiler._malloc(text.length+1);assert.ok(p);owned.push(p);compiler.HEAPU8.set(Buffer.from(text+'\0'),p);}
  const p=compiler._bridge_translate_standard_pair_vertex_formats(owned[0],vertex.length,owned[1],fragment.length,...masks),r=JSON.parse(compiler.UTF8ToString(p));assert.equal(r.ok,true);compiled.set(key,r);return r;
 }finally{owned.reverse().forEach(p=>compiler._free(p));}
}
const out={schema:'standard-packed-critic-recording-v1',status:'running',records:[],frames:0,pixels:0,faults:0,servedPins:0,originalStorage:0,genericReads:0,compiledNativeSources:0};
for(const family of ['hot','cold'])for(const name of ['hardware','fault-native-normalize','fault-constant-field','fault-shader-sign']){
 const dir=path.join(base,family,name),bytes=await fs.readFile(path.join(dir,'report.json')),report=JSON.parse(bytes),fault=name!=='hardware',r=fault?report.partial:report.browserResult.result;
 assert.equal(report.gitHead,'e7a85906622794c60872876f9d3e80da83df9ccd');assert.equal(report.status,fault?'failed':'passed');
 assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});assert.equal(report.browser.headless,false);
 assert.equal(report.browser.gpu.featureStatus.webgl2??report.browser.gpu.featureStatus.webgl,'enabled');
 assert.ok(!report.browser.commandLine.some(arg=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu/.test(arg)));
 const sources=new Map(report.sources.map(s=>[s.path,s]));
 for(const served of report.servedFiles){if(served.path==='/')continue;const s=sources.get(served.path.slice(1));assert.ok(s,served.path);const expected=report.mutation&&report.mutation.path===s.path?report.mutation.servedSha256:s.sha256;assert.equal(served.sha256,expected);out.servedPins++;}
 const coverage=JSON.parse(await fs.readFile(path.join(dir,report.browserCoverage.path)));for(const script of coverage.scripts)assert.equal(script.sha256,report.servedFiles.find(row=>row.path==='/'+script.source).sha256);
 const blobs=new Map(r.blobs.map(b=>[b.key,b]));
 async function raw(ref){const b=blobs.get(ref.key),gz=await fs.readFile(path.join(dir,b.path));assert.equal(sha(gz),b.gzipSha256);const bytes=gunzipSync(gz);assert.equal(bytes.length,b.bytes);assert.equal(sha(bytes),ref.sha256);return new Uint8Array(bytes);}
 const auditRows=[];
 for(const [ordinal,frame]of r.frames.entries()){
  const buffers=new Map(),native=new Map(),normalized=new Map();
  for(const row of frame.native.buffers){const bytes=await raw(row.blob);buffers.set(row.resourceId,new Uint8Array(bytes.length));native.set(row.resourceId,bytes);}
  for(const row of frame.inputs){const bytes=await raw(row.blob);assert.equal(row.layout.rowCount,1);assert.equal(row.layout.rowBytes,bytes.length);buffers.get(row.resource.id).set(bytes,row.layout.offset);}
  for(const [id,bytes]of native){assert.deepEqual(bytes,buffers.get(id),frame.label+' complete original storage '+id);out.originalStorage++;}
  const m=criticModel(frame.history,buffers,frame.range),pixel=criticPixels(await raw(frame.pixels),m,frame.width,frame.height),draw=frame.history.at(-1).result.draws.at(-1);
  assert.equal(frame.history.at(-1).result.gpuComplete,true);assert.ok(frame.native.calls.length>0);
  assert.deepEqual(frame.predicted.ids,m.ids);assert.deepEqual(frame.predicted.points,JSON.parse(JSON.stringify(m.points)));assert.deepEqual(frame.predicted.fetches,JSON.parse(JSON.stringify(m.fetches)));
  for(const b of frame.native.normalized){const bytes=await raw(b.blob);assert.deepEqual(bytes,m.normalized);normalized.set(b.nativeBuffer,bytes);}
  assert.deepEqual([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.normalizedIndices,draw.nativeIndexSize,draw.nativeIndexOffset,draw.vertexWork],
   [m.min,m.max,m.valid,m.restarts,m.normalize,m.nativeSize,m.nativeOffset,m.draw.count*m.effective]);
  const masks=[0,0,0,0];for(const f of m.fetches){if(f.integer)masks[f.signed?0:1]|=2**f.attributeIndex;else if([172,173].includes(f.sourceFormat)&&f.stride){masks[2]|=2**f.attributeIndex;if(f.sourceFormat===173)masks[3]|=2**f.attributeIndex;}}
  const actual=pair(m.shaders.get(0),m.shaders.get(1),masks);
  for(let i=0;i<frame.native.calls.length;i++){
   const call=frame.native.calls[i],state=frame.native.state[i];assert.equal(call.name,(m.draw.indexed?'drawElements':'drawArrays')+(m.effective>1?'Instanced':''));
   assert.deepEqual(call.args,m.draw.indexed?[0,m.draw.count,{1:5121,2:5123,4:5125}[m.nativeSize],m.nativeOffset,...(m.effective>1?[m.effective]:[])]:[0,m.draw.start,m.draw.count,...(m.effective>1?[m.effective]:[])]);
   assert.equal(m.normalize?normalized.has(call.indexBuffer):call.indexBuffer===(m.index?frame.native.buffers.find(b=>b.resourceId===m.index.id).nativeBuffer:null),true);
   assert.deepEqual(state.pointSize,m.pointUniform);
   for(const fetch of m.fetches){
    const got=draw.vertexFetches.find(f=>f.attributeIndex===fetch.attributeIndex),a=state.attributes.find(a=>a.name==='in_'+fetch.attributeIndex);
    for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(got[key],fetch[key],frame.label+' '+key);
    assert.equal(a.shaderType,fetch.integer?fetch.shaderType:35666);assert.equal(a.enabled,!fetch.constant);assert.equal(a.divisor,fetch.nativeDivisor);assert.equal(a.integer,Boolean(fetch.integer));
    if(fetch.constant){
     assert.equal(a.genericKind,fetch.integer?fetch.signed?'Int32Array':'Uint32Array':'Float32Array');
     if(fault&&name==='fault-constant-field'&&fetch.attributeIndex===1)assert.notDeepEqual(a.genericValues,fetch.genericValues);
     else {assert.deepEqual(a.genericValues,JSON.parse(JSON.stringify(fetch.genericValues)));assert.deepEqual(got.componentWords,fetch.componentWords);}
     const run=r.runs.find(run=>run.history.at(-1)?.label===frame.label);
     if(run&&!fault){const original=buffers.get(fetch.resourceId).subarray(fetch.offset,fetch.offset+fetch.elementBytes),hex=Buffer.from(original).toString('hex'),reads=run.events.filter(e=>e.label===frame.label&&e.name==='getBufferSubData'&&e.bytes===fetch.elementBytes&&e.hex===hex);
      // Distinct shared attributes may share identical literal bytes; require at least one retained read per fetch.
      assert.ok(reads.length>=1,frame.label+' retained original read width/bytes');out.genericReads++;}
    }else{
     assert.deepEqual([a.type,a.normalized,a.components,a.stride,a.offset],[fetch.nativeType,fault&&name==='fault-native-normalize'&&fetch.sourceFormat===8?false:fetch.normalized,fetch.components,fetch.stride,fetch.offset]);
     assert.equal(a.buffer,frame.native.buffers.find(b=>b.resourceId===fetch.resourceId).nativeBuffer);
    }
   }
   const vertex=state.shaders.find(s=>s.type===35633).source,fragment=state.shaders.find(s=>s.type===35632).source;
   assert.equal(fragment,actual.fragment.glsl);assert.equal(vertex,fault&&name==='fault-shader-sign'?actual.vertex.glsl.replaceAll('vec4(1024.0,1024.0,1024.0,4.0)','vec4(1024.0,1024.0,1024.0,0.0)'):actual.vertex.glsl,'actual C output equals compiled GPU vertex source');out.compiledNativeSources++;
  }
  assert.equal(pixel.held,!fault,frame.label);assert.equal(pixel.nanPixels,0);assert.ok(!fault||report.browserResult.error.message.includes('independent original compact pixels'));
  auditRows.push({ordinal,label:frame.label,reportSha256:sha(bytes),pixels:pixel.pixels,maxError:pixel.maxError,held:pixel.held,misses:pixel.misses,masks,originalStoragePins:frame.native.buffers.map(b=>({id:b.resourceId,sha256:b.blob.sha256})),pixelSha256:frame.pixels.sha256});
  if(fault)out.faults++;else {out.frames++;out.pixels+=pixel.pixels;}
 }
 if(!fault){assert.equal(r.rejections.length,15);for(const x of r.rejections){assert.equal(x.record.result.ok,false);assert.ok(!r.runs.find(run=>run.history.at(-1)?.label===x.record.label)?.calls.length);}
  for(const x of r.suspensions){if(x.action==='reuse')assert.equal(x.record.result.ok,true);else{assert.equal(x.record.result.ok,false);assert.equal(x.record.result.gpuComplete,true);}}
  for(const run of r.runs)for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])assert.equal(run.inspection.jobs[key],0);
 }
 const auditPath=family+'-'+name+'-audit.jsonl';await fs.writeFile(path.join(here,auditPath),auditRows.map(r=>JSON.stringify(r)).join('\n')+'\n');out.records.push({family,name,reportSha256:sha(bytes),auditPath,frames:r.frames.length,draws:r.frames.reduce((n,f)=>n+f.native.calls.length,0),suspensions:r.suspensions.length,rejections:r.rejections.length});
}
assert.equal(out.frames,428);assert.equal(out.pixels,115200);assert.equal(out.faults,6);out.compilerVariants=compiled.size;out.status='passed';
await fs.writeFile(path.join(here,'recording-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
