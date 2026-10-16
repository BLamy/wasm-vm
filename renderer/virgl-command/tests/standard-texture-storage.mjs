import {decodeSubmission,decodeStandardSubmission,decodeStandardUniformSubmission,decodeStandardTextureSubmission} from '../decoder.mjs';
import {computeTransferLayout,computeStandardUniformTransferLayout,computeStandardBufferTransferLayout,computeStandardTextureTransferLayout,createResourceStore,createStandardUniformResourceStore,createStandardBufferResourceStore,createStandardTextureResourceStore,createWebGL2TransferBackend} from '../resources.mjs';
import {metadata,box,packet,hex,transfer,copyTransfer,inline,levels,image,canonical,padded,nativeFromGuest} from '../../../tools/virgl-command/standard-texture-fixtures.mjs';

export function checks(){
  const predictions=[];
  const equal=(actual,expected,label)=>{const held=JSON.stringify(actual)===JSON.stringify(expected);predictions.push({prediction:label,expected,observed:actual,held});if(!held)throw Error(label+': expected '+JSON.stringify(expected)+', observed '+JSON.stringify(actual));};
  const ok=(r,label)=>{equal(r?.ok,true,label+' ('+(r?.error?.code??'')+': '+(r?.error?.message??'')+')');return r;};
  const bad=(r,label,code)=>{equal(r?.ok,false,label+' rejects');if(code)equal(r.error.code,code,label+' code');return r;};
  return {predictions,equal,ok,bad};
}
const command=(wire,c)=>c.ok(decodeStandardTextureSubmission(wire),'complete original texture wire').commands[0];
const tinyBackend=()=>({maxTextureSize:16384,allocate:m=>({kind:m.target===2?'texture':'buffer'}),destroy(){},upload(){},readback:(s,m,l)=>new Uint8Array(l.tightBytes),dispose(){}});
export function runWireAcceptance(){
  const c=checks(),records=[];
  for(const [width,height] of [[1,1],[1,9],[13,1],[7,5],[8,4],[31,19],[128,1],[16384,1],[1,16384]]){
    const maximum=Math.floor(Math.log2(Math.max(width,height)));
    for(let last=0;last<=maximum;last++)for(const format of [2,67,233])for(const bind of [2,8,10,10|262144,10|1048576,10|1310720]){
      const m=metadata(1,width,height,last,format,bind),expected=levels(m),bytes=expected.reduce((n,l)=>n+l.byteLength,0),factory=c.ok(createStandardTextureResourceStore({backend:tinyBackend()}),'selected store');
      const created=c.ok(factory.store.createResource(m),'bounded mip metadata').resource;
      c.equal(created.byteLength,bytes,'sum of every mip level');c.equal(created.kind,last?'mip-texture':'texture','qualified multilevel kind');
      if(last)c.equal(created.levels,expected,'independent NPOT halving');
      for(const l of expected){
        const wire=transfer(m,l.level,box(l.width,l.height),1,7),decoded=command(wire,c),layout=c.ok(computeStandardTextureTransferLayout(m,decoded.fields,7+l.byteLength),'exact selected transfer').layout;
        c.equal([layout.rowBytes,layout.rowStride,layout.layerStride,layout.tightBytes,layout.requiredEnd],[l.width*4,l.width*4,l.width*l.height*4,l.byteLength,7+l.byteLength],'level dimensions govern bytes/stride');
        if(last)c.equal([layout.level,layout.levelWidth,layout.levelHeight],[l.level,l.width,l.height],'selected native level identity');
        c.bad(computeStandardTextureTransferLayout(m,decoded.fields,6+l.byteLength),'one-byte-short backing');
        for(const old of [decodeSubmission,decodeStandardSubmission,decodeStandardUniformSubmission])c.equal(old(wire).ok,l.level===0,'historical decoder level admission');
        for(const old of [computeTransferLayout,computeStandardUniformTransferLayout,computeStandardBufferTransferLayout])c.equal(old(m,decoded.fields,7+l.byteLength).ok,last===0,'historical layout admission');
      }
      for(const old of [createResourceStore,createStandardUniformResourceStore,createStandardBufferResourceStore]){const s=c.ok(old({backend:tinyBackend()}),'old owner');c.equal(s.store.createResource(m).ok,last===0,'old owner shape/admission');c.ok(s.store.dispose(),'old owner dispose');}
      c.ok(factory.store.dispose(),'selected dispose');records.push({metadata:m,levels:expected,byteLength:bytes});
    }
  }
  const m=metadata(),l=levels(m)[1],valid=command(transfer(m,1,box(l.width,l.height),1,5,15,30),c).fields;
  c.equal(c.ok(computeStandardTextureTransferLayout(m,valid,32),'odd exact stride/offset').layout.requiredEnd,32,'last row has no trailing padding');
  for(const change of [{id:0},{target:0},{target:1},{format:16},{format:68},{bind:0},{bind:1},{bind:16},{bind:10|4194304},{depth:2},{arraySize:2},{nrSamples:4},{flags:1},{lastLevel:3},{lastLevel:32},{lastLevel:0xffffffff},{width:0},{width:16385}]){
    const s=c.ok(createStandardTextureResourceStore({backend:tinyBackend()}),'invalid owner');c.bad(s.store.createResource({...m,...change}),'invalid original metadata');c.ok(s.store.dispose(),'invalid owner dispose');
  }
  for(const change of [{level:3},{level:32},{level:0xffffffff},{resourceHandle:2},{stride:11},{stride:0xffffffff},{layerStride:29},{dataOffset:0xffffffff},{box:box(4,2)},{box:box(3,3)},{box:box(1,1,3)},{box:{...box(1,1),z:1}},{box:box(0,1)}])c.bad(computeStandardTextureTransferLayout(m,{...valid,...change},0xffffffff),'invalid level-specific layout');
  for(const level of [15,32,0xffffffff])c.bad(decodeStandardTextureSubmission(transfer(m,level,box(1,1))),'unbounded original level');
  c.bad(decodeSubmission(transfer(m,1,box(1,1)),{textures:true}),'guest provenance cannot select host facet','invalid-provenance');
  const bytes=levels(m).reduce((n,l)=>n+l.byteLength,0);
  for(const limits of [{resourceBytes:bytes-1},{gpuBytes:bytes-1},{textureSize:6}]){const s=c.ok(createStandardTextureResourceStore({backend:tinyBackend(),limits}),'tightened limits');c.bad(s.store.createResource(m),'complete chain exceeds tightened limit');c.equal(c.ok(s.store.inspect(),'rejected budget').budgets.gpuBytes,0,'reject allocates/charges nothing');c.ok(s.store.dispose(),'tightened owner dispose');}
  return {status:'passed',records,predictions:c.predictions,guestExecution:false,productionNegotiation:false};
}

const later=()=>new Promise(resolve=>setTimeout(resolve,0));
const tickSeed=value=>{let x=value>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
export function nativeRead(gl,texture,format,width,height,level){
  const framebuffer=gl.createFramebuffer(),old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),data=format===233?new Uint32Array(width*height):new Uint8Array(width*height*4);
  try{gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,level);gl.readBuffer(gl.COLOR_ATTACHMENT0);if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('independent native mip framebuffer incomplete');gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.readPixels(0,0,width,height,gl.RGBA,format===233?gl.UNSIGNED_INT_2_10_10_10_REV:gl.UNSIGNED_BYTE,data);return data;}
  finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);gl.deleteFramebuffer(framebuffer);}
}
async function blob(evidence,input){
  const raw=new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice(),digest=b=>crypto.subtle.digest('SHA-256',b).then(r=>hex(new Uint8Array(r))),gzip=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const key='blob-'+evidence.blobs.length;let binary='';for(const b of gzip)binary+=String.fromCharCode(b);
  evidence.blobs.push({key,bytes:raw.length,sha256:await digest(raw),gzipSha256:await digest(gzip),gzipBase64:btoa(binary)});return key;
}
export function rig(gl,evidence,c,{limits,seed=0x13198a2e,fault=null}={}){
  const calls=[],identities=new WeakMap(),objects=[],allocations=new Map(),uploads=[],run={seed,fault,calls,objects,operations:[],allocations:[],uploads:[],final:null};let next=1,control=null,state=seed;
  const id=o=>{if(o===null)return null;if(typeof o!=='object')return o;if(!identities.has(o)){identities.set(o,next++);objects.push({id:identities.get(o),type:o.constructor.name,deleted:0});}return identities.get(o);};
  const proxy=new Proxy(gl,{get(target,key){const value=target[key];if(typeof value!=='function')return value;return(...args)=>{
    let native=args;
    if(control==='allocate'&&key==='createTexture'){calls.push({op:key,args:[],returned:null,control});return null;}
    if(control==='storage'&&key==='texStorage2D')native=[args[0],0,...args.slice(2)];
    if(control==='upload'&&key==='texSubImage2D')native=[args[0],args[1],-1,...args.slice(3)];
    if(control==='staging'&&key==='createBuffer'){calls.push({op:key,args:[],returned:null,control});return null;}
    if(control==='fence'&&key==='fenceSync'){calls.push({op:key,args:args,returned:null,control});return null;}
    if(fault==='upload-level'&&key==='texSubImage2D'&&args[1]>0)native=[args[0],0,...args.slice(2)];
    if(fault==='read-level'&&key==='framebufferTexture2D'&&args[3]&&args[4]>0&&args[0]===gl.READ_FRAMEBUFFER)native=[...args.slice(0,4),0];
    if(key==='texSubImage2D')uploads.push({level:args[1],nativeLevel:native[1],bytes:new Uint8Array(args[8].buffer,args[8].byteOffset,args[8].byteLength).slice()});
    const result=value.apply(target,native);
    if(['createTexture','createBuffer','createSync','fenceSync'].includes(key)&&result)id(result);
    if(['deleteTexture','deleteBuffer','deleteSync'].includes(key)&&args[0])objects.find(o=>o.id===id(args[0])).deleted++;
    if(['texStorage2D','texSubImage2D','framebufferTexture2D','copyBufferSubData','readPixels','fenceSync','clientWaitSync','getBufferSubData','deleteTexture','deleteBuffer','deleteSync'].includes(key))calls.push({op:key,args:native.map(x=>ArrayBuffer.isView(x)?{bytes:x.byteLength}:id(x)),originalLevel:key==='texSubImage2D'?args[1]:key==='framebufferTexture2D'?args[4]:null});
    return result;
  };}});
  const native=c.ok(createWebGL2TransferBackend(proxy),'actual native mip backend').backend,backend={...native,allocate(m){const storage=native.allocate(m);allocations.set(m.id,{metadata:m,storage,id:id(storage.texture??storage.buffer)});run.allocations.push({metadata:m,id:id(storage.texture??storage.buffer)});return storage;},pollReadback(entry){state=tickSeed(state);if(state%4)return false;return native.pollReadback(entry);}};
  const r=c.ok(createStandardTextureResourceStore({backend,limits}),'selected native mip store');evidence.runs.push(run);
  const operation=(wire,async=false)=>{const decoded=command(wire,c),prepared=c.ok((async?r.asyncAccess:r.store).prepareTransfer(1,decoded),'original prepared level transfer'),record={wire:hex(wire),layout:prepared.layout,resource:prepared.resource??null,asynchronous:async,preparedBudgets:c.ok(r.store.inspect(),'prepared budget').budgets};run.operations.push(record);return {...prepared,record};};
  const wait=async(ticket,record)=>{let polls=0;for(;polls<256;polls++){await later();const p=c.ok(r.asyncAccess.poll(ticket),'later-task native mip fence poll');if(p.status==='ready'){record.fenceCompleted=true;record.polls=polls+1;record.output=await blob(evidence,p.bytes);return p.bytes;}c.equal(p.status,'pending','strict native pending status');}throw Error('bounded physical mip fence did not complete');};
  return {...r,gl:proxy,native:gl,run,allocations,operation,wait,setControl(value){control=value;},async finish(){for(const upload of uploads)run.uploads.push({level:upload.level,nativeLevel:upload.nativeLevel,blob:await blob(evidence,upload.bytes)});c.ok(r.store.dispose(),'mip resources dispose');run.final=c.ok(r.store.inspect(),'final mip resource ownership');for(const[k,v]of Object.entries(run.final.budgets))c.equal(v,0,'final mip '+k);for(const object of objects)c.equal(object.deleted,1,'each recorded native texture/buffer/fence retires once');c.equal(gl.getError(),gl.NO_ERROR,'all physical mip GL errors consumed');}};
}

async function recordLevel(r,evidence,c,m,level,expected,label){
  const l=levels(m)[level],texture=r.allocations.get(m.id).storage.texture,data=nativeRead(r.native,texture,m.format,l.width,l.height,level),row={run:evidence.runs.length-1,operationCount:r.run.operations.length,metadata:m,level,label,textureId:r.allocations.get(m.id).id,width:l.width,height:l.height,native:await blob(evidence,data),nativeWords:[...data],expected:nativeFromGuest(m.format,expected),expectedGuest:await blob(evidence,expected)};
  row.held=JSON.stringify(row.nativeWords)===JSON.stringify(row.expected);evidence.levels.push(row);c.equal(row.nativeWords,row.expected,'independent full native mip texels '+label);return row;
}

async function matrix(gl,evidence,c,m,seed){
  const r=rig(gl,evidence,c,{seed}),s=r.store;c.ok(s.createContext(1),'mip context');const created=c.ok(s.createResource(m),'original multilevel allocation').resource;c.ok(s.attachContext(1,m.id),'mip context attachment');const chain=levels(m),total=chain.reduce((n,l)=>n+l.byteLength,0);c.equal(c.ok(s.inspect(),'mip allocation budget').budgets.gpuBytes,total,'every native level charged');
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,r.allocations.get(m.id).storage.texture);c.equal(gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_IMMUTABLE_LEVELS),m.lastLevel+1,'actual immutable level count');
  r.run.originalMetadata=m;r.run.created=created;
  const backingLength=Math.max(...chain.map(l=>5+(l.height-1)*(l.width*4+3)+l.width*4));c.ok(s.attachBacking(m.id,[new Uint8Array(3),new Uint8Array(16),new Uint8Array(backingLength-19)]),'split owned mip backing');
  try{for(const l of chain){
    const initial=new Uint8Array(l.byteLength);if(m.format===2)for(let i=3;i<initial.length;i+=4)initial[i]=255;else if(m.format===233)for(let i=3;i<initial.length;i+=4)initial[i]=192;
    await recordLevel(r,evidence,c,m,l.level,initial,'allocation-initial');
    const input=image(m.format,l.width,l.height,l.level,seed),source=padded(input.bytes,l.width,l.height);c.ok(s.writeBacking(m.id,0,source),'strided source backing');const wire=transfer(m,l.level,box(l.width,l.height),1,5,l.width*4+3),pending=r.operation(wire);pending.record.input=await blob(evidence,source);c.ok(s.executeTransfer(pending.ticket),'actual sync selected mip upload');pending.record.completed=true;
    c.equal([...c.ok(s.readBacking(m.id,0,source.length),'owned original backing after native conversion').bytes],[...source],'native conversion cannot alter guest rows');await recordLevel(r,evidence,c,m,l.level,canonical(m.format,input.bytes),'sync-upload');
    const poison=new Uint8Array(source.length).fill(0xa7);c.ok(s.writeBacking(m.id,0,poison),'poison destination rows');const read=r.operation(transfer(m,l.level,box(l.width,l.height),2,5,l.width*4+3));c.ok(s.executeTransfer(read.ticket),'actual sync selected mip readback');read.record.completed=true;read.record.output=await blob(evidence,c.ok(s.readBacking(m.id,0,source.length),'sync original scattered output').bytes);c.equal([...c.ok(s.readBacking(m.id,0,source.length),'full scatter bytes').bytes],[...padded(canonical(m.format,input.bytes),l.width,l.height)],'sync inverse original level bytes and padding');
    const async=r.operation(transfer(m,l.level,box(l.width,l.height),2,0,0),true);c.ok(r.asyncAccess.beginTransferRead(async.ticket),'issue actual native PBO selected level');const dense=await r.wait(async.ticket,async.record);c.ok(r.asyncAccess.release(async.ticket),'retire fenced mip PBO');c.equal([...dense],[...canonical(m.format,input.bytes)],'independent original mip bytes after completed native fence');
    const input2=image(m.format,l.width,l.height,l.level,seed^0x9e3779b9),paddedInline=padded(input2.bytes,l.width,l.height,0,l.width*4+1),prepared=r.operation(inline(m,l.level,box(l.width,l.height),paddedInline,l.width*4+1));prepared.record.input=await blob(evidence,paddedInline);c.ok(s.executeTransfer(prepared.ticket),'actual original inline selected mip');prepared.record.completed=true;await recordLevel(r,evidence,c,m,l.level,canonical(m.format,input2.bytes),'inline-upload');const asyncInline=r.operation(inline(m,l.level,box(l.width,l.height),paddedInline,l.width*4+1),true);asyncInline.record.input=await blob(evidence,paddedInline);c.ok(r.asyncAccess.upload(asyncInline.ticket),'native asynchronous original inline selected level');c.ok(r.asyncAccess.release(asyncInline.ticket),'retire asynchronous inline snapshot');
    const third=image(m.format,l.width,l.height,l.level,seed^0xa4093822),up=r.operation(transfer(m,l.level,box(l.width,l.height),1),true);up.record.input=await blob(evidence,third.bytes);c.ok(r.asyncAccess.provideInput(up.ticket,third.bytes),'private dense asynchronous original upload');third.bytes.fill(0);c.ok(r.asyncAccess.upload(up.ticket),'actual asynchronous native selected mip upload');c.ok(r.asyncAccess.release(up.ticket),'retire async upload');await recordLevel(r,evidence,c,m,l.level,canonical(m.format,image(m.format,l.width,l.height,l.level,seed^0xa4093822).bytes),'async-upload');
    if(l.width>1||l.height>1){const w=Math.max(1,l.width-1),h=Math.max(1,l.height-1),x=l.width-w,y=l.height-h,partial=image(m.format,w,h,l.level,seed^0x082efa98),expected=image(m.format,l.width,l.height,l.level,seed^0xa4093822).bytes;for(let row=0;row<h;row++)expected.set(partial.bytes.subarray(row*w*4,(row+1)*w*4),((y+row)*l.width+x)*4);const p=r.operation(inline(m,l.level,box(w,h,x,y),partial.bytes,w*4));p.record.input=await blob(evidence,partial.bytes);c.ok(s.executeTransfer(p.ticket),'nonzero origin selected mip patch');p.record.completed=true;await recordLevel(r,evidence,c,m,l.level,canonical(m.format,expected),'nonzero-origin-patch');}
  }
  c.bad(r.bindings.retainScanout(m.id,created.generation),'historical scanout rejects multilevel','unsupported-resource');
  }finally{await r.finish();}
}

async function copyCases(gl,evidence,c,format){
  const m=metadata(1,7,5,2,format),r=rig(gl,evidence,c),s=r.store,chain=levels(m),staging=metadata(2,256,1,0,64,524288);staging.target=0;r.run.originalMetadata=m;
  c.ok(s.createContext(1),'copy mip context');c.ok(s.createResource(m),'copy mip allocation');c.ok(s.attachContext(1,1),'copy mip attach');c.ok(s.attachBacking(1,[new Uint8Array([77])]),'read copy primary presence');c.ok(s.createResource(staging),'CPU staging only');c.ok(s.attachContext(1,2),'staging attach');c.ok(s.attachBacking(2,[new Uint8Array(3),new Uint8Array(31),new Uint8Array(222)]),'split staging pages');
  try{for(const l of chain){const input=image(format,l.width,l.height,l.level,0xb7e15162),source=padded(input.bytes,l.width,l.height);c.ok(s.writeBacking(2,0,source),'original staging upload rows');const up=r.operation(copyTransfer(m,l.level,box(l.width,l.height),2,1,5,l.width*4+3));up.record.input=await blob(evidence,source);c.ok(s.executeTransfer(up.ticket),'copy upload selected actual level');up.record.completed=true;await recordLevel(r,evidence,c,m,l.level,canonical(format,input.bytes),'copy-upload');c.ok(s.writeBacking(2,0,new Uint8Array(source.length).fill(0xa7)),'copy destination sentinel');const read=r.operation(copyTransfer(m,l.level,box(l.width,l.height),2,3,5,l.width*4+3));c.ok(s.executeTransfer(read.ticket),'copy readback scatter selected actual level');read.record.completed=true;read.record.output=await blob(evidence,c.ok(s.readBacking(2,0,source.length),'copy all scattered bytes').bytes);c.equal([...c.ok(s.readBacking(2,0,source.length),'copy padding preserved').bytes],[...padded(canonical(format,input.bytes),l.width,l.height)],'copy level inverse and padding');const a=r.operation(copyTransfer(m,l.level,box(l.width,l.height),2,3,5,l.width*4+3),true);c.ok(r.asyncAccess.beginTransferRead(a.ticket),'copy PBO issue');c.equal([...await r.wait(a.ticket,a.record)],[...canonical(format,input.bytes)],'copy original inverse after completed fence');c.ok(r.asyncAccess.release(a.ticket),'copy PBO release');c.equal([...c.ok(s.readBacking(1,0,1),'primary copy presence bytes').bytes],[77],'copy read destination is staging');const uploadAsync=r.operation(copyTransfer(m,l.level,box(l.width,l.height),2,1,5,l.width*4+3),true);uploadAsync.record.input=await blob(evidence,input.bytes);c.ok(r.asyncAccess.provideInput(uploadAsync.ticket,input.bytes),'clone dense async original staging rows');c.ok(r.asyncAccess.upload(uploadAsync.ticket),'actual asynchronous copy selected mip');c.ok(r.asyncAccess.release(uploadAsync.ticket),'retire async staging snapshot');await recordLevel(r,evidence,c,m,l.level,canonical(format,input.bytes),'async-copy-upload');}}
  finally{await r.finish();}
}

async function generations(gl,evidence,c){
  const r=rig(gl,evidence,c),s=r.store,m=metadata(),l=levels(m)[1],src=image(67,l.width,l.height,1,0xdeadbeef);r.run.originalMetadata=m;c.ok(s.createContext(1),'generation context');const old=c.ok(s.createResource(m),'old mip resource').resource;c.ok(s.attachContext(1,1),'old attachment');const p=r.operation(inline(m,1,box(l.width,l.height),src.bytes));p.record.input=await blob(evidence,src.bytes);c.ok(s.executeTransfer(p.ticket),'old GPU data');const lease=c.ok(s.retainStorage(1,1,'view'),'retained exact mip storage').lease,storage=c.ok(r.bindings.resolve(lease),'old native identity');c.ok(s.unref(1),'remove public old mip');const fresh=c.ok(s.createResource(m),'reuse numeric mip ID').resource;c.ok(s.attachContext(1,1),'new numeric attachment');c.equal(fresh.generation>old.generation,true,'numeric reuse creates fresh native generation');c.equal(c.ok(r.bindings.resolve(lease),'lease survives public reuse').storage.texture===storage.storage.texture,true,'lease retains exact native allocation');c.equal([...nativeRead(gl,storage.storage.texture,67,l.width,l.height,1)],nativeFromGuest(67,src.bytes),'retained mip texels are original GPU bytes');c.equal(c.ok(s.inspect(),'two complete chains').budgets.gpuBytes,2*levels(m).reduce((n,x)=>n+x.byteLength,0),'retained old full chain remains charged');c.ok(s.releaseStorage(lease),'old complete chain release');
  c.ok(s.attachBacking(1,[new Uint8Array(140)]),'new transfer source backing');
  for(const mode of ['backing','attachment','context']){const prepared=r.operation(transfer(m,1,box(l.width,l.height)));if(mode==='backing'){c.ok(s.detachBacking(1),'revoke original backing');c.ok(s.attachBacking(1,[new Uint8Array(140)]),'replace backing');}else if(mode==='attachment'){c.ok(s.detachContext(1,1),'revoke attachment');c.ok(s.attachContext(1,1),'replace membership');}else{c.ok(s.destroyContext(1),'revoke context');c.ok(s.createContext(1),'replace context');c.ok(s.attachContext(1,1),'replacement context attachment');}c.bad(s.executeTransfer(prepared.ticket),'prepared '+mode+' generation rejects','stale-ticket');prepared.record.rejected=true;}
  const cancel=r.operation(transfer(m,1,box(l.width,l.height)));c.ok(s.cancelTransfer(cancel.ticket),'original cancel releases reservation');cancel.record.cancelled=true;
  await r.finish();
}

async function gpuOnly(gl,evidence,c,format){
  const r=rig(gl,evidence,c),s=r.store,m=metadata(1,7,5,2,format),l=levels(m)[1];r.run.originalMetadata=m;c.ok(s.createContext(1),'GPU-only context');c.ok(s.createResource(m),'GPU-only mip resource');c.ok(s.attachContext(1,1),'GPU-only attach');c.ok(s.attachBacking(1,[new Uint8Array(140).fill(0x17)]),'GPU-only unchanged guest bytes');const texture=r.allocations.get(1).storage.texture,fb=gl.createFramebuffer(),rgba=format===233?[1/1023,257/1023,1022/1023,1]:[37/255,113/255,199/255,17/255];
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,1);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.colorMask(true,true,true,true);gl.disable(gl.SCISSOR_TEST);gl.clearBufferfv(gl.COLOR,0,rgba);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,null);gl.deleteFramebuffer(fb);
  const bytes=new Uint8Array(l.byteLength),v=new DataView(bytes.buffer);for(let i=0;i<l.width*l.height;i++){if(format===233)v.setUint32(i*4,(1022+257*1024+1*1048576+3221225472)>>>0,true);else bytes.set(format===2?[199,113,37,255]:[37,113,199,17],i*4);}
  try{const p=r.operation(transfer(m,1,box(l.width,l.height),2),true);p.record.gpuOnly={level:1,rgba};c.ok(r.asyncAccess.beginTransferRead(p.ticket),'GPU-only actual mip PBO');const out=await r.wait(p.ticket,p.record);c.ok(r.asyncAccess.release(p.ticket),'GPU-only PBO release');c.equal([...out],[...bytes],'GPU-only native overwrite after completed fence defeats CPU mirror');await recordLevel(r,evidence,c,m,1,bytes,'GPU-only-overwrite');c.equal([...c.ok(s.readBacking(1,0,140),'GPU-only backing unchanged').bytes],Array(140).fill(0x17),'GPU-only original backing is unchanged');}
  finally{await r.finish();}
}

async function budgetCases(gl,evidence,c){
  const m=metadata(),chain=levels(m),total=chain.reduce((n,l)=>n+l.byteLength,0),tight=chain[0].byteLength;
  for(const undersized of [false,true]){
    const r=rig(gl,evidence,c,{limits:{resourceBytes:total,gpuBytes:total+tight-(undersized?1:0),cpuBytes:total+tight,scratchBytes:tight}}),s=r.store;r.run.originalMetadata=m;
    c.ok(s.createContext(1),'budget context');const original=c.ok(s.createResource(m),'exact full mip allocation').resource;c.ok(s.attachContext(1,1),'budget attachment');c.ok(s.attachBacking(1,[new Uint8Array(total)]),'exact budget original backing');const p=r.operation(transfer(m,0,box(m.width,m.height),2),true);
    if(undersized){c.bad(r.asyncAccess.beginTransferRead(p.ticket),'one byte short native PBO charge','limit-exceeded');p.record.rejected=true;}
    else{c.ok(r.asyncAccess.beginTransferRead(p.ticket),'exact complete mip and PBO budget');c.equal(c.ok(s.inspect(),'maximum native read budget').budgets.gpuBytes,total+tight,'PBO staged bytes plus every mip level charged exactly');await r.wait(p.ticket,p.record);}
    c.ok(r.asyncAccess.release(p.ticket),'budget PBO reservation release');const lease=c.ok(s.retainStorage(1,1,'surface'),'budget retained mip identity').lease;c.ok(s.unref(1),'budget old public unref');c.bad(s.createResource(m),'retained chain forbids bypassing complete GPU budget','limit-exceeded');c.ok(s.releaseStorage(lease),'budget retained chain release');const replacement=c.ok(s.createResource(m),'budget reuse after actual storage release').resource;c.equal(replacement.generation>original.generation,true,'budget generation advances after retained release');await r.finish();
  }
}

async function nativeFaults(gl,evidence,c){
  const r=rig(gl,evidence,c),s=r.store,m=metadata(),l=levels(m)[1];r.run.originalMetadata=m;c.ok(s.createContext(1),'fault context');
  for(const control of ['allocate','storage']){r.setControl(control);c.bad(s.createResource(m),'native '+control+' failure','backend-error');r.setControl(null);c.equal(c.ok(s.inspect(),'allocation failure charges').budgets.gpuBytes,0,'allocation failure cannot publish/charge native mip');}
  c.ok(s.createResource(m),'fault valid mip');c.ok(s.attachContext(1,1),'fault attachment');c.ok(s.attachBacking(1,[new Uint8Array(140)]),'fault backing');
  r.setControl('upload');const p=r.operation(transfer(m,1,box(l.width,l.height)));c.bad(s.executeTransfer(p.ticket),'actual native upload error','backend-error');p.record.rejected=true;r.setControl(null);
  for(const control of ['staging','fence']){const read=r.operation(transfer(m,1,box(l.width,l.height),2),true);r.setControl(control);c.bad(r.asyncAccess.beginTransferRead(read.ticket),'native '+control+' failure','backend-error');r.setControl(null);c.ok(r.asyncAccess.release(read.ticket),'fault pending original release');read.record.rejected=true;c.equal(c.ok(s.inspect(),'native staging/fence failure budget').budgets.scratchBytes,0,'native staged failure scratch retires');}
  await r.finish();
}

async function sabotage(gl,evidence,c,fault){
  const r=rig(gl,evidence,c,{fault}),s=r.store,m=metadata(),l=levels(m)[1],input=image(67,l.width,l.height,1,0x9e3779b9);r.run.originalMetadata=m;c.ok(s.createContext(1),'fault original context');c.ok(s.createResource(m),'fault original native allocation');c.ok(s.attachContext(1,1),'fault original native attachment');c.ok(s.attachBacking(1,[new Uint8Array(140)]),'fault original backing');
  try{const up=r.operation(inline(m,1,box(l.width,l.height),input.bytes));up.record.input=await blob(evidence,input.bytes);c.ok(s.executeTransfer(up.ticket),'fault actual original upload');up.record.completed=true;const read=r.operation(transfer(m,1,box(l.width,l.height),2),true);c.ok(r.asyncAccess.beginTransferRead(read.ticket),'fault actual original read issue');const out=await r.wait(read.ticket,read.record);c.ok(r.asyncAccess.release(read.ticket),'fault completed PBO release');evidence.sabotage={fault,expected:await blob(evidence,input.bytes),observed:await blob(evidence,out),fenceCompleted:read.record.fenceCompleted,held:JSON.stringify([...out])===JSON.stringify([...input.bytes])};c.equal([...out],[...input.bytes],'independent original level oracle after completed native fence');}
  finally{await r.finish();}
}

export async function runAcceptance({smoke=false,fault=null,seed=0x243f6a88}={}){
  const c=checks(),canvas=document.querySelector('#gpu'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});if(!gl)throw Error('actual WebGL2 required');const ext=gl.getExtension('WEBGL_debug_renderer_info'),renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);if(!/Metal.*M4|M4.*Metal/.test(renderer))throw Error('actual M4 Metal required');const evidence={schema:'original-mip-storage-v1',guestExecution:false,productionNegotiation:false,gpu:{renderer},runs:[],levels:[],blobs:[],predictions:c.predictions};window.__standardTextureEvidence=evidence;
  if(fault)await sabotage(gl,evidence,c,fault);
  else{
    for(const format of [2,67,233])for(const [width,height,lastLevel]of (smoke?[[7,5,2]]:[[7,5,2],[8,4,3],[1,9,3],[13,1,3],[31,19,2]]))for(const bind of (smoke?[10]:[2,8,10,10|1310720])){seed=tickSeed(seed);await matrix(gl,evidence,c,metadata(1,width,height,lastLevel,format,bind),seed);}
    if(!smoke){for(const [width,height]of [[16384,1],[1,16384]])await matrix(gl,evidence,c,metadata(1,width,height,14,67,10),tickSeed(seed));for(const format of [2,67,233]){await copyCases(gl,evidence,c,format);await gpuOnly(gl,evidence,c,format);}await generations(gl,evidence,c);await budgetCases(gl,evidence,c);await nativeFaults(gl,evidence,c);}
  }
  return evidence;
}
