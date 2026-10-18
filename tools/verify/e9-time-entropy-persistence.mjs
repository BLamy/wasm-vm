// Real production loader/worker storage paths; the UI owns a small deterministic guest fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function prepareSourceCapture(page,worker){
 return page.evaluate(async worker=>{
  const {checkpointHash}=await import('./session-checkpoints.js');
  const {startLinuxBoot}=await import('./loader.js'),{startLinuxBootWorker}=await import('./linux-worker-host.js');
  const program=new Uint8Array(await(await fetch('./assets/e9-time-entropy.bin')).arrayBuffer());
  const kernel=new Uint8Array(program.length+12);kernel.set(program.subarray(0,program.length-4));
  const v=new DataView(kernel.buffer);for(const[i,word]of [0x001002b7,0x00005337,0x55530313,0x0062a023].entries())v.setUint32(program.length-4+i*4,word,true);
  const urls=[],blob=(bytes,type)=>{const url=URL.createObjectURL(new Blob([bytes],{type}));urls.push(url);return url;};
  const kernelUrl=blob(kernel,'application/octet-stream');
  const manifestUrl=blob(JSON.stringify({artifacts:{kernel:{url:kernelUrl,sha256:checkpointHash(kernel),size:kernel.length}}}),'application/json');
  const zero=checkpointHash(new Uint8Array(4096)),imageManifestUrl=blob(JSON.stringify({version:1,image_len:8192,chunk_size:4096,layout:'split',chunks:[zero,zero]}),'application/json');
  const result={worker,errors:[],output:[],kernel:[...kernel],kernelSha256:checkpointHash(kernel)};
  const controller=await(worker?startLinuxBootWorker:startLinuxBoot)({manifestUrl,mode:'chunked',imageManifestUrl,baseUrl:new URL('./',location.href).href,bootProfileUrl:null,persist:false,bootSnapshot:false,ramMib:16,bootargs:'console=ttyS0',guestClock:'icount',icountDivider:5,slirpNet:false,slirpProvider:'offline',enableMic:false,quantum:100000,startPaused:true,jit:false,onOutput:bytes=>result.output.push(...bytes),onError:error=>result.errors.push(String(error))});
  const library=globalThis.__sessionLibrary,previous=library.adapter.current;
  library.adapter.current=()=>({controller,profile:'rv64-linux-software-v1',ready:true});library.render();
  globalThis.__sourceCapture={controller,library,previous,urls,result};return{worker,backend:controller.backend??'direct',kernelSha256:result.kernelSha256};
 },worker);
}
export async function finishSourceCapture(page){
 return page.evaluate(async()=>{
  const s=globalThis.__sourceCapture,id=s.library.inputRecording.id;
  await s.controller.resume();const done=await s.controller.whenDone;
  const position=s.result.worker?null:await s.controller.inputPosition();return{...s.result,id,done,position};
 });
}
export async function closeSourceCapture(page){
 await page.evaluate(async()=>{const s=globalThis.__sourceCapture;if(!s)return;
  try{const{stopLinuxController}=await import('./linux-worker-host.js');await stopLinuxController(s.controller);}
  finally{s.library.adapter.current=s.previous;s.library.inputRecording=null;s.library.active=null;s.library.render();for(const url of s.urls)URL.revokeObjectURL(url);delete globalThis.__sourceCapture;}
 });
}
export async function inspectSourcePrefix(page,id,output,label){
 const packet=await page.evaluate(async id=>{
  const{SessionStore}=await import('./session-store.js'),{SessionInputJournal}=await import('./session-inputs.js'),{readCheckpointObject}=await import('./session-checkpoints.js'),{sessionEventReferences}=await import('./session-pkg/wasm_vm_session.js');
  const store=await SessionStore.open();try{
   const opened=await store.openSession(id),value=await SessionInputJournal.read(store,id),manifest=value.manifest,refs=new Map();
   for(const index of manifest.events){refs.set(index.content.sha256,index.content);const bytes=await readCheckpointObject(store,index.content,4194304);for(const ref of JSON.parse(new TextDecoder().decode(sessionEventReferences(opened.manifest,bytes))))refs.set(ref.sha256,ref);}
   for(const ref of [manifest.checkpoints[0].machine,...manifest.assets.filter(a=>a.role==='vm').map(a=>a.content)])refs.set(ref.sha256,ref);
   const files=[];for(const ref of refs.values()){
    const bytes=await readCheckpointObject(store,ref,302*1048576+28),gzip=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    let encoded='';for(let i=0;i<gzip.length;i+=32766)encoded+=btoa(String.fromCharCode(...gzip.subarray(i,i+32766)));files.push({ref,gzip:encoded});
   }
   const writer=await store.writer(id);await writer.release();
   return{revision:opened.revision,manifest,manifestBytes:[...opened.manifest],receipts:value.receipts.map(r=>({...r,bytes:[...r.bytes]})),files};
  }finally{await store.close();}
 },id);
 await fs.mkdir(path.join(output,label));await fs.writeFile(path.join(output,label,'manifest.json'),Uint8Array.from(packet.manifestBytes));
 for(const file of packet.files)await fs.writeFile(path.join(output,label,file.ref.sha256+'.gz'),Buffer.from(file.gzip,'base64'));
 const result={...packet,files:packet.files.map(f=>f.ref)};delete result.manifestBytes;
 await fs.writeFile(path.join(output,label,'prefix.json'),JSON.stringify(result,null,2)+'\n');
 assert.equal(result.manifest.policy.mode,'capture-prefix');assert.ok(result.manifest.policy.required_inputs.includes('entropy'));
 let sequence=0n;for(const r of result.receipts){assert.equal(BigInt(r.sequence),++sequence);assert.equal(r.phase,r.channel>=17?'observe':'before');}
 assert.equal(sequence,BigInt(result.manifest.end.sequence));return result;
}
export async function realCryptoFailure(page,output){
 const proof=await page.evaluate(async()=>{
  const{SessionSourceProbe}=await import('./pkg/wasm_vm_wasm.js');const descriptor=Object.getOwnPropertyDescriptor(crypto,'getRandomValues');
  const failed=new SessionSourceProbe(5,undefined,0);let error,rows=[];
  try{
   Object.defineProperty(crypto,'getRandomValues',{configurable:true,value(){throw new DOMException('E9 injected CSPRNG outage','OperationError');}});
   failed.control(1);rows.push(...failed.takeDeliveries());
   try{for(let n=0;n<32;n++){failed.runUntil('133',7);rows.push(...failed.takeDeliveries());}}catch(e){error=e;rows.push(...failed.takeDeliveries());}
  }finally{if(descriptor)Object.defineProperty(crypto,'getRandomValues',descriptor);else delete crypto.getRandomValues;}
  const tape=failed.observationTape(),recordHostReads=failed.hostReads(),replay=new SessionSourceProbe(5,tape,3);let replayError,replayed=[];
  try{
   const r=rows[0];replay.applyRecordedLifecycle(r.bytes[0],r.transition,r.sequence,r.ordinal,r.retired);replayed.push(...replay.takeDeliveries());
   try{for(let n=0;n<32;n++){replay.runUntil('133',31);replayed.push(...replay.takeDeliveries());}}catch(e){replayError=e;replayed.push(...replay.takeDeliveries());}
   const own=r=>({...r,bytes:[...r.bytes]});return{code:error?.code,point:error?.position,replayCode:replayError?.code,replayPoint:replayError?.position,recordHostReads,replayHostReads:replay.hostReads(),tape:[...tape],receipts:rows.map(own),replayed:replayed.map(own)};
  }finally{replay.free();failed.free();}
 });
 assert.equal(proof.code,'ProviderUnavailable');assert.equal(proof.replayCode,proof.code);assert.deepEqual(proof.point,proof.replayPoint);assert.deepEqual(proof.receipts,proof.replayed);assert.equal(proof.receipts.at(-1).channel,18);assert.equal(proof.receipts.at(-1).outcome[0],'1');assert.equal(proof.recordHostReads.entropy,1);assert.deepEqual(proof.replayHostReads,{rtc:0,entropy:0});
 const bytes=Uint8Array.from(proof.tape);await fs.writeFile(path.join(output,'crypto-unavailable.observations'),bytes);proof.tape={file:'crypto-unavailable.observations',bytes:bytes.length,sha256:hash(bytes)};await fs.writeFile(path.join(output,'crypto-unavailable.json'),JSON.stringify(proof,null,2)+'\n');return proof;
}
