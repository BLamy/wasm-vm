import {decodeSubmission} from '../decoder.mjs';
import {computeTransferLayout,createResourceStore,createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglStateRenderer,createVirglAsyncRenderer} from '../state.mjs';

function checks(){const rows=[];const equal=(observed,expected,prediction)=>{const held=JSON.stringify(observed)===JSON.stringify(expected);rows.push({prediction,expected,observed,held});if(!held)throw new Error(prediction+': expected '+JSON.stringify(expected)+', got '+JSON.stringify(observed));};const ok=(r,label)=>{equal(r?.ok,true,label+' ('+(r?.error?.code??'')+': '+(r?.error?.message??'')+')');return r;};const bad=(r,label,code)=>{equal(r?.ok,false,label+' rejects');if(code)equal(r.error.code,code,label+' code');return r;};return{equal,ok,bad,rows};}
function packet(op,words,type=0){const b=new Uint8Array((words.length+1)*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
function join(...parts){const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;}
const meta=(format=67,id=1,width=5,height=4)=>({id,target:2,format,bind:format===16?1:10,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const bufferMeta=(bind=16,id=1,width=17)=>({...meta(64,id,width,1),target:0,bind});
const box=(width,height=1,x=0,y=0)=>({x,y,z:0,width,height,depth:1});
const pixelBytes=m=>m.target===0?1:m.format===16?2:4;
function inline(m,b,dense,stride=0,layerStride=0,usage=0xffffffff){
  const row=b.width*pixelBytes(m),step=stride||m.width*pixelBytes(m),footprint=(b.height-1)*step+row;
  const payload=new Uint8Array(Math.ceil(footprint/4)*4).fill(0xa5);
  for(let y=0;y<b.height;y++)payload.set(dense.subarray(y*row,(y+1)*row),y*step);
  const words=new DataView(payload.buffer),values=Array.from({length:payload.length/4},(_,i)=>words.getUint32(i*4,true));
  return packet(9,[m.id,0,usage,stride,layerStride,b.x,b.y,b.z,b.width,b.height,b.depth,...values]);
}
function command(bytes,c){return c.ok(decodeSubmission(bytes),'owned inline wire').commands[0];}
function pattern(m,width=m.width,height=m.height,seed=0){
  const bytes=new Uint8Array(width*height*pixelBytes(m)),pixels=[];
  for(let i=0;i<width*height;i++){
    if(m.target===0){const v=(i*31+seed*17+9)&255;bytes[i]=v;pixels.push(v);}
    else if(m.format===16){const v=(i*7919+seed*1237)&65535;bytes[i*2]=v&255;bytes[i*2+1]=v>>>8;pixels.push(v);}
    else{
      const r=((i+seed)%4)*85,g=((i*3+seed+1)%4)*85,b=((i*2+seed+2)%4)*85,a=(i*37+seed*11+7)&255;
      pixels.push([r,g,b,m.format===67?a:255]);
      if(m.format===233){const word=((b/85*341)|((g/85*341)<<10)|((r/85*341)<<20)|((i%4)<<30))>>>0;new DataView(bytes.buffer).setUint32(i*4,word,true);}
      else bytes.set(m.format===2?[b,g,r,a]:[r,g,b,a],i*4);
    }
  }
  return{bytes,pixels};
}
function patch(expected,m,b,pixels){const out=expected.map(p=>Array.isArray(p)?[...p]:p);for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++)out[(b.y+y)*m.width+b.x+x]=pixels[y*b.width+x];return out;}
async function sha(data){return[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');}

export function runNativeInlineAcceptance(){
  const c=checks(),m=meta(),p=pattern(m),wire=inline(m,box(5,4),p.bytes);
  const decoded=c.ok(decodeSubmission(wire),'inline wire admission'),fields=decoded.commands[0].fields;
  c.equal([decoded.commands[0].opcode,decoded.commands[0].name,fields.usage,fields.dataWords.length],[9,'RESOURCE_INLINE_WRITE',0xffffffff,20],'inline eleven common words and word12 payload');
  c.equal(Object.isFrozen(fields.dataWords),true,'payload dwords frozen');const saved=JSON.stringify(fields);wire.fill(0);c.equal(JSON.stringify(fields),saved,'caller mutation cannot change decoded inline data');
  for(const field of [1,2,3,4,5,6,7,8,9,10]){
    const values=[1,0,0,0,0,0,0,0,1,1,1,0];if(field===1)values[field]=1;else if([5,6,7].includes(field))values[field]=0xffffffff;else if([8,9,10].includes(field))values[field]=0;else continue;
    c.bad(decodeSubmission(packet(9,values)),'invalid inline level/box');
  }
  for(const values of [[],Array(11).fill(0),[0,0,0,0,0,0,0,0,1,1,1,0],[1,0,0,0xffffffff,0,0,0,0,1,3,1,0]])c.bad(decodeSubmission(packet(9,values)),'short/handle/row-overflow wire');
  c.bad(decodeSubmission(packet(9,[1,0,0,0,0,0,0,0,1,1,1,0],1)),'nonzero inline object byte','invalid-object-type');
  const padded=new Uint8Array(66);padded.set(inline(meta(67,1,1,1),box(1),Uint8Array.from([4,5,6,7])),1);
  c.ok(decodeSubmission(padded.subarray(1,53)),'unaligned host view owns exact inline packet');
  c.bad(decodeSubmission(new Uint8Array(new SharedArrayBuffer(52))),'shared inline input','invalid-input');
  const detached=new Uint8Array(52);structuredClone(detached,{transfer:[detached.buffer]});c.bad(decodeSubmission(detached),'detached inline input','invalid-input');
  const nested=inline(meta(67,1,1,1),box(1),Uint8Array.from([1,2,3,4]));
  const padding=c.ok(decodeSubmission(packet(44,Array.from(new Uint32Array(nested.buffer)))),'opaque END_TRANSFERS contains inline-like words');c.equal(padding.commands.length,1,'opaque padding is never decoded recursively');

  const calls=[],backend={maxTextureSize:16384,allocate:m=>({metadata:m}),destroy(){},upload:(s,m,l,b)=>calls.push([...b]),readback:(s,m,l)=>new Uint8Array(l.tightBytes),dispose(){}};
  const r=c.ok(createResourceStore({backend}),'guard-only resource store');c.ok(r.store.createContext(1),'guard context');c.ok(r.store.createResource(m),'guard resource');c.ok(r.store.attachContext(1,1),'guard membership');
  const good=command(inline(m,box(2,3,1,1),pattern(m,2,3,9).bytes,11,38),c),f=good.fields;
  const computed=c.ok(computeTransferLayout(m,f,f.dataWords.length*4),'odd inline layout').layout;
  c.equal([computed.offset,computed.rowBytes,computed.rowStride,computed.layerStride,computed.footprintBytes,computed.tightBytes],[0,8,11,38,30,24],'odd rows exclude internal and alignment padding');
  const def=command(inline(m,box(2,2,1,1),pattern(m,2,2,2).bytes),c);
  c.equal(c.ok(computeTransferLayout(m,def.fields,def.fields.dataWords.length*4),'default partial inline layout').layout.rowStride,20,'default stride is resource width, not box width');
  const attacks=[
    {...f,dataWords:f.dataWords.slice(0,-1)},{...f,dataWords:[...f.dataWords,0]}, {...f,stride:7},{...f,layerStride:32},
    {...f,stride:0xffffffff,layerStride:0xffffffff},{...f,box:{...f.box,width:6}},{...f,box:{...f.box,z:1}},
    {...f,level:1},{...f,dataOffset:0},{...f,direction:1},{...f,flags:1},{...f,dataWords:new Uint32Array(f.dataWords)},
    {...f,dataWords:[]},{...f,dataWords:Array(65525).fill(0)},{...f,dataWords:[-1]},{...f,dataWords:[1.5]},
    {...f,dataWords:[0x100000000]},{...f,dataWords:[...f.dataWords,NaN]},
  ];
  const sparse=[...f.dataWords];delete sparse[0];attacks.push({...f,dataWords:sparse});
  let getterCalls=0;const accessor=[...f.dataWords];Object.defineProperty(accessor,'0',{get(){getterCalls++;return 0;}});attacks.push({...f,dataWords:accessor});
  const extra=[...f.dataWords];extra.note=1;attacks.push({...f,dataWords:extra});const symbol=[...f.dataWords];symbol[Symbol('x')]=1;attacks.push({...f,dataWords:symbol});
  const revoked=Proxy.revocable([],{});revoked.revoke();attacks.push({...f,dataWords:revoked.proxy});
  for(const fields of attacks){const before=c.ok(r.store.inspect(),'guard pre-budget').budgets;c.bad(r.store.prepareTransfer(1,{opcode:9,fields}),'malformed inline fields');c.equal(c.ok(r.store.inspect(),'guard post-budget').budgets,before,'rejected inline creates no ticket/scratch');}
  for(const change of [{opcode:43},{opcode:45},{name:'TRANSFER3D'},{byteLength:good.byteLength+4},{payloadDwords:good.payloadDwords-1},{objectType:1},{objectName:'SURFACE'},{byteOffset:1}]){
    c.bad(r.store.prepareTransfer(1,{...good,...change}),'inconsistent inline metadata');
  }
  c.equal(getterCalls,0,'inline dword getters never run');c.equal(calls.length,0,'all guard failures precede host upload');
  c.ok(r.store.executeTransfer(c.ok(r.store.prepareTransfer(1,good),'valid inline needs no backing').ticket),'guard dense upload');
  c.equal(calls[0],[...pattern(m,2,3,9).bytes],'guard-only dense owned payload');
  const mutable=[...f.dataWords],owned=c.ok(r.store.prepareTransfer(1,{opcode:9,fields:{...f,dataWords:mutable}}),'host data dwords own dense snapshot');mutable.fill(0);
  c.ok(r.store.executeTransfer(owned.ticket),'mutated host array cannot replace prepared bytes');c.equal(calls.at(-1),[...pattern(m,2,3,9).bytes],'host-array ownership survives deferred execution');
  const asynchronous=c.ok(r.asyncAccess.prepareTransfer(1,good),'direct inline async access');c.equal([asynchronous.inline,asynchronous.backingGeneration],[true,null],'inline async description has no external backing');
  c.bad(r.asyncAccess.provideInput(asynchronous.ticket,new Uint8Array(24)),'owned inline cannot accept replacement DMA input','invalid-ticket');c.ok(r.asyncAccess.upload(asynchronous.ticket),'owned inline access upload');c.bad(r.asyncAccess.upload(asynchronous.ticket),'inline upload cannot issue twice','invalid-ticket');c.ok(r.asyncAccess.release(asynchronous.ticket),'direct inline async release');
  const maximum=packet(9,[1,0,0,0,0,0,0,0,262096,1,1,...Array(65524).fill(0)]);c.equal(maximum.length,262144,'maximum inline occupies exact submission cap');c.ok(decodeSubmission(maximum),'maximum inline wire admission');
  c.bad(decodeSubmission(join(maximum,packet(44,[]))),'one dword beyond inline submission limit','limit-exceeded');
  c.ok(r.store.dispose(),'guard dispose');

  const base=command(inline(meta(67,1,1,1),box(1),Uint8Array.from([1,2,3,4])),c);
  for(const change of [{scratchBytes:3},{cpuBytes:3},{tickets:0},{transferBytes:3}]){
    const q=c.ok(createResourceStore({backend,limits:change}),'tight inline quota store');c.ok(q.store.createContext(1),'quota context');c.ok(q.store.createResource(meta(67,1,1,1)),'quota resource');c.ok(q.store.attachContext(1,1),'quota member');
    const before=c.ok(q.store.inspect(),'quota before').budgets;c.bad(q.store.prepareTransfer(1,base),'inline budget one short');c.equal(c.ok(q.store.inspect(),'quota after').budgets,before,'quota rejects before scratch/ticket charge');c.ok(q.store.dispose(),'quota dispose');
  }
  const q=c.ok(createResourceStore({backend}),'inline allocation failure store');c.ok(q.store.createContext(1),'allocation context');c.ok(q.store.createResource(meta(67,1,1,1)),'allocation resource');c.ok(q.store.attachContext(1,1),'allocation member');
  const intrinsic=globalThis.Uint8Array;let thrown=false;
  try{globalThis.Uint8Array=new Proxy(intrinsic,{construct(t,args,newTarget){if(args[0]===4)throw new RangeError('forced inline scratch allocation');return Reflect.construct(t,args,newTarget);}});q.store.prepareTransfer(1,base);}
  catch(error){thrown=error instanceof RangeError;}finally{globalThis.Uint8Array=intrinsic;}
  c.equal(thrown,true,'inline dense allocation fault exercised');c.equal(c.ok(q.store.inspect(),'allocation rollback').budgets.scratchBytes,0,'failed dense allocation returns scratch charge');c.equal(c.ok(q.store.inspect(),'allocation tickets').budgets.tickets,0,'allocation failure publishes no ticket');c.ok(q.store.dispose(),'allocation fault disposal');
  return{status:'passed',boundary:'Decoder/layout/ownership guards only; physical hardware proof is separate.',assertions:c.rows};
}

function rig(gl,c,{async=false,delay=0,limits={},jobLimits={},failUpload=false}={}){
  const allocations=new Map(),calls=[],names=new Set(),polls=new Map();let store,renderer,fail=failUpload;
  const traced=new Proxy(gl,{get(t,k){const v=Reflect.get(t,k,t);if(typeof v!=='function')return v;return(...args)=>{
    if(['texSubImage2D','bufferSubData'].includes(k))calls.push({op:k,budget:store?.inspect().budgets,bytes:args.at(-1).byteLength});
    const r=v.apply(t,args);
    if(k.startsWith('create')&&r&&typeof r==='object'||k==='fenceSync'&&r)names.add(r);
    if(k.startsWith('delete'))names.delete(args[0]);
    if(k==='clientWaitSync'){const n=polls.get(args[0])??0;polls.set(args[0],n+1);c.equal(args[1],0,'fence wait has no blocking flags');c.equal(args[2],0,'fence wait has zero timeout');if(n<delay)return t.TIMEOUT_EXPIRED;}
    return r;
  };}});
  const native=c.ok(createWebGL2TransferBackend(traced),'actual inline backend').backend;
  const backend={...native,allocate(m){const s=native.allocate(m);allocations.set(m.id,s);return s;},upload(...args){if(fail){fail=false;throw new Error('forced trusted backend upload');}return native.upload(...args);}};
  const access=c.ok(createResourceStore({backend,limits}),'actual inline store');store=access.store;
  const options={gl:traced,resources:store,bindings:access.bindings,...(async?{asyncAccess:access.asyncAccess,jobLimits}:{}),shaderBridge:{translate(){throw new Error('inline transfer proof does not compile guest shaders');}}};
  renderer=c.ok((async?createVirglAsyncRenderer:createVirglStateRenderer)(options),'inline renderer').renderer;
  return{...access,renderer,allocations,calls,names,polls,gl:traced};
}
function initialize(r,c,m,contextId=1){c.ok(r.store.createContext(contextId),'inline resource context');c.ok(r.renderer.createContext(contextId),'inline renderer context');c.ok(r.store.createResource(m),'inline native resource');c.ok(r.store.attachContext(contextId,m.id),'inline context membership');}
function dispose(r,gl,c,label){c.ok(r.renderer.dispose(),label+' renderer dispose');c.ok(r.store.dispose(),label+' store dispose');for(const owner of [r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),label+' budgets').budgets))c.equal(v,0,label+' releases '+k);c.equal(r.names.size,0,label+' deletes native names');c.equal(gl.getError(),gl.NO_ERROR,label+' no GL error');}
function resetRead(gl){gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);}
function rawColor(gl,texture,width,height){const fb=gl.createFramebuffer();try{resetRead(gl);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('inline raw color FBO incomplete');const b=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;}finally{gl.deleteFramebuffer(fb);}}
function rawDepth(gl,texture,width,height){
  if(!gl.getExtension('EXT_color_buffer_float'))throw new Error('inline float depth oracle unavailable');
  const out=gl.createTexture(),fb=gl.createFramebuffer(),vao=gl.createVertexArray(),program=gl.createProgram(),shaders=[];
  try{
    for(const[type,text]of [[gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0,1);}'],[gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;uniform highp sampler2D src;out vec4 color;void main(){color=vec4(texelFetch(src,ivec2(gl_FragCoord.xy),0).r,0,0,1);}']]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));gl.attachShader(program,s);}
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    for(const cap of [gl.BLEND,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.SCISSOR_TEST,gl.CULL_FACE,gl.DITHER,gl.RASTERIZER_DISCARD])gl.disable(cap);gl.colorMask(true,true,true,true);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,out);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,width,height);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,out,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('inline depth sample FBO incomplete');
    gl.bindVertexArray(vao);gl.useProgram(program);gl.viewport(0,0,width,height);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(0,null);gl.uniform1i(gl.getUniformLocation(program,'src'),0);gl.drawArrays(gl.TRIANGLES,0,3);resetRead(gl);const data=new Float32Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,data);return data;
  }finally{gl.useProgram(null);gl.deleteProgram(program);for(const s of shaders)gl.deleteShader(s);gl.deleteTexture(out);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);}
}
function physical(r,gl,c,m,expected,label){
  const storage=r.allocations.get(m.id);let data;
  if(m.target===0){data=new Uint8Array(m.width);gl.bindBuffer(gl.COPY_READ_BUFFER,storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,data);c.equal([...data],expected,label+' independent raw buffer bytes');}
  else if(m.format===16){data=rawDepth(gl,storage.texture,m.width,m.height);for(let i=0;i<expected.length;i++)c.equal(Math.abs(data[i*4]-expected[i]/65535)<1/(65535*128),true,label+' independent depth texel '+i);}
  else{data=rawColor(gl,storage.texture,m.width,m.height);for(let i=0;i<expected.length;i++)c.equal([...data.subarray(i*4,i*4+4)],expected[i],label+' independent raw RGBA texel '+i);}
  c.equal(gl.getError(),gl.NO_ERROR,label+' physical GL status');return data;
}
function poison(gl){gl.pixelStorei(gl.UNPACK_ALIGNMENT,8);gl.pixelStorei(gl.UNPACK_ROW_LENGTH,17);gl.pixelStorei(gl.UNPACK_SKIP_ROWS,2);gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,3);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);}
function sync(r,c,bytes,label,id=1){return c.ok(r.renderer.executeSubmission(id,bytes),label);}
async function finish(r,c,job,expect=true){for(let n=0;n<80;n++){const s=c.ok(r.renderer.step(job),'bounded inline job poll');if(s.status==='done'){(expect?c.ok:c.bad)(s.result,'completed inline job');return s;}c.equal(['waiting-gpu','ready'].includes(s.status),true,'inline job requires no caller DMA input');await new Promise(resolve=>setTimeout(resolve,0));}throw new Error('inline job did not finish');}

async function originalUploads(gl,fixtures,c){
  const rows=[];c.equal(fixtures.clientInlineWriteCounts,{kmscube:0,es2gears:0},'no fabricated original inline provenance');
  for(const source of fixtures.original){const r=rig(gl,c),m=source.metadata,id=source.contextId;initialize(r,c,m,id);const backing=Uint8Array.from(atob(source.backingBase64),s=>s.charCodeAt(0));c.equal(await sha(backing),source.backingSha256,'authenticated original CPU backing');
    c.ok(r.store.attachBacking(m.id,source.iovLengths.map(n=>new Uint8Array(n))),'original segmented backing');c.ok(r.store.writeBacking(m.id,0,backing),'original pre-submit CPU snapshot');const command=decodeSubmission(Uint8Array.from(source.packet));c.equal(command.ok,true,'original exact wire remains admitted');
    sync(r,c,Uint8Array.from(source.packet),'original required normal upload',id);
    let raw;if(m.target===2)raw=rawColor(gl,r.allocations.get(m.id).texture,m.width,m.height);else{raw=new Uint8Array(m.width);gl.bindBuffer(gl.COPY_READ_BUFFER,r.allocations.get(m.id).buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);}
    c.equal(await sha(raw),source.denseSha256,'original independent GPU upload bytes '+source.workload+'/'+m.id);
    c.equal(await sha(c.ok(r.store.readBacking(m.id,0,backing.length),'original CPU backing after').bytes),source.backingSha256,'ordinary uploads do not rewrite padding/backing');
    rows.push({workload:source.workload,metadata:m,citation:source.citation,snapshotEvent:source.snapshotEvent,backingSha256:source.backingSha256,physicalSha256:await sha(raw),bytes:raw.length,calls:r.calls});dispose(r,gl,c,'original '+source.workload+'/'+m.id);
  }return rows;
}
async function syncMatrix(gl,c){
  const rows=[];
  for(const m of [meta(67),meta(2),meta(233),meta(16),bufferMeta(16),bufferMeta(32)]){
    const r=rig(gl,c);initialize(r,c,m);const base=pattern(m),whole=box(m.width,m.height);sync(r,c,inline(m,whole,base.bytes),'whole inline without backing');physical(r,gl,c,m,base.pixels,'whole inline '+m.format+'/'+m.bind);
    const backing=new Uint8Array(m.width*m.height*pixelBytes(m)+19).fill(0x6d);c.ok(r.store.attachBacking(m.id,[backing.subarray(0,3),backing.subarray(3,17),backing.subarray(17)]),'unrelated backing for inline preservation');
    let expected=base.pixels;const history=[];
    for(const[seed,strided]of [[7,true],[13,false],[23,true]]){
      const b=m.target===0?box(5,1,4):box(2,2,1,1),p=pattern(m,b.width,b.height,seed),stride=strided?b.width*pixelBytes(m)+3:0,layer=strided?(b.width*pixelBytes(m)+3)*b.height+5:0;
      const packet=inline(m,b,p.bytes,stride,layer),owned=command(packet,c),prepared=c.ok(r.store.prepareTransfer(1,owned),'direct checked inline ticket');
      c.equal(prepared.layout.tightBytes,p.bytes.length,'dense scratch excludes payload padding');packet.fill(0);if(strided)poison(gl);
      c.ok(r.store.executeTransfer(prepared.ticket),'owned partial inline physical upload');c.bad(r.store.executeTransfer(prepared.ticket),'consumed inline token','invalid-ticket');
      expected=patch(expected,m,b,p.pixels);const raw=physical(r,gl,c,m,expected,'partial inline '+m.format+'/'+seed);
      c.equal([...c.ok(r.store.readBacking(m.id,0,backing.length),'inline backing unchanged').bytes],[...backing],'inline never scatters into backing');
      history.push({seed,stride,layerStride:layer,layout:prepared.layout,physicalSha256:await sha(new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength))});
    }
    c.equal(r.calls.every(x=>x.budget.scratchBytes>0),true,'inline upload scratch charged before native issue');rows.push({metadata:m,history,calls:r.calls});dispose(r,gl,c,'sync inline '+m.format+'/'+m.bind);
  }return rows;
}
async function asyncMatrix(gl,c){
  const rows=[];
  for(const delay of [0,1,3])for(const format of [67,2,233,16]){
    const m=meta(format),r=rig(gl,c,{async:true,delay});initialize(r,c,m);
    let expected;
    for(const seed of [3,19,3]){const p=pattern(m,m.width,m.height,seed),wire=inline(m,box(m.width,m.height),p.bytes),job=c.ok(r.renderer.beginSubmission(1,wire),'owned async inline submission').job;wire.fill(0);
      const start=c.ok(r.renderer.step(job),'inline yields with owned upload');c.equal(start.status,'upload-ready','inline has no guest input request');c.equal(Object.hasOwn(start,'request'),false,'inline does not request external DMA');c.equal(r.renderer.inspect().jobs.inputBytes,p.bytes.length,'owned inline bytes accounted while yielding');
      if(expected)physical(r,gl,c,m,expected,'async yield before GPU effect '+format);
      // Inline identity never depends on an unrelated CPU backing generation.
      c.ok(r.store.attachBacking(1,[new Uint8Array(9)]),'attach unrelated backing during inline yield');c.ok(r.store.detachBacking(1),'detach unrelated backing during inline yield');
      await finish(r,c,job);expected=p.pixels;physical(r,gl,c,m,expected,'async owned inline '+format+'/'+seed);c.equal(r.renderer.inspect().jobs.active,0,'async inline job collected');c.equal(r.store.inspect().budgets.scratchBytes,0,'async dense scratch released');
    }
    rows.push({format,delay,uploads:r.calls.length,pollCounts:[...r.polls.values()],calls:r.calls});dispose(r,gl,c,'async inline '+format+'/'+delay);
  }return rows;
}
async function lifecycleAndFailures(gl,c){
  const rows=[];
  for(const attack of ['resource-reuse','membership-reuse','context-reuse','cancel','dispose']){
    const m=meta(67,1,1,1),r=rig(gl,c,{async:true});initialize(r,c,m);const wire=inline(m,box(1),Uint8Array.from([33,67,101,135])),job=c.ok(r.renderer.beginSubmission(1,wire),'lifecycle inline start').job;c.equal(c.ok(r.renderer.step(job),'lifecycle prepare').status,'upload-ready','lifecycle before GPU upload');const uploads=r.calls.length;
    if(attack==='resource-reuse'){c.ok(r.store.unref(1),'remove pending resource name');c.ok(r.store.createResource(m),'reuse pending resource name');c.ok(r.store.attachContext(1,1),'new resource member');}
    if(attack==='membership-reuse'){c.ok(r.store.detachContext(1,1),'detach pending membership');c.ok(r.store.attachContext(1,1),'reuse membership');}
    if(attack==='context-reuse'){c.ok(r.store.destroyContext(1),'destroy underlying context');c.ok(r.store.createContext(1),'reuse underlying context');c.ok(r.store.attachContext(1,1),'new underlying membership');}
    if(attack==='cancel')c.ok(r.renderer.cancel(job),'cancel owned inline job');
    if(attack==='dispose'){c.ok(r.renderer.dispose(),'dispose pending renderer');c.bad(r.renderer.step(job),'disposed job');}else await finish(r,c,job,false);
    c.equal(r.calls.length,uploads,'stale/cancelled inline issues no native upload');c.equal(r.store.inspect().budgets.scratchBytes,0,'lifecycle rollback scratch');rows.push({attack,uploads:r.calls.length});dispose(r,gl,c,attack);
  }
  for(const async of [false,true]){
    const m=meta(67,1,1,1),r=rig(gl,c,{async,failUpload:true});initialize(r,c,m);const p=inline(m,box(1),Uint8Array.from([11,22,33,44]));
    if(async){const job=c.ok(r.renderer.beginSubmission(1,p),'fault async start').job;c.ok(r.renderer.step(job),'fault async owned prepare');await finish(r,c,job,false);}else c.bad(r.renderer.executeSubmission(1,p),'backend upload failure','backend-error');
    c.equal(r.store.inspect().budgets.tickets,0,'backend fault releases ticket');c.equal(r.store.inspect().budgets.scratchBytes,0,'backend fault releases scratch');
    if(async){const job=c.ok(r.renderer.beginSubmission(1,p),'recovered async start').job;c.ok(r.renderer.step(job),'recovered async prepare');await finish(r,c,job);}else sync(r,c,p,'recovered sync upload');
    physical(r,gl,c,m,[[11,22,33,44]],'recovery after backend fault');rows.push({attack:'backend-upload',async});dispose(r,gl,c,'backend fault');
  }
  const r=rig(gl,c),m=meta(67,1,1,1);initialize(r,c,m);const valid=inline(m,box(1),Uint8Array.from([1,2,3,4]));
  const rejected=c.bad(r.renderer.executeSubmission(1,join(valid,packet(255,[]))),'bad wire tail rejects entire inline prefix','unsupported-command');c.equal(rejected.appliedCommands,0,'bad tail has zero applied prefix');c.equal(r.calls.length,0,'bad tail has zero GPU uploads');
  c.ok(r.renderer.executeSubmission(1,packet(44,Array.from(new Uint32Array(valid.buffer)))),'opaque inline-looking padding executes no work');c.equal(r.calls.length,0,'END padding has no inline GPU effect');
  c.ok(r.store.createResource(bufferMeta(524288,2)),'staging role exists');c.ok(r.store.attachContext(1,2),'staging context attachment');
  c.bad(r.renderer.executeSubmission(1,inline(bufferMeta(524288,2),box(1),Uint8Array.from([7]))),'inline cannot write a staging GPU image','unsupported-resource');
  c.bad(r.renderer.executeSubmission(1,inline(meta(67,999,1,1),box(1),Uint8Array.from([1,2,3,4]))),'missing inline resource','missing-resource');
  rows.push({attack:'whole-wire-tail-and-opaque-padding',appliedCommands:rejected.appliedCommands});dispose(r,gl,c,'whole inline wire');return rows;
}

async function hardwareQuotas(gl,c){
  const rows=[],m=meta(67,1,1,1),wire=inline(m,box(1),Uint8Array.from([11,22,33,44]));
  for(const limits of [{scratchBytes:3},{cpuBytes:3},{tickets:0},{transferBytes:3}]){
    const r=rig(gl,c,{limits});initialize(r,c,m);c.bad(r.renderer.executeSubmission(1,wire),'hardware inline quota rejects before issue');c.equal(r.calls.length,0,'tight quota issues no GPU upload');c.equal(r.store.inspect().budgets.scratchBytes,0,'tight quota leaves no scratch');rows.push({limits,issued:0});dispose(r,gl,c,'hardware quota');
  }
  const exact=rig(gl,c,{limits:{cpuBytes:4,scratchBytes:4,transferBytes:4,tickets:1}});initialize(exact,c,m);sync(exact,c,wire,'exact inline quota fit');physical(exact,gl,c,m,[[11,22,33,44]],'exact quota pixels');c.equal(exact.calls[0].budget.scratchBytes,4,'exact four-byte scratch reservation at native issue');rows.push({limits:{cpuBytes:4,scratchBytes:4,transferBytes:4,tickets:1},issued:1});dispose(exact,gl,c,'exact quota');
  for(const jobLimits of [{transferBytes:3},{submissionBytes:51}]){
    const r=rig(gl,c,{async:true,jobLimits});initialize(r,c,m);const start=r.renderer.beginSubmission(1,wire);
    if(jobLimits.submissionBytes)c.bad(start,'async inline submission byte quota');else{const job=c.ok(start,'async job quota start').job;const rejected=c.ok(r.renderer.step(job),'async job transfer quota retirement');c.equal(['done','waiting-gpu'].includes(rejected.status),true,'over-budget inline cannot enter upload-ready');if(rejected.status==='done')c.bad(rejected.result,'async transfer byte quota');else await finish(r,c,job,false);}
    c.equal(r.calls.length,0,'async quota issues no inline write');c.equal(r.store.inspect().budgets.scratchBytes,0,'async quota returns reserved scratch');rows.push({jobLimits,issued:0});dispose(r,gl,c,'async quota');
  }
  const maximum=bufferMeta(16,1,262096),r=rig(gl,c),p=pattern(maximum);initialize(r,c,maximum);const full=inline(maximum,box(maximum.width),p.bytes);c.equal(full.length,262144,'native maximum inline framing');sync(r,c,full,'maximum bounded inline GPU write');const raw=new Uint8Array(maximum.width);gl.bindBuffer(gl.COPY_READ_BUFFER,r.allocations.get(1).buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);c.equal(await sha(raw),await sha(p.bytes),'maximum independent raw GPU byte digest');rows.push({maximumBytes:raw.length,physicalSha256:await sha(raw)});dispose(r,gl,c,'maximum wire');return rows;
}

export async function runBrowserInlineAcceptance(fixtures){
  const c=checks(),canvas=document.querySelector('#gpu'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});if(!gl)throw new Error('hardware WebGL2 unavailable');
  const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);c.equal(!/swiftshader|llvmpipe|softpipe|lavapipe/i.test(renderer),true,'actual GPU renderer');
  const original=await originalUploads(gl,fixtures,c),sync=await syncMatrix(gl,c),jobs=await asyncMatrix(gl,c),failures=await lifecycleAndFailures(gl,c),quotas=await hardwareQuotas(gl,c);
  return{status:'passed',guestExecution:false,productionNegotiation:false,renderer,original,sync,jobs,failures,quotas,assertions:c.rows};
}
