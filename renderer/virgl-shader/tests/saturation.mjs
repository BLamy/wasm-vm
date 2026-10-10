import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,texture2d,bindSystemBlocks,digest} from './browser.mjs';
import {createResourceStore,createWebGL2TransferBackend} from '../../virgl-command/resources.mjs';
import {createVirglStateRenderer,createVirglAsyncRenderer} from '../../virgl-command/state.mjs';
import {OPS,SEEDS,carrier,bitplane,selectedWords,selectedOracles,PARTNER_VERTEX,PARTNER_FRAGMENT} from '../../../tools/virgl-saturation/cases.mjs';
import {physicalPlan,faultWitness} from '../../../tools/virgl-saturation/plan.mjs';
const require=(v,label)=>{if(!v)throw new Error(label);};
const equal=(a,b,label)=>require(JSON.stringify(a)===JSON.stringify(b),label+': '+JSON.stringify(a)+' != '+JSON.stringify(b));
const word=value=>new Uint32Array(new Float32Array([value]).buffer)[0],WIDTH=4;
function monitor(native,report){const live=new Map(),objects=[],ids=new WeakMap();let serial=0;
  const kinds={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createFramebuffer:'Framebuffer',createVertexArray:'VertexArray',createTransformFeedback:'TransformFeedback',createSampler:'Sampler',fenceSync:'Sync'};
  const gl=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
    return(...args)=>{const result=value.apply(target,args);
      if(kinds[key]&&result){const id=kinds[key]+':'+(++serial);ids.set(result,id);live.set(id,kinds[key]);objects.push({id,kind:kinds[key],object:result});report.events.push({call:key,id});}
      if(/^delete/.test(key)&&args[0]){live.delete(ids.get(args[0]));report.events.push({call:key,id:ids.get(args[0])});}
      if(['compileShader','linkProgram'].includes(key))report.events.push({call:key,id:ids.get(args[0]),status:key==='compileShader'?target.getShaderParameter(args[0],target.COMPILE_STATUS):target.getProgramParameter(args[0],target.LINK_STATUS)});
      if(key==='shaderSource')report.events.push({call:key,id:ids.get(args[0]),source:args[1]});
      if(key==='uniform4uiv')report.events.push({call:key,words:[...args[1]]});
      return result;
    };}});
  return{gl,finish(){equal(live.size,0,'all scalar GL objects disposed');for(const entry of objects)equal(native['is'+entry.kind](entry.object),false,'physical deletion '+entry.id);report.objects={created:objects.length,live:live.size};}};
}
function positions(seed){let state=seed;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  return Array.from({length:2},()=>[(next()%191-95)/128,(next()%191-95)/128,.125,1]);
}
// Both normal finite carriers reveal all 32 result bits. The oracle uses signed
// BigInt source arithmetic; it never recovers predictions from compiled GLSL.
const carriers=words=>[...words.map(w=>((w&0x007fffff)|0x3f000000)>>>0),...words.map(w=>((w>>>23)|0x3f000000)>>>0)];
const choices=(backend,oracles)=>oracles.map(v=>backend==='mesa'&&(v.center&0x7fffffff)===0?[...new Set([...v.allowed,0,0x80000000])]:v.allowed);
function faultPair(pair,kind){const result=JSON.parse(JSON.stringify(pair));if(!kind)return{result,mutation:null};
 const original=result.vertex.glsl,changes={
  lower:['return value < 0.0 ? 0.0 : value > 1.0 ? 1.0 : value;','return value > 1.0 ? 1.0 : value;'],
  upper:['return value < 0.0 ? 0.0 : value > 1.0 ? 1.0 : value;','return value < 0.0 ? 0.0 : value;'],
  order:['/* saturation:division */ return a / b;','/* saturation:division */ return raw_saturate_lane(a) / b;']};
 const [needle,replacement]=changes[kind];require(original.includes(needle),'saturation fault reaches emitted equation');result.vertex.glsl=original.replace(needle,replacement);
 return{result,mutation:{kind,stage:'vertex',needle,replacement,original,served:result.vertex.glsl}};
}
function constantBinding(gl,program,result){
  if(!result.metadata.uniforms.length)return null;
  equal(result.metadata.uniforms.length,1,'one raw scalar bank');const md=result.metadata.uniforms[0];
  equal([md.type,md.encoding],['uvec4[]','float32-bits'],'existing raw uniform ABI');
  const name=md.name+'[0]',location=gl.getUniformLocation(program,name),index=gl.getUniformIndices(program,[name])[0];
  require(location&&index!==gl.INVALID_INDEX,'physical bank reflection');
  const type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0],count=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0];
  equal(type,gl.UNSIGNED_INT_VEC4,'physical exact word bank');require(count>=1&&count<=md.count,'physical count extent');
  return{name:md.name,location,record:{name,index,type,count,declaredCount:md.count}};
}
function upload(gl,program,binding,vector,condition){
  if(!binding)return null;const words=Array(Math.min(binding.record.declaredCount,46)*4).fill(0);
  words.splice(0,4,...vector.a);words.splice(180,4,...vector.b);words[172]=condition;
  // Upload one owned snapshot; mutation of caller storage cannot change it.
  const caller=words.slice(),owned=new Uint32Array(caller);caller.fill(0xdeadbeef);
  gl.uniform4uiv(binding.location,owned.subarray(0,binding.record.count*4));
  const a=[...gl.getUniform(program,binding.location)],bAt=gl.getUniformLocation(program,binding.name+'[45]'),b=bAt?[...gl.getUniform(program,bAt)]:null;
  equal(a,vector.a,'physical scalar A');if(b)equal(b,vector.b,'physical scalar B');
  const at=gl.getUniformLocation(program,binding.name+'[43]');const observedCondition=at?[...gl.getUniform(program,at)]:null;
  if(at)equal(observedCondition[0],condition,'physical scalar predecessor');
  return{words:[...owned],callerAfter:caller,observedA:a,observedB:b,observedCondition};
}
async function vertexProbe(gl,bridge,{op,variant='direct',bank=false,inputs,backend='owned',primary,predicate=false,modifier='',inputSource=false,textInput=inputs[0],textOverride=null,capture=null},values,report,fault){
  const text=textOverride??carrier(op,textInput,variant,bank,modifier,inputSource),pair=bridge.translatePair({vertexText:text,fragmentText:PARTNER_FRAGMENT});require(pair.ok,'scalar carrier pair '+op+'/'+variant);
  const base=backend==='mesa'?{...pair,vertex:{...pair.vertex,glsl:primary.glsl}}:pair;
  const changed=faultPair(base,fault),built=createProgram(gl,changed.result.vertex,changed.result.fragment),program=built.program,buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();require(vao&&feedback&&output,'scalar feedback objects');buffers.push(output);
  const record={op,variant,bank,backend,predicate,modifier,inputSource,capture,text,textSha256:await digest(text),pair,primary:primary??null,mutation:changed.mutation,logs:built.logs,reflection:[],vectors:[]};report.vertices.push(record);
  try{const varyings=['gl_Position','vso_g0','vso_g1'];gl.transformFeedbackVaryings(program,varyings,gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);require(gl.getProgramParameter(program,gl.LINK_STATUS),'scalar feedback link');
    for(let i=0;i<3;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.type,info.size],[varyings[i],gl.FLOAT_VEC4,1],'physical scalar feedback reflection');record.reflection.push({name:info.name,type:info.type,size:info.size});}
    gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);const at=gl.getAttribLocation(program,'in_0');require(at>=0,'physical scalar position');gl.disableVertexAttribArray(at);
    const binding=constantBinding(gl,program,pair.vertex);record.uniformReflection=binding?.record??null;
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,48,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);
    for(const input of inputs)for(const condition of variant==='join'?[0,0xffffffff]:[0]){
      let inputWords=null;if(inputSource){const at1=gl.getAttribLocation(program,'in_1');require(at1>=0,'actual scalar input source');gl.disableVertexAttribArray(at1);gl.vertexAttrib4fv(at1,new Float32Array(new Uint32Array(input.a).buffer));inputWords=[...gl.getVertexAttrib(at1,gl.CURRENT_VERTEX_ATTRIB)].map(word);equal(inputWords,input.a,'actual source attribute encodings');}
      const bankUpload=upload(gl,program,binding,input,condition),selected=selectedWords(op,input,variant,condition,modifier),wanted=predicate?selected.map(w=>w?0x3f800000:0):selected;
      for(const position of values){gl.vertexAttrib4fv(at,new Float32Array(position));const attributes=[...gl.getVertexAttrib(at,gl.CURRENT_VERTEX_ATTRIB)].map(word);equal(attributes,position.map(word),'physical position words');
        const expectedWords=[...position.map(word),...carriers(wanted)],entry={input,condition,position,attributeWords:attributes,inputWords,bankUpload,selectedWords:wanted,expectedWords};record.vectors.push(entry);
        gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const raw=new Uint8Array(48);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,raw);equal(gl.getError(),gl.NO_ERROR,'scalar feedback GL errors');entry.bytes=[...raw];entry.sha256=await digest(raw);entry.observed=[...new Uint32Array(raw.buffer)];
        entry.oracles=selectedOracles(op,input,variant,condition,modifier);entry.allowedResults=choices(backend,entry.oracles);
        entry.allowedWords=expectedWords.map((w,lane)=>lane<4?[w]:[...new Set(entry.allowedResults[(lane-4)%4].map(result=>lane<8?((result&0x7fffff)|0x3f000000)>>>0:((result>>>23)|0x3f000000)>>>0))]);
        for(let lane=0;lane<12;lane++)if(!entry.allowedWords[lane].includes(entry.observed[lane])){entry.failure={lane,expected:expectedWords[lane],allowed:entry.allowedWords[lane],actual:entry.observed[lane]};throw new Error('independent saturation word mismatch '+op+'/'+variant+'/'+backend+'/'+input.name);}
        entry.reconstructed=wanted.map((_,lane)=>(((entry.observed[8+lane]&0x1ff)<<23)|(entry.observed[4+lane]&0x7fffff))>>>0);
        require(entry.reconstructed.every((w,lane)=>entry.allowedResults[lane].includes(w)),'all32 numerical clamp words within independent equation/budget');entry.checkedWords=12;
      }
    }
  }finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);}
}
async function fragmentProbe(gl,bridge,op,input,plane,report,primary){
  const predicate=false,text=bitplane(op,input,plane,false,predicate),pair=bridge.translatePair({vertexText:PARTNER_VERTEX,fragmentText:text});require(pair.ok,'scalar bit-plane pair');
  const backend=primary?'mesa':'owned',fragment=primary?{...pair.fragment,glsl:primary.glsl}:pair.fragment;
  const built=createProgram(gl,pair.vertex,fragment),program=built.program,buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer();require(vao&&fb,'scalar fragment objects');
  const selected=selectedWords(op,input),wanted=selected,expectedBytes=wanted.map(w=>((w>>>plane)&1)*255),oracles=selectedOracles(op,input),allowedResults=choices(backend,oracles),allowedBytes=allowedResults.map(ws=>[...new Set(ws.map(w=>((w>>>plane)&1)*255))]);
  const record={op,input,plane,backend,predicate,text,textSha256:await digest(text),pair,primary:primary??null,logs:built.logs,selectedWords:wanted,expectedBytes,oracles,allowedResults,allowedBytes,checkedPixels:0};report.fragments.push(record);
  try{gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.vertex.metadata,buffers);
    const mesh=gl.createBuffer();require(mesh,'scalar mesh');buffers.push(mesh);gl.bindBuffer(gl.ARRAY_BUFFER,mesh);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1]),gl.STATIC_DRAW);const at=gl.getAttribLocation(program,'in_0');require(at>=0,'scalar position binding');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,16,0);
    const target=texture2d(gl,WIDTH,WIDTH,null);textures.push(target);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'scalar RGBA8 framebuffer');for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(cap);gl.viewport(0,0,WIDTH,WIDTH);gl.colorMask(true,true,true,true);
    gl.clearColor(.1,.2,.3,.4);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);const raw=new Uint8Array(WIDTH*WIDTH*4);gl.readPixels(0,0,WIDTH,WIDTH,gl.RGBA,gl.UNSIGNED_BYTE,raw);equal(gl.getError(),gl.NO_ERROR,'scalar physical pixels');record.rgbaBytes=[...raw];record.sha256=await digest(raw);
    for(let pixel=0;pixel<WIDTH*WIDTH;pixel++){const actual=[...raw.slice(pixel*4,pixel*4+4)];if(actual.some((v,lane)=>!allowedBytes[lane].includes(v))){record.failure={pixel,expected:expectedBytes,allowed:allowedBytes,actual};throw new Error('independent saturation pixel mismatch '+op+'/'+input.name+'/'+backend);}record.checkedPixels++;}
  }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);for(const t of textures)gl.deleteTexture(t);for(const b of buffers)gl.deleteBuffer(b);gl.deleteProgram(program);}
}
const packet=(op,type,words)=>{const bytes=new Uint8Array(4+words.length*4),view=new DataView(bytes.buffer);view.setUint32(0,op+type*256+words.length*65536,true);words.forEach((w,i)=>view.setUint32(4+4*i,w,true));return bytes;};
const joined=(...parts)=>{const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;};
function shaderPacket(handle,stage,text){const bytes=packet(1,4,[handle,stage,text.length+1,256,0,...Array(Math.ceil((text.length+1)/4)).fill(0)]);bytes.set(new TextEncoder().encode(text),24);return bytes;}
async function consumerProbe(gl,bridge,op,asynchronous,report){
  const ok=(result,label)=>{require(result?.ok===true,label+': '+JSON.stringify(result));return result;};
  const record={op,asynchronous,submissions:[],captures:[]};report.consumers.push(record);
  const {store,bindings,asyncAccess}=ok(createResourceStore({backend:ok(createWebGL2TransferBackend(gl),'real transfer backend').backend}),'real resource store');
  const renderer=ok((asynchronous?createVirglAsyncRenderer:createVirglStateRenderer)({gl,resources:store,bindings,shaderBridge:bridge,
    ...(asynchronous?{asyncAccess,jobLimits:{commandsPerStep:1}}:{})}),'real state consumer').renderer;
  const id=1;
  const submit=async(bytes,label)=>{const before=[...bytes],entry={label,before,states:[]};record.submissions.push(entry);let result;
    if(!asynchronous){result=renderer.executeSubmission(id,bytes);bytes.fill(0xff);}
    else{const begun=renderer.beginSubmission(id,bytes);entry.begin=begun;bytes.fill(0xff);
      if(!begun.ok)result=begun;else for(let step=0;step<128;step++){const state=ok(renderer.step(begun.job),'owned consumer step');entry.states.push(state);if(state.status==='done'){result=state.result;break;}await new Promise(resolve=>setTimeout(resolve,0));}
    }
    require(result,'bounded consumer completion');entry.after=[...bytes];entry.result=result;return result;
  };
  const snapshot=()=>ok(renderer.inspect(),'actual consumer snapshot');
  const bank=v=>{const words=Array(184).fill(0);words.splice(0,4,...v.a);words.splice(180,4,...v.b);return words;};
  const inputs=[{name:'A',a:[0x80000000,0xbf000000,0xc0000000,0x3f000000],b:[0x3f800000,0xbf800000,0,0x40000000],d:Array(4).fill(0x3f800000)},
    {name:'B',a:[0x40000000,0,0xbf800000,0x80000000],b:[0xc0000000,0x3f000000,0xbf000000,0],d:Array(4).fill(0x3f800000)}];
  const inspectBanks=words=>{const state=snapshot(),sub=state.contexts[0].subContexts[0],program=gl.getParameter(gl.CURRENT_PROGRAM);require(program,'actual selected consumer program');
    equal(sub.bindings.constants,[words,words],'real decoder/consumer owns exact banks');
    const native=[];for(const name of ['vsconst0','fsconst0'])for(const index of [0,45]){const location=gl.getUniformLocation(program,`${name}[${index}]`);if(!location)continue;const observed=[...gl.getUniform(program,location)];equal(observed,words.slice(index*4,index*4+4),'consumer physical owned words');native.push({name,index,words:observed});}
    record.captures.push({snapshot:state,native});
  };
  try{
    ok(store.createContext(id),'real resource context');ok(renderer.createContext(id),'real shader context');
    const vertexText=carrier(op,inputs[0],'direct',true),fragmentText=bitplane(op,inputs[0],31,true);
    record.sources={vertexText,fragmentText};
    ok(await submit(joined(shaderPacket(1,0,vertexText),shaderPacket(2,1,fragmentText),packet(31,0,[1,0]),packet(31,0,[2,1]),packet(52,0,[1,2,0,0,0,0])),'create/link actual scalar shaders'),'owned shader/link submission');
    for(const input of [...inputs,inputs[0]]){const words=bank(input);ok(await submit(joined(packet(12,0,[0,0,...words]),packet(12,0,[1,0,...words])),'replace '+input.name),'real scalar bank replacement');inspectBanks(words);
      ok(renderer.restoreContext(id),'real restored context');inspectBanks(words);
    }
    const before=snapshot(),events=report.events.length,poison=bank(inputs[0]);poison[0]=0x7fffffff;
    const rejected=await submit(packet(12,0,[0,0,...poison]),'existing nonfinite wire rejection');equal(rejected.ok,false,'wire rejects nonfinite encoding');equal(rejected.appliedCommands,0,'atomic rejected bank');equal(snapshot(),before,'rejected bank preserves state');equal(report.events.length,events,'rejected bank has no native writes');record.rejection={before,after:snapshot(),result:rejected};
  }finally{ok(renderer.dispose(),'real renderer disposal');record.finalBudgets=snapshot().budgets;require(Object.values(record.finalBudgets).every(x=>x===0),'zero renderer budgets');ok(store.dispose(),'real resource disposal');record.finalResourceBudgets=ok(store.inspect(),'disposed resources').budgets;require(Object.values(record.finalResourceBudgets).every(x=>x===0),'zero resource budgets');gl.useProgram(null);}
}
export async function runAcceptance({seed=SEEDS[0],fault=null,stateModule=null}={}){
  const report={schema:'virgl-saturation-gpu-v1',status:'running',guestExecution:false,productionNegotiation:false,seed,fault,vertices:[],fragments:[],consumers:[],bankDraws:[],events:[]};window.__virglSaturationReport=report;
  const canvas=document.querySelector('#gpu');canvas.width=canvas.height=WIDTH;const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(native instanceof WebGL2RenderingContext,'actual WebGL2');const debug=native.getExtension('WEBGL_debug_renderer_info');require(debug,'physical renderer identity');report.renderer={vendor:native.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:native.getParameter(debug.UNMASKED_RENDERER_WEBGL),version:native.getParameter(native.VERSION)};require(!/swiftshader|llvmpipe|softpipe|software/i.test(report.renderer.renderer),'physical GPU');const watched=monitor(native,report),gl=watched.gl;
  try{const bridge=await createVirglShaderBridge(),response=await fetch('/renderer/virgl-shader/build/saturation-primary.json');require(response.ok,'actual pinned primary fixture');
    const bytes=new Uint8Array(await response.arrayBuffer());report.primaryFile={path:'renderer/virgl-shader/build/saturation-primary.json',bytes:bytes.length,sha256:await digest(bytes)};
    const primary=new Map(JSON.parse(new TextDecoder().decode(bytes)).map(x=>[x.name,x]));const values=positions(seed);
    const schedule=physicalPlan(seed,[...primary.values()]);report.planSha256=await digest(JSON.stringify(schedule));
    let injected=false;
    for(const item of schedule.vertices){
      const inputs=[...new Map(item.vectors.map(v=>[JSON.stringify(v.input),v.input])).values()];
      const witness=item.backend==='mesa'?[...primary.values()].find(p=>p.text===item.text):null;
      require(item.backend!=='mesa'||witness,'predeclared actual primary source');
      const corrupt=!injected&&fault&&faultWitness(item,fault);if(corrupt)injected=true;
      await vertexProbe(gl,bridge,{...item,inputs,primary:witness?.primary},values,report,corrupt?fault:null);
      equal(report.vertices.at(-1).text,item.text,'predeclared vertex source');
    }
    for(const item of schedule.fragments){const witness=item.backend==='mesa'?[...primary.values()].find(p=>p.text===item.text):null;
      require(item.backend!=='mesa'||witness,'predeclared primary fragment');await fragmentProbe(gl,bridge,item.op,item.input,item.plane,report,witness?.primary);
    }
    for(const op of ['MOV_SAT','DIV_SAT'])for(const asynchronous of [false,true])await consumerProbe(gl,bridge,op,asynchronous,report);
    require(!fault,'scalar source fault must fail independent oracle');report.checkedWords=report.vertices.reduce((n,v)=>n+v.vectors.reduce((n,x)=>n+x.checkedWords,0),0);report.checkedPixels=report.fragments.reduce((n,f)=>n+f.checkedPixels,0);report.status='passed';document.querySelector('#status').textContent=`${report.checkedWords} bounded saturation words · ${report.checkedPixels} pixels · pinned Mesa differential`;document.querySelector('#renderer').textContent=report.renderer.renderer;
  }catch(error){report.status='failed';report.failure={message:error.message};throw error;}finally{watched.finish();equal(gl.getError(),gl.NO_ERROR,'final scalar GL errors');}return report;
}
