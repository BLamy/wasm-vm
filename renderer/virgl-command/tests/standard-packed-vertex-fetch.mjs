import {decodeSubmission,decodeStandardSubmission,floatingVertexFormat,vertexFormat} from '../decoder.mjs';
import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks,meta,add,clear,dispose,packet,join,hex,runWireAcceptance as legacyWire} from './standard-instanced-draws.mjs';
import {compactSpec,compactDraw,compactSetup,compactRig,compactSubmit,compactFrame} from './standard-compact-vertex-fetch.mjs';
import {packedModel,comparePackedPixels} from '../../../tools/virgl-command/standard-packed-oracle.mjs';
const formats=[8,123,172,173];
const rows=format=>[172,173].includes(format)?[[-512,-512,-512,-2],[511,511,511,1],[-511,-1,0,-1],[1,255,-256,0]]:
 [[0,0,0,0],[1023,1023,1023,3],[1,511,512,1],[512,513,1022,2]];
export function packedSpec(options={}){
 const format=options.format??173;
 if(!formats.includes(format))throw Error('literal packed fixture format');
 const s=compactSpec({...options,format:39,stride:options.stride??4,values:[[0,0,0,0]]});s.format=format;s.positionFormat=options.positionFormat??31;
 const valid=s.ids.filter(id=>!s.enabled||id!==s.restartIndex),last=s.stride===0?0:s.divisor?Math.floor((Math.max(1,s.instances)-1)/s.divisor):valid.length?Math.max(...valid):0;
 if(options.overlapPosition){if(!s.shared)throw Error('literal packed overlap needs shared GPU storage');s.bufferOffset=s.positionOffset;s.sourceOffset=s.positionSourceOffset;s.stride=s.positionStride;}
 const prefix=s.bufferOffset+s.sourceOffset,previous=s.data.get(s.colorId),length=options.overlapPosition?previous.length:prefix+last*s.stride+4-(s.shortColor?1:0),raw=new Uint8Array(length);raw.set(previous.subarray(0,length));
 const view=new DataView(raw.buffer),indices=s.stride===0?[0]:s.divisor?Array.from({length:last+1},(_,i)=>i):[...new Set(valid)],values=options.values??rows(format);
 for(const [ordinal,index]of indices.entries()){
  if(options.overlapPosition)continue;
  const at=prefix+index*s.stride;if(at+4>length)continue;
  const lanes=values[ordinal%values.length];let bits=0n;
  for(let k=0;k<4;k++)bits|=(BigInt(lanes[k])&((1n<<(k===3?2n:10n))-1n))<<BigInt(k*10);
  view.setUint32(at,Number(bits),true);
 }
 s.data.set(s.colorId,raw);s.attributeIndex=options.attributeIndex??1;
 if(s.attributeIndex!==1){if(s.attributeIndex!==15)throw Error('literal packed high fixture');s.vertex=s.vertex.replaceAll('IN[1]','IN[15]');}
 return s;
}
export const packedDraw=compactDraw,packedRig=compactRig,packedSubmit=compactSubmit;
export function packedSetup(r,s,options={}){
 const original=compactSetup(r,s,options);
 if(s.positionFormat!==31){const v=new DataView(original.buffer,original.byteOffset,original.byteLength);for(let at=0;at<original.length;){const h=v.getUint32(at,true);if((h&65535)===1281)v.setUint32(at+20,s.positionFormat,true);at+=4*((h>>>16)+1);}}
 if(s.attributeIndex===1)return original;
 const view=new DataView(original.buffer,original.byteOffset,original.byteLength);
 for(let at=0;at<original.length;){const header=view.getUint32(at,true),length=4*((header>>>16)+1);
  if((header&65535)===1281){const fields=[3];for(let k=0;k<16;k++)fields.push(...(k===0?[s.positionSourceOffset,0,0,s.positionFormat]:k===15?[s.sourceOffset,s.divisor,1,s.format]:[s.positionSourceOffset,0,0,28]));return join(original.subarray(0,at),packet(1,5,fields),original.subarray(at+length));}at+=length;
 }
 throw Error('original high packed element create missing');
}
export const packedFrame=(r,record)=>compactFrame(r,record,{model:packedModel,compare:comparePackedPixels});
export function runWireAcceptance(){
 const c=checks(),records=[];
 for(const format of formats)for(const divisor of [0,2,0xffffffff])for(const offset of [0,1,0xffffffff-4,0xffffffff-3]){
  const raw=packet(1,5,[777,offset,divisor,0,format]),expected=offset+4<=0xffffffff,
   standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw),descriptor=vertexFormat(format),signed=[172,173].includes(format),normalized=[8,173].includes(format);
  c.same(standard.ok,expected,'literal packed end and divisor');c.same(legacy.ok,false,'packed does not widen historical wire');
  c.same([descriptor.components,descriptor.scalarBytes,descriptor.elementBytes,descriptor.type,descriptor.normalized,descriptor.packed],[4,4,4,signed?'INT_2_10_10_10_REV':'UNSIGNED_INT_2_10_10_10_REV',normalized,true],'literal packed descriptor');
  c.same(floatingVertexFormat(format),null,'old floating lookup shape remains isolated');c.same(Object.isFrozen(descriptor),true,'immutable packed descriptor');records.push({format,divisor,offset,hex:hex(raw),expected,legacyExpected:false,standard,legacy});
 }
 for(const format of [0,7,9,122,124,131,171,174,175,176,0xffffffff]){
  const raw=packet(1,5,[777,0,0,0,format]),standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw);c.same([standard.ok,legacy.ok],[false,false],'separate packed/swizzled format boundary');records.push({format,hex:hex(raw),expected:false,legacyExpected:false,standard,legacy});
 }
 for(const input of [NaN,Infinity,null,undefined,'8',{},-1])c.same(vertexFormat(input),null,'packed lookup does not coerce');
 return {status:'passed',records,predictions:c.rows,legacy:legacyWire()};
}
export async function runAcceptance({smoke=false,constantFault=false,mutation}={}){
 const c=checks(),report={schema:'standard-packed-physical-v1',status:'running',frames:[],runs:[],rejections:[],suspensions:[],ownership:[],blobs:[],predictions:c.rows,guestExecution:false,productionNegotiation:false,portableDomainCertified:false};window.__standardPackedEvidence=report;
 const gl=document.getElementById('gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw Error('real WebGL2 required');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};
 if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('hardware packed proof required');
 const bridge=await createVirglStandardShaderBridge(),make=(s,opts={})=>{const r=packedRig(gl,opts.bridge??bridge,c,s,opts);r.frames=report.frames;r.blobs=report.blobs;return r;},done=r=>{
  const inspection=c.ok(r.renderer.inspect(),'packed ownership');for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspection.jobs[key],0,'released packed '+key);
  report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),nativeState:r.nativeState,inspection});dispose(r);
 };
 const draw=async(options,label,opts={})=>{const s=packedSpec(options),r=make(s,opts);await packedFrame(r,await packedSubmit(r,1,join(packedSetup(r,s),packedDraw(s)),label));done(r);};
 if(smoke){await draw({format:constantFault?173:mutation==='native-normalize'?8:172,values:[constantFault||mutation!=='native-normalize'?[-512,0,511,-2]:[128,512,900,3]],...(constantFault?{stride:0,wordLane:3}:mutation==='native-normalize'?{}:{wordLane:3})},'packed-smoke');report.status='passed';return report;}
 for(const [delay,step]of [[0,64],[2,1],[5,3]])for(const format of formats)for(const constant of [false,true])
  await draw({format,...(constant?{stride:0,divisor:0xffffffff}:{})},'packed-format-'+format+'-'+(constant?'constant':'array')+'-'+delay,{delay,step});
 for(const format of formats)for(const [index,row]of rows(format).entries())for(const constant of [false,true]){
  await draw({format,values:[row,row.slice().reverse()],...(constant?{stride:0}:{})},'packed-color-'+format+'-'+index+'-'+constant,{delay:2,step:1});
  for(let lane=0;lane<4;lane++){
   if(!constant&&[8,173].includes(format)&&index>1&&lane<3)continue;
   await draw({format,values:[row],wordLane:lane,...(constant?{stride:0}:{})},'packed-word-'+format+'-'+index+'-'+lane+'-'+constant,{delay:3,step:2});
  }
 }
 for(const [label,options]of [
  ['packed-divisor',{format:8,instances:5,divisor:2}],['packed-shared',{format:173,shared:true}],
  ['packed-overlap',{format:172,shared:true,overlapPosition:true,wordLane:1}],['packed-gap',{format:123,stride:8,wordLane:2}],
  ['packed-native-maximum-stride',{format:123,stride:252,wordLane:3}],['packed-divisor-one',{format:172,instances:3,divisor:1,wordLane:2}],
  ['packed-huge-divisor',{format:173,instances:3,divisor:0xffffffff}],['packed-array-instance',{format:8,indexed:false,instances:3}],
  ['packed-constant-array',{format:172,indexed:false,stride:0,wordLane:0}],['packed-negative-y',{format:173,negativeY:true}],
  ['packed-wide-byte-index',{format:123,indexSize:1,ids:[7,9,255],wordLane:1}],['packed-u32-index',{format:172,indexSize:4,wordLane:2}],
  ['packed-restart-byte',{format:173,indexSize:1,enabled:true}],['packed-restart-u16',{format:8,enabled:true}],
  ['packed-restart-u32',{format:172,indexSize:4,enabled:true,wordLane:0}],['packed-native-marker',{format:123,enabled:true,restartIndex:65535,wordLane:1}],
  ['packed-all-restart',{format:173,stride:0,enabled:true,ids:[61,61,61]}],['packed-zero-instance',{format:8,indexed:false,instances:0}],
  ['packed-shared-constant',{format:172,shared:true,stride:0,wordLane:0}],['packed-high15-array',{format:173,attributeIndex:15}],
  ['packed-high15-constant',{format:172,attributeIndex:15,stride:0,wordLane:3}],
  ['packed-mixed-constant-batch',{format:8,positionStride:0,stride:0}],['packed-shared-mixed-constant-batch',{format:172,shared:true,positionStride:0,stride:0,wordLane:3}],
 ])await draw(options,label,{delay:4,step:1});
 for(const positionFormat of [196,200])for(const format of [172,173])await draw({format,positionFormat,wordLane:3},'packed-mixed-integer-'+positionFormat+'-'+format,{delay:3,step:1});
 for(const options of [{shortColor:true},{format:173,stride:0,shortColor:true},{shortPosition:true},{shortIndex:true},{format:123,stride:3},{format:172,bufferOffset:0,sourceOffset:1},{positionOffset:0,positionSourceOffset:1},{format:8,stride:256},{format:173,stride:255}]){
  const s=packedSpec(options),r=make(s),record=await packedSubmit(r,1,join(packedSetup(r,s),packedDraw(s)),'reject-'+JSON.stringify(options));c.same(record.result.ok,false,'packed invalid source rejects');c.same(r.trace.calls.length,0,'packed invalid source before native draw');report.rejections.push({record,events:r.trace.events});done(r);
 }
 for(const admitted of [true,false]){const s=packedSpec({format:123,stride:0,wordLane:0}),limit=10-(admitted?0:1),r=make(s,{jobLimits:{transferBytes:limit}}),record=await packedSubmit(r,1,join(packedSetup(r,s,{uploadChunk:limit}),packedDraw(s)),admitted?'exact-compact-staging':'short-compact-staging');
  if(admitted)await packedFrame(r,record);else {c.same(record.result.error.code,'limit-exceeded','compact aggregate source staging bound');c.same(r.trace.calls.length,0,'compact staging bound before draw');c.same(r.trace.events.filter(e=>e.name==='copyBufferSubData').length,0,'compact staging before read allocation');report.rejections.push({record,events:r.trace.events});}done(r);}
 for(const admitted of [true,false]){const s=packedSpec({format:172,instances:2,divisor:1,wordLane:0}),r=make(s,{drawLimits:{indicesPerSubmission:admitted?6:5}}),record=await packedSubmit(r,1,join(packedSetup(r,s),packedDraw(s)),admitted?'packed-exact-work':'packed-short-work');
  if(admitted)await packedFrame(r,record);else {c.same(record.result.error.code,'limit-exceeded','packed total original vertex work');c.same(r.trace.calls.length,0,'packed work ceiling before native draw');report.rejections.push({record,events:r.trace.events});}done(r);
 }
 for(const phase of ['waiting-index','waiting-attributes'])for(const action of ['revision','cancel','reuse']){
  const s=packedSpec({format:172,wordLane:0,...(phase==='waiting-attributes'?{stride:0}:{})}),r=make(s,{delay:7,step:1});c.ok((await packedSubmit(r,1,packedSetup(r,s),'pending-setup-'+phase+'-'+action)).result,'compact pending setup');let fired=false,point;
  const oldGeneration=r.allocations.find(a=>a.metadata.id===s.colorId).generation,record=await packedSubmit(r,1,join(clear([0,0,0,0]),packedDraw(s)),'pending-'+phase+'-'+action,(_step,token)=>{
   const inspection=c.ok(r.renderer.inspect(),'compact suspended ownership');if(fired||inspection.jobs.status!==phase)return;fired=true;point={inspection,events:r.trace.events.map(a=>({...a}))};
   if(action==='cancel')c.ok(r.renderer.cancel(token),'cancel compact batch');
   else if(action==='revision'){const id=phase==='waiting-index'?6:s.colorId,bytes=s.data.get(id).slice();bytes.fill(123);c.ok(r.store.writeBacking(id,0,bytes),'change retained compact backing');const command=c.ok(decodeStandardSubmission(packet(43,0,[id,0,0,0,0,0,0,0,bytes.length,1,1,0,1])),'compact concurrent transfer packet').commands[0],access=c.ok(r.store.prepareTransfer(1,command),'compact concurrent upload ownership');c.ok(r.store.executeTransfer(access.ticket),'actual compact GPU revision');}
   else {c.ok(r.store.unref(s.colorId),'drop public compact name');add(r,meta(s.colorId,0,64,16,s.data.get(s.colorId).length),new Uint8Array(s.data.get(s.colorId).length));}
  });c.same(fired,true,'actual compact pending phase reached');if(action==='reuse'){await packedFrame(r,record);c.same(record.result.draws[0].vertexFetches.find(f=>f.attributeIndex===1).resourceGeneration,oldGeneration,'compact retained old source generation');}
  else {c.same(record.result.ok,false,'compact pending mutation rejects');c.same(record.result.gpuComplete,true,'compact pending error drains fences');c.same(r.trace.calls.length,0,'compact pending error never draws');}
  report.suspensions.push({phase,action,point,record});done(r);
 }
 {const a=packedSpec({format:173}),b=packedSpec({format:172,stride:0,negativeY:true}),r=make(a,{delay:4,step:1}),vao=gl.createVertexArray(),buffer=gl.createBuffer(),ebo=gl.createBuffer();await packedFrame(r,await packedSubmit(r,1,join(packedSetup(r,a),packedDraw(a)),'restore-A-first'));
  const poison=()=>{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(256),gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.vertexAttribPointer(i,2,gl.UNSIGNED_BYTE,false,3,1);gl.vertexAttribDivisor(i,11);gl.vertexAttrib4f(i,.9,.8,.7,.6);gl.enableVertexAttribArray(i);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([1,1,1]),gl.STATIC_DRAW);c.same(gl.getError(),gl.NO_ERROR,'legal native compact poison');};
  poison();await packedFrame(r,await packedSubmit(r,2,join(packedSetup(r,b,{create:false}),packedDraw(b)),'restore-B'));poison();r.spec=a;r.bufferBytes=a.data;for(const [id,raw]of a.data)c.ok(r.store.writeBacking(id,0,raw),'restore original A compact backing');await packedFrame(r,await packedSubmit(r,1,join(...[...a.data].map(([id,raw])=>packet(43,0,[id,0,0,0,0,0,0,0,raw.length,1,1,0,1])),clear([0,0,0,0]),packedDraw(a)),'restore-A-last'));gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);gl.deleteBuffer(ebo);done(r);
 }
 for(const evict of [false,true]){
  const s=packedSpec({format:172,values:[[-512,128,511,-2]],wordLane:0}),requests=[],traced={...bridge,
   translatePair(request){requests.push({signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0});return bridge.translatePair(request);},
   translatePairVertexFormats(request){requests.push(Object.fromEntries(['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask'].map(k=>[k,request[k]])));return bridge.translatePairVertexFormats(request);}};
  const r=make(s,{bridge:traced,delay:5,step:1,...(evict?{stateLimits:{programs:1},cacheLimits:{translations:1}}:{})}),states=[];
  for(const [i,[format,stride]]of [[172,4],[173,4],[173,0],[172,4]].entries()){
   const bytes=i===0?packedSetup(r,s):join(packet(1,5,[4+i,s.positionSourceOffset,0,0,31,s.sourceOffset,0,1,format]),packet(2,5,[4+i]),packet(6,0,[s.positionStride,s.positionOffset,3,stride,s.bufferOffset,s.colorId]),clear([0,0,0,0]));
   await packedFrame(r,await packedSubmit(r,1,join(bytes,packedDraw(s)),'packed-variant-'+evict+'-'+i));states.push(r.nativeState.at(-1));
  }
  c.same(states[0].program===states[3].program,!evict,'packed program reuse follows budget');c.same(new Set(states.slice(0,3).map(s=>s.program)).size,3,'scaled normalized and generic GPU variants');
  const expected=[[0,0,2,0],[0,0,2,2],[0,0,0,0],...(evict?[[0,0,2,0]]:[])].map(a=>Object.fromEntries(['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask'].map((k,i)=>[k,a[i]])));
  c.same(requests,expected,'packed format and stride identity reaches actual compiler');
  const inspection=c.ok(r.renderer.inspect(),'packed variant budget');if(evict)c.same(inspection.caches.program.evictions>=3,true,'packed native cache evicted');
  report.ownership.push({phase:'packed-variants',evict,requests,programs:states.map(s=>s.program),inspection});done(r);
 }
 for(const mode of ['missing-method','invalid-mask','wrong-metadata','wrong-native-type']){
  const s=packedSpec({format:172}),bad={...bridge};
  if(mode==='missing-method')delete bad.translatePairVertexFormats;
  else bad.translatePairVertexFormats=request=>{
   if(mode==='invalid-mask')return bridge.translatePairVertexFormats({...request,packedNormalizedMask:4});
   const result=bridge.translatePairVertexFormats(request);
   if(mode==='wrong-metadata'){result.vertex.metadata.attributes[1].type='uvec4';result.vertex.metadata.inputs[1].type='uvec4';}
   else result.vertex.glsl=result.vertex.glsl.replace('in vec4 in_1;','in uvec4 in_1;').replace('wv_pack_1(in_1)','wv_pack_1(vec4(in_1))');
   return result;
  };
  const r=make(s,{bridge:bad}),record=await packedSubmit(r,1,join(packedSetup(r,s),packedDraw(s)),'reject-packed-'+mode);
  c.same(record.result.ok,false,'packed incompatible compiler rejects');c.same(r.trace.calls.length,0,'packed mismatch before native draw');report.rejections.push({record,events:r.trace.events});done(r);
 }
 {const s=packedSpec({format:172,stride:0,wordLane:0}),r=make(s,{delay:6,step:1});c.ok((await packedSubmit(r,1,packedSetup(r,s),'dispose-setup')).result,'compact disposal setup');r.currentLabel='dispose';r.trace.label('dispose');const token=c.ok(r.renderer.beginSubmission(1,packedDraw(s)),'compact disposal job').job;let before;
  for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'compact disposal advance');const state=r.renderer.inspect();if(state.jobs.status==='waiting-attributes'){before=state;break;}}
  c.same(Boolean(before),true,'compact disposal has actual retained read batch');c.ok(r.renderer.dispose(),'dispose compact active batch');report.ownership.push({phase:'waiting-attributes',before,after:r.asyncAccess.inspect(),events:r.trace.events.map(a=>({...a}))});c.same(r.renderer.step(token).ok,false,'disposed compact token rejects');done(r);
 }
 report.range=[...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];report.status='passed';return report;
}
