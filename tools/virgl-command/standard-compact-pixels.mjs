#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './fixtures.mjs';
import {compactModel,compareCompactPixels} from './standard-compact-oracle.mjs';
const root=path.resolve(process.argv[2]),out={schema:'standard-compact-physical-audit-v1',status:'running',frames:[],faults:[],pixels:0,nativeDraws:0,normalizedBuffers:0,nanPixels:0,portableNaNPayload:false};
const word=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
function sameWords(observed,expected,values){assert.equal(observed.length,expected.length);observed.forEach((w,i)=>{
 if(Number.isNaN(values[i]))assert.ok((w&0x7f800000)===0x7f800000&&(w&0x7fffff)!==0,'NaN category only');else assert.equal(w,expected[i],'original compact word '+i);
});}
async function audit(name,fault=false){
 const directory=path.join(root,name),report=JSON.parse(await fs.readFile(path.join(directory,'report.json'))),result=fault?report.partial:report.browserResult.result,blobs=new Map(result.blobs.map(b=>[b.key,b]));
 async function raw(ref){const item=blobs.get(ref.key);assert.equal(item.sha256,ref.sha256);const packed=await fs.readFile(path.join(directory,item.path));assert.equal(sha256(packed),item.gzipSha256);const bytes=gunzipSync(packed);assert.equal(bytes.length,item.bytes);assert.equal(sha256(bytes),item.sha256);return new Uint8Array(bytes);}
 for(const frame of result.frames){
  const buffers=new Map(),native=new Map(),normalized=new Map();
  for(const row of frame.native.buffers){const bytes=await raw(row.blob);buffers.set(row.resourceId,new Uint8Array(bytes.length));native.set(row.resourceId,bytes);}
  for(const row of frame.inputs){const bytes=await raw(row.blob),dest=buffers.get(row.resource.id);assert.ok(dest);assert.equal(row.layout.rowCount,1);assert.equal(row.layout.rowBytes,bytes.length);dest.set(bytes,row.layout.offset);}
  for(const [id,bytes]of native)assert.deepEqual(bytes,buffers.get(id),'original compact upload equals native GPU storage '+id);
  const model=compactModel(frame.history,buffers,frame.range),comparison=compareCompactPixels(await raw(frame.pixels),model,frame.width,frame.height),draw=frame.history.at(-1).result.draws.at(-1),instanced=model.effective>1;
  assert.deepEqual(frame.predicted.ids,model.ids);assert.deepEqual(frame.predicted.fetches,JSON.parse(JSON.stringify(model.fetches)));assert.deepEqual(frame.predicted.points,JSON.parse(JSON.stringify(model.points)));assert.equal(frame.history.at(-1).result.gpuComplete,true);
  for(const row of frame.native.normalized){const bytes=await raw(row.blob);assert.equal(bytes.length,row.bytes);assert.deepEqual(bytes,model.normalized,'original compact private native indices');normalized.set(row.nativeBuffer,bytes);}
  assert.equal(frame.native.state.length,frame.native.calls.length);
  for(let i=0;i<frame.native.calls.length;i++){
   const call=frame.native.calls[i],state=frame.native.state[i];assert.equal(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''));assert.deepEqual(call.args,model.draw.indexed?[0,model.draw.count,{1:5121,2:5123,4:5125}[model.nativeSize],model.nativeOffset,...(instanced?[model.effective]:[])]:[0,model.draw.start,model.draw.count,...(instanced?[model.effective]:[])]);
   assert.equal(model.normalize?normalized.has(call.indexBuffer):call.indexBuffer===(model.index?frame.native.buffers.find(row=>row.resourceId===model.index.id).nativeBuffer:null),true,'original compact index binding');assert.deepEqual(state.pointSize,model.pointUniform);
   for(const fetch of model.fetches){const got=draw.vertexFetches.find(row=>row.attributeIndex===fetch.attributeIndex),a=state.attributes.find(row=>row.name==='in_'+fetch.attributeIndex);
    for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(got[key],fetch[key],frame.label+' '+key);
    assert.equal(a.enabled,!fetch.constant);assert.equal(a.divisor,fetch.nativeDivisor);assert.equal(a.integer,false);
    if(fetch.constant){
     if(fault&&report.mutation.mode==='constant-unpack'&&fetch.attributeIndex===1){assert.notDeepEqual(got.componentWords,fetch.componentWords);assert.deepEqual(got.componentWords,a.genericWords.slice(0,fetch.components));}
     else {assert.deepEqual(got.genericValues,JSON.parse(JSON.stringify(fetch.genericValues)));assert.deepEqual(a.genericValues,JSON.parse(JSON.stringify(fetch.genericValues)));sameWords(got.componentWords,fetch.componentWords,fetch.genericValues);sameWords(a.genericWords,fetch.genericValues.map(word),fetch.genericValues);}
    }else {assert.deepEqual([a.type,a.normalized,a.components,a.stride,a.offset],[fetch.nativeType,fault&&report.mutation.mode==='native-normalize'?false:fetch.normalized,fetch.components,fetch.stride,fetch.offset]);assert.equal(a.buffer,frame.native.buffers.find(row=>row.resourceId===fetch.resourceId).nativeBuffer);}
   }
  }
  assert.deepEqual([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.normalizedIndices,draw.nativeIndexSize,draw.nativeIndexOffset,draw.vertexWork],[model.min,model.max,model.valid,model.restarts,model.normalize,model.nativeSize,model.nativeOffset,model.draw.count*model.effective]);
  const row={label:frame.label,pixels:comparison.pixels,nanPixels:comparison.nanPixels,maxError:comparison.maxError,misses:comparison.misses,held:comparison.held,draws:frame.native.calls.length,normalizedBuffers:normalized.size};
  if(fault){out.faults.push(row);assert.equal(comparison.held,false);assert.ok(report.browserResult.error.message.includes(frame.label+' independent original compact pixels'));}
  else {out.frames.push(row);out.pixels+=comparison.pixels;out.nativeDraws+=row.draws;out.normalizedBuffers+=row.normalizedBuffers;out.nanPixels+=row.nanPixels;assert.equal(comparison.held,true,frame.label);}
 }
}
await audit('hardware');await audit('fault-native-normalize',true);await audit('fault-constant-unpack',true);assert.equal(out.faults.length,2);assert.ok(out.frames.length>=220);assert.ok(out.nanPixels>0);out.status='passed';await fs.writeFile(path.join(root,'physical-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({frames:out.frames.length,pixels:out.pixels,nativeDraws:out.nativeDraws,normalizedBuffers:out.normalizedBuffers,nanPixels:out.nanPixels,status:out.status}));
