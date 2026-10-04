import {createVirglShaderBridge} from '../index.mjs';
import {createProgram,texture2d,bindSystemBlocks,digest} from './browser.mjs';
import {parseConstantDomain,checkFiniteBank,checkIndirectBank,checkLoopBank,checkRadialBank,checkRasterBank} from '../../virgl-command/constant-domain.mjs';
import {word,number,ulp,vertexVectors,vertexExpected,fragmentVectors,TEXELS} from '../../../tools/virgl-original-corpus/oracle.mjs';
const require=(value,label)=>{if(!value)throw new Error(label);},equal=(a,b,label)=>require(JSON.stringify(a)===JSON.stringify(b),label+' expected '+JSON.stringify(b)+' observed '+JSON.stringify(a));
const clone=x=>JSON.parse(JSON.stringify(x)),WIDTH=32;
export function pairMetadata(v,f){const metadata=clone(v.metadata);for(const o of metadata.outputs)for(const i of f.metadata.inputs)if(o.semantic==='GENERIC'&&o.semanticIndex===i.semanticIndex)o.interpolation=i.interpolation;return metadata;}
export function approve(metadata,words,activeCount){
 const parsed=parseConstantDomain(metadata,metadata.stage);require(parsed.ok,'original contract recognized');
 if(parsed.rasterDomain)return checkRasterBank(words,parsed.rasterDomain,!!parsed.constraint,!!parsed.radialDomain);
 if(parsed.radialDomain)return checkRadialBank(words,parsed.domain.count,!!parsed.constraint);
 if(parsed.constraint)return checkLoopBank(words,parsed.domain.count);
 if(parsed.access)return checkIndirectBank(words,parsed.access.count,!!parsed.domain);
 if(parsed.domain)return checkFiniteBank(words,activeCount);
 return{ok:true,words:words.slice(0,activeCount*4)};
}
function watch(native,report){
 let serial=0;const ids=new WeakMap(),live=new Map(),objects=[],events=report.events;
 const creates={createShader:'Shader',createProgram:'Program',createBuffer:'Buffer',createTexture:'Texture',createVertexArray:'VertexArray',createFramebuffer:'Framebuffer',createTransformFeedback:'TransformFeedback'};
 const gl=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{
  const result=value.apply(target,args);
  if(creates[key]&&result){const id=creates[key]+':'+ ++serial;ids.set(result,id);live.set(id,creates[key]);objects.push({id,kind:creates[key],object:result});events.push({call:key,id});}
  if(/^delete/.test(key)&&args[0]){live.delete(ids.get(args[0]));events.push({call:key,id:ids.get(args[0])});}
  if(key==='shaderSource')events.push({call:key,id:ids.get(args[0]),source:args[1]});
  if(key==='compileShader')events.push({call:key,id:ids.get(args[0]),status:target.getShaderParameter(args[0],target.COMPILE_STATUS),log:target.getShaderInfoLog(args[0])});
  if(key==='linkProgram')events.push({call:key,id:ids.get(args[0]),status:target.getProgramParameter(args[0],target.LINK_STATUS),log:target.getProgramInfoLog(args[0])});
  if(['drawArrays','drawElements','beginTransformFeedback','endTransformFeedback'].includes(key))events.push({call:key,args:[...args]});
  return result;
 };}});
 return{gl,finish(){equal(live.size,0,'all original probe objects deleted');for(const e of objects)equal(native['is'+e.kind](e.object),false,'actual object deleted '+e.id);report.objects={created:objects.length,live:live.size};}};
}
function upload(gl,program,metadata,values,report){
 for(const uniform of metadata.uniforms){
  const location=gl.getUniformLocation(program,uniform.name+'[0]');if(location===null)continue;
  const index=gl.getUniformIndices(program,[uniform.name+'[0]'])[0],type=gl.getActiveUniforms(program,[index],gl.UNIFORM_TYPE)[0],count=gl.getActiveUniforms(program,[index],gl.UNIFORM_SIZE)[0];
  equal(type,gl.UNSIGNED_INT_VEC4,'actual original raw bank type');require(count<=uniform.count,'active bank prefix inside declaration');
  const checked=approve(metadata,values,count);require(checked.ok,'approved original bank '+JSON.stringify(checked));gl.uniform4uiv(location,new Uint32Array(checked.words));
  const observed=[];for(let i=0;i<count;i++)observed.push(...gl.getUniform(program,gl.getUniformLocation(program,uniform.name+'['+i+']')));
  equal(observed,checked.words.slice(0,count*4),'actual original bank readback');report.push({name:uniform.name,declaredCount:uniform.count,activeCount:count,type,words:values.slice(),approved:checked,observed});
 }
}
function attributes(gl,program,metadata,values){
 for(const attribute of metadata.attributes){const location=gl.getAttribLocation(program,attribute.name);if(location<0)continue;gl.disableVertexAttribArray(location);gl.vertexAttrib4fv(location,new Float32Array(values[attribute.index]));}
}
function programFor(gl,pair){return createProgram(gl,pair.result.vertex,pair.result.fragment);}
function originalBy(originals,prefix){const value=originals.find(e=>e.sha256.startsWith(prefix));require(value,'known original '+prefix);return value;}
async function vertexProbe(gl,original,pair,report,seed){
 const {program,logs}=programFor(gl,pair),buffers=[],vao=gl.createVertexArray(),feedback=gl.createTransformFeedback(),output=gl.createBuffer();require(vao&&feedback&&output,'vertex probe objects');buffers.push(output);
 const varying=original.metadata.outputs.find(e=>e.semantic==='GENERIC'),varyings=['gl_Position',...(varying?[varying.name]:[])],components=varying?8:4;
 const record={sha256:original.sha256,pair:[pair.vertex,pair.fragment],logs,varyings,reflection:[],vectors:[]};report.vertices.push(record);
 try{
  gl.transformFeedbackVaryings(program,varyings,gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);require(gl.getProgramParameter(program,gl.LINK_STATUS),'original feedback relink');
  for(let i=0;i<varyings.length;i++){const info=gl.getTransformFeedbackVarying(program,i);equal([info.name,info.type,info.size],[varyings[i],gl.FLOAT_VEC4,1],'actual original output reflection');record.reflection.push({name:info.name,type:info.type,size:info.size});}
  gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.result.vertex.metadata,buffers);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,components*4,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);gl.enable(gl.RASTERIZER_DISCARD);
  for(const vector of vertexVectors(original,seed)){
   const expected=vertexExpected(original,vector),item={vector,expected,uploads:[],observed:null,checks:[]};record.vectors.push(item);
   attributes(gl,program,original.metadata,vector.inputs);upload(gl,program,pair.result.vertex.metadata,vector.constants.flat().map(word),item.uploads);
   gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,1);gl.endTransformFeedback();const raw=new Uint8Array(components*4);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,raw);equal(gl.getError(),gl.NO_ERROR,'original transform feedback readback');
   const actual=[...new Uint32Array(raw.buffer)];item.observed=actual;item.bytes=[...raw];item.sha256=await digest(raw);
   for(let lane=0;lane<components;lane++){
    if(lane>=4&&!(expected.definedGenericMask&(1<<(lane-4))))continue;
    const wanted=lane<4?expected.position[lane]:expected.generic[lane-4],budget=lane<4?expected.positionUlpBudget:expected.genericUlpBudget,distance=ulp(actual[lane],wanted),check={lane,expected:wanted,actual:actual[lane],ulp:distance,budget};item.checks.push(check);
    if(!(Number.isFinite(number(actual[lane]))&&distance<=budget)){item.failure=check;throw new Error('independent original vertex mismatch '+original.sha256+' '+vector.name+' lane '+lane);}
   }
  }
 }finally{gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteTransformFeedback(feedback);gl.deleteVertexArray(vao);for(const buffer of buffers)gl.deleteBuffer(buffer);gl.deleteProgram(program);}
}
function tile(bytes,label){if(document.querySelector('#draws').children.length>=19)return;const canvas=document.createElement('canvas');canvas.width=canvas.height=WIDTH;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),WIDTH,WIDTH),0,0);const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=canvas.toDataURL();img.alt=label;caption.textContent=label;figure.append(img,caption);document.querySelector('#draws').append(figure);}
async function fragmentProbe(gl,original,pair,report){
 const {program,logs}=programFor(gl,pair),buffers=[],textures=[],vao=gl.createVertexArray(),fb=gl.createFramebuffer();require(vao&&fb,'fragment probe objects');
 const record={sha256:original.sha256,pair:[pair.vertex,pair.fragment],logs,draws:[]};report.fragments.push(record);
 try{
  gl.useProgram(program);gl.bindVertexArray(vao);record.systemBlocks=bindSystemBlocks(gl,program,pair.result.vertex.metadata,buffers);
  const positions=gl.createBuffer();require(positions,'original draw geometry');buffers.push(positions);gl.bindBuffer(gl.ARRAY_BUFFER,positions);const mesh=[-1,-1,0,1,1,-1,0,1,-1,1,0,1,-1,1,0,1,1,-1,0,1,1,1,0,1];gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh),gl.STATIC_DRAW);record.geometry=mesh;
  const at=gl.getAttribLocation(program,'in_0');require(at>=0,'original position active');gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,4,gl.FLOAT,false,16,0);
  const target=texture2d(gl,WIDTH,WIDTH,null);textures.push(target);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);equal(gl.checkFramebufferStatus(gl.FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'original RGBA8 target');
  for(const cap of [gl.DITHER,gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.STENCIL_TEST])gl.disable(cap);gl.viewport(0,0,WIDTH,WIDTH);gl.colorMask(true,true,true,true);
  if(original.metadata.samplers.length){gl.activeTexture(gl.TEXTURE0);textures.push(texture2d(gl,2,2,new Uint8Array(TEXELS)));const location=gl.getUniformLocation(program,original.metadata.samplers[0].name);require(location,'original sampler active');gl.uniform1i(location,0);record.texture={width:2,height:2,bytes:TEXELS,filter:'NEAREST',wrap:'CLAMP_TO_EDGE'};}
  for(const vector of fragmentVectors(original)){
   const item={vector,uploads:[],rgbaBytes:[],checkedPixels:0};record.draws.push(item);
   const vertex=originalBy(report.originals,pair.vertex),vid=vertex.sha256.slice(0,8),identity=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],vertexBank=vid==='3f78a90d'?[[1,0,0,0],[0,1,0,0],[0,0,0,0],vector.constants]:vid==='12f6d594'?[...identity,...identity]:[];
   for(const attribute of vertex.metadata.attributes.filter(e=>e.index!==0)){const location=gl.getAttribLocation(program,attribute.name);if(location<0)continue;gl.disableVertexAttribArray(location);gl.vertexAttrib4fv(location,new Float32Array(attribute.index===2?[...vector.uv,0,1]:vid==='12f6d594'?vector.normal:[...vector.uv,0,1]));}
   upload(gl,program,pair.result.vertex.metadata,vertexBank.flat().map(word),item.uploads);
   upload(gl,program,pair.result.fragment.metadata,vector.bank??(vector.constants.length?vector.constants.map(word):[]),item.uploads);
   gl.clearColor(.1,.2,.3,.4);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);const raw=new Uint8Array(WIDTH*WIDTH*4);gl.readPixels(0,0,WIDTH,WIDTH,gl.RGBA,gl.UNSIGNED_BYTE,raw);equal(gl.getError(),gl.NO_ERROR,'actual original fragment readback');item.rgbaBytes=[...raw];item.rgbaSha256=await digest(raw);
   for(let pixel=0;pixel<WIDTH*WIDTH;pixel++){const actual=item.rgbaBytes.slice(pixel*4,pixel*4+4);if(actual.some((x,i)=>Math.abs(x-vector.expected[i])>vector.pixelBudget)){item.failure={x:pixel%WIDTH,y:Math.floor(pixel/WIDTH),expected:vector.expected,observed:actual,budget:vector.pixelBudget};tile(raw,'FAILED '+original.sha256.slice(0,8));throw new Error('independent original fragment mismatch '+original.sha256+' '+vector.name);}item.checkedPixels++;}
   if(record.draws.length===1)tile(raw,original.sha256.slice(0,8));
  }
 }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);gl.useProgram(null);gl.deleteFramebuffer(fb);gl.deleteVertexArray(vao);for(const image of textures)gl.deleteTexture(image);for(const buffer of buffers)gl.deleteBuffer(buffer);gl.deleteProgram(program);}
}
export async function runAcceptance({seed=0x619eca43,faultWasm=null,faultOriginal=null}={}){
 const report={schema:'original-corpus-gpu-v1',status:'running',guestExecution:false,seed,faultWasm,originals:[],pairs:[],vertices:[],fragments:[],migrations:[],events:[]};window.__virglOriginalCorpusReport=report;
 const canvas=document.querySelector('#gpu');canvas.width=canvas.height=WIDTH;const native=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});require(native instanceof WebGL2RenderingContext,'actual WebGL2');
 const debug=native.getExtension('WEBGL_debug_renderer_info');require(debug,'hardware identity');report.renderer={vendor:native.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:native.getParameter(debug.UNMASKED_RENDERER_WEBGL),version:native.getParameter(native.VERSION)};require(!/swiftshader|llvmpipe|softpipe|software|mock|fake/i.test(report.renderer.renderer),'hardware GPU');
 const monitor=watch(native,report),gl=monitor.gl;
 try{
  const response=await fetch('/renderer/virgl-shader/tests/original-corpus.json'),bytes=new Uint8Array(await response.arrayBuffer()),manifest=JSON.parse(new TextDecoder().decode(bytes));report.manifest={path:'renderer/virgl-shader/tests/original-corpus.json',bytes:bytes.length,sha256:await digest(bytes)};
  const options=faultWasm?{wasmBinary:await(await fetch(faultWasm)).arrayBuffer()}:{};if(faultWasm)report.faultWasmSha256=await digest(options.wasmBinary);const bridge=await createVirglShaderBridge(options);
  for(const declared of manifest.originals){const response=await fetch('/'+declared.path),bytes=new Uint8Array(await response.arrayBuffer());equal(await digest(bytes),declared.sha256,'unchanged original source');equal(bytes.length,declared.bytes,'original byte count');const text=new TextDecoder().decode(bytes),result=bridge.translate({stage:declared.stage,text});require(result.ok,'original translation');equal(result.metadata,declared.metadata,'original complete metadata');report.originals.push({...declared,text,result});}
  const vs=report.originals.filter(e=>e.stage==='vertex').sort((a,b)=>a.sha256.localeCompare(b.sha256)),fs=report.originals.filter(e=>e.stage==='fragment').sort((a,b)=>a.sha256.localeCompare(b.sha256));
  for(const v of vs)for(const f of fs){const outputs=new Map(v.metadata.outputs.filter(e=>e.semantic==='GENERIC').map(e=>[e.semanticIndex,e.writtenMask])),compatible=f.metadata.inputs.every(i=>outputs.has(i.semanticIndex)&&(outputs.get(i.semanticIndex)&i.componentMask)===i.componentMask),result=bridge.translatePair({vertexText:v.text,fragmentText:f.text}),record={vertex:v.sha256,fragment:f.sha256,ok:compatible,result};report.pairs.push(record);equal(result.ok,compatible,'literal original pairing');if(compatible){equal(result.vertex.metadata,pairMetadata(v,f),'pair original vertex contracts/interpolation');equal(result.fragment.metadata,f.metadata,'pair original fragment contracts');const compiled=programFor(gl,record);record.logs=compiled.logs;gl.deleteProgram(compiled.program);}}
  equal(report.pairs.filter(e=>e.ok).length,57,'all57 compatible programs physically link');
  const pair=(v,f)=>report.pairs.find(e=>e.vertex.startsWith(v)&&e.fragment.startsWith(f));
  for(const v of vs){if(faultOriginal&&!v.sha256.startsWith(faultOriginal))continue;await vertexProbe(gl,v,pair(v.sha256,'c00de140'),report,seed);}
  if(!faultOriginal){
   const migrations=await(await fetch('/renderer/virgl-shader/tests/captured-grammar-migrations.json')).json(),cases=await(await fetch('/renderer/virgl-shader/tests/captured-invalid.json')).json();
   for(const entry of migrations.migrations){const test=cases.find(e=>e.name===entry.name);equal(await digest(test.text),entry.inputSha256,'literal historical admission source');const fragment=originalBy(report.originals,'c00de140'),result=bridge.translatePair({vertexText:test.text,fragmentText:fragment.text});require(result.ok,'historical admission pair');equal(result.vertex.metadata,entry.metadata,'historical admission metadata');const start=report.vertices.length;
    await vertexProbe(gl,{...entry,sha256:entry.inputSha256,probe:'legacy-identity'},{vertex:entry.inputSha256,fragment:fragment.sha256,result},report,seed);const probe=report.vertices.pop();equal(report.vertices.length,start,'original and historical counts separate');report.migrations.push({entry,text:test.text,result,probe});
   }
  }
  if(!faultOriginal)for(const f of fs){const id=f.sha256.slice(0,8),partner=['00327010','9819066d'].includes(id)?'12f6d594':id==='67c701fa'?'3f78a90d':id==='c00de140'?'0ec6a7a8':'23b5f8a8';await fragmentProbe(gl,f,pair(partner,f.sha256),report);}
  report.checkedVertexWords=report.vertices.reduce((n,v)=>n+v.vectors.reduce((n,x)=>n+x.checks.length,0),0);report.checkedPixels=report.fragments.reduce((n,f)=>n+f.draws.reduce((n,x)=>n+x.checkedPixels,0),0);report.status='passed';document.querySelector('#status').textContent=`19 unchanged shaders · 57 linked pairs · ${report.checkedVertexWords} vertex words · ${report.checkedPixels} pixels`;document.querySelector('#renderer').textContent=report.renderer.renderer;
 }catch(error){report.status='failed';report.failure={name:error.name,message:error.message};throw error;}
 finally{monitor.finish();equal(gl.getError(),gl.NO_ERROR,'final original GPU error');}
 return report;
}
