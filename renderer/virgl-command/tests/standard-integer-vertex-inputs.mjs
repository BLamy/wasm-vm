import {decodeSubmission,decodeStandardSubmission,vertexFormat} from '../decoder.mjs';
import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks,meta,add,clear,dispose,packet,join,hex,runWireAcceptance as legacyWire} from './standard-instanced-draws.mjs';
import {compactSpec,compactDraw,compactSetup,compactRig,compactSubmit,compactFrame} from './standard-compact-vertex-fetch.mjs';
import {integerModel,compareIntegerPixels} from '../../../tools/virgl-command/standard-integer-oracle.mjs';
const families=[[177,1,'UNSIGNED_BYTE'],[181,1,'BYTE'],[185,2,'UNSIGNED_SHORT'],[189,2,'SHORT'],[193,4,'UNSIGNED_INT'],[197,4,'INT']];
export function integerSpec(options={}){
 const s=compactSpec({format:196,wordLane:0,...options});s.attributeIndex=options.attributeIndex??1;
 if(s.attributeIndex!==1)s.vertex=s.vertex.replaceAll('IN[1]','IN['+s.attributeIndex+']');
 if(options.mixed){
  const original=s.data.get(s.colorId),offset=Math.ceil(original.length/4)*4,raw=new Uint8Array(offset+16);raw.set(original);
  [0xff800003,0x80000001,0x7fc00001,1].forEach((w,i)=>new DataView(raw.buffer).setUint32(offset+4*i,w,true));
  s.data.set(s.colorId,raw);s.mixedOffset=offset;
  s.vertex=s.vertex.replace('DCL SV[0]','DCL IN[2]\nDCL SV[0]').replace('MOV TEMP[2].x, IN[1].xxxx','UADD TEMP[2].x, IN[1].xxxx, IN[2].xxxx');
 }
 return s;
}
export const integerDraw=compactDraw,integerRig=compactRig,integerSubmit=compactSubmit;
export function integerSetup(r,s,options={}){
 const raw=compactSetup(r,s,options);if(s.attributeIndex===1&&s.mixedOffset===undefined)return raw;
 const parts=[],v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
 for(let at=0;at<raw.length;){const h=v.getUint32(at,true),op=h&255,kind=h>>>8&255,n=h>>>16,part=raw.slice(at,at+4*(n+1));
  if(op===1&&kind===5){const elements=Array.from({length:Math.max(s.attributeIndex+1,s.mixedOffset===undefined?2:3)},(_,i)=>
   i===s.attributeIndex?[s.sourceOffset,s.divisor,1,s.format]:[s.positionSourceOffset,0,0,i===0?31:28]);
   if(s.mixedOffset!==undefined)elements[2]=[0,0,2,196];parts.push(packet(1,5,[3,...elements.flat()]));
  }else if(op===6&&s.mixedOffset!==undefined)parts.push(join(part.slice(0,0),packet(6,0,[s.positionStride,s.positionOffset,3,s.stride,s.bufferOffset,s.colorId,0,s.mixedOffset,s.colorId])));
  else parts.push(part);at+=4*(n+1);
 }
 return join(...parts);
}
export const integerFrame=(r,record)=>compactFrame(r,record,{model:integerModel,compare:compareIntegerPixels});
export function runWireAcceptance(){
 const c=checks(),records=[];
 for(const [base,bytes,type]of families)for(let lane=0;lane<4;lane++)for(const divisor of [0,2,0xffffffff])for(const offset of [0,1,0xffffffff-(lane+1)*bytes,0xffffffff-(lane+1)*bytes+1]){
  const format=base+lane,raw=packet(1,5,[777,offset,divisor,0,format]),expected=offset+(lane+1)*bytes<=0xffffffff,
   standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw),descriptor=vertexFormat(format);
  c.same(standard.ok,expected,'literal integer end and divisor');c.same(legacy.ok,false,'integer formats never widen historical factory');
  c.same([descriptor.components,descriptor.scalarBytes,descriptor.elementBytes,descriptor.type,descriptor.normalized],[lane+1,bytes,(lane+1)*bytes,type,false],'literal integer descriptor');
  c.same(Object.isFrozen(descriptor),true,'immutable integer descriptor');records.push({format,divisor,offset,hex:hex(raw),expected,legacyExpected:false,standard,legacy});
 }
 for(const format of [0,27,68,78,87,95,123,172,173,177,193,0xffffffff]){
  const raw=packet(1,5,[777,0,0,0,format]),standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw);
  const expected= [123,172,173].includes(format)||format>=177&&format<=200;c.same([standard.ok,legacy.ok],[expected,false],'explicit successor integer/packed admission');records.push({format,hex:hex(raw),expected,legacyExpected:false,standard,legacy});
 }
 for(const input of [NaN,Infinity,null,undefined,'177',{},-1])c.same(vertexFormat(input),null,'integer lookup does not coerce');
 return {status:'passed',records,predictions:c.rows,legacy:legacyWire()};
}
export async function runAcceptance({smoke=false,variantsOnly=false,constantFault=false,mutation}={}){
 const c=checks(),report={schema:'standard-integer-physical-v1',status:'running',frames:[],runs:[],rejections:[],suspensions:[],ownership:[],blobs:[],predictions:c.rows,guestExecution:false,productionNegotiation:false,portableDomainCertified:false};window.__standardIntegerEvidence=report;
 const gl=document.getElementById('gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw Error('real WebGL2 required');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};
 if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('hardware integer proof required');
 const bridge=await createVirglStandardShaderBridge(),make=(s,opts={})=>{const r=integerRig(gl,opts.bridge??bridge,c,s,opts);r.frames=report.frames;r.blobs=report.blobs;return r;},done=r=>{
  const inspection=c.ok(r.renderer.inspect(),'integer ownership');for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspection.jobs[key],0,'released integer '+key);
  report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),nativeState:r.nativeState,inspection});dispose(r);
 };
 const draw=async(options,label,opts={})=>{const s=integerSpec(options),r=make(s,opts);await integerFrame(r,await integerSubmit(r,1,join(integerSetup(r,s),integerDraw(s)),label));done(r);};
 if(smoke){await draw(mutation==='native-signedness'?{format:184,values:[[-128,-1,127,1]]}:{format:196,values:[[0xff800001,16777217,0x7fc00001,4294967295]],...(constantFault?{stride:0}:{})},'integer-smoke');report.status='passed';return report;}
 if(!variantsOnly){
 for(const [delay,step]of [[0,64],[2,1],[5,3]])for(const [base]of families)for(let lane=0;lane<4;lane++)for(const constant of [false,true])
  await draw({format:base+lane,...(constant?{stride:0,divisor:0xffffffff}:{})},'integer-format-'+(base+lane)+'-'+(constant?'constant':'array')+'-'+delay,{delay,step});
 const wide=[[193,[[0,1,16777215,16777216],[16777217,16777219,33554431,33554433],[2147483647,2147483648,0x7fc00001,4294967295]]],
  [197,[[-2147483648,-2147483647,-16777217,-1],[16777215,16777216,16777217,2147483647],[-8388607,-16777215,0,1]]]];
 for(const [base,rows]of wide)for(const [i,row]of rows.entries())for(const constant of [false,true])for(let lane=0;lane<4;lane++)
  await draw({format:base+3,values:[row,row.slice().reverse()],wordLane:lane,...(constant?{stride:0}:{})},'integer32-word-'+base+'-'+i+'-'+lane+'-'+constant,{delay:2,step:1});
 for(const [base,row]of [[177,[0,1,254,255]],[181,[-128,-1,127,1]],[185,[0,1,65534,65535]],[189,[-32768,-1,32767,1]]])for(const constant of [false,true])for(let lane=0;lane<4;lane++)
  await draw({format:base+3,values:[row,row.slice().reverse()],wordLane:lane,...(constant?{stride:0}:{})},'integer-narrow-word-'+base+'-'+lane+'-'+constant);
 for(const [base]of families)for(const constant of [false,true])for(let lane=0;lane<4;lane++)
  await draw({format:base,values:[[1]],wordLane:lane,...(constant?{stride:0}:{})},'integer-missing-'+base+'-'+lane+'-'+constant);
 for(const [base]of families)for(const components of [2,3])for(const constant of [false,true])for(let lane=components;lane<4;lane++)
  await draw({format:base+components-1,values:[[1,2,3]],wordLane:lane,...(constant?{stride:0}:{})},'integer-missing-'+base+'-'+components+'-'+lane+'-'+constant);
 for(const [label,options]of [
  ['integer-byte-stride-three',{format:179,stride:3}],['integer-short-stride-six',{format:191,stride:6}],['integer-rgb32-stride12',{format:195,stride:12}],
  ['integer-byte-overlap',{format:184,stride:1}],['integer-short-overlap',{format:188,stride:2}],['integer-wide-overlap',{format:200,stride:4}],
  ['integer-shared',{format:184,shared:true}],['integer-shared-constant',{format:200,shared:true,stride:0}],
  ['integer-divisor',{format:196,instances:5,divisor:2}],['integer-huge-divisor',{format:200,instances:3,divisor:0xffffffff}],
  ['integer-arrays',{format:189,indexed:false,instances:3}],['integer-constant-arrays',{format:197,indexed:false,stride:0}],
  ['integer-negative-y',{format:184,negativeY:true}],['integer-u8-real255',{format:180,indexSize:1,ids:[7,9,255]}],
  ['integer-u32-index',{format:200,indexSize:4}],['integer-restart-u8',{format:184,indexSize:1,enabled:true}],
  ['integer-restart-u16',{format:192,enabled:true}],['integer-restart-u32',{format:200,indexSize:4,enabled:true}],
  ['integer-native-marker',{format:180,enabled:true,restartIndex:65535}],['integer-all-restart',{format:196,stride:0,enabled:true,ids:[61,61,61]}],
  ['integer-zero-instance',{format:179,indexed:false,instances:0}],['integer-high-slot-array',{format:200,attributeIndex:15}],
  ['integer-high-slot-constant',{format:196,attributeIndex:15,stride:0}],['integer-mixed-shared-constant',{format:184,stride:0,shared:true,mixed:true}],
  ['integer-mixed-array-constant',{format:192,mixed:true}],
 ])await draw(options,label,{delay:3,step:2});
 for(const options of [{shortColor:true},{format:193,stride:0,shortColor:true},{shortPosition:true},{shortIndex:true},{format:193,stride:3},{format:200,bufferOffset:0,sourceOffset:1},{positionOffset:0,positionSourceOffset:1},{format:177,stride:256}]){
  const s=integerSpec(options),r=make(s),record=await integerSubmit(r,1,join(integerSetup(r,s),integerDraw(s)),'reject-'+JSON.stringify(options));c.same(record.result.ok,false,'compact invalid source rejects');c.same(r.trace.calls.length,0,'compact invalid source before native draw');report.rejections.push({record,events:r.trace.events});done(r);
 }
 for(const admitted of [true,false]){const s=integerSpec({format:196,stride:0,wordLane:0}),limit=22-(admitted?0:1),r=make(s,{jobLimits:{transferBytes:limit}}),record=await integerSubmit(r,1,join(integerSetup(r,s,{uploadChunk:limit}),integerDraw(s)),admitted?'exact-compact-staging':'short-compact-staging');
  if(admitted)await integerFrame(r,record);else {c.same(record.result.error.code,'limit-exceeded','compact aggregate source staging bound');c.same(r.trace.calls.length,0,'compact staging bound before draw');c.same(r.trace.events.filter(e=>e.name==='copyBufferSubData').length,0,'compact staging before read allocation');report.rejections.push({record,events:r.trace.events});}done(r);}
 for(const admitted of [true,false]){const s=integerSpec({format:200,instances:2,divisor:1,wordLane:0}),r=make(s,{drawLimits:{indicesPerSubmission:admitted?6:5}}),record=await integerSubmit(r,1,join(integerSetup(r,s),integerDraw(s)),admitted?'integer-exact-work':'integer-short-work');
  if(admitted)await integerFrame(r,record);else {c.same(record.result.error.code,'limit-exceeded','integer total original vertex work');c.same(r.trace.calls.length,0,'integer work ceiling before native draw');report.rejections.push({record,events:r.trace.events});}done(r);
 }
 for(const phase of ['waiting-index','waiting-attributes'])for(const action of ['revision','cancel','reuse']){
  const s=integerSpec({format:200,wordLane:0,...(phase==='waiting-attributes'?{stride:0}:{})}),r=make(s,{delay:7,step:1});c.ok((await integerSubmit(r,1,integerSetup(r,s),'pending-setup-'+phase+'-'+action)).result,'compact pending setup');let fired=false,point;
  const oldGeneration=r.allocations.find(a=>a.metadata.id===s.colorId).generation,record=await integerSubmit(r,1,join(clear([0,0,0,0]),integerDraw(s)),'pending-'+phase+'-'+action,(_step,token)=>{
   const inspection=c.ok(r.renderer.inspect(),'compact suspended ownership');if(fired||inspection.jobs.status!==phase)return;fired=true;point={inspection,events:r.trace.events.map(a=>({...a}))};
   if(action==='cancel')c.ok(r.renderer.cancel(token),'cancel compact batch');
   else if(action==='revision'){const id=phase==='waiting-index'?6:s.colorId,bytes=s.data.get(id).slice();bytes.fill(123);c.ok(r.store.writeBacking(id,0,bytes),'change retained compact backing');const command=c.ok(decodeStandardSubmission(packet(43,0,[id,0,0,0,0,0,0,0,bytes.length,1,1,0,1])),'compact concurrent transfer packet').commands[0],access=c.ok(r.store.prepareTransfer(1,command),'compact concurrent upload ownership');c.ok(r.store.executeTransfer(access.ticket),'actual compact GPU revision');}
   else {c.ok(r.store.unref(s.colorId),'drop public compact name');add(r,meta(s.colorId,0,64,16,s.data.get(s.colorId).length),new Uint8Array(s.data.get(s.colorId).length));}
  });c.same(fired,true,'actual compact pending phase reached');if(action==='reuse'){await integerFrame(r,record);c.same(record.result.draws[0].vertexFetches.find(f=>f.attributeIndex===1).resourceGeneration,oldGeneration,'compact retained old source generation');}
  else {c.same(record.result.ok,false,'compact pending mutation rejects');c.same(record.result.gpuComplete,true,'compact pending error drains fences');c.same(r.trace.calls.length,0,'compact pending error never draws');}
  report.suspensions.push({phase,action,point,record});done(r);
 }
 {const a=integerSpec({format:196}),b=integerSpec({format:200,stride:0,negativeY:true}),r=make(a,{delay:4,step:1}),vao=gl.createVertexArray(),buffer=gl.createBuffer(),ebo=gl.createBuffer();await integerFrame(r,await integerSubmit(r,1,join(integerSetup(r,a),integerDraw(a)),'restore-A-first'));
  const poison=()=>{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(256),gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.vertexAttribPointer(i,2,gl.UNSIGNED_BYTE,false,3,1);gl.vertexAttribDivisor(i,11);gl.vertexAttrib4f(i,.9,.8,.7,.6);gl.enableVertexAttribArray(i);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([1,1,1]),gl.STATIC_DRAW);c.same(gl.getError(),gl.NO_ERROR,'legal native compact poison');};
  poison();await integerFrame(r,await integerSubmit(r,2,join(integerSetup(r,b,{create:false}),integerDraw(b)),'restore-B'));poison();r.spec=a;r.bufferBytes=a.data;for(const [id,raw]of a.data)c.ok(r.store.writeBacking(id,0,raw),'restore original A compact backing');await integerFrame(r,await integerSubmit(r,1,join(...[...a.data].map(([id,raw])=>packet(43,0,[id,0,0,0,0,0,0,0,raw.length,1,1,0,1])),clear([0,0,0,0]),integerDraw(a)),'restore-A-last'));gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);gl.deleteBuffer(ebo);done(r);
 }
 }
 for(const evict of [false,true]){
  const s=integerSpec({format:31,stride:0,values:[[.5,.25,-.5,1]],wordLane:0}),requests=[],traced={...bridge,
   translatePair(request){requests.push({signedMask:0,unsignedMask:0});return bridge.translatePair(request);},
   translatePairTyped(request){requests.push({signedMask:request.signedMask,unsignedMask:request.unsignedMask});return bridge.translatePairTyped(request);}};
  const r=make(s,{bridge:traced,delay:5,step:1,...(evict?{stateLimits:{programs:1},cacheLimits:{translations:1}}:{})}),states=[];
  for(const [i,format]of [31,200,196,31].entries()){
   const bytes=i===0?integerSetup(r,s):join(packet(1,5,[4+i,s.positionSourceOffset,0,0,31,s.sourceOffset,0,1,format]),packet(2,5,[4+i]),clear([0,0,0,0]));
   await integerFrame(r,await integerSubmit(r,1,join(bytes,integerDraw(s)),'typed-variant-'+evict+'-'+i));states.push(r.nativeState.at(-1));
  }
  c.same(states.map(state=>state.attributes.find(a=>a.name==='in_1').shaderType),[35666,35669,36296,35666],'same owned pair float/signed/unsigned/float reflection');
  c.same(states[0].program===states[3].program,!evict,'float native program reuse follows eviction budget');c.same(new Set(states.slice(0,3).map(s=>s.program)).size,3,'three owned native type variants');
  c.same(requests,evict?[{signedMask:0,unsignedMask:0},{signedMask:2,unsignedMask:0},{signedMask:0,unsignedMask:2},{signedMask:0,unsignedMask:0}]:[{signedMask:0,unsignedMask:0},{signedMask:2,unsignedMask:0},{signedMask:0,unsignedMask:2}],'host-derived complete pair cache identity');
  const inspection=c.ok(r.renderer.inspect(),'typed variant budget');if(evict)c.same(inspection.caches.program.evictions>=3,true,'typed native cache evicted');
  report.ownership.push({phase:'type-variants',evict,requests,programs:states.map(s=>s.program),inspection});done(r);
 }
 for(const mode of ['missing-method','wrong-mask','wrong-metadata','wrong-native-type']){
  const s=integerSpec({format:200,stride:0}),bad={...bridge};
  if(mode==='missing-method')delete bad.translatePairTyped;
  else bad.translatePairTyped=request=>{
   if(mode==='wrong-mask')return bridge.translatePairTyped({...request,signedMask:0,unsignedMask:2});
   const result=bridge.translatePairTyped(request);
   if(mode==='wrong-metadata'){result.vertex.metadata.attributes[1].type='uvec4';result.vertex.metadata.inputs[1].type='uvec4';}
   else result.vertex.glsl=result.vertex.glsl.replace('in ivec4 in_1;','in uvec4 in_1;');
   return result;
  };
  const r=make(s,{bridge:bad}),record=await integerSubmit(r,1,join(integerSetup(r,s),integerDraw(s)),'reject-type-'+mode);
  c.same(record.result.ok,false,'typed variant mismatch rejects');c.same(r.trace.calls.length,0,'typed mismatch before native draw');report.rejections.push({record,events:r.trace.events});done(r);
 }
 {const s=integerSpec({format:200,stride:0,wordLane:0}),r=make(s,{delay:6,step:1});c.ok((await integerSubmit(r,1,integerSetup(r,s),'dispose-setup')).result,'compact disposal setup');r.currentLabel='dispose';r.trace.label('dispose');const token=c.ok(r.renderer.beginSubmission(1,integerDraw(s)),'compact disposal job').job;let before;
  for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'compact disposal advance');const state=r.renderer.inspect();if(state.jobs.status==='waiting-attributes'){before=state;break;}}
  c.same(Boolean(before),true,'compact disposal has actual retained read batch');c.ok(r.renderer.dispose(),'dispose compact active batch');report.ownership.push({phase:'waiting-attributes',before,after:r.asyncAccess.inspect(),events:r.trace.events.map(a=>({...a}))});c.same(r.renderer.step(token).ok,false,'disposed compact token rejects');done(r);
 }
 report.range=[...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];report.status='passed';return report;
}
