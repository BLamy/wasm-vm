import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {criticModel,criticCompare,criticPackets,criticFormat} from '../../../tools/virgl-command/standard-compact-adversarial-oracle.mjs';
const here=path.dirname(new URL(import.meta.url).pathname),hash=b=>createHash('sha256').update(b).digest('hex'),out={schema:'standard-compact-critic-physical-audit-v1',frames:[],faults:[],pixels:0,nanPixels:0,normalizedBuffers:0,suspensions:[],ownership:[],rejections:[],status:'running'};
const equal=(a,b,label)=>assert.deepEqual(a,b,label),bytesHex=b=>Buffer.from(b).toString('hex');
const isNaNWord=w=>(w&0x7f800000)===0x7f800000&&(w&0x7fffff)!==0;
function words(actual,expected,nan,label){equal(actual.length,expected.length,label+' count');actual.forEach((w,i)=>{if(nan[i])assert.ok(isNaNWord(w),label+' NaN category');else equal(w,expected[i],label+' lane'+i);});}
for(const prefix of ['hot','cold']){
 const root=path.join(here,'unpacked',prefix),wire=JSON.parse(await fs.readFile(path.join(root,'wire/report.json')));
 for(const r of wire.wire.records){const raw=Buffer.from(r.hex,'hex'),p=Array.from({length:raw.length/4},(_,i)=>raw.readUInt32LE(i*4)),format=p[5];equal(p[0],0x00050501,'original element packet header');
  let spec;try{spec=criticFormat(format);}catch{}const expected=Boolean(spec)&&p[2]<=0xffffffff-spec.bytes*spec.components,legacy=Boolean(spec)&&format>=28&&format<=31&&p[3]===0&&p[2]%4===0&&expected;
  equal(r.standard.ok,expected,'literal standard admission');if(r.legacy)equal(r.legacy.ok,legacy,'literal legacy admission');}
 for(const name of ['hardware','fault-native-normalize','fault-constant-unpack']){
  const directory=path.join(root,name),reportPath=path.join(directory,'report.json'),report=JSON.parse(await fs.readFile(reportPath)),result=report.partial??report.browserResult.result,fault=name!=='hardware';
  const blobs=new Map(result.blobs.map(b=>[b.key,b]));
  async function raw(ref){const b=blobs.get(ref.key),packed=await fs.readFile(path.join(directory,b.path)),data=new Uint8Array(gunzipSync(packed));equal(hash(packed),b.gzipSha256);equal(hash(data),b.sha256);equal(ref.sha256,b.sha256);equal(data.length,b.bytes);return data;}
  for(const [ordinal,frame]of result.frames.entries()){
   const native=new Map(),buffers=new Map();
   for(const row of frame.native.buffers){native.set(row.resourceId,await raw(row.blob));buffers.set(row.resourceId,new Uint8Array(row.blob.bytes));}
   // Original uploads are authoritative. Rebuild them in transfer order, and
   // link each owned exchange to the corresponding original wire box.
   const allUpload=frame.history.flatMap(record=>{const v=Buffer.from(record.hex,'hex'),a=[];for(let at=0;at<v.length;){const h=v.readUInt32LE(at),n=h>>>16;if((h&255)===43){const w=Array.from({length:n},(_,i)=>v.readUInt32LE(at+4+4*i));a.push({id:w[0],offset:w[5],width:w[8],direction:w[12]});}at+=4*(n+1);}return a;});
   equal(allUpload.length,frame.inputs.length,'one original packet per owned upload');
   for(const [i,input]of frame.inputs.entries()){const data=await raw(input.blob),command=allUpload[i];equal([input.resource.id,input.layout.offset,input.layout.rowBytes,input.layout.rowCount,input.direction],[command.id,command.offset,command.width,1,'upload']);equal(data.length,command.width);buffers.get(command.id).set(data,command.offset);}
   for(const [id,b]of buffers)equal(native.get(id),b,'original full native source '+id);
   const model=criticModel(frame.history,buffers,frame.range),draw=frame.history.at(-1).result.draws.at(-1),instanced=model.draw.instances>1;
   equal(frame.history.at(-1).result.gpuComplete,true,'actual final fence');equal(frame.native.calls.length,1,'one native draw');
   const call=frame.native.calls[0],state=frame.native.state[0];
   equal(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''));
   equal(call.args,model.draw.indexed?[0,model.draw.count,{1:5121,2:5123,4:5125}[model.nativeSize],model.nativeOffset,...(instanced?[model.draw.instances]:[])]:[0,model.draw.start,model.draw.count,...(instanced?[model.draw.instances]:[])]);
   equal(state.pointSize,model.pointUniform);
   equal([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.nativeIndexSize,draw.nativeIndexOffset,draw.normalizedIndices,draw.vertexWork],[model.min,model.max,model.valid,model.restarts,model.nativeSize,model.nativeOffset,model.normalize,model.draw.count*model.draw.instances]);
   for(const n of frame.native.normalized){equal(await raw(n.blob),model.normalized,'private restart indices');equal(call.indexBuffer,n.nativeBuffer);out.normalizedBuffers++;}
   if(!model.normalize)equal(call.indexBuffer,model.draw.indexed?frame.native.buffers.find(b=>b.resourceId===model.state.index.id).nativeBuffer:null);
   const run=result.runs.find(r=>r.calls.some(c=>c.label===frame.label));
   for(const fetch of model.fetches){const actual=draw.vertexFetches.find(f=>f.attributeIndex===fetch.attributeIndex),a=state.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),source=frame.native.buffers.find(b=>b.resourceId===fetch.resourceId);
    const fields=['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'];for(const field of fields)equal(actual[field],fetch[field],frame.label+' '+field);
    equal(actual.resourceGeneration,source.generation,'original generation');equal(source.generation,frame.inputs.findLast(i=>i.resource.id===fetch.resourceId).resource.generation,'retained original uploaded generation');equal([a.enabled,a.integer,a.divisor],[!fetch.constant,false,fetch.nativeDivisor]);
    if(fetch.constant){
     const faulty=fault&&name==='fault-constant-unpack'&&fetch.attributeIndex===1;
     if(faulty)assert.notDeepEqual(actual.componentWords,fetch.componentWords);else {words(actual.componentWords,fetch.componentWords,fetch.nan,'reported supplied compact');const temp=new Uint32Array(new Float32Array(fetch.genericValues).buffer);words(a.genericWords,[...temp],fetch.nan,'physical native generic');}
     if(run){const sourceBytes=buffers.get(fetch.resourceId).subarray(fetch.offset,fetch.offset+fetch.elementBytes),events=run.events.filter(e=>e.label===frame.label);assert.ok(events.some(e=>e.name==='getBufferSubData'&&e.bytes===fetch.elementBytes&&e.hex===bytesHex(sourceBytes)),'retained scalar source bytes');assert.ok(events.some(e=>e.name==='copyBufferSubData'&&e.source===source.nativeBuffer&&e.args[2]===fetch.offset&&e.args[4]===fetch.elementBytes),'retained original scalar source pointer');}
    }else equal([a.buffer,a.type,a.normalized,a.components,a.stride,a.offset],[source.nativeBuffer,fetch.nativeType,fault&&name==='fault-native-normalize'?false:fetch.normalized,fetch.components,fetch.stride,fetch.offset]);
   }
   const pixels=await raw(frame.pixels),comparison=criticCompare(pixels,model,frame.width,frame.height),row={prefix,name,ordinal,label:frame.label,reportSha256:hash(await fs.readFile(reportPath)),pixelsSha256:hash(pixels),nativeSources:frame.native.buffers.map(b=>({id:b.resourceId,generation:b.generation,sha256:b.blob.sha256})),fetches:model.fetches,...comparison};
   equal(comparison.held,!fault,frame.label+' independent original TGSI pixels');
   if(fault){out.faults.push(row);assert.ok(report.browserResult.error.message.includes('independent original compact pixels'));}
   else {out.frames.push(row);out.pixels+=comparison.pixels;out.nanPixels+=comparison.nanPixels;}
  }
  if(fault)continue;
  for(const run of result.runs){for(const k of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])equal(run.inspection.jobs[k],0,'released '+k);
   const owned=new Map();for(const e of run.events){if(e.name==='fenceSync'){assert.ok(!owned.has(e.sync));owned.set(e.sync,{created:e.turn,last:-1});}if(e.name==='clientWaitSync'){const f=owned.get(e.sync);assert.ok(f&&e.turn>f.created&&e.turn>f.last);assert.ok([37146,37148,37147].includes(e.delivered));f.last=e.turn;}if(e.name==='deleteSync'){assert.ok(owned.has(e.sync));owned.delete(e.sync);}}equal(owned.size,0,'entire retained sync batch retired');}
  for(const s of result.suspensions){equal(s.point.inspection.jobs.status,s.phase);const ok=s.action==='reuse';equal(s.record.result.ok,ok);equal(s.record.result.gpuComplete,true);if(!ok)equal(s.record.result.draws,[]);else {const old=s.point.inspection.contexts[0].subContexts[0].vertexBuffers?.[1];assert.ok(s.record.result.draws[0].vertexFetches.some(f=>f.attributeIndex===1));}out.suspensions.push({prefix,phase:s.phase,action:s.action,result:s.record.result,reportSha256:hash(await fs.readFile(reportPath))});}
  for(const o of result.ownership){equal(o.phase,'waiting-attributes');equal(o.after.reads,0);equal(o.after.stagingBytes,0);out.ownership.push({prefix,before:o.before.jobs,after:o.after});}
  for(const r of result.rejections){equal(r.record.result.ok,false);const run=result.runs.find(x=>x.history.some(h=>h.label===r.record.label));equal(run.calls.length,0,'bounds reject before GPU draw');
   const buffers=new Map();for(const i of run.exchanges){const original=await raw(i.blob),end=i.layout.offset+original.length,prior=buffers.get(i.resource.id)??new Uint8Array(0);if(end>prior.length){const next=new Uint8Array(end);next.set(prior);buffers.set(i.resource.id,next);}buffers.get(i.resource.id).set(original,i.layout.offset);}
   let prediction;try{const model=criticModel(run.history,buffers,result.range);const staging=model.fetches.filter(f=>f.constant).reduce((n,f)=>n+f.elementBytes,model.draw.indexed?model.draw.count*model.state.index.bytes:0);assert.ok(staging>run.inspection.jobLimits.transferBytes);prediction={reason:'aggregate retained staging exceeds limit',staging,limit:run.inspection.jobLimits.transferBytes};}catch(error){if(error.code==='ERR_ASSERTION')throw error;prediction={reason:error.message};}
   assert.ok(prediction);out.rejections.push({prefix,label:r.record.label,prediction,error:r.record.result.error,sha256:hash(Buffer.from(r.record.hex,'hex'))});}
 }
}
equal(out.frames.length,450);equal(out.pixels,120320);equal(out.nanPixels,384);equal(out.normalizedBuffers,10);equal(out.faults.length,4);out.status='passed';await fs.writeFile(path.join(here,'physical-audit.json'),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({status:out.status,frames:out.frames.length,pixels:out.pixels,nanPixels:out.nanPixels,normalizedBuffers:out.normalizedBuffers,faults:out.faults.length}));
