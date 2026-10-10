import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {criticIntegerModel,criticIntegerCompare} from '../../../tools/virgl-command/standard-integer-adversarial-oracle.mjs';
const out=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(out,'../../..'),unpack=path.join(out,'unpacked');
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const summary={schema:'standard-integer-critic-recording-audit-v1',status:'running',compiler:[],frames:[],faults:[],boundaries:[],pixels:0,nativeDraws:0};
for(const prefix of ['hot','cold']){
 const generated=path.join(unpack,prefix+'-generated/renderer/virgl-shader/build/wasm');
 const {default:create}=await import(pathToFileURL(path.join(generated,'virgl-shader.mjs')));const module=await create();assert.equal(module.HEAPU8.byteLength,16777216);
 const direct=(a,b,signedMask,unsignedMask,old=false,kind=0)=>{const ps=[];try{for(const s of [a,b]){const p=module._malloc(s.length+1);assert.ok(p);ps.push(p);module.HEAPU8.set(Buffer.from(s),p);module.HEAPU8[p+s.length]=0;}
  return JSON.parse(module.UTF8ToString(old?module._bridge_translate_standard_pair(ps[0],a.length,ps[1],b.length):module._bridge_translate_standard_pair_typed(kind===2?0:ps[0],a.length,kind===3?0:ps[1],b.length,signedMask,unsignedMask)));
 }finally{ps.reverse().forEach(p=>module._free(p));}};
 const directory=path.join(unpack,prefix),cases=(await json(path.join(directory,'native/cases.json'))).cases,native=(await fs.readFile(path.join(directory,'native/native.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),wasm=(await fs.readFile(path.join(directory,'native/wasm.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(cases.length,48);assert.deepEqual(await fs.readFile(path.join(directory,'native/native.jsonl')),await fs.readFile(path.join(directory,'native/sanitize.jsonl')));
 for(let i=0;i<cases.length;i++){
  const c=cases[i],r=direct(c.a,c.b,c.signedMask,c.unsignedMask,c.kind===1,c.kind);assert.deepEqual(r,native[i].result);assert.deepEqual(r,wasm[i].result);assert.equal(r.ok,c.okay);
  if(r.ok)for(const input of r.vertex.metadata.attributes){const type=c.kind===1?'vec4':c.signedMask&2**input.index?'ivec4':c.unsignedMask&2**input.index?'uvec4':'vec4';assert.equal(input.type,type);assert.ok(r.vertex.glsl.includes('in '+type+' in_'+input.index+';'));}
 }
 const alloc=(await fs.readFile(path.join(directory,'native/allocations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(alloc.at(-1).faults,40);assert.equal(alloc.at(-1).recoveries,40);assert.ok(alloc.at(-1).callerMutation);for(const row of alloc.filter(r=>r.kind.endsWith('fault')))assert.equal(row.result.ok,false);
 summary.compiler.push({prefix,cases:cases.length,actualArchivedWasmEquality:true,allAllocationFaults:40});
 const compileCache=new Map();
 for(const name of ['hardware','fault-native-signedness','fault-constant-word','fault-shader-conversion']){
  const report=await json(path.join(directory,name,'report.json')),fault=name!=='hardware',result=fault?report.partial:report.browserResult.result,blobs=new Map(result.blobs.map(b=>[b.key,b]));
  const raw=async ref=>{const b=blobs.get(ref.key);assert.equal(b.sha256,ref.sha256);const packed=await fs.readFile(path.join(directory,name,b.path));assert.equal(sha(packed),b.gzipSha256);const unpacked=gunzipSync(packed);assert.equal(sha(unpacked),b.sha256);assert.equal(unpacked.length,b.bytes);return new Uint8Array(unpacked);};
  for(const frame of result.frames){
   const buffers=new Map(),originalGpu=new Map();
   for(const row of frame.native.buffers){const bytes=await raw(row.blob);buffers.set(row.resourceId,new Uint8Array(bytes.length));originalGpu.set(row.resourceId,bytes);}
   for(const row of frame.inputs){const bytes=await raw(row.blob);assert.equal(row.layout.rowCount,1);assert.equal(row.layout.rowBytes,bytes.length);buffers.get(row.resource.id).set(bytes,row.layout.offset);}
   for(const [id,bytes]of originalGpu)assert.deepEqual(bytes,buffers.get(id),'original upload/full GPU storage '+frame.label);
   const model=criticIntegerModel(frame.history,buffers,frame.range),comparison=criticIntegerCompare(await raw(frame.pixels),model,frame.width,frame.height),draw=frame.history.at(-1).result.draws.at(-1);
   assert.equal(frame.history.at(-1).result.gpuComplete,true);assert.equal(frame.native.calls.length,1);assert.equal(frame.native.state.length,1);
   const state=frame.native.state[0],call=frame.native.calls[0],instanced=model.draw.instances>1;
   assert.equal(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''));assert.deepEqual(call.args,model.draw.indexed?[0,model.draw.count,{1:5121,2:5123,4:5125}[model.nativeSize],model.nativeOffset,...(instanced?[model.draw.instances]:[])]:[0,model.draw.start,model.draw.count,...(instanced?[model.draw.instances]:[])]);
   assert.deepEqual([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.vertexWork],[model.min,model.max,model.valid,model.restarts,model.draw.count*model.draw.instances]);
   for(const n of frame.native.normalized)assert.deepEqual(await raw(n.blob),model.normalized);
   assert.deepEqual(state.pointSize,model.pointUniform);
   for(const fetch of model.fetches){
    const got=draw.vertexFetches.find(a=>a.attributeIndex===fetch.attributeIndex),a=state.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),signedFault=fault&&report.mutation.mode==='native-signedness'&&fetch.nativeType===5120;
    assert.ok(a);for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(got[key],fetch[key],frame.label+' '+key);
    assert.equal(got.nativeType,signedFault?5121:fetch.nativeType);assert.equal(a.shaderType,signedFault?36296:fetch.shaderType);assert.equal(a.enabled,!fetch.constant);assert.equal(a.divisor,fetch.nativeDivisor);
    if(fetch.integer)assert.equal(got.nativeIntegerInput,true);
    if(fetch.constant){
     const wordFault=fault&&report.mutation.mode==='constant-word'&&fetch.attributeIndex===1;
     if(wordFault){assert.notDeepEqual(got.componentWords,fetch.componentWords);assert.deepEqual(got.componentWords,a.genericWords.slice(0,fetch.components));}
     else {assert.deepEqual(got.componentWords,fetch.componentWords);assert.deepEqual(a.genericWords,fetch.genericWords);assert.deepEqual(got.genericValues,fetch.genericValues);assert.deepEqual(a.genericValues,fetch.genericValues);}
     assert.equal(a.genericKind,fetch.integer?fetch.signed?'Int32Array':'Uint32Array':'Float32Array');
    }else {assert.equal(a.integer,fetch.integer);assert.deepEqual([a.type,a.normalized,a.components,a.stride,a.offset],[signedFault?5121:fetch.nativeType,false,fetch.components,fetch.stride,fetch.offset]);assert.equal(a.buffer,frame.native.buffers.find(b=>b.resourceId===fetch.resourceId).nativeBuffer);}
   }
   if(!fault){
    const key=JSON.stringify([model.state.shaders.get(0),model.state.shaders.get(1),model.signedMask,model.unsignedMask]);let pair=compileCache.get(key);
    if(!pair){pair=direct(model.state.shaders.get(0),model.state.shaders.get(1),model.signedMask,model.unsignedMask);assert.ok(pair.ok);compileCache.set(key,pair);}
    assert.equal(state.shaders.find(s=>s.type===35633).source,pair.vertex.glsl,'actual compiler -> native vertex source custody');assert.equal(state.shaders.find(s=>s.type===35632).source,pair.fragment.glsl);
    assert.equal(comparison.held,true,frame.label);summary.pixels+=comparison.pixels;summary.nativeDraws++;
   }else {assert.equal(comparison.held,false,frame.label);assert.ok(report.browserResult.error.message.includes('independent original compact pixels'));}
   (fault?summary.faults:summary.frames).push({prefix,record:name+'/report.json',label:frame.label,pixelSha256:frame.pixels.sha256,modelMasks:[model.signedMask,model.unsignedMask],pixels:comparison.pixels,maxError:comparison.maxError,misses:comparison.misses,originalGpu:true,compiledSource:!fault,gpuComplete:true});
  }
  if(!fault){
   assert.equal(result.rejections.length,14);for(const reject of result.rejections){assert.equal(reject.record.result.ok,false);const run=result.runs.find(run=>run.history.at(-1).label===reject.record.label);assert.ok(run);assert.equal(run.calls.length,0);if(reject.record.label==='short-compact-staging')assert.equal(run.events.filter(e=>e.label===reject.record.label&&e.name==='copyBufferSubData').length,0);}
   assert.equal(result.suspensions.length,6);for(const s of result.suspensions){assert.equal(s.record.result.gpuComplete,true);assert.equal(s.record.result.ok,s.action==='reuse');assert.equal(s.point.inspection.jobs.status,s.phase);if(s.action!=='reuse')assert.equal(result.runs.find(run=>run.history.at(-1).label===s.record.label).calls.length,0);}
   for(const run of result.runs)for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])assert.equal(run.inspection.jobs[key],0);
   for(const ownership of result.ownership.filter(r=>r.phase==='type-variants')){
    assert.deepEqual(ownership.requests,ownership.evict?[{signedMask:0,unsignedMask:0},{signedMask:2,unsignedMask:0},{signedMask:0,unsignedMask:2},{signedMask:0,unsignedMask:0}]:[{signedMask:0,unsignedMask:0},{signedMask:2,unsignedMask:0},{signedMask:0,unsignedMask:2}]);
    assert.equal(ownership.programs[0]===ownership.programs[3],!ownership.evict);assert.equal(new Set(ownership.programs.slice(0,3)).size,3);
   }
   summary.boundaries.push({prefix,rejections:14,suspensions:6,ownership:3,compiledPairs:compileCache.size});
  }
 }
}
summary.status='HELD';await fs.writeFile(path.join(out,'recording-audit.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({status:summary.status,frames:summary.frames.length,pixels:summary.pixels,faults:summary.faults.length,compiler:summary.compiler}));
