#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {model,compare} from '../../../tools/virgl-instanced-stencil/oracle.mjs';
const root=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const loadJSON=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const op=[7680,0,7681,7682,7683,34055,34056,5386];
const face=(v,r)=>({STENCIL_FUNC:512+v.func,STENCIL_REF:r,STENCIL_VALUE_MASK:v.value,STENCIL_WRITEMASK:v.write,STENCIL_FAIL:op[v.fail],STENCIL_PASS_DEPTH_FAIL:op[v.zfail],STENCIL_PASS_DEPTH_PASS:op[v.zpass]});
const results=[];
for(const prefix of ['hot','cold']){
 const base=path.join(root,prefix),receipt=await loadJSON(path.join(base,'receipt.json'));
 for(const mode of Object.keys(receipt.reports)){
  if(mode==='retained-ordered'||mode.startsWith('fault-'))continue;
  const folder=path.join(base,mode),reportRaw=await fs.readFile(path.join(folder,'report.json')),report=JSON.parse(reportRaw),data=report.browserResult.result??report.partial;
  assert.equal(sha(reportRaw),receipt.reports[mode].reportSha256);
  assert.equal(report.gitHead,'3cbb041b43928701026b5ca2ddfb3dcf9a799c2b');
  assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
  assert.equal(report.browser.headless,false);assert.match(data.gpu,/Apple.*M4.*Metal|Metal.*M4/);
  assert.ok(!report.browser.commandLine.some(v=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu/.test(v)));
  const blobs=new Map();
  for(const blob of data.blobs){const gzip=await fs.readFile(path.join(folder,blob.path)),raw=gunzipSync(gzip);assert.equal(sha(gzip),blob.gzipSha256);assert.equal(sha(raw),blob.sha256);assert.equal(raw.length,blob.bytes);assert.ok(!blobs.has(blob.key));blobs.set(blob.key,{ref:blob,raw});}
  const body=ref=>{const b=blobs.get(ref.key);assert.ok(b);assert.equal(ref.sha256,b.ref.sha256);assert.equal(ref.bytes,b.raw.length);return b.raw;};
  const counts={runs:0,frames:0,pixels:0,primaryCalls:0,allOriginalCalls:0,restoredYields:0,nativeIndices:0,postWriterReads:0};
  const citations=[];
  for(const ref of data.runs){
   const raw=await fs.readFile(path.join(folder,ref.path));assert.equal(sha(raw),ref.sha256);assert.equal(raw.length,ref.bytes);
   const row=JSON.parse(raw),buffers=new Map(row.buffers.map(v=>[v.id,body(v.input)]));counts.runs++;
   const nativeSyncs=new Map(row.fenceObjects.map(v=>[v.id,v]));
   for(const sync of row.fenceObjects){assert.equal(sync.deleted,1);if(sync.completed){assert.ok(sync.completed.sequence>sync.createdSequence);assert.ok(sync.polls.some(p=>p.sequence===sync.completed.sequence&&[37146,37148].includes(p.actual)&&[37146,37148].includes(p.delivered)));}}
   let latestWriter=0;
   for(const e of row.events){
    if(/^(?:draw|blitFramebuffer|copyBufferSubData|bufferSubData|clearBuffer|clearDepth|clearStencil)/.test(e.name))latestWriter=e.sequence;
    if(e.name==='readPixels'&&e.cpu&&!e.synchronousReadback){const f=nativeSyncs.get(e.completion.sync);assert.ok(f);assert.ok(e.completion.sequence>f.createdSequence);assert.ok(f.createdSequence>latestWriter,`${mode}/${row.name}: readPixels fence must follow all earlier native writers`);counts.postWriterReads++;}
   }
   assert.equal(row.final.renderer.disposed,true);assert.equal(row.final.resources.disposed,true);
   for(const n of Object.values(row.final.renderer.budgets))assert.equal(n,0);
   for(const n of Object.values(row.final.resources.budgets))assert.equal(n,0);
   if(row.reflection){assert.equal(row.execution.result.ok,row.reflection==='budget-3');assert.equal(row.draws.length,0);assert.equal(row.execution.result.gpuComplete,true);continue;}
   const input=body(row.planes.find(v=>v.level===row.level).input),frames=row.frames??[];
   const first=frames[0];
   const original=first?model(row.history.slice(0,first.historyIndex+1),buffers,{format:row.format,width:row.width,height:row.height,input,prefixPasses:first.prefixPasses}):null;
   const calls=row.draws.filter(v=>v.label==='instanced-draw'),bindings=row.instanceStates.filter(v=>v.label==='instanced-draw'),states=row.orderedStates.filter(v=>v.label==='instanced-draw'&&v.name.startsWith('draw'));
   assert.equal(calls.length,bindings.length);assert.equal(calls.length,states.length);counts.primaryCalls+=calls.length;
   for(const label of new Set(row.draws.map(v=>v.label).filter(v=>v.startsWith('instanced-')||v.startsWith('ordered-boundary-'))))counts.allOriginalCalls+=row.draws.filter(v=>v.label===label).length;
   for(const frame of frames){const o=model(row.history.slice(0,frame.historyIndex+1),buffers,{format:row.format,width:row.width,height:row.height,input,prefixPasses:frame.prefixPasses});const diff=compare(o,body(frame.color),body(frame.depth),row.width,row.height,row.format);assert.deepEqual(diff,[],row.name);counts.frames++;counts.pixels+=row.width*row.height;}
   if(mode.startsWith('fault-')){
    // Faults are expected to contradict the oracle: prior comparisons are separately routed below.
    throw Error('fault folders must be interrogated separately');
   }
   if(original){
    const split=original.lowering==='triangles',activeBase=original.shaders.get(0).includes('10: I2F TEMP[0].y, SV[0].xxxx'),perInstance=2*original.primitives.length;
    for(let at=0;at<calls.length;at++){
     const instance=split?Math.floor(at/perInstance):0,call=calls[at],s=states[at],binding=bindings[at];
     assert.equal(binding.before.base,activeBase?instance:null);
     if(split){const expected=[4,3,5125,(Math.floor(at/2)%original.primitives.length)*12];if(row.failurePhase==='draw'&&at===9)expected[0]=0xffffffff;assert.deepEqual(call.args,expected);assert.equal(s.before.native.cullFace,at%2?1028:1029);assert.equal(s.before.native.cull,true);assert.deepEqual(s.before.native.stencil.faces,[0,1].map(()=>face(original.faces[at%2],original.effectiveRefs[at%2])));}
     assert.equal(s.before.native.provoking,0x8e4e);
     for(let slot=0;slot<original.activeElements.length;slot++){
      const e=original.activeElements[slot],b=original.buffers[e.buffer],native=binding.before.attributes.find(v=>v.name==='in_'+slot);assert.ok(native);
      assert.equal(native.enabled,b.stride!==0);assert.equal(native.divisor,b.stride===0?0:Math.min(e.divisor,65536));
      if(b.stride){assert.equal(native.offset,b.offset+e.sourceOffset+(split&&e.divisor?Math.floor(instance/e.divisor)*b.stride:0));assert.equal(native.stride,b.stride);assert.equal(native.integer,[196,200].includes(e.format));assert.equal(native.type,[8,123,172,173].includes(e.format)?33640:e.format===196?5125:e.format===200?5124:5126);const inputBody=row.vertexInputBodies.find(v=>v.buffer===native.buffer);assert.ok(inputBody);assert.deepEqual(body(inputBody.bytes),buffers.get(b.id));}
     }
    }
    for(const entry of row.orderedIndices.filter(v=>v.label==='instanced-draw')){const expected=Buffer.alloc(original.nativeIds.length*4);original.nativeIds.forEach((id,i)=>expected.writeUInt32LE(id,i*4));assert.deepEqual(body(entry.input),expected);if(!(row.failurePhase==='upload'&&entry===row.orderedIndices.at(-1)))assert.deepEqual(body(entry.gpu),expected);assert.equal(entry.deleted,true);assert.equal(entry.retirement.inspection.normalizationScratchBytes,0);if(calls.length)assert.ok(entry.retirement.completion.sequence>calls.at(-1).sequence);counts.nativeIndices++;}
    if(row.execution.result.ok){for(const d of row.execution.result.draws){assert.equal(d.vertexWork,d.count*Math.max(1,d.instanceCount));assert.ok(d.nativeVertexWork<=d.vertexWork*6);assert.ok(d.nativeDrawCalls<=d.vertexWork*2);}}
    assert.equal(row.restored.instance.base,activeBase?0:null);assert.deepEqual(row.restored.stencil.faces,original.faces.map((v,i)=>face(v,original.effectiveRefs[i])));assert.equal(row.restored.cullFace,1029);assert.equal(row.restored.cull,(original.raster>>>8&3)===2);
   }
   for(const point of row.yields??[]){assert.equal(point.renderer.normalizationScratchBytes,0);assert.ok(point.renderer.normalizedBytes<=65536*12);if(point.renderer.draws||row.failurePhase&&calls.length){if(point.native.instance.base!==null)assert.equal(point.native.instance.base,0);for(const a of point.native.instance.attributes)if(a.enabled&&a.divisor>0)assert.equal(a.offset,a.name==='in_1'?8:12);counts.restoredYields++;}}
   if(row.boundary?.frame){const b=row.boundary,origin=model(row.history.slice(0,b.frame.historyIndex+1),buffers,{format:row.format,width:row.width,height:row.height,input:b.input?body(b.input):input});assert.deepEqual(compare(origin,body(b.frame.color),body(b.frame.depth),row.width,row.height,row.format),[]);counts.frames++;counts.pixels+=row.width*row.height;if(b.recreated)assert.ok(b.programAfter[0].generation>b.programBefore[0].generation);if(b.replacement)assert.deepEqual(body(b.replacement.input),body(b.replacement.after));if(b.kind==='poison-instance')assert.deepEqual(body(b.poison),body(b.poisonAfter));}
   if(row.failurePhase){const expected={historical:'unsupported-stencil','native-selection':'unsupported-stencil',empty:'unsupported-draw','work-budget':'limit-exceeded'}[row.failurePhase]??(row.failurePhase.startsWith('short-')?'out-of-bounds':'backend-error');assert.equal(row.execution.result.error.code,expected);assert.equal(row.execution.result.gpuComplete,true);if(row.failurePhase.startsWith('short-')){assert.equal(calls.length,0);assert.equal(row.orderedIndices.length,0);}}
   citations.push({path:prefix+'/'+mode+'/'+ref.path,sha256:ref.sha256,name:row.name,nativeFirst:calls[0]?.sequence??null,nativeLast:calls.at(-1)?.sequence??null,frameSync:row.frames?.[0]?.completion??null,originalInstances:original?.effective??null,originalPrimitives:original?.primitives.length??null});
  }
  results.push({prefix,mode,reportSha256:sha(reportRaw),counts,citations});
  console.log(JSON.stringify({prefix,mode,counts}));
 }
}
await fs.writeFile(out,JSON.stringify({schema:'fresh-instanced-stencil-interrogation-v1',status:'passed',results,oracleSourceSha256:sha(await fs.readFile(new URL('../../../tools/virgl-instanced-stencil/oracle.mjs',import.meta.url)))},null,2)+'\n');
