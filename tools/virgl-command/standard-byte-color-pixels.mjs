#!/usr/bin/env node
/** Reconstruct complete native observations from literal original packets. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {sha256} from './fixtures.mjs';
import {source,originalFormat,colorSpecimen,originalPixels,expectedNativeRead,expectedGuestRead,lookup,storedRgba,storedLinear,encodeSrgb,hex} from './standard-byte-color-fixtures.mjs';
import {packets,samplerFields,nativeParameters,float} from './standard-sampler-oracle.mjs';

const directory=path.resolve(process.argv[2]),rows=[],faults=[];
 let pixels=0,texels=0,draws=0,transfers=0,physicalFences=0,nativeAllocations=0,nativeUploads=0,nativeReads=0;
const equal=(actual,expected,tolerance=0,signed=false)=>{
 assert.equal(actual.length,expected.length);const misses=[];
 for(let i=0;i<actual.length;i++)if(Math.abs(actual[i]-expected[i])>tolerance&&!(signed&&(actual[i]===128||actual[i]===129)&&(expected[i]===128||expected[i]===129)))misses.push({at:i,actual:actual[i],expected:expected[i]});
 return misses;
};
function originalState(run,initial,blob){
 const contexts=new Map(),events=[],sub=()=>({objects:new Map(),views:[[],[]],samplers:[[],[]],shaders:[null,null],surface:null,blend:null});
 const ctx=id=>{if(!contexts.has(id))contexts.set(id,{current:0,subs:new Map([[0,sub()]])});return contexts.get(id);};
 const planes=initial.planes.map(p=>({...p,input:p.input.slice()})),profile=originalFormat(initial.metadata.format),bpp=profile.channels.length;
 for(let index=0;index<run.history.length;index++){
  const record=run.history[index],context=ctx(record.ctx),all=packets(record.hex),count=record.appliedBeforeDispose??record.result?.appliedCommands??all.length;
  for(const packet of all.slice(0,count)){
   const w=packet.words,s=context.subs.get(context.current);
   if(packet.op===1){
    const o={kind:packet.kind,handle:w[0]};
    if(packet.kind===6)o.view={resource:w[1],format:w[2]&0xffffff,range:[w[4]&255,w[4]>>>8],swizzle:Array.from({length:4},(_,k)=>w[5]>>>(k*3)&7)};
    if(packet.kind===7)o.sampler=samplerFields(w);
    if(packet.kind===8)o.surface={resource:w[1],format:w[2],level:w[3]};
    if(packet.kind===1)o.blend={word:w[3],mask:w[3]>>>27&15};
    if(packet.kind===4){const bytes=new Uint8Array((w.length-5)*4),view=new DataView(bytes.buffer);w.slice(5).forEach((v,i)=>view.setUint32(i*4,v,true));o.text=new TextDecoder().decode(bytes.subarray(0,w[2]-1));}
    s.objects.set(w[0],o);
   }else if(packet.op===3)s.objects.delete(w[0]);
   else if(packet.op===2&&packet.kind===1)s.blend=w[0]?s.objects.get(w[0]).blend:null;
   else if(packet.op===10||packet.op===18){const slots=packet.op===10?s.views:s.samplers;w.slice(2).forEach((h,k)=>slots[w[0]][w[1]+k]=h?s.objects.get(h):null);}
   else if(packet.op===31)s.shaders[w[1]]=s.objects.get(w[0]);
   else if(packet.op===5)s.surface=w[2]?s.objects.get(w[2]).surface:null;
   else if(packet.op===29){context.subs.set(w[0],sub());context.current=w[0];}
   else if(packet.op===28)context.current=w[0];
   else if(packet.op===30){context.subs.delete(w[0]);if(context.current===w[0])context.current=0;}
   else if(packet.op===43&&w[0]===6&&w[12]===1){
    const plane=planes[w[1]],stride=w[3]||plane.width*bpp;for(let y=0;y<w[9];y++)plane.input.set(initial.backing.subarray(w[11]+y*stride,w[11]+y*stride+w[8]*bpp),((w[6]+y)*plane.width+w[5])*bpp);
   }else if(packet.op===9&&w[0]===6){
    const plane=planes[w[1]],stride=w[3]||plane.width*bpp,input=new Uint8Array((w.length-11)*4),view=new DataView(input.buffer);w.slice(11).forEach((v,i)=>view.setUint32(i*4,v,true));
    for(let y=0;y<w[9];y++)plane.input.set(input.subarray(y*stride,y*stride+w[8]*bpp),((w[6]+y)*plane.width+w[5])*bpp);
   }else if(packet.op===7&&(w[0]&4)&&s.surface)events.push({kind:'clear',index,label:record.label,surface:s.surface,linear:w.slice(1,5).map(float),blend:s.blend});
   else if(packet.op===8){
    const vs=s.views[0][0].view,fs=s.views[1][0].view,p=s.samplers[0][0].sampler;assert.deepEqual(p,s.samplers[1][0].sampler);
    const specimen=colorSpecimen(initial.metadata.format);assert.equal(s.shaders[0].text,specimen.vertex,'complete original vertex text');assert.equal(s.shaders[1].text,specimen.fragment,'complete original fragment text');
    events.push({kind:'draw',index,label:record.label,vs,fs,p,surface:s.surface,blend:s.blend,planes:planes.map(p=>({...p,input:p.input.slice()}))});
   }
  }
  for(const change of run.changes??[])if(change.kind==='gpu-only-clear'&&change.afterHistory===index){
   const plane=planes[change.level];assert.deepEqual(blob(change.before),Buffer.from(plane.input));
   const pixel=profile.channels.map((_,k)=>{const lane=profile.swizzles.indexOf(['X','Y','Z','W'][k]);if(lane<0)return 255;const v=change.linear[lane];return Math.round((profile.snorm?Math.max(-1,Math.min(1,v))*127:(profile.srgb&&lane<3?encodeSrgb(v):v)*255))&255;});
   plane.input=new Uint8Array(Array.from({length:plane.width*plane.height},()=>pixel).flat());assert.deepEqual(blob(change.expected),Buffer.from(plane.input));assert.deepEqual(equal(blob(change.native),expectedNativeRead(initial.metadata.format,plane.input),0,profile.snorm),[],'full GPU-only signed/encoded plane');texels+=plane.width*plane.height;
  }
 }
 return events;
}
for(const name of (await fs.readdir(directory)).filter(n=>n==='hardware-matrix'||n.startsWith('hardware-boundaries-')||n.startsWith('fault-'))){
 const home=path.join(directory,name),report=JSON.parse(await fs.readFile(path.join(home,'report.json'))),fault=name.startsWith('fault-'),result=fault?report.partial:report.browserResult.result,blobs=new Map();
 for(const b of result.blobs){const packed=await fs.readFile(path.join(home,b.path));assert.equal(sha256(packed),b.gzipSha256);const raw=gunzipSync(packed);assert.equal(raw.length,b.bytes);assert.equal(sha256(raw),b.sha256);blobs.set(b.key,raw);}
 const blob=reference=>{const key=typeof reference==='string'?reference:reference.key;assert.ok(blobs.has(key),'full input/native body '+key);const raw=blobs.get(key);if(typeof reference==='object'){assert.equal(raw.length,reference.bytes);assert.equal(sha256(raw),reference.sha256);}return raw;};
 const observe=(actual,expected,label,{signed=false,tolerance=0,run}={})=>{const miss=equal(actual,expected,tolerance,signed);rows.push({record:name,run,label,bytes:actual.length,status:miss.length?'failed':'held'});if(miss.length&&fault)faults.push({record:name,run,label,misses:miss.slice(0,8),fenceCompleted:result.sabotage.fenceCompleted});else assert.deepEqual(miss,[],label);};
 assert.equal(result.nativeExtensions.EXT_render_snorm,true,'actual signed native helper extension');
 for(let runIndex=0;runIndex<result.runs.length;runIndex++){
  const run=result.runs[runIndex],m=run.metadata,p=originalFormat(m.format),initial=source(m.width,m.height,m.format,run.originalSeed,m.lastLevel);assert.deepEqual(m,initial.metadata);assert.deepEqual(blob(run.backing),Buffer.from(initial.backing));
  for(const plane of run.planes)assert.deepEqual(blob(plane.input),Buffer.from(initial.planes[plane.level].input));
  const events=originalState(run,initial,blob),drawEvents=events.filter(e=>e.kind==='draw');
  const nativeBpp=p.srgb||p.snorm&&p.channels.length===3?4:p.swizzles[3]==='1'&&p.channels.length===4?3:p.channels.length,internal=p.srgb?'SRGB8_ALPHA8':p.snorm?({1:'R8_SNORM',2:'RG8_SNORM',4:'RGBA8_SNORM'})[nativeBpp]:({1:'R8',2:'RG8',3:'RGB8',4:'RGBA8'})[nativeBpp],upload=({1:'RED',2:'RG',3:'RGB',4:'RGBA'})[nativeBpp],type=p.snorm?'BYTE':'UNSIGNED_BYTE';
  for(const allocation of run.allocations??[])if(allocation.metadata.format===m.format&&allocation.metadata.target===2){
   const meta=allocation.metadata;let count=0;for(let level=0,w=meta.width,h=meta.height;level<=meta.lastLevel;level++,w=Math.max(1,Math.floor(w/2)),h=Math.max(1,Math.floor(h/2)))count+=w*h;
   assert.equal(meta.byteLength,count*p.channels.length);assert.equal(meta.gpuByteLength,count*nativeBpp);assert.equal(meta.pixelBytes,p.channels.length);
   const event=run.imageEvents.find(e=>e.name==='texStorage2D'&&e.texture===allocation.texture);assert.ok(event);assert.deepEqual(event.args.slice(3),[meta.width,meta.height]);assert.equal(event.args[1],meta.lastLevel+1);
   if(name==='fault-srgb-storage')assert.equal(event.args[2],result.nativeEnums.RGBA8);else assert.equal(event.args[2],result.nativeEnums[internal]);nativeAllocations++;
  }
  for(const actual of run.uploads??[])if(run.kind!=='actual-native-error'){
   const [target,level,x,y,width,height,format,elementType]=actual.args;assert.equal(target,3553);assert.equal(format,result.nativeEnums[upload]);assert.equal(elementType,result.nativeEnums[type]);assert.equal(actual.type,p.snorm?'Int8Array':'Uint8Array');
   const history=run.history.find(h=>h.label===actual.label);assert.ok(history,'original command for native color upload');const commands=packets(history.hex),original=commands.find(c=>[9,43].includes(c.op)&&c.words[0]===6&&c.words[1]===level&&c.words[5]===x&&c.words[6]===y&&c.words[8]===width&&c.words[9]===height);assert.ok(original,'exact native upload original box');
   const w=original.words,stride=w[3]||initial.planes[level].width*p.channels.length;let backing,offset;
   if(original.op===43){assert.equal(w[12],1);backing=initial.backing;offset=w[11];}else{backing=new Uint8Array((w.length-11)*4);const view=new DataView(backing.buffer);w.slice(11).forEach((v,i)=>view.setUint32(i*4,v,true));offset=0;}
   const dense=new Uint8Array(width*height*p.channels.length);for(let row=0;row<height;row++)dense.set(backing.subarray(offset+row*stride,offset+row*stride+width*p.channels.length),row*width*p.channels.length);
   const expected=new Uint8Array(width*height*nativeBpp);for(let i=0;i<width*height;i++)for(let lane=0;lane<nativeBpp;lane++){const source=p.swizzles[lane];expected[i*nativeBpp+lane]=source==='0'?0:source==='1'?p.snorm?127:255:dense[i*p.channels.length+['X','Y','Z','W'].indexOf(source)];}
   observe(blob(actual.bytes),expected,'actual original native transfer packing',{run:runIndex});nativeUploads++;
  }
  for(const read of run.readbacks??[])if(read.name!=='getBufferSubData'&&run.kind!=='actual-native-error'){
   assert.equal(read.args[4],result.nativeEnums.RGBA);assert.equal(read.args[5],result.nativeEnums[type]);if(read.type!=='PBO')assert.equal(read.type,p.snorm?'Int8Array':'Uint8Array');nativeReads++;
  }
  for(const frame of result.frames.filter(f=>f.run===runIndex)){
   const original=drawEvents.find(e=>e.index===frame.historyIndex);assert.ok(original,'immutable original draw for completed output');assert.equal(frame.wire,run.history[frame.historyIndex].hex);assert.deepEqual(frame.vs,original.vs.range);assert.deepEqual(frame.fs,original.fs.range);assert.deepEqual(frame.vertexSwizzle,original.vs.swizzle);assert.deepEqual(frame.fragmentSwizzle,original.fs.swizzle);for(const [k,v]of Object.entries(frame.p))assert.equal(v,original.p[k]);
   const expected=originalPixels({...initial,planes:original.planes},original.vs.range,original.fs.range,original.p,original.vs.swizzle,original.fs.swizzle),actual=blob(frame.pixels);observe(actual,expected.pixels,frame.label,{tolerance:1,run:runIndex});pixels+=actual.length/4;
   for(const binding of frame.bindings){assert.deepEqual(binding.range,binding.stage?frame.fs:frame.vs);for(const plane of binding.planes){const input=original.planes[plane.original];assert.equal(plane.width,input.width);assert.equal(plane.height,input.height);observe(blob(plane.native),expectedNativeRead(m.format,input.input),'full restricted native chain',{signed:p.snorm,run:runIndex});texels+=plane.width*plane.height;}}
  }
  for(const draw of run.draws){
   const original=drawEvents.find(e=>e.label===draw.label);assert.ok(original,'original state before native draw '+draw.label);const native=nativeParameters(original.p),names={wrapS:'TEXTURE_WRAP_S',wrapT:'TEXTURE_WRAP_T',wrapR:'TEXTURE_WRAP_R',minFilter:'TEXTURE_MIN_FILTER',magFilter:'TEXTURE_MAG_FILTER',compareMode:'TEXTURE_COMPARE_MODE',compareFunction:'TEXTURE_COMPARE_FUNC',minLod:'TEXTURE_MIN_LOD',maxLod:'TEXTURE_MAX_LOD'};
   for(const sampler of draw.samplers){for(const [k,v]of Object.entries(native))assert.equal(sampler.parameters[names[k]],v);const view=sampler.unit===16?original.vs:original.fs,plane=original.planes[view.range[0]];assert.equal(sampler.base,0);assert.equal(sampler.last,view.range[1]-view.range[0]);assert.equal(sampler.metadata.width,plane.width);assert.equal(sampler.metadata.height,plane.height);observe(blob(sampler.texels),expectedNativeRead(m.format,plane.input),'actual original native pre-draw plane',{signed:p.snorm,run:runIndex});texels+=plane.width*plane.height;}
   assert.equal(draw.native.level,original.surface.level);const implicit=original.surface.format===m.format&&p.swizzles[3]==='1';assert.deepEqual(draw.native.mask,[1,2,4,8].map(bit=>Boolean((original.blend?.mask??15)&bit)&&!(bit===8&&implicit)));
   assert.ok(draw.shaders.every(s=>s.glsl.startsWith('#version 300 es\n')));for(const a of draw.attributes){const upload=run.exchanges.find(e=>e.resource.id===3&&e.direction==='upload');assert.ok(upload);assert.deepEqual(blob(a.bytes),blob(upload.blob));}draws++;
  }
  for(const frame of run.surfaceFrames??[]){
   assert.equal(frame.wire,run.history[frame.historyIndex].hex);const e=events.find(e=>e.index===frame.historyIndex&&e.kind===(frame.kind==='clear'?'clear':'draw'));assert.ok(e);assert.deepEqual(e.surface,{resource:7,format:m.format,level:1});const clearEvent=events.find(x=>x.kind==='clear'&&x.label==='original-clear-color-surface');assert.ok(clearEvent);const base=storedRgba(m.format,clearEvent.linear);let expected=base;
   if(frame.kind!=='clear'){const color=lookup({...initial,planes:e.planes},e.vs.range,e.p,e.vs.swizzle);assert.deepEqual(e.vs,e.fs);expected=storedRgba(m.format,color);if(frame.kind==='blend-mask'){const word=e.blend.word;assert.equal(word&1,1);assert.equal(word>>>4&31,3);assert.equal(word>>>9&31,19);assert.equal(word>>>27&15,5);const destination=storedLinear(m.format,base),mixed=color.map((v,k)=>v*color[3]+destination[k]*(1-color[3]));expected=storedRgba(m.format,mixed).map((v,k)=>k===0||k===2?v:base[k]);}}
   assert.deepEqual(frame.expected,expected);const raw=blob(frame.pixels),whole=new Uint8Array(frame.width*frame.height*4);for(let i=0;i<whole.length;i+=4)whole.set(expected,i);observe(raw,whole,'original '+frame.kind+' normalized/encoded surface',{tolerance:1,run:runIndex});pixels+=raw.length/4;
  }
  for(const transfer of run.transfers??[]){
   const packet=packets(transfer.wire);assert.equal(packet.length,1);assert.equal(packet[0].op,43);assert.equal(packet[0].words[12],2);const plane=initial.planes[packet[0].words[1]],expected=expectedGuestRead(m.format,plane.input);assert.equal(transfer.level,plane.level);assert.equal(transfer.layout.rowBytes,plane.width*p.channels.length);assert.equal(transfer.layout.scratchBytes,plane.width*plane.height*4);assert.equal(transfer.layout.stagingBytes,plane.width*plane.height*4);assert.deepEqual(blob(transfer.expected),Buffer.from(expected));for(const key of ['sync','staged'])observe(blob(transfer[key]),expected,'original '+key+' row transfer',{signed:p.snorm,run:runIndex});assert.equal(transfer.fenceCompleted,true);transfers++;for(const owned of transfer.owned??[]){assert.equal(owned.wire,run.history[owned.historyIndex].hex);const packet=packets(owned.wire);assert.equal(packet.length,1);assert.equal(packet[0].op,owned.opcode);assert.equal(packet[0].words[0],6);assert.equal(packet[0].words[1],plane.level);assert.equal(owned.exchange.resource.id,owned.opcode===45?8:6);assert.equal(owned.exchange.layout.rowStride,plane.stride);assert.equal(owned.exchange.layout.offset,plane.offset);assert.equal(owned.exchange.layout.tightBytes,expected.length);assert.equal(owned.fenceCompleted,true);observe(blob(owned.exchange.blob),expected,'owned original logical output exchange',{signed:p.snorm,run:runIndex});transfers++;}
  }
  if(run.finalBacking){const expected=initial.backing.slice();for(const plane of initial.planes){const dense=expectedGuestRead(m.format,plane.input),rowBytes=plane.width*p.channels.length;for(let y=0;y<plane.height;y++)expected.set(dense.subarray(y*rowBytes,(y+1)*rowBytes),plane.offset+y*plane.stride);}observe(blob(run.finalBacking),expected,'complete original backing including segmented padding',{signed:p.snorm,run:runIndex});}
  if(run.finalStagingBacking){const expected=blob(run.stagingBacking).slice();for(const plane of initial.planes){const dense=expectedGuestRead(m.format,plane.input),rowBytes=plane.width*p.channels.length;for(let y=0;y<plane.height;y++)expected.set(dense.subarray(y*rowBytes,(y+1)*rowBytes),plane.offset+y*plane.stride);}observe(blob(run.finalStagingBacking),expected,'complete original COPY_TRANSFER3D destination and untouched padding',{signed:p.snorm,run:runIndex});}
  if(run.retiredExpected){const last=run.draws.at(-1),e=drawEvents.find(e=>e.label===last.label),expected=originalPixels({...initial,planes:e.planes},e.vs.range,e.fs.range,e.p,e.vs.swizzle,e.fs.swizzle).pixels,retired=run.retiredPlanes.find(p=>p.texture===last.native.attachment);assert.deepEqual(blob(run.retiredExpected),Buffer.from(expected));assert.ok([37146,37148].includes(retired.fencePoint.delivered));observe(blob(retired.pixels),expected,'retained original output before native retirement after physical fence',{tolerance:1,run:runIndex});pixels+=expected.length/4;}
  physicalFences+=new Set(run.events.filter(e=>e.name==='clientWaitSync'&&[37146,37148].includes(e.delivered)).map(e=>e.sync)).size;
  if(!fault){assert.ok(run.nativeObjects.every(o=>o.deleted===1));assert.ok(Object.values(run.final.resources.budgets).every(n=>n===0));assert.ok(Object.values(run.final.renderer.budgets).every(n=>n===0));}
 }
 if(fault){assert.equal(report.status,'failed');assert.equal(result.sabotage.fenceCompleted,true);assert.equal(result.sabotage.held,false);assert.ok(faults.some(f=>f.record===name),'unchanged original oracle rejects actual physical corruption');}else{assert.equal(report.status,'passed');assert.ok(result.predictions.every(p=>p.held));}
}
const controls=[...new Set(faults.map(f=>f.record))].map(record=>({record,fenceCompleted:faults.filter(f=>f.record===record).every(f=>f.fenceCompleted),observations:faults.filter(f=>f.record===record)}));
const audit={schema:'original-byte-color-native-audit-v1',status:'passed',pixels,texels,draws,transfers,physicalFences,nativeAllocations,nativeUploads,nativeReads,rows,faults:controls,authority:'original byte-color isolated native inputs/outputs; no production guest/capset claim'};
await fs.writeFile(path.join(directory,'physical-audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify({status:audit.status,pixels,texels,draws,transfers,physicalFences,observations:rows.length,faults:faults.length}));
