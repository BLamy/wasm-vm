// Fresh critic: original seed-driven NPOT inputs, native range/ownership and legacy controls.
import {rig, finish, blob, submit, nativeRead} from './standard-packed-float-consumer-rig.mjs';
import {checks, traceGL} from './standard-instanced-draws.mjs';
import {createResourceStore,createStandardUniformResourceStore,createStandardPackedFloatColorResourceStore, createStandardPackedFloatColorTransferBackend} from '../resources.mjs';
import * as factories from '../state.mjs';
import * as decoders from '../decoder.mjs';
import {createVirglStandardTextureShaderBridge,createVirglStandardShaderBridge,createVirglStandardUniformShaderBridge} from '../../virgl-shader/standard.mjs';
import {createVirglShaderBridge} from '../../virgl-shader/index.mjs';
import {setup, views, draw, outputRead, packet, join, meta, clear, surface, shader, word} from '../../../tools/virgl-command/standard-packed-float-consumer-fixtures.mjs';
export {runWireAcceptance} from './standard-packed-float-consumer.mjs';

export function novelFixtures(seed=0xc01dcafe,precision=false){
 const metadata={id:6,target:2,format:124,bind:10,width:13,height:7,depth:1,arraySize:1,lastLevel:3,nrSamples:0,flags:0},planes=[];
 let random=seed>>>0,offset=3;const next=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;};
 for(let level=0;level<=3;level++){
  const width=Math.max(1,13>>level),height=Math.max(1,7>>level),input=new Uint8Array(width*height*4),view=new DataView(input.buffer);
  for(let i=0;i<width*height;i++){const n=[next(),next(),next(),next(),next(),next()],r=precision?(12+n[0]%5)*64+n[1]%64:15*64+(n[1]%8)*8,g=precision?(12+n[2]%5)*64+n[3]%64:15*64+(n[3]%8)*8,b=precision?(12+n[4]%5)*32+n[5]%32:15*32+(n[5]%8)*4;view.setUint32(i*4,(r|g<<11|b<<22)>>>0,true);}
  const stride=width*4+5;planes.push({level,width,height,stride,offset,input});offset+=(height-1)*stride+width*4+7;
 }
 const backing=new Uint8Array(offset).fill(0xb7);for(const p of planes)for(let y=0;y<p.height;y++)backing.set(p.input.subarray(y*p.width*4,(y+1)*p.width*4),p.offset+y*p.stride);
 const source={metadata,planes,backing},vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n',fragment='FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0]\nDCL SAMP[3]\nDCL SVIEW[3], 2D, FLOAT\nIMM[0] FLT32 {0.375,0.625,0,0.5}\n0: TXL TEMP[0], IMM[0], SAMP[3], 2D\n1: MOV OUT[0], TEMP[0]\n2: END\n';
 const positions=new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,1,1,0,1,-1,-1,0,1,1,1,0,1,-1,1,0,1]).buffer);
 return [[1,3],[0,3]].map(([firstLevel,lastLevel])=>({name:`critic-${seed.toString(16)}-${precision?'arbitrary':'exact'}-range${firstLevel}-${lastLevel}`,source,firstLevel,lastLevel,stage:'fragment',opcode:'TXL',slot:3,width:5,height:3,outputFormat:31,outputLevel:0,swizzle:[2,0,5,4],parameters:{s:2,t:2,r:2,min:1,mip:1,mag:1,minLod:-1000,maxLod:1000},vertex,fragment,positions,clearColor:[.125,.25,.5,.75],inputDomain:precision?'original-arbitrary-fields':'exact-e15-eighths-weighted-v1'}));
}

export function originalSample(f){
 const read=(level,x,y)=>{const p=f.source.planes[f.firstLevel+level],word=new DataView(p.input.buffer,p.input.byteOffset,p.input.byteLength).getUint32((y*p.width+x)*4,true),field=(code,bits)=>{const e=code>>>bits,m=code%(2**bits);return e?(2**bits+m)*2**(e-15-bits):m*2**(-14-bits);};return[field(word&2047,6),field(word>>>11&2047,6),field(word>>>22,5),1];};
 const sample=level=>{const p=f.source.planes[f.firstLevel+level],x=.375*p.width-.5,y=.625*p.height-.5,i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j,clamp=(v,n)=>Math.max(0,Math.min(n-1,v)),colors=[[0,0],[1,0],[0,1],[1,1]].map(([dx,dy])=>read(level,clamp(i+dx,p.width),clamp(j+dy,p.height))),weights=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b];return[0,1,2,3].map(k=>colors.reduce((sum,color,index)=>sum+color[k]*weights[index],0));};
 const A=sample(0),B=sample(1),color=A.map((n,k)=>(n+B[k])*.5);return f.swizzle.map(k=>k===4?0:k===5?1:color[k]);
}

async function directNative(gl,texture,sampler,width,height){
 // Diagnostic only: independently authored native textureLod, never an expected-value oracle.
 const vertex='#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}',fragment='#version 300 es\nprecision highp float;uniform highp sampler2D source;out vec4 color;void main(){vec4 v=textureLod(source,vec2(.375,.625),.5);color=vec4(v.b,v.r,1.,0.);}',old={program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),fb:gl.getParameter(gl.FRAMEBUFFER_BINDING),active:gl.getParameter(gl.ACTIVE_TEXTURE),viewport:[...gl.getParameter(gl.VIEWPORT)]},owned=[],events=[];let sync;
 gl.activeTexture(gl.TEXTURE0);old.texture=gl.getParameter(gl.TEXTURE_BINDING_2D);old.sampler=gl.getParameter(gl.SAMPLER_BINDING);
 const own=(kind,o)=>{owned.push({kind,object:o,deleted:0});return o;};
 try{
  const output=own('Texture',gl.createTexture()),fb=own('Framebuffer',gl.createFramebuffer()),vao=own('VertexArray',gl.createVertexArray()),program=own('Program',gl.createProgram());
  gl.bindTexture(gl.TEXTURE_2D,output);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,width,height);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);
  for(const [type,text] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=own('Shader',gl.createShader(type));gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);gl.bindVertexArray(vao);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(0,sampler);gl.uniform1i(gl.getUniformLocation(program,'source'),0);gl.viewport(0,0,width,height);gl.drawArrays(gl.TRIANGLES,0,3);
  sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();let signaled=false;
  for(let turn=1;turn<=1000;turn++){await new Promise(resolve=>setTimeout(resolve,0));const actual=gl.clientWaitSync(sync,0,0);events.push({turn,name:'clientWaitSync',actual});if([gl.ALREADY_SIGNALED,gl.CONDITION_SATISFIED].includes(actual)){signaled=true;break;}if(actual===gl.WAIT_FAILED)throw Error('direct native precision fence failed');}
  if(!signaled)throw Error('direct native precision fence timeout');const pixels=nativeRead(gl,output,31,width,height,0);return{vertex,fragment,internalFormat:gl.RGBA32F,sourceInternalFormat:gl.R11F_G11F_B10F,events,physicalFence:true,pixels,ownedObjects:owned};
 }finally{if(sync){gl.deleteSync(sync);events.push({name:'deleteSync'});}gl.useProgram(old.program);gl.bindVertexArray(old.vao);gl.bindFramebuffer(gl.FRAMEBUFFER,old.fb);gl.viewport(...old.viewport);gl.bindTexture(gl.TEXTURE_2D,old.texture);gl.bindSampler(0,old.sampler);gl.activeTexture(old.active);for(const entry of owned){gl['delete'+entry.kind](entry.object);entry.deleted++;delete entry.object;}}
}

async function novel({seed,fault,precision=false}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardTextureShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seed,mode:'novel',guestExecution:false,productionNegotiation:false,runs:[],frames:[],blobs:[],predictions:c.rows};window.__standardPackedFloatConsumerEvidence=report;
 if(precision)report.precisionDiagnostics=[];
 for(const f of novelFixtures(seed,precision)){
  // This prediction is fixed from original input bits before creating any native object.
  const prediction=originalSample(f),r=rig(gl,bridge,c,f,{delay:3,step:1,fault}),target=r.allocations[0].storage.texture; r.blobs=report.blobs;
  r.add(meta(3,0,64,0,f.positions.length),f.positions);const old=r.add(f.source.metadata,f.source.backing);
  c.ok(r.store.detachBacking(6),'fresh old packed backing detach');c.ok(r.store.attachBacking(6,[f.source.backing.subarray(0,7),f.source.backing.subarray(7)]),'fresh original split7 source');
  const row={name:f.name,inputDomain:f.inputDomain,stage:f.stage,opcode:f.opcode,slot:f.slot,source:f.source.metadata,target:r.allocations[0].metadata,range:[f.firstLevel,f.lastLevel],swizzle:f.swizzle,parameters:f.parameters,width:f.width,height:f.height,outputLevel:0,clearColor:f.clearColor,vertex:f.vertex,fragment:f.fragment,positions:await blob(report,f.positions),backing:await blob(report,f.source.backing),planes:[],originalPrediction:prediction,sourceGeneration:old.generation,actions:[],cache:[]};report.runs.push(row);
  for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
  async function capture(record,kind){
   c.ok(record.result,'fresh original native submission');c.same(record.result.gpuComplete,true,'fresh consumed physical native fence');const pixels=nativeRead(gl,target,31,f.width,f.height,0),color=kind==='clear'?f.clearColor:prediction,actual=new Float32Array(pixels.buffer,pixels.byteOffset,pixels.byteLength/4),miss=[];
   for(let i=0;i<actual.length;i++)if(!Number.isFinite(actual[i])||Math.abs(actual[i]-color[i%4])>2e-6*Math.max(1,Math.abs(color[i%4])))miss.push({component:i,expected:color[i%4],observed:actual[i]});
   const frame={run:report.runs.indexOf(row),label:record.label,kind,historyIndex:r.history.length-1,dump:record.dump,pixels:await blob(report,pixels),mask:15,blend:false,previous:null,outputs:[{level:0,width:f.width,height:f.height,native:await blob(report,pixels)}],bindings:[]};report.frames.push(frame);
   if(kind==='draw'){
    gl.activeTexture(gl.TEXTURE0+f.slot);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),a=r.allocations.find(a=>a.storage.texture===texture),planes=[];
    for(let local=0;local<=f.lastLevel-f.firstLevel;local++){const p=f.source.planes[f.firstLevel+local];planes.push({local,original:p.level,width:p.width,height:p.height,native:await blob(report,nativeRead(gl,texture,124,p.width,p.height,local))});}
    frame.bindings.push({stage:'fragment',slot:f.slot,range:row.range,nativeTexture:r.trace.id(texture),metadata:a.metadata,planes});
    if(precision&&row.cache.length===0){const sampler=gl.getParameter(gl.SAMPLER_BINDING),diagnostic=await directNative(gl,texture,sampler,f.width,f.height),native=diagnostic.pixels;delete diagnostic.pixels;diagnostic.directPixels=await blob(report,native);diagnostic.originalPixels=frame.pixels;diagnostic.run=frame.run;diagnostic.originalPrediction=prediction;diagnostic.originalOracleMismatches=miss;c.same([...native],[...pixels],'independent direct native filtering matches original consumer');report.precisionDiagnostics.push(diagnostic);}
    gl.activeTexture(gl.TEXTURE0);
   }
   if(fault&&miss.length)report.sabotage={fault,fenceCompleted:true,held:false,miss:miss.slice(0,8),originalPrediction:prediction,observed:frame.pixels};
   if(!precision)c.same(miss.slice(0,8),[],'fresh original TGSI/packed bits oracle after physical fence');else frame.originalOracleMismatches=miss;
   const publicRead=await submit(r,1,outputRead(f),record.label+'/public');c.ok(publicRead.result,'fresh original public output');c.same(publicRead.result.gpuComplete,true,'fresh public transfer native fence');frame.publicHistory=r.history.length-1;frame.outputBacking=await blob(report,c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'fresh entire public output backing').bytes);
  }
  try{
   await capture(await submit(r,1,setup(f),'critic-setup-'+f.firstLevel),'clear');c.ok((await submit(r,1,views(f),'critic-view-'+f.firstLevel)).result,'fresh original native range view');
   for(const temperature of ['first','warm']){await capture(await submit(r,1,draw(),'critic-draw-'+f.firstLevel+'-'+temperature),'draw');row.cache.push({temperature,snapshot:r.renderer.inspect()});}
   c.ok((await submit(r,2,join(setup(f),views(f)),'critic-second-context-'+f.firstLevel)).result,'fresh second retained context');c.ok(r.store.unref(6),'fresh unref old original source');
   const freshMeta={...f.source.metadata,width:9,height:5,lastLevel:2};let bytes=0;for(let level=0;level<=2;level++)bytes+=Math.max(1,9>>level)*Math.max(1,5>>level)*4;const fresh=r.add(freshMeta,new Uint8Array(bytes));row.actions.push({kind:'fresh-unequal-ID-reuse',oldGeneration:old.generation,newGeneration:fresh.generation,replacement:freshMeta,inspection:r.store.inspect()});c.same(fresh.generation>old.generation,true,'fresh retained unequal original generation');
   for(const ctx of [1,2])await capture(await submit(r,ctx,draw(),'critic-retained-context-'+ctx+'-range'+f.firstLevel),'draw');c.same(gl.getError(),gl.NO_ERROR,'fresh native original range/ownership experiment leaves no errors');
  }finally{await finish(r,report,row);}
 }
 if(precision)report.mode='precision';report.status='passed';return report;
}

async function historical(){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:'historical',gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],frames:[],blobs:[],predictions:c.rows,nativeControls:[],wireControls:[]};window.__standardPackedFloatConsumerEvidence=report;
 const empty=new Uint8Array(),z16=surface(9,7,16,0),byte=surface(10,7,1,0),rg=surface(11,7,65,0);
 for(const name of ['decodeSubmission','decodeStandardSubmission','decodeStandardUniformSubmission','decodeStandardTextureSubmission','decodeStandardImageSubmission','decodeStandardColorSubmission','decodeStandardFloatImageSubmission','decodeStandardPackedFloatImageSubmission'])for(const bytes of [empty,z16,byte,rg]){const result=decoders[name](bytes);report.wireControls.push({name,hex:[...bytes].map(n=>n.toString(16).padStart(2,'0')).join(''),result});c.same(result.ok,bytes===empty||bytes===z16||name==='decodeStandardColorSubmission'||name==='decodeStandardFloatImageSubmission'||name==='decodeStandardPackedFloatImageSubmission','bounded historical decoder profile/original surface');}
 const simpleVertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n',simpleFragment='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.25,0.5,0.75,1}\n0: MOV OUT[0], IMM[0]\n1: END\n';
 const textureBridge=await createVirglStandardTextureShaderBridge(),uniformBridge=await createVirglStandardUniformShaderBridge(),ordinaryBridge=await createVirglStandardShaderBridge(),tinyBridge=await createVirglShaderBridge();
 const factoryNames=['createVirglStateRenderer','createVirglDrawRenderer','createVirglAsyncRenderer','createVirglStandardAsyncRenderer','createVirglStandardUniformAsyncRenderer','createVirglStandardBufferAsyncRenderer','createVirglStandardImageAsyncRenderer','createVirglStandardColorAsyncRenderer','createVirglStandardTextureAsyncRenderer','createVirglStandardFloatImageAsyncRenderer'];
 for(let index=0;index<factoryNames.length;index++){
  const name=factoryNames[index],trace=traceGL(gl,c,1),calls=[],nativeObjects=[];
  const traced=new Proxy(trace.gl,{get(target,key){const base=Reflect.get(target,key,target);if(typeof base!=='function')return base;return(...args)=>{const result=base(...args);calls.push({name:key,args:args.map(a=>a&&typeof a==='object'?trace.id(a)??(ArrayBuffer.isView(a)?[...a]:null):a)});if(/^create(Texture|Buffer|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(key)&&result)nativeObjects.push({object:result,id:trace.id(result),name:key,deleted:0});if(/^delete(Texture|Buffer|Framebuffer|VertexArray|Sampler|Program|Shader)$/.test(key)&&args[0]){const found=nativeObjects.find(row=>row.object===args[0]);if(found)found.deleted++;}return result;};}});
  const backend=c.ok(createStandardPackedFloatColorTransferBackend(traced),'bounded historical actual native backend').backend,owner=c.ok((index<4?createResourceStore:index===4?createStandardUniformResourceStore:createStandardPackedFloatColorResourceStore)({backend}),'bounded historical actual native owner'),options={gl:traced,resources:owner.store,bindings:owner.bindings,shaderBridge:index<3?tinyBridge:index===3?ordinaryBridge:index>=8?textureBridge:uniformBridge};
  if(index>=2)Object.assign(options,{asyncAccess:owner.asyncAccess,jobLimits:{commandsPerStep:1}});if(index>=4)options.uniformAccess=owner.uniformAccess;if(index>=6)options.imageAccess=owner.imageAccess;
  const renderer=c.ok(factories[name](options),'bounded actual historical constructor').renderer,row={name,profile:renderer.inspect().profile,history:[]};report.nativeControls.push(row);
  c.ok(owner.store.createContext(1),'bounded historical owner context');c.ok(renderer.createContext(1),'bounded historical renderer context');
  for(const id of [1,3]){const Typed=index===3?Int32Array:Float32Array,data=id===1?new Uint8Array(16):new Uint8Array(new Typed([-1,-1,0,1,1,-1,0,1,1,1,0,1,-1,-1,0,1,1,1,0,1,-1,1,0,1]).buffer),metadata=id===1?meta(1,2,67,2,2,2):meta(3,0,64,16,data.length);c.ok(owner.store.createResource(metadata),'bounded historical resource');c.ok(owner.store.attachContext(1,id),'bounded historical membership');c.ok(owner.store.attachBacking(id,[data]),'bounded historical backing');}
  const execute=async(bytes,label)=>{trace.label(label);const original=bytes.slice();let result;c.ok(renderer.beginFrame(row.history.length+1),'bounded historical frame');if(index<2)result=renderer.executeSubmission(1,bytes);else{const begun=c.ok(renderer.beginSubmission(1,bytes),'bounded historical owned job');for(let turns=0;turns<1000;turns++){await new Promise(resolve=>setTimeout(resolve,0));trace.nextTurn();const step=c.ok(renderer.step(begun.job),'bounded historical later-task step');if(step.status==='done'){result=step.result;break;}if(step.status==='needs-input'){const q=step.request,rows=[];for(let y=0;y<q.layout.rowCount;y++)rows.push(c.ok(owner.store.readBacking(q.resource.id,q.layout.offset+y*q.layout.rowStride,q.layout.rowBytes),'bounded original legacy input').bytes);c.ok(renderer.provideInput(begun.job,q.token,join(...rows)),'bounded legacy input exchange');}}}c.ok(result,'bounded legacy completion');row.history.push({label,hex:[...original].map(n=>n.toString(16).padStart(2,'0')).join(''),result,dump:c.ok(renderer.endFrame(row.history.length+1),'bounded legacy frame dump').dump});return result;};
  try{
   await execute(join(surface(4,1,67,0),packet(5,0,[1,0,4]),clear(index>=3?[0,0,0,0]:[.25,.5,.75,1])),'legacy-clear-'+index);
   if(index>=3){const transfer=packet(43,0,[3,0,0,0,0,0,0,0,96,1,1,0,1]),vertex=index===3?simpleVertex.replace('MOV OUT[0], IN[0]','I2F OUT[0], IN[0]'):simpleVertex;await execute(join(transfer,shader(1,0,vertex),shader(2,1,simpleFragment),packet(1,5,[3,0,0,0,index===3?200:31]),packet(2,5,[3]),packet(6,0,[16,0,3]),packet(4,0,[0,...[1,1,.5,1,1,.5].map(word)]),packet(31,0,[1,0]),packet(31,0,[2,1]),draw()),'legacy-native-draw-'+index);}
   const lease=c.ok(owner.store.retainStorage(1,1,'surface'),'bounded output lease').lease,resolved=c.ok(owner.bindings.resolve(lease),'bounded output storage'),pixels=nativeRead(gl,resolved.storage.texture,67,2,2,0);c.ok(owner.store.releaseStorage(lease),'bounded output observation lease cleanup');row.pixels=await blob(report,pixels);c.same([...pixels],[64,128,191,255,64,128,191,255,64,128,191,255,64,128,191,255],'bounded native historical clear/draw values');c.same(gl.getError(),gl.NO_ERROR,'bounded historical native controls have no GL error');
  }finally{c.ok(renderer.dispose(),'bounded historical renderer disposal');c.ok(owner.store.dispose(),'bounded historical owner disposal');row.events=trace.events;row.calls=calls;row.nativeObjects=nativeObjects.map(({object,...entry})=>entry);row.final={renderer:renderer.inspect(),resources:owner.store.inspect()};for(const entry of row.nativeObjects)c.same(entry.deleted,1,'bounded native historical once-only deletion');}
 }
 report.status='passed';return report;
}

export async function runAcceptance({mode='novel',seed=0xc01dcafe,fault=null}={}){
 if(mode==='boundaries')return(await import('./standard-packed-float-consumer-boundaries.mjs')).runBoundaries({seed});
 if(mode==='historical')return historical();
 return novel({seed,fault,precision:mode==='precision'});
}
