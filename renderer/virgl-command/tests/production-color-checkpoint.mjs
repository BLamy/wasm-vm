import {checker,Queue,context,idCommand,header,backing,transfer} from './submit-acceptance.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../virgl-shader/standard.mjs';
import {createJournalledProductionBridge,restoreProductionRenderer} from '../checkpoint.mjs';
import {createStandardColorResourceStore,createStandardColorTransferBackend} from '../resources.mjs';

const MiB=1024*1024,turn=()=>new Promise(resolve=>setTimeout(resolve,0));
const copy=value=>JSON.parse(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString():v));
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const put=(bytes,offset,value)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint32(offset,value,true);
function metadata(id,width,height){return{id,target:2,format:64,bind:10,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0};}
function allocation(id,width,height){const bytes=header(0x204,0,72);Object.values(metadata(id,width,height)).forEach((v,i)=>put(bytes,24+i*4,v));return bytes;}
function pattern(width,height,seed){
  const bytes=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)bytes[y*width+x]=1+((Math.imul(x,17)^Math.imul(y,29)^(x>>>4)^Math.imul(seed,13))>>>0)%251;
  return bytes;
}
async function retain(name,bytes){
  let pin;
  for(let offset=0;offset<bytes.length;offset+=192*1024){
    const part=bytes.subarray(offset,Math.min(bytes.length,offset+192*1024));let text='';
    for(let at=0;at<part.length;at+=32768)text+=String.fromCharCode(...part.subarray(at,at+32768));
    pin=await window.__recordColorCheckpointBytes({name,offset,total:bytes.length,base64:btoa(text)});
  }
  if(!pin?.complete||pin.bytes!==bytes.length||pin.sha256!==await sha(bytes))throw Error('Incomplete original byte recording: '+name);
  return pin;
}
function observe(gl,events,stage){
  const objects=new Set(),ids=new WeakMap(),captures=[];let next=0;
  const encode=value=>ArrayBuffer.isView(value)?{type:value.constructor.name,byteLength:value.byteLength}:
    value&&typeof value==='object'?(ids.has(value)?ids.get(value):(ids.set(value,++next),next)):value;
  const proxy=new Proxy(gl,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{
    const row={name,stage:stage(),args:args.map(encode)};events.push(row);const value=method.apply(target,args);row.result=encode(value);
    if((/^create/.test(name)||name==='fenceSync')&&value&&typeof value==='object')objects.add(value);
    if(/^delete/.test(name))objects.delete(args[0]);
    if(name==='readPixels'&&ArrayBuffer.isView(args[6]))captures.push({stage:stage(),box:args.slice(0,4),format:args[4],type:args[5],bytes:new Uint8Array(args[6].buffer,args[6].byteOffset,args[6].byteLength).slice()});
    return value;
  };}});
  return{gl:proxy,objects,captures};
}
function compare(c,actual,expected,label){
  c.equal(actual.length,expected.length,label+' complete length');let mismatch=null;
  for(let i=0;i<expected.length;i++)if(actual[i]!==expected[i]){mismatch={offset:i,actual:actual[i],expected:expected[i]};break;}
  c.same(mismatch,null,label+' every logical byte');return expected.length;
}
function compareNative(c,bytes,literal,label){
  c.equal(bytes.length,literal.length*4,label+' full native RGBA length');let mismatch=null;
  for(let i=0;i<literal.length;i++){const at=i*4;if(bytes[at]!==literal[i]||bytes[at+1]!==0||bytes[at+2]!==0||bytes[at+3]!==255){mismatch={pixel:i,actual:[...bytes.subarray(at,at+4)],expected:[literal[i],0,0,255]};break;}}
  c.same(mismatch,null,label+' every native lane');return bytes.length;
}
async function productionCase(WasmVirglSubmitProof,compiler,size,seed,index){
  const c=checker(),row={name:'production-R8-'+size,seed,metadata:metadata(304,size,size),native:[[],[]],transport:[],presentation:[],predictions:{physical:'Poisoned guest backing cannot supply a full native checkpoint read. A distinct WebGL context replays, independently reads, and returns every original R8 byte.',budget:'64 MiB native RGBA read fits the selected production budget; a valid next-width resource refuses before a read or owner/quota mutation.'}};
  let stage='initialization',q,current,source,calls=0;
  const canvases=[document.createElement('canvas'),document.createElement('canvas')];
  const native=canvases.map(canvas=>{canvas.width=canvas.height=4;return canvas.getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true});});
  c.truth(native.every(Boolean)&&native[0]!==native[1],'two distinct actual WebGL2 contexts');
  const profiles=await Promise.all(native.map(gl=>qualifyVirglHost(gl)));row.profiles=copy(profiles);
  const observed=native.map((gl,i)=>observe(gl,row.native[i],()=>stage));
  const transport=Object.fromEntries(['gatherInput','scatterOutput','gatherLayeredInput','scatterLayeredOutput','complete'].map(name=>[name,(...args)=>{
    calls++;const value=q.vm[name](...args);row.transport.push({name,args:args.map(v=>ArrayBuffer.isView(v)?{bytes:v.byteLength}:v),...(ArrayBuffer.isView(value)?{bytes:value.byteLength}:{})});return value;
  }]));
  const presenter=()=>{let target;target=createWorkerScanoutPresenter(frame=>{
    row.presentation.push(copy({...frame,pixels:undefined,pixelBytes:frame.pixels?.byteLength??0}));
    if(frame.presentationToken)queueMicrotask(()=>target.acknowledge(frame.presentationToken,'superseded'));
  });return target;};
  const literal=pattern(size,size,seed),bandRows=MiB/size;
  c.truth(Number.isInteger(bandRows),'bounded row band divides the original texture');
  try{
    source=current=c.ok(createJournalledProductionBridge({gl:observed[0].gl,profile:profiles[0],shaderBridge:compiler,transport,presenter:presenter()}),'original production journal').bridge;
    const Selected=class{constructor(callback){return WasmVirglSubmitProof.qualified(callback,profiles[0].hostWords,profiles[0].formatRoles,profiles[0].renderer);}};
    q=new Queue(Selected,event=>current.apply(event),c);row.layout=copy(q.vm.layout());
    const address=q.base+0x210000n;
    const expect=async(label,bytes)=>{stage=label;const entry=q.enqueue(label,bytes);q.kick();let steps=0;while(q.usedIndex()<q.next){c.truth(++steps<20000,'bounded original device completion');q.run();if(q.usedIndex()<q.next)c.ok(current.pump(),'original physical pump');await turn();}const result=q.collect(entry);q.vm.writeMmio(0x64,1);return result;};
    await expect('original context11',context(11));await expect('captured R8 allocation304',allocation(304,size,size));
    await expect('bounded original guest backing',backing(304,[[address,MiB]]));await expect('original context membership',idCommand(0x202,11,304));
    for(let y=0;y<size;y+=bandRows){q.write(address,literal.subarray(y*size,(y+bandRows)*size));await expect('original upload rows'+y,transfer(11,304,1,[0,y,0,size,bandRows,1]));}
    q.write(address,new Uint8Array(MiB).fill(0x6d));row.poison={bytes:MiB,value:0x6d,sha256:await sha(q.read(address,MiB))};
    row.literal=await retain(row.name+'-literal.bin',literal);
    const before={calls,used:q.usedIndex(),digest:q.vm.machineDigest()};row.beforeCheckpoint=copy(current.inspect());
    stage='checkpoint-source';const saved=await source.saveCheckpoint();row.checkpoint={...saved,bytes:await retain(row.name+'.wvgjrn',saved.bytes)};
    c.equal(saved.contents.allocations.length,1,'checkpoint has exactly the actual color storage');
    c.equal(saved.contents.allocations[0].levels[0].bytes,literal.length,'full logical checkpoint extent');
    c.equal(saved.contents.allocations[0].levels[0].sha256,await sha(literal),'independent full literal checkpoint digest');
    c.equal(calls,before.calls,'physical capture never reads guest transport backing');c.same(q.vm.machineDigest(),before.digest,'capture preserves complete original machine');
    c.ok(source.dispose(),'retire all original physical owners');c.equal(observed[0].objects.size,0,'original context leaves no native objects');
    stage='checkpoint-fresh-context';const restored=await restoreProductionRenderer(saved.bytes,{gl:observed[1].gl,profile:profiles[1],shaderBridge:compiler,transport,presenter:presenter()});
    c.equal(calls,before.calls,'reconstruction invokes no original guest DMA/completion');c.equal(q.usedIndex(),before.used,'reconstruction preserves original used ring');c.same(q.vm.machineDigest(),before.digest,'reconstruction preserves complete guest machine');
    current=restored.bridge;c.ok(await current.activate(),'activate the distinct restored owner');row.restore=copy({...restored,bridge:undefined});
    const result=new Uint8Array(literal.length);
    for(let y=0;y<size;y+=bandRows){q.write(address,new Uint8Array(MiB).fill(0xa5));await expect('fresh GPU read rows'+y,transfer(11,304,2,[0,y,0,size,bandRows,1]));result.set(q.read(address,MiB),y*size);}
    row.logicalBytesChecked=compare(c,result,literal,'fresh original Wasm DMA');row.restoredBytes=await retain(row.name+'-restored.bin',result);
    const captures=observed.flatMap((o,physicalContext)=>o.captures.map(value=>({...value,physicalContext})));row.nativeReads=[];
    c.equal(captures.length,2,'capture and fresh reconstruction each perform one complete physical read');
    for(const [n,{bytes,...fields}]of captures.entries()){c.same(fields.box,[0,0,size,size],'full native checkpoint rectangle');const checked=compareNative(c,bytes,literal,'native checkpoint context'+fields.physicalContext);row.nativeReads.push({...fields,checkedBytes:checked,artifact:await retain(row.name+'-native-'+n+'.bin',bytes)});}
    if(size===4096){
      await expect('retire exact-boundary resource',idCommand(0x102,0,304));
      await expect('next valid logical R8 allocation',allocation(304,4097,4096));await expect('next valid original membership',idCommand(0x202,11,304));
      row.overLimit={metadata:metadata(304,4097,4096),before:copy(current.inspect()),machineBefore:q.vm.machineDigest(),readsBefore:row.native[1].filter(e=>e.name==='readPixels').length};stage='over-limit-checkpoint';
      await current.saveCheckpoint().then(()=>{throw Error('Over64MiB native read was accepted');},error=>{row.overLimit.error=error.message;});
      c.truth(/Native color scratch/.test(row.overLimit.error),'next valid resource fails at native scratch boundary');
      row.overLimit.after=copy(current.inspect());row.overLimit.machineAfter=q.vm.machineDigest();row.overLimit.readsAfter=row.native[1].filter(e=>e.name==='readPixels').length;
      c.same(row.overLimit.after,row.overLimit.before,'refusal preserves all production owner/quota state');c.same(row.overLimit.machineAfter,row.overLimit.machineBefore,'refusal preserves complete original machine');c.equal(row.overLimit.readsAfter,row.overLimit.readsBefore,'oversized checkpoint issues no native read');
    }
    c.equal(row.presentation.some(frame=>frame.pixelBytes>0),false,'resource-only proof never substitutes presenter pixels');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{
    if(q){row.guest=copy(q.vm.inspect());row.trace=q.vm.commandTrace();row.records=q.records;row.digest=q.vm.machineDigest();}
    if(current){row.beforeDispose=copy(current.inspect());row.disposed=copy(current.dispose());}source?.dispose();
    row.remainingNativeObjects=observed.map(o=>o.objects.size);
    if(row.status==='passed')for(const n of row.remainingNativeObjects)c.equal(n,0,'each physical context releases all objects');
    q?.vm.free();row.assertions=c.assertions;
  }
  await window.__recordProductionCriticRun(index,JSON.stringify(row,(_,v)=>typeof v==='bigint'?v.toString():v));return row;
}
async function historicalCase(seed,index){
  const c=checker(),row={name:'historical-R8-eight-MiB',seed,native:[]};let stage='historical-initialization',owner;
  const canvas=document.createElement('canvas'),native=canvas.getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),observed=observe(native,row.native,()=>stage),literal=pattern(1024,2048,seed),leases=[];
  try{
    const backend=c.ok(createStandardColorTransferBackend(observed.gl),'actual historical color backend').backend;
    owner=c.ok(createStandardColorResourceStore({backend}),'unchanged historical resource owner');const store=owner.store;
    c.ok(store.createContext(11),'historical context');c.ok(store.createResource(metadata(304,1024,2048)),'bounded historical physical allocation');c.ok(store.attachContext(11,304),'historical membership');c.ok(store.attachBacking(304,[literal]),'historical owned backing');
    const fields={resourceHandle:304,level:0,usage:0,stride:0,layerStride:0,box:{x:0,y:0,z:0,width:1024,height:2048,depth:1},dataOffset:0,direction:1};
    const prepared=c.ok(store.prepareTransfer(11,{opcode:43,fields}),'historical upload');c.ok(store.executeTransfer(prepared.ticket),'physical historical upload');c.ok(store.writeBacking(304,0,new Uint8Array(literal.length).fill(0x6d)),'poison historical owned backing');
    const lease=c.ok(store.retainStorage(11,304,'readback'),'historical retained storage').lease;leases.push(lease);
    stage='historical-exact-read';const bytes=c.ok(store.readStorage(lease),'exact8MiB native read').bytes;row.logicalBytesChecked=compare(c,bytes,literal,'physical historical logical bytes');row.literal=await retain(row.name+'-literal.bin',literal);row.output=await retain(row.name+'-read.bin',bytes);
    c.equal(observed.captures.length,1,'one actual historical full read');const captured=observed.captures[0];row.nativeRead={box:captured.box,checkedBytes:compareNative(c,captured.bytes,literal,'historical actual native read'),artifact:await retain(row.name+'-native.bin',captured.bytes)};
    c.ok(store.createResource(metadata(305,1025,2048)),'valid next historical physical allocation');c.ok(store.attachContext(11,305),'next historical membership');const extra=c.ok(store.retainStorage(11,305,'readback'),'next historical lease').lease;leases.push(extra);
    row.overLimit={metadata:metadata(305,1025,2048),before:copy(store.inspect()),readsBefore:row.native.filter(e=>e.name==='readPixels').length};stage='historical-over-limit';row.overLimit.result=store.readStorage(extra);
    c.equal(row.overLimit.result.ok,false,'native read above historical8MiB refuses');c.truth(/Native color scratch/.test(row.overLimit.result.error.message),'historical refusal is scratch admission');row.overLimit.after=copy(store.inspect());row.overLimit.readsAfter=row.native.filter(e=>e.name==='readPixels').length;
    c.same(row.overLimit.after,row.overLimit.before,'historical refusal preserves owner/quota state');c.equal(row.overLimit.readsAfter,row.overLimit.readsBefore,'historical overflow has no native read');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{
    if(owner){for(const lease of leases)c.ok(owner.store.releaseStorage(lease),'release historical lease');row.disposed=copy(owner.store.dispose());row.final=copy(owner.store.inspect());if(row.status==='passed')for(const n of Object.values(row.final.budgets))c.equal(n,0,'historical terminal budgets zero');}
    row.remainingNativeObjects=observed.objects.size;if(row.status==='passed')c.equal(row.remainingNativeObjects,0,'historical native objects fully released');row.assertions=c.assertions;
  }
  await window.__recordProductionCriticRun(index,JSON.stringify(row));return row;
}
export async function runProductionColorCheckpoint({WasmVirglSubmitProof,seed=42}){
  const compiler=await createVirglStandardStreamOutputShaderBridge(),rows=[];
  for(const size of [2048,4096]){const row=await productionCase(WasmVirglSubmitProof,compiler,size,seed,rows.length);rows.push(row);if(row.status!=='passed')break;}
  if(rows.every(r=>r.status==='passed'))rows.push(await historicalCase(seed,rows.length));
  return{status:rows.every(r=>r.status==='passed')?'passed':'failed',summary:{runs:rows.length,assertions:rows.reduce((s,r)=>s+r.assertions,0),logicalBytesChecked:rows.reduce((s,r)=>s+(r.logicalBytesChecked??0),0),results:rows.map(r=>({name:r.name,status:r.status,failure:r.failure}))}};
}
