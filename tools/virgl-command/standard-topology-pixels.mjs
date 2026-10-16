#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './fixtures.mjs';
import {topologyModel,comparePixels} from './standard-topology-oracle.mjs';
const root=path.resolve(process.argv[2]),out={schema:'standard-topology-physical-audit-v1',status:'running',frames:[],faults:[],pixels:0};
async function audit(name,fault=false){
  const directory=path.join(root,name),report=JSON.parse(await fs.readFile(path.join(directory,'report.json'))),result=fault?report.partial:report.browserResult.result,
    blobs=new Map(result.blobs.map(b=>[b.key,b]));
  async function raw(ref){const item=blobs.get(ref.key);assert.equal(item.sha256,ref.sha256);const packed=await fs.readFile(path.join(directory,item.path));
    assert.equal(sha256(packed),item.gzipSha256);const bytes=gunzipSync(packed);assert.equal(bytes.length,item.bytes);assert.equal(sha256(bytes),item.sha256);return new Uint8Array(bytes);}
  for(const frame of result.frames){
    const buffers=new Map(),native=new Map();
    for(const row of frame.native.buffers){const bytes=await raw(row.blob);buffers.set(row.resourceId,new Uint8Array(bytes.length));native.set(row.resourceId,bytes);}
    for(const row of frame.inputs){const dest=buffers.get(row.resource.id),bytes=await raw(row.blob);assert.ok(dest);assert.equal(row.layout.rowCount,1);assert.equal(row.layout.rowBytes,bytes.length);dest.set(bytes,row.layout.offset);}
    for(const [id,bytes]of native)assert.deepEqual(bytes,buffers.get(id),'original uploads equal physical GPU storage '+id);
    const model=topologyModel(frame.history,buffers,frame.used),comparison=comparePixels(await raw(frame.pixels),model,frame.width,frame.height),
      draw=frame.history.at(-1).result.draws.at(-1),call=frame.native.calls.at(-1),instanced=model.effective>1;
    assert.deepEqual(frame.predicted.ids,model.ids);assert.deepEqual(frame.predicted.fetches,model.fetches);assert.equal(frame.history.at(-1).result.gpuComplete,true);
    assert.equal(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''));
    const mode=fault?3:model.draw.mode;
    assert.deepEqual(call.args,model.draw.indexed?[mode,model.draw.count,{1:5121,2:5123,4:5125}[model.index.size],model.index.offset,...(instanced?[model.effective]:[])]:
      [mode,model.draw.start,model.draw.count,...(instanced?[model.effective]:[])]);
    assert.equal(draw.vertexWork,model.draw.count*model.effective);assert.equal(draw.actualMinIndex,model.min);assert.equal(draw.actualMaxIndex,model.max);
    for(const f of model.fetches){const observed=draw.vertexFetches.find(row=>row.attributeIndex===f.attributeIndex),a=call.attributes.find(row=>row.name==='in_'+f.attributeIndex);
      for(const key of ['resourceId','stride','offset','components','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])assert.equal(observed[key],f[key],frame.label+' '+key);
      assert.equal(a.enabled,!f.constant);assert.equal(a.divisor,f.nativeDivisor);
      if(f.constant){assert.deepEqual(observed.componentWords,f.componentWords);assert.deepEqual(observed.genericValues,f.genericValues);assert.deepEqual(a.genericValues,f.genericValues);}
      else{assert.deepEqual([a.stride,a.offset,a.components],[f.stride,f.offset,f.components]);assert.equal(a.buffer,frame.native.buffers.find(row=>row.resourceId===f.resourceId).nativeBuffer);}
    }
    const row={label:frame.label,pixels:comparison.pixels,maxError:comparison.maxError,misses:comparison.misses,held:comparison.held};
    if(fault){out.faults.push(row);assert.equal(comparison.held,false);assert.ok(report.browserResult.error.message.includes(frame.label+' independent topology pixel oracle'));}
    else{out.frames.push(row);out.pixels+=comparison.pixels;assert.equal(comparison.held,true,frame.label);}
  }
}
await audit('hardware');await audit('fault-mode',true);
assert.equal(out.frames.length,87);assert.equal(out.pixels,50176);assert.equal(out.faults.length,1);
out.status='passed';await fs.writeFile(path.join(root,'physical-audit.json'),JSON.stringify(out,null,2)+'\n');
console.log('Independent original-byte/core-primitive oracle passed 87 frames/50176 pixels and rejected actual mode corruption');
