// Independent Gallium wire values and rational blending oracle. No renderer tables.
import {decodeSubmission} from '../decoder.mjs';
import {createResourceStore, createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer, createVirglAsyncRenderer} from '../state.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

const SOURCE_FACTORS = [1,2,3,4,5,6,7,8,17,18,19,20,21,23,24];
const DESTINATION_FACTORS = [1,2,3,4,5,7,8,17,18,19,20,21,23,24];
const EQUATIONS = [0x8006,0x800a,0x800b,0x8007,0x8008];
const FACTORS = {1:1,2:0x300,3:0x302,4:0x304,5:0x306,6:0x308,7:0x8001,8:0x8003,
  17:0,18:0x301,19:0x303,20:0x305,21:0x307,23:0x8002,24:0x8004};
const VS='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
const FS='FRAG\nDCL CONST[0]\nDCL OUT[0], COLOR\n0: MOV OUT[0], CONST[0]\n1: END\n';
const KILL='FRAG\nDCL OUT[0], COLOR\n0: KILL\n1: END\n';
const S=[.25,.5,.75,.875], C=[.75,.125,.5,.625], D=[128,64,192,160];
function checks(){const rows=[];const same=(observed,expected,prediction)=>{const held=JSON.stringify(observed)===JSON.stringify(expected);rows.push({prediction,expected,observed,held});if(!held)throw new Error(prediction+': expected '+JSON.stringify(expected)+', got '+JSON.stringify(observed));};
  const ok=(r,label)=>{same(r?.ok,true,label+' ('+(r?.error?.message??'')+')');return r;};const bad=(r,label,code)=>{same(r?.ok,false,label+' rejects');if(code)same(r.error.code,code,label+' code');return r;};return{rows,same,ok,bad};}
export function packet(op,type,words){const b=new Uint8Array(4+words.length*4),v=new DataView(b.buffer);v.setUint32(0,op|(type<<8)|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+i*4,w,true));return b;}
const join=(...parts)=>{const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){b.set(p,at);at+=p.length;}return b;};
const word=f=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,f,true);return v.getUint32(0,true);};
const hex=b=>[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
const blend=(id,t,enabled=true)=>packet(1,1,[id,0,0,(Number(enabled)|(t.rgbFunction<<1)|(t.rgbSourceFactor<<4)|(t.rgbDestinationFactor<<9)|
  (t.alphaFunction<<14)|(t.alphaSourceFactor<<17)|(t.alphaDestinationFactor<<22)|((t.mask??15)<<27))>>>0,0,0,0,0,0,0,0]);
const target=(rgbSourceFactor=1,rgbDestinationFactor=17,alphaSourceFactor=1,alphaDestinationFactor=17,rgbFunction=0,alphaFunction=0,mask=15)=>
  ({rgbSourceFactor,rgbDestinationFactor,alphaSourceFactor,alphaDestinationFactor,rgbFunction,alphaFunction,mask});

export function runBlendWireAcceptance(){const c=checks();let admitted=0,rejected=0;
  for(const enabled of [false,true])for(let slot=0;slot<4;slot++)for(let factor=0;factor<32;factor++){
    const values=[1,17,1,17];values[slot]=factor;const t=target(...values),r=decodeSubmission(blend(1,t,enabled));
    const expected=(enabled?false:factor===0)||(slot%2===0?SOURCE_FACTORS:DESTINATION_FACTORS).includes(factor);
    c.same(r.ok,expected,'pinned '+(enabled?'enabled':'disabled')+' factor slot'+slot+' value'+factor);
    if(expected){const f=r.commands[0].fields.renderTargets[0];c.same([f.rgbSourceFactor,f.rgbDestinationFactor,f.alphaSourceFactor,f.alphaDestinationFactor],values,'owned factor fields');admitted++;}else{c.same([r.error.opcode,r.error.byteOffset],[1,0],'factor error provenance');rejected++;}
  }
  for(const alpha of [false,true])for(let equation=0;equation<8;equation++){
    const t=target();t[alpha?'alphaFunction':'rgbFunction']=equation;
    c.same(decodeSubmission(blend(1,t)).ok,equation<5,'pinned equation '+alpha+'/'+equation);
  }
  for(const bits of [1,2,8,16,0x80000000]){const b=blend(1,target());new DataView(b.buffer).setUint32(8,bits,true);c.bad(decodeSubmission(b),'unsupported blend flag '+bits);}
  for(const bits of [1,15]){const b=blend(1,target());new DataView(b.buffer).setUint32(12,bits,true);c.bad(decodeSubmission(b),'logic operation '+bits);}
  const multi=blend(1,target());new DataView(multi.buffer).setUint32(20,15<<27,true);c.bad(decodeSubmission(multi),'second render target');
  return{status:'passed',admitted,rejected,assertions:c.rows};
}

const rational=(n,d=1)=>[BigInt(n),BigInt(d)], add=(a,b)=>[a[0]*b[1]+b[0]*a[1],a[1]*b[1]], mul=(a,b)=>[a[0]*b[0],a[1]*b[1]],
  neg=a=>[-a[0],a[1]], sub=(a,b)=>add(a,neg(b)), compare=(a,b)=>a[0]*b[1]-b[0]*a[1], min=(a,b)=>compare(a,b)<=0?a:b,
  max=(a,b)=>compare(a,b)>=0?a:b, clamp=a=>min(rational(1),max(rational(0),a));
function factor(id,lane,source,destination,color){switch(id){
  case 1:return rational(1);case 17:return rational(0);
  case 2:return source[lane];case 18:return sub(rational(1),source[lane]);
  case 3:return source[3];case 19:return sub(rational(1),source[3]);
  case 4:return destination[3];case 20:return sub(rational(1),destination[3]);
  case 5:return destination[lane];case 21:return sub(rational(1),destination[lane]);
  case 6:return lane===3?rational(1):min(source[3],sub(rational(1),destination[3]));
  case 7:return color[lane];case 23:return sub(rational(1),color[lane]);
  case 8:return color[3];case 24:return sub(rational(1),color[3]);
  default:throw new Error('oracle factor outside pinned independent list');
}}
const round=(a,scale)=>Number((2n*a[0]*BigInt(scale)+a[1])/(2n*a[1]));
export function expectedPixel(t,source=S,color=C,destination=D,format=67){
  const scales=format===233?[1023,1023,1023,3]:[255,255,255,255],xalpha=format!==67;
  const stored=destination.map((v,i)=>i===3&&xalpha?scales[i]:Math.round(v*scales[i]/255));
  const src=source.map(v=>clamp(rational(Math.round(v*8),8))),dst=stored.map((v,i)=>rational(v,scales[i])),constant=color.map(v=>clamp(rational(Math.round(v*8),8)));
  return src.map((s,i)=>{if((t.mask&(1<<i))===0||i===3&&xalpha)return stored[i];const a=i===3;
    const equation=a?t.alphaFunction:t.rgbFunction;let value;
    if(equation===3)value=min(s,dst[i]);else if(equation===4)value=max(s,dst[i]);
    else{const left=mul(s,factor(a?t.alphaSourceFactor:t.rgbSourceFactor,i,src,dst,constant)),right=mul(dst[i],factor(a?t.alphaDestinationFactor:t.rgbDestinationFactor,i,src,dst,constant));value=equation===0?add(left,right):equation===1?sub(left,right):sub(right,left);}
    return round(clamp(value),scales[i]);});
}
export const BLEND_CASES=[];
for(const stage of ['rgb','alpha'])for(let fn=0;fn<5;fn++)for(const sf of SOURCE_FACTORS)for(const df of DESTINATION_FACTORS){
  const t=stage==='rgb'?target(sf,df,3,19,fn,(fn+2)%5):target(3,19,sf,df,(fn+2)%5,fn);
  BLEND_CASES.push({name:stage+'-'+fn+'-'+sf+'-'+df,target:t,source:S,color:C,destination:D,format:67});
}
for(const sf of [7,8,23,24])for(const df of ([7,23].includes(sf)?[8,24]:[7,23]))for(const fn of [0,1,2])
  BLEND_CASES.push({name:'mixed-clamps-'+sf+'-'+df+'-'+fn,target:target(sf,df,6,3,fn,fn,5),source:[-.5,2,.75,.125],color:[-.5,2,.25,1.5],destination:D,format:67});
for(const format of [2,233])for(let i=0;i<SOURCE_FACTORS.length;i++)for(let fn=0;fn<5;fn++)
  BLEND_CASES.push({name:'xalpha-'+format+'-'+fn+'-'+SOURCE_FACTORS[i],target:target(SOURCE_FACTORS[i],DESTINATION_FACTORS[(i+7)%14],6,19,fn,(fn+3)%5),source:S,color:C,destination:D,format});
for(const t of [target(0,0,0,0,4,3,5),target(23,8,6,19,2,1,10)])
  BLEND_CASES.push({name:'disabled-'+t.rgbSourceFactor,target:t,enabled:false,source:[-.5,2,.75,.125],color:C,destination:D,format:67});
BLEND_CASES.push({name:'saturation-source-alpha-minimum',target:target(6,17,6,17),source:[.75,.5,.25,.125],color:C,destination:D,format:67});

function shader(id,stage,text){const b=packet(1,4,[id,stage,text.length+1,64,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;}
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
function clear(color){const b=packet(7,0,[4,...color.map(word),0,0,0]);new DataView(b.buffer).setFloat64(24,1,true);return b;}
const meta=(id,target,format,bind,width,height=1)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
function rig(gl,bridge,c,{asynchronous=false,delay=0,hostLimit=null,pad=false}={}){
  const allocations=new Map(),calls=[],live=new Map(['Texture','Buffer','Shader','Program','Sampler','VertexArray','Framebuffer','Sync'].map(k=>[k,new Set()]));
  const control={remaining:0,failVariant:false},methods=new Map();let waits=0,fences=0;
  const traced=new Proxy(gl,{get(t,k){if(typeof t[k]!=='function')return Reflect.get(t,k,t);if(methods.has(k))return methods.get(k);const f=(...args)=>{
    if(k==='getParameter'&&args[0]===gl.MAX_FRAGMENT_UNIFORM_COMPONENTS&&hostLimit!==null)return hostLimit;
    if(k==='createShader'&&control.failVariant)return null;
    if(k==='clientWaitSync'){waits++;if(control.remaining>0){control.remaining--;return gl.TIMEOUT_EXPIRED;}}
    const out=t[k].apply(t,args);
    if(k.startsWith('create')){const kind=k.slice(6);if(live.has(kind)&&out)live.get(kind).add(out);}
    if(k.startsWith('delete')){const kind=k.slice(6);if(live.has(kind))live.get(kind).delete(args[0]);}
    if(k==='fenceSync'){fences++;control.remaining=delay;live.get('Sync').add(out);}
    if(k==='drawArrays'||k==='drawElements'){
      const p=gl.getParameter(gl.CURRENT_PROGRAM),u=gl.getUniformLocation(p,'wv_rgb_blend_factor');
      calls.push({op:k,args:[...args],blend:gl.isEnabled(gl.BLEND),equations:[gl.getParameter(gl.BLEND_EQUATION_RGB),gl.getParameter(gl.BLEND_EQUATION_ALPHA)],
        factors:[gl.getParameter(gl.BLEND_SRC_RGB),gl.getParameter(gl.BLEND_DST_RGB),gl.getParameter(gl.BLEND_SRC_ALPHA),gl.getParameter(gl.BLEND_DST_ALPHA)],
        color:[...gl.getParameter(gl.BLEND_COLOR)],mask:[...gl.getParameter(gl.COLOR_WRITEMASK)],fold:u===null?null:[...gl.getUniform(p,u)],
        sourceWords:gl.getUniformLocation(p,'fsconst0[0]')===null?[]:[...gl.getUniform(p,gl.getUniformLocation(p,'fsconst0[0]'))]});
    }return out;};methods.set(k,f);return f;}});
  const compiler={...bridge,translate(request){const out=bridge.translate(request);return !pad||!out.ok||request.stage!=='fragment'?out:{...out,glsl:out.glsl+' '.repeat(262140-out.glsl.length)};}};
  const native=c.ok(createWebGL2TransferBackend(traced),'blend physical backend').backend;
  const owned=c.ok(createResourceStore({backend:{...native,allocate(m){const out=native.allocate(m);allocations.set(m.id,out);return out;}}}),'blend owned store');
  const renderer=c.ok((asynchronous?createVirglAsyncRenderer:createVirglDrawRenderer)({gl:traced,shaderBridge:compiler,resources:owned.store,bindings:owned.bindings,
    limits:{programs:2,uniformBytes:1312},cacheLimits:{states:4,translations:2},...(asynchronous?{asyncAccess:owned.asyncAccess,jobLimits:{commandsPerStep:1}}:{})}),'blend renderer').renderer;
  for(const ctx of [1,2]){c.ok(owned.store.createContext(ctx),'resource context '+ctx);c.ok(renderer.createContext(ctx),'renderer context '+ctx);}
  const geometry=new Uint8Array(48);new Float32Array(geometry.buffer).set([-1,-1,0,-1,1,0,1,-1,0,1,1,0]);
  for(const m of [meta(1,2,67,2,16,16),meta(2,2,2,2,16,16),meta(4,2,233,2,16,16),meta(3,0,64,16,48)]){
    c.ok(owned.store.createResource(m),'blend resource '+m.id);for(const ctx of [1,2])c.ok(owned.store.attachContext(ctx,m.id),'blend attachment '+ctx+'/'+m.id);}
  c.ok(owned.store.attachBacking(3,[geometry]),'owned blend vertices');const reader=gl.createFramebuffer();
  return{...owned,renderer,gl,calls,allocations,live,control,reader,frame:0,lastDump:null,waits:()=>waits,fences:()=>fences};
}
const setup=(fragment=FS)=>join(shader(1,0,VS),shader(2,1,fragment),...[[4,1,67],[8,2,2],[9,4,233]].map(([id,resource,format])=>packet(1,8,[id,resource,format,0,0])),
  packet(5,0,[1,0,4]),packet(1,5,[5,0,0,0,30]),packet(2,5,[5]),packet(6,0,[12,0,3]),
  packet(1,2,[6,2|(1<<29),word(1),0,65535,word(1),0,0,0]),packet(2,2,[6]),
  packet(4,0,[0,...[8,8,.5,8,8,.5].map(word)]),packet(31,0,[1,0]),packet(31,0,[2,1]),
  packet(43,0,[3,0,0,0,0,0,0,0,48,1,1,0,1]));
const colorResource=format=>format===67?1:format===2?2:4,surface=format=>format===67?4:format===2?8:9;
const commands=(test,id=70)=>join(packet(5,0,[1,0,surface(test.format)]),blend(id,test.target,test.enabled!==false),packet(2,1,[id]),packet(3,1,[id]),
  packet(14,0,test.color.map(word)),packet(12,0,[1,0,...test.source.map(word)]),clear(test.destination.map(v=>v/255)),draw());
const nativeRun=(r,c,ctx,b,label)=>{c.ok(r.renderer.beginFrame(++r.frame),label+' capture');const result=r.renderer.executeSubmission(ctx,b);r.lastDump=c.ok(r.renderer.endFrame(r.frame),label+' recorded draw').dump;return c.ok(result,label);};
function read(r,c,format){const gl=r.gl;gl.bindFramebuffer(gl.READ_FRAMEBUFFER,r.reader);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations.get(colorResource(format)).texture,0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);
  const out=format===233?new Uint32Array(256):new Uint8Array(1024);gl.readPixels(0,0,16,16,gl.RGBA,format===233?gl.UNSIGNED_INT_2_10_10_10_REV:gl.UNSIGNED_BYTE,out);
  c.same(gl.getError(),gl.NO_ERROR,'independent blend framebuffer read');return new Uint8Array(out.buffer);}
const channels=(bytes,pixel,format)=>{if(format!==233)return [...bytes.slice(pixel*4,pixel*4+4)];const w=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(pixel*4,true);return[w&1023,(w>>>10)&1023,(w>>>20)&1023,w>>>30];};
function verifyFrame(r,c,test,evidence,bytes,packetBytes){const t=test.target,effective=test.enabled===false?target(1,17,1,17,0,0,t.mask):t;
  const expected=expectedPixel(test.discarded?{...effective,mask:0}:effective,test.source,test.color,test.destination,test.format),raw=read(r,c,test.format),mismatches=[];
  for(let i=0;i<256;i++){const actual=channels(raw,i,test.format);if(actual.some((v,l)=>Math.abs(v-expected[l])>1))mismatches.push({pixel:i,expected,actual});}
  evidence.frames.push({...test,packetHex:hex(packetBytes),expected,pixels:[...raw],native:r.calls.at(-1),dump:r.lastDump});
  c.same(mismatches.slice(0,3),[],test.name+' rational physical pixels');
  const mixed=effective.rgbFunction<3&&([7,23].includes(effective.rgbSourceFactor)&&[8,24].includes(effective.rgbDestinationFactor)||[8,24].includes(effective.rgbSourceFactor)&&[7,23].includes(effective.rgbDestinationFactor));
  c.same(r.calls.at(-1).blend,test.enabled!==false,test.name+' actual enable');
  c.same(r.calls.at(-1).equations,[EQUATIONS[effective.rgbFunction],EQUATIONS[effective.alphaFunction]],test.name+' actual equations');
  c.same(r.calls.at(-1).factors,[effective.rgbFunction>=3||mixed?1:FACTORS[effective.rgbSourceFactor],effective.rgbFunction>=3?0:FACTORS[effective.rgbDestinationFactor],effective.alphaSourceFactor===6?1:FACTORS[effective.alphaSourceFactor],FACTORS[effective.alphaDestinationFactor]],test.name+' actual factors');
  c.same(r.calls.at(-1).sourceWords,test.discarded?[]:test.source.map(word),test.name+' actual owned source bank');
  c.same(r.calls.at(-1).fold!==null,mixed&&!test.discarded,test.name+' actual fold reflection');
  if(mixed&&!test.discarded){const color=test.color.map(v=>Math.max(0,Math.min(1,v)));let f=[8,24].includes(t.rgbSourceFactor)?Array(3).fill(color[3]):color.slice(0,3);if([23,24].includes(t.rgbSourceFactor))f=f.map(v=>1-v);
    c.same(r.calls.at(-1).fold,[...f,1],test.name+' owned folded factor');}
  bytes.push(raw);
}
function poison(gl){gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT,gl.FUNC_SUBTRACT);gl.blendFuncSeparate(gl.ZERO,gl.ONE,gl.ZERO,gl.ONE);gl.blendColor(1,0,1,0);gl.colorMask(false,false,false,false);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.useProgram(null);gl.bindVertexArray(null);}
function dispose(r,c,label){r.gl.deleteFramebuffer(r.reader);c.ok(r.renderer.dispose(),label+' renderer disposal');c.ok(r.store.dispose(),label+' resource disposal');for(const owner of [r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),label+' final accounting').budgets))c.same(v,0,label+' budget '+k);for(const[k,v]of r.live)c.same(v.size,0,label+' native deletion '+k);c.same(r.gl.getError(),r.gl.NO_ERROR,label+' final GL error');}

export async function runBrowserBlendAcceptance(){const c=checks(),wire=runBlendWireAcceptance(),evidence={frames:[],jobs:[]};window.__blendEvidence=evidence;
  const canvas=document.querySelector('#gpu'),gl=canvas.getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});c.same(Boolean(gl),true,'actual WebGL2');
  const debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)};
  c.same(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(gpu.renderer),false,'physical hardware renderer');
  const bridge=await createVirglShaderBridge(),r=rig(gl,bridge,c),raw=[];for(const ctx of [1,2])nativeRun(r,c,ctx,setup(),'setup context '+ctx);
  for(const [i,test]of BLEND_CASES.entries()){if(i%97===0)poison(gl);const bytes=commands(test);nativeRun(r,c,1,bytes,test.name);verifyFrame(r,c,test,evidence,raw,bytes);}
  // Complete color/state ownership survives destruction and public-ID reuse.
  for(const [i,sf]of [7,8,23,24,7].entries())for(const ctx of [1,2,1]){
    const test={name:'owner-'+i+'-'+ctx,target:target(sf,[7,23].includes(sf)?8:7,3,19,i%3,(i+1)%3,i%2?10:15),
      source:i%2?[.75,.125,.25,.5]:S,color:i%2?[.125,.75,.25,.875]:C,destination:D,format:67};
    poison(gl);const bytes=commands(test,77);nativeRun(r,c,ctx,bytes,test.name);verifyFrame(r,c,test,evidence,raw,bytes);
  }
  const pressure=r.renderer.inspect();c.same(pressure.caches.program.evictions>0,true,'actual bounded variant program eviction');c.same(pressure.caches.state.evictions>0,true,'actual owned blend state eviction');
  nativeRun(r,c,1,join(packet(29,0,[42]),packet(28,0,[42]),setup()),'real second subcontext setup');
  for(const sub of [0,42,0]){const test={...BLEND_CASES.find(t=>t.target.rgbSourceFactor===23&&t.target.rgbDestinationFactor===8&&t.target.rgbFunction===0),name:'subcontext-'+sub};
    poison(gl);const bytes=join(packet(28,0,[sub]),commands(test));nativeRun(r,c,1,bytes,test.name);verifyFrame(r,c,test,evidence,raw,bytes);}
  nativeRun(r,c,1,packet(30,0,[42]),'destroy independent subcontext');
  // Reject variants at the real native allocation boundary; recover unchanged banks.
  nativeRun(r,c,1,packet(2,1,[0]),'unbind blend before fault');c.ok(r.renderer.resetCaches(),'evict native programs before fault');
  nativeRun(r,c,1,packet(2,1,[0]),'prewarm ordinary program before fault');
  const fault=BLEND_CASES.find(t=>t.target.rgbSourceFactor===7&&t.target.rgbDestinationFactor===8&&t.target.rgbFunction===0),before=r.renderer.inspect().budgets;
  r.control.failVariant=true;c.bad(r.renderer.executeSubmission(1,commands(fault)),'variant allocation','backend-error');r.control.failVariant=false;
  c.same(r.renderer.inspect().budgets.shaderBytes,before.shaderBytes,'variant allocation releases shader bytes');c.same(r.renderer.inspect().budgets.uniformBytes,before.uniformBytes,'variant allocation releases system bytes');
  const recovered={...fault,name:'allocation-recovery'};const recovery=join(packet(2,1,[0]),packet(3,1,[70]),commands(recovered,71));nativeRun(r,c,1,recovery,recovered.name);verifyFrame(r,c,recovered,evidence,raw,recovery);dispose(r,c,'synchronous');
  for(const delay of [0,1,3]){const a=rig(gl,bridge,c,{asynchronous:true,delay});
    const pump=async(bytes,label)=>{c.ok(a.renderer.beginFrame(++a.frame),label+' capture');const job=c.ok(a.renderer.beginSubmission(1,bytes),label+' begin').job;bytes.fill(255);let result,polls=0;
      for(;polls<5000;polls++){const step=c.ok(a.renderer.step(job),label+' step');if(step.status==='needs-input'){
          const layout=step.request.layout,rows=[];for(let i=0;i<layout.rowCount;i++)rows.push(c.ok(a.store.readBacking(step.request.resource.id,layout.offset+i*layout.rowStride,layout.rowBytes),label+' owned gather row').bytes);
          c.ok(a.renderer.provideInput(job,step.request.token,join(...rows)),label+' provide owned bytes');
        }else if(step.status==='done'){result=c.ok(step.result,label+' result');break;}await new Promise(resolve=>setTimeout(resolve,polls%3));}
      c.same(Boolean(result),true,label+' bounded native completion');c.same(result.gpuComplete,true,label+' actual native GPU completion');a.lastDump=c.ok(a.renderer.endFrame(a.frame),label+' recorded job').dump;return polls;};
    await pump(setup(),'asynchronous setup');const start=a.fences(),test={...fault,name:'async-'+delay},bytes=commands(test),saved=bytes.slice();const polls=await pump(bytes,test.name);verifyFrame(a,c,test,evidence,raw,saved);
    c.same(a.fences()-start,1,test.name+' one real fence');evidence.jobs.push({delay,polls,waits:a.waits(),fences:a.fences(),gpuComplete:true});dispose(a,c,test.name);
  }
  for(const options of [{hostLimit:4},{pad:true}]){const a=rig(gl,bridge,c,options);nativeRun(a,c,1,setup(),'negative setup');const before=a.calls.length;
    c.bad(a.renderer.executeSubmission(1,commands(fault)),options.pad?'variant output bound':'host factor components',options.pad?'limit-exceeded':'shader-reflection-error');c.same(a.calls.length,before,'negative variant issues no native draw');
    const ordinary={...BLEND_CASES[0],name:options.pad?'output-bound-recovery':'host-limit-recovery'},bytes=join(packet(2,1,[0]),packet(3,1,[70]),commands(ordinary,71));nativeRun(a,c,1,bytes,ordinary.name);verifyFrame(a,c,ordinary,evidence,raw,bytes);dispose(a,c,ordinary.name);
  }
  const discarded=rig(gl,bridge,c),kill={...fault,name:'mixed-constant-terminal-discard',discarded:true};
  nativeRun(discarded,c,1,setup(KILL),'terminal discard setup');const killBytes=commands(kill);nativeRun(discarded,c,1,killBytes,kill.name);verifyFrame(discarded,c,kill,evidence,raw,killBytes);dispose(discarded,c,'terminal discard');
  const all=join(...raw),binary=[];for(let at=0;at<all.length;at+=16384)binary.push(String.fromCharCode(...all.subarray(at,at+16384)));
  for(const frame of evidence.frames)delete frame.pixels;
  return{status:'passed',guestExecution:false,productionNegotiation:false,gpu,wire,assertions:c.rows,records:evidence.frames,jobs:evidence.jobs,pressure,
    rawPixelsBase64:btoa(binary.join('')),rawBytes:all.length,quantizationBudget:1,frames:evidence.frames.length};
}
