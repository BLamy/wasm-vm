#!/usr/bin/env node
/** Reconstruct sampled pixels and complete native planes from original inputs. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './fixtures.mjs';
import {source,originalPixels,nativeFromGuest} from './standard-image-fixtures.mjs';
import {packets,samplerFields,configuration,nativeParameters,float} from './standard-sampler-oracle.mjs';
function originalState(run,initial){
 const contexts=new Map(),events=[],sub=()=>({objects:new Map(),views:[[],[]],samplers:[[],[]],shaders:[null,null],surface:null});
 const ctx=id=>{if(!contexts.has(id))contexts.set(id,{current:0,subs:new Map([[0,sub()]])});return contexts.get(id);};
 const planes=initial.planes.map(p=>({...p,input:p.input.slice()}));
 const histories=[...run.history];if(run.originalQueuedWire&&!histories.some(h=>h.hex===run.originalQueuedWire))histories.push({ctx:1,label:'queued-retired-images-renderer-dispose',hex:run.originalQueuedWire,result:{appliedCommands:7}});
 for(const record of histories){const context=ctx(record.ctx),all=packets(record.hex),count=record.result?.appliedCommands??all.length;
  for(const packet of all.slice(0,record.appliedBeforeDispose??count)){const w=packet.words,s=context.subs.get(context.current);
   if(packet.op===1){const o={kind:packet.kind,handle:w[0]};if(packet.kind===6)o.view={resource:w[1],format:w[2]&0xffffff,range:[w[4]&255,w[4]>>>8],swizzle:Array.from({length:4},(_,k)=>w[5]>>>(k*3)&7)};if(packet.kind===7)o.sampler=samplerFields(w);if(packet.kind===8)o.surface={resource:w[1],format:w[2],level:w[3]};if(packet.kind===4){const b=new Uint8Array((w.length-5)*4),dv=new DataView(b.buffer);w.slice(5).forEach((x,i)=>dv.setUint32(i*4,x,true));o.text=new TextDecoder().decode(b.subarray(0,w[2]-1));}s.objects.set(w[0],o);
   }else if(packet.op===3)s.objects.delete(w[0]);
   else if(packet.op===10||packet.op===18){const slots=packet.op===10?s.views:s.samplers;w.slice(2).forEach((h,k)=>slots[w[0]][w[1]+k]=h?s.objects.get(h):null);}
   else if(packet.op===31)s.shaders[w[1]]=s.objects.get(w[0]);
   else if(packet.op===5)s.surface=w[2]?s.objects.get(w[2]).surface:null;
   else if(packet.op===29){context.subs.set(w[0],sub());context.current=w[0];}
   else if(packet.op===28)context.current=w[0];
   else if(packet.op===30){context.subs.delete(w[0]);if(context.current===w[0])context.current=0;}
   else if(packet.op===43&&w[0]===6&&w[12]===1)planes[w[1]].input=initial.planes[w[1]].input.slice();
   else if(packet.op===7&&(w[0]&4)&&s.surface?.resource===6){const p=planes[s.surface.level],format=s.surface.format,color=w.slice(1,5).map(float),channels=color.map((n,k)=>Math.max(0,Math.min(format===233?(k===3?3:1023):255,Math.round(n*(format===233?(k===3?3:1023):255)))));for(let i=0;i<p.width*p.height;i++){if(format===233)new DataView(p.input.buffer).setUint32(i*4,(channels[0]<<20|channels[1]<<10|channels[2]|3<<30)>>>0,true);else p.input.set(format===2?[channels[2],channels[1],channels[0],255]:channels,i*4);}events.push({kind:'clear',label:record.label,surface:s.surface,planes:planes.map(p=>({...p,input:p.input.slice()}))});}
   else if(packet.op===8){const vs=s.views[0][0].view,fs=s.views[1][0].view,a=s.samplers[0][0].sampler,b=s.samplers[1][0].sampler,config=configuration(s.shaders[0].text,s.shaders[1].text);assert.deepEqual(a,b);assert.deepEqual(config,{stage:'both',scale:0,offset:[.25,.25],vsCoord:[.25,.25]});events.push({kind:'draw',label:record.label,vs,fs,sampler:a,surface:s.surface,planes:planes.map(p=>({...p,input:p.input.slice()}))});if(s.surface?.resource===6&&s.surface.format===67){const target=planes[s.surface.level],out=originalPixels({...initial,planes},vs.range,fs.range,a,vs.swizzle,fs.swizzle,target.width,target.height);target.input=out.pixels.slice();}}
  }
 }
 return events;
}
const directory=path.resolve(process.argv[2]),rows=[],faults=[];
const reports=(await fs.readdir(directory)).filter(n=>n==='hardware-matrix'||n.startsWith('hardware-boundaries-')||n.startsWith('fault-'));
let texels=0,pixels=0,draws=0;
for(const name of reports){
 const home=path.join(directory,name),report=JSON.parse(await fs.readFile(path.join(home,'report.json'))),fault=name.startsWith('fault-'),result=fault?report.partial:report.browserResult.result,blobs=new Map();
 for(const b of result.blobs){const packed=await fs.readFile(path.join(home,b.path));assert.equal(sha256(packed),b.gzipSha256);const raw=gunzipSync(packed);assert.equal(raw.length,b.bytes);assert.equal(sha256(raw),b.sha256);blobs.set(b.key,raw);}
 const blob=reference=>{const key=typeof reference==='string'?reference:reference.key;assert.ok(blobs.has(key),'complete input/native blob '+key);const raw=blobs.get(key);if(typeof reference==='object'){assert.equal(raw.length,reference.bytes);assert.equal(sha256(raw),reference.sha256);}return raw;};
 const words=(format,raw)=>format===233?Array.from(new Uint32Array(raw.buffer,raw.byteOffset,raw.length/4)):[...raw];
 const equal=(actual,expected,tolerance=0)=>{assert.equal(actual.length,expected.length);const misses=[];for(let i=0;i<actual.length;i++)if(Math.abs(actual[i]-expected[i])>tolerance)misses.push({at:i,actual:actual[i],expected:expected[i]});return misses;};
 for(let runIndex=0;runIndex<result.runs.length;runIndex++){
  const run=result.runs[runIndex],m=run.metadata,src=source(m.width,m.height,m.format,run.originalSeed,m.lastLevel);assert.deepEqual(m,src.metadata);assert.deepEqual(blob(run.backing),Buffer.from(src.backing));
  for(const p of run.planes){assert.deepEqual(blob(p.input),Buffer.from(src.planes[p.level].input),'literal original source formula');}const original=originalState(run,src);
  if(name==='hardware-matrix')for(const f of result.frames.filter(f=>f.run===runIndex)){
   assert.equal(f.wire,run.history[f.historyIndex].hex,'frame binds immutable original submission');
   const commands=packets(f.wire),view=handle=>commands.find(p=>p.op===1&&p.kind===6&&p.words[0]===handle).words,vs=view(5),fs=view(6),sampler=samplerFields(commands.find(p=>p.op===1&&p.kind===7).words),range=w=>[w[4]&255,w[4]>>>8],swizzle=w=>Array.from({length:4},(_,k)=>w[5]>>>(k*3)&7);assert.deepEqual(f.vs,range(vs));assert.deepEqual(f.fs,range(fs));assert.deepEqual(f.vertexSwizzle,swizzle(vs));assert.deepEqual(f.fragmentSwizzle,swizzle(fs));for(const [k,v]of Object.entries(f.p))assert.equal(v,sampler[k]);const predicted=originalPixels(src,range(vs),range(fs),sampler,swizzle(vs),swizzle(fs)),observed=blob(f.pixels);assert.deepEqual(equal(observed,predicted.pixels,1),[],'independent full original sample output');pixels+=observed.length/4;
   for(const binding of f.bindings){assert.deepEqual(binding.range,binding.stage?f.fs:f.vs);for(const p of binding.planes){const original=src.planes[p.original],raw=blob(p.native);assert.equal(p.width,original.width);assert.equal(p.height,original.height);assert.deepEqual(words(m.format,raw),nativeFromGuest(m.format,original.input),'complete native copy selects original source plane');texels+=p.width*p.height;}}
   rows.push({record:name,run:runIndex,frame:f.label,status:'held',pixels:observed.length/4,color:predicted.color});
  }
  for(const d of run.draws??[]){const input=original.find(e=>e.kind==='draw'&&e.label===d.label);assert.ok(input,'original draw state before native observation');for(const sampler of d.samplers){const expected=input.sampler,n=nativeParameters(expected),actual=sampler.parameters;const names={wrapS:'TEXTURE_WRAP_S',wrapT:'TEXTURE_WRAP_T',wrapR:'TEXTURE_WRAP_R',minFilter:'TEXTURE_MIN_FILTER',magFilter:'TEXTURE_MAG_FILTER',compareMode:'TEXTURE_COMPARE_MODE',compareFunction:'TEXTURE_COMPARE_FUNC',minLod:'TEXTURE_MIN_LOD',maxLod:'TEXTURE_MAX_LOD'};for(const [k,v]of Object.entries(n))assert.equal(actual[names[k]],v);assert.equal(sampler.base,0);const view=sampler.unit===16?input.vs:input.fs;assert.equal(sampler.last,view.range[1]-view.range[0]);const plane=input.planes[view.range[0]];assert.equal(sampler.metadata.width,plane.width);assert.equal(sampler.metadata.height,plane.height);assert.equal(sampler.metadata.lastLevel,view.range[1]-view.range[0]);if(!fault)assert.deepEqual(equal(words(m.format,blob(sampler.texels)),nativeFromGuest(m.format,plane.input),m.format===233?0:1),[],'actual pre-draw sampled native plane follows original source and range');}assert.ok(d.shaders.every(s=>s.glsl.startsWith('#version 300 es\n')),'complete native original shader bodies');assert.equal(d.native.level,input.surface.level,'actual native target plane follows original SURFACE word');for(const a of d.attributes){const raw=blob(a.bytes),original=run.exchanges.find(e=>e.resource.id===3&&e.direction==='upload');assert.ok(original,'original vertex exchange');assert.deepEqual(raw,blob(original.blob),'actual original native positions');}draws++;}
  // Boundary records preserve explicit original expected inputs. Independently
  // normalize complete native words; sampled records also have full pixels.
  for(const [index,o]of (run.observations??[]).entries()){
   if(!o.native)continue;const raw=blob(o.native);let prediction;
   if(o.expectedWords)prediction=o.expectedWords;
   else if(o.expected){const input=original.find(e=>e.label===o.label);if(input?.kind==='draw'){const expected=originalPixels({...src,planes:input.planes},input.vs.range,input.fs.range,input.sampler,input.vs.swizzle,input.fs.swizzle,o.width,o.height);assert.deepEqual(blob(o.expected),Buffer.from(expected.pixels),'sample oracle derives original packet state');}else if(input?.kind==='clear')assert.deepEqual(blob(o.expected),Buffer.from(input.planes[o.level].input),'clear oracle derives original float words and plane');prediction=nativeFromGuest(o.format??m.format,blob(o.expected));}
   else prediction=nativeFromGuest(m.format,src.planes[1].input);
   const actual=words(o.format??m.format,raw),miss=equal(actual,prediction,o.format===233?0:1);
   if(fault){if(miss.length)faults.push({record:name,run:runIndex,index,misses:miss.slice(0,8),fenceCompleted:result.sabotage.fenceCompleted});}
   else assert.deepEqual(miss,[],'independent complete native boundary words');
   if(o.width&&o.height)texels+=o.width*o.height;
   rows.push({record:name,run:runIndex,index,status:miss.length?'failed':'held',bytes:raw.length});
  }
 }
 if(fault){assert.equal(report.status,'failed');assert.equal(result.sabotage.fenceCompleted,true);assert.equal(result.sabotage.held,false);assert.ok(faults.some(f=>f.record===name),'original full oracle detects actual fenced corruption');}
 else{assert.equal(report.status,'passed');assert.ok(result.predictions.every(p=>p.held));for(const run of result.runs){assert.ok(run.nativeObjects.every(o=>o.deleted===1));assert.ok(Object.values(run.final.resources.budgets).every(n=>n===0));assert.ok(Object.values(run.final.renderer.budgets).every(n=>n===0));}}
}
const audit={schema:'original-image-native-audit-v1',status:'passed',pixels,texels,draws,rows,faults,authority:'original isolated inputs to complete native images; no guest/caps authority'};await fs.writeFile(path.join(directory,'physical-audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify({status:audit.status,pixels,texels,draws,observations:rows.length,faults:faults.length}));
