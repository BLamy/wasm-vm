#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './fixtures.mjs';
import {restartModel,comparePixels} from './standard-restart-oracle.mjs';
const root=path.resolve(process.argv[2]),out={schema:'standard-restart-physical-audit-v1',status:'running',frames:[],faults:[],pixels:0,nativeDraws:0,normalizedBuffers:0};
async function audit(name,fault=false){
 const directory=path.join(root,name),report=JSON.parse(await fs.readFile(path.join(directory,'report.json'))),result=fault?report.partial:report.browserResult.result,blobs=new Map(result.blobs.map(b=>[b.key,b]));
 async function raw(ref){const item=blobs.get(ref.key);assert.equal(item.sha256,ref.sha256);const packed=await fs.readFile(path.join(directory,item.path));assert.equal(sha256(packed),item.gzipSha256);const bytes=gunzipSync(packed);assert.equal(bytes.length,item.bytes);assert.equal(sha256(bytes),item.sha256);return new Uint8Array(bytes);}
 for(const frame of result.frames){
  const buffers=new Map(),native=new Map(),normalized=new Map();
  for(const row of frame.native.buffers){const bytes=await raw(row.blob);buffers.set(row.resourceId,new Uint8Array(bytes.length));native.set(row.resourceId,bytes);}
  for(const row of frame.inputs){const dest=buffers.get(row.resource.id),bytes=await raw(row.blob);assert.ok(dest);assert.equal(row.layout.rowCount,1);assert.equal(row.layout.rowBytes,bytes.length);dest.set(bytes,row.layout.offset);}
  for(const [id,bytes]of native)assert.deepEqual(bytes,buffers.get(id),'original upload equals GPU storage '+id);
  const model=restartModel(frame.history,buffers),comparison=comparePixels(await raw(frame.pixels),model,frame.width,frame.height),draw=frame.history.at(-1).result.draws.at(-1),instanced=model.effective>1;
  assert.deepEqual(frame.predicted.ids,model.ids);assert.deepEqual(frame.predicted.fetches,model.fetches);assert.equal(frame.history.at(-1).result.gpuComplete,true);
  for(const row of frame.native.normalized){const bytes=await raw(row.blob);assert.equal(bytes.length,row.bytes);assert.equal(bytes.length,model.normalized.length);
   if(fault){const wrong=new Uint8Array(model.draw.count*4),v=new DataView(wrong.buffer);model.ids.forEach((id,i)=>v.setUint32(4*i,id,true));assert.deepEqual(bytes,wrong,'actual mapping sabotage preserves markers as vertices');}
   else assert.deepEqual(bytes,model.normalized,'independent normalized GPU bytes');normalized.set(row.nativeBuffer,bytes);}
  for(const call of frame.native.calls){assert.equal(call.name,'drawElements'+(instanced?'Instanced':''));assert.deepEqual(call.args,[model.draw.mode,model.draw.count,{1:5121,2:5123,4:5125}[model.nativeSize],model.nativeOffset,...(instanced?[model.effective]:[])]);
   assert.equal(model.normalize?normalized.has(call.indexBuffer):call.indexBuffer===frame.native.buffers.find(row=>row.resourceId===22).nativeBuffer,true,'actual original/owned native index binding');
   for(const f of model.fetches){const observed=draw.vertexFetches.find(row=>row.attributeIndex===f.attributeIndex),a=call.attributes.find(row=>row.name==='in_'+f.attributeIndex);
    for(const key of ['resourceId','stride','offset','components','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(observed[key],f[key],frame.label+' '+key);
    assert.equal(a.enabled,!f.constant);assert.equal(a.divisor,f.nativeDivisor);
    if(f.constant){assert.deepEqual(observed.componentWords,f.componentWords);assert.deepEqual(observed.genericValues,f.genericValues);assert.deepEqual(a.genericValues,f.genericValues);}
    else{assert.deepEqual([a.stride,a.offset,a.components],[f.stride,f.offset,f.components]);assert.equal(a.buffer,frame.native.buffers.find(row=>row.resourceId===f.resourceId).nativeBuffer);}
   }
  }
  assert.deepEqual([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.normalizedIndices,draw.nativeIndexSize,draw.nativeIndexOffset,draw.vertexWork],
   [model.min,model.max,model.valid,model.restarts,model.normalize,model.nativeSize,model.nativeOffset,model.draw.count*model.effective]);
  const row={label:frame.label,pixels:comparison.pixels,maxError:comparison.maxError,misses:comparison.misses,held:comparison.held,failedJob:Boolean(frame.failedJob),draws:frame.native.calls.length,normalizedBuffers:normalized.size};
  if(fault){out.faults.push(row);assert.equal(comparison.held,false);assert.ok(report.browserResult.error.message.includes(frame.label+' independent restart pixel oracle'));}
  else{out.frames.push(row);out.pixels+=comparison.pixels;out.nativeDraws+=row.draws;out.normalizedBuffers+=row.normalizedBuffers;assert.equal(comparison.held,true,frame.label);}
 }
}
await audit('hardware');await audit('fault-restart',true);assert.equal(out.faults.length,1);assert.ok(out.frames.length>180);out.status='passed';await fs.writeFile(path.join(root,'physical-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({frames:out.frames.length,pixels:out.pixels,nativeDraws:out.nativeDraws,normalizedBuffers:out.normalizedBuffers,status:out.status}));
