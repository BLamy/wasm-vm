#!/usr/bin/env node
// Independently interrogate native records against the forecast committed before execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {model,compare} from '../../../tools/virgl-instanced-stencil/oracle.mjs';
const root=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const predictedRaw=await fs.readFile(new URL('novel-predictions.json',import.meta.url));
const predicted=JSON.parse(predictedRaw);
assert.equal(predicted.nativeEvidenceInspected,false);
const results=[];
for(const name of ['novel-0x510e527f','novel-0x9b05688c','novel-0x1f83d9ab','fault-novel-order']){
 const folder=path.join(root,name),reportRaw=await fs.readFile(path.join(folder,'report.json')),report=JSON.parse(reportRaw);
 const fault=name.startsWith('fault-'),data=report.partial??report.browserResult.result;
 assert.equal(report.gitHead,'ea48669715abe39b966627a6ed7606d901aa2263');
 assert.equal(report.status,fault?'failed':'passed');assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});
 assert.equal(report.browser.headless,false);assert.match(data.gpu,/M4/);assert.match(data.gpu,/Metal/);
 const blobs=new Map();for(const ref of data.blobs){const zipped=await fs.readFile(path.join(folder,ref.path)),raw=gunzipSync(zipped);assert.equal(sha(zipped),ref.gzipSha256);assert.equal(sha(raw),ref.sha256);assert.equal(raw.length,ref.bytes);assert.ok(!blobs.has(ref.key));blobs.set(ref.key,raw);}
 const body=ref=>{const raw=blobs.get(ref.key);assert.ok(raw);assert.equal(sha(raw),ref.sha256);assert.equal(raw.length,ref.bytes);return raw;};
 for(const ref of data.runs){
  let row=ref,runDigest=null,runPath='report.json#/partial/runs/0';
  if(ref.path){const raw=await fs.readFile(path.join(folder,ref.path));assert.equal(sha(raw),ref.sha256);assert.equal(raw.length,ref.bytes);row=JSON.parse(raw);runDigest=sha(raw);runPath=ref.path;}
  const p=predicted.predictions.find(p=>p.format===row.format&&p.seed===data.seed);assert.ok(p);assert.equal(p.preparedBeforeNativeExecution,true);
  const originalHistory=[row.history[0],row.history[1],row.history.find(v=>v.label==='instanced-draw')];
  assert.deepEqual(originalHistory.map(v=>v.hex),p.packetHex);
  const buffers=new Map(row.buffers.map(v=>[v.id,body(v.input)]));
  assert.deepEqual(row.buffers.map(v=>({id:v.id,bytes:v.input.bytes,sha256:v.input.sha256})),p.inputBodies);
  const frame=row.frames[0];assert.ok(frame);
  const original=model(originalHistory,buffers,{format:row.format,width:row.width,height:row.height,input:body(row.planes.find(v=>v.level===row.level).input)});
  assert.equal(sha(original.shaders.get(0)),p.shaderSha256);assert.equal(original.effective,p.originalInstances);
  assert.deepEqual(original.primitives,p.originalPrimitives);assert.deepEqual(original.nativeIds,p.normalizedOriginalIds);
  assert.deepEqual(original.pixel(p.sample.x,p.sample.y),p.sample.expected);
  const calls=row.draws.filter(v=>v.label==='instanced-draw'),bindings=row.instanceStates.filter(v=>v.label==='instanced-draw');
  const states=row.orderedStates.filter(v=>v.label==='instanced-draw'&&v.name==='drawElements');
  assert.equal(calls.length,p.nativeCalls);assert.equal(bindings.length,p.nativeCalls);assert.equal(states.length,p.nativeCalls);
  const instanceBases=[],positionOffsets=[],packedOffsets=[];
  for(let at=0;at<calls.length;at++){
   const instance=fault?Math.floor(at/2)%p.originalInstances:Math.floor(at/(2*p.originalPrimitives.length));
   const primitive=fault?Math.floor(at/(2*p.originalInstances)):Math.floor(at/2)%p.originalPrimitives.length;
   const b=bindings[at].before;
   assert.equal(b.base,p.originalBases[instance]);assert.deepEqual(calls[at].args,[4,3,5125,primitive*12]);
   assert.equal(states[at].before.native.cull,true);assert.equal(states[at].before.native.cullFace,at%2?1028:1029);
   assert.equal(states[at].before.native.provoking,0x8e4e);
   for(let slot=0;slot<original.activeElements.length;slot++){
    const element=original.activeElements[slot],source=original.buffers[element.buffer],native=b.attributes.find(v=>v.name==='in_'+slot);assert.ok(native);
    assert.equal(native.divisor,element.divisor);assert.equal(native.stride,source.stride);assert.equal(native.integer,false);
    assert.equal(native.offset,source.offset+element.sourceOffset+(element.divisor?Math.floor(instance/element.divisor)*source.stride:0));
    assert.equal(native.type,slot===2?33640:5126);
    const input=row.vertexInputBodies.find(v=>v.buffer===native.buffer);assert.ok(input);assert.deepEqual(body(input.bytes),buffers.get(source.id));
   }
   const position=b.attributes.find(v=>v.name==='in_1'),packed=b.attributes.find(v=>v.name==='in_2');
   assert.equal(position.offset,p.retainedDivisor3Offsets[instance]);assert.equal(packed.offset,p.packedDivisor2Offsets[instance]);
   if(at%(2*p.originalPrimitives.length)===0&&!fault){instanceBases.push(b.base);positionOffsets.push(position.offset);packedOffsets.push(packed.offset);}
  }
  if(!fault){assert.deepEqual(instanceBases,p.originalBases);assert.deepEqual(positionOffsets,p.retainedDivisor3Offsets);assert.deepEqual(packedOffsets,p.packedDivisor2Offsets);}
  assert.equal(row.execution.result.gpuComplete,true);assert.equal(row.execution.result.ok,true);
  const normalized=row.orderedIndices.filter(v=>v.label==='instanced-draw');assert.equal(normalized.length,1);
  const ids=Buffer.alloc(p.normalizedOriginalIds.length*4);p.normalizedOriginalIds.forEach((v,i)=>ids.writeUInt32LE(v,i*4));
  assert.deepEqual(body(normalized[0].input),ids);assert.deepEqual(body(normalized[0].gpu),ids);assert.equal(normalized[0].deleted,true);
  assert.ok(normalized[0].retirement.completion.sequence>calls.at(-1).sequence);
  assert.equal(row.restored.instance.base,0);assert.equal(row.restored.cull,false);assert.equal(row.restored.cullFace,1029);assert.equal(row.restored.ebo,null);
  for(const point of row.yields){assert.equal(point.renderer.normalizationScratchBytes,0);if(point.renderer.draws){assert.equal(point.native.instance.base,0);assert.equal(point.native.ebo,null);assert.equal(point.native.cull,false);assert.equal(point.native.provoking,0x8e4e);assert.deepEqual(point.native.stencil,row.restored.stencil);assert.deepEqual(point.native.instance.attributes,row.restored.instance.attributes);}}
  const fence=row.fenceObjects.find(v=>v.id===frame.completion.sync);assert.ok(fence);assert.ok(fence.createdSequence>calls.at(-1).sequence);assert.ok(frame.completion.sequence>fence.createdSequence);
  assert.ok(fence.polls.some(v=>v.sequence===frame.completion.sequence&&[37146,37148].includes(v.actual)&&[37146,37148].includes(v.delivered)));
  assert.equal(fence.deleted,1);
  const differences=compare(original,body(frame.color),body(frame.depth),row.width,row.height,row.format);
  let completedControl=null;
  if(fault){assert.ok(differences.length);assert.notEqual(row.corruption.before.sync,row.corruption.after.sync);
   const after=row.corruption.after,controlFence=row.fenceObjects.find(v=>v.id===after.sync);assert.ok(controlFence);
   assert.ok(controlFence.createdSequence>calls.at(-1).sequence);assert.ok(controlFence.createdSequence>row.corruption.before.sequence);assert.ok(after.sequence>controlFence.createdSequence);
   assert.ok(controlFence.polls.some(v=>v.sequence===after.sequence&&[37146,37148].includes(v.actual)&&[37146,37148].includes(v.delivered)));assert.equal(controlFence.deleted,1);
   assert.ok(fence.createdSequence>after.sequence);completedControl={before:row.corruption.before,createdSequence:controlFence.createdSequence,...after};
   const clean=await fs.readFile(path.join(folder,'source',report.mutation.path)),mutated=await fs.readFile(path.join(folder,'served',report.mutation.path));
   assert.equal(sha(clean),report.mutation.original.sha256);assert.equal(sha(mutated),report.mutation.delivered.sha256);assert.notEqual(sha(clean),sha(mutated));
   assert.match(mutated.toString(),/for \(let i = 0; i < nativeCount; i \+= 3\) for \(let instance = 0; instance < instances; instance\+\+\)/);
  }else assert.deepEqual(differences,[]);
  for(const state of [row.final.renderer,row.final.resources]){assert.equal(state.disposed,true);for(const amount of Object.values(state.budgets))assert.equal(amount,0);}
  results.push({name,format:row.format,seed:data.seed,reportSha256:sha(reportRaw),runPath,runSha256:runDigest,predictionSha256:sha(predictedRaw),originalShaderSha256:p.shaderSha256,
   counts:{nativeCalls:calls.length,primitives:original.primitives.length,instances:original.effective,pixels:row.width*row.height,normalizedBytes:ids.length},
   instanceBases,positionOffsets,packedOffsets,nativeWriters:{first:calls[0].sequence,last:calls.at(-1).sequence},postWriterCompletion:{createdSequence:fence.createdSequence,...frame.completion},
   originalSample:p.sample,physicalBodies:{color:frame.color.sha256,depth:frame.depth.sha256},control:fault,completedControl,differences});
 }
}
assert.equal(results.length,7);
await fs.writeFile(output,JSON.stringify({schema:'fresh-original-instanced-stencil-novel-interrogation-v1',status:'passed',predictionsPreparedBeforeNativeEvidence:true,results},null,2)+'\n');
console.log(JSON.stringify({status:'passed',positive:6,completedPhysicalControl:1,firstControlDifference:results.at(-1).differences[0]}));
