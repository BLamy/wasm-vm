import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,texture2d,bindSystemBlocks,digest} from './browser.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../../virgl-command/resources.mjs';
import {createVirglDrawRenderer,createVirglAsyncRenderer} from '../../virgl-command/state.mjs';
import {SEEDS,PARTNER_VERTEX,physicalPlan,bytesFragment,geometries} from '../../../tools/virgl-fragment-coordinates/cases.mjs';
import {COORDINATE_KEY,parseConstantDomain} from '../../virgl-command/constant-domain.mjs';
const require=(value,label)=>{if(!value)throw new Error(label);};
const equal=(a,b,label)=>require(JSON.stringify(a)===JSON.stringify(b),label+': '+JSON.stringify(a)+' != '+JSON.stringify(b));
const floatWord=value=>new Uint32Array(new Float32Array([value]).buffer)[0];
const fromWord=value=>new Float32Array(new Uint32Array([value]).buffer)[0];
const rational=text=>{const [a,b='1']=text.split('/');return Number(a)/Number(b);};

function monitor(native,report){
 const live=new Map(),objects=[],ids=new WeakMap();let serial=0;
 const kinds={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createFramebuffer:'Framebuffer',createVertexArray:'VertexArray',createSampler:'Sampler',fenceSync:'Sync'};
 const gl=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
  return(...args)=>{const result=value.apply(target,args);
   if(kinds[key]&&result){const id=kinds[key]+':'+(++serial);ids.set(result,id);live.set(id,kinds[key]);objects.push({id,kind:kinds[key],object:result});report.events.push({call:key,id});}
   if(/^delete/.test(key)&&args[0]){live.delete(ids.get(args[0]));report.events.push({call:key,id:ids.get(args[0])});}
   if(['compileShader','linkProgram'].includes(key))report.events.push({call:key,id:ids.get(args[0]),status:key==='compileShader'?target.getShaderParameter(args[0],target.COMPILE_STATUS):target.getProgramParameter(args[0],target.LINK_STATUS)});
   if(key==='shaderSource')report.events.push({call:key,id:ids.get(args[0]),source:args[1]});
   if(['viewport','depthRange','drawElements'].includes(key))report.events.push({call:key,arguments:args});
   return result;
  };}});
 return{gl,finish(){equal(live.size,0,'all coordinate GL objects disposed');for(const entry of objects)equal(native['is'+entry.kind](entry.object),false,'physical deletion '+entry.id);report.objects={created:objects.length,live:live.size};}};
}

function validatePixels(raw,reference,record){
 equal(raw.length,reference.geometry.width*reference.geometry.height*4,'complete framebuffer readback');
 record.words=[];record.checkedPixels=0;record.maximumError=0;
 for(const point of reference.points){
  const at=(point.y*reference.geometry.width+point.x)*4,rgba=[...raw.subarray(at,at+4)];
  const actual=(rgba[0]|rgba[1]<<8|rgba[2]<<16|rgba[3]<<24)>>>0;record.words.push(actual);
  let pass,error=0;
  if(!point.written)pass=JSON.stringify(rgba)===JSON.stringify(point.rgba);
  else if(point.budget==='0')pass=actual===point.word;
  else{error=Math.abs(fromWord(actual)-rational(point.value));pass=Number.isFinite(error)&&error<=rational(point.budget);}
  record.maximumError=Math.max(record.maximumError,error);
  if(!pass){record.failure={point,actual,rgba,error};throw new Error('independent coordinate pixel mismatch '+record.backend+'/'+record.variant+'/'+record.lane+' at '+point.x+','+point.y);}
  record.checkedPixels++;
 }
}

function display(raw,item){
 if(item.variant!=='direct'||item.mask!==15||item.swizzle!=='xyzw'||!['full-odd','offset-even'].includes(item.geometry.name))return;
 const {width,height}=item.geometry,figure=document.createElement('figure'),label=document.createElement('figcaption'),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.style.width='160px';canvas.style.height='120px';canvas.style.imageRendering='pixelated';
 const flipped=new Uint8ClampedArray(raw.length);for(let y=0;y<height;y++)flipped.set(raw.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
 canvas.getContext('2d').putImageData(new ImageData(flipped,width,height),0,0);label.textContent=`${item.backend} ${'xyzw'[item.lane]} · ${item.geometry.name}`;figure.append(canvas,label);document.querySelector('#draws').append(figure);
}

function mutation(source,fault,geometry){
 if(!fault)return{source,record:null};
 const component={x:'x',y:'y',z:'z',w:'w'}[fault],needle='gl_FragCoord.'+component;
 const replacement={x:'(gl_FragCoord.x + 0.5)',y:`(${geometry.height}.0 - gl_FragCoord.y)`,z:'(gl_FragCoord.z * 2.0 - 1.0)',w:'(1.0 / gl_FragCoord.w)'}[fault];
 require(source.includes(needle),'actual coordinate source fault site');
 const changed=source.replaceAll(needle,replacement);return{source:changed,record:{kind:fault,needle,replacement,original:source,served:changed}};
}

async function directProbe(gl,bridge,item,reference,primary,report,fault){
 const pair=bridge.translatePair({vertexText:PARTNER_VERTEX,fragmentText:item.text});require(pair.ok,'checked coordinate pair');
 require(pair.interfaceKey.endsWith(COORDINATE_KEY),'coordinate selector binding');
 const policy=parseConstantDomain(pair.fragment.metadata,'fragment');require(policy.ok&&policy.coordinates,'coordinate metadata policy');
 require(primary&&primary.glsl.includes('gl_FragCoord'),'original pinned coordinate compilation');
 const source=item.backend==='mesa'?primary.glsl:pair.fragment.glsl,changed=mutation(source,fault,item.geometry);
 const built=createProgram(gl,pair.vertex,{...pair.fragment,glsl:changed.source}),program=built.program;
 const buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer();require(vao&&fb,'coordinate render objects');
 const record={...item,textSha256:await digest(item.text),pair,primary,policy,mutation:changed.record,logs:built.logs,reflection:{attributes:[],uniforms:[]}};report.probes.push(record);
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);record.reflection.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
  for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){const info=gl.getActiveUniform(program,i);require(!/FragCoord/.test(info.name),'builtin cannot be a host uniform');record.reflection.uniforms.push({name:info.name,type:info.type,size:info.size});}
  equal(gl.getFragDataLocation(program,'fsout_c0'),0,'fragment output location');
  for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_ATTRIBUTES);i++){const info=gl.getActiveAttrib(program,i);require(['in_0','in_1'].includes(info.name),'declared attribute reflection');equal([info.type,info.size],[gl.FLOAT_VEC4,1],'attribute vec4');record.reflection.attributes.push({name:info.name,type:info.type,size:info.size});}
  const mesh=gl.createBuffer(),indices=gl.createBuffer();require(mesh&&indices,'coordinate mesh objects');buffers.push(mesh,indices);
  gl.bindBuffer(gl.ARRAY_BUFFER,mesh);const vertices=new Float32Array(item.geometry.vertices.flat());gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
  const at=gl.getAttribLocation(program,'in_0');require(at>=0,'physical coordinate position binding');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,16,0);
  const generic=gl.getAttribLocation(program,'in_1');if(generic>=0){gl.disableVertexAttribArray(generic);gl.vertexAttrib4fv(generic,new Float32Array(item.generic));equal([...gl.getVertexAttrib(generic,gl.CURRENT_VERTEX_ATTRIB)],item.generic,'physical GENERIC neighbor');}
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(item.geometry.indices),gl.STATIC_DRAW);
  const target=texture2d(gl,item.geometry.width,item.geometry.height,null);textures.push(target);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);
  equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'coordinate RGBA8 framebuffer');
  for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST,gl.RASTERIZER_DISCARD,gl.SAMPLE_COVERAGE])gl.disable(cap);
  gl.colorMask(true,true,true,true);gl.viewport(...item.geometry.viewport);gl.depthRange(...item.geometry.depthRange);
  equal([...gl.getParameter(gl.VIEWPORT)],item.geometry.viewport,'physical viewport');equal([...gl.getParameter(gl.DEPTH_RANGE)],item.geometry.depthRange,'physical depth mapping');
  gl.clearColor(17/255,34/255,51/255,68/255);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,item.geometry.indices.length,gl.UNSIGNED_SHORT,0);
  const raw=new Uint8Array(item.geometry.width*item.geometry.height*4);gl.readPixels(0,0,item.geometry.width,item.geometry.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);equal(gl.getError(),gl.NO_ERROR,'physical coordinate draw errors');
  record.rgbaBytes=[...raw];record.sha256=await digest(raw);validatePixels(raw,reference,record);display(raw,item);
 }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);for(const texture of textures)gl.deleteTexture(texture);for(const buffer of buffers)gl.deleteBuffer(buffer);gl.deleteProgram(program);}
}

const packet=(op,type,words)=>{const bytes=new Uint8Array(4+words.length*4),view=new DataView(bytes.buffer);view.setUint32(0,op+type*256+words.length*65536,true);words.forEach((w,i)=>view.setUint32(4+4*i,w,true));return bytes;};
const joined=(...parts)=>{const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;};
function shaderPacket(handle,stage,text){const bytes=packet(1,4,[handle,stage,text.length+1,256,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);bytes.set(new TextEncoder().encode(text),24);return bytes;}
function vertexFor(geometry,generic){
 const v=geometry.vertices[0],words=[0,0,floatWord(v[2]),floatWord(v[3])];
 return ['VERT','DCL IN[0]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]','DCL TEMP[0]',`IMM[0] UINT32 {${words}}`,`IMM[1] UINT32 {${generic.map(floatWord)}}`,'MOV TEMP[0], IMM[0]','MOV TEMP[0].xy, IN[0]','MOV OUT[0], TEMP[0]','MOV OUT[1], IMM[1]','END',''].join('\n');
}
async function consumerProbe(gl,bridge,plan,references,asynchronous,seed,report){
 const ok=(result,label)=>{require(result?.ok===true,label+': '+JSON.stringify(result));return result;};
 const record={asynchronous,commandsPerStep:1+(seed%3),submissions:[],captures:[],pairRequests:[],rejections:[]};report.consumers.push(record);
 const backend=ok(createWebGL2TransferBackend(gl),'real coordinate transfer backend').backend;
 const {store,bindings,asyncAccess}=ok(createResourceStore({backend}),'real coordinate resources');
 const control={fault:null};
 const pairCompiler=request=>{const pair=bridge.translatePair(request);record.pairRequests.push({request,pair,fault:control.fault});
  if(!pair.ok||!control.fault)return pair;
  const changed=structuredClone(pair);if(control.fault==='key')changed.interfaceKey=changed.interfaceKey.replace(COORDINATE_KEY,'');
  if(control.fault==='convention')changed.interfaceKey=changed.interfaceKey.replace('lower-left','upper-left');
  if(control.fault==='fragment')changed.fragment.glsl=changed.fragment.glsl.replace('gl_FragCoord.x','(gl_FragCoord.x + 0.5)');
  if(control.fault==='metadata')changed.fragment.metadata.coordinateContract.pixelCenter='integer';return changed;
 };
 const shaderBridge={translate:request=>bridge.translate(request),translatePair:pairCompiler};
 const renderer=ok((asynchronous?createVirglAsyncRenderer:createVirglDrawRenderer)({gl,resources:store,bindings,shaderBridge,
  ...(asynchronous?{asyncAccess,jobLimits:{commandsPerStep:record.commandsPerStep}}:{})}),'actual indexed coordinate renderer').renderer;
 const submit=async(bytes,label)=>{const entry={label,before:[...bytes],states:[]};record.submissions.push(entry);let result;
  if(!asynchronous){result=renderer.executeSubmission(1,bytes);bytes.fill(0xff);}
  else{entry.begin=renderer.beginSubmission(1,bytes);bytes.fill(0xff);if(!entry.begin.ok)result=entry.begin;else for(let step=0;step<1024;step++){
    const state=ok(renderer.step(entry.begin.job),'coordinate async step');entry.states.push(state);if(state.status==='done'){result=state.result;break;}await new Promise(resolve=>setTimeout(resolve,0));
   }}
  require(result,'bounded coordinate consumer completion');entry.after=[...bytes];entry.result=result;return result;
 };
 const snapshot=()=>ok(renderer.inspect(),'coordinate logical snapshot');
 const transfer=(id,words)=>packet(9,0,[id,0,0,0,0,0,0,0,words.length*4,1,1,...words]);
 const clear=()=>packet(7,0,[4,...[17/255,34/255,51/255,68/255].map(floatWord),0,0,0]);
 const draw=()=>packet(8,0,[0,6,4,1,1,0,0,0,0,0,5,0]);
 const viewport=g=>{const [x,y,w,h]=g.viewport,[near,far]=g.depthRange;return packet(4,0,[0,...[w/2,h/2,(far-near)/2,x+w/2,y+h/2,(far+near)/2].map(floatWord)]);};
 try{
  ok(store.createContext(1),'coordinate resource context');ok(renderer.createContext(1),'coordinate state context');
  for(const [id,bind,width,height]of [[10,16,48,1],[11,32,12,1],[12,2,32,32]]){
   ok(store.createResource({id,target:id===12?2:0,format:id===12?67:64,bind,width,height,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0}),'coordinate retained storage');ok(store.attachContext(1,id),'coordinate storage membership');
  }
  ok(await submit(joined(packet(1,5,[100,0,0,0,29]),packet(2,5,[100]),packet(6,0,[8,0,10]),packet(11,0,[11,2,0]),packet(1,8,[101,12,67,0,0]),packet(5,0,[1,0,101]),packet(1,2,[102,2+(1<<29),floatWord(1),0,0xffff,floatWord(1),0,0,0]),packet(2,2,[102]),transfer(11,[65536,196610,327684])),'indexed resource and raster setup'),'indexed setup');
  // Keep one 32x32 surface while changing the viewport and clip-W program.
  // Predictions for outside each smaller source framebuffer are literal clear bytes.
  const sourceGeometries=geometries(seed),sequence=[sourceGeometries[0],sourceGeometries[1],sourceGeometries[0],sourceGeometries[3]];
  let handle=200;
  for(const geometry of sequence){
   const generic=[.25,.5,.75,1],vertexText=vertexFor(geometry,generic),vertexHandle=handle++;
   ok(await submit(joined(transfer(10,geometry.vertices.flatMap(v=>v.slice(0,2)).map(floatWord)),shaderPacket(vertexHandle,0,vertexText),packet(31,0,[vertexHandle,0]),viewport(geometry)),'viewport and clip program '+geometry.name),'owned coordinate geometry');
   for(const interpolation of ['PERSPECTIVE','CONSTANT'])for(let lane=0;lane<4;lane++){
    const text=bytesFragment(lane,'numeric','xyzw',15,interpolation),fragmentHandle=handle++;
    ok(await submit(joined(shaderPacket(fragmentHandle,1,text),packet(31,0,[fragmentHandle,1]),packet(52,0,[vertexHandle,fragmentHandle,0,0,0,0])),'coordinate interface '+lane+'/'+interpolation),'checked coordinate link');
    // Poison reachable native state before the renderer restores its owned state.
    gl.useProgram(null);gl.viewport(19,17,1,1);gl.depthRange(0,0);gl.colorMask(false,false,false,false);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.enable(gl.RASTERIZER_DISCARD);
    ok(renderer.restoreContext(1),'coordinate restore after native poison');
    equal([...gl.getParameter(gl.VIEWPORT)],geometry.viewport,'consumer restored viewport');equal([...gl.getParameter(gl.DEPTH_RANGE)],geometry.depthRange,'consumer restored depth range');equal(gl.isEnabled(gl.SCISSOR_TEST),false,'consumer restored scissor');equal(gl.isEnabled(gl.RASTERIZER_DISCARD),false,'consumer restored rasterization');
    const result=ok(await submit(joined(clear(),draw()),'indexed coordinate draw'),'actual coordinate indexed draw');equal(result.draws.length,1,'one actual indexed coordinate draw');equal(result.draws[0].actualMaxIndex,5,'real u16 index storage');
    const state=snapshot(),sub=state.contexts[0].subContexts[0],program=sub.programs.find(p=>p.vertexHandle===vertexHandle&&p.fragmentHandle===fragmentHandle);require(program&&program.interfaceKey.endsWith(COORDINATE_KEY),'consumer binds coordinate convention into cached selector');
    const raw=new Uint8Array(32*32*4);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,raw);equal(gl.getError(),gl.NO_ERROR,'consumer physical readback');
    const at=plan.findIndex(p=>p.backend==='owned'&&p.geometry.name===geometry.name&&p.variant==='numeric'&&p.lane===lane),reference=references[at];require(at>=0,'predetermined consumer geometry');
    const points=Array.from({length:32*32},(_,i)=>{const x=i%32,y=Math.floor(i/32);return x<geometry.width&&y<geometry.height?reference.points[y*geometry.width+x]:{x,y,written:false,rgba:[17,34,51,68]};});
    const capture={geometry,variant:'numeric',lane,backend:'indexed-'+(asynchronous?'async':'sync'),interpolation,vertexText,fragmentText:text,result,state,program,rgbaBytes:[...raw],sha256:await digest(raw)};record.captures.push(capture);validatePixels(raw,{geometry:{width:32,height:32},points},capture);
    // Drop old public names; cache retention and generation keys remain owned.
    ok(await submit(packet(3,4,[fragmentHandle]),'drop coordinate fragment name'),'fragment name disposal');
   }
   // A fresh unselected object prevents a cache hit from concealing a forged pair.
   const fragmentHandle=handle++,text=bytesFragment(0,'direct');ok(await submit(shaderPacket(fragmentHandle,1,text),'prepare selector attacks'),'selector attack object');
   for(const fault of ['key','convention','fragment','metadata','missing']){
    control.fault=fault;shaderBridge.translatePair=fault==='missing'?undefined:pairCompiler;const before=snapshot(),events=report.events.length;
    const result=await submit(packet(52,0,[vertexHandle,fragmentHandle,0,0,0,0]),'forged coordinate '+fault);equal(result.ok,false,'selector fault rejects');equal(result.appliedCommands,0,'selector rejection atomicity');equal(snapshot(),before,'selector rejection retains owned state');
    const nativeEvents=report.events.slice(events);require(nativeEvents.every(e=>asynchronous&&['fenceSync','deleteSync'].includes(e.call)),'selector rejection precedes shader/program/state effects');record.rejections.push({fault,before,after:snapshot(),result,nativeEvents});
   }
   control.fault=null;shaderBridge.translatePair=pairCompiler;ok(await submit(packet(3,4,[fragmentHandle]),'drop attack fragment'),'attack name disposal');
   ok(await submit(packet(3,4,[vertexHandle]),'drop coordinate vertex name'),'vertex name disposal');
  }
  for(const [label,words]of [['integer-center',[103,2,floatWord(1),0,0xffff,floatWord(1),0,0,0]],['multisample',[103,2+(1<<29)+(1<<25),floatWord(1),0,0xffff,floatWord(1),0,0,0]]]){
   const before=snapshot(),events=report.events.length,result=await submit(packet(1,2,words),label);equal(result.ok,false,'incompatible coordinate raster rejects');equal(result.appliedCommands,0,'raster atomic rejection');equal(snapshot(),before,'raster rejection retains owned state');const nativeEvents=report.events.slice(events);require(nativeEvents.every(e=>asynchronous&&['fenceSync','deleteSync'].includes(e.call)),'raster rejection precedes state effects');record.rejections.push({fault:label,result,before,after:snapshot(),nativeEvents});
  }
  const before=ok(store.inspect(),'surface admission snapshot');for(const patch of [{flags:1},{nrSamples:4}]){const result=store.createResource({id:13,target:2,format:67,bind:2,width:32,height:32,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0,...patch});equal(result.ok,false,'coordinate surface convention rejects');equal(ok(store.inspect(),'rejected surface snapshot'),before,'surface rejection is atomic');record.rejections.push({fault:JSON.stringify(patch),result});}
 }finally{ok(renderer.dispose(),'coordinate renderer disposal');record.finalBudgets=snapshot().budgets;require(Object.values(record.finalBudgets).every(v=>v===0),'zero coordinate renderer budgets');ok(store.dispose(),'coordinate resource disposal');record.finalResourceBudgets=ok(store.inspect(),'coordinate resources disposed').budgets;require(Object.values(record.finalResourceBudgets).every(v=>v===0),'zero coordinate resource budgets');gl.useProgram(null);}
}

export async function runAcceptance({seed=SEEDS[0],fault=null}={}){
 const report={schema:'virgl-fragment-coordinate-gpu-v1',status:'running',guestExecution:false,productionNegotiation:false,seed,fault,probes:[],consumers:[],events:[]};window.__virglFragmentCoordinatesReport=report;
 const canvas=document.querySelector('#gpu');canvas.width=canvas.height=32;const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(native instanceof WebGL2RenderingContext,'actual WebGL2');
 const debug=native.getExtension('WEBGL_debug_renderer_info');require(debug,'physical renderer identity');report.renderer={vendor:native.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:native.getParameter(debug.UNMASKED_RENDERER_WEBGL),version:native.getParameter(native.VERSION)};require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer.renderer),'physical GPU');const watched=monitor(native,report),gl=watched.gl;
 try{
  const bridge=await createVirglShaderBridge();
  const load=async(path,key)=>{const response=await fetch('/'+path);require(response.ok,'recorded reference '+path);const bytes=new Uint8Array(await response.arrayBuffer());report[key]={path,bytes:bytes.length,sha256:await digest(bytes)};return JSON.parse(new TextDecoder().decode(bytes));};
  const primary=await load('renderer/virgl-shader/build/coordinate-primary.json','primaryFile'),reference=await load(`renderer/virgl-shader/build/coordinate-reference-${seed}.json`,'referenceFile');
  const plan=physicalPlan(seed);equal(reference.seed,seed,'predetermined seed');equal(reference.rows.length,plan.length,'pre-observation prediction coverage');equal(await digest(JSON.stringify(plan)),reference.planSha256,'source-derived geometry plan');report.planSha256=reference.planSha256;
  let injected=false;
  for(let index=0;index<plan.length;index++){
   const item=plan[index],prediction=reference.rows[index],witness=primary.find(p=>p.text===item.text);require(witness,'pinned TGSI source witness');equal(await digest(item.text),prediction.textSha256,'literal prediction input');equal(item.geometry,prediction.geometry,'literal prediction geometry');
   const inject=!injected&&fault&&item.backend==='owned'&&item.variant==='direct'&&item.lane==='xyzw'.indexOf(fault)&&item.geometry.name===(fault==='w'?'offset-even':'full-odd');if(inject)injected=true;
   await directProbe(gl,bridge,item,prediction,witness.primary,report,inject?fault:null);
  }
  for(const asynchronous of [false,true])await consumerProbe(gl,bridge,plan,reference.rows,asynchronous,seed,report);
  require(!fault,'coordinate source fault must fail independent pixel oracle');
  report.directPixels=report.probes.reduce((n,p)=>n+p.checkedPixels,0);report.consumerPixels=report.consumers.reduce((n,c)=>n+c.captures.reduce((n,p)=>n+p.checkedPixels,0),0);report.checkedPixels=report.directPixels+report.consumerPixels;report.status='passed';document.querySelector('#status').textContent=`${report.checkedPixels} coordinate pixels · all four builtin components`;document.querySelector('#renderer').textContent=report.renderer.renderer;
 }catch(error){report.status='failed';report.failure={message:error.message};throw error;}finally{watched.finish();equal(gl.getError(),gl.NO_ERROR,'final physical coordinate errors');}return report;
}
