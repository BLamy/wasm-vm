// Depth sampling, attachment bits and occlusion are independent of inverse bytes.
import { computeTransferLayout, createResourceStore, createWebGL2TransferBackend } from '../resources.mjs';
import { decodeSubmission } from '../decoder.mjs';
import { createVirglStateRenderer } from '../state.mjs';

const meta=(id=1,width=3,height=2)=>({id,target:2,format:16,bind:1,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const box=(width=3,height=2,x=0,y=0)=>({x,y,z:0,width,height,depth:1});
const words=[0,1,255,256,32768,65535];
const bytes=Uint8Array.from([0,0,1,0,255,0,0,1,0,128,255,255]);
const transfer=(id=1,direction=1)=>({opcode:43,fields:{resourceHandle:id,level:0,usage:0,stride:17,layerStride:34,box:box(),dataOffset:5,direction}});
const copy=(flags)=>({opcode:45,fields:{resourceHandle:1,level:0,usage:0,stride:17,layerStride:34,box:box(),stagingResourceHandle:2,stagingOffset:5,flags}});
function checks(){
  const rows=[];
  const equal=(observed,expected,prediction)=>{const held=JSON.stringify(observed)===JSON.stringify(expected);rows.push({prediction,expected,observed,held});if(!held)throw new Error(`${prediction}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(observed)}`);};
  const ok=(r,label)=>{equal(r?.ok,true,`${label} (${r?.error?.code??''}: ${r?.error?.message??''})`);return r;};
  const bad=(r,label,code)=>{equal(r?.ok,false,label+' rejects');if(code)equal(r.error.code,code,label+' code');return r;};
  return{equal,ok,bad,rows};
}
function packet(op,type,values){const b=new Uint8Array(4+values.length*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(values.length<<16),true);values.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
function padded(input=bytes){const out=new Uint8Array(41).fill(0xa7);out.set(input.subarray(0,6),5);out.set(input.subarray(6),22);return out;}
function backing(store,id,c,input){if(input){c.ok(store.writeBacking(id,0,input.subarray(0,24)),'bounded prefix write');c.ok(store.writeBacking(id,24,input.subarray(24)),'bounded suffix write');}else return Uint8Array.from([...c.ok(store.readBacking(id,0,24),'bounded prefix read').bytes,...c.ok(store.readBacking(id,24,17),'bounded suffix read').bytes]);}
async function sha(data){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');}
function dispose(r,c,label){if(r.renderer)c.ok(r.renderer.dispose(),label+' state dispose');c.ok(r.store.dispose(),label+' store dispose');for(const[k,v]of Object.entries(c.ok(r.store.inspect(),label+' final inspection').budgets))c.equal(v,0,label+' released '+k);}

export function runNativeDepthAcceptance(){
  const c=checks(),backend={maxTextureSize:16384,allocate:m=>({metadata:m}),destroy(){},upload(){},readback:(s,m,l)=>new Uint8Array(l.tightBytes),dispose(){}};
  const r=c.ok(createResourceStore({backend}),'native depth store');c.ok(r.store.createContext(1),'native depth context');
  const created=c.ok(r.store.createResource(meta()),'required depth metadata').resource;c.equal([created.kind,created.byteLength],['depth-texture',12],'Z16 uses two guest/storage bytes per pixel');c.ok(r.store.attachContext(1,1),'native depth membership');
  for(const role of ['depth-surface','readback']){const lease=c.ok(r.store.retainStorage(1,1,role),'admitted '+role).lease;c.equal(c.ok(r.bindings.resolve(lease),'depth resolved lease').metadata.format,16,'depth format retained');c.ok(r.store.releaseStorage(lease),'depth lease release');}
  for(const role of ['view','surface','vertex','index'])c.bad(r.store.retainStorage(1,1,role),'forbidden depth '+role,'unsupported-resource');
  c.bad(r.bindings.retainScanout(1,created.generation),'depth scanout','unsupported-resource');dispose(r,c,'native required depth');
  for(const change of [...Array.from({length:301},(_,format)=>({format})).filter(x=>x.format!==16),
    ...Array.from({length:32},(_,bit)=>({bind:(1|2**bit)>>>0})).filter(x=>x.bind!==1),
    {bind:0},{target:0},{target:1},{target:3},{flags:1},{lastLevel:1},{arraySize:2},{depth:2},{nrSamples:4}]){
    const s=c.ok(createResourceStore({backend}),'forbidden format/role store');c.bad(s.store.createResource({...meta(),...change}),'unmeasured depth profile','unsupported-resource');dispose(s,c,'forbidden depth');
  }
  const upload=c.ok(computeTransferLayout(meta(),transfer().fields,28),'depth odd upload exact fit').layout;
  c.equal([upload.rowBytes,upload.rowStride,upload.tightBytes,upload.requiredEnd,upload.scratchBytes,upload.conversionBytes,upload.stagingBytes],[6,17,12,28,12,0,0],'depth upload logical layout');
  const read=c.ok(computeTransferLayout(meta(),transfer(1,2).fields,28),'depth odd read exact fit').layout;
  c.equal([read.tightBytes,read.scratchBytes,read.conversionBytes,read.stagingBytes],[12,24,24,48],'depth inverse charges RGBA conversion plus PBO');
  c.bad(computeTransferLayout(meta(),transfer().fields,27),'one byte short depth backing','out-of-bounds');
  c.bad(computeTransferLayout(meta(),{...transfer().fields,stride:5} ,41),'overlapping depth rows','out-of-bounds');
  c.bad(computeTransferLayout(meta(1,1024,768),{...transfer().fields,box:box(1024,768),stride:0,layerStride:0,dataOffset:0},1572864,{resourceBytes:1572863}),'depth allocation per-resource boundary','out-of-bounds');
  c.bad(decodeSubmission(packet(1,8,[4,1,17,0,0])),'Z32 surface decoder stays closed','unsupported-feature');
  c.bad(decodeSubmission(packet(1,6,[4,1,16,0,0,0x688])),'depth guest sampler view stays closed','unsupported-feature');
  return{status:'passed',boundary:'Metadata/roles/layout only; no memory-backend GPU claim.',assertions:c.rows};
}

function rig(gl,c,{limits,renderer=false,intercept}={}){
  const calls=[],allocations=new Map(),names={textures:new Set(),buffers:new Set(),shaders:new Set(),programs:new Set(),syncs:new Set()},nameKind={Texture:'textures',Buffer:'buffers',Shader:'shaders',Program:'programs',Sync:'syncs'};
  let store;
  const traced=new Proxy(gl,{get(t,k){const v=Reflect.get(t,k,t);if(typeof v!=='function')return v;return(...args)=>{
    const budget=store?.inspect().budgets;
    if(k==='texStorage2D')calls.push({op:k,internalFormat:args[2],width:args[3],height:args[4],budget});
    if(k==='texSubImage2D')calls.push({op:k,format:args[6],type:args[7],bytes:args[8].byteLength,first:[...args[8].slice(0,6)]});
    if(k==='bufferData')calls.push({op:k,target:args[0],bytes:typeof args[1]==='number'?args[1]:args[1].byteLength,budget});
    if(k==='readPixels')calls.push({op:k,format:args[4],type:args[5],pbo:typeof args[6]==='number',x:args[0],y:args[1],width:args[2],height:args[3],budget});
    const result=intercept?intercept(t,k,args,()=>v.apply(t,args)):v.apply(t,args);
    for(const[type,kind]of Object.entries(nameKind)){if(k==='create'+type||k==='fence'+type){if(result)names[kind].add(result);}else if(k==='delete'+type)names[kind].delete(args[0]);}
    return result;
  };}});
  const native=c.ok(createWebGL2TransferBackend(traced),'real depth backend').backend;
  const backend={...native,allocate(m){const s=native.allocate(m);allocations.set(m.id,s);return s;}};
  const r=c.ok(createResourceStore({backend,...(limits?{limits}:{})}),'real depth store');store=r.store;
  const state=renderer?c.ok(createVirglStateRenderer({gl:traced,resources:store,bindings:r.bindings,shaderBridge:{translate(){throw new Error('depth surface proof has no guest shader');}}}),'depth state renderer').renderer:null;
  return{...r,renderer:state,allocations,calls,names};
}
function program(gl,fragment){
  const p=gl.createProgram(),shaders=[];
  for(const[type,text]of [[gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0,1);}'],[gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;'+fragment]]){
    const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);
  }
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
  return{p,dispose(){gl.useProgram(null);gl.deleteProgram(p);for(const s of shaders)gl.deleteShader(s);}};
}
function reset(gl){
  for(const cap of [gl.BLEND,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.SCISSOR_TEST,gl.CULL_FACE,gl.DITHER,gl.RASTERIZER_DISCARD,gl.SAMPLE_ALPHA_TO_COVERAGE,gl.SAMPLE_COVERAGE])gl.disable(cap);
  gl.colorMask(true,true,true,true);gl.depthRange(0,1);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
  for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
}
// Float attachment observes normalized hardware sampling without the backend's
// byte-packing shader or inverse conversion. It never returns guest-format bytes.
function sampleFloat(gl,texture,width,height){
  if(!gl.getExtension('EXT_color_buffer_float'))throw new Error('independent float depth oracle unavailable');
  const out=gl.createTexture(),fb=gl.createFramebuffer(),vao=gl.createVertexArray(),shader=program(gl,'uniform highp sampler2D src;out vec4 color;void main(){color=vec4(texelFetch(src,ivec2(gl_FragCoord.xy),0).r,0,0,1);}');
  try{
    reset(gl);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,out);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,width,height);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,out,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('float oracle framebuffer incomplete');
    gl.bindVertexArray(vao);gl.useProgram(shader.p);gl.viewport(0,0,width,height);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(0,null);gl.uniform1i(gl.getUniformLocation(shader.p,'src'),0);gl.drawArrays(gl.TRIANGLES,0,3);
    const data=new Float32Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,data);return data;
  }finally{shader.dispose();gl.deleteVertexArray(vao);gl.deleteFramebuffer(fb);gl.deleteTexture(out);}
}
function depthSample(gl,texture,values,width,height,c,label){
  const data=sampleFloat(gl,texture,width,height);let maxError=0,firstMismatch=null;
  for(let i=0;i<values.length;i++){const actual=data[i*4],expected=values[i]/65535,error=Math.abs(actual-expected);maxError=Math.max(maxError,error);if((!Number.isFinite(actual)||error>1/(65535*128)||data[i*4+3]!==1)&&firstMismatch===null)firstMismatch={index:i,expected,actual};}
  c.equal(firstMismatch,null,label+' independent normalized depth sampling');c.equal(gl.getError(),gl.NO_ERROR,label+' sampling GL errors');return{count:values.length,maxError,first:Array.from(data.subarray(0,24)),data};
}
function attachmentAndOcclusion(gl,texture,values,width,height,c,label){
  const out=gl.createTexture(),fb=gl.createFramebuffer(),vao=gl.createVertexArray(),shader=program(gl,'uniform float probe;out vec4 color;void main(){gl_FragDepth=probe;color=vec4(1,0,0,1);}');
  const probes=[0,1,2,254,255,256,257,32767,32768,32769,65534,65535],observations=[];
  try{
    reset(gl);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,out);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,width,height);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,out,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,texture,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);
    c.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,label+' physical depth/color FBO');
    const bits=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE);c.equal(bits,16,label+' actual depth attachment bits');
    c.equal(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE),0,label+' no invented stencil storage');
    gl.bindVertexArray(vao);gl.useProgram(shader.p);gl.viewport(0,0,width,height);gl.enable(gl.DEPTH_TEST);gl.depthMask(false);gl.depthFunc(gl.LESS);
    for(const probe of probes){gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniform1f(gl.getUniformLocation(shader.p,'probe'),probe/65535);gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      const observed=values.map((_,i)=>pixels[i*4]),expected=values.map(n=>probe<n?255:0);c.equal(observed,expected,label+' physical LESS occlusion at UN16 '+probe);observations.push({probe,observed});}
    return{bits,stencilBits:0,observations};
  }finally{gl.depthMask(true);shader.dispose();gl.deleteVertexArray(vao);gl.deleteFramebuffer(fb);gl.deleteTexture(out);reset(gl);}
}
async function waitRead(access,ticket,c,delays=0){
  for(let i=0;i<delays;i++)c.equal(c.ok(access.poll(ticket),'withheld real fence').status,'pending','scheduled timeout cannot publish bytes');
  for(let i=0;i<200;i++){const r=c.ok(access.poll(ticket),'actual depth fence poll');if(r.status==='ready')return r.bytes;await new Promise(resolve=>setTimeout(resolve,1));}throw new Error('depth PBO fence did not complete');
}
function poison(gl){
  for(const cap of [gl.BLEND,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.SCISSOR_TEST,gl.CULL_FACE,gl.DITHER,gl.RASTERIZER_DISCARD,gl.SAMPLE_ALPHA_TO_COVERAGE,gl.SAMPLE_COVERAGE])gl.enable(cap);
  gl.scissor(0,0,0,0);gl.colorMask(false,false,false,false);gl.viewport(0,0,0,0);gl.depthFunc(gl.NEVER);
  gl.activeTexture(gl.TEXTURE0);const sampler=gl.createSampler();gl.samplerParameteri(sampler,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);gl.bindSampler(0,sampler);return()=>gl.deleteSampler(sampler);
}
function init(r,c,metadata=meta(),source=padded()){
  c.ok(r.store.createContext(1),'depth test context');const created=c.ok(r.store.createResource(metadata),'depth test create').resource;c.ok(r.store.attachContext(1,metadata.id),'depth test attach');
  if(source)c.ok(r.store.attachBacking(metadata.id,[source.subarray(0,7),source.subarray(7,24),source.subarray(24)]),'owned split/unaligned depth backing');return created;
}
function upload(r,c,command=transfer()){c.ok(r.store.executeTransfer(c.ok(r.store.prepareTransfer(1,command),'depth upload prepare').ticket),'depth upload execute');}

async function allEncodings(gl,c){
  const width=256,height=256,input=new Uint8Array(131072),values=Array.from({length:65536},(_,i)=>i);for(let i=0;i<65536;i++){input[i*2]=i%256;input[i*2+1]=Math.floor(i/256);}
  const r=rig(gl,c);init(r,c,meta(1,width,height),null);c.ok(r.store.attachBacking(1,[input]),'all UN16 encodings backing');
  const command={opcode:43,fields:{...transfer().fields,box:box(width,height),stride:0,layerStride:0,dataOffset:0}};upload(r,c,command);
  const physical=depthSample(gl,r.allocations.get(1).texture,values,width,height,c,'all65536');
  const lease=c.ok(r.store.retainStorage(1,1,'readback'),'all encodings read lease').lease;
  const guest=c.ok(r.store.readStorage(lease),'all encodings sync inverse').bytes;c.equal(await sha(guest),await sha(input),'all65536 GPU inverse guest encodings');c.equal(guest.buffer.byteLength,262144,'inverse view retains charged RGBA scratch only');
  const ticket=c.ok(r.asyncAccess.beginStorageRead(lease,box(width,height)),'all encodings real PBO').ticket;const asyncBytes=await waitRead(r.asyncAccess,ticket,c);c.equal(await sha(asyncBytes),await sha(input),'all65536 async GPU inverse guest encodings');c.ok(r.asyncAccess.release(ticket),'all encodings PBO release');c.ok(r.store.releaseStorage(lease),'all encodings lease release');
  const result={encodings:65536,width,height,maxSampleError:physical.maxError,sampleSha256:await sha(new Uint8Array(physical.data.buffer)),guestSha256:await sha(guest),calls:r.calls};dispose(r,c,'all encodings');c.equal(gl.getError(),gl.NO_ERROR,'all encodings final GL errors');return result;
}
async function rows(gl,c){
  let remaining=0;const r=rig(gl,c,{limits:{resourceBytes:64,cpuBytes:65,gpuBytes:60,scratchBytes:24},intercept:(t,k,a,next)=>k==='clientWaitSync'&&remaining>0?(remaining--,t.TIMEOUT_EXPIRED):next()});
  const source=padded();init(r,c,meta(),source);source.fill(0);upload(r,c);
  const texture=r.allocations.get(1).texture,physical=depthSample(gl,texture,words,3,2,c,'literal boundary rows'),occlusion=attachmentAndOcclusion(gl,texture,words,3,2,c,'literal boundary rows');
  const lease=c.ok(r.store.retainStorage(1,1,'depth-surface'),'exact depth surface lease').lease;
  const undo=poison(gl),guest=c.ok(r.store.readStorage(lease),'poisoned sync inverse').bytes;undo();c.equal([...guest],[...bytes],'literal inverse little-endian16 words');
  backing(r.store,1,c,new Uint8Array(41).fill(0xa7));c.ok(r.store.executeTransfer(c.ok(r.store.prepareTransfer(1,transfer(1,2)),'odd depth scatter prepare').ticket),'odd depth inverse scatter');c.equal([...backing(r.store,1,c)],[...padded()],'sync inverse leaves all odd padding unchanged');
  const uploadTicket=c.ok(r.asyncAccess.prepareTransfer(1,transfer()),'async owned depth upload').ticket,input=new Uint8Array(bytes);c.ok(r.asyncAccess.provideInput(uploadTicket,input),'depth owned dense input');input.fill(99);c.ok(r.asyncAccess.upload(uploadTicket),'async actual UN16 upload');c.ok(r.asyncAccess.release(uploadTicket),'async depth upload release');depthSample(gl,texture,words,3,2,c,'async literal rows');
  const pending=[];
  for(const delay of [0,1,3]){remaining=delay;const unpoison=poison(gl),ticket=c.ok(r.asyncAccess.beginStorageRead(lease,box()),'poisoned real depth PBO').ticket;unpoison();const budgets=c.ok(r.store.inspect(),'depth PBO pressure').budgets;c.equal([budgets.gpuBytes,budgets.cpuBytes,budgets.scratchBytes],[60,65,24],'conversion and PBO charge exact GPU60 CPU65 scratch24');
    const read=await waitRead(r.asyncAccess,ticket,c,delay);c.equal([...read],[...bytes],'async inverse after fence delay '+delay);c.equal(read.buffer.byteLength,24,'async view owns charged24 bytes');c.ok(r.asyncAccess.release(ticket),'depth PBO release');c.equal(c.ok(r.store.inspect(),'released depth pressure').budgets.gpuBytes,12,'temporary GPU accounting released');pending.push({delay,budgets});}
  const readCalls=r.calls.filter(x=>x.op==='readPixels');c.equal(readCalls.every(x=>x.format===gl.RGBA&&x.type===gl.UNSIGNED_BYTE),true,'WebGL never attempts forbidden depth readPixels');
  c.equal(r.calls.filter(x=>x.op==='texSubImage2D').every(x=>x.format===gl.DEPTH_COMPONENT&&x.type===gl.UNSIGNED_SHORT),true,'native upload is DEPTH_COMPONENT UNSIGNED_SHORT');
  const conversions=r.calls.filter(x=>x.op==='texStorage2D'&&x.internalFormat===gl.RGBA8);c.equal(conversions.length>0,true,'real region conversion images allocated');c.equal(conversions.every(x=>x.width===3&&x.height===2&&x.budget.gpuBytes>=36),true,'conversion texture is bounded and charged before allocation');
  c.equal(r.calls.filter(x=>x.op==='bufferData'&&x.target===gl.PIXEL_PACK_BUFFER).every(x=>x.bytes===24&&x.budget.gpuBytes===60),true,'both GPU images reserved before PBO allocation');
  c.ok(r.store.releaseStorage(lease),'depth surface release');const result={guestWords:words,maxSampleError:physical.maxError,attachment:occlusion,pending,calls:r.calls};dispose(r,c,'literal rows');c.equal(gl.getError(),gl.NO_ERROR,'literal rows GL errors');return result;
}

async function copies(gl,c){
  const r=rig(gl,c,{limits:{resourceBytes:64,cpuBytes:66,gpuBytes:60,scratchBytes:24}});init(r,c,meta(),new Uint8Array([77]));
  c.ok(r.store.createResource({id:2,target:0,format:64,bind:524288,width:41,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'depth staging resource');c.ok(r.store.attachContext(1,2),'depth staging membership');c.ok(r.store.attachBacking(2,[padded().subarray(0,7),padded().subarray(7,24),padded().subarray(24)]),'depth split staging backing');upload(r,c,copy(1));depthSample(gl,r.allocations.get(1).texture,words,3,2,c,'staging depth rows');
  backing(r.store,2,c,new Uint8Array(41).fill(0xa7));c.ok(r.store.executeTransfer(c.ok(r.store.prepareTransfer(1,copy(3)),'depth staging inverse prepare').ticket),'depth staging inverse scatter');c.equal([...backing(r.store,2,c)],[...padded()],'depth staging preserves padding');c.equal([...c.ok(r.store.readBacking(1,0,1),'primary unchanged').bytes],[77],'depth copy never overwrites primary');
  const up=c.ok(r.asyncAccess.prepareTransfer(1,copy(1)),'depth async staging upload');c.equal(up.resource.id,2,'depth async input names staging identity');c.ok(r.asyncAccess.provideInput(up.ticket,new Uint8Array(bytes)),'depth async staging dense input');c.ok(r.asyncAccess.upload(up.ticket),'depth async staging upload issued');c.ok(r.asyncAccess.release(up.ticket),'depth async staging upload release');
  backing(r.store,2,c,new Uint8Array(41).fill(0xa7));const read=c.ok(r.asyncAccess.prepareTransfer(1,copy(3)),'depth async staging read');c.equal([read.resource.id,read.layout.offset,read.layout.rowStride],[2,5,17],'depth external scatter metadata');c.ok(r.asyncAccess.beginTransferRead(read.ticket),'depth actual staging PBO');c.equal([...await waitRead(r.asyncAccess,read.ticket,c)],[...bytes],'depth staging PBO inverse');c.ok(r.asyncAccess.release(read.ticket),'depth staging PBO release');c.equal([...backing(r.store,2,c)],Array(41).fill(0xa7),'external DMA has no premature private scatter');
  const result={calls:r.calls};dispose(r,c,'depth copy');c.equal(gl.getError(),gl.NO_ERROR,'copy depth GL errors');return result;
}

async function partial(gl,c){
  const values=[7,256,513,1024,65000, 0,1,255,256,65535, 32767,32768,32769,4095,4096, 8191,8192,8193,16383,16384, 65534,65533,65532,2,3];
  const expected=values.slice(6,9).concat(values.slice(11,14),values.slice(16,19)),input=new Uint8Array(57).fill(0xa7);
  for(let i=0;i<values.length;i++){input[i*2]=values[i]%256;input[i*2+1]=Math.floor(values[i]/256);}
  const command={opcode:43,fields:{...transfer().fields,box:box(3,3,1,1),dataOffset:7,layerStride:51,direction:2}};
  const result=[];
  for(const limits of [{gpuBytes:122,cpuBytes:93,scratchBytes:36},{gpuBytes:121,cpuBytes:93,scratchBytes:36},{gpuBytes:122,cpuBytes:92,scratchBytes:36},{gpuBytes:122,cpuBytes:93,scratchBytes:35}]){
    const r=rig(gl,c,{limits});init(r,c,meta(1,5,5),input);
    for(let y=0;y<5;y++)upload(r,c,{opcode:43,fields:{...transfer().fields,box:box(5,1,0,y),dataOffset:y*10,stride:10,layerStride:10}});
    const texture=r.allocations.get(1).texture;depthSample(gl,texture,values,5,5,c,'partial source grid');
    const lease=c.ok(r.store.retainStorage(1,1,'readback'),'partial lease').lease;
    if(limits.gpuBytes===122&&limits.cpuBytes===93&&limits.scratchBytes===36){
      const packed=c.ok(r.store.readStorage(lease,box(3,3,1,1)),'partial sync inverse').bytes;
      const observed=Array.from({length:9},(_,i)=>packed[i*2]+256*packed[i*2+1]);c.equal(observed,expected,'partial GPU conversion uses original x/y origin');
      c.ok(r.store.writeBacking(1,0,new Uint8Array(36).fill(0xa7)),'partial clear bounded prefix');c.ok(r.store.writeBacking(1,36,new Uint8Array(21).fill(0xa7)),'partial clear bounded suffix');
      c.ok(r.store.executeTransfer(c.ok(r.store.prepareTransfer(1,command),'partial odd scatter prepare').ticket),'partial odd scatter');
      const scatter=Uint8Array.from([...c.ok(r.store.readBacking(1,0,36),'partial prefix').bytes,...c.ok(r.store.readBacking(1,36,21),'partial suffix').bytes]),wanted=new Uint8Array(57).fill(0xa7);
      for(let row=0;row<3;row++)wanted.set(packed.subarray(row*6,row*6+6),7+17*row);c.equal([...scatter],[...wanted],'partial inverse leaves prefix/odd-row/suffix padding');
      const ticket=c.ok(r.asyncAccess.beginStorageRead(lease,box(3,3,1,1)),'partial actual PBO').ticket,budget=c.ok(r.store.inspect(),'partial live charges').budgets;
      c.equal([budget.gpuBytes,budget.cpuBytes,budget.scratchBytes],[122,93,36],'partial GPU122 CPU93 scratch36 exact charges');c.equal([...await waitRead(r.asyncAccess,ticket,c)],[...packed],'partial async matches independent region words');c.ok(r.asyncAccess.release(ticket),'partial release');
      depthSample(gl,texture,values,5,5,c,'partial read preserves every source neighbor');
      c.equal(r.calls.filter(x=>x.op==='texStorage2D'&&x.internalFormat===gl.RGBA8).every(x=>x.width===3&&x.height===3),true,'partial conversion never allocates a full depth shadow');
    }else{const before=c.ok(r.store.inspect(),'partial pressure baseline').budgets;c.bad(r.asyncAccess.beginStorageRead(lease,box(3,3,1,1)),'partial one-byte-short pressure','limit-exceeded');c.equal(c.ok(r.store.inspect(),'partial pressure rollback').budgets,before,'partial quota rollback');c.equal(r.calls.some(x=>x.op==='readPixels'),false,'partial quota rejects before readback');}
    result.push({limits,calls:r.calls});c.ok(r.store.releaseStorage(lease),'partial lease release');dispose(r,c,'partial depth');c.equal(gl.getError(),gl.NO_ERROR,'partial final GL errors');
  }
  return result;
}

async function lifetimes(gl,c){
  const results=[];
  for(const format of [16,67,233]){
    const r=rig(gl,c);const old=init(r,c);upload(r,c);const lease=c.ok(r.store.retainStorage(1,1,'readback'),'old depth lease').lease,ticket=c.ok(r.asyncAccess.beginStorageRead(lease,box()),'old depth PBO').ticket;
    c.ok(r.store.unref(1),'old depth public unref');const fresh=c.ok(r.store.createResource({...meta(),format,bind:format===16?1:10}),'reuse public ID').resource;c.ok(r.store.attachContext(1,1),'new public membership');c.equal(fresh.generation>old.generation,true,'fresh generation monotonic');c.equal(c.ok(r.bindings.resolve(lease),'old exact lease').metadata.format,16,'old depth cannot become new format');c.equal([...await waitRead(r.asyncAccess,ticket,c)],[...bytes],'old PBO retains UN16 decoding despite new '+format);
    c.ok(r.asyncAccess.release(ticket),'old PBO release');c.ok(r.store.releaseStorage(lease),'old lease release');c.equal(c.ok(r.store.inspect(),'old collected GPU').budgets.gpuBytes,format===16?12:24,'old conversion/source collected exactly once');results.push({newFormat:format,oldGeneration:old.generation,newGeneration:fresh.generation});dispose(r,c,'depth generation');
  }
  for(const mode of ['contents','lease','backing','cancel','dispose']){
    const r=rig(gl,c);init(r,c);upload(r,c);const lease=c.ok(r.store.retainStorage(1,1,'readback'),'revocation lease').lease;
    const prepared=mode==='backing'?c.ok(r.asyncAccess.prepareTransfer(1,transfer(1,2)),'backing snapshot read'):c.ok(r.asyncAccess.beginStorageRead(lease,box()),'storage revocation read');if(mode==='backing')c.ok(r.asyncAccess.beginTransferRead(prepared.ticket),'backing PBO issue');
    if(mode==='contents'){upload(r,c);c.bad(r.asyncAccess.poll(prepared.ticket),'changed contents fail closed','stale-storage');}
    if(mode==='lease'){c.ok(r.store.releaseStorage(lease),'early lease release');c.bad(r.asyncAccess.poll(prepared.ticket),'released lease fail closed','stale-storage');}
    if(mode==='backing'){c.ok(r.store.detachBacking(1),'replace backing identity');c.ok(r.store.attachBacking(1,[padded()]),'new backing identity');c.bad(r.asyncAccess.poll(prepared.ticket),'replaced backing fail closed','stale-ticket');}
    if(mode==='dispose'){c.ok(r.store.dispose(),'dispose pending real PBO');c.ok(r.asyncAccess.release(prepared.ticket),'revoked tombstone release');c.bad(r.asyncAccess.release(prepared.ticket),'revoked tombstone double release','invalid-ticket');}
    else{c.ok(r.asyncAccess.release(prepared.ticket),'cancel/release pending depth PBO');if(mode!=='lease')c.ok(r.store.releaseStorage(lease),'revocation lease release');}
    dispose(r,c,'depth '+mode);c.equal(gl.getError(),gl.NO_ERROR,'depth '+mode+' GL errors');results.push({mode});
  }
  return results;
}

async function budgetsAndFailures(gl,c){
  const pressure=[];
  for(const[method,limits]of [['async',{gpuBytes:59}],['async',{cpuBytes:64}],['async',{scratchBytes:23}],['sync',{gpuBytes:35}],['sync',{cpuBytes:64}],['sync',{scratchBytes:23}]]){
    const r=rig(gl,c,{limits});init(r,c);const lease=c.ok(r.store.retainStorage(1,1,'readback'),'pressure depth lease').lease,before=c.ok(r.store.inspect(),'pressure baseline').budgets;
    c.bad(method==='async'?r.asyncAccess.beginStorageRead(lease,box()):r.store.readStorage(lease),'one-byte-short '+method+' '+Object.keys(limits)[0],'limit-exceeded');c.equal(c.ok(r.store.inspect(),'pressure rollback').budgets,before,'failed depth reservation rolls back all accounting');c.equal(r.calls.filter(x=>x.op==='readPixels'||(x.op==='texStorage2D'&&x.internalFormat===gl.RGBA8)||x.op==='bufferData').length,0,'quota failure precedes any staging allocation/read');c.ok(r.store.releaseStorage(lease),'pressure lease release');dispose(r,c,'depth quota');pressure.push({method,limits});
  }
  const failures=[];
  for(const mode of ['precision','source-texture','conversion-texture','program','shader','compile','link','uniform','framebuffer','pbo','fence'])for(const method of (['precision','source-texture'].includes(mode)?['allocate']:['sync','async']).filter(x=>!(x==='sync'&&['pbo','fence'].includes(mode)))){
    let armed=false;
    const r=rig(gl,c,{intercept:(t,k,a,next)=>{
      if(armed){if(mode==='precision'&&k==='getShaderPrecisionFormat')return{precision:16};
        if((['source-texture','conversion-texture'].includes(mode)&&k==='createTexture')||(mode==='program'&&k==='createProgram')||(mode==='shader'&&k==='createShader')||(mode==='pbo'&&k==='createBuffer')||(mode==='fence'&&k==='fenceSync'))return null;
        if(mode==='compile'&&k==='getShaderParameter'&&a[1]===t.COMPILE_STATUS)return false;if(mode==='link'&&k==='getProgramParameter'&&a[1]===t.LINK_STATUS)return false;if(mode==='uniform'&&k==='getUniformLocation')return null;
        if(mode==='framebuffer'&&k==='checkFramebufferStatus')return t.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;}
      return next();
    }});
    if(method==='allocate'){c.ok(r.store.createContext(1),'allocation fault context');armed=true;c.bad(r.store.createResource(meta()),'injected '+mode,'backend-error');c.equal(c.ok(r.store.inspect(),'unpublished depth allocation').budgets.gpuBytes,0,'failed native depth allocation uncharged');armed=false;c.ok(r.store.createResource(meta()),'same ID after allocation fault');}
    else{init(r,c);upload(r,c);const lease=c.ok(r.store.retainStorage(1,1,'readback'),'fault lease').lease,before=c.ok(r.store.inspect(),'fault baseline').budgets;armed=true;
      c.bad(method==='async'?r.asyncAccess.beginStorageRead(lease,box()):r.store.readStorage(lease),'injected '+mode+' '+method,'backend-error');c.equal(c.ok(r.store.inspect(),'fault rollback').budgets,before,'failed host depth conversion restores budgets');armed=false;
      let read;
      if(method==='async'){const ticket=c.ok(r.asyncAccess.beginStorageRead(lease,box()),'post-fault depth PBO').ticket;read=await waitRead(r.asyncAccess,ticket,c);c.ok(r.asyncAccess.release(ticket),'post-fault PBO release');}
      else read=c.ok(r.store.readStorage(lease),'post-fault sync depth read').bytes;
      c.equal([...read],[...bytes],'post-fault original GPU depth remains faithful');
      c.ok(r.store.releaseStorage(lease),'fault lease release');}
    dispose(r,c,'depth host '+mode);for(const[k,set]of Object.entries(r.names))c.equal(set.size,0,'fault '+mode+' no leaked '+k);c.equal(gl.getError(),gl.NO_ERROR,'fault '+mode+' '+method+' leaves no GL errors');failures.push({mode,method});
  }
  return{pressure,failures};
}

async function original(gl,fixtures,c){
  const s=fixtures.original,r=rig(gl,c,{renderer:true});c.ok(r.store.createContext(s.contextId),'original gears resource context');c.ok(r.store.createResource(s.metadata),'unchanged original Z16 create');c.ok(r.store.attachContext(s.contextId,s.metadata.id),'original Z16 membership');c.ok(r.renderer.createContext(s.contextId),'original gears renderer context');
  const input=Uint8Array.from(s.packet),decoded=c.ok(decodeSubmission(input),'original gears depth SURFACE decode');c.equal(decoded.commands[0].fields.format,16,'original depth surface format');c.ok(r.renderer.executeSubmission(s.contextId,input),'unchanged original gears depth SURFACE execute');
  const before=c.ok(r.renderer.inspect(),'original depth surface state');c.bad(r.renderer.executeSubmission(s.contextId,packet(5,0,[1,0,s.handle])),'depth surface cannot be color attachment','incompatible-resource');c.equal(c.ok(r.renderer.inspect(),'rejected depth color state'),before,'incompatible attachment publishes no state');
  c.bad(decodeSubmission(packet(5,0,[0,s.handle])),'guest depth framebuffer execution remains H','unsupported-feature');
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,r.allocations.get(s.metadata.id).texture,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);c.equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'original physical depth-only FBO');const bits=gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE);c.equal(bits,16,'original measured native16 bits');gl.deleteFramebuffer(fb);
  const result={metadata:s.metadata,resourceKey:s.resourceKey,createEvent:s.createEvent,citation:s.citation,depthBits:bits,calls:r.calls};dispose(r,c,'original gears depth');c.equal(gl.getError(),gl.NO_ERROR,'original depth GL errors');return result;
}

export async function runBrowserDepthAcceptance(fixtures){
  const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});c.equal(Boolean(gl),true,'actual depth WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);c.equal(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(renderer),false,'hardware depth renderer');
  const captured=await original(gl,fixtures,c),encodings=await allEncodings(gl,c),literal=await rows(gl,c),copied=await copies(gl,c),regions=await partial(gl,c),generations=await lifetimes(gl,c),budgets=await budgetsAndFailures(gl,c);c.equal(gl.getError(),gl.NO_ERROR,'final depth GL errors');
  return{status:'passed',guestExecution:false,boundary:'Original selected Z16 create/SURFACE plus synthetic GPU uploads, sampling, occlusion and inverse reads; no full guest offload.',renderer,original:captured,encodings,literal,copied,partial:regions,generations,budgets,assertions:c.rows};
}
