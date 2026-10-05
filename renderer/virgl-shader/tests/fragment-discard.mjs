import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,texture2d,bindSystemBlocks,digest} from './browser.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../../virgl-command/resources.mjs';
import {createVirglDrawRenderer,createVirglAsyncRenderer} from '../../virgl-command/state.mjs';
import {SEEDS,VERTEX,CLEAR,physicalPlan} from '../../../tools/virgl-fragment-discard/cases.mjs';
import {DISCARD_KEY,parseConstantDomain} from '../../virgl-command/constant-domain.mjs';
const require=(value,label)=>{if(!value)throw new Error(label);};
const equal=(a,b,label)=>require(JSON.stringify(a)===JSON.stringify(b),label+': '+JSON.stringify(a)+' != '+JSON.stringify(b));
const floatWord=value=>new Uint32Array(new Float32Array([value]).buffer)[0];

function monitor(native,report){
 const live=new Map(),objects=[],ids=new WeakMap();let serial=0;
 const kinds={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createFramebuffer:'Framebuffer',createVertexArray:'VertexArray',createSampler:'Sampler',fenceSync:'Sync'};
 const gl=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
  return(...args)=>{const result=value.apply(target,args);
   if(kinds[key]&&result){const id=kinds[key]+':'+(++serial);ids.set(result,id);live.set(id,kinds[key]);objects.push({id,kind:kinds[key],object:result});report.events.push({call:key,id});}
   if(/^delete/.test(key)&&args[0]){live.delete(ids.get(args[0]));report.events.push({call:key,id:ids.get(args[0])});}
   if(['compileShader','linkProgram'].includes(key))report.events.push({call:key,id:ids.get(args[0]),status:key==='compileShader'?target.getShaderParameter(args[0],target.COMPILE_STATUS):target.getProgramParameter(args[0],target.LINK_STATUS)});
   if(key==='shaderSource')report.events.push({call:key,id:ids.get(args[0]),source:args[1]});
   if(key==='uniform4uiv')report.events.push({call:key,words:[...args[1]]});
   if(['viewport','drawElements','drawBuffers'].includes(key))report.events.push({call:key,arguments:args});
   return result;
  };}});
 return{gl,finish(){equal(live.size,0,'all discard GL objects disposed');for(const entry of objects)equal(native['is'+entry.kind](entry.object),false,'physical deletion '+entry.id);report.objects={created:objects.length,live:live.size};}};
}

function validatePixels(raw,reference,record,strict=true){
 equal(raw.length,reference.geometry.width*reference.geometry.height*4,'complete framebuffer readback');
 record.checkedPixels=0;record.qualifications=[];
 for(const point of reference.points){
  const at=(point.y*reference.geometry.width+point.x)*4,rgba=[...raw.subarray(at,at+4)];
  if(JSON.stringify(rgba)!==JSON.stringify(point.rgba)){
   const failure={point,rgba};
   if(strict||!point.inside||![JSON.stringify(CLEAR),JSON.stringify([64,128,191,255])].includes(JSON.stringify(rgba))){record.failure=failure;throw new Error('independent discard pixel mismatch '+record.backend+'/'+record.name+' at '+point.x+','+point.y);}
   record.qualifications.push(failure);
  }
  record.checkedPixels++;
 }
}

function mutation(source,fault){
 if(!fault)return{source,record:null};let needle,replacement;
 if(fault==='unconditional'){
  needle=' discard;';require(source.includes(needle),'unconditional source fault site');replacement=' /* discard inhibited */';
 }else{
  const m=/ if \((raw_discard_negative\([^\n]+)\) discard;/.exec(source);require(m,'conditional source fault site');needle=m[0];
  if(fault==='inhibit')replacement=' if (false) discard;';
  else if(fault==='invert')replacement=` if (!(${m[1]})) discard;`;
  else if(fault==='x-only'){
   const first=m[1].split(' || ')[0];replacement=` if (${first}) discard;`;
  }else throw new Error(fault);
 }
 const changed=source.replace(needle,replacement);return{source:changed,record:{kind:fault,needle,replacement,original:source,served:changed}};
}

async function directProbe(gl,bridge,item,reference,primary,report,fault){
 const pair=bridge.translatePair({vertexText:VERTEX,fragmentText:item.text});require(pair.ok,'checked discard pair');
 const policy=parseConstantDomain(pair.fragment.metadata,'fragment');require(policy.ok&&policy.discard,'discard metadata policy');
 require(pair.interfaceKey.endsWith(DISCARD_KEY+Number(policy.discard.alwaysDiscards)),'discard selector binding');
 require(primary&&primary.glsl.includes('discard;'),'original pinned discard compilation');
 const source=item.backend==='mesa'?primary.glsl:pair.fragment.glsl,changed=mutation(source,fault);
 const built=createProgram(gl,pair.vertex,{...pair.fragment,glsl:changed.source}),program=built.program;
 const buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer();require(vao&&fb,'discard render objects');
 const record={...item,textSha256:await digest(item.text),pair,primary,policy,mutation:changed.record,logs:built.logs,reflection:{attributes:[],uniforms:[]}};report.probes.push(record);
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);record.reflection.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
  for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){const info=gl.getActiveUniform(program,i);record.reflection.uniforms.push({name:info.name,type:info.type,size:info.size});}
  const output=gl.getFragDataLocation(program,'fsout_c0');require(output===0||output===-1&&policy.discard.alwaysDiscards,'bounded fragment output reflection');record.reflection.output=output;
  for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++){const info=gl.getActiveAttrib(program,i);equal(info.name,'in_0','declared position attribute');equal([info.type,info.size],[gl.FLOAT_VEC4,1],'position vec4');record.reflection.attributes.push({name:info.name,type:info.type,size:info.size});}
  const mesh=gl.createBuffer(),indices=gl.createBuffer();require(mesh&&indices,'discard mesh objects');buffers.push(mesh,indices);
  gl.bindBuffer(gl.ARRAY_BUFFER,mesh);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(item.geometry.vertices.flat()),gl.STATIC_DRAW);
  const at=gl.getAttribLocation(program,'in_0');require(at>=0,'physical position binding');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,16,0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(item.geometry.indices),gl.STATIC_DRAW);
  if(pair.fragment.metadata.uniforms.length){
   const md=pair.fragment.metadata.uniforms[0],location=gl.getUniformLocation(program,md.name+'[0]');
   if(!location){require(policy.discard.alwaysDiscards||changed.record,'only terminal or deliberately sabotaged source can eliminate a direct bank');record.bankUpload={inactive:true};}
   else{
    const index=gl.getUniformIndices(program,[md.name+'[0]'])[0];require(index!==gl.INVALID_INDEX,'raw word bank reflection');
    equal(gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0],gl.UNSIGNED_INT_VEC4,'exact word bank');
    const count=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0];require(count>=1&&count<=md.count,'bounded bank reflection');
    const words=item.words.slice(0,md.count*4);equal(words.length,md.count*4,'literal complete bank');const caller=words.slice(),owned=new Uint32Array(caller);caller.fill(0xdeadbeef);
    gl.uniform4uiv(location,owned.subarray(0,count*4));const observed=[];
    for(let i=0;i<count;i++){const loc=gl.getUniformLocation(program,md.name+'['+i+']');require(loc,'active bank lane');const value=[...gl.getUniform(program,loc)];equal(value,words.slice(i*4,i*4+4),'physical copied bank');observed.push(value);}
    record.bankUpload={words:[...owned],callerAfter:caller,count,declaredCount:md.count,observed};
   }
  }
  const target=texture2d(gl,item.geometry.width,item.geometry.height,null);textures.push(target);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
  equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'discard RGBA8 framebuffer');
  for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD,gl.SAMPLE_COVERAGE])gl.disable(cap);
  gl.colorMask(true,true,true,true);gl.viewport(...item.geometry.viewport);gl.depthRange(0,1);equal([...gl.getParameter(gl.VIEWPORT)],item.geometry.viewport,'physical viewport');
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.clearColor(...CLEAR.map(v=>v/255));gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawBuffers([output===-1?gl.NONE:gl.COLOR_ATTACHMENT0]);gl.drawElements(gl.TRIANGLES,item.geometry.indices.length,gl.UNSIGNED_SHORT,0);
  const raw=new Uint8Array(item.geometry.width*item.geometry.height*4);gl.readPixels(0,0,item.geometry.width,item.geometry.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);equal(gl.getError(),gl.NO_ERROR,'physical discard draw errors');
  record.rgbaBytes=[...raw];record.sha256=await digest(raw);validatePixels(raw,reference,record,item.backend==='owned'||item.portablePrimary);
  if(item.variant==='spatial'&&item.lane==='x'){
   const figure=document.createElement('figure'),label=document.createElement('figcaption'),canvas=document.createElement('canvas');canvas.width=item.geometry.width;canvas.height=item.geometry.height;canvas.style.width='160px';canvas.style.height='120px';canvas.style.imageRendering='pixelated';
   const flipped=new Uint8ClampedArray(raw.length);for(let y=0;y<canvas.height;y++)flipped.set(raw.subarray(y*canvas.width*4,(y+1)*canvas.width*4),(canvas.height-1-y)*canvas.width*4);
   canvas.getContext('2d').putImageData(new ImageData(flipped,canvas.width,canvas.height),0,0);label.textContent=`${item.backend} ${item.kind} · discard`;figure.append(canvas,label);document.querySelector('#draws').append(figure);
  }
 }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);for(const texture of textures)gl.deleteTexture(texture);for(const buffer of buffers)gl.deleteBuffer(buffer);gl.deleteProgram(program);}
}

const packet=(op,type,words)=>{const bytes=new Uint8Array(4+words.length*4),view=new DataView(bytes.buffer);view.setUint32(0,op+type*256+words.length*65536,true);words.forEach((w,i)=>view.setUint32(4+4*i,w,true));return bytes;};
const joined=(...parts)=>{const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;};
function shaderPacket(handle,stage,text){const bytes=packet(1,4,[handle,stage,text.length+1,256,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);bytes.set(new TextEncoder().encode(text),24);return bytes;}

async function consumerProbe(gl,bridge,plan,references,asynchronous,seed,report){
 const ok=(result,label)=>{require(result?.ok===true,label+': '+JSON.stringify(result));return result;};
 const record={asynchronous,commandsPerStep:1+(seed%3),submissions:[],captures:[],pairRequests:[],rejections:[]};report.consumers.push(record);
 const backend=ok(createWebGL2TransferBackend(gl),'real discard transfer backend').backend;
 const {store,bindings,asyncAccess}=ok(createResourceStore({backend}),'real discard resources');const control={fault:null};
 const pairCompiler=request=>{const pair=bridge.translatePair(request);record.pairRequests.push({request,pair,fault:control.fault});if(!pair.ok||!control.fault)return pair;
  const changed=structuredClone(pair);
  if(control.fault==='key')changed.interfaceKey=changed.interfaceKey.replace(/\|tgsi-fragment-discard-v1:.*$/,'');
  if(control.fault==='terminal-key')changed.interfaceKey=changed.interfaceKey.replace(/always-[01]$/,pair.fragment.metadata.discardContract.alwaysDiscards?'always-0':'always-1');
  if(control.fault==='fragment')changed.fragment.glsl=changed.fragment.glsl.replace(' discard;',' /* inhibited */');
  if(control.fault==='metadata')changed.fragment.metadata.discardContract.alwaysDiscards=!changed.fragment.metadata.discardContract.alwaysDiscards;
  return changed;
 };
 const shaderBridge={translate:request=>bridge.translate(request),translatePair:pairCompiler};
 const renderer=ok((asynchronous?createVirglAsyncRenderer:createVirglDrawRenderer)({gl,resources:store,bindings,shaderBridge,
  ...(asynchronous?{asyncAccess,jobLimits:{commandsPerStep:record.commandsPerStep}}:{})}),'actual indexed discard renderer').renderer;
 const submit=async(bytes,label)=>{const entry={label,before:[...bytes],states:[]};record.submissions.push(entry);let result;
  if(!asynchronous){result=renderer.executeSubmission(1,bytes);bytes.fill(0xff);}
  else{entry.begin=renderer.beginSubmission(1,bytes);bytes.fill(0xff);if(!entry.begin.ok)result=entry.begin;else for(let step=0;step<1024;step++){
   const state=ok(renderer.step(entry.begin.job),'discard async step');entry.states.push(state);if(state.status==='done'){result=state.result;break;}await new Promise(resolve=>setTimeout(resolve,0));
  }}
  require(result,'bounded discard consumer completion');entry.after=[...bytes];entry.result=result;return result;
 };
 const snapshot=()=>ok(renderer.inspect(),'discard logical snapshot');
 const transfer=(id,words)=>packet(9,0,[id,0,0,0,0,0,0,0,words.length*4,1,1,...words]);
 const clear=()=>packet(7,0,[4,...CLEAR.map(v=>floatWord(v/255)),0,0,0]);
 const draw=()=>packet(8,0,[0,6,4,1,1,0,0,0,0,0,5,0]);
 const selection=p=>p.backend==='owned'&&(
  p.variant==='spatial'||['killed-true','killed-false','unconditional-fault','kill-only','raster-bank'].includes(p.variant)||
  p.variant==='uniform'&&p.modifier==='plain'&&p.lane===2&&['positive-zero','negative-zero','negative-one','negative-min-subnormal'].some(n=>p.name.startsWith(n+'-')));
 try{
  ok(store.createContext(1),'discard resource context');ok(renderer.createContext(1),'discard state context');
  for(const [id,bind,width,height]of [[10,16,96,1],[11,32,12,1],[12,2,32,32]]){
   ok(store.createResource({id,target:id===12?2:0,format:id===12?67:64,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'discard retained storage');ok(store.attachContext(1,id),'discard storage membership');
  }
  const g=plan[0].geometry,[x,y,w,h]=g.viewport;
  ok(await submit(joined(packet(1,5,[100,0,0,0,29]),packet(2,5,[100]),packet(6,0,[16,0,10]),packet(11,0,[11,2,0]),packet(1,8,[101,12,67,0,0]),packet(5,0,[1,0,101]),packet(1,2,[102,2+(1<<29),floatWord(1),0,0xffff,floatWord(1),0,0,0]),packet(2,2,[102]),transfer(11,[65536,196610,327684]),transfer(10,g.vertices.flat().map(floatWord)),shaderPacket(200,0,VERTEX),packet(31,0,[200,0]),packet(4,0,[0,...[w/2,h/2,.5,x+w/2,y+h/2,.5].map(floatWord)])),'indexed resources, geometry and raster setup'),'discard setup');
  let handle=201;
  for(const [index,item]of plan.entries())if(selection(item)){
   const fragmentHandle=handle++,pair=bridge.translatePair({vertexText:VERTEX,fragmentText:item.text});require(pair.ok,'selected source pair');
   ok(await submit(joined(shaderPacket(fragmentHandle,1,item.text),packet(31,0,[fragmentHandle,1]),packet(52,0,[200,fragmentHandle,0,0,0,0])),'discard interface '+item.name),'checked discard link');
   const count=pair.fragment.metadata.uniforms[0]?.count??0;
   if(count)ok(await submit(packet(12,0,[1,0,...item.words.slice(0,count*4)]),'exact bank '+item.name),'owned discard bank');
   gl.useProgram(null);gl.viewport(19,17,1,1);gl.colorMask(false,false,false,false);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.enable(gl.RASTERIZER_DISCARD);
   ok(renderer.restoreContext(1),'discard restore after native poison');equal([...gl.getParameter(gl.VIEWPORT)],g.viewport,'consumer restored viewport');equal(gl.isEnabled(gl.SCISSOR_TEST),false,'consumer restored scissor');equal(gl.isEnabled(gl.RASTERIZER_DISCARD),false,'consumer restored rasterization');
   const result=ok(await submit(joined(clear(),draw()),'indexed discard draw '+item.name),'actual discard indexed draw');equal(result.draws.length,1,'one indexed draw');equal(result.draws[0].actualMaxIndex,5,'real u16 index storage');
   const state=snapshot(),sub=state.contexts[0].subContexts[0],program=sub.programs.find(p=>p.vertexHandle===200&&p.fragmentHandle===fragmentHandle);require(program&&program.interfaceKey.endsWith(DISCARD_KEY+Number(pair.fragment.metadata.discardContract.alwaysDiscards)),'owned discard cache selector');
   const raw=new Uint8Array(32*32*4);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,raw);equal(gl.getError(),gl.NO_ERROR,'consumer physical readback');
   const points=Array.from({length:1024},(_,i)=>{const x=i%32,y=Math.floor(i/32);return x<g.width&&y<g.height?references[index].points[y*g.width+x]:{x,y,written:false,rgba:CLEAR};});
   const drawBuffer=gl.getParameter(gl.DRAW_BUFFER0),expectedBuffer=program.reflection.outputs[0].location===-1?gl.NONE:gl.COLOR_ATTACHMENT0;equal(drawBuffer,expectedBuffer,'owned terminal draw buffer');
   const capture={...item,geometry:{...g,width:32,height:32},sourceIndex:index,backend:'indexed-'+(asynchronous?'async':'sync'),vertexText:VERTEX,fragmentText:item.text,pair,result,state,program,drawBuffer,rgbaBytes:[...raw],sha256:await digest(raw)};record.captures.push(capture);validatePixels(raw,{geometry:capture.geometry,points},capture);
   ok(await submit(packet(3,4,[fragmentHandle]),'drop discard fragment name'),'fragment name disposal');
  }
  const attack=plan.find(p=>p.backend==='owned'&&p.variant==='uniform'),fragmentHandle=handle++;
  ok(await submit(shaderPacket(fragmentHandle,1,attack.text),'prepare selector attacks'),'selector attack object');
  for(const fault of ['key','terminal-key','fragment','metadata','missing']){
   control.fault=fault;shaderBridge.translatePair=fault==='missing'?undefined:pairCompiler;const before=snapshot(),events=report.events.length;
   const result=await submit(packet(52,0,[200,fragmentHandle,0,0,0,0]),'forged discard '+fault);equal(result.ok,false,'selector fault rejects');equal(result.appliedCommands,0,'selector rejection atomicity');equal(snapshot(),before,'selector rejection retains owned state');
   const nativeEvents=report.events.slice(events);require(nativeEvents.every(e=>asynchronous&&['fenceSync','deleteSync'].includes(e.call)),'selector rejection precedes program/state effects');record.rejections.push({fault,before,after:snapshot(),result,nativeEvents});
  }
  control.fault=null;shaderBridge.translatePair=pairCompiler;
  // SET_CONSTANT_BUFFER retains its existing finite wire-field restriction.
  // Direct raw ABI special-value tests above do not widen this transport.
  for(const word of [0x7f800000,0xff800000,0x7fc12345,0xffc12345,0xff800001]){
   const before=snapshot(),events=report.events.length,result=await submit(packet(12,0,[1,0,0,0,word,0]),'nonfinite wire bank '+word);
   equal(result.ok,false,'nonfinite wire bank rejects');equal(result.appliedCommands,0,'wire rejection atomicity');equal(snapshot(),before,'wire rejection retains owned state');
   const nativeEvents=report.events.slice(events);require(nativeEvents.every(e=>asynchronous&&['fenceSync','deleteSync'].includes(e.call)),'wire rejection precedes native effects');record.rejections.push({fault:'nonfinite-'+word,before,after:snapshot(),result,nativeEvents});
  }
  ok(await submit(joined(packet(3,4,[fragmentHandle]),packet(3,4,[200])),'drop discard public names'),'name disposal');
 }finally{ok(renderer.dispose(),'discard renderer disposal');record.finalBudgets=snapshot().budgets;require(Object.values(record.finalBudgets).every(v=>v===0),'zero discard renderer budgets');ok(store.dispose(),'discard resource disposal');record.finalResourceBudgets=ok(store.inspect(),'discard resources disposed').budgets;require(Object.values(record.finalResourceBudgets).every(v=>v===0),'zero discard resource budgets');gl.useProgram(null);}
}

export async function runAcceptance({seed=SEEDS[0],fault=null}={}){
 const report={schema:'virgl-fragment-discard-gpu-v1',status:'running',guestExecution:false,productionNegotiation:false,seed,fault,probes:[],consumers:[],events:[]};window.__virglFragmentDiscardReport=report;
 const canvas=document.querySelector('#gpu');canvas.width=canvas.height=32;const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(native instanceof WebGL2RenderingContext,'actual WebGL2');
 const debug=native.getExtension('WEBGL_debug_renderer_info');require(debug,'physical renderer identity');report.renderer={vendor:native.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:native.getParameter(debug.UNMASKED_RENDERER_WEBGL),version:native.getParameter(native.VERSION)};require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer.renderer),'physical GPU');const watched=monitor(native,report),gl=watched.gl;
 try{
  const bridge=await createVirglShaderBridge();
  const load=async(path,key)=>{const response=await fetch('/'+path);require(response.ok,'recorded reference '+path);const bytes=new Uint8Array(await response.arrayBuffer());report[key]={path,bytes:bytes.length,sha256:await digest(bytes)};return JSON.parse(new TextDecoder().decode(bytes));};
  const primary=await load('renderer/virgl-shader/build/discard-primary.json','primaryFile'),reference=await load(`renderer/virgl-shader/build/discard-reference-${seed}.json`,'referenceFile');
  const plan=physicalPlan(seed);equal(reference.seed,seed,'predetermined seed');equal(reference.rows.length,plan.length,'pre-observation prediction coverage');equal(await digest(JSON.stringify(plan)),reference.planSha256,'literal plan binding');report.planSha256=reference.planSha256;
  let injected=false;
  for(let index=0;index<plan.length;index++){
   const item=plan[index],prediction=reference.rows[index],witness=primary.find(p=>p.text===item.text);require(witness,'pinned literal TGSI witness');equal(await digest(item.text),prediction.textSha256,'literal prediction input');equal(item.geometry,prediction.geometry,'literal prediction geometry');
   const selected=fault==='unconditional'?item.variant==='unconditional-fault'&&item.words[0]!==0:
    item.variant==='uniform'&&item.modifier==='plain'&&item.name===(fault==='invert'?'positive-one-2-plain':'negative-one-2-plain');
   const inject=!injected&&fault&&item.backend==='owned'&&selected;if(inject)injected=true;
   await directProbe(gl,bridge,item,prediction,witness.primary,report,inject?fault:null);
  }
  for(const asynchronous of [false,true])await consumerProbe(gl,bridge,plan,reference.rows,asynchronous,seed,report);
  require(!fault,'discard source fault must fail independent pixel oracle');
  report.directPixels=report.probes.reduce((n,p)=>n+p.checkedPixels,0);report.consumerPixels=report.consumers.reduce((n,c)=>n+c.captures.reduce((n,p)=>n+p.checkedPixels,0),0);report.checkedPixels=report.directPixels+report.consumerPixels;report.status='passed';document.querySelector('#status').textContent=`${report.checkedPixels} literal clear/written discard pixels`;document.querySelector('#renderer').textContent=report.renderer.renderer;
 }catch(error){report.status='failed';report.failure={message:error.message};throw error;}finally{watched.finish();equal(gl.getError(),gl.NO_ERROR,'final physical discard errors');}return report;
}
