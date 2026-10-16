import {createStandardIntegerColorResourceStore,createStandardIntegerColorTransferBackend} from '../resources.mjs';
import {decodeStandardColorSubmission} from '../decoder.mjs';

// The critic's input declaration and inverse never import the product format map
// or any worker fixture/conversion/oracle. Only original RGB32 UINT/SINT are used.
const fromHex=hex=>Uint8Array.from(hex.match(/../g)??[],v=>parseInt(v,16));
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function digest(bytes){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}
async function blob(report,input){
 const bytes=new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice(),compressed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 const item={key:'blob-'+report.blobs.length,bytes:bytes.length,sha256:await digest(bytes),gzipSha256:await digest(compressed),gzipBase64:btoa(String.fromCharCode(...compressed))};report.blobs.push(item);return item;
}
const packet=(opcode,words)=>{const raw=new Uint8Array((words.length+1)*4),v=new DataView(raw.buffer);v.setUint32(0,opcode|(words.length<<16),true);words.forEach((word,i)=>v.setUint32((i+1)*4,word>>>0,true));return raw;};
function command(spec,level=0,direction=1){const p=spec.planes[level],raw=packet(43,[6,level,0,p.stride,0,0,0,0,p.width,p.height,1,p.offset,direction]),result=decodeStandardColorSubmission(raw);if(!result.ok)throw Error('literal original command did not decode');return result.commands[0];}
function expectedNative(original){
 const out=new Uint8Array(original.length/12*16),source=new DataView(original.buffer,original.byteOffset,original.byteLength),target=new DataView(out.buffer);
 for(let at=0,pixel=0;at<original.length;at+=12,pixel++){for(let lane=0;lane<3;lane++)target.setUint32(pixel*16+lane*4,source.getUint32(at+lane*4,true),true);target.setUint32(pixel*16+12,1,true);}return out;
}
function check(report,observed,expected,prediction){const held=JSON.stringify(observed)===JSON.stringify(expected);report.predictions.push({prediction,expected,observed,held});if(!held)throw Error(prediction+': expected '+JSON.stringify(expected)+', observed '+JSON.stringify(observed));return observed;}
function ok(report,result,prediction){check(report,result?.ok,true,prediction+' '+(result?.error?.message??''));return result;}
function trace(gl,report){
 const objects=new Map(),syncs=new Map(),events=[],owned=[];let next=1,label='',turn=0,owner=null;
 const id=value=>objects.get(value)??syncs.get(value)??null;
 const serialize=value=>ArrayBuffer.isView(value)||Array.isArray(value)?[...value]:value&&typeof value==='object'?id(value):value;
 const proxy=new Proxy(gl,{get(target,name){const method=Reflect.get(target,name,target);if(typeof method!=='function')return method;return(...args)=>{
  const result=method.apply(target,args);
  if(/^create(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&result){objects.set(result,next++);owned.push({object:result,id:id(result),name,deleted:0});}
  if(/^delete(Buffer|Texture|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(name)&&args[0]){const row=owned.find(r=>r.object===args[0]);if(row)row.deleted++;}
  if(name==='fenceSync'&&result){syncs.set(result,next++);events.push({name,label,turn,sync:id(result)});}
  else if(name==='clientWaitSync')events.push({name,label,turn,sync:id(args[0]),actual:result,delivered:result,timeout:args[2]});
  else if(name==='deleteSync')events.push({name,label,turn,sync:id(args[0])});
  else if(['flush','texStorage2D','texSubImage2D','readPixels','getBufferSubData','blitFramebuffer','clearBufferiv','clearBufferuiv','framebufferTexture2D','bufferData'].includes(name))events.push({name,label,turn,args:args.map(serialize),...(owner?{budgets:owner.store.inspect().budgets}:{}),...(name==='texStorage2D'?{texture:id(gl.getParameter(gl.TEXTURE_BINDING_2D))}:{})});
  return result;
 };}});
 return {gl:proxy,id,events,owned,setOwner(value){owner=value;},setLabel(value){label=value;},advance(){turn++;}};
}
async function fence(r,label){
 r.trace.setLabel(label);const gl=r.gl,sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);check(r.report,Boolean(sync),true,'critic physical fence allocated');gl.flush();let status;
 try{for(let turn=0;turn<1000;turn++){await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.advance();status=gl.clientWaitSync(sync,0,0);if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)break;check(r.report,status,gl.TIMEOUT_EXPIRED,'critic legal physical wait');}check(r.report,status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED,true,'critic original physical completion');return {...r.trace.events.filter(e=>e.name==='clientWaitSync').at(-1)};}finally{gl.deleteSync(sync);}
}
async function poll(r,ticket){let result;for(let turn=0;turn<1000;turn++){await new Promise(resolve=>setTimeout(resolve,turn%3));r.trace.advance();result=ok(r.report,r.owner.asyncAccess.poll(ticket),'critic later-task held native read');if(result.status==='ready')break;}check(r.report,result.status,'ready','critic bounded old-storage physical read');return result;}
function readNative(r,texture,width,height,level,signed){
 const gl=r.gl,old={read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pack:gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),alignment:gl.getParameter(gl.PACK_ALIGNMENT),row:gl.getParameter(gl.PACK_ROW_LENGTH),x:gl.getParameter(gl.PACK_SKIP_PIXELS),y:gl.getParameter(gl.PACK_SKIP_ROWS)},fb=gl.createFramebuffer(),data=signed?new Int32Array(width*height*4):new Uint32Array(width*height*4);
 try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.readBuffer(gl.COLOR_ATTACHMENT0);check(r.report,gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'critic independent native integer FBO');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);gl.readPixels(0,0,width,height,gl.RGBA_INTEGER,signed?gl.INT:gl.UNSIGNED_INT,data);check(r.report,gl.getError(),gl.NO_ERROR,'critic independent integer diagnostic has no native error');return new Uint8Array(data.buffer);}
 finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old.read);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,old.pack);gl.pixelStorei(gl.PACK_ALIGNMENT,old.alignment);gl.pixelStorei(gl.PACK_ROW_LENGTH,old.row);gl.pixelStorei(gl.PACK_SKIP_PIXELS,old.x);gl.pixelStorei(gl.PACK_SKIP_ROWS,old.y);gl.deleteFramebuffer(fb);}
}
function clearNative(r,texture,level,signed,values){
 const gl=r.gl,old={draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),mask:gl.getParameter(gl.COLOR_WRITEMASK),scissor:gl.isEnabled(gl.SCISSOR_TEST)},fb=gl.createFramebuffer();
 try{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);check(r.report,gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'critic GPU-only clear FBO');gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,true,true,true);gl[signed?'clearBufferiv':'clearBufferuiv'](gl.COLOR,0,values);check(r.report,gl.getError(),gl.NO_ERROR,'critic actual typed native clear');}
 finally{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,old.draw);gl.colorMask(...old.mask);gl[old.scissor?'enable':'disable'](gl.SCISSOR_TEST);gl.deleteFramebuffer(fb);}
}
function caller(r){const gl=r.gl;return{read:r.trace.id(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)),draw:r.trace.id(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),mask:gl.getParameter(gl.COLOR_WRITEMASK),scissor:gl.isEnabled(gl.SCISSOR_TEST)};}
function poison(r){
 const gl=r.gl,pack=gl.createBuffer(),unpack=gl.createBuffer(),read=gl.createFramebuffer(),draw=gl.createFramebuffer();
 gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.bufferData(gl.PIXEL_PACK_BUFFER,4096,gl.STREAM_READ);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpack);gl.bufferData(gl.PIXEL_UNPACK_BUFFER,4096,gl.STREAM_DRAW);
 gl.pixelStorei(gl.PACK_ALIGNMENT,8);gl.pixelStorei(gl.UNPACK_ALIGNMENT,8);for(const p of [gl.PACK_ROW_LENGTH,gl.UNPACK_ROW_LENGTH])gl.pixelStorei(p,23);for(const p of [gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS,gl.UNPACK_SKIP_PIXELS,gl.UNPACK_SKIP_ROWS])gl.pixelStorei(p,2);
 gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.colorMask(false,true,false,false);return{pack,unpack,read,draw};
}
async function observe(r,row,label,original,texture,width,height,level,signed){
 r.trace.setLabel(label);const actual=readNative(r,texture,width,height,level,signed),expected=expectedNative(original),entry={label,level,width,height,native:await blob(r.report,actual),original:await blob(r.report,original),expectedNativeSha256:await digest(expected),fence:row.latestFence};row.observations.push(entry);
 // This exact oracle is also used after the post-fence physical sabotage.
 check(r.report,hex(actual),hex(expected),'critic independent whole integer plane '+label);
}
export async function run({declaration,fault=false}={}){
 const canvas=document.querySelector('#gpu'),native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),report={schema:'d31-independent-native-critic-v1',status:'running',guestExecution:false,productionNegotiation:false,productionDrawAuthority:false,runs:[],blobs:[],predictions:[],fault};window.__integerCritic=report;
 check(report,declaration?.declaredBeforeNativeRun,true,'independent original input words declared before native run');const ext=native.getExtension('WEBGL_debug_renderer_info');report.gpu=native.getParameter(ext.UNMASKED_RENDERER_WEBGL);
 for(const spec of declaration.cases){
  const row={metadata:spec.metadata,signed:spec.signed,inputDeclaration:spec,observations:[],malformed:[],identities:{}};report.runs.push(row);
  const original=spec.planes.map(p=>fromHex(p.inputHex)),backing=fromHex(spec.backingHex);row.backing=await blob(report,backing);
  const t=trace(native,report),r={gl:t.gl,trace:t,report};let external=null;
  try{
   const backend=ok(report,createStandardIntegerColorTransferBackend(t.gl),'critic selected real native backend').backend,allocations=[];
   r.owner=ok(report,createStandardIntegerColorResourceStore({backend:{...backend,allocate(meta){const storage=backend.allocate(meta);allocations.push({metadata:meta,storage});return storage;}}}),'critic selected integer owner');t.setOwner(r.owner);
   const {store,asyncAccess,imageAccess}=r.owner;for(const id of [1,2])ok(report,store.createContext(id),'critic original context');
   external=poison(r);row.callerBeforeInitialization=caller(r);const created=ok(report,store.createResource(spec.metadata),'critic original RGB32 allocation').resource;check(report,caller(r),row.callerBeforeInitialization,'critic RGB typed initialization restores hostile caller FBO/mask/scissor');
   row.identities.originalGeneration=created.generation;row.identities.originalTexture=t.id(allocations[0].storage.texture);const texture=allocations[0].storage.texture;
   ok(report,store.attachBacking(6,[backing.subarray(0,5),backing.subarray(5)]),'critic nonaligned SG');backing.fill(0);for(const id of [1,2])ok(report,store.attachContext(id,6),'critic original context membership');
   for(const p of spec.planes){t.setLabel('critic-original-upload-'+p.level);const request=ok(report,asyncAccess.prepareTransfer(2,command(spec,p.level)),'critic literal original upload');const input=original[p.level].slice();ok(report,asyncAccess.provideInput(request.ticket,input),'critic owned original signed/unsigned words');input.fill(0x55);ok(report,asyncAccess.upload(request.ticket),'critic actual integer native upload');ok(report,asyncAccess.release(request.ticket),'critic upload ticket release');}
   row.latestFence=row.originalFence=await fence(r,'critic-original-physical-completion');
   for(const p of spec.planes)await observe(r,row,'source-before-clear-'+p.level,original[p.level],texture,p.width,p.height,p.level,spec.signed);
   const lease=ok(report,store.retainStorage(1,6,'view'),'critic exact old storage lease').lease,view=ok(report,imageAccess.capture(lease,1,3),'critic private original mip range'),resolved=ok(report,imageAccess.resolve(view.token),'critic private allocation identity'),hold=ok(report,imageAccess.hold(view.token),'critic completion hold').token;
   row.identities.privateGeneration=resolved.generation;row.identities.privateTexture=t.id(resolved.storage.texture);check(report,resolved.generation,created.generation,'critic range is original generation');check(report,row.identities.privateTexture===row.identities.originalTexture,false,'critic nonzero range has a private native allocation');
   t.setLabel('critic-GPU-range-copy');const before=caller(r);ok(report,imageAccess.refresh(view.token),'critic native NEAREST integer copy');check(report,caller(r),before,'critic copy restores hostile caller FBO/mask/scissor');row.latestFence=row.copyFence=await fence(r,'critic-private-copy-physical-completion');
   for(let local=0;local<3;local++){const p=spec.planes[local+1];await observe(r,row,'private-before-clear-'+local,original[p.level],resolved.storage.texture,p.width,p.height,local,spec.signed);}
   t.setLabel('critic-original-GPU-only-extreme-clear');clearNative(r,texture,spec.clearLevel,spec.signed,spec.clearValues);row.clearFence=await fence(r,'critic-extreme-clear-physical-completion');const p=spec.planes[spec.clearLevel],changed=new Uint8Array(p.width*p.height*12),v=new DataView(changed.buffer);for(let texel=0;texel<p.width*p.height;texel++)for(let lane=0;lane<3;lane++)v.setUint32(texel*12+lane*4,spec.clearValues[lane],true);const expected=original.map(bytes=>bytes.slice());expected[spec.clearLevel]=changed;
   ok(report,imageAccess.refresh(view.token),'critic GPU-only retained-range refresh');row.latestFence=row.refreshFence=await fence(r,'critic-refresh-physical-completion');
   for(let local=0;local<3;local++){const p=spec.planes[local+1];await observe(r,row,'private-after-extreme-clear-'+local,expected[p.level],resolved.storage.texture,p.width,p.height,local,spec.signed);}
   row.backingAfterGPUClear=await blob(report,ok(report,store.readBacking(6,0,spec.backingHex.length/2),'critic complete backing after GPU-only clear').bytes);check(report,hex(fromHex(spec.backingHex)),hex(ok(report,store.readBacking(6,0,spec.backingHex.length/2),'critic unchanged full original SG').bytes),'critic typed native clear preserves every guest backing byte');
   if(fault){
    const corrupt=[...spec.clearValues];corrupt[0]=spec.signed?-17:17;t.setLabel('critic-physical-sabotage-after-original-fence');clearNative(r,resolved.storage.texture,1,spec.signed,corrupt);row.latestFence=row.sabotageFence=await fence(r,'critic-sabotage-physical-completion');row.sabotage={originalFence:row.originalFence,originalPixelsPhysicallyCompleted:true,wrongPrivatePixelsPhysicallyCompleted:true,clearValues:corrupt};
    const p=spec.planes[2];await observe(r,row,'sabotage-post-fence',expected[2],resolved.storage.texture,p.width,p.height,1,spec.signed);throw Error('actual wrong native integer pixels escaped unchanged critic oracle');
   }
   // Own-data inspection and attachment races are tested before any issued read.
   const fields=command(spec,0,2).fields;
   for(const mode of ['getter','unknown','inline-getter','metadata-marker','metadata-getter','configuration-getter']){
    let calls=0,result;
    if(mode==='metadata-marker')result=store.createResource({...spec.metadata,id:7,integerBits:32});
    else if(mode==='metadata-getter'){const m={...spec.metadata,id:7};Object.defineProperty(m,'width',{get(){calls++;return 9;},enumerable:true});result=store.createResource(m);}
    else if(mode==='configuration-getter'){const config={};Object.defineProperty(config,'backend',{get(){calls++;return backend;},enumerable:true});result=createStandardIntegerColorResourceStore(config);}
    else if(mode==='inline-getter'){const words=[0,0,0];Object.defineProperty(words,'0',{get(){calls++;return 0;},enumerable:true});result=store.prepareTransfer(1,{opcode:9,fields:{resourceHandle:6,level:0,usage:0,stride:12,layerStride:0,box:{x:0,y:0,z:0,width:1,height:1,depth:1},dataWords:words}});}
    else{const input={...fields};if(mode==='getter')Object.defineProperty(input,'stride',{get(){calls++;return 1;},enumerable:true});else input.integerBits=32;result=store.prepareTransfer(1,{opcode:43,fields:input});}
    row.malformed.push({mode,result,calls});check(report,result.ok,false,'critic hostile original field refuses '+mode);check(report,calls,0,'critic hostile accessor remains unexecuted '+mode);
   }
   for(const mutation of ['backing','membership']){const request=ok(report,asyncAccess.prepareTransfer(2,command(spec,0,2)),'critic pre-mutation original read ticket'),eventsBefore=t.events.filter(e=>e.name==='readPixels').length;if(mutation==='backing'){ok(report,store.detachBacking(6),'critic detach backing');ok(report,store.attachBacking(6,[fromHex(spec.backingHex)]),'critic replace original backing');}else{ok(report,store.detachContext(2,6),'critic detach membership');ok(report,store.attachContext(2,6),'critic replace original membership');}const validation=asyncAccess.validate(request.ticket),issue=asyncAccess.beginTransferRead(request.ticket);row.malformed.push({mode:'replace-'+mutation,validation,issue});check(report,validation.ok,false,'critic replaced attachment invalidates original ticket');check(report,issue.ok,false,'critic stale ticket has no native issue');check(report,t.events.filter(e=>e.name==='readPixels').length,eventsBefore,'critic stale ticket cannot issue GPU read');ok(report,asyncAccess.release(request.ticket),'critic stale attachment ticket release');}
   t.setLabel('critic-queued-old-source-subrect');const queued=ok(report,asyncAccess.beginStorageRead(lease,spec.readBox),'critic real queued old-source read');row.readLayout=queued.layout;row.pending=store.inspect();
   ok(report,store.unref(6),'critic remove public source before physical read completes');ok(report,store.destroyContext(1),'critic destroy source context');ok(report,store.createContext(1),'critic replace same context name');const replacement=ok(report,store.createResource(spec.metadata),'critic replace same source name').resource;for(const id of [1,2])ok(report,store.attachContext(id,6),'critic replacement membership');
   row.identities.replacementGeneration=replacement.generation;row.identities.replacementTexture=t.id(allocations.at(-1).storage.texture);check(report,row.identities.replacementGeneration===created.generation,false,'critic reused ID has another generation');check(report,row.identities.replacementTexture===row.identities.originalTexture,false,'critic reused ID has another native object');check(report,imageAccess.resolve(view.token).ok,false,'critic old public range is context-stale');
   const ready=await poll(r,queued.ticket);row.oldRead=await blob(report,ready.bytes);row.oldReadFence=t.events.filter(e=>e.name==='clientWaitSync').at(-1);const selected=new Uint8Array(spec.readBox.width*spec.readBox.height*12);for(let y=0;y<spec.readBox.height;y++){const start=((spec.readBox.y+y)*9+spec.readBox.x)*12;selected.set(original[0].subarray(start,start+spec.readBox.width*12),y*spec.readBox.width*12);}check(report,hex(ready.bytes),hex(selected),'critic compact original subrect survives source/context reuse');ok(report,asyncAccess.release(queued.ticket),'critic exact old read release');
   ok(report,imageAccess.release(view.token),'critic stale public range release');ok(report,store.releaseStorage(lease),'critic old lease release with held private allocation');row.beforeHoldRelease=store.inspect();row.latestFence=await fence(r,'critic-retained-old-private-physical-completion');for(let local=0;local<3;local++){const p=spec.planes[local+1];await observe(r,row,'held-after-ID-context-attachment-reuse-'+local,expected[p.level],resolved.storage.texture,p.width,p.height,local,spec.signed);}ok(report,imageAccess.release(hold),'critic final private completion hold release');row.afterHoldRelease=store.inspect();
  }finally{
   if(r.owner)ok(report,r.owner.store.dispose(),'critic owner terminal disposal');if(external){for(const key of ['pack','unpack'])r.gl.deleteBuffer(external[key]);for(const key of ['read','draw'])r.gl.deleteFramebuffer(external[key]);}
   row.events=t.events;row.nativeObjects=t.owned.map(({object,...item})=>item);row.final=r.owner?.store.inspect();for(const item of row.nativeObjects)check(report,item.deleted,1,'critic each native object retires once');for(const made of row.events.filter(e=>e.name==='fenceSync'))check(report,row.events.filter(e=>e.name==='deleteSync'&&e.sync===made.sync).length,1,'critic each physical sync retires once');for(const count of Object.values(row.final?.budgets??{}))check(report,count,0,'critic every terminal resource/ticket/byte/view/hold budget zero');
  }
 }
 report.status='passed';return report;
}
