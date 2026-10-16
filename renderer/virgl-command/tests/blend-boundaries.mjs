// Fresh critic promotion: independently predicted owner restoration, native reflection rejection, and sampler-view/blend composition.
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
const S=[0.484375, 0.21875, 0.484375, 0.34375], C=[0.734375, 0.75, 0.796875, 0.8125], D=[208, 225, 59, 235];
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
  const src=source.map(v=>clamp(rational(Math.round(v*64),64))),dst=stored.map((v,i)=>rational(v,scales[i])),constant=color.map(v=>clamp(rational(Math.round(v*64),64)));
  return src.map((s,i)=>{if((t.mask&(1<<i))===0||i===3&&xalpha)return stored[i];const a=i===3;
    const equation=a?t.alphaFunction:t.rgbFunction;let value;
    if(equation===3)value=min(s,dst[i]);else if(equation===4)value=max(s,dst[i]);
    else{const left=mul(s,factor(a?t.alphaSourceFactor:t.rgbSourceFactor,i,src,dst,constant)),right=mul(dst[i],factor(a?t.alphaDestinationFactor:t.rgbDestinationFactor,i,src,dst,constant));value=equation===0?add(left,right):equation===1?sub(left,right):sub(right,left);}
    return round(clamp(value),scales[i]);});
}
const BLEND_CASES=[{name:'critic-mixed-base',target:target(7,8,3,19,0,2),source:S,color:C,destination:D,format:67}];

function shader(id,stage,text){const b=packet(1,4,[id,stage,text.length+1,64,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;}
const draw=()=>packet(8,0,[0,4,5,0,1,0,0,0,0,0,0xffffffff,0]);
function clear(color){const b=packet(7,0,[4,...color.map(word),0,0,0]);new DataView(b.buffer).setFloat64(24,1,true);return b;}
const meta=(id,target,format,bind,width,height=1)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
function rig(gl,bridge,c,{asynchronous=false,delay=0,hostLimit=null,pad=false}={}){
  const allocations=new Map(),calls=[],live=new Map(['Texture','Buffer','Shader','Program','Sampler','VertexArray','Framebuffer','Sync'].map(k=>[k,new Set()]));
  const control={remaining:0,failVariant:false},methods=new Map();let waits=0,fences=0;
  const traced=new Proxy(gl,{get(t,k){if(typeof t[k]!=='function')return Reflect.get(t,k,t);if(methods.has(k))return methods.get(k);const f=(...args)=>{
    if(control.reflection==='location'&&k==='getUniformLocation'&&args[1]==='wv_rgb_blend_factor')return null;
    if(control.reflection==='index'&&k==='getUniformIndices'&&args[1][0]==='wv_rgb_blend_factor')return [gl.INVALID_INDEX];
    if(['type','size'].includes(control.reflection)&&k==='getActiveUniforms'&&args[1][0]===t.getUniformIndices(args[0],['wv_rgb_blend_factor'])[0]&&args[2]===(control.reflection==='type'?gl.UNIFORM_TYPE:gl.UNIFORM_SIZE))return [control.reflection==='type'?gl.FLOAT:2];
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
  packet(14,0,[.953125,.03125,.8125,.171875].map(word)),packet(14,0,test.color.map(word)),packet(12,0,[1,0,...(test.sourceBank??test.source).map(word)]),clear(test.destination.map(v=>v/255)),draw());
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
  c.same(r.calls.at(-1).sourceWords,test.discarded?[]:(test.sourceBank??test.source).map(word),test.name+' actual owned source bank');
  c.same(r.calls.at(-1).fold!==null,mixed&&!test.discarded,test.name+' actual fold reflection');
  if(mixed&&!test.discarded){const color=test.color.map(v=>Math.max(0,Math.min(1,v)));let f=[8,24].includes(t.rgbSourceFactor)?Array(3).fill(color[3]):color.slice(0,3);if([23,24].includes(t.rgbSourceFactor))f=f.map(v=>1-v);
    c.same(r.calls.at(-1).fold,[...f,1],test.name+' owned folded factor');}
  bytes.push(raw);
}
function poison(gl){gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT,gl.FUNC_SUBTRACT);gl.blendFuncSeparate(gl.ZERO,gl.ONE,gl.ZERO,gl.ONE);gl.blendColor(1,0,1,0);gl.colorMask(false,false,false,false);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.useProgram(null);gl.bindVertexArray(null);}
function dispose(r,c,label){r.gl.deleteFramebuffer(r.reader);c.ok(r.renderer.dispose(),label+' renderer disposal');c.ok(r.store.dispose(),label+' resource disposal');for(const owner of [r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),label+' final accounting').budgets))c.same(v,0,label+' budget '+k);for(const[k,v]of r.live)c.same(v.size,0,label+' native deletion '+k);c.same(r.gl.getError(),r.gl.NO_ERROR,label+' final GL error');}

export async function runBrowserBlendBoundaries(){const c=checks(),wire=runBlendWireAcceptance(),evidence={frames:[],jobs:[]};window.__blendEvidence=evidence;
  const canvas=document.querySelector('#gpu'),gl=canvas.getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});c.same(Boolean(gl),true,'actual WebGL2');
  const debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)};
  c.same(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(gpu.renderer),false,'physical hardware renderer');
  // This is the WebGL API prohibition the physical fragment fallback must avoid.
  for(const sf of [gl.CONSTANT_COLOR,gl.ONE_MINUS_CONSTANT_COLOR,gl.CONSTANT_ALPHA,gl.ONE_MINUS_CONSTANT_ALPHA])
    for(const df of ([gl.CONSTANT_COLOR,gl.ONE_MINUS_CONSTANT_COLOR].includes(sf)?[gl.CONSTANT_ALPHA,gl.ONE_MINUS_CONSTANT_ALPHA]:[gl.CONSTANT_COLOR,gl.ONE_MINUS_CONSTANT_COLOR])){
      gl.blendFuncSeparate(gl.ONE,gl.ZERO,gl.ONE,gl.ZERO);gl.blendFuncSeparate(sf,df,gl.ONE,gl.ZERO);
      c.same(gl.getError(),gl.INVALID_OPERATION,'native WebGL rejects mixed constants '+sf+'/'+df);
      c.same([gl.getParameter(gl.BLEND_SRC_RGB),gl.getParameter(gl.BLEND_DST_RGB)],[gl.ONE,gl.ZERO],'native rejection preserves earlier valid state');
    }
  const bridge=await createVirglShaderBridge(),raw=[],fault=BLEND_CASES[0];
  // Fresh critic cases: no redundant color/bank/state updates during owner restoration.
  const o=rig(gl,bridge,c),ownerTests=new Map(),ownedHex=new Map();
  for(const ctx of [1,2])nativeRun(o,c,ctx,setup(),'critic owner setup '+ctx);
  for(const ctx of [1,2]){
    const test={name:'critic-owner-init-'+ctx,target:target(ctx===1?23:8,ctx===1?24:7,6,ctx===1?3:20,ctx===1?0:2,ctx===1?1:0,ctx===1?13:10),source:ctx===1?[.328125,.609375,.921875,.1875]:[.828125,.140625,.453125,.90625],color:ctx===1?[.171875,.734375,.390625,.5625]:[.875,.28125,.640625,.109375],destination:ctx===1?[89,149,47,37]:[213,51,177,219],format:67};
    const bytes=commands(test,77);nativeRun(o,c,ctx,bytes,test.name);verifyFrame(o,c,test,evidence,raw,bytes);ownerTests.set(ctx,test);ownedHex.set(ctx,hex(bytes));
  }
  for(const ctx of [1,2,1,2,1]){
    const test={...ownerTests.get(ctx),name:'critic-owner-restore-'+ctx,preparedPacketHex:ownedHex.get(ctx),stateOnly:true};poison(gl);
    const bytes=join(clear(test.destination.map(v=>v/255)),draw());nativeRun(o,c,ctx,bytes,test.name);verifyFrame(o,c,test,evidence,raw,bytes);
  }
  {const old=ownerTests.get(1),updated={...old,name:'critic-last-color-update',color:[.953125,.0625,.515625,.296875],stateOnly:true};
    const prepare=join(commands(old,79),packet(14,0,updated.color.map(word)));updated.preparedPacketHex=hex(prepare);poison(gl);
    const bytes=join(packet(14,0,[.75,.5,.25,.125].map(word)),packet(14,0,updated.color.map(word)),clear(updated.destination.map(v=>v/255)),draw());nativeRun(o,c,1,bytes,updated.name);verifyFrame(o,c,updated,evidence,raw,bytes);ownerTests.set(1,updated);ownedHex.set(1,updated.preparedPacketHex);
    // A new public object with the same ID cannot replace the retained destroyed binding.
    const other={...updated,name:'critic-reused-ID-bind',target:target(7,24,8,23,1,2,11)};
    const retained={...updated,name:'critic-reused-ID-unbound'};
    const pending=join(blend(77,other.target),clear(retained.destination.map(v=>v/255)),draw());nativeRun(o,c,1,pending,retained.name);verifyFrame(o,c,retained,evidence,raw,pending);
    other.preparedPacketHex=hex(join(blend(77,other.target),packet(14,0,other.color.map(word)),packet(12,0,[1,0,...other.source.map(word)]),clear(other.destination.map(v=>v/255)),draw()));other.stateOnly=true;
    const selected=join(packet(2,1,[77]),packet(3,1,[77]),clear(other.destination.map(v=>v/255)),draw());nativeRun(o,c,1,selected,other.name);verifyFrame(o,c,other,evidence,raw,selected);
  }
  // Distinct subcontext values survive only SET_SUB_CTX plus clear/draw.
  nativeRun(o,c,1,join(packet(29,0,[42]),packet(28,0,[42]),setup()),'critic subcontext setup');
  const subTest={name:'critic-subcontext-init',target:target(24,23,23,8,2,0,14),source:[.515625,.78125,.203125,.671875],color:[.046875,.90625,.359375,.8125],destination:[23,171,103,185],format:67};
  const subBytes=commands(subTest,77);nativeRun(o,c,1,subBytes,subTest.name);verifyFrame(o,c,subTest,evidence,raw,subBytes);
  for(const sub of [0,42,0,42]){
    const test={...(sub===42?subTest:{...ownerTests.get(1),target:target(7,24,8,23,1,2,11)}),name:'critic-subcontext-restore-'+sub,stateOnly:true,
      preparedPacketHex:sub===42?hex(subBytes):hex(join(blend(77,target(7,24,8,23,1,2,11)),packet(14,0,ownerTests.get(1).color.map(word)),packet(12,0,[1,0,...ownerTests.get(1).source.map(word)]),clear(ownerTests.get(1).destination.map(v=>v/255)),draw()))};
    const bytes=join(packet(28,0,[sub]),clear(test.destination.map(v=>v/255)),draw());poison(gl);nativeRun(o,c,1,bytes,test.name);verifyFrame(o,c,test,evidence,raw,bytes);
  }
  c.same(o.renderer.inspect().caches.program.evictions>0,true,'critic owner/subcontext evictions');dispose(o,c,'critic owners');
  // Real linked variant reflection fault paths; normal GPU/bank recovery is mandatory.
  for(const reflection of ['location','index','type','size']){
    const a=rig(gl,bridge,c);nativeRun(a,c,1,setup(),'critic reflection setup '+reflection);a.control.reflection=reflection;const before=a.calls.length;
    const failure=c.bad(a.renderer.executeSubmission(1,commands(fault)),'critic reflection '+reflection,'shader-reflection-error');c.same(a.calls.length,before,'critic reflection no draw '+reflection);a.control.reflection=null;
    const test={...fault,name:'critic-reflection-recovery-'+reflection};const bytes=join(packet(2,1,[0]),packet(3,1,[70]),commands(test,71));nativeRun(a,c,1,bytes,test.name);verifyFrame(a,c,test,evidence,raw,bytes);evidence.guards??=[];evidence.guards.push({reflection,failure,budgets:a.renderer.inspect().budgets});dispose(a,c,'critic reflection '+reflection);
  }
  // Bounded physical composition attack: sampled view wrapper followed by mixed blend wrapper.
  const tex=rig(gl,bridge,c),TEXTURE='FRAG\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nDCL CONST[0]\nDCL OUT[0], COLOR\n0: TEX OUT[0], CONST[0], SAMP[0], 2D\n1: END\n';
  nativeRun(tex,c,1,setup(TEXTURE),'critic composition setup');c.ok(tex.store.createResource(meta(10,2,67,8,1,1)),'critic owned source texel');c.ok(tex.store.attachContext(1,10),'critic source texture attachment');
  c.ok(tex.store.attachBacking(10,[Uint8Array.from([0,0,255,255])]),'critic source texel backing');
  nativeRun(tex,c,1,packet(43,0,[10,0,0,0,0,0,0,0,1,1,1,0,1]),'critic source texture transfer');
  const baseTex=[0,0,1,1],bank=[.5,.5,0,0],sampler=packet(1,7,[92,2|(2<<3)|(2<<6)|(2<<11),0,0,0x447a0000,0,0,0,0]);nativeRun(tex,c,1,sampler,'critic sampled nearest sampler');
  for(const [i,swizzle]of [[2,1,0,3],[0,3,2,1],[2,1,0,3]].entries()){
    const view=packet(1,6,[100+i,10,0x02000043,0,0,swizzle.reduce((n,v,l)=>n|(v<<(3*l)),0)]),test={name:'critic-view-fold-'+i,target:target(i%2?24:7,i%2?23:8,6,20,i%3,(i+2)%5,i%2?13:15),source:swizzle.map(l=>baseTex[l]),sourceBank:bank,color:C,destination:D,format:67,textureBytes:[0,0,255,255],viewSwizzle:swizzle};
    const bytes=join(view,packet(10,0,[1,0,100+i]),packet(18,0,[1,0,92]),commands(test,77));poison(gl);nativeRun(tex,c,1,bytes,test.name);verifyFrame(tex,c,test,evidence,raw,bytes);
    const program=tex.lastDump.programs.find(p=>p.generation===tex.lastDump.draws[0].programGeneration);c.same(program.fragmentESSL300.includes('wv_view_0('),true,'critic composition actual sampled view wrapper');c.same(program.fragmentESSL300.includes('wv_unblended_main'),true,'critic composition actual blend wrapper');c.same(program.key.includes('sampler-view-v1'),true,'critic composition view key');
  }
  dispose(tex,c,'critic sampled view/fold composition');

  const all=join(...raw),binary=[];for(let at=0;at<all.length;at+=16384)binary.push(String.fromCharCode(...all.subarray(at,at+16384)));
  for(const frame of evidence.frames)delete frame.pixels;
  return{status:'passed',guestExecution:false,productionNegotiation:false,gpu,wire,assertions:c.rows,records:evidence.frames,jobs:evidence.jobs,guards:evidence.guards,
    rawPixelsBase64:btoa(binary.join('')),rawBytes:all.length,quantizationBudget:1,frames:evidence.frames.length};
}

// node renderer/virgl-command/tests/blend-boundaries.mjs --output target/evidence/virgl-blend-boundaries
async function runNodeBlendBoundaries(){
  const {default:assert}=await import('node:assert/strict'),{execFileSync}=await import('node:child_process');
  const {default:fs}=await import('node:fs/promises'),{createServer}=await import('node:http');
  const {default:os}=await import('node:os'),{default:path}=await import('node:path'),{pathToFileURL}=await import('node:url');
  const {repo,sha256}=await import('../../../tools/virgl-command/fixtures.mjs');
const options={};
for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--node-only','--mutation'].includes(process.argv[i]));assert.ok(process.argv[i+1]);options[process.argv[i].slice(2)]=process.argv[i+1];}
assert.ok(options.output);assert.ok(!options.mutation||['equation','factor','fold'].includes(options.mutation));
assert.ok(!options['node-only']||options['node-only']==='true');
const output=path.resolve(options.output);await fs.mkdir(output,{recursive:true});
const sourcePaths=[
  'renderer/virgl-command/resources.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/cache.mjs',
  'renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/tests/blend-boundaries.mjs',
  'renderer/virgl-shader/index.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
  'renderer/virgl-shader/bridge.c','renderer/virgl-shader/bridge.h','renderer/virgl-shader/raw_bits.h','renderer/virgl-shader/checked_upstream.c','renderer/virgl-shader/UPSTREAM.json',
  'tools/virgl-command/fixtures.mjs','tools/verify-virgl-blend-equations.mjs',
];
const report={schema:1,task:'E6-T11d2',status:'running',guestExecution:false,productionNegotiation:false,
  boundary:'Physical single-target blend prerequisite; production negotiation remains disabled.',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),command:[process.execPath,...process.argv.slice(1)],
  host:{platform:process.platform,arch:process.arch,release:os.release(),node:process.version},
  startedAt:new Date().toISOString(),sources:[],servedFiles:[],browserErrors:{console:[],page:[],requests:[]}};
const served=new Map();let browser,page,server;
try{
  const sources=new Map();
  for(const file of sourcePaths){const b=await fs.readFile(path.join(repo,file));sources.set(file,b);report.sources.push({path:file,bytes:b.length,sha256:sha256(b)});}
  report.native=runBlendWireAcceptance();
  if(!options['node-only']){
    if(options.mutation){
      const file='renderer/virgl-command/state.mjs',before=sources.get(file).toString();
      const changes={
        equation:['"FUNC_ADD", "FUNC_SUBTRACT", "FUNC_REVERSE_SUBTRACT"','"FUNC_ADD", "FUNC_REVERSE_SUBTRACT", "FUNC_SUBTRACT"'],
        factor:['4: "DST_ALPHA"','4: "ONE_MINUS_DST_ALPHA"'],
        fold:['gl.uniform4fv(program.blendUniform, new Float32Array([...factor, 1]));','gl.uniform4fv(program.blendUniform, new Float32Array([1, 1, 1, 1]));']
      };
      const[needle,replacement]=changes[options.mutation];assert.equal(before.split(needle).length,2,'mutation must touch exactly one boundary');
      const bytes=Buffer.from(before.replace(needle,replacement));sources.set(file,bytes);await fs.writeFile(path.join(output,'mutation-source.mjs'),bytes);
      report.mutation={mode:options.mutation,path:file,originalSha256:sha256(Buffer.from(before)),servedSha256:sha256(bytes),needle,replacement};
    }
    const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Single-target GPU blend equations</title><style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px}pre{white-space:pre-wrap}canvas{width:256px;height:256px;image-rendering:pixelated}</style><h1>Single-target GPU blend equations</h1><p>Five equations · independent RGB/alpha factors · owned constant variants · physical GPU proof</p><p id="status">Checking native blend equations and rational pixel predictions…</p><canvas id="gpu" width="16" height="16"></canvas><pre id="result"></pre>');
    const endpoints=new Map([['/',{bytes:html,type:'text/html'}],
      ...[...sources].filter(([name])=>name.startsWith('renderer/')&&(name.endsWith('.mjs')||name.endsWith('.wasm'))).map(([name,bytes])=>['/'+name,{bytes,type:name.endsWith('.wasm')?'application/wasm':'text/javascript'}])]);
    server=createServer((request,response)=>{const name=new URL(request.url,'http://localhost').pathname;
      if(name==='/favicon.ico'){response.writeHead(204).end();return;}
      const item=endpoints.get(name);if(!item){response.writeHead(404).end('not found');return;}
      served.set(name,{path:name,bytes:item.bytes.length,sha256:sha256(item.bytes)});response.writeHead(200,{'Content-Type':item.type,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(item.bytes);
    });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const{chromium}=await import(pathToFileURL(path.join(repo,'web/node_modules/playwright/index.mjs')));browser=await chromium.launch({executablePath:chrome,headless:false,args:['--enable-gpu']});
    const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');
    assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(s=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(s)));
    report.browser={executable:chrome,sha256:sha256(await fs.readFile(chrome)),version:browser.version(),headless:false,gpu:system.gpu,commandLine:command.arguments};
    const context=await browser.newContext({viewport:{width:1100,height:900},deviceScaleFactor:1});page=await context.newPage();
    page.on('console',m=>{if(m.type()==='error')report.browserErrors.console.push(m.text());});page.on('pageerror',e=>report.browserErrors.page.push(e.message));page.on('requestfailed',r=>report.browserErrors.requests.push({url:r.url(),error:r.failure()?.errorText}));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
    let timer;try{
      report.browserResult=await Promise.race([page.evaluate(async()=>{
        try{const module=await import('/renderer/virgl-command/tests/blend-boundaries.mjs'),result=await module.runBrowserBlendBoundaries();
          document.querySelector('#status').textContent='Passed: blend equations, rational pixels, owned variants and actual fences';
          document.querySelector('#result').textContent=JSON.stringify({status:result.status,gpu:result.gpu,frames:result.records.length,jobs:result.jobs,assertions:result.assertions.length},null,2);
          return{status:'passed',result};
        }catch(error){document.querySelector('#status').textContent='Failed: '+error.message;return{status:'failed',error:{message:error.message,stack:error.stack}};}
      }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('blend hardware proof exceeded240 seconds')),240000);})]);
    }finally{clearTimeout(timer);}
    if(report.browserResult.status==='passed'){
      const result=report.browserResult.result,pixels=Buffer.from(result.rawPixelsBase64,'base64');delete result.rawPixelsBase64;
      assert.equal(pixels.length,result.rawBytes);result.rawSha256=sha256(pixels);await fs.writeFile(path.join(output,'blend-pixels.bin'),pixels);
      report.physicalPixels={path:'blend-pixels.bin',bytes:pixels.length,sha256:sha256(pixels),format:'ordered16x16 RGBA8 or little-endian RGB10_A2, per-record format'};
    }
    if(report.browserResult.status==='failed'){
      const partial=await page.evaluate(()=>window.__blendEvidence??null);if(partial){
        const pixels=Buffer.concat(partial.frames.map(frame=>Buffer.from(frame.pixels)));for(const frame of partial.frames)delete frame.pixels;
        await fs.writeFile(path.join(output,'fault-pixels.bin'),pixels);report.partial=partial;
        report.faultPixels={path:'fault-pixels.bin',bytes:pixels.length,sha256:sha256(pixels)};
      }
    }
    const coverage=await cdp.send('Profiler.takePreciseCoverage');const scripts=['resources.mjs','decoder.mjs','state.mjs','cache.mjs','constant-domain.mjs'].map(name=>{
      const source='renderer/virgl-command/'+name,matches=coverage.result.filter(s=>s.url.endsWith('/'+source));assert.equal(matches.length,1,'coverage must name served runtime '+source);return{source,sha256:sha256(sources.get(source)),coverage:matches[0]};
    });await fs.writeFile(path.join(output,'browser-coverage.json'),JSON.stringify({schema:1,scripts},null,2)+'\n');report.browserCoverage={path:'browser-coverage.json',sha256:sha256(await fs.readFile(path.join(output,'browser-coverage.json')))};
    await cdp.send('Profiler.stopPreciseCoverage');await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshot={path:'browser.png',sha256:sha256(await fs.readFile(path.join(output,'browser.png')))};
    assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);
  }
  for(const s of report.sources)assert.equal(sha256(await fs.readFile(path.join(repo,s.path))),s.sha256,'source drift '+s.path);
  report.status='passed';console.log('Single-target blend acceptance passed'+(options['node-only']?' (wire)':' (hardware WebGL2)'));
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
finally{report.servedFiles=[...served.values()];report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));}

}
if(typeof process==='object'&&process.versions?.node){const {fileURLToPath}=await import('node:url');if(process.argv[1]===fileURLToPath(import.meta.url))await runNodeBlendBoundaries();}
