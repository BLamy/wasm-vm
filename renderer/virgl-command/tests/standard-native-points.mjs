import {decodeSubmission,decodeStandardSubmission} from '../decoder.mjs';
import {parseStandardShaderMetadata} from '../constant-domain.mjs';
import {createVirglStandardAsyncRenderer} from '../state.mjs';
import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks,rig,meta,add,transfer,shader,clear,submit,dispose,packet,join,hex,blob} from './standard-instanced-draws.mjs';
import {pointModel,comparePixels} from '../../../tools/virgl-command/standard-point-oracle.mjs';
const word=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
const tgsi=(stage,decl,body)=>(stage===0?'VERT':'FRAG')+'\n'+decl+'\n'+[...body,'END'].map((x,i)=>i+': '+x+'\n').join('');
export function pointSpec(options={}){
 const s={instances:1,indexed:true,indexSize:2,indexOffset:12,start:5,base:7,enabled:false,restartIndex:61,count:3,
  fixedSize:4,perVertex:true,psize:'x',coord:'input',output:'mixed',negativeY:false,cull:false,scissor:null,clipZ:0,
  divisors:[0,0,0],strides:[16,16,16],offsets:[16,32,16],sourceOffsets:[16,0,16],seed:0x71309a2f,...options};
 const n=Math.max(1,s.instances);s.width=s.width??16*n;s.height=s.height??16;
 s.ids=s.ids??(s.indexed?[s.base,s.base+2,s.maximumVertex?{1:255,2:65535}[s.indexSize]:s.base+5]:Array.from({length:s.count},(_,i)=>s.start+i));
 if(s.enabled&&options.ids===undefined)s.ids=[s.restartIndex,...s.ids.slice(0,2),s.restartIndex,s.ids.at(-1),s.restartIndex];
 if(s.allRestart)s.ids=Array(s.count).fill(s.restartIndex);s.count=s.ids.length;
 const real=s.ids.filter(id=>!s.enabled||id!==s.restartIndex),max=real.length?Math.max(...real):0;s.data=new Map();
 let seed=s.seed>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 for(let slot=0;slot<3;slot++){
  const divisor=s.divisors[slot],last=s.strides[slot]===0?0:divisor?Math.floor((n-1)/divisor):max,prefix=s.offsets[slot]+s.sourceOffsets[slot],raw=new Uint8Array(prefix+last*s.strides[slot]+16-(s.shortSlot===slot?1:0)),v=new DataView(raw.buffer);
  const indexes=s.strides[slot]===0?[0]:divisor?Array.from({length:last+1},(_,i)=>i):[...new Set(real)];
  for(const [ordinal,index]of indexes.entries()){
   const center=s.centers?.[ordinal]??(s.overlap?[8.25,8.25]:[[3.25,4.25],[8.25,9.25],[12.25,5.25]][ordinal%3]);
   const values=slot===0?[Math.fround(center[0]/8-1),Math.fround(center[1]*2/s.height-1),index,1]:
    slot===1?[s.sizes?.[ordinal]??(s.uniformSize??[2,4,5.25][ordinal%3]),0,0,1]:[0,(16+random()%128)/256,(32+random()%64)/256,.5];
   for(let lane=0;lane<4;lane++){const at=prefix+index*s.strides[slot]+lane*4;if(at+4<=raw.length)v.setFloat32(at,values[lane],true);}
  }
  s.data.set(3+slot,raw);
 }
 if(s.indexed||s.keepIndex){const raw=new Uint8Array(s.indexOffset+s.count*s.indexSize-(s.shortIndex?1:0)),v=new DataView(raw.buffer);s.ids.forEach((id,i)=>{const at=s.indexOffset+i*s.indexSize;if(at+s.indexSize<=raw.length){if(s.indexSize===1)v.setUint8(at,id);else if(s.indexSize===2)v.setUint16(at,id,true);else v.setUint32(at,id,true);}});s.data.set(6,raw);}
 const generic=['mixed','generic'].includes(s.output),psize=s.psize!=='none';
 const body=['I2F TEMP[0].x, SV[0].xxxx','MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].yyyy, IMM[0].zzzz',
  'MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx','MOV OUT[0].y, IN[0].yyyy','MOV OUT[0].z, IMM[1].xxxx',
  'I2F TEMP[1].x, SV[1].xxxx','SEQ TEMP[1].x, TEMP[1].xxxx, IN[0].zzzz','MUL OUT[0].w, TEMP[1].xxxx, IN[0].wwww',
  ...(psize?[s.psize==='full'?'MOV OUT[31], IN[1]':'MOV OUT[31].x, IN[1].xxxx']:[]),
  ...(generic?['UMUL TEMP[1].x, SV[1].xxxx, IMM[2].xxxx','AND TEMP[1].x, TEMP[1].xxxx, IMM[2].yyyy','U2F TEMP[1].x, TEMP[1].xxxx','MUL OUT[1].x, TEMP[1].xxxx, IMM[0].wwww',
   'MOV OUT[1].yz, IN[15]','I2F TEMP[0].y, SV[0].xxxx','MAD OUT[1].w, TEMP[0].yyyy, IMM[1].yyyy, IN[15].wwww']:[])];
 s.vertex=tgsi(0,'DCL IN[0]\n'+(psize?'DCL IN[1]\n':'')+(generic?'DCL IN[15]\n':'')+'DCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\nDCL OUT[0], POSITION\n'+
  (generic?'DCL OUT[1], GENERIC[15]\n':'')+(psize?'DCL OUT[31]'+(s.psize==='x'?'.x':'')+', PSIZE\n':'')+'DCL TEMP[0..1]\n'+
  `IMM[0] FLT32 {${Math.fround(1/n)}, ${Math.fround(2/n)}, ${Math.fround(-1+1/n)}, 0.00390625}\nIMM[1] FLT32 {${s.clipZ},0.0625,0.0,1.0}\nIMM[2] UINT32 {17,255,0,0}`,body);
 const input=s.coord==='system'?'SV[0]':'IN[0]',coordDecl=s.output==='generic'?'':s.coord==='alias'?'DCL IN[0], PCOORD, LINEAR\nDCL SV[0], PCOORD\n':s.coord==='system'?'DCL SV[0], PCOORD\n':'DCL IN[0]'+(s.output==='partial'?'.xy':'')+', PCOORD, LINEAR\n';
 const fragmentBody=s.output==='generic'?['MOV OUT[0], IN[31]']:[...(s.coord==='alias'?['ADD TEMP[0], IN[0], SV[0]','MUL TEMP[0], TEMP[0], IMM[0]']:[`MOV TEMP[0]${s.output==='partial'?'.xy':''}, ${input}${s.output==='partial'?'.xyyy':''}`]),
  ...(s.output==='mixed'?['MOV OUT[0].x, IN[31].xxxx','MOV OUT[0].yz, TEMP[0].yyxx','MUL OUT[0].w, TEMP[0].wwww, IN[31].wwww']:
    s.output==='partial'?['MOV OUT[0], IMM[1]','MOV OUT[0].xy, TEMP[0].yxxx']:[`MOV OUT[0], TEMP[0]${s.output==='swizzle'?'.yxwz':s.output==='zw'?'.zwzw':''}`])];
 s.fragment=tgsi(1,coordDecl+(generic?'DCL IN[31], GENERIC[15], CONSTANT\n':'')+'DCL OUT[0], COLOR\n'+(s.output!=='generic'?'DCL TEMP[0]\n':'')+
  (s.coord==='alias'?'IMM[0] FLT32 {0.5,0.5,0.5,0.5}\n':'')+(s.output==='partial'?'IMM[0] FLT32 {0.5,0.5,0.5,0.5}\nIMM[1] FLT32 {0.0,0.0,0.0,1.0}\n':''),fragmentBody);
 return s;
}
export const pointDraw=s=>packet(8,0,[s.indexed?0:s.start,s.count,0,s.indexed?1:0,s.instances,0,0,s.enabled?1:0,s.enabled?s.restartIndex:0,0,0xffffffff,0]);
export function pointSetup(r,s,{create=true}={}){
 r.spec=s;r.bufferBytes=s.data;if(create)for(const [id,raw]of s.data)add(r,meta(id,0,64,id===6?32:16,raw.length),raw);
 const elements=Array.from({length:16},()=>[s.sourceOffsets[0],s.divisors[0],0,31]);elements[1]=[s.sourceOffsets[1],s.divisors[1],1,31];elements[15]=[s.sourceOffsets[2],s.divisors[2],2,31];
 const bits=2|(1<<29)|(s.perVertex?1<<24:0)|(s.scissor?1<<14:0)|(s.cull?2<<8:0)|(s.spriteMode?64:0)|(s.quad?128:0);
 return join(...[...s.data].map(([id,raw])=>transfer(id,raw.length)),shader(1,0,s.vertex),shader(2,1,s.fragment),packet(1,5,[3,...elements.flat()]),packet(2,5,[3]),
  packet(6,0,s.offsets.flatMap((offset,slot)=>[s.strides[slot],offset,3+slot])),...(s.indexed||s.keepIndex?[packet(11,0,[6,s.indexSize,s.indexOffset])]:[]),
  packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),packet(4,0,[0,...[r.width/2,s.negativeY?-r.height/2:r.height/2,.5,r.width/2,r.height/2,.5].map(word)]),
  packet(1,2,[9,bits,word(s.fixedSize),0,65535,word(1),0,0,0]),packet(2,2,[9]),...(s.scissor?[packet(15,0,[0,s.scissor[0]|s.scissor[1]<<16,s.scissor[2]|s.scissor[3]<<16])]:[]),
  packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
export function pointRig(gl,bridge,c,s,options={}){
 let r;const normalized=[],nativeState=[];
 const factory=config=>{const wrapped=new Proxy(config.gl,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return(...args)=>{
  if(['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(name)){const program=gl.getParameter(gl.CURRENT_PROGRAM),size=gl.getUniformLocation(program,'wv_point_size'),y=gl.getUniformLocation(program,'wv_point_coord_y');nativeState.push({label:r.currentLabel,call:name,pointSize:[...gl.getUniform(program,size)],pointCoordY:y===null?null:gl.getUniform(program,y),viewport:[...gl.getParameter(gl.VIEWPORT)],scissor:[...gl.getParameter(gl.SCISSOR_BOX)],scissorEnabled:gl.isEnabled(gl.SCISSOR_TEST),cullEnabled:gl.isEnabled(gl.CULL_FACE)});}
  if(name==='bufferData'&&args[0]===gl.ELEMENT_ARRAY_BUFFER&&args[1] instanceof Uint32Array)normalized.push({buffer:gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING),nativeBuffer:r.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)),label:r.currentLabel,bytes:args[1].byteLength,deleted:false});
  if(name==='deleteBuffer'){const e=normalized.find(e=>e.buffer===args[0]);if(e){const before=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);gl.bindBuffer(gl.COPY_READ_BUFFER,e.buffer);e.raw=new Uint8Array(e.bytes);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,e.raw);gl.bindBuffer(gl.COPY_READ_BUFFER,before);e.deleted=true;}}
  return value.apply(target,args);
 };}});return createVirglStandardAsyncRenderer({...config,gl:wrapped,primitiveAssembly:'lists'});};
 r=rig(gl,bridge,c,{width:s.width,height:s.height,...options,factory});r.normalized=normalized;r.nativeState=nativeState;r.range=[...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];return r;
}
export async function pointSubmit(r,ctx,bytes,label,onYield=null){r.currentLabel=label;return submit(r,ctx,bytes,label,onYield);}
export async function pointFrame(r,record,{allowError=false}={}){
 const {gl,c}=r;if(!allowError)c.ok(record.result,record.label+' completed original point draw');c.same(record.result.gpuComplete,true,'actual point final completion fence');
 const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const p of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[p],0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
 const pixels=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.deleteFramebuffer(fb);
 const draw=record.result.draws.at(-1),buffers=[],normalized=[],calls=r.trace.calls.filter(a=>a.label===record.label).map(({program,...a})=>a);
 for(const [id,raw]of r.bufferBytes){const generation=id===6?draw.indexResourceGeneration??r.allocations.findLast(a=>a.metadata.id===id).generation:draw.vertexFetches.find(a=>a.resourceId===id)?.resourceGeneration??r.allocations.findLast(a=>a.metadata.id===id).generation,allocation=r.allocations.find(a=>a.metadata.id===id&&a.generation===generation),physical=new Uint8Array(raw.length);
  gl.bindBuffer(gl.COPY_READ_BUFFER,allocation.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,physical);gl.bindBuffer(gl.COPY_READ_BUFFER,null);const saved=await blob(r,physical);c.same(saved.sha256,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))),'physical original point bytes '+id);buffers.push({resourceId:id,generation,nativeBuffer:r.trace.id(allocation.storage.buffer),blob:saved});}
 for(const e of r.normalized.filter(e=>e.label===record.label)){c.same(e.deleted,true,'native point private index retired');normalized.push({nativeBuffer:e.nativeBuffer,bytes:e.bytes,blob:await blob(r,e.raw)});}
 const model=pointModel(r.history,r.bufferBytes,r.range),audit=comparePixels(pixels,model,r.width,r.height),frame={label:record.label,width:r.width,height:r.height,range:r.range,history:r.history.map(h=>({...h})),inputs:r.exchanges.map(e=>({...e})),native:{calls,buffers,normalized,state:r.nativeState.filter(a=>a.label===record.label)},predicted:{ids:model.ids,points:model.points,min:model.min,max:model.max,valid:model.valid,restarts:model.restarts,normalize:model.normalize,fetches:model.fetches,pointUniform:model.pointUniform,winsysY:model.winsysY},audit,pixels:await blob(r,pixels),failedJob:!record.result.ok};
 r.frames.push(frame);c.same(audit.misses,[],record.label+' independent strict point-square pixels');
 const call=calls.at(-1),instanced=model.effective>1;c.same(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''),'actual native point entry');c.same(call.args,model.draw.indexed?[0,model.draw.count,{1:5121,2:5123,4:5125}[model.nativeSize],model.nativeOffset,...(instanced?[model.effective]:[])]:[0,model.draw.start,model.draw.count,...(instanced?[model.effective]:[])],'original native point arguments');
 for(const state of frame.native.state){c.same(state.pointSize,model.pointUniform,'actual typed native point size before draw');if(state.pointCoordY!==null)c.same(state.pointCoordY,model.winsysY,'actual typed coordinate orientation before draw');}
 c.same([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.normalizedIndices,draw.nativeIndexSize,draw.nativeIndexOffset,draw.vertexWork],[model.min,model.max,model.valid,model.restarts,model.normalize,model.nativeSize,model.nativeOffset,model.draw.count*model.effective],'original point bounds, restart and work');
 if(model.normalize)c.same(normalized.find(e=>e.nativeBuffer===call.indexBuffer).blob.sha256,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',model.normalized))),'independently predicted physical normalized point indices');
 for(const f of model.fetches){const a=call.attributes.find(a=>a.name==='in_'+f.attributeIndex),observed=draw.vertexFetches.find(a=>a.attributeIndex===f.attributeIndex),keys=['resourceId','stride','offset','components','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'];c.same(Object.fromEntries(keys.map(k=>[k,observed[k]])),Object.fromEntries(keys.map(k=>[k,f[k]])),'original actual point fetch '+f.attributeIndex);c.same(a.enabled,!f.constant,'native point generic/array selection');c.same(a.divisor,f.nativeDivisor,'actual point divisor');if(f.constant)c.same(a.genericValues,f.genericValues,'native point constant attributes');}
 c.same(gl.getError(),gl.NO_ERROR,'native point draw and full readback');return frame;
}
export function runWireAcceptance(){const c=checks(),records=[];
 const test=(raw,expected,old,label)=>{const standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw);c.same(standard.ok,expected,label+' standard');c.same(legacy.ok,old,label+' legacy');records.push({label,hex:hex(raw),expected,legacyExpected:old,standard,legacy});};
 for(const mode of [0,4,5,7])for(const instances of [0,1,4])test(packet(8,0,[5,3,mode,0,instances,0,0,0,0,0,0xffffffff,0]),mode<=5,instances===1&&[4,5].includes(mode),'point-mode-'+mode+'-'+instances);
 for(const size of [.5,1,2,4,5.25,2048,0,-1,NaN,Infinity])for(const perVertex of [false,true])test(packet(1,2,[9,2|(1<<29)|(perVertex?1<<24:0),word(size),0,65535,word(1),0,0,0]),Number.isFinite(size)&&size>0,size===1&&!perVertex,'point-size-'+size+'-'+perVertex);
 for(const bits of [64,128,64|128,1<<23,1<<25])test(packet(1,2,[9,2|(1<<29)|bits,word(1),0,65535,word(1),0,0,0]),bits<256,bits<256,'point-bits-'+bits);
 test(packet(1,2,[9,2|(1<<29),word(1),1,65535,word(1),0,0,0]),false,false,'generic-coordinate-replacement-gated');return {status:'passed',records,predictions:c.rows};
}
export function runMetadataAcceptance(bridge){const c=checks(),records=[];for(const stage of ['vertex','fragment'])for(const options of stage==='vertex'?[{}]:[{coord:'input'},{coord:'system'},{coord:'alias'},{output:'generic'}]){const s=pointSpec(options),result=c.ok(bridge.translate({stage,text:stage==='vertex'?s.vertex:s.fragment}),'actual point compiler metadata');c.ok(parseStandardShaderMetadata(result.metadata,stage),'typed raster contract');
  const mutations=[['missing',m=>delete m.rasterUniforms],['unknown-type',m=>m.rasterUniforms=[{name:'wv_point_size',type:'vec4',semantic:'POINT_SIZE'}]],['forged-semantic',m=>m.rasterUniforms=[{name:'wv_point_size',type:'vec2',semantic:'COLOR'}]],['extra',m=>m.rasterUniforms.push({name:'x',type:'float',semantic:'POINT_COORD_Y'})]];
  if(result.metadata.rasterUniforms.length)mutations.push(['empty',m=>m.rasterUniforms=[]]);
  for(const [label,change]of mutations){const metadata=structuredClone(result.metadata);change(metadata);const observed=parseStandardShaderMetadata(metadata,stage);c.same(observed.ok,false,'forged '+stage+' '+label);records.push({stage,options,label,metadata,observed});}
 }return {status:'passed',records,predictions:c.rows};}
export async function runAcceptance({smoke=false}={}){
 const c=checks(),report={schema:'virgl-standard-points-v1',status:'running',guestExecution:false,productionNegotiation:false,predictions:c.rows,frames:[],runs:[],blobs:[],rejections:[],suspensions:[],ownership:[]};window.__standardPointEvidence=report;report.wire=runWireAcceptance();
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info');c.same(Boolean(debug),true,'actual GPU identity');report.gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);c.same(/swiftshader|llvmpipe|softpipe|software/i.test(report.gpu),false,'physical point hardware');report.range=[...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];
 const bridge=await createVirglStandardShaderBridge();report.metadata=runMetadataAcceptance(bridge);
 const make=(s,options={})=>{const r=pointRig(gl,bridge,c,s,options);r.frames=report.frames;r.blobs=report.blobs;return r;},done=r=>{const inspection=c.ok(r.renderer.inspect(),'point ownership inspection');for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspection.jobs[key],0,'released point '+key);report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),nativeState:r.nativeState,inspection});dispose(r);};
 const configs=[['per-vertex-input',{}],['per-vertex-system',{coord:'system',psize:'full'}],['physical-input-system-alias',{coord:'alias'}],['fixed-size',{perVertex:false}],['no-PSIZE-default',{psize:'none',perVertex:false,fixedSize:1}],['coordinates-xyzw',{output:'coord'}],['coordinates-swizzle',{output:'swizzle',coord:'system'}],['coordinates-zw-only',{output:'zw',coord:'system'}],['coordinates-partial',{output:'partial'}],['original-generic',{output:'generic'}],
  ['fractional',{uniformSize:5.25}],['minimum-clamp',{uniformSize:.5}],['maximum-clamp',{uniformSize:2048,count:1,ids:[7],centers:[[8.25,8.25]]}],['fixed-maximum-clamp',{perVertex:false,fixedSize:2048,count:1,ids:[7],centers:[[8.25,8.25]]}],['fixed-minimum-clamp',{perVertex:false,fixedSize:.5}],
  ['negative-Y',{negativeY:true}],['negative-Y-system',{negativeY:true,coord:'system'}],['negative-Y-sprite-inert',{negativeY:true,spriteMode:true,quad:true}],['scissor',{scissor:[5,3,11,10],uniformSize:5.25}],['culling-inert',{cull:true}],['overlap-order',{overlap:true}],
  ['arrays-zero-instance',{indexed:false,instances:0}],['arrays-instanced',{indexed:false,instances:4,divisors:[0,2,3]}],['indexed-instanced',{instances:2,divisors:[0,1,2]}],['constant-size-color',{instances:4,strides:[16,0,0],divisors:[0,7,9]}],
  ['byte-custom',{indexSize:1,base:11,enabled:true,restartIndex:17}],['short-custom',{enabled:true}],['wide-custom',{indexSize:4,base:70003,enabled:true,restartIndex:81019}],['fixed-byte',{indexSize:1,base:11,enabled:true,restartIndex:255}],['fixed-short',{enabled:true,restartIndex:65535}],['fixed-wide',{indexSize:4,base:70003,enabled:true,restartIndex:4294967295}],['disabled-byte-max',{indexSize:1,base:11,maximumVertex:true}],['disabled-short-max',{maximumVertex:true}],['out-of-type-marker',{indexSize:1,base:11,maximumVertex:true,enabled:true,restartIndex:65535}],['all-restart-custom',{enabled:true,allRestart:true}],['XY-center-outside',{ids:[7],uniformSize:2048,centers:[[17.25,8.25]]}],['near-center-reject',{clipZ:-1.25,uniformSize:2048}],['far-center-reject',{clipZ:1.25,uniformSize:2048}],['one-point',{ids:[7],uniformSize:4}],['two-points',{ids:[7,9]}]];
 for(const [delay,step]of smoke?[[0,64]]:[[0,64],[2,1],[5,3]])for(const [label,options]of smoke?configs.slice(0,1):configs){const s=pointSpec(options),r=make(s,{delay,step});await pointFrame(r,await pointSubmit(r,1,join(pointSetup(r,s),pointDraw(s)),label+'-'+delay));done(r);}
 if(!smoke){
  for(const options of [{shortSlot:0},{shortSlot:1},{shortIndex:true}]){const s=pointSpec(options),r=make(s),record=await pointSubmit(r,1,join(pointSetup(r,s),pointDraw(s)),'short-'+JSON.stringify(options));c.same(record.result.error.code,'out-of-bounds','one-byte-short point source');c.same(r.trace.calls.length,0,'short point source never draws');report.rejections.push({record});done(r);}
  for(const limit of [6,5]){const s=pointSpec({instances:2}),r=make(s,{drawLimits:{indicesPerSubmission:limit}}),record=await pointSubmit(r,1,join(pointSetup(r,s),pointDraw(s)),'work-'+limit);if(limit===6)await pointFrame(r,record);else{c.same(record.result.error.code,'limit-exceeded','point vertex-instance work limit');c.same(r.trace.calls.length,0,'point work rejects before draw');report.rejections.push({record});}done(r);}
  for(const phase of ['waiting-index','waiting-attributes'])for(const action of ['stale-index','cancel','reuse']){const s=pointSpec({enabled:true,...(phase==='waiting-attributes'?{strides:[16,0,16]}:{})}),r=make(s,{delay:7,step:1});c.ok((await pointSubmit(r,1,pointSetup(r,s),'pending-setup-'+action)).result,'point pending setup');const oldGeneration=r.allocations.find(a=>a.metadata.id===6).generation;let fired=false,point,newGeneration;
   const record=await pointSubmit(r,1,join(clear([0,0,0,0]),pointDraw(s)),'pending-'+action,(_step,token)=>{const inspection=r.renderer.inspect();if(fired||inspection.jobs.status!==phase)return;fired=true;point={inspection,events:r.trace.events.map(a=>({...a}))};
    if(action==='cancel')c.ok(r.renderer.cancel(token),'cancel point read');else if(action==='reuse'){c.ok(r.store.unref(6),'retire point index name');newGeneration=add(r,meta(6,0,64,32,s.data.get(6).length),new Uint8Array(s.data.get(6).length)).generation;}else{const bytes=s.data.get(6).slice();bytes.fill(0);c.ok(r.store.writeBacking(6,0,bytes),'point backing revision');const command=c.ok(decodeStandardSubmission(transfer(6,bytes.length)),'point concurrent upload packet').commands[0],access=c.ok(r.store.prepareTransfer(1,command),'point upload ownership');c.ok(r.store.executeTransfer(access.ticket),'actual point GPU revision');}});
   c.same(fired,true,'point delayed read reached');if(action==='reuse'){await pointFrame(r,record);c.same(record.result.draws[0].indexResourceGeneration,oldGeneration,'point original generation retained');}else{c.same(record.result.error.code,action==='cancel'?'cancelled':'stale-storage','explicit point pending rejection');c.same(record.result.gpuComplete,true,'point pending rejection drains fence');c.same(r.trace.calls.length,0,'invalid pending point never draws');}report.suspensions.push({action,phase,point,oldGeneration,newGeneration,record,events:r.trace.events});done(r);
  }
  {const a=pointSpec(),b=pointSpec({perVertex:false,fixedSize:2,negativeY:true}),r=make(a,{delay:4,step:1}),vao=gl.createVertexArray(),ebo=gl.createBuffer();await pointFrame(r,await pointSubmit(r,1,join(pointSetup(r,a),pointDraw(a)),'restore-A-first'));
   const poison=()=>{const program=gl.getParameter(gl.CURRENT_PROGRAM);if(program){gl.uniform2f(gl.getUniformLocation(program,'wv_point_size'),31,0);gl.uniform1f(gl.getUniformLocation(program,'wv_point_coord_y'),-17);}gl.bindVertexArray(vao);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array([0,0,0]),gl.STREAM_DRAW);gl.viewport(0,0,1,1);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.colorMask(false,false,false,false);};
   poison();await pointFrame(r,await pointSubmit(r,2,join(pointSetup(r,b,{create:false}),pointDraw(b)),'restore-B'));poison();r.spec=a;r.bufferBytes=a.data;await pointFrame(r,await pointSubmit(r,1,join(clear([0,0,0,0]),pointDraw(a)),'restore-A-last'));gl.deleteVertexArray(vao);gl.deleteBuffer(ebo);done(r);
  }
  for(const phase of ['waiting-index','finishing']){const s=pointSpec({enabled:true}),r=make(s,{delay:6,step:1});c.ok((await pointSubmit(r,1,pointSetup(r,s),'cancel-owned-setup-'+phase)).result,'owned point setup');let fired=false,point;const draws=phase==='finishing'?[pointDraw(s)]:[pointDraw(s),pointDraw(s)];
   const record=await pointSubmit(r,1,join(clear([0,0,0,0]),...draws),'owned-cancel-'+phase,(_step,token)=>{const inspection=r.renderer.inspect().jobs;if(!fired&&inspection.draws===1&&inspection.status===phase){fired=true;point={inspection,events:r.trace.events.map(a=>({...a}))};c.same(inspection.normalizedBuffers,1,'point scratch retained at pending phase');c.ok(r.renderer.cancel(token),'cancel retained point draw');}});c.same(fired,true,'owned point suspension reached');c.same(record.result.error.code,'cancelled','owned point cancellation');c.same(record.result.gpuComplete,true,'owned point cancellation drains fence');c.same(record.result.draws.length,1,'point cancelled suffix does not draw');await pointFrame(r,record,{allowError:true});report.ownership.push({phase,point,record});done(r);
  }
  {const s=pointSpec({enabled:true}),r=make(s,{delay:6,step:1});c.ok((await pointSubmit(r,1,pointSetup(r,s),'dispose-setup')).result,'point dispose setup');r.currentLabel='dispose';r.trace.label('dispose');const bytes=join(pointDraw(s),pointDraw(s)),token=c.ok(r.renderer.beginSubmission(1,bytes),'owned point dispose job').job;let before;
   for(let i=0;i<1000;i++){await new Promise(resolve=>setTimeout(resolve,1));r.trace.nextTurn();const step=c.ok(r.renderer.step(token),'point dispose later task'),inspection=r.renderer.inspect().jobs;if(inspection.draws===1&&inspection.status==='waiting-index'){before={inspection,events:r.trace.events.map(a=>({...a}))};break;}c.same(step.status==='done',false,'point disposal before completion');}c.same(Boolean(before),true,'point disposal suspension reached');c.ok(r.renderer.dispose(),'point explicit disposal');c.same(r.renderer.step(token).ok,false,'disposed point token rejects');for(const e of r.normalized)c.same(gl.isBuffer(e.buffer),false,'disposed point native storage deleted');report.ownership.push({phase:'dispose',hex:hex(bytes),before,after:r.renderer.inspect()});done(r);
  }
 }
 report.status='passed';return report;
}
