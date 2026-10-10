#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { drawModel,comparePixels } from "./standard-draw-oracle.mjs";
const root=path.resolve(process.argv[2]),sha=b=>createHash("sha256").update(b).digest("hex");
const audit={schema:1,task:"E6-T11d6",status:"running",frames:[],faults:[],pixels:0};
for(const name of ["hardware","fault-divisor"]){
  const dir=path.join(root,name),report=JSON.parse(await fs.readFile(path.join(dir,"report.json")));
  const data=name==="hardware"?report.browserResult.result:report.partial,blobs=new Map();
  for(const b of data.blobs){
    const packed=await fs.readFile(path.join(dir,b.path)),raw=gunzipSync(packed);
    assert.equal(sha(packed),b.gzipSha256);assert.equal(raw.length,b.bytes);assert.equal(sha(raw),b.sha256);
    blobs.set(b.key,raw);
  }
  for(const frame of data.frames){
    const buffers=new Map(frame.inputs.map(({resource,blob})=>[resource.id,blobs.get(blob.key)]));
    const model=drawModel(frame.history,buffers,frame.used),raw=blobs.get(frame.pixels.key);
    assert.equal(raw.length,frame.width*frame.height*4);
    const prediction=comparePixels(raw,model,frame.width,frame.height);
    const row={label:frame.label,...prediction};
    if(name==="hardware"){
      assert.ok(row.held,JSON.stringify(row));audit.frames.push(row);audit.pixels+=row.pixels;
      assert.deepEqual(model.ids,frame.predicted.ids);
      assert.deepEqual(model.fetches,frame.predicted.fetches);
      const last=frame.history.at(-1).result.draws.at(-1),native=frame.native.calls.at(-1);
      assert.equal(last.vertexWork,model.draw.count*model.effective);
      assert.equal(last.actualMaxIndex,model.max);assert.equal(last.actualMinIndex,model.min);
      assert.equal(last.indexByteLength,model.draw.indexed?model.draw.count*model.index.size:0);
      const inst=model.effective>1,mode=model.draw.mode===4?4:5;
      assert.equal(native.name,(model.draw.indexed?"drawElements":"drawArrays")+(inst?"Instanced":""));
      assert.deepEqual(native.args,model.draw.indexed?[mode,model.draw.count,{1:5121,2:5123,4:5125}[model.index.size],model.index.offset,...(inst?[model.effective]:[])]:
        [mode,model.draw.start,model.draw.count,...(inst?[model.effective]:[])]);
      for(const fetch of model.fetches){
        const b=frame.native.buffers.find(b=>b.name==="in_"+fetch.attributeIndex);
        assert.equal(b.divisor,Math.min(fetch.divisor,65536));assert.equal(b.enabled,true);
        assert.equal(b.stride,fetch.stride);assert.equal(b.offset,fetch.offset);assert.equal(b.components,fetch.components);
        assert.deepEqual(blobs.get(b.blob.key),buffers.get(fetch.resourceId),"actual native bytes match original owned upload");
        const recorded=last.vertexFetches.find(f=>f.attributeIndex===fetch.attributeIndex);
        for(const key of ["divisor","firstByte","requiredEnd","firstElement","lastElement"])
          assert.equal(recorded[key],fetch[key]);
        assert.equal(recorded.nativeDivisor,Math.min(fetch.divisor,65536));
        assert.ok(fetch.requiredEnd<=fetch.byteLength);
      }
      if(model.index){assert.deepEqual(blobs.get(frame.native.index.blob.key),buffers.get(model.index.id));assert.equal(last.indexSize,model.index.size);}
    }else{
      audit.faults.push(row);
      if(!row.held){
        assert.equal(frame.label,"mixed-wide-0");assert.equal(frame.native.calls.length,1);
        assert.equal(frame.native.calls[0].name,"drawElementsInstanced");
        assert.equal(frame.native.buffers.find(b=>b.name==="in_1").divisor,1);
      }
    }
  }
}
assert.equal(audit.frames.length,37);
assert.deepEqual(audit.faults.filter(r=>!r.held).map(r=>r.label),["mixed-wide-0"]);
audit.status="passed";
await fs.writeFile(path.join(root,"physical-audit.json"),JSON.stringify(audit,null,2)+"\n");
console.log("Independent literal packet/native-byte/pixel audit passed: "+audit.frames.length+" frames, "+audit.pixels+" pixels; divisor corruption caught.");
