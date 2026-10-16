#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './fixtures.mjs';
import {pointModel,comparePixels} from './standard-point-oracle.mjs';
const root=path.resolve(process.argv[2]),out={schema:'standard-point-physical-audit-v1',status:'running',frames:[],faults:[],pixels:0,nativeDraws:0,normalizedBuffers:0};
async function audit(name,fault=false){
 const directory=path.join(root,name),report=JSON.parse(await fs.readFile(path.join(directory,'report.json'))),result=fault?report.partial:report.browserResult.result,blobs=new Map(result.blobs.map(b=>[b.key,b]));
 async function raw(ref){const item=blobs.get(ref.key);assert.equal(item.sha256,ref.sha256);const packed=await fs.readFile(path.join(directory,item.path));assert.equal(sha256(packed),item.gzipSha256);const bytes=gunzipSync(packed);assert.equal(bytes.length,item.bytes);assert.equal(sha256(bytes),item.sha256);return new Uint8Array(bytes);}
 for(const frame of result.frames){
  const buffers=new Map(),native=new Map(),normalized=new Map();
  for(const row of frame.native.buffers){const bytes=await raw(row.blob);buffers.set(row.resourceId,new Uint8Array(bytes.length));native.set(row.resourceId,bytes);}
  for(const row of frame.inputs){const bytes=await raw(row.blob),dest=buffers.get(row.resource.id);assert.ok(dest);assert.equal(row.layout.rowCount,1);assert.equal(row.layout.rowBytes,bytes.length);dest.set(bytes,row.layout.offset);}
  for(const [id,bytes]of native)assert.deepEqual(bytes,buffers.get(id),'original point upload equals native GPU storage '+id);
  const model=pointModel(frame.history,buffers,frame.range),comparison=comparePixels(await raw(frame.pixels),model,frame.width,frame.height),draw=frame.history.at(-1).result.draws.at(-1),instanced=model.effective>1;
  assert.deepEqual(frame.range,result.range);assert.deepEqual(frame.predicted.ids,model.ids);assert.deepEqual(frame.predicted.fetches,model.fetches);assert.deepEqual(frame.predicted.points,model.points);assert.equal(frame.history.at(-1).result.gpuComplete,true);
  for(const row of frame.native.normalized){const bytes=await raw(row.blob);assert.equal(bytes.length,row.bytes);assert.deepEqual(bytes,model.normalized,'original predicted normalized point bytes');normalized.set(row.nativeBuffer,bytes);}
  for(const call of frame.native.calls){assert.equal(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''));assert.deepEqual(call.args,model.draw.indexed?[0,model.draw.count,{1:5121,2:5123,4:5125}[model.nativeSize],model.nativeOffset,...(instanced?[model.effective]:[])]:[0,model.draw.start,model.draw.count,...(instanced?[model.effective]:[])]);
   assert.equal(model.normalize?normalized.has(call.indexBuffer):call.indexBuffer===(model.index?frame.native.buffers.find(row=>row.resourceId===model.index.id).nativeBuffer:null),true,'original/owned point index binding');
   for(const f of model.fetches){const observed=draw.vertexFetches.find(row=>row.attributeIndex===f.attributeIndex),a=call.attributes.find(row=>row.name==='in_'+f.attributeIndex);
    for(const key of ['resourceId','stride','offset','components','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(observed[key],f[key],frame.label+' '+key);
    assert.equal(a.enabled,!f.constant);assert.equal(a.divisor,f.nativeDivisor);if(f.constant){assert.deepEqual(observed.componentWords,f.componentWords);assert.deepEqual(observed.genericValues,f.genericValues);assert.deepEqual(a.genericValues,f.genericValues);}else{assert.deepEqual([a.stride,a.offset,a.components],[f.stride,f.offset,f.components]);assert.equal(a.buffer,frame.native.buffers.find(row=>row.resourceId===f.resourceId).nativeBuffer);}
   }
  }
  assert.deepEqual([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.normalizedIndices,draw.nativeIndexSize,draw.nativeIndexOffset,draw.vertexWork],
   [model.min,model.max,model.valid,model.restarts,model.normalize,model.nativeSize,model.nativeOffset,model.draw.count*model.effective]);
  assert.equal(frame.native.state.length,frame.native.calls.length);for(const state of frame.native.state){assert.deepEqual(state.pointSize,fault&&report.mutation.mode==='size-selection'?[1,0]:model.pointUniform);if(state.pointCoordY!==null)assert.equal(state.pointCoordY,fault&&report.mutation.mode==='coord-y'?-model.winsysY:model.winsysY);}
  const row={label:frame.label,pixels:comparison.pixels,maxError:comparison.maxError,misses:comparison.misses,held:comparison.held,failedJob:Boolean(frame.failedJob),draws:frame.native.calls.length,normalizedBuffers:normalized.size};
  if(fault){out.faults.push(row);assert.equal(comparison.held,false);assert.ok(report.browserResult.error.message.includes(frame.label+' independent strict point-square pixels'));}
  else{out.frames.push(row);out.pixels+=comparison.pixels;out.nativeDraws+=row.draws;out.normalizedBuffers+=row.normalizedBuffers;assert.equal(comparison.held,true,frame.label);}
 }
}
await audit('hardware');await audit('fault-size-selection',true);await audit('fault-coord-y',true);assert.equal(out.faults.length,2);assert.ok(out.frames.length>=120);out.status='passed';await fs.writeFile(path.join(root,'physical-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({frames:out.frames.length,pixels:out.pixels,nativeDraws:out.nativeDraws,normalizedBuffers:out.normalizedBuffers,status:out.status}));
