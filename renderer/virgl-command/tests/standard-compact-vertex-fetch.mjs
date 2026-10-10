import {decodeSubmission,decodeStandardSubmission,floatingVertexFormat} from '../decoder.mjs';
import {createVirglStandardAsyncRenderer} from '../state.mjs';
import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks,rig,meta,add,shader,clear,submit,dispose,packet,join,hex,blob} from './standard-instanced-draws.mjs';
import {compactModel,compareCompactPixels} from '../../../tools/virgl-command/standard-compact-oracle.mjs';
const word=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
const tgsi=(stage,decl,body)=>(stage===0?'VERT':'FRAG')+'\n'+decl+'\n'+[...body,'END'].map((line,i)=>i+': '+line+'\n').join('');
const families=[[28,4,'float'],[48,2,'unorm'],[56,2,'snorm'],[64,1,'unorm'],[74,1,'snorm'],[91,2,'half']];
function fixtureFormat(format){for(const [base,bytes,kind]of [...families,[32,4,'unorm'],[40,4,'snorm'],[36,4,'uscaled'],[44,4,'sscaled'],[52,2,'uscaled'],[60,2,'sscaled'],[69,1,'uscaled'],[82,1,'sscaled']])if(format>=base&&format<base+4)return {components:format-base+1,bytes,kind};throw Error('unsupported fixture format');}
export function compactSpec(options={}){
 const s={format:67,instances:1,indexed:true,indexSize:2,indexOffset:12,start:5,enabled:false,restartIndex:61,divisor:0,bufferOffset:1,sourceOffset:0,
  positionOffset:1,positionSourceOffset:3,positionStride:16,shared:false,seed:0xa419029b,wordLane:null,negativeY:false,...options},fmt=fixtureFormat(s.format);
 s.stride=s.stride??fmt.components*fmt.bytes;s.bufferOffset=options.bufferOffset??(fmt.bytes===1?1:1);s.sourceOffset=options.sourceOffset??(fmt.bytes===1?0:fmt.bytes-1);
 const n=Math.max(1,s.instances);s.width=16*n;s.height=16;s.ids=s.ids??(s.indexed?[7,9,12]:[s.start,s.start+1,s.start+2]);
 if(s.enabled&&options.ids===undefined)s.ids=[s.restartIndex,...s.ids.slice(0,2),s.restartIndex,s.ids.at(-1),s.restartIndex];
 s.count=s.ids.length;const valid=s.ids.filter(id=>!s.enabled||id!==s.restartIndex),max=valid.length?Math.max(...valid):0;
 const positionPrefix=s.positionOffset+s.positionSourceOffset,positionLength=positionPrefix+max*s.positionStride+16;
 if(s.shared){s.bufferOffset=positionLength+1;s.sourceOffset=fmt.bytes===1?0:fmt.bytes-1;}
 const colorPrefix=s.bufferOffset+s.sourceOffset,last=s.stride===0?0:s.divisor?Math.floor((n-1)/s.divisor):max;
 const colorLength=colorPrefix+last*s.stride+fmt.components*fmt.bytes-(s.shortColor?1:0),position=new Uint8Array(s.shared?Math.max(positionLength,colorLength):positionLength-(s.shortPosition?1:0)),color=s.shared?position:new Uint8Array(colorLength);
 const p=new DataView(position.buffer),q=new DataView(color.buffer);let seed=s.seed>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 for(const [ordinal,id]of [...new Set(valid)].entries()){
  const center=[[3.25,4.25],[8.25,9.25],[12.25,5.25]][ordinal%3],values=[Math.fround(center[0]/8-1),Math.fround(center[1]/8-1),id,1];
  values.forEach((value,lane)=>{const at=positionPrefix+id*s.positionStride+lane*4;if(at+4<=position.length)p.setFloat32(at,value,true);});
 }
 const indices=s.stride===0?[0]:s.divisor?Array.from({length:last+1},(_,i)=>i):[...new Set(valid)];
 for(const [ordinal,index]of indices.entries())for(let lane=0;lane<fmt.components;lane++){
  const at=colorPrefix+index*s.stride+lane*fmt.bytes;if(at+fmt.bytes>color.length)continue;
  let value=s.values?.[ordinal%s.values.length]?.[lane];
  if(fmt.kind==='half'){value=s.halfBits?.[ordinal%s.halfBits.length]?.[lane]??[0x3400,0xb800,0x3800,0x3c00][(lane+ordinal)%4];q.setUint16(at,value,true);}
  else if(fmt.kind==='float')q.setFloat32(at,value??(16+random()%192)/256,true);
  else {const bits=fmt.bytes*8,signed=fmt.kind==='snorm'||fmt.kind==='sscaled',top=signed?2**(bits-1)-1:2**bits-1;
   value=value??(ordinal===0?(signed?-(2**(bits-1)):0):ordinal===1?top:Math.floor(top*.37)+lane);
   if(fmt.bytes===1){if(signed)q.setInt8(at,value);else q.setUint8(at,value);}else if(fmt.bytes===2){if(signed)q.setInt16(at,value,true);else q.setUint16(at,value,true);}else if(signed)q.setInt32(at,value,true);else q.setUint32(at,value,true);
  }
 }
 s.data=new Map([[3,position],...(s.shared?[]:[[4,color]])]);s.colorId=s.shared?3:4;
 if(s.indexed){const bytes=new Uint8Array(s.indexOffset+s.count*s.indexSize-(s.shortIndex?1:0)),v=new DataView(bytes.buffer);s.ids.forEach((id,i)=>{const at=s.indexOffset+i*s.indexSize;if(at+s.indexSize<=bytes.length){if(s.indexSize===1)v.setUint8(at,id);else if(s.indexSize===2)v.setUint16(at,id,true);else v.setUint32(at,id,true);}});s.data.set(6,bytes);}
 const body=['I2F TEMP[0].x, SV[0].xxxx','MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].yyyy, IMM[0].zzzz',
  'MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx','MOV OUT[0].y, IN[0].yyyy','MOV OUT[0].z, IMM[3].wwww',
  'I2F TEMP[1].x, SV[1].xxxx','SEQ TEMP[1].x, TEMP[1].xxxx, IN[0].zzzz','MUL OUT[0].w, TEMP[1].xxxx, IN[0].wwww',
  ...(s.wordLane===null?['MAD OUT[1], IN[1], IMM[1], IMM[3]']:[
   `MOV TEMP[2].x, IN[1].${'xyzw'[s.wordLane].repeat(4)}`,'USHR TEMP[2], TEMP[2].xxxx, IMM[2]','AND TEMP[2], TEMP[2], IMM[4]',
   'U2F TEMP[2], TEMP[2]','MUL OUT[1], TEMP[2], IMM[0].wwww'])];
 s.vertex=tgsi(0,'DCL IN[0]\nDCL IN[1]\nDCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..2]\n'+
  `IMM[0] FLT32 {${Math.fround(1/n)},${Math.fround(2/n)},${Math.fround(-1+1/n)},0.00392156862745098}\nIMM[1] FLT32 {0.5,0.5,0.5,1.0}\nIMM[2] UINT32 {0,8,16,24}\nIMM[3] FLT32 {0.5,0.5,0.5,0.0}\nIMM[4] UINT32 {255,255,255,255}`,body);
 s.fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';return s;
}
export const compactDraw=s=>packet(8,0,[s.indexed?0:s.start,s.count,0,s.indexed?1:0,s.instances,0,0,s.enabled?1:0,s.enabled?s.restartIndex:0,0,0xffffffff,0]);
export function compactSetup(r,s,{create=true,uploadChunk=Infinity}={}){
 if(create)for(const [id,raw]of s.data)add(r,meta(id,0,64,id===6?32:16,raw.length),raw);
 else for(const [id,raw]of s.data){
  const allocation=r.allocations.findLast(a=>a.metadata.id===id),full=r.c.ok(r.store.readBacking(id,0,allocation.metadata.byteLength),'original shared compact backing').bytes;
  full.set(raw);s.data.set(id,full);r.c.ok(r.store.writeBacking(id,0,full),'replace original shared compact backing');
 }
 r.spec=s;r.bufferBytes=s.data;
 const uploads=[];for(const [id,raw]of s.data)for(let at=0;at<raw.length;at+=uploadChunk)uploads.push(packet(43,0,[id,0,0,0,0,at,0,0,Math.min(uploadChunk,raw.length-at),1,1,at,1]));
 return join(...uploads,shader(1,0,s.vertex),shader(2,1,s.fragment),packet(1,5,[3,s.positionSourceOffset,0,0,31,s.sourceOffset,s.divisor,1,s.format]),packet(2,5,[3]),
  packet(6,0,[s.positionStride,s.positionOffset,3,s.stride,s.bufferOffset,s.colorId]),...(s.indexed?[packet(11,0,[6,s.indexSize,s.indexOffset])]:[]),
  packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),packet(4,0,[0,...[r.width/2,s.negativeY?-r.height/2:r.height/2,.5,r.width/2,r.height/2,.5].map(word)]),
  packet(1,2,[9,2|(1<<29),word(4),0,65535,word(1),0,0,0]),packet(2,2,[9]),packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
export function compactRig(gl,bridge,c,s,options={}){
 let r;const normalized=[],nativeState=[];
 const factory=config=>{const wrapped=new Proxy(config.gl,{get(target,name){const value=Reflect.get(target,name,target);if(typeof value!=='function')return value;return(...args)=>{
  if(['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(name)){
   const p=gl.getParameter(gl.CURRENT_PROGRAM),u=gl.getUniformLocation(p,'wv_point_size');
   const attributes=Array.from({length:gl.getProgramParameter(p,gl.ACTIVE_ATTRIBUTES)},(_,i)=>{const a=gl.getActiveAttrib(p,i),location=gl.getAttribLocation(p,a.name);if(location<0)return {name:a.name,location};const get=n=>gl.getVertexAttrib(location,gl[n]),generic=[...get('CURRENT_VERTEX_ATTRIB')];
    return {name:a.name,location,type:get('VERTEX_ATTRIB_ARRAY_TYPE'),normalized:get('VERTEX_ATTRIB_ARRAY_NORMALIZED'),integer:get('VERTEX_ATTRIB_ARRAY_INTEGER'),components:get('VERTEX_ATTRIB_ARRAY_SIZE'),stride:get('VERTEX_ATTRIB_ARRAY_STRIDE'),
     offset:gl.getVertexAttribOffset(location,gl.VERTEX_ATTRIB_ARRAY_POINTER),divisor:get('VERTEX_ATTRIB_ARRAY_DIVISOR'),enabled:get('VERTEX_ATTRIB_ARRAY_ENABLED'),genericValues:generic,genericWords:[...new Uint32Array(new Float32Array(generic).buffer)],buffer:r.trace.id(get('VERTEX_ATTRIB_ARRAY_BUFFER_BINDING'))};});
   nativeState.push({label:r.currentLabel,pointSize:[...gl.getUniform(p,u)],attributes});
  }
  if(name==='bufferData'&&args[0]===gl.ELEMENT_ARRAY_BUFFER&&args[1] instanceof Uint32Array)normalized.push({buffer:gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING),nativeBuffer:r.trace.id(gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)),label:r.currentLabel,bytes:args[1].byteLength,deleted:false});
  if(name==='deleteBuffer'){const entry=normalized.find(e=>e.buffer===args[0]);if(entry){const before=gl.getParameter(gl.COPY_READ_BUFFER_BINDING);gl.bindBuffer(gl.COPY_READ_BUFFER,entry.buffer);entry.raw=new Uint8Array(entry.bytes);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,entry.raw);gl.bindBuffer(gl.COPY_READ_BUFFER,before);entry.deleted=true;}}
  return value.apply(target,args);
 };}});return createVirglStandardAsyncRenderer({...config,gl:wrapped,primitiveAssembly:'lists'});};
 r=rig(gl,bridge,c,{width:s.width,height:s.height,...options,factory});r.normalized=normalized;r.nativeState=nativeState;r.range=[...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];return r;
}
export async function compactSubmit(r,ctx,bytes,label,onYield=null){r.currentLabel=label;return submit(r,ctx,bytes,label,onYield);}
function checkWords(c,observed,expected,values,label){c.same(observed.length,expected.length,label+' supplied word count');for(let i=0;i<expected.length;i++){
 if(Number.isNaN(values[i]))c.same((observed[i]&0x7f800000)===0x7f800000&&(observed[i]&0x7fffff)!==0,true,label+' NaN category');else c.same(observed[i],expected[i],label+' lane '+i);
}}
export async function compactFrame(r,record,oracle={model:compactModel,compare:compareCompactPixels}){
 const {gl,c}=r;c.ok(record.result,record.label+' completed original compact draw');c.same(record.result.gpuComplete,true,'compact final fence completed');
 const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
 for(const p of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[p],0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
 const pixels=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.deleteFramebuffer(fb);
 const draw=record.result.draws.at(-1),buffers=[],normalized=[],calls=r.trace.calls.filter(a=>a.label===record.label).map(({program,...a})=>a);
 for(const [id,original]of r.bufferBytes){const generation=id===6?draw.indexResourceGeneration:draw.vertexFetches.find(a=>a.resourceId===id).resourceGeneration,allocation=r.allocations.find(a=>a.metadata.id===id&&a.generation===generation),bytes=new Uint8Array(original.length);
  gl.bindBuffer(gl.COPY_READ_BUFFER,allocation.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,bytes);gl.bindBuffer(gl.COPY_READ_BUFFER,null);const saved=await blob(r,bytes);c.same(saved.sha256,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',original))),'unchanged original compact native bytes '+id);buffers.push({resourceId:id,generation,nativeBuffer:r.trace.id(allocation.storage.buffer),blob:saved});}
 for(const entry of r.normalized.filter(e=>e.label===record.label)){c.same(entry.deleted,true,'compact private index retired after fence');normalized.push({nativeBuffer:entry.nativeBuffer,bytes:entry.bytes,blob:await blob(r,entry.raw)});}
 const model=oracle.model(r.history,r.bufferBytes,r.range),audit=oracle.compare(pixels,model,r.width,r.height),frame={label:record.label,width:r.width,height:r.height,range:r.range,history:r.history.map(h=>({...h})),inputs:r.exchanges.map(e=>({...e})),
  native:{calls,buffers,normalized,state:r.nativeState.filter(a=>a.label===record.label)},predicted:{ids:model.ids,fetches:model.fetches,points:model.points,min:model.min,max:model.max,valid:model.valid,restarts:model.restarts,normalize:model.normalize},audit,pixels:await blob(r,pixels)};
 r.frames.push(frame);c.same(audit.misses,[],record.label+' independent original compact pixels');
 const call=calls.at(-1),instanced=model.effective>1;c.same(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''),'actual compact native draw entry');
 c.same(call.args,model.draw.indexed?[0,model.draw.count,{1:5121,2:5123,4:5125}[model.nativeSize],model.nativeOffset,...(instanced?[model.effective]:[])]:[0,model.draw.start,model.draw.count,...(instanced?[model.effective]:[])],'original compact native arguments');
 c.same([draw.actualMinIndex,draw.actualMaxIndex,draw.validIndexCount,draw.restartCount,draw.normalizedIndices,draw.nativeIndexSize,draw.nativeIndexOffset,draw.vertexWork],[model.min,model.max,model.valid,model.restarts,model.normalize,model.nativeSize,model.nativeOffset,model.draw.count*model.effective],'compact actual index/work bounds');
 if(model.normalize)c.same(normalized.find(e=>e.nativeBuffer===call.indexBuffer).blob.sha256,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',model.normalized))),'original compact normalized native indices');
 const state=frame.native.state.at(-1);c.same(state.pointSize,model.pointUniform,'native compact fixed point uniform');
 for(const fetch of model.fetches){const got=draw.vertexFetches.find(a=>a.attributeIndex===fetch.attributeIndex),a=state.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),keys=['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'];
  c.same(Object.fromEntries(keys.map(k=>[k,got[k]])),Object.fromEntries(keys.map(k=>[k,fetch[k]])),'original compact fetch '+fetch.attributeIndex);c.same(a.enabled,!fetch.constant,'actual compact array/generic');c.same(a.divisor,fetch.nativeDivisor,'actual compact divisor');c.same(a.integer,false,'native floating input');
  if(fetch.constant){c.same(a.genericValues,fetch.genericValues,'native generic compact values');checkWords(c,got.componentWords,fetch.componentWords,fetch.genericValues,'retained compact scalar words');checkWords(c,a.genericWords,fetch.genericValues.map(word),fetch.genericValues,'physical generic words');
   const reads=r.trace.events.filter(e=>e.label===record.label&&e.name==='getBufferSubData');c.same(reads.some(e=>e.bytes===fetch.elementBytes&&e.hex===hex(r.bufferBytes.get(fetch.resourceId).subarray(fetch.offset,fetch.offset+fetch.elementBytes))),true,'actual retained compact read width and bytes');
  }else {c.same([a.type,a.normalized,a.components,a.stride,a.offset],[fetch.nativeType,fetch.normalized,fetch.components,fetch.stride,fetch.offset],'physical compact format pointer');c.same(a.buffer,buffers.find(b=>b.resourceId===fetch.resourceId).nativeBuffer,'original compact GPU array identity');}
 }
 c.same(gl.getError(),gl.NO_ERROR,'compact native fetch/readback');return frame;
}
export function runWireAcceptance(){
 const c=checks(),records=[];for(const [base,bytes]of families)for(let k=0;k<4;k++)for(const divisor of [0,2,0xffffffff])for(const offset of [0,1,0xffffffff-(k+1)*bytes,0xffffffff-(k+1)*bytes+1]){
  const format=base+k,packetBytes=packet(1,5,[777,offset,divisor,0,format]),a=decodeStandardSubmission(packetBytes),b=decodeSubmission(packetBytes),expected=offset<=0xffffffff-(k+1)*bytes,legacy=base===28&&divisor===0&&offset%4===0&&expected;
  c.same(a.ok,expected,'compact original standard element');c.same(b.ok,legacy,'unchanged legacy element');const desc=floatingVertexFormat(format);c.same([desc.components,desc.scalarBytes,desc.elementBytes],[k+1,bytes,(k+1)*bytes],'immutable compact byte width');c.same(Object.isFrozen(desc),true,'frozen original format');
  records.push({format,divisor,offset,hex:hex(packetBytes),standard:a,legacy:b,expected,legacyExpected:legacy});
 }
 for(const format of [0,27,32,40,52,60,68,69,78,82,87,95,0xffffffff]){const bytes=packet(1,5,[777,0,0,0,format]),a=decodeStandardSubmission(bytes),expected=[32,40,52,60,69,82].includes(format);c.same(a.ok,expected,'explicit successor scalar admission');records.push({format,hex:hex(bytes),standard:a,expected});}
 for(const input of [NaN,Infinity,null,undefined,'28',{},-1])c.same(floatingVertexFormat(input),null,'descriptor does not coerce caller input');return {status:'passed',records,predictions:c.rows};
}
export async function runAcceptance({smoke=false,constantFault=false}={}){
 const c=checks(),report={schema:'standard-compact-physical-v1',status:'running',frames:[],runs:[],rejections:[],suspensions:[],ownership:[],blobs:[],predictions:c.rows,guestExecution:false,productionNegotiation:false,portableNaNPayload:false};window.__standardCompactEvidence=report;
 const gl=document.getElementById('gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw Error('real WebGL2 required');const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('hardware compact proof required');
 const bridge=await createVirglStandardShaderBridge(),make=(s,opts={})=>{const r=compactRig(gl,bridge,c,s,opts);r.frames=report.frames;r.blobs=report.blobs;return r;},done=r=>{const inspection=c.ok(r.renderer.inspect(),'compact ownership');for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspection.jobs[key],0,'released compact '+key);report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),nativeState:r.nativeState,inspection});dispose(r);};
 const draw=async(options,label,opts={})=>{const s=compactSpec(options),r=make(s,opts);await compactFrame(r,await compactSubmit(r,1,join(compactSetup(r,s),compactDraw(s)),label));done(r);};
 if(smoke){await draw({format:67,...(constantFault?{stride:0,values:[[64,128,192,255]]}:{})},'compact-smoke');report.status='passed';return report;}
 for(const [delay,step]of [[0,64],[2,1],[5,3]])for(const [base]of families)for(let k=0;k<4;k++)for(const constant of [false,true])await draw({format:base+k,...(constant?{stride:0,divisor:0xffffffff}:{})},'format-'+(base+k)+'-'+(constant?'constant':'array')+'-'+delay,{delay,step});
 for(const [label,options]of [
  ['byte-stride-three',{format:66,stride:3,bufferOffset:1,sourceOffset:2}],['half-stride-six',{format:93,stride:6}],['overlap-bytes',{format:67,stride:1}],['overlap-halves',{format:94,stride:2}],
  ['mixed-shared',{format:75,shared:true,stride:3}],['byte-divisor',{format:65,instances:5,divisor:2}],['half-divisor',{format:94,instances:3,divisor:1}],['huge-divisor',{format:49,instances:3,divisor:0xffffffff}],
  ['array-instance',{format:77,indexed:false,instances:3}],['constant-array',{format:92,indexed:false,stride:0}],['negative-y',{format:59,negativeY:true}],
  ['wide-byte-index',{format:64,indexSize:1,ids:[7,9,255]}],['u32-index',{format:94,indexSize:4}],['restart-byte',{format:75,indexSize:1,enabled:true}],['restart-u16',{format:50,enabled:true}],['restart-u32',{format:92,indexSize:4,enabled:true}],
  ['native-restart-marker',{format:67,enabled:true,restartIndex:65535}],['all-restart',{format:48,stride:0,enabled:true,ids:[61,61,61]}],['array-zero-instance',{format:66,indexed:false,instances:0}],
 ])await draw(options,label,{delay:3,step:2});
 const halves=[[0x0000,0x8000,0x0001,0x8001],[0x03ff,0x0400,0x83ff,0x8400],[0x3c00,0xbc00,0x7bff,0xfbff],[0x7c00,0xfc00,0x7e01,0xfe11]];
 for(const [index,row]of halves.entries())for(const constant of [false,true])for(let lane=0;lane<4;lane++)await draw({format:94,halfBits:[row],wordLane:lane,...(constant?{stride:0}:{})},'half-word-'+index+'-'+lane+'-'+constant,{delay:2,step:1});
 for(const format of [48,56,64,74])for(const constant of [false,true])for(const lane of [0,1,3])await draw({format,wordLane:lane,values:[[0],[format===56?-32768:format===74?-128:format===48?65535:255]],...(constant?{stride:0}:{})},'norm-endpoint-word-'+format+'-'+lane+'-'+constant);
 for(const options of [{shortColor:true},{format:91,stride:0,shortColor:true},{shortPosition:true},{shortIndex:true},{format:92,stride:3},{format:94,bufferOffset:0,sourceOffset:1},{positionOffset:0,positionSourceOffset:1},{format:64,stride:256}]){
  const s=compactSpec(options),r=make(s),record=await compactSubmit(r,1,join(compactSetup(r,s),compactDraw(s)),'reject-'+JSON.stringify(options));c.same(record.result.ok,false,'compact invalid source rejects');c.same(r.trace.calls.length,0,'compact invalid source before native draw');report.rejections.push({record,events:r.trace.events});done(r);
 }
 for(const admitted of [true,false]){const s=compactSpec({format:64,stride:0}),limit=7-(admitted?0:1),r=make(s,{jobLimits:{transferBytes:limit}}),record=await compactSubmit(r,1,join(compactSetup(r,s,{uploadChunk:limit}),compactDraw(s)),admitted?'exact-compact-staging':'short-compact-staging');
  if(admitted)await compactFrame(r,record);else {c.same(record.result.error.code,'limit-exceeded','compact aggregate source staging bound');c.same(r.trace.calls.length,0,'compact staging bound before draw');c.same(r.trace.events.filter(e=>e.name==='copyBufferSubData').length,0,'compact staging before read allocation');report.rejections.push({record,events:r.trace.events});}done(r);}
 for(const phase of ['waiting-index','waiting-attributes'])for(const action of ['revision','cancel','reuse']){
  const s=compactSpec({format:94,...(phase==='waiting-attributes'?{stride:0}:{})}),r=make(s,{delay:7,step:1});c.ok((await compactSubmit(r,1,compactSetup(r,s),'pending-setup-'+phase+'-'+action)).result,'compact pending setup');let fired=false,point;
  const oldGeneration=r.allocations.find(a=>a.metadata.id===s.colorId).generation,record=await compactSubmit(r,1,join(clear([0,0,0,0]),compactDraw(s)),'pending-'+phase+'-'+action,(_step,token)=>{
   const inspection=c.ok(r.renderer.inspect(),'compact suspended ownership');if(fired||inspection.jobs.status!==phase)return;fired=true;point={inspection,events:r.trace.events.map(a=>({...a}))};
   if(action==='cancel')c.ok(r.renderer.cancel(token),'cancel compact batch');
   else if(action==='revision'){const id=phase==='waiting-index'?6:s.colorId,bytes=s.data.get(id).slice();bytes.fill(123);c.ok(r.store.writeBacking(id,0,bytes),'change retained compact backing');const command=c.ok(decodeStandardSubmission(packet(43,0,[id,0,0,0,0,0,0,0,bytes.length,1,1,0,1])),'compact concurrent transfer packet').commands[0],access=c.ok(r.store.prepareTransfer(1,command),'compact concurrent upload ownership');c.ok(r.store.executeTransfer(access.ticket),'actual compact GPU revision');}
   else {c.ok(r.store.unref(s.colorId),'drop public compact name');add(r,meta(s.colorId,0,64,16,s.data.get(s.colorId).length),new Uint8Array(s.data.get(s.colorId).length));}
  });c.same(fired,true,'actual compact pending phase reached');if(action==='reuse'){await compactFrame(r,record);c.same(record.result.draws[0].vertexFetches.find(f=>f.attributeIndex===1).resourceGeneration,oldGeneration,'compact retained old source generation');}
  else {c.same(record.result.ok,false,'compact pending mutation rejects');c.same(record.result.gpuComplete,true,'compact pending error drains fences');c.same(r.trace.calls.length,0,'compact pending error never draws');}
  report.suspensions.push({phase,action,point,record});done(r);
 }
 {const a=compactSpec({format:77}),b=compactSpec({format:94,stride:0,negativeY:true}),r=make(a,{delay:4,step:1}),vao=gl.createVertexArray(),buffer=gl.createBuffer(),ebo=gl.createBuffer();await compactFrame(r,await compactSubmit(r,1,join(compactSetup(r,a),compactDraw(a)),'restore-A-first'));
  const poison=()=>{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(256),gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.vertexAttribPointer(i,2,gl.UNSIGNED_BYTE,false,3,1);gl.vertexAttribDivisor(i,11);gl.vertexAttrib4f(i,.9,.8,.7,.6);gl.enableVertexAttribArray(i);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([1,1,1]),gl.STATIC_DRAW);c.same(gl.getError(),gl.NO_ERROR,'legal native compact poison');};
  poison();await compactFrame(r,await compactSubmit(r,2,join(compactSetup(r,b,{create:false}),compactDraw(b)),'restore-B'));poison();r.spec=a;r.bufferBytes=a.data;for(const [id,raw]of a.data)c.ok(r.store.writeBacking(id,0,raw),'restore original A compact backing');await compactFrame(r,await compactSubmit(r,1,join(...[...a.data].map(([id,raw])=>packet(43,0,[id,0,0,0,0,0,0,0,raw.length,1,1,0,1])),clear([0,0,0,0]),compactDraw(a)),'restore-A-last'));gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);gl.deleteBuffer(ebo);done(r);
 }
 {const s=compactSpec({format:94,stride:0}),r=make(s,{delay:6,step:1});c.ok((await compactSubmit(r,1,compactSetup(r,s),'dispose-setup')).result,'compact disposal setup');r.currentLabel='dispose';r.trace.label('dispose');const token=c.ok(r.renderer.beginSubmission(1,compactDraw(s)),'compact disposal job').job;let before;
  for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'compact disposal advance');const state=r.renderer.inspect();if(state.jobs.status==='waiting-attributes'){before=state;break;}}
  c.same(Boolean(before),true,'compact disposal has actual retained read batch');c.ok(r.renderer.dispose(),'dispose compact active batch');report.ownership.push({phase:'waiting-attributes',before,after:r.asyncAccess.inspect(),events:r.trace.events.map(a=>({...a}))});c.same(r.renderer.step(token).ok,false,'disposed compact token rejects');done(r);
 }
 report.range=[...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];report.status='passed';return report;
}
