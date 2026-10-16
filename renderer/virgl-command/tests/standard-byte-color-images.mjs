import {rig,finish,blob,submit,nativeRead} from './standard-byte-color-rig.mjs';
import {createVirglStandardUniformShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks} from './standard-instanced-draws.mjs';
import {originalFormats,originalFormat,source,colorSpecimen,statePackets,packet,join,meta,imageView,sampler,bind,draw,originalPixels,expectedNativeRead,expectedGuestRead,textureTransfer,hex,surface,clear,lookup,storedRgba,storedLinear} from '../../../tools/virgl-command/standard-byte-color-fixtures.mjs';
import {decodeStandardColorSubmission,decodeStandardImageSubmission} from '../decoder.mjs';
import {createStandardColorResourceStore,createStandardImageResourceStore,computeStandardColorTransferLayout} from '../resources.mjs';
export function runWireAcceptance(){
 const c=checks(),records=[];
 for(const p of originalFormats){
  const metadata={...meta(6,2,p.format,p.snorm?8:10,7,5),lastLevel:2},pixelBytes=p.channels.length,nativePixelBytes=p.snorm&&pixelBytes===3||p.srgb?4:p.swizzles[3]==='1'&&pixelBytes===4?3:pixelBytes;
  for(const kind of ['view','surface']){const bytes=kind==='view'?imageView(77,6,p.format,1,2):packet(1,8,[77,6,p.format,1,0]);const original=decodeStandardImageSubmission(bytes),selected=decodeStandardColorSubmission(bytes);c.same(original.ok,false,'historical image decoder excludes new byte colors');c.same(selected.ok,kind==='view'||!p.snorm,'explicit original byte format and render role');records.push({kind,format:p.format,hex:hex(bytes),original,selected});}
  const backend={maxTextureSize:16384,colorProfile:'virgl-standard-byte-color-transfers-v1',allocate:()=>({}),destroy(){},upload(){},readback(){},dispose(){},copyTextureRange(){}};
  const previous=c.ok(createStandardImageResourceStore({backend}),'previous image owner').store;c.same(previous.createResource(metadata).ok,false,'historical metadata admission isolated');c.ok(previous.dispose(),'previous image owner cleanup');
  const selected=c.ok(createStandardColorResourceStore({backend}),'selected synthetic metadata-only owner').store,res=c.ok(selected.createResource(metadata),'original byte chain allocation shape').resource;
  c.same(res.byteLength,(35+6+1)*pixelBytes,'logical original mip bytes');c.same(res.gpuByteLength,(35+6+1)*nativePixelBytes,'complete physical native mip bytes');
  for(const direction of [1,2]){const fields={resourceHandle:6,level:1,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:3,height:2,depth:1},dataOffset:0,direction},layout=c.ok(computeStandardColorTransferLayout(metadata,fields,24),'original level transfer layout').layout;c.same(layout.rowBytes,3*pixelBytes,'original row addressing remains logical bytes');c.same(layout.tightBytes,6*pixelBytes,'dense original logical bytes');c.same(layout.scratchBytes,6*(direction===2?4:Math.max(pixelBytes,nativePixelBytes)),'native expansion or RGBA read scratch charged');c.same(layout.stagingBytes,direction===2?24:0,'physical read PBO charge');records.push({kind:'layout',format:p.format,metadata,fields,layout});}
  for(const boundary of ['resource-exact','resource-short','gpu-exact','gpu-short']){
   let allocations=0;const physical=42*nativePixelBytes,complete=42*Math.max(pixelBytes,nativePixelBytes),limits=boundary.startsWith('resource')?{resourceBytes:complete-(boundary.endsWith('short')?1:0)}:{gpuBytes:physical-(boundary.endsWith('short')?1:0)},owner=c.ok(createStandardColorResourceStore({backend:{...backend,allocate(){allocations++;return{};}},limits}),'separate logical/native allocation limit owner').store,result=owner.createResource(metadata);c.same(result.ok,boundary.endsWith('exact'),'complete logical and physical resource limit '+boundary);c.same(allocations,boundary.endsWith('exact')?1:0,'short color allocation refuses before native publication');records.push({kind:'allocation-limit',boundary,format:p.format,metadata,limits,result,allocations});c.ok(owner.dispose(),'bounded color allocation owner retires');
  }
  if(p.snorm)c.same(selected.createResource({...metadata,id:7,bind:10}).ok,false,'signed original render role explicitly rejected');
  for(const invalid of [{format:0},{lastLevel:3},{target:3},{bind:0},{flags:1},{width:0},{depth:2},{nrSamples:1}])c.same(selected.createResource({...metadata,id:7,...invalid}).ok,false,'bounded original metadata rejects invalid field '+JSON.stringify(invalid));
  c.ok(selected.dispose(),'synthetic metadata-only owner cleanup');
 }
 return {status:'passed',authority:'wire-and-synthetic-layout-only',records,predictions:c.rows};
}
const bytesOf=v=>new Uint8Array(v.buffer,v.byteOffset,v.byteLength);
function nativeEqual(c,format,raw,expected,label){
 const p=originalFormat(format),actual=[...bytesOf(raw)],wanted=[...expected];
 const miss=actual.map((v,i)=>({v,e:wanted[i],i})).filter(({v,e})=>v!==e&&!(p.snorm&&(v===128||v===129)&&(e===128||e===129)));
 c.same(miss.slice(0,8),[],label);
}
export async function runAcceptance({smoke=false,fault=null,seed=0xa5471e03,mode='matrix'}={}){
 if(mode==='boundaries')return (await import('./standard-byte-color-boundaries.mjs')).runBoundaries({seed});
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardUniformShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),report={status:'running',guestExecution:false,productionNegotiation:false,gpu,seed,mode,frames:[],runs:[],blobs:[],predictions:c.rows};report.nativeEnums=Object.fromEntries(['R8','RG8','RGB8','RGBA8','R8_SNORM','RG8_SNORM','RGBA8_SNORM','SRGB8_ALPHA8','RED','RG','RGB','RGBA','BYTE','UNSIGNED_BYTE'].map(name=>[name,gl[name]]));report.nativeExtensions={EXT_render_snorm:Boolean(gl.getExtension('EXT_render_snorm'))};window.__standardByteColorEvidence=report;
 const formats=fault==='srgb-storage'?[originalFormat(97)]:fault==='upload-channel'?[originalFormat(1)]:smoke?originalFormats.filter(p=>[1,64,65,66,74,75,76,77,97,104,134].includes(p.format)):originalFormats;
 let index=0;
 for(const profile of formats)for(const [w,h] of smoke||fault?[[7,5]]:[[7,5],[1,9]])for(const truncation of smoke||fault?[0]:[0,1]){
  const format=profile.format,s=colorSpecimen(format),src=source(w,h,format,(seed+index)>>>0,Math.max(0,Math.floor(Math.log2(Math.max(w,h)))-truncation)),r=rig(gl,bridge,c,s,{delay:2,step:index%2?1:64,fault}),initial=r.allocations[0];r.blobs=report.blobs;r.add(meta(3,0,64,0,s.positions.length),s.positions);r.add(src.metadata,src.backing);
  c.ok(r.store.detachBacking(6),'replace source with original segmented backing');const split=Math.min(7,src.backing.length-1);c.ok(r.store.attachBacking(6,[src.backing.subarray(0,split),src.backing.subarray(split)]),'nonaligned segmented original image backing');
  const run={originalSeed:(seed+index)>>>0,metadata:src.metadata,backing:await blob(report,src.backing),planes:[],frames:[],transfers:[],final:null};for(const p of src.planes)run.planes.push({...p,input:await blob(report,p.input)});report.runs.push(run);
  try {
  const setup=await submit(r,1,statePackets(s,src),'original-byte-color-setup');c.ok(setup.result,'byte color setup and final fence');let bound=false;
  const last=src.metadata.lastLevel,ranges=[[0,last],[Math.min(1,last),last],[last,last]],cases=smoke||fault?[{mip:2,lambda:0,min:0,mag:0}]:[{mip:2,lambda:0,min:0,mag:0},{mip:2,lambda:0,min:1,mag:1},{mip:0,lambda:1,min:0,mag:0},{mip:1,lambda:.375,min:1,mag:1}];
  for(const fs of ranges)for(const entry of cases){
   const vs=[Math.min(1,last),last],p={s:2,t:2,r:2,min:entry.min,mip:entry.mip,mag:entry.mag,minLod:entry.lambda,maxLod:entry.lambda},vertexSwizzle=[0,1,2,3],fragmentSwizzle=index%3===0?[2,4,0,5]:[0,1,2,3];
   const wire=join(...(bound?[packet(3,6,[5]),packet(3,6,[6]),packet(3,7,[8])]:[]),imageView(5,6,format,...vs,vertexSwizzle),imageView(6,6,format,...fs,fragmentSwizzle),sampler(8,p),bind(0,5,8),bind(1,6,8),draw());bound=true;
   const label='byte-color-'+index;r.currentLabel=label;const record=await submit(r,1,wire,label);c.ok(record.result,'original byte-color draw');c.same(record.result.gpuComplete,true,'actual byte-color completion fence');
   const pixels=nativeRead(gl,initial.storage.texture,67,s.width,s.height,0),expected=originalPixels(src,vs,fs,p,vertexSwizzle,fragmentSwizzle),miss=[];for(let i=0;i<pixels.length;i++)if(Math.abs(pixels[i]-expected.pixels[i])>1)miss.push({at:i,actual:pixels[i],expected:expected.pixels[i]});
   const frame={run:report.runs.length-1,label,wire:r.history.at(-1).hex,vs,fs,p,vertexSwizzle,fragmentSwizzle,bindings:[],color:expected.color,pixels:await blob(report,pixels),historyIndex:r.history.length-1,dump:record.dump};report.frames.push(frame);run.frames.push(report.frames.length-1);
   if(fault)report.sabotage={fault,fenceCompleted:record.result.gpuComplete,held:miss.length===0,miss:miss.slice(0,8),expected:await blob(report,expected.pixels),observed:frame.pixels};
   report.diagnostic={format,w,h,vs,fs,p,expected:hex(expected.pixels),observed:hex(pixels),miss:miss.slice(0,8)};
   c.same(miss.slice(0,8),[],'independent original byte-color pixels after completed native fence');
   for(const [stage,range]of [[0,vs],[1,fs]]){
    gl.activeTexture(gl.TEXTURE0+(stage?0:16));const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),allocation=r.allocations.find(row=>row.storage.texture===texture),planes=[];c.same(Boolean(allocation),true,'byte range native allocation');
    c.same(gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL),0,'native range base restored');c.same(gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL),range[1]-range[0],'native range end restored');
    for(let local=0;local<=range[1]-range[0];local++){const original=src.planes[range[0]+local],raw=nativeRead(gl,texture,format,original.width,original.height,local);nativeEqual(c,format,raw,expectedNativeRead(format,original.input),'complete original normalized/encoded native plane');planes.push({local,original:range[0]+local,width:original.width,height:original.height,native:await blob(report,raw)});}
    frame.bindings.push({stage,range,metadata:allocation.metadata,nativeTexture:r.trace.id(texture),planes});
   }
   gl.activeTexture(gl.TEXTURE0);c.same(gl.getError(),gl.NO_ERROR,'full native byte-color capture no GL errors');index++;
  }
  if(!profile.snorm&&!fault){
   const targetMetadata={...meta(7,2,format,10,8,8),lastLevel:1};r.add(targetMetadata,null);const target=r.allocations.at(-1).storage.texture,range=[Math.min(1,last),last],parameters={s:2,t:2,r:2,min:0,mip:2,mag:0,minLod:0,maxLod:0},linearClear=[.07,.18,.63,.31];run.surfaceFrames=[];
   const setup=join(packet(3,6,[5]),packet(3,6,[6]),packet(3,7,[8]),imageView(5,6,format,...range),imageView(6,6,format,...range),sampler(8,parameters),bind(0,5,8),bind(1,6,8),surface(9,7,format,1),packet(5,0,[1,0,9]));
   c.ok((await submit(r,1,setup,'original-byte-surface-bind')).result,'original selected byte-color surface binding');
   const clearExpected=storedRgba(format,linearClear),sourceColor=lookup(src,range,parameters),drawExpected=storedRgba(format,sourceColor),destination=storedLinear(format,clearExpected),mixed=sourceColor.map((v,k)=>v*sourceColor[3]+destination[k]*(1-sourceColor[3])),blendColor=storedRgba(format,mixed).map((v,k)=>k===0||k===2?v:clearExpected[k]);
   for(const kind of ['clear','draw','blend-mask']){
    const rt=(1|(3<<4)|(19<<9)|(1<<17)|(19<<22)|(5<<27))>>>0,wire=kind==='clear'?clear(linearClear):kind==='draw'?draw():join(packet(1,1,[10,0,0,rt,0,0,0,0,0,0,0]),packet(2,1,[10]),clear(linearClear),draw());r.currentLabel='original-'+kind+'-color-surface';const record=await submit(r,1,wire,r.currentLabel);c.ok(record.result,'original '+kind+' color surface');c.same(record.result.gpuComplete,true,'original color surface completed physical fence');
    const pixels=nativeRead(gl,target,format,4,4,1),expected=kind==='clear'?clearExpected:kind==='draw'?drawExpected:blendColor,miss=[...pixels].map((v,i)=>({at:i,actual:v,expected:expected[i%4]})).filter(row=>Math.abs(row.actual-row.expected)>1);run.surfaceFrames.push({kind,targetMetadata,level:1,width:4,height:4,range,parameters,linearClear,wire:r.history.at(-1).hex,historyIndex:r.history.length-1,dump:record.dump,pixels:await blob(report,pixels),expected});c.same(miss.slice(0,8),[],'original '+kind+' full normalized/encoded target plane');
   }
  }
  // Original synchronous and staged transfer readbacks use the selected logical
  // row addresses and return the full source plane, preserving padding.
  const stagingBacking=new Uint8Array(src.backing.length).fill(0x2e);r.add(meta(8,0,64,524288,stagingBacking.length),stagingBacking);run.stagingBacking=await blob(report,stagingBacking);
  for(const plane of src.planes){
   const original=textureTransfer(6,plane.level,plane.width,plane.height,plane.offset,plane.stride);new DataView(original.buffer).setUint32(52,2,true);
   const decoded=c.ok(decodeStandardColorSubmission(original),'original byte-color read packet').commands[0],prepared=c.ok(r.store.prepareTransfer(1,decoded),'synchronous original byte read');c.ok(r.store.executeTransfer(prepared.ticket),'sync byte read completion');const rows=[];for(let y=0;y<plane.height;y++)rows.push(c.ok(r.store.readBacking(6,plane.offset+y*plane.stride,plane.width*profile.channels.length),'sync dense original row').bytes);const dense=join(...rows);nativeEqual(c,format,dense,expectedGuestRead(format,plane.input),'sync original byte read normalized/encoded bytes');
   const staged=c.ok(r.asyncAccess.prepareTransfer(1,decoded),'original byte-color staged prepare');c.ok(r.asyncAccess.beginTransferRead(staged.ticket),'actual byte-color PBO read issue');let result;for(let turn=0;turn<1000;turn++){await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.nextTurn();result=c.ok(r.asyncAccess.poll(staged.ticket),'later-task byte PBO fence');if(result.status==='ready')break;}c.same(result.status,'ready','bounded physical byte PBO completion');nativeEqual(c,format,result.bytes,expectedGuestRead(format,plane.input),'staged original byte read normalized/encoded bytes');run.transfers.push({wire:hex(original),layout:staged.layout,level:plane.level,expected:await blob(report,expectedGuestRead(format,plane.input)),sync:await blob(report,dense),staged:await blob(report,result.bytes),fenceCompleted:true});c.ok(r.asyncAccess.release(staged.ticket),'release physical byte PBO charge');
   for(const opcode of [43,45]){const wire=opcode===43?original.slice():packet(45,0,[6,plane.level,0,plane.stride,0,0,0,0,plane.width,plane.height,1,8,plane.offset,3]),label='owned-original-byte-read-'+opcode+'-'+plane.level,owned=await submit(r,1,wire,label);c.ok(owned.result,'owned original logical byte read and output');c.same(owned.result.gpuComplete,true,'owned byte read output reaches physical completion');const output=r.exchanges.filter(e=>e.label===label&&e.direction==='readback');c.same(output.length,1,'one original logical output exchange');run.transfers.at(-1).owned??=[];run.transfers.at(-1).owned.push({opcode,wire:r.history.at(-1).hex,historyIndex:r.history.length-1,exchange:output[0],fenceCompleted:true});}
  }
  const expectedBacking=src.backing.slice();for(const plane of src.planes){const dense=expectedGuestRead(format,plane.input),rowBytes=plane.width*profile.channels.length;for(let y=0;y<plane.height;y++)expectedBacking.set(dense.subarray(y*rowBytes,(y+1)*rowBytes),plane.offset+y*plane.stride);}const completeBacking=c.ok(r.store.readBacking(6,0,src.backing.length),'complete original backing after reads').bytes;nativeEqual(c,format,completeBacking,expectedBacking,'all logical readback bytes and untouched segmented padding');run.finalBacking=await blob(report,completeBacking);const expectedStaging=stagingBacking.slice();for(const plane of src.planes){const dense=expectedGuestRead(format,plane.input),rowBytes=plane.width*profile.channels.length;for(let y=0;y<plane.height;y++)expectedStaging.set(dense.subarray(y*rowBytes,(y+1)*rowBytes),plane.offset+y*plane.stride);}const completeStaging=c.ok(r.store.readBacking(8,0,stagingBacking.length),'complete original COPY_TRANSFER3D staging backing').bytes;nativeEqual(c,format,completeStaging,expectedStaging,'complete original staged read rows and untouched padding');run.finalStagingBacking=await blob(report,completeStaging);
  } finally { await finish(r,report,run); }
 }
 report.status='passed';report.resources=report.runs.at(-1).final.resources;return report;
}
