// Literal pixel predictions and original wire fields are independent of renderer lowering.
import {decodeSubmission} from '../decoder.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer,createVirglAsyncRenderer} from '../state.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

function checks(){const rows=[];const equal=(actual,expected,prediction)=>{const held=JSON.stringify(actual)===JSON.stringify(expected);rows.push({prediction,expected,observed:actual,held});if(!held)throw new Error(`${prediction}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);};const ok=(r,label)=>{equal(r?.ok,true,`${label} (${r?.error?.code??''}: ${r?.error?.message??''})`);return r;};const bad=(r,label,code)=>{equal(r?.ok,false,label+' rejects');if(code)equal(r.error.code,code,label+' error code');return r;};return{equal,ok,bad,rows};}
export function packet(op,type,words){const b=new Uint8Array(4+words.length*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
function join(...arrays){const b=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let at=0;for(const a of arrays){b.set(a,at);at+=a.length;}return b;}
function fw(value){const b=new ArrayBuffer(4),v=new DataView(b);v.setFloat32(0,value,true);return v.getUint32(0,true);}
function shader(id,stage,text){const b=packet(1,4,[id,stage,text.length+1,64,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;}
function clear(mask=5,color=[0,0,0,1],depth=1){const b=packet(7,0,[mask,...color.map(fw),0,0,0]);new DataView(b.buffer).setFloat64(24,depth,true);return b;}
const draw=(start=0,count=4,mode=5,indexed=false)=>packet(8,0,[start,count,mode,Number(indexed),1,0,0,0,0,0,0xffffffff,0]);
const viewport=(negative=false)=>packet(4,0,[0,...[8,negative?-8:8,.5,8,8,.5].map(fw)]);
const scissor=(x=0,y=0,w=16,h=16)=>packet(15,0,[0,x|(y<<16),(x+w)|((y+h)<<16)]);
const raster=(id,{front=true,cull=false,scissor=false,bottom=true}={})=>packet(1,2,[id,2|(1<<29)|(bottom?1<<30:0)|(front?1<<15:0)|(cull?2<<8:0)|(scissor?1<<14:0),fw(1),0,65535,fw(1),0,0,0]);
const dsa=(id,enabled=false,write=false,func=1)=>packet(1,3,[id,Number(enabled)|(Number(write)<<1)|(func<<2),0,0,0]);
const constant=(color)=>packet(12,0,[1,0,...color.map(fw)]);
const VS='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const FS='FRAG\nDCL OUT[0], COLOR\nDCL CONST[0..0]\n0: MOV OUT[0], CONST[0]\n1: END\n';
const metadata=(id,target,format,bind,width,height=1)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const region=(width,height=1)=>({x:0,y:0,z:0,width,height,depth:1});
async function sha(data){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function decode64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}

export function runNativeRasterAcceptance(){
  const c=checks();
  for(let bits=0;bits<32;bits++){const f=c.ok(decodeSubmission(packet(1,3,[1,bits,0,0,0])),'depth word '+bits).commands[0].fields;c.equal([f.depthEnable,f.depthWriteMask,f.depthFunction],[Boolean(bits&1),Boolean(bits&2),(bits>>>2)&7],'independent depth bit fields '+bits);}
  for(const[words,label]of [[[1,256,0,0,0],'alpha'],[[1,0,1,0,0],'front stencil'],[[1,0,0,1,0],'back stencil']])c.bad(decodeSubmission(packet(1,3,words)),'closed '+label,'unsupported-feature');
  for(const fmt of [28,29,30,31]){const n=(fmt-27)*4,last=Math.floor((0xffffffff-n)/4)*4;c.ok(decodeSubmission(packet(1,5,[1,last,0,15,fmt])),'exact aligned vertex address '+fmt);c.bad(decodeSubmission(packet(1,5,[1,last+4,0,15,fmt])),'overflow vertex address '+fmt,'invalid-value');}
  for(const fmt of [0,16,27,32,64,67,177,233])c.bad(decodeSubmission(packet(1,5,[1,0,0,0,fmt])),'closed vertex format '+fmt,'unsupported-feature');
  c.bad(decodeSubmission(packet(1,5,[1,0,1,0,30])),'instanced vertex fetch','unsupported-feature');
  c.equal(c.ok(decodeSubmission(scissor(1,2,3,4)),'packed scissor').commands[0].fields.scissors,[{minX:1,minY:2,maxX:4,maxY:6}],'unsigned packed scissor coordinates');
  for(const b of [packet(15,0,[0,0]),packet(15,0,[0,0,0,0]),packet(15,0,[1,0,0]),packet(15,0,[0,7,6])])c.bad(decodeSubmission(b),'invalid scissor shape/range');
  for(const mask of [1,4,5])c.ok(decodeSubmission(clear(mask)),'color/depth mask '+mask);
  for(const mask of [0,2,3,6,8,0xffffffff])c.bad(decodeSubmission(clear(mask)),'closed clear mask '+mask,'unsupported-feature');
  for(let mode=0;mode<16;mode++){const r=decodeSubmission(draw(0,4,mode));if([4,5].includes(mode))c.ok(r,'triangle mode '+mode);else c.bad(r,'closed primitive '+mode,'unsupported-feature');}
  for(const[word,value]of [[5,2],[6,1],[7,1],[8,1],[9,1],[12,1]]){const b=draw(),v=new DataView(b.buffer);v.setUint32(word*4,value,true);c.bad(decodeSubmission(b),'closed draw field '+word,'unsupported-feature');}
  return{status:'passed',assertions:c.rows};
}

function rig(gl,bridge,c,{async=false,delay=0}={}){
  const allocations=new Map(),calls=[],names=new Map(),control={label:'setup',remaining:0},reads={sync:0,async:0};
  const kinds=['Texture','Buffer','Shader','Program','Sampler','VertexArray','Framebuffer','Sync'];for(const k of kinds)names.set(k,new Set());
  const identity=(native,kind)=>{for(const[id,s]of allocations)if(s[kind]===native)return id;return null;};
  function snapshot(op,args){
    const program=gl.getParameter(gl.CURRENT_PROGRAM),attributes=[],constants={};
    for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++){const a=gl.getActiveAttrib(program,i),at=gl.getAttribLocation(program,a.name);attributes.push({name:a.name,location:at,enabled:gl.getVertexAttrib(at,gl.VERTEX_ATTRIB_ARRAY_ENABLED),components:gl.getVertexAttrib(at,gl.VERTEX_ATTRIB_ARRAY_SIZE),type:gl.getVertexAttrib(at,gl.VERTEX_ATTRIB_ARRAY_TYPE),stride:gl.getVertexAttrib(at,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(at,gl.VERTEX_ATTRIB_ARRAY_POINTER),resourceId:identity(gl.getVertexAttrib(at,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),'buffer')});}
    for(const prefix of ['vsconst0','fsconst0']){const words=[];for(let i=0;i<46;i++){const at=gl.getUniformLocation(program,`${prefix}[${i}]`);if(at===null)break;words.push(...gl.getUniform(program,at));}constants[prefix]=words;}
    const system=gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,0),old=gl.getParameter(gl.COPY_READ_BUFFER_BINDING),y=new Float32Array(1);gl.bindBuffer(gl.COPY_READ_BUFFER,system);gl.getBufferSubData(gl.COPY_READ_BUFFER,640,y);gl.bindBuffer(gl.COPY_READ_BUFFER,old);
    const color=gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME),depth=gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME);
    return{label:control.label,op,args:[...args],attributes:attributes.sort((a,b)=>a.name.localeCompare(b.name)),constants,
      viewport:[...gl.getParameter(gl.VIEWPORT)],depthRange:[...gl.getParameter(gl.DEPTH_RANGE)],winsysY:y[0],
      depth:{enabled:gl.isEnabled(gl.DEPTH_TEST),write:gl.getParameter(gl.DEPTH_WRITEMASK),func:gl.getParameter(gl.DEPTH_FUNC),resourceId:identity(depth,'texture'),bits:depth?gl.getFramebufferAttachmentParameter(gl.DRAW_FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE):0},
      scissor:{enabled:gl.isEnabled(gl.SCISSOR_TEST),box:[...gl.getParameter(gl.SCISSOR_BOX)]},
      cull:{enabled:gl.isEnabled(gl.CULL_FACE),face:gl.getParameter(gl.CULL_FACE_MODE),front:gl.getParameter(gl.FRONT_FACE)},
      blend:{enabled:gl.isEnabled(gl.BLEND),mask:[...gl.getParameter(gl.COLOR_WRITEMASK)]},colorResourceId:identity(color,'texture')};
  }
  const traced=new Proxy(gl,{get(t,k){const fn=Reflect.get(t,k,t);if(typeof fn!=='function')return fn;return(...args)=>{
    if(k==='drawElements'||k==='drawArrays')calls.push(snapshot(k,args));
    if(k==='clientWaitSync'&&control.remaining>0){control.remaining--;return gl.TIMEOUT_EXPIRED;}
    const out=fn.apply(t,args);
    for(const kind of kinds){if(k==='create'+kind||k==='fence'+kind){if(out)names.get(kind).add(out);}else if(k==='delete'+kind)names.get(kind).delete(args[0]);}
    if(k==='fenceSync')control.remaining=delay;
    return out;
  };}});
  const native=c.ok(createWebGL2TransferBackend(traced),'physical transfer backend').backend;
  const backend={...native,allocate(m){const s=native.allocate(m);allocations.set(m.id,s);return s;}};
  const owner=c.ok(createResourceStore({backend}),'physical owned store'),resources={...owner.store,readStorage(...args){reads.sync++;return owner.store.readStorage(...args);}},access={...owner.asyncAccess,beginStorageRead(...args){reads.async++;return owner.asyncAccess.beginStorageRead(...args);}};
  const renderer=c.ok((async?createVirglAsyncRenderer:createVirglDrawRenderer)({gl:traced,resources,bindings:owner.bindings,shaderBridge:bridge,...(async?{asyncAccess:access,jobLimits:{commandsPerStep:1}}:{})}),'physical renderer').renderer;
  const run=(ctx,bytes,label)=>{control.label=label;return renderer.executeSubmission(ctx,bytes);};
  return{...owner,renderer,allocations,calls,control,reads,run,gl,names};
}
function dispose(r,c,label){c.ok(r.renderer.dispose(),label+' renderer dispose');c.ok(r.store.dispose(),label+' store dispose');for(const owner of [r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),label+' budgets').budgets))c.equal(v,0,label+' released '+k);for(const[k,v]of r.names)c.equal(v.size,0,label+' deleted native '+k);c.equal(r.gl.getError(),r.gl.NO_ERROR,label+' GL errors');}
function createResources(r,c,ctx,items){c.ok(r.store.createContext(ctx),'resource context '+ctx);c.ok(r.renderer.createContext(ctx),'renderer context '+ctx);for(const m of items){c.ok(r.store.createResource(m),'create '+m.id);c.ok(r.store.attachContext(ctx,m.id),'attach '+m.id);}}
function upload(r,c,ctx,id,bytes){c.ok(r.store.attachBacking(id,[bytes]),'CPU backing '+id);c.ok(r.run(ctx,packet(43,0,[id,0,0,0,0,0,0,0,bytes.length,1,1,0,1]),'CPU vertex upload'),'GPU vertex upload '+id);}
const syntheticCommands=(base=0)=>join(shader(1,0,VS),shader(2,1,FS),packet(1,8,[3,1+base,67,0,0]),packet(1,8,[4,2+base,16,0,0]),packet(5,0,[1,4,3]),
    packet(1,5,[5,0,0,0,30]),packet(2,5,[5]),packet(6,0,[12,0,3+base]),raster(6),packet(2,2,[6]),dsa(7),dsa(8,true,false),dsa(9,true,true),packet(2,3,[7]),
    packet(31,0,[1,0]),packet(31,0,[2,1]),viewport(),constant([1,0,0,1]));
function synthetic(r,c,ctx=1,base=0){
  createResources(r,c,ctx,[metadata(1+base,2,67,2,16,16),metadata(2+base,2,16,1,16,16),metadata(3+base,0,64,16,144)]);
  c.ok(r.run(ctx,syntheticCommands(base),'synthetic state'),'synthetic owned state');
}
function geometry(z=0,shape='quad',reverse=false){let values=shape==='triangle'?[-1,-1,z,1,-1,z,-1,1,z]:[-1,-1,z,-1,1,z,1,-1,z,1,1,z];if(reverse)values=values.slice(3,6).concat(values.slice(0,3),values.slice(6));const out=new Uint8Array(144);new Float32Array(out.buffer).set(values);return out;}
function replaceGeometry(r,c,ctx,id,z,shape='quad',reverse=false){const bytes=geometry(z,shape,reverse);c.ok(r.store.writeBacking(id,0,bytes),'replace owned CPU vertices');c.ok(r.run(ctx,packet(43,0,[id,0,0,0,0,0,0,0,144,1,1,0,1]),'geometry transfer'),'replace actual GPU vertices');}
function readPhysical(r,c,id,width=16,height=16,format=67){const gl=r.gl,fb=gl.createFramebuffer(),old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations.get(id).texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);c.equal(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'independent physical color FBO');gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);const out=format===233?new Uint32Array(width*height):new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,format===233?gl.UNSIGNED_INT_2_10_10_10_REV:gl.UNSIGNED_BYTE,out);c.equal(gl.getError(),gl.NO_ERROR,'independent physical read GL errors');return out;}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);gl.deleteFramebuffer(fb);}}
async function pixels(r,c,id,predict,label){const b=readPhysical(r,c,id),mismatch=[];for(let y=0;y<16;y++)for(let x=0;x<16;x++){const actual=[...b.subarray((y*16+x)*4,(y*16+x+1)*4)],expected=predict(x,y);if(JSON.stringify(actual)!==JSON.stringify(expected))mismatch.push({x,y,actual,expected});}c.equal(mismatch.slice(0,3),[],label+' literal physical pixels');return{label,checkedPixels:256,sha256:await sha(b),samples:[[0,0],[7,7],[8,8],[15,15]].map(([x,y])=>({x,y,rgba:[...b.subarray((y*16+x)*4,(y*16+x+1)*4)]}))};}
function poison(gl){for(const cap of [gl.DEPTH_TEST,gl.STENCIL_TEST,gl.SCISSOR_TEST,gl.CULL_FACE,gl.BLEND,gl.DITHER,gl.RASTERIZER_DISCARD,gl.POLYGON_OFFSET_FILL,gl.SAMPLE_COVERAGE])gl.enable(cap);gl.depthMask(false);gl.depthFunc(gl.NEVER);gl.colorMask(false,false,false,false);gl.scissor(0,0,0,0);gl.viewport(1,2,3,4);gl.depthRange(.25,.75);gl.frontFace(gl.CCW);gl.cullFace(gl.FRONT);gl.useProgram(null);gl.bindVertexArray(null);}
const black=[0,0,0,255],red=[255,0,0,255],green=[0,255,0,255],blue=[0,0,255,255];

async function literal(gl,bridge,c){
  const r=rig(gl,bridge,c),frames=[];synthetic(r,c);upload(r,c,1,3,geometry());
  const run=(bytes,label)=>c.ok(r.run(1,bytes,label),label);
  run(join(packet(2,3,[9]),clear(),constant([0,0,1,1]),draw()),'mid-depth occluder');frames.push(await pixels(r,c,1,()=>blue,'mid-depth occluder'));
  replaceGeometry(r,c,1,3,.999);run(join(constant([1,0,0,1]),draw()),'far clip triangle');frames.push(await pixels(r,c,1,()=>blue,'z=0.999 behind mid-depth'));
  replaceGeometry(r,c,1,3,-.999);run(join(constant([0,1,0,1]),draw()),'near clip triangle');frames.push(await pixels(r,c,1,()=>green,'z=-0.999 in front of mid-depth'));
  replaceGeometry(r,c,1,3,0);run(join(packet(2,3,[7]),clear(4),constant([1,0,0,1]),draw()),'depth disabled');frames.push(await pixels(r,c,1,()=>red,'depth disabled adjacent draw'));
  run(join(raster(10,{scissor:true}),packet(2,2,[10]),scissor(3,5,7,6),clear(),constant([0,1,0,1]),draw()),'scissored draw');frames.push(await pixels(r,c,1,(x,y)=>x>=3&&x<10&&y>=5&&y<11?green:black,'lower-left scissor and full clear'));
  c.equal(gl.isEnabled(gl.SCISSOR_TEST),true,'full clear restores scissor enable');
  run(scissor(6,6,0,0),'empty scissor');run(join(clear(4),draw()),'empty scissor draw');frames.push(await pixels(r,c,1,()=>black,'empty scissor excludes all fragments'));
  run(join(scissor(),packet(15,0,[0]),draw()),'empty scissor update no-op');frames.push(await pixels(r,c,1,()=>green,'empty update retains full scissor'));
  run(join(packet(2,2,[6]),viewport(),clear(4)),'positive orientation');replaceGeometry(r,c,1,3,0,'triangle');run(join(constant([1,0,0,1]),draw(0,3,4)),'positive Y triangle');
  // Exclude the shared diagonal itself; predict lower-left pixel centers independently.
  const positive=readPhysical(r,c,1);for(const[x,y,rgba]of [[2,2,red],[13,13,black],[2,11,red],[11,2,red]])c.equal([...positive.slice((y*16+x)*4,(y*16+x+1)*4)],rgba,'positive-Y asymmetric triangle '+x+','+y);
  run(join(viewport(true),clear(4),draw(0,3,4)),'negative Y triangle');const negative=readPhysical(r,c,1);for(const[x,y,rgba]of [[2,13,red],[13,2,black],[2,4,red],[13,15,red]])c.equal([...negative.slice((y*16+x)*4,(y*16+x+1)*4)],rgba,'negative-Y asymmetric triangle '+x+','+y);
  frames.push({label:'positive/negative Y',positiveSha256:await sha(positive),negativeSha256:await sha(negative)});
  run(join(viewport(),raster(11,{front:true,cull:true}),packet(2,2,[11]),clear(4)),'Gallium CW winding');replaceGeometry(r,c,1,3,0,'quad');run(draw(),'front CW quad');frames.push(await pixels(r,c,1,()=>red,'lower-left Gallium winding'));
  run(join(raster(12,{front:false,cull:true}),packet(2,2,[12]),clear(4),draw()),'opposite winding');frames.push(await pixels(r,c,1,()=>black,'opposite winding is culled'));
  run(join(viewport(true),clear(4),draw()),'negative-Y reverses face');frames.push(await pixels(r,c,1,()=>red,'negative-Y winding reverses with coordinates'));
  // Depth zero is exactly representable in both clip conversion and UN16 storage.
  // This separates enum mapping from implementation-dependent midpoint rounding.
  replaceGeometry(r,c,1,3,-1);run(join(viewport(),packet(2,2,[6]),packet(2,3,[7]),clear(5,black.map(v=>v/255),0)),'reset compare depth');
  const compares=[];for(let func=0;func<8;func++){const id=20+func;run(join(dsa(id,true,false,func),packet(2,3,[id]),clear(4),draw()),'depth compare '+func);const expected=[false,false,true,true,false,false,true,true][func]?red:black;compares.push(await pixels(r,c,1,()=>expected,'depth function '+func));}
  // Write-mask false must not replace depth; full depth clear bypasses the mask.
  run(join(packet(2,3,[8]),clear(5,black.map(v=>v/255),.5)),'write mask false clear');replaceGeometry(r,c,1,3,-.5);run(join(constant([0,1,0,1]),draw()),'near without depth write');replaceGeometry(r,c,1,3,0);run(join(constant([1,0,0,1]),draw()),'mid after no-write near');frames.push(await pixels(r,c,1,()=>green,'depth write mask false preserves middle depth'));
  const rt=(1|(3<<4)|(19<<9)|(1<<17)|(19<<22)|(15<<27))>>>0;
  replaceGeometry(r,c,1,3,-.999);run(join(packet(1,1,[40,0,0,rt,0,0,0,0,0,0,0]),packet(2,1,[40]),packet(2,2,[10]),scissor(4,4,8,8),viewport(true),clear(4,[0,0,1,1]),constant([1,0,0,.25]),draw()),'depth blend scissor negative-Y');
  frames.push(await pixels(r,c,1,(x,y)=>x>=4&&x<12&&y>=4&&y<12?[64,0,191,255]:blue,'adjacent depth blend scissor orientation'));
  run(join(packet(2,1,[0]),packet(2,2,[6]),packet(2,3,[7]),viewport(),constant([0,1,0,1]),draw()),'adjacent reset all raster state');frames.push(await pixels(r,c,1,()=>green,'adjacent disabled depth blend scissor positive-Y'));
  const faults=[];const reject=(bytes,label,code)=>{const count=r.calls.length,res=c.bad(r.run(1,bytes,label),label,code);c.equal(r.calls.length,count,label+' issues no draw');c.equal(gl.getError(),gl.NO_ERROR,label+' zero GL errors');faults.push({label,error:res.error});};
  reject(draw(0x7ffffffe,4),'signed array range','unsupported-draw');reject(draw(10,4),'array fetch end','out-of-bounds');
  reject(packet(1,5,[88,2,0,0,30]),'unaligned RGB source offset','invalid-value');reject(packet(6,0,[12,2,3]),'unaligned vertex buffer','out-of-bounds');
  reject(packet(5,0,[1,3,4]),'color/depth role swap','incompatible-resource');
  c.ok(r.store.createResource(metadata(4,2,16,1,8,8)),'mismatched depth resource');c.ok(r.store.attachContext(1,4),'mismatched depth membership');run(packet(1,8,[99,4,16,0,0]),'mismatched depth surface');reject(packet(5,0,[1,99,3]),'mismatched attachment dimensions','incompatible-resource');
  run(join(packet(2,3,[8]),packet(5,0,[1,0,3])),'unbind active depth');reject(draw(),'depth test missing attachment','incomplete-draw');reject(clear(1),'depth clear missing attachment','incomplete-framebuffer');run(packet(5,0,[1,4,3]),'restore depth attachment');
  run(join(packet(5,0,[0,4]),clear(1)),'depth-only framebuffer clear');reject(clear(4),'color clear missing attachment','incomplete-framebuffer');run(packet(5,0,[1,4,3]),'restore full framebuffer');
  run(packet(6,0,[]),'missing attributes');reject(draw(),'missing reflected RGB attribute','incomplete-draw');run(packet(6,0,[12,0,3]),'restore RGB attribute');
  c.equal(r.reads,{sync:0,async:0},'nonindexed triangles require no GPU index staging');
  const calls=r.calls.slice();dispose(r,c,'literal');return{frames,compares,calls,faults};
}

async function original(gl,bridge,fixture,c){
  const r=rig(gl,bridge,c);createResources(r,c,fixture.contextId,fixture.resources.map(x=>x.metadata));
  for(const entry of fixture.resources)if(entry.upload){const bytes=decode64(entry.upload.backingBase64);c.ok(r.store.attachBacking(entry.metadata.id,[bytes]),'original CPU snapshot '+entry.upload.snapshotEvent);c.equal(await sha(bytes),entry.upload.backingSha256,'original backing SHA');}
  const submissions=[];
  for(const source of fixture.submissions){const count=r.calls.length,result=c.ok(r.run(fixture.contextId,Uint8Array.from(source.data),'original '+fixture.workload+' '+source.event),'complete original submit '+source.event);c.equal(result.appliedCommands,source.packets.length,'all original packet boundaries executed');submissions.push({event:source.event,sourceSha256:source.sourceSha256,draws:result.draws,calls:r.calls.slice(count)});}
  c.equal(r.calls.length,fixture.draws.length,'original actual draw count '+fixture.workload);
  const uniforms=[];
  for(let i=0;i<fixture.draws.length;i++){
    const d=fixture.draws[i],call=r.calls[i],source=fixture.submissions.find(s=>s.event===d.citation.event),packet=source.packets.find(p=>p.citation.byteOffset===d.citation.byteOffset),w=packet.words;
    c.equal([call.op,call.args],['drawArrays',[gl.TRIANGLE_STRIP,w[0],w[1]]],'literal original array strip '+fixture.workload+' '+i);
    c.equal(call.attributes.map(a=>[a.components,a.stride,a.offset,a.resourceId]),fixture.workload==='kmscube'?[[3,44,0,4],[3,44,24,4],[2,44,36,4]]:[[3,24,0,d.vertexBuffers[0].resourceId],[3,24,12,d.vertexBuffers[0].resourceId]],'original active RGB/RG fetches '+fixture.workload+' '+i);
    c.equal(call.viewport,fixture.workload==='kmscube'?[0,0,640,480]:[0,-468,1024,768],'original negative-Y viewport '+fixture.workload+' '+i);c.equal(call.winsysY,-1,'original system Y uniform '+fixture.workload+' '+i);c.equal(call.depthRange,[0,1],'original GL clip depth range');
    c.equal([call.depth.enabled,call.depth.write,call.depth.func,call.depth.bits],fixture.workload==='kmscube'?[false,false,gl.NEVER,0]:[true,true,gl.LESS,16],'original DSA and real depth attachment '+fixture.workload+' '+i);
    c.equal([call.cull.enabled,call.cull.face,call.cull.front],[true,gl.BACK,gl.CW],'original lower-left back culling');
    const bank=d.constantBuffers[0],bankSource=fixture.submissions.find(s=>s.event===bank.citation.event),words=bankSource.packets.find(p=>p.citation.byteOffset===bank.citation.byteOffset).words.slice(2);
    c.equal(call.constants.vsconst0,words,'original full vertex constant bank '+fixture.workload+' '+i);uniforms.push({citation:bank.citation,words});
  }
  const surface=fixture.resources.find(x=>x.metadata.target===2&&x.metadata.format!==16&&x.metadata.id!==5),m=surface.metadata,physical=readPhysical(r,c,m.id,m.width,m.height,m.format);
  const raw=new Uint8Array(physical.buffer,physical.byteOffset,physical.byteLength),digest=await sha(raw);
  c.equal(r.reads,{sync:0,async:0},'original nonindexed clients never read GPU indices');
  const calls=r.calls.slice();dispose(r,c,fixture.workload);return{workload:fixture.workload,submissions,calls,uniforms,physical:{sha256:digest,bytes:raw.length,format:m.format,width:m.width,height:m.height},inventorySha256:fixture.inventorySha256};
}

async function asyncArrays(gl,bridge,c,delay){
  const r=rig(gl,bridge,c,{async:true,delay});
  createResources(r,c,1,[metadata(1,2,67,2,16,16),metadata(2,2,16,1,16,16),metadata(3,0,64,16,144)]);
  c.ok(r.store.attachBacking(3,[geometry()]),'async owned CPU vertex backing');
  const setup=c.ok(r.renderer.beginSubmission(1,join(syntheticCommands(),packet(43,0,[3,0,0,0,0,0,0,0,144,1,1,0,1]))),'async setup job').job;
  let setupDone=false;for(let i=0;i<1000;i++){const step=c.ok(r.renderer.step(setup),'async setup pump');if(step.status==='needs-input')c.ok(r.renderer.provideInput(setup,step.request.token,geometry()),'owned async vertex upload');else if(step.status==='done'){c.ok(step.result,'async setup completion');setupDone=true;break;}await new Promise(resolve=>setTimeout(resolve,i%3));}
  c.equal(setupDone,true,'async setup terminates');r.calls.length=0;
  const owned=join(clear(),constant([1,0,0,1]),draw(),viewport(true),constant([0,1,0,1]),draw(),viewport(),constant([0,0,1,1]),draw());
  const job=c.ok(r.renderer.beginSubmission(1,owned),'owned array job').job;owned.fill(255);let result,pumps=0,waits=0;
  while(pumps++<1000){const step=c.ok(r.renderer.step(job),'later-task array step');if(step.status==='done'){result=c.ok(step.result,'array job completion');break;}if(step.status==='waiting-gpu')waits++;await new Promise(resolve=>setTimeout(resolve,(pumps+delay)%3));}
  c.equal(Boolean(result),true,'bounded array job terminates');c.equal(result.gpuComplete,true,'arrays retire through a real completion fence');c.equal(r.calls.length,3,'owned arrays issue three real draws');c.equal(r.reads,{sync:0,async:0},'owned arrays avoid both index read paths');c.equal(waits>delay,true,'real array fence is polled in later tasks');const frame=await pixels(r,c,1,()=>blue,'asynchronous original/negated/restored orientation '+delay);const calls=r.calls.slice();dispose(r,c,'async '+delay);return{delay,pumps,waits,gpuComplete:result.gpuComplete,draws:result.draws,calls,frame};
}

async function restoration(gl,bridge,c){
  const r=rig(gl,bridge,c);synthetic(r,c,1,0);upload(r,c,1,3,geometry());synthetic(r,c,2,10);upload(r,c,2,13,geometry());const frames=[];
  for(const[ctx,negative,color,expected]of [[1,false,[1,0,0,1],red],[2,true,[0,1,0,1],green],[1,false,[1,0,0,1],red]]){poison(gl);c.ok(r.run(ctx,join(viewport(negative),raster(50,{scissor:true}),packet(2,2,[50]),scissor(ctx===1?1:8,2,6,9),packet(2,3,[7]),clear(),constant(color),draw()),'A/B/A '+ctx),'poisoned A/B/A state');frames.push(await pixels(r,c,ctx===1?1:11,(x,y)=>x>=(ctx===1?1:8)&&x<(ctx===1?7:14)&&y>=2&&y<11?expected:black,'A/B/A context '+ctx+' '+frames.length));c.ok(r.run(ctx,packet(3,2,[50]),'drop copied raster name'),'copied raster cleanup');}
  c.equal(frames[0].sha256,frames[2].sha256,'A/B/A preserves exact A pixels');
  const before=r.calls.length;c.bad(r.run(2,packet(1,8,[99,1,67,0,0]),'foreign surface'),'resource membership remains context-owned');c.equal(r.calls.length,before,'foreign attachment issues no draw');
  // Public depth names and resource IDs can disappear while the framebuffer retains its allocation.
  c.ok(r.run(1,packet(3,8,[4]),'drop bound depth name'),'bound depth name destroy');c.ok(r.store.unref(2),'unref retained depth');c.ok(r.store.createResource(metadata(2,2,16,1,8,8)),'reuse public depth ID');c.ok(r.store.attachContext(1,2),'attach replacement depth ID');c.ok(r.run(1,join(packet(2,3,[9]),clear(),draw()),'retained depth draw'),'old depth attachment survives name/ID reuse');c.equal(r.calls.at(-1).depth.bits,16,'retained native Z16 attachment');c.equal(r.calls.at(-1).depth.resourceId,null,'replacement ID cannot resolve old native texture');
  const calls=r.calls.slice();dispose(r,c,'restoration/lifetime');return{frames,calls};
}

export async function runBrowserRasterAcceptance(fixtures){
  const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw new Error('physical WebGL2 unavailable');
  const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);c.equal(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(renderer),false,'physical GPU renderer');
  const bridge=await createVirglShaderBridge(),originals=[];
  const literals=await literal(gl,bridge,c);
  for(const f of fixtures.clients)originals.push(await original(gl,bridge,f,c));
  const jobs=[];for(const delay of [0,1,3])jobs.push(await asyncArrays(gl,bridge,c,delay));
  const restored=await restoration(gl,bridge,c);c.equal(gl.getError(),gl.NO_ERROR,'final zero GL errors');
  return{status:'passed',guestExecution:false,productionNegotiation:false,renderer,literals,originals,jobs,restored,assertions:c.rows};
}
