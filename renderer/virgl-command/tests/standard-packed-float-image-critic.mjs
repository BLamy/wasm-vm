// Fresh critic experiment: original asymmetric fields, exact ranges, foreign owners.
import {checks,rig,add,finish,blob,nativeRead,physicalFence,poll} from './standard-packed-float-image-rig.mjs';
import {createStandardColorResourceStore} from '../resources.mjs';
import {decodeStandardColorSubmission} from '../decoder.mjs';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const packet=(id,p,direction=1)=>{
 const fields=[id,p.level,0,p.stride,0,p.x??0,p.y??0,0,p.width,p.height,1,p.offset,direction],raw=new Uint8Array(56),v=new DataView(raw.buffer);
 v.setUint32(0,43|13<<16,true);fields.forEach((w,i)=>v.setUint32((i+1)*4,w,true));return raw;
};
const decode=bytes=>{const result=decodeStandardColorSubmission(bytes);if(!result.ok)throw Error(result.error.message);return result.commands[0];};
function original(source){
 const fields=[];for(const w of new Uint32Array(source.buffer,source.byteOffset,source.byteLength/4)){
  for(const[code,m]of [[w&2047,6],[w>>>11&2047,6],[w>>>22,5]]){const e=code>>>m,f=code%2**m;fields.push(e? (2**m+f)*2**(e-15-m):f*2**(-14-m));}fields.push(1);
 }return fields;
}
function oracle(c,input,raw,label){
 const expected=original(input),actual=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4),miss=[];
 c.same(actual.length,expected.length,label+' complete native length');
 for(let i=0;i<expected.length;i++){const e=expected[i],a=actual[i];if(e!==a&&!(e>0&&e<2**-14&&a===0))miss.push({component:i,expected:e,observed:a});}
 c.same(miss.slice(0,4),[],label+' unchanged original packed oracle');
}
export async function runAcceptance({seed=0x6c8e9cf5,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const report={schema:'d27-fresh-packed-field-range-owner-v1',status:'running',seed,fault,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,predictions:c.rows,runs:[],blobs:[]};window.__standardPackedFloatImageEvidence=report;
 const metadata={id:6,target:2,format:124,bind:10,width:9,height:5,depth:1,arraySize:1,lastLevel:3,nrSamples:0,flags:0},planes=[];let offset=3;
 for(let level=0;level<=3;level++){
  const width=Math.max(1,9>>level),height=Math.max(1,5>>level),input=new Uint8Array(width*height*4),v=new DataView(input.buffer),r=[0,1,63,64,0x3c0,0x7bf],b=[0,1,31,32,0x1e0,0x3df];
  for(let i=0;i<width*height;i++){const n=((seed>>>0)+i+level*11)>>>0;v.setUint32(i*4,(r[n%6]|r[(n+3)%6]<<11|b[(n+5)%6]<<22)>>>0,true);}
  const stride=width*4+1;planes.push({level,width,height,stride,offset,input});offset+=(height-1)*stride+width*4+3;
 }
 const backing=new Uint8Array(offset).fill(0xa7);for(const p of planes)for(let y=0;y<p.height;y++)backing.set(p.input.subarray(y*p.width*4,(y+1)*p.width*4),p.offset+y*p.stride);
 const r=rig(gl,c,{delay:2+(seed&1),fault}),row={seed,metadata,backing:await blob(report,backing),planes:[],views:[],transfers:[],refusals:[]};let historical;report.runs.push(row);for(const p of planes)row.planes.push({...p,input:await blob(report,p.input)});
 try{
  const created=add(r,metadata,backing);row.generation=created.generation;
  historical=c.ok(createStandardColorResourceStore({backend:r.backend}),'fresh historical byte owner').store;const unselected=historical.createResource(metadata);c.same(unselected.ok,false,'unselected historical owner refuses original packed resource');row.refusals.push({kind:'unselected-owner',result:unselected});
  for(const p of planes){const wire=packet(6,p),prepared=c.ok(r.store.prepareTransfer(1,decode(wire)),'fresh original odd transfer');r.setLabel('original-float-upload-'+p.level);c.ok(r.store.executeTransfer(prepared.ticket),'actual fresh original packed upload');r.operations.push({label:r.label,wire:hex(wire),layout:prepared.layout});}
  row.uploadFence=await physicalFence(r,'fresh-asymmetric-packed-upload');const texture=r.allocations[0].storage.texture;
  for(const p of planes){const native=nativeRead(gl,texture,p.width,p.height,p.level),observation={level:p.level,width:p.width,height:p.height,native:await blob(report,native)};row.planes[p.level].observed=observation;
   if(fault)report.sabotage={fault,fence:row.uploadFence,fenceCompleted:true,held:false,observation};oracle(c,p.input,native,'fresh asymmetric mip '+p.level);}
  const lease=c.ok(r.store.retainStorage(1,6,'view'),'fresh retained source').lease;
  const foreign=rig(gl,c,{delay:1}),foreignRow={metadata:{...metadata,id:6,width:1,height:1,lastLevel:0}};
  try{
   add(foreign,foreignRow.metadata);const wrong=c.ok(foreign.store.retainStorage(1,6,'view'),'distinct actual owner same ID').lease,before=r.nativeObjects.length;
   const refused=r.imageAccess.capture(wrong,0,0),readRefused=r.asyncAccess.beginStorageRead(wrong,{x:0,y:0,z:0,width:1,height:1,depth:1});c.same(refused.error?.code,'invalid-lease','foreign actual same-ID range lease refuses');c.same(readRefused.error?.code,'invalid-lease','foreign actual same-ID read lease refuses');c.same(r.nativeObjects.length,before,'foreign capabilities refuse before native allocations');row.refusals.push({kind:'foreign-actual-owner',metadata:foreignRow.metadata,capture:refused,read:readRefused,nativeBefore:before,nativeAfter:r.nativeObjects.length});c.ok(foreign.store.releaseStorage(wrong),'foreign actual lease cleanup');
  }finally{await finish(foreign,report,foreignRow);row.foreignOwner=foreignRow;}
  const view=c.ok(r.imageAccess.capture(lease,1,3),'fresh nonzero native original range'),resolved=c.ok(r.imageAccess.resolve(view.token),'fresh range metadata');c.ok(r.imageAccess.refresh(view.token),'fresh original native range copy');const fence=await physicalFence(r,'fresh-nonzero-packed-range'),v={firstLevel:1,lastLevel:3,generation:resolved.generation,metadata:resolved.metadata,texture:r.trace.id(resolved.storage.texture),fence,planes:[]};row.views.push(v);
  for(const p of planes.slice(1)){const raw=nativeRead(gl,resolved.storage.texture,p.width,p.height,p.level-1);v.planes.push({original:p.level,local:p.level-1,width:p.width,height:p.height,native:await blob(report,raw)});oracle(c,p.input,raw,'fresh actual nonzero range '+p.level);}
  c.ok(r.imageAccess.release(view.token),'fresh original private range cleanup');c.ok(r.store.releaseStorage(lease),'fresh original source lease cleanup');
  // The smallest legal nonzero mip box ends at the last backed byte of its row.
  const p=planes[1],box={level:1,x:1,y:1,width:3,height:1,stride:13,offset:backing.length-12},wire=packet(6,box,2),prepared=c.ok(r.store.prepareTransfer(1,decode(wire)),'fresh exact end public box');row.exactRange={wire:hex(wire),layout:prepared.layout,expectedEnd:backing.length};c.same(prepared.layout.requiredEnd,backing.length,'fresh exact public footprint reaches final byte');r.setLabel('fresh-exact-public-box');c.ok(r.store.executeTransfer(prepared.ticket),'fresh exact nonzero native read');row.exactRange.public=await blob(report,c.ok(r.store.readBacking(6,box.offset,12),'fresh exact box original public bytes').bytes);row.exactRange.input=await blob(report,p.input.subarray((p.width+1)*4,(p.width+4)*4));
  const short=packet(6,{...box,offset:box.offset+1},2),refused=r.store.prepareTransfer(1,decode(short));c.same(refused.error?.code,'out-of-bounds','fresh one-byte-shifted final range refuses');row.refusals.push({kind:'final-byte-range',wire:hex(short),result:refused});
  const other=planes[0],readWire=packet(6,other,2),sync=c.ok(r.store.prepareTransfer(1,decode(readWire)),'fresh complete synchronous transfer');r.setLabel('original-float-sync-read-0');c.ok(r.store.executeTransfer(sync.ticket),'fresh actual complete synchronous read');const dense=new Uint8Array(other.input.length);for(let y=0;y<other.height;y++)dense.set(c.ok(r.store.readBacking(6,other.offset+y*other.stride,other.width*4),'fresh complete public row').bytes,y*other.width*4);
  const request=c.ok(r.asyncAccess.prepareTransfer(1,decode(readWire)),'fresh complete actual PBO transfer');r.setLabel('original-float-staged-43-0');c.ok(r.asyncAccess.beginTransferRead(request.ticket),'fresh actual PBO issue');const result=await poll(r,request.ticket),readFence=r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1);row.transfers.push({level:0,sync:await blob(report,dense),reads:[{opcode:43,wire:hex(readWire),layout:request.layout,fence:readFence,nativeBytes:await blob(report,result.bytes)}]});
  const actual=new Uint8Array(new Float32Array(original(result.bytes)).buffer);oracle(c,other.input,actual,'fresh PBO original fields');c.ok(r.asyncAccess.release(request.ticket),'fresh consumed actual PBO cleanup');c.same(gl.getError(),gl.NO_ERROR,'fresh native experiment leaves no error');
 }finally{await finish(r,report,row);if(historical){c.ok(historical.dispose(),'fresh empty historical owner cleanup after shared backend use');row.historicalFinal=historical.inspect();}}
 // Exercise the unchanged default/byte branches embedded in changed expressions.
 report.legacy=[];
 for(const format of [1,2,233,77]){
  const legacy=rig(gl,c),meta={...metadata,format,bind:format===77?8:10,width:2,height:2,lastLevel:0},input=new Uint8Array(16),words=new DataView(input.buffer);
  if(format===233)for(let i=0;i<4;i++)words.setUint32(i*4,(i*97|((3-i)*137)<<10|(i*61+83)<<20|3<<30)>>>0,true);
  else input.set(format===77?[127,0,64,127,32,96,16,127,0,0,0,127,127,127,127,127]:[12,29,87,255,34,53,99,255,81,12,39,255,243,111,3,255]);
  const legacyRow={metadata:meta,input:await blob(report,input)};report.legacy.push(legacyRow);
  try{
   add(legacy,meta,input);const p={level:0,width:2,height:2,stride:8,offset:0};legacy.setLabel('fresh-legacy-'+format+'-upload');const upload=c.ok(legacy.store.prepareTransfer(1,decode(packet(6,p))),'fresh unchanged legacy upload');c.ok(legacy.store.executeTransfer(upload.ticket),'actual legacy native upload');legacy.operations.push({wire:hex(packet(6,p)),layout:upload.layout});legacyRow.fence=await physicalFence(legacy,'fresh-legacy-'+format+'-completed');
   legacy.setLabel('fresh-legacy-'+format+'-read');const read=c.ok(legacy.store.prepareTransfer(1,decode(packet(6,p,2))),'fresh unchanged legacy read');c.ok(legacy.store.executeTransfer(read.ticket),'actual legacy native public inverse');const output=c.ok(legacy.store.readBacking(6,0,16),'complete legacy public bytes').bytes;legacyRow.output=await blob(report,output);c.same(hex(output),hex(input),'unchanged legacy bytes roundtrip');c.same(gl.getError(),gl.NO_ERROR,'unchanged native legacy path has no GL error');
  }finally{await finish(legacy,report,legacyRow);}
 }
 report.status='passed';return report;
}
