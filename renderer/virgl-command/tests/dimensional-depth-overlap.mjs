// Verifier-authored original packed depth transport; no layout/pixel renderer imports.
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from './submit-acceptance.mjs';
import {createVirglStandardDimensionalTextureShaderBridge} from '../../virgl-shader/standard.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const raw=s=>Uint8Array.from(s.match(/../g)??[],v=>parseInt(v,16));
const snapshot=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:x));
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v>>>0,true);
function recorder(gl){
 const calls=[],objects=new WeakMap(),live=new Set();let next=1;
 const describe=v=>v===null||typeof v!=='object'?v===undefined?{undefined:true}:v:ArrayBuffer.isView(v)?{type:v.constructor.name,bytes:hex(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))}:(objects.has(v)||objects.set(v,next++),{object:objects.get(v),type:v.constructor?.name});
 const proxy=new Proxy(gl,{get(target,name){const fn=Reflect.get(target,name,target);if(typeof fn!=='function')return fn;return(...args)=>{const before=args.map(describe),result=fn.apply(target,args);if(/^create(?:Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&result)live.add(result);if(name==='fenceSync'&&result)live.add(result);if(/^delete(?:Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader|Sync)$/.test(name))live.delete(args[0]);calls.push({sequence:calls.length,name,before,after:args.map(describe),result:describe(result)});return result;};}});
 return {gl:proxy,calls,live,describe};
}
function resource(meta){const b=header(0x204,0,72);['id','target','format','bind','width','height','depth','arraySize','lastLevel','nrSamples','flags'].forEach((k,i)=>put(b,24+4*i,meta[k]));return b;}
function command(id,level,b,{op=43,offset=0,stride=0,layerStride=0,direction=1,staging=200,flags=1,data}={}){
 const words=[id,level,0,stride,layerStride,b.x,b.y,b.z,b.width,b.height,b.depth];
 if(op===43)words.push(offset,direction);else if(op===45)words.push(staging,offset,flags);else{const padded=new Uint8Array(Math.ceil(data.length/4)*4);padded.set(data);const view=new DataView(padded.buffer);for(let at=0;at<padded.length;at+=4)words.push(view.getUint32(at,true));}
 const bytes=new Uint8Array((words.length+1)*4);put(bytes,0,(words.length<<16)|op);words.forEach((v,i)=>put(bytes,4+4*i,v));return bytes;
}
function layout(extent,box,size,fields){const row=box.width*size,stride=fields.stride||extent[0]*size,layer=fields.layerStride||stride*extent[1];return {offset:fields.offset??0,row,stride,layer,bytes:row*box.height*box.depth,footprint:(box.depth-1)*layer+(box.height-1)*stride+row};}
function scatter(bytes,box,l,original){const out=new Uint8Array(original);let at=0;for(let z=0;z<box.depth;z++)for(let y=0;y<box.height;y++){out.set(bytes.subarray(at,at+l.row),l.offset+z*l.layer+y*l.stride);at+=l.row;}return out;}
function select(image,[w,h],box,size){const out=new Uint8Array(box.width*box.height*box.depth*size);let at=0;for(let z=0;z<box.depth;z++)for(let y=0;y<box.height;y++){const p=(((box.z+z)*h+box.y+y)*w+box.x)*size;out.set(image.subarray(p,p+box.width*size),at);at+=box.width*size;}return out;}
function patch(image,extent,box,size,bytes){const out=new Uint8Array(image);let at=0;for(let z=0;z<box.depth;z++)for(let y=0;y<box.height;y++){const p=(((box.z+z)*extent[1]+box.y+y)*extent[0]+box.x)*size;out.set(bytes.subarray(at,at+box.width*size),p);at+=box.width*size;}return out;}
function pixels(format,box,seed,tag){const size=format===126?8:4,out=new Uint8Array(box.width*box.height*box.depth*size),v=new DataView(out.buffer);for(let i=0;i<out.length/size;i++){const layer=Math.floor(i/(box.width*box.height)),stencil=(seed+tag*37+layer*83+i*19)&255;if(format===20){const z=((Math.imul(i+1,0x13579)+seed+tag*0x6c8e9+layer*0x314159)&0xffffff);v.setUint32(i*size,((z<<8)|stencil)>>>0,true);}else{v.setUint32(i*size,[0x3e800000,0x3f000000,0x3f400000,0x3f000001,0x3effffff][(i+tag+layer)%5],true);v.setUint32(i*size+4,(0xa5d30000|stencil)>>>0,true);}}return out;}
function canonical(format,bytes){const out=new Uint8Array(bytes);if(format===126)for(let i=0;i<out.length;i+=8)out.fill(0,i+5,i+8);return out;}
function memory(q,c,id,offset){const lengths=[1,2,3,5,7,11,13,17,4037],entries=lengths.map((n,i)=>[q.base+offset+BigInt(i*0x2000),n]);for(const[at,n]of entries)q.write(at-9n,new Uint8Array(n+18).fill(0xa3));return{attach:backing(id,entries),write(bytes){c.equal(bytes.length,4096,'novel full original SG');let p=0;for(const[at,n]of entries){q.write(at,bytes.subarray(p,p+n));p+=n;}},read(){const b=new Uint8Array(4096);let p=0;for(const[at,n]of entries){b.set(q.read(at,n),p);p+=n;}return b;},guards(){return entries.map(([at,n])=>{const a=hex(q.read(at-9n,9)),b=hex(q.read(at+BigInt(n),9));c.equal(a,'a3'.repeat(9),'novel SG prefix');c.equal(b,'a3'.repeat(9),'novel SG suffix');return {at:at.toString(16),length:n,prefix:a,suffix:b};});}};}
export async function runAcceptance({WasmVirglSubmitProof,createVirglStandardDimensionalDepthSubmitBridge,seeds}){
 const c=checker(),original=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});c.truth(original,'novel hardware WebGL2');const recorded=recorder(original),compiler=await createVirglStandardDimensionalTextureShaderBridge();
 const report={status:'running',runs:[],nativeCalls:recorded.calls,seeds,actualLinuxGuest:false,productionAuthority:false,oracle:'independent literal original Z24S8 / FLOAT32_S8X24 fields and whole RAM'};window.__dimensionalDepthReport=report;
 for(const seed of seeds)for(const target of [4,7])for(const format of [20,126]){
  const Selected=class{constructor(callback){return WasmVirglSubmitProof.standardDimensionalDepth(callback);}},rig=makeRig(Selected,createVirglStandardDimensionalDepthSubmitBridge,recorded.gl,compiler,c,seed,true,false,true),q=rig.q;
  const meta={id:6,target,format,bind:9,width:target===4?9:11,height:9,depth:1,arraySize:target===4?6:9,lastLevel:3,nrSamples:0,flags:0},extent=[target===4?4:5,4,meta.arraySize],full={x:0,y:0,z:0,width:extent[0],height:4,depth:extent[2]},size=format===126?8:4,level=1;
  const row={seed,meta,extent,level,phases:[],records:q.records,events:rig.events,exchanges:rig.exchanges,completions:rig.completions,nativeCallsStart:recorded.calls.length};report.runs.push(row);window.__desktopActive=()=>({current:row,host:snapshot(rig.host.bridge.inspect()),native:snapshot(q.vm.inspect()),physical:rig.trace.events});
  await rig.expect('novel context',context(1));await rig.expect('novel original immutable chain',resource(meta));row.texture=recorded.describe(recorded.gl.getParameter(target===4?recorded.gl.TEXTURE_BINDING_CUBE_MAP:recorded.gl.TEXTURE_BINDING_2D_ARRAY));
  const ram=memory(q,c,6,0x210000n),stage=memory(q,c,200,0x250000n);await rig.expect('novel target SG',ram.attach);await rig.expect('novel target member',idCommand(0x202,1,6));
  await rig.expect('novel staging',resource({id:200,target:0,format:64,bind:524288,width:4096,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}));await rig.expect('novel staging SG',stage.attach);await rig.expect('novel staging member',idCommand(0x202,1,200));
  const externalPbo=rig.trace.gl.createBuffer(),externalFbo=rig.trace.gl.createFramebuffer();rig.trace.gl.bindBuffer(original.PIXEL_PACK_BUFFER,externalPbo);rig.trace.gl.bufferData(original.PIXEL_PACK_BUFFER,3072,original.STREAM_READ);rig.trace.gl.bindFramebuffer(original.READ_FRAMEBUFFER,externalFbo);
  const outer=(b,f,d=1)=>{const bytes=transfer(1,6,d,[b.x,b.y,b.z,b.width,b.height,b.depth],BigInt(f.offset),f.stride,f.layerStride,0xfffffffffffffff1n);put(bytes,60,level);return bytes;};
  let image=canonical(format,pixels(format,full,seed,0));const initialFields={offset:3,stride:extent[0]*size+3,layerStride:(extent[0]*size+3)*4+7},initialLayout=layout(extent,full,size,initialFields);ram.write(scatter(image,full,initialLayout,new Uint8Array(4096).fill(0xbc)));await rig.expect('novel initial nonzero mip',outer(full,initialFields));
  for(const [tag,form,box] of [[1,'inline',{x:1,y:1,z:2,width:2,height:2,depth:3}],[2,'outer',{x:2,y:0,z:3,width:2,height:3,depth:2}],[3,'staging',{x:0,y:2,z:1,width:3,height:2,depth:4}]]){
   const input=pixels(format,box,seed,tag),fields={offset:form==='inline'?0:17,stride:box.width*size+5,layerStride:(box.width*size+5)*box.height+13},l=layout(extent,box,size,fields),desired=canonical(format,input);
   let wire;
   if(form==='inline')wire=submission(1,command(6,level,box,{op:9,...fields,data:scatter(input,box,l,new Uint8Array(l.footprint).fill(0x91))}));
   else{const m=form==='outer'?ram:stage;m.write(new Uint8Array(4096).fill(0xed));rig.hooks.beforeLayeredGather=()=>{m.write(scatter(input,box,l,new Uint8Array(4096).fill(0xb3)));rig.hooks.beforeLayeredGather=null;};wire=form==='outer'?outer(box,fields):submission(1,command(6,level,box,{op:45,...fields,flags:1}));}
   const start=recorded.calls.length,first=rig.exchanges.length,entry=await rig.expect('novel overlapping '+form,wire);if(form!=='inline')c.equal(rig.exchanges.at(-1).bytes,hex(input),'novel fresh post-attachment pixel dirt');image=patch(image,extent,box,size,desired);row.phases.push({form,box,fields,layout:l,input:hex(input),expected:hex(image),record:entry,exchanges:snapshot(rig.exchanges.slice(first)),nativeCallsStart:start,nativeCallsEnd:recorded.calls.length});
  }
  const box={x:1,y:0,z:1,width:3,height:4,depth:4},fields={offset:19,stride:3*size+9,layerStride:(3*size+9)*4+15},l=layout(extent,box,size,fields);
  async function checkRead(name,wire,m=ram,expect=image){
   const sentinel=new Uint8Array(4096).fill(0x6d),wanted=select(expect,extent,box,size);m.write(sentinel);const before=rig.trace.snapshot(),first=rig.exchanges.length,start=recorded.calls.length,entry=q.enqueue(name,wire);q.kick();q.run();c.equal(q.usedIndex(),entry.number,'novel used withheld');await rig.drain();const record=q.collect(entry);q.vm.writeMmio(0x64,1);
   const actual=m.read(),exchange=rig.exchanges.at(-1),phase={form:name,box,fields,layout:l,expectedOutput:hex(wanted),output:exchange.bytes,expectedBacking:hex(scatter(wanted,box,l,sentinel)),backing:hex(actual),record,exchanges:snapshot(rig.exchanges.slice(first)),before,after:rig.trace.snapshot(),nativeCallsStart:start,nativeCallsEnd:recorded.calls.length};row.phases.push(phase);
   // Completed original DMA is recorded before the independent oracle may fail.
   c.equal(record.response.slice(0,8),'00110000','novel completed original DMA');c.equal(phase.after.collections-before.collections,1,'novel one fenced CPU collection');c.equal(phase.after.fences-before.fences,1,'novel one whole layered fence');
   c.equal(hex(raw(exchange.bytes)),hex(wanted),'novel independent packed stencil/depth after completed DMA');c.equal(hex(actual),phase.expectedBacking,'novel every RAM and padding byte');ram.guards();stage.guards();return phase;
  }
  await checkRead('novel inner43 inverse',submission(1,command(6,level,box,{...fields,direction:2})));
  await checkRead('novel outer206 inverse',outer(box,fields,2));await checkRead('novel staging45 inverse',submission(1,command(6,level,box,{op:45,...fields,flags:3})),stage);
  // Queue read, an overlapping inline replacement, then read; both must see their own ordered image.
  const oldImage=new Uint8Array(image),replacement={x:1,y:1,z:2,width:2,height:2,depth:2},input=pixels(format,replacement,seed,7),inlineLayout=layout(extent,replacement,size,{offset:0,stride:2*size+5,layerStride:(2*size+5)*2+7}),nextImage=patch(image,extent,replacement,size,canonical(format,input));
  const first=rig.exchanges.length,entries=[q.enqueue('novel old ordered inverse',submission(1,command(6,level,box,{...fields,direction:2}))),q.enqueue('novel ordered inline replacement',submission(1,command(6,level,replacement,{op:9,stride:inlineLayout.stride,layerStride:inlineLayout.layer,data:scatter(input,replacement,inlineLayout,new Uint8Array(inlineLayout.footprint).fill(0x92))}))),q.enqueue('novel new ordered inverse',submission(1,command(6,level,box,{...fields,direction:2})))];
  ram.write(new Uint8Array(4096).fill(0xd7));q.kick();q.run();c.equal(q.usedIndex(),entries[0].number,'novel chained read waits');await rig.drain();const records=entries.map(e=>q.collect(e)),exchanges=rig.exchanges.slice(first);c.equal(exchanges.length,2,'novel ordered two inverse outputs');c.equal(exchanges[0].bytes,hex(select(oldImage,extent,box,size)),'novel old read precedes replacement');c.equal(exchanges[1].bytes,hex(select(nextImage,extent,box,size)),'novel new read follows replacement');row.ordered={records,exchanges:snapshot(exchanges),oldImage:hex(oldImage),nextImage:hex(nextImage),ram:hex(ram.read())};
  await rig.expect('novel retire staging',idCommand(0x102,0,200));await rig.expect('novel retire texture',idCommand(0x102,0,6));await rig.expect('novel retire context',header(0x201,1,24));rig.trace.gl.deleteBuffer(externalPbo);rig.trace.gl.deleteFramebuffer(externalFbo);
  row.final={native:snapshot(q.vm.inspect()),host:snapshot(rig.host.bridge.inspect()),physical:rig.trace.snapshot(),guestTrace:q.vm.commandTrace(),machineDigest:q.vm.machineDigest(),guards:ram.guards()};for(const v of Object.values(row.final.host.store.budgets))c.equal(v,0,'novel terminal budgets zero');rig.dispose();c.equal(recorded.live.size,0,'novel terminal native objects zero');row.nativeCallsEnd=recorded.calls.length;window.__desktopActive=null;
 }
 report.compatibility=[];
 for(const [name,construct] of [['historical',(callback)=>new WasmVirglSubmitProof(callback,true)],['desktop',(callback)=>WasmVirglSubmitProof.standardDesktop(callback)],['dimensional',(callback)=>WasmVirglSubmitProof.standardDimensional(callback)]]){
  const Selected=class{constructor(callback){return construct(callback);}},rig=makeRig(Selected,createVirglStandardDimensionalDepthSubmitBridge,recorded.gl,compiler,c,0,true,false,true),q=rig.q;
  const before=snapshot(q.vm.inspect()),events=rig.events.length;
  for(const target of [4,7])for(const format of [16,18,20,21,126])for(const bind of [1,8,9]){
   const meta={id:6,target,format,bind,width:5,height:5,depth:1,arraySize:target===4?6:7,lastLevel:2,nrSamples:0,flags:0};
   const record=await rig.expect('novel '+name+' factory refuses '+target+'/'+format+'/'+bind,resource(meta),0x1205);
   c.same(q.vm.inspect(),before,'historical proof profile has no new depth owner');c.equal(rig.events.length,events,'historical proof rejects before host callback');report.compatibility.push({factory:name,meta,record});
  }
  rig.dispose();c.equal(recorded.live.size,0,'historical proof terminal native objects zero');
 }
 report.status='passed';report.summary={status:'passed',runs:report.runs.length,compatibilityRefusals:report.compatibility.length,nativeCalls:recorded.calls.length,assertions:c.assertions};return report;
}
