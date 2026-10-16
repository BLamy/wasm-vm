#!/usr/bin/env node
// Reopen original packets and bodies; prove the bounded shadow identity before
// applying the held independent primitive/instance/stencil model.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {model,compare} from '../../../tools/virgl-instanced-stencil/oracle.mjs';

const directory=path.resolve(process.argv[2]),hash=raw=>createHash('sha256').update(raw).digest('hex');
const rawReport=await fs.readFile(path.join(directory,'report.json')),env=JSON.parse(rawReport),e=env.browserResult.result;
assert.equal(env.task,'E6-T11d49');assert.equal(env.status,'passed');assert.deepEqual(env.browserErrors,{console:[],page:[],requests:[]});
assert.match(e.gpu,/Metal.*M4/);assert.equal(e.guestExecution,false);assert.equal(e.productionNegotiation,false);
const bodies=new Map();for(const ref of e.blobs){const zipped=await fs.readFile(path.join(directory,ref.path)),raw=gunzipSync(zipped);assert.equal(hash(zipped),ref.gzipSha256);assert.equal(hash(raw),ref.sha256);assert.equal(raw.length,ref.bytes);assert.equal(bodies.has(ref.key),false);bodies.set(ref.key,raw);}
const load=ref=>{const raw=bodies.get(ref.key);assert.ok(raw);assert.equal(raw.length,ref.bytes);assert.equal(hash(raw),ref.sha256);return raw;};
function packets(raw){const rows=[];for(let at=0;at<raw.length;){const head=raw.readUInt32LE(at),bytes=4*(1+(head>>>16));assert.ok(at+bytes<=raw.length);const body=raw.subarray(at,at+bytes),words=Array.from({length:head>>>16},(_,i)=>body.readUInt32LE(4+i*4));rows.push({op:head&255,kind:head>>>8&255,words,body});at+=bytes;}return rows;}
function originalShader(packet,text){const bytes=Buffer.from(text+'\0'),raw=Buffer.alloc(24+4*Math.ceil(bytes.length/4));packet.body.copy(raw,0,0,24);raw.writeUInt32LE(1|4<<8|(raw.length/4-1)<<16);raw.writeUInt32LE(bytes.length,12);bytes.copy(raw,24);return raw;}
const counts={runs:0,frames:0,pixels:0,nativePasses:0,consumedSyncs:0},citations=[];
for(const ref of e.runs){const raw=await fs.readFile(path.join(directory,ref.path));assert.equal(hash(raw),ref.sha256);assert.equal(raw.length,ref.bytes);const row=JSON.parse(raw);counts.runs++;
 assert.equal(row.execution.result.ok,true);assert.equal(row.execution.result.gpuComplete,true);
 assert.equal(row.originalFragment,'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n');
 const shadowText=row.originalFragment.replace('0: MOV','DCL SAMP[7]\nDCL SVIEW[7], 2D, FLOAT\nDCL TEMP[0..1]\nIMM[0] FLT32 {0.5,0.5,0.5,1}\n0: MOV').replace('0: MOV OUT[0], IN[0]','0: MOV TEMP[1], IN[0]').replace('1: END\n','1: TEX TEMP[0], IMM[0], SAMP[7], SHADOW2D\n2: MUL OUT[0], TEMP[1], TEMP[0]\n3: END\n');assert.equal(row.fragmentText,shadowText);
 const history=[],objects=new Map();let view,sampler,fragment;
 for(const h of row.history){const projected=[];for(const p of packets(Buffer.from(h.hex,'hex'))){const w=p.words;
  if(p.op===1&&[6,7].includes(p.kind))objects.set(p.kind+'/'+w[0],w);
  if(p.op===10&&w[0]===1&&w[1]===7)view=objects.get('6/'+w[2]);
  if(p.op===18&&w[0]===1&&w[1]===7)sampler=objects.get('7/'+w[2]);
  if(p.op===1&&p.kind===4&&w[1]===1){fragment=p.body.subarray(24,24+w[2]-1).toString('ascii');assert.equal(fragment,shadowText);projected.push(originalShader(p,row.originalFragment));}else projected.push(p.body);
 }history.push({...h,hex:Buffer.concat(projected).toString('hex')});}
 assert.equal(fragment,shadowText);assert.deepEqual(row.oracleHistory,history);
 assert.deepEqual(view,[51,9,18|2<<24,0,0,0|1<<3|2<<6|3<<9]);assert.equal(sampler[0],50);assert.equal(sampler[1]>>>15&1,1);assert.equal(sampler[1]>>>16&7,7);
 assert.deepEqual(load(row.shadowInput),Buffer.from(new Float32Array(4).fill(.5).buffer));
 const depthAllocation=row.allocations.find(a=>a.metadata.id===9);assert.equal(depthAllocation.metadata.format,18);assert.equal(depthAllocation.metadata.width,2);assert.equal(depthAllocation.metadata.height,2);
 const shadowOriginal=load(row.shadowInput),shadowUploads=row.uploads.filter(u=>u.name==='texSubImage2D'&&u.texture===depthAllocation.texture);
 assert.equal(shadowUploads.length,1);assert.deepEqual(shadowUploads[0].args,[3553,0,0,0,2,2,6402,5126]);assert.deepEqual(load(shadowUploads[0].bytes),shadowOriginal);
 const shadowTransfer=row.history.flatMap(h=>packets(Buffer.from(h.hex,'hex'))).find(p=>p.op===43&&p.words[0]===9);
 assert.ok(shadowTransfer);assert.deepEqual(shadowTransfer.words,[9,0,0,8,16,0,0,0,2,2,1,0,1]);
 const shadowExchange=row.exchanges.find(x=>x.direction==='upload'&&x.resource.id===9);assert.ok(shadowExchange);assert.deepEqual(load(shadowExchange.blob),shadowOriginal);
 for(const native of row.draws.filter(d=>d.label==='shadow-inherited-draw'))assert.ok(native.shaders.some(s=>/uniform\s+highp\s+sampler2DShadow\s+fssamp7/.test(s.glsl)));

 const buffers=new Map(row.buffers.map(b=>[b.id,load(b.input)])),input=load(row.planes.find(p=>p.level===row.level).input);
 const reconstructed=Buffer.alloc(load(row.sourceBacking).length,0xb3);for(const p of row.planes){const raw=load(p.input),bpp=row.format===126?8:4;assert.equal(raw.length,p.width*p.height*bpp);for(let y=0;y<p.height;y++)raw.copy(reconstructed,p.offset+y*p.stride,y*p.width*bpp,(y+1)*p.width*bpp);}assert.deepEqual(load(row.sourceBacking),reconstructed);
 assert.deepEqual(row.clearWords,[0xbe800000,0x3e000000,0x3f400000,0x3f000000]);
 for(const frame of row.frames){const original=model(history.slice(0,frame.historyIndex+1),buffers,{format:row.format,width:row.width,height:row.height,input,clearWords:row.clearWords});
  assert.deepEqual(compare(original,load(frame.native),load(frame.depth),row.width,row.height,row.format),[]);counts.frames++;counts.pixels+=row.width*row.height;
  const calls=row.draws.filter(d=>d.label==='shadow-inherited-draw'),states=row.orderedStates.filter(d=>d.label==='shadow-inherited-draw'&&d.name.startsWith('draw'));assert.equal(calls.length,original.primitives.length*2*original.effective);assert.equal(calls.length,states.length);assert.equal(calls.length,row.nativeSamples.length);counts.nativePasses+=calls.length;
  for(let i=0;i<calls.length;i++){const call=calls[i],sample=row.nativeSamples[i],instance=Math.floor(i/(original.primitives.length*2));assert.equal(sample.eventSequence,call.sequence);assert.deepEqual(sample.args,call.args);assert.equal(sample.before.mode,34894);assert.equal(sample.before.func,519);assert.equal(sample.before.texture,depthAllocation.texture);assert.equal(sample.before.uniforms.fssamp7,7);assert.deepEqual(sample.before.uniforms.fsshadmask7,[1,1,1,1]);assert.deepEqual(sample.before.uniforms.fsshadadd7,[0,0,0,0]);assert.equal(sample.before.uniforms.wv_instance_base,instance);
   assert.deepEqual(call.args,[4,3,5125,(Math.floor(i/2)%original.primitives.length)*12]);
   for(let slot=0;slot<original.activeElements.length;slot++){const element=original.activeElements[slot],binding=original.buffers[element.buffer],native=states[i].before.vertexInputs.find(a=>a.name==='in_'+slot),body=row.vertexInputBodies.find(p=>p.buffer===native.buffer);assert.ok(body);assert.deepEqual(load(body.bytes),buffers.get(binding.id));assert.equal(native.stride,binding.stride);assert.equal(native.divisor,element.divisor);assert.equal(native.offset,binding.offset+element.sourceOffset+(element.divisor?Math.floor(instance/element.divisor)*binding.stride:0));}
  }
  const sync=frame.completion.sync,events=row.events,created=events.find(e=>e.name==='fenceSync'&&e.sync===sync),wait=events.find(e=>e.name==='clientWaitSync'&&e.sync===sync&&[37146,37148].includes(e.delivered)),deleted=events.find(e=>e.name==='deleteSync'&&e.sync===sync);assert.equal(wait.sequence,frame.completion.sequence);assert.ok(calls.at(-1).sequence<created.sequence&&created.sequence<=wait.sequence&&wait.sequence<deleted.sequence);
  const read=row.readbacks.find(r=>r.name==='readPixels'&&r.cpu&&r.bytes.sha256===frame.native.sha256&&r.sequence>deleted.sequence);assert.ok(read);citations.push({run:row.name,writer:calls.at(-1).sequence,sync,created:created.sequence,consumed:wait.sequence,deleted:deleted.sequence,read:read.sequence,planeSha256:frame.native.sha256});counts.consumedSyncs++;
  const diagnostic=row.readbacks.filter(r=>r.cpu&&r.name==='readPixels'&&r.label.startsWith('independent-'));assert.equal(diagnostic.length,2);assert.deepEqual(Buffer.concat(diagnostic.map(r=>load(r.bytes))),load(frame.depth));
  for(const read of diagnostic){const sync=read.completion.sync,created=events.find(e=>e.name==='fenceSync'&&e.sync===sync),wait=events.find(e=>e.name==='clientWaitSync'&&e.sync===sync&&[37146,37148].includes(e.delivered)),deleted=events.find(e=>e.name==='deleteSync'&&e.sync===sync),writer=events.findLast(e=>e.name.startsWith('draw')&&e.sequence<created.sequence);assert.ok(writer.sequence<created.sequence&&created.sequence<=wait.sequence&&wait.sequence<deleted.sequence&&deleted.sequence<read.sequence);assert.equal(wait.sequence,read.completion.sequence);citations.push({run:row.name,writer:writer.sequence,sync,created:created.sequence,consumed:wait.sequence,deleted:deleted.sequence,read:read.sequence,planeSha256:read.bytes.sha256});counts.consumedSyncs++;}
 }
 for(const ref of row.vertexInputBodies)load(ref.bytes);for(const ref of row.orderedIndices){load(ref.input);assert.deepEqual(load(ref.input),load(ref.gpu));assert.equal(ref.deleted,true);}
 for(const obj of row.nativeObjects)assert.equal(obj.deleted,1);for(const obj of row.fenceObjects)assert.equal(obj.deleted,1);for(const side of ['renderer','resources'])assert.ok(Object.values(row.final[side].budgets).every(v=>v===0));
}
const result={status:'passed',reportSha256:hash(rawReport),originalPacketsAndAllBodiesReopened:true,oracleImportsProduct:false,boundedProjectionProvedFromOriginalPacketsAndActualNativeBindings:true,counts,citations};await fs.writeFile(path.resolve(process.argv[3]),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,citations:undefined}));
