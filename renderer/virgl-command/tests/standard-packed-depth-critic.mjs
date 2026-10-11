/** Fresh-critic correlated original fields, clear bounds and retained-range attack. */
import {checks,rig,add,finish,blob,nativeRead,physicalFence,poll,gpuClear,callerState} from './standard-packed-depth-rig.mjs';
import {command} from './standard-integer-images.mjs';
const edge=[0,1,2,127,128,255,256,257,65535,65536,0x3fffff,0x400000,0x7ffffe,0x7fffff,0x800000,0x800001,0xfffffd,0xfffffe,0xffffff];
const floatBits=value=>new Uint32Array(new Float32Array([value]).buffer)[0];
const packet=(p,direction=1)=>{const words=[(13<<16)|43,6,p.level,0,p.stride,0,p.x??0,p.y??0,0,p.width,p.height,1,p.offset,direction],raw=new Uint8Array(words.length*4),v=new DataView(raw.buffer);words.forEach((w,i)=>v.setUint32(i*4,w,true));return raw;};
const hex=raw=>[...raw].map(b=>b.toString(16).padStart(2,'0')).join('');
const canonical=(format,raw)=>{const out=raw.slice();if(format===21)for(let at=3;at<out.length;at+=4)out[at]=0;return out;};
function source(format,seed){
 const metadata={id:6,target:2,format,bind:9,width:33,height:17,depth:1,arraySize:1,lastLevel:3,nrSamples:0,flags:0},planes=[];let offset=13,w=33,h=17;
 for(let level=0;level<=3;level++){
  const raw=new Uint8Array(w*h*4),v=new DataView(raw.buffer);
  for(let i=0;i<w*h;i++){const n=edge[(Math.floor(i/2)+level*3)%edge.length],lane=(i*19+level*43+seed)&255;v.setUint32(i*4,format===20?((n<<8)|lane)>>>0:(n|(lane<<24))>>>0,true);}
  const stride=w*4+9;planes.push({level,width:w,height:h,stride,offset,input:raw});offset+=(h-1)*stride+w*4+17;w=Math.max(1,w>>1);h=Math.max(1,h>>1);
 }
 const backing=new Uint8Array(offset+23).fill(0xc5);for(const p of planes)for(let y=0;y<p.height;y++)backing.set(p.input.subarray(y*p.width*4,(y+1)*p.width*4),p.offset+y*p.stride);
 return{metadata,planes,backing};
}
function nativeCheck(c,format,input,native,label){
 const count=input.length/4,a=new DataView(input.buffer,input.byteOffset,input.byteLength),b=new DataView(native.buffer,native.byteOffset,native.byteLength);c.same(native.length,count*20,label+' complete native body');
 for(let i=0;i<count;i++){
  const word=a.getUint32(i*4,true),n=format===20?word>>>8:word&0xffffff,actual=b.getUint32(i*16,true);c.same(Math.abs(actual-floatBits(n/16777215))<=1,true,label+' depth ULP');
  for(let lane=1;lane<4;lane++)c.same(b.getUint32(i*16+lane*4,true),lane===3?1:0,label+' diagnostic constants');
  for(let lane=0;lane<4;lane++)c.same(native[count*16+i*4+lane],lane===0&&format===20?word&255:0,label+' exact independent S8 lane');
 }
}
export async function runAcceptance({seed=0x6d2a91c7}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={schema:'packed-depth-fresh-critic-native-v1',status:'running',seed,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};window.__standardPackedDepthEvidence=report;
 for(const format of[20,21]){
  const src=source(format,seed),r=rig(gl,c,{delay:1+seed%4}),row={kind:'critic-correlated-private-range',metadata:src.metadata,seed,inputPlanes:[],originalBacking:await blob(report,src.backing),reads:[],clears:[],privatePlanes:[],heldPlanes:[]};report.runs.push(row);
  try{
   const original=add(r,src.metadata,null);c.ok(r.store.attachBacking(6,[src.backing.subarray(0,5),src.backing.subarray(5,71),src.backing.subarray(71)]),'critic three odd segmented backing');row.generation=original.generation;
   for(const p of src.planes){row.inputPlanes.push({...p,input:await blob(report,p.input)});r.setLabel('critic-packed-correlated-upload-'+p.level);const wire=packet(p),request=c.ok(r.asyncAccess.prepareTransfer(1,command(wire)),'critic original transfer packet');c.ok(r.asyncAccess.provideInput(request.ticket,p.input),'critic own input');c.ok(r.asyncAccess.upload(request.ticket),'critic native upload');c.ok(r.asyncAccess.release(request.ticket),'critic upload retirement');r.operations.push({wire:hex(wire),layout:request.layout});}
   row.uploadFence=await physicalFence(r,'critic-native-upload-completion');const texture=r.allocations[0].storage.texture;row.sourceTexture=r.trace.id(texture);
   const native=await nativeRead(r,texture,33,17,0,format===20);row.baseNative=await blob(report,native);nativeCheck(c,format,src.planes[0].input,native,'critic all256 original S8/X8 and UN24 edge pairs');
   const lease=c.ok(r.store.retainStorage(1,6,'view'),'critic original native range source').lease,view=c.ok(r.imageAccess.capture(lease,1,3),'critic nonzero original range'),resolved=c.ok(r.imageAccess.resolve(view.token),'critic native private range');row.privateMetadata=resolved.metadata;row.privateGeneration=resolved.generation;row.privateTexture=r.trace.id(resolved.storage.texture);c.ok(r.imageAccess.refresh(view.token),'critic original mip range copy');row.copyFence=await physicalFence(r,'critic-private-range-completion');
   for(let local=0;local<3;local++){const p=src.planes[local+1],raw=await nativeRead(r,resolved.storage.texture,p.width,p.height,local,format===20);nativeCheck(c,format,p.input,raw,'critic private mip mapping');row.privatePlanes.push({local,original:p.level,native:await blob(report,raw)});}
   const values=[-0.125,0,17.5/16777215,1/3,0.50000006,0.9999999,1,1.125];let latest;
   for(const depth of values){
    const s=(floatBits(depth)^0x93)&255,before=callerState(gl);r.setLabel('critic-GPU-only-clear');gpuClear(r,texture,1,[depth,s],format===20);c.same(callerState(gl),before,'critic GPU clear state restoration');const cleared={requestedDepth:depth,submittedDepth:Math.fround(depth),stencil:s,fence:await physicalFence(r,'critic-clear-completion')};row.clears.push(cleared);
    c.ok(r.imageAccess.refresh(view.token),'critic native range refresh after GPU-only change');cleared.refreshFence=await physicalFence(r,'critic-range-refresh-completion');const p=src.planes[1],raw=await nativeRead(r,resolved.storage.texture,p.width,p.height,0,format===20),d=new DataView(raw.buffer),observed=d.getFloat32(0,true),n=Math.round(observed*16777215),wanted=Math.min(1,Math.max(0,Math.fround(depth)))*16777215;cleared.native=await blob(report,raw);cleared.nativeWord=n;
    c.same(n===Math.floor(wanted)||n===Math.ceil(wanted),true,'critic GLES complete floor/ceil clear bound');latest=new Uint8Array(p.input.length);const v=new DataView(latest.buffer);for(let i=0;i<latest.length/4;i++)v.setUint32(i*4,format===20?((n<<8)|s)>>>0:n,true);nativeCheck(c,format,latest,raw,'critic validated native clear choice');
    const crop={...p,x:2,y:1,width:5,height:3,stride:29,offset:p.offset+3},wire=packet(crop,2);r.setLabel('critic-odd-nonzero-mip-PBO-read');const request=c.ok(r.asyncAccess.prepareTransfer(2,command(wire)),'critic odd original mip read');c.ok(r.asyncAccess.beginTransferRead(request.ticket),'critic native crop read');const ready=await poll(r,request.ticket),expected=latest.subarray(0,5*3*4);c.same([...ready.bytes],[...expected],'critic public bytes serialize validated native choice');cleared.public=await blob(report,ready.bytes);cleared.wire=hex(wire);cleared.readFence=r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1);c.ok(r.asyncAccess.release(request.ticket),'critic crop staging release');
    const backing=c.ok(r.store.readBacking(6,0,src.backing.length),'critic unchanged entire source backing').bytes;c.same([...backing],[...src.backing],'critic GPU-only clear/refresh/read leaves all backing and padding unchanged');cleared.backing=await blob(report,backing);
   }
   const p=src.planes[0],wire=packet(p,2),queued=c.ok(r.asyncAccess.prepareTransfer(1,command(wire)),'critic queued pre-reuse native read');c.ok(r.asyncAccess.beginTransferRead(queued.ticket),'critic ordered old native snapshot');const hold=c.ok(r.imageAccess.hold(view.token),'critic private allocation completion hold').token;c.ok(r.store.unref(6),'critic original source ID retired');const replacement=source(format===20?21:20,seed^0xa5c72916);row.replacementGeneration=add(r,replacement.metadata,replacement.backing).generation;row.replacementTexture=r.trace.id(r.allocations.at(-1).storage.texture);c.same(row.replacementGeneration===row.generation,false,'critic opposite-format ID reuse is a new generation');row.stalePoll=r.asyncAccess.poll(queued.ticket);c.same(row.stalePoll.ok,false,'critic stale queued transfer cannot deliver to reused original ID');const discarded=await poll(r,queued.ticket,{discard:true});row.discarded={status:discarded.status,fence:r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1)};c.ok(r.asyncAccess.release(queued.ticket),'critic physically completed stale transfer retired');c.ok(r.imageAccess.release(view.token),'critic public range released');c.ok(r.store.releaseStorage(lease),'critic source lease released with hold alive');
   for(let local=0;local<3;local++){const p=src.planes[local+1],raw=await nativeRead(r,resolved.storage.texture,p.width,p.height,local,format===20),input=local===0?latest:src.planes[p.level].input;nativeCheck(c,format,input,raw,'critic held private range after opposite format reuse');row.heldPlanes.push({local,original:p.level,native:await blob(report,raw)});}
   c.ok(r.imageAccess.release(hold),'critic final private hold release');c.same(gl.getError(),gl.NO_ERROR,'critic no native GL errors');
  }finally{await finish(r,report,row);}
 }
 report.status='passed';return report;
}
