// Fresh critic promotion: varying-W interpolation, partial lanes, owned generations,
// actual index maxima, both fetch bounds, and independent seeded wire arithmetic.
import {decodeSubmission} from '../decoder.mjs';
import {createResourceStore, createWebGL2TransferBackend} from '../resources.mjs';
import {createVirglDrawRenderer, createVirglAsyncRenderer} from '../state.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';

const WIDTHS = {28:4,29:8,30:12,31:16};
const SEEDS = [0x6d2b79f5,0xa5a5c3c3,0x9e3779b9];
const VS='VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: END\n';
const FS='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
const WFS='FRAG\nPROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0].wwww\n1: END\n';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const rng=seed=>()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
const packet=(op,kind,words)=>{const b=new Uint8Array(4+4*words.length),v=new DataView(b.buffer);v.setUint32(0,op|(kind<<8)|(words.length<<16),true);words.forEach((w,i)=>v.setUint32(4+4*i,w,true));return b;};
const join=(...parts)=>{const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let at=0;for(const b of parts){out.set(b,at);at+=b.length;}return out;};
const word=f=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,f,true);return v.getUint32(0,true);};
const shader=(id,stage,text)=>{const b=packet(1,4,[id,stage,text.length+1,64,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);b.set(new TextEncoder().encode(text),24);return b;};
function checks(){const rows=[];const same=(observed,expected,prediction)=>{const held=JSON.stringify(observed)===JSON.stringify(expected);rows.push({prediction,expected,observed,held});if(!held)throw new Error(prediction+': expected '+JSON.stringify(expected)+', observed '+JSON.stringify(observed));};
  const ok=(r,label)=>{same(r?.ok,true,label+' '+(r?.error?.message??''));return r;};return{rows,same,ok};}

export function runFloatVertexBoundaryWire(){const c=checks();
  for(const seed of SEEDS){const random=rng(seed);
    for(const fmt of [28,29,30,31]){
      const width=WIDTHS[fmt],last=Number((0xffffffffn-BigInt(width))/4n*4n);
      const offsets=[0,4,last,last+4,0xffffffff,...[0,4,last].flatMap(x=>[x+1,x+2,x+3]),...Array.from({length:96},()=>random())];
      for(const offset of offsets){const expected=offset%4===0&&BigInt(offset)+BigInt(width)<=0xffffffffn;
        const bytes=packet(1,5,[99,offset,0,15,fmt]),out=decodeSubmission(bytes);c.same(out.ok,expected,'critic u32 width seed'+seed+' fmt'+fmt+' offset'+offset);
        if(!expected)c.same([out.error.code,out.error.opcode,out.error.byteOffset],['invalid-value',1,0],'critic rejected offset provenance');}
      for(const divisor of [1,random()||1])c.same(decodeSubmission(packet(1,5,[99,0,divisor,0,fmt])).error.code,'unsupported-feature','critic instance gate');
      for(const slot of [16,random()|0x80000000])c.same(decodeSubmission(packet(1,5,[99,0,0,slot,fmt])).error.code,'limit-exceeded','critic slot gate');
    }
    for(let format=0;format<256;format++)c.same(decodeSubmission(packet(1,5,[99,0,0,0,format])).ok,Object.hasOwn(WIDTHS,format),'critic admitted format '+format);
  }
  return{status:'passed',seeds:SEEDS,assertions:c.rows};
}

// Exact rational screen barycentrics. Never use renderer tables, dumps or native
// pointer sizes to manufacture expected pixels.
const q=(n,d=1)=>[BigInt(n),BigInt(d)],qadd=(a,b)=>[a[0]*b[1]+b[0]*a[1],a[1]*b[1]],mul=(a,b)=>[a[0]*b[0],a[1]*b[1]],div=(a,b)=>[a[0]*b[1],a[1]*b[0]];
const quant=a=>{if(a[0]<=0n)return 0;if(a[0]>=a[1])return 255;return Number((a[0]*510n+a[1])/(2n*a[1]));};
export function predictedPixel(t,x,y,coordinates=false){
  if(x<2||x>13||y<2||y>13)return[0,0,0,0];
  const ux=2*x-3,vy=2*y-3,triangle=ux+vy<=24?[[0,24-ux-vy],[1,vy],[2,ux]]:[[2,24-vy],[1,24-ux],[3,ux+vy-24]];
  const reciprocal=triangle.reduce((sum,[i,n])=>qadd(sum,q(n,24*t.w[i])),q(0));
  if(coordinates)return Array(4).fill(quant(reciprocal));
  return Array.from({length:4},(_,lane)=>{const numerator=triangle.reduce((sum,[i,n])=>{
    const value=lane<WIDTHS[t.format]/4?q(Math.round(t.colors[i][lane]*32),32):q(lane===3?1:0);
    return qadd(sum,mul(q(n,24*t.w[i]),value));},q(0));return quant(div(numerator,reciprocal));});
}
function plan(seed,format,ordinal){const random=rng(seed^format),colors=Array.from({length:4},()=>Array.from({length:4},()=>((random()%27)+2)/32));
  return{seed,format,colors,w:[1,2,4,8],start:1+(random()%2),indexed:ordinal%2===1,positionStride:[20,28,36][ordinal%3],
    colorStride:ordinal===2?252:WIDTHS[format]+4*(1+random()%3),positionOffset:4*(1+random()%2),positionSourceOffset:4*(random()%3),colorOffset:4*(1+random()%2),sourceOffset:4*(random()%3),delay:[0,2,5][ordinal]};}
function geometry(t){const maximum=t.start+3,pos=t.positionOffset+t.positionSourceOffset,col=t.colorOffset+t.sourceOffset;
  const position=new Uint8Array(pos+maximum*t.positionStride+16),color=new Uint8Array(col+maximum*t.colorStride+WIDTHS[t.format]);
  for(const bytes of [position,color]){const v=new DataView(bytes.buffer);for(let at=0;at+4<=bytes.length;at+=4)v.setFloat32(at,.9375,true);}
  const pv=new DataView(position.buffer),cv=new DataView(color.buffer),points=[[-.75,-.75],[-.75,.75],[.75,-.75],[.75,.75]];
  for(let i=0;i<4;i++){[points[i][0]*t.w[i],points[i][1]*t.w[i],0,t.w[i]].forEach((f,l)=>pv.setFloat32(pos+(t.start+i)*t.positionStride+l*4,f,true));
    for(let l=0;l<WIDTHS[t.format]/4;l++)cv.setFloat32(col+(t.start+i)*t.colorStride+l*4,t.colors[i][l],true);}
  const index=new Uint8Array(10),iv=new DataView(index.buffer);[0xbeef,t.start,t.start+1,t.start+2,t.start+3].forEach((n,i)=>iv.setUint16(i*2,n,true));return{position,color,index};}
const meta=(id,target,format,bind,width,height=1)=>({id,target,format,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0});
const transfer=(id,width)=>packet(43,0,[id,0,0,0,0,0,0,0,width,1,1,0,1]);
const elements=(t,id=5,offset=t.sourceOffset,format=t.format)=>packet(1,5,[id,t.positionSourceOffset,0,0,31,offset,0,1,format,0,0,15,31]);
const buffers=(t,id=4)=>packet(6,0,[t.positionStride,t.positionOffset,3,t.colorStride,t.colorOffset,id]);
const draw=t=>packet(8,0,[t.indexed?0:t.start,4,5,Number(t.indexed),1,0,0,0,0,0,0,0]);
const clear=()=>{const b=packet(7,0,[4,0,0,0,0,0,0,0]);new DataView(b.buffer).setFloat64(24,1,true);return b;};
const setup=(t,colorId=4)=>join(shader(1,0,VS),shader(2,1,FS),shader(3,1,WFS),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),
  elements(t),packet(2,5,[5]),buffers(t,colorId),packet(11,0,[5,2,2]),packet(1,2,[6,2|(1<<29),word(1),0,65535,word(1),0,0,0]),packet(2,2,[6]),
  packet(4,0,[0,...[8,8,.5,8,8,.5].map(word)]),packet(31,0,[1,0]),packet(31,0,[2,1]));
function rig(gl,bridge,c,t){const allocations=[],calls=[],history=[],methods=new Map();let remaining=0,waits=0,fences=0;
  const snapshot=buffer=>{const a=allocations.find(x=>x.native.buffer===buffer);if(!a)return null;const old=gl.getParameter(gl.COPY_READ_BUFFER_BINDING),data=new Uint8Array(a.metadata.width);gl.bindBuffer(gl.COPY_READ_BUFFER,buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,data);gl.bindBuffer(gl.COPY_READ_BUFFER,old);return{resourceId:a.metadata.id,generation:a.generation,byteLength:data.length,bufferHex:hex(data)};};
  const traced=new Proxy(gl,{get(target,name){if(typeof target[name]!=='function')return Reflect.get(target,name,target);if(methods.has(name))return methods.get(name);const method=(...args)=>{
    if(name==='clientWaitSync'){waits++;if(remaining>0){remaining--;return gl.TIMEOUT_EXPIRED;}}
    if(name==='drawArrays'||name==='drawElements'){const p=gl.getParameter(gl.CURRENT_PROGRAM),attributes=[];for(let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_ATTRIBUTES);i++){
      const a=gl.getActiveAttrib(p,i),location=gl.getAttribLocation(p,a.name);attributes.push({name:a.name,location,components:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_SIZE),stride:gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_STRIDE),offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),...snapshot(gl.getVertexAttrib(location,gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING))});}
      calls.push({op:name,args:[...args],attributes,index:snapshot(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING))});}
    const out=target[name].apply(target,args);if(name==='fenceSync'){fences++;remaining=t.delay;}return out;};methods.set(name,method);return method;}});
  const backend=c.ok(createWebGL2TransferBackend(traced),'critic backend').backend;
  const owned=c.ok(createResourceStore({backend:{...backend,allocate(metadata){const native=backend.allocate(metadata);allocations.push({metadata,native});return native;}}}),'critic store');
  const asynchronous=t.delay!==0,renderer=c.ok((asynchronous?createVirglAsyncRenderer:createVirglDrawRenderer)({gl:traced,shaderBridge:bridge,resources:owned.store,bindings:owned.bindings,limits:{programs:2},cacheLimits:{states:2,translations:3},...(asynchronous?{asyncAccess:owned.asyncAccess,jobLimits:{commandsPerStep:1}}:{})}),'critic renderer').renderer;
  for(const ctx of [1,2]){c.ok(owned.store.createContext(ctx),'critic owned context');c.ok(renderer.createContext(ctx),'critic render context');}
  return{...owned,gl,renderer,allocations,calls,history,asynchronous,reader:gl.createFramebuffer(),frame:0,waits:()=>waits,fences:()=>fences};}
function add(r,c,m,data){const resource=c.ok(r.store.createResource(m),'critic resource '+m.id).resource;r.allocations.at(-1).generation=resource.generation;for(const ctx of [1,2])c.ok(r.store.attachContext(ctx,m.id),'critic attach');if(data)c.ok(r.store.attachBacking(m.id,[data]),'critic backing');return resource;}
async function run(r,c,ctx,bytes,label){const saved=bytes.slice();c.ok(r.renderer.beginFrame(++r.frame),'critic frame start');let result,polls=0;
  if(!r.asynchronous)result=r.renderer.executeSubmission(ctx,bytes);else{const begun=r.renderer.beginSubmission(ctx,bytes);if(!begun.ok)result=begun;else{const job=begun.job;bytes.fill(0xff);
    for(;polls<5000;polls++){const step=c.ok(r.renderer.step(job),'critic step');if(step.status==='done'){result=step.result;break;}if(step.status==='needs-input'){
      const l=step.request.layout,rows=[];for(let i=0;i<l.rowCount;i++)rows.push(c.ok(r.store.readBacking(step.request.resource.id,l.offset+i*l.rowStride,l.rowBytes),'critic supplied owned bytes').bytes);c.ok(r.renderer.provideInput(job,step.request.token,join(...rows)),'critic input');}
      await new Promise(resolve=>setTimeout(resolve,polls%3));}}c.same(Boolean(result),true,'critic bounded async');}
  const dump=c.ok(r.renderer.endFrame(r.frame),'critic frame end').dump;r.history.push({contextId:ctx,packetHex:hex(saved),result});return{result,dump,packetHex:hex(saved),contextId:ctx,polls,label};}
function read(r){const gl=r.gl,texture=r.allocations.find(a=>a.metadata.id===1).native.texture;gl.bindFramebuffer(gl.READ_FRAMEBUFFER,r.reader);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);for(const p of [gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS])gl.pixelStorei(p,0);const raw=new Uint8Array(1024);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,raw);return raw;}
const poison=gl=>{gl.useProgram(null);gl.bindVertexArray(null);gl.colorMask(false,false,false,false);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);};
function frame(r,c,t,run,evidence,coordinates=false){c.ok(run.result,'critic draw result');const pixels=read(r),mismatches=[];for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const expected=predictedPixel(t,x,y,coordinates),observed=[...pixels.slice((y*16+x)*4,(y*16+x)*4+4)];if(expected.some((n,i)=>Math.abs(n-observed[i])>1))mismatches.push({pixel:[x,y],expected,observed});}
  const record={...t,name:run.label,coordinates,contextId:run.contextId,packetHex:run.packetHex,history:r.history.map(x=>({...x})),native:r.calls.at(-1),dump:run.dump,pixels:[...pixels],mismatches:mismatches.slice(0,3)};evidence.frames.push(record);
  c.same(r.gl.getError(),r.gl.NO_ERROR,run.label+' critic native pixels without GL error');
  c.same(mismatches.slice(0,3),[],run.label+' critic varying-W physical pixels');
  const command=run.result.draws.at(-1);c.same([command.actualMinIndex,command.actualMaxIndex],[t.start,t.start+3],run.label+' dishonest hints ignored');
  for(const a of record.native.attributes){const position=a.name==='in_0',width=position?16:WIDTHS[t.format],stride=position?t.positionStride:t.colorStride,offset=position?t.positionOffset+t.positionSourceOffset:t.colorOffset+t.sourceOffset;
    c.same([a.components,a.stride,a.offset],[width/4,stride,offset],run.label+' critic native pointer');const f=command.vertexFetches.find(x=>x.attributeIndex===(position?0:1));c.same([f.components,f.firstByte,f.requiredEnd],[width/4,offset+t.start*stride,offset+(t.start+3)*stride+width],run.label+' critic actual extent');}
  c.same(r.gl.getError(),r.gl.NO_ERROR,run.label+' critic GL error');}
async function reject(r,c,bytes,code,label,evidence){const before=r.calls.length,out=await run(r,c,1,bytes,label);c.same([out.result.ok,out.result.error?.code],[false,code],label+' exact rejection');c.same(r.calls.length,before,label+' no draw');c.same(out.dump.draws,[],label+' capture has no draw');c.same(r.gl.getError(),r.gl.NO_ERROR,label+' no native error');evidence.rejections.push(out);}

export async function runBrowserFloatVertexBoundaries(){const c=checks(),evidence={frames:[],rejections:[],jobs:[]};window.__criticFloatEvidence=evidence;
  const gl=document.querySelector('#gpu').getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});c.same(Boolean(gl),true,'critic real GL');
  const ext=gl.getExtension('WEBGL_debug_renderer_info'),gpu={vendor:gl.getParameter(ext?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)};c.same(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(gpu.renderer),false,'critic hardware');
  const bridge=await createVirglShaderBridge();
  for(let ordinal=0;ordinal<SEEDS.length;ordinal++)for(const format of [28,29,30,31]){const t=plan(SEEDS[ordinal],format,ordinal),g=geometry(t),r=rig(gl,bridge,c,t),name='seed'+t.seed+'-format'+format;
    for(const[m,data]of [[meta(1,2,67,2,16,16),null],[meta(3,0,64,16,g.position.length),g.position],[meta(4,0,64,16,g.color.length),g.color],[meta(5,0,64,32,g.index.length),g.index]])add(r,c,m,data);
    c.ok((await run(r,c,1,join(setup(t),transfer(3,g.position.length),transfer(4,g.color.length),transfer(5,g.index.length)),name+' setup')).result,'critic initial setup');
    poison(gl);frame(r,c,t,await run(r,c,1,join(clear(),draw(t)),name+' perspective'),evidence);
    frame(r,c,t,await run(r,c,1,join(packet(31,0,[3,1]),clear(),draw(t)),name+' coordinate'),evidence,true);
    const other={...t,colors:t.colors.map(row=>row.map(v=>1-v))},otherBytes=geometry(other).color;add(r,c,meta(9,0,64,16,otherBytes.length),otherBytes);
    c.ok((await run(r,c,2,join(setup(other,9),transfer(9,otherBytes.length)),name+' other setup')).result,'critic other context');
    poison(gl);frame(r,c,other,await run(r,c,2,join(clear(),draw(t)),name+' ownerB'),evidence);
    poison(gl);frame(r,c,t,await run(r,c,1,join(packet(31,0,[2,1]),clear(),draw(t)),name+' ownerA restored'),evidence);
    const oldGeneration=r.calls.at(-1).attributes.find(a=>a.name==='in_1').generation;c.ok(r.store.unref(4),'critic unref old public color');add(r,c,meta(4,0,64,16,otherBytes.length),otherBytes);
    c.ok((await run(r,c,1,transfer(4,otherBytes.length),name+' new public transfer')).result,'critic replacement upload');
    frame(r,c,t,await run(r,c,1,join(clear(),draw(t)),name+' retained old generation'),evidence);c.same(r.calls.at(-1).attributes.find(a=>a.name==='in_1').generation,oldGeneration,'critic retains old generation');
    frame(r,c,other,await run(r,c,1,join(buffers(t),clear(),draw(t)),name+' new generation rebind'),evidence);c.same(r.calls.at(-1).attributes.find(a=>a.name==='in_1').generation===oldGeneration,false,'critic distinct rebound generation');
    const updated={...t,colors:t.colors.map(row=>row.map(v=>(Math.round(v*32)%15+1)/32))},updatedBytes=geometry(updated).color;c.ok(r.store.writeBacking(4,0,updatedBytes),'critic current generation write');
    frame(r,c,updated,await run(r,c,1,join(transfer(4,updatedBytes.length),clear(),draw(t)),name+' current transfer'),evidence);
    const firstEnd=t.colorOffset+t.sourceOffset+WIDTHS[format];add(r,c,meta(20,0,64,16,firstEnd-1));await reject(r,c,buffers(t,20),'out-of-bounds',name+' first width short',evidence);
    add(r,c,meta(21,0,64,16,updatedBytes.length-1));await reject(r,c,join(buffers(t,21),draw(t)),'out-of-bounds',name+' actual last width short',evidence);
    frame(r,c,updated,await run(r,c,1,join(buffers(t),clear(),draw(t)),name+' exact end recovery'),evidence);
    const last=Number((0xffffffffn-BigInt(WIDTHS[format]))/4n*4n);c.ok((await run(r,c,1,elements(t,100,last),name+' valid maximum wire offset')).result,'critic maximum source creates');await reject(r,c,packet(2,5,[100]),'out-of-bounds',name+' maximum offset storage bound',evidence);c.ok((await run(r,c,1,packet(3,5,[100]),name+' remove maximum object')).result,'critic maximum cleanup');
    for(const remainder of [1,2,3])await reject(r,c,elements(t,101,remainder),'invalid-value',name+' unaligned source '+remainder,evidence);
    for(const changed of [{...t,colorOffset:1},{...t,colorOffset:2},{...t,colorOffset:3},{...t,colorOffset:0xfffffffc},{...t,colorStride:256}])await reject(r,c,buffers(changed),'out-of-bounds',name+' buffer layout '+JSON.stringify(changed),evidence);
    await reject(r,c,join(buffers({...t,colorStride:0}),draw(t)),'unsupported-draw',name+' zero stride',evidence);c.ok((await run(r,c,1,buffers(t),name+' final restore')).result,'critic restores final buffers');
    evidence.jobs.push({seed:t.seed,format,delay:t.delay,waits:r.waits(),fences:r.fences()});gl.deleteFramebuffer(r.reader);c.ok(r.renderer.dispose(),'critic renderer dispose');c.ok(r.store.dispose(),'critic resources dispose');for(const owner of [r.renderer,r.store])for(const[k,v]of Object.entries(c.ok(owner.inspect(),'critic final counters').budgets))c.same(v,0,'critic final '+k);c.same(gl.getError(),gl.NO_ERROR,'critic final GL');
  }
  return{status:'passed',seeds:SEEDS,gpu,assertions:c.rows,...evidence,guestExecution:false,productionNegotiation:false};}

async function nodeMain(){const {default:assert}=await import('node:assert/strict'),fs=await import('node:fs/promises'),path=await import('node:path'),{fileURLToPath,pathToFileURL}=await import('node:url'),{execFileSync}=await import('node:child_process'),{createServer}=await import('node:http'),{createHash}=await import('node:crypto');
  const root=fileURLToPath(new URL('../../../',import.meta.url)),options={};for(let i=2;i<process.argv.length;i+=2){assert.ok(['--output','--node-only','--mutation'].includes(process.argv[i]));options[process.argv[i].slice(2)]=process.argv[i+1];}assert.ok(options.output);assert.ok(!options.mutation||options.mutation==='rgba');
  const output=path.resolve(options.output);await fs.mkdir(output,{recursive:true});const digest=b=>createHash('sha256').update(b).digest('hex');
  const paths=['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/cache.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/tests/float-vertex-boundaries.mjs','renderer/virgl-shader/index.mjs','renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'];
  const sources=new Map(),report={schema:1,task:'E6-T11d3',gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHead:'2ba17ed3d5373eea3991225c8cd8160920928499',sources:[],servedFiles:[],browserErrors:{console:[],page:[],requests:[]},startedAt:new Date().toISOString(),command:[process.execPath,...process.argv.slice(1)]};let browser,server;
  try{for(const p of paths){const raw=await fs.readFile(path.join(root,p));sources.set(p,raw);report.sources.push({path:p,bytes:raw.length,sha256:digest(raw)});}report.wire=runFloatVertexBoundaryWire();
    if(!options['node-only']){
      if(options.mutation){const p='renderer/virgl-command/state.mjs',before=sources.get(p),needle='gl.vertexAttribPointer(attribute.location, vertexComponents(element),',replacement='gl.vertexAttribPointer(attribute.location, attribute.index === 1 && element.sourceFormat === 31 ? 3 : vertexComponents(element),';assert.equal(before.toString().split(needle).length,2);const changed=Buffer.from(before.toString().replace(needle,replacement));sources.set(p,changed);await fs.writeFile(path.join(output,'mutation-source.mjs'),changed);report.mutation={mode:options.mutation,path:p,originalSha256:digest(before),servedSha256:digest(changed),needle,replacement};}
      const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>Fresh float vertex critic</title><h1>Varying W and partial color lanes</h1><canvas id="gpu" width="16" height="16" style="width:384px;height:384px;image-rendering:pixelated"></canvas><pre id="status">Checking independent rational pixels</pre>'),served=new Map();
      server=createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(p==='/favicon.ico'){res.writeHead(204).end();return;}const raw=p==='/'?html:sources.get(p.slice(1));if(!raw){res.writeHead(404).end();return;}served.set(p,{path:p,bytes:raw.length,sha256:digest(raw)});res.writeHead(200,{'Content-Type':p==='/'?'text/html':p.endsWith('.wasm')?'application/wasm':'text/javascript','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'}).end(raw);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const {chromium}=await import(pathToFileURL(path.join(root,'web/node_modules/playwright/index.mjs')));browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,args:['--enable-gpu']});const session=await browser.newBrowserCDPSession(),system=await session.send('SystemInfo.getInfo'),command=await session.send('Browser.getBrowserCommandLine');assert.equal(system.gpu.featureStatus.webgl2??system.gpu.featureStatus.webgl,'enabled');assert.ok(!command.arguments.some(x=>/swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu/i.test(x)));report.browser={headless:false,version:browser.version(),gpu:system.gpu,commandLine:command.arguments};
      const context=await browser.newContext({viewport:{width:1000,height:850}}),page=await context.newPage();page.on('console',m=>{if(m.type()==='error')report.browserErrors.console.push(m.text());});page.on('pageerror',e=>report.browserErrors.page.push(e.message));page.on('requestfailed',r=>report.browserErrors.requests.push(r.url()));await page.goto('http://127.0.0.1:'+server.address().port+'/');
      const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});report.browserResult=await page.evaluate(async()=>{try{const m=await import('/renderer/virgl-command/tests/float-vertex-boundaries.mjs'),result=await m.runBrowserFloatVertexBoundaries();document.querySelector('#status').textContent=JSON.stringify({status:result.status,frames:result.frames.length,rejections:result.rejections.length,jobs:result.jobs},null,2);return{status:'passed',result};}catch(error){document.querySelector('#status').textContent=error.message;return{status:'failed',error:{message:error.message,stack:error.stack}};}});
      if(report.browserResult.status==='failed')report.partial=await page.evaluate(()=>window.__criticFloatEvidence);const result=report.browserResult.result??report.partial;if(result){const pixels=Buffer.concat(result.frames.map(f=>Buffer.from(f.pixels)));for(const f of result.frames)delete f.pixels;await fs.writeFile(path.join(output,'pixels.bin'),pixels);report.pixels={path:'pixels.bin',bytes:pixels.length,sha256:digest(pixels)};}
      const coverage=await cdp.send('Profiler.takePreciseCoverage');await fs.writeFile(path.join(output,'coverage.json'),JSON.stringify(coverage,null,2)+'\n');report.coverageSha256=digest(await fs.readFile(path.join(output,'coverage.json')));await page.screenshot({path:path.join(output,'browser.png'),fullPage:true});report.screenshotSha256=digest(await fs.readFile(path.join(output,'browser.png')));report.servedFiles=[...served.values()];assert.deepEqual(report.browserErrors,{console:[],page:[],requests:[]});assert.equal(report.browserResult.status,'passed',report.browserResult.error?.message);
    }
    for(const item of report.sources)assert.equal(digest(await fs.readFile(path.join(root,item.path))),item.sha256,'critic source drift');report.status='passed';console.log('Fresh float vertex boundary predictions held');
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}finally{report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}}
if(typeof process==='object'&&process.versions?.node){const {fileURLToPath}=await import('node:url');if(process.argv[1]===fileURLToPath(import.meta.url))await nodeMain();}
