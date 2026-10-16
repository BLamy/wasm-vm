import {decodeSubmission,decodeStandardSubmission,floatingVertexFormat} from '../decoder.mjs';
import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks,meta,add,clear,dispose,packet,join,hex,runWireAcceptance as legacyWire} from './standard-instanced-draws.mjs';
import {compactSpec,compactDraw,compactSetup,compactRig,compactSubmit,compactFrame} from './standard-compact-vertex-fetch.mjs';
import {scalarModel,compareScalarPixels} from '../../../tools/virgl-command/standard-scalar-oracle.mjs';
const families=[[32,4,'UNSIGNED_INT',true],[40,4,'INT',true],[36,4,'UNSIGNED_INT',false],[44,4,'INT',false],
 [52,2,'UNSIGNED_SHORT',false],[60,2,'SHORT',false],[69,1,'UNSIGNED_BYTE',false],[82,1,'BYTE',false]];
export const scalarSpec=options=>compactSpec({format:47,...options});
export const scalarDraw=compactDraw,scalarSetup=compactSetup,scalarRig=compactRig,scalarSubmit=compactSubmit;
export const scalarFrame=(r,record)=>compactFrame(r,record,{model:scalarModel,compare:compareScalarPixels});
export function runWireAcceptance(){
 const c=checks(),records=[];
 for(const [base,bytes,type,normalized]of families)for(let lane=0;lane<4;lane++)for(const divisor of [0,2,0xffffffff])for(const offset of [0,1,0xffffffff-(lane+1)*bytes,0xffffffff-(lane+1)*bytes+1]){
  const format=base+lane,raw=packet(1,5,[777,offset,divisor,0,format]),expected=offset+(lane+1)*bytes<=0xffffffff,
   standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw),descriptor=floatingVertexFormat(format);
  c.same(standard.ok,expected,'literal scalar end and divisor');c.same(legacy.ok,false,'scalar formats never widen historical factory');
  c.same([descriptor.components,descriptor.scalarBytes,descriptor.elementBytes,descriptor.type,descriptor.normalized],[lane+1,bytes,(lane+1)*bytes,type,normalized],'literal scalar descriptor');
  c.same(Object.isFrozen(descriptor),true,'immutable scalar descriptor');records.push({format,divisor,offset,hex:hex(raw),expected,legacyExpected:false,standard,legacy});
 }
 for(const format of [0,27,68,78,87,95,123,172,173,177,193,0xffffffff]){
  const raw=packet(1,5,[777,0,0,0,format]),standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw);
  const expected=[123,172,173,177,193].includes(format);c.same([standard.ok,legacy.ok],[expected,false],'explicit successor integer/packed admission');records.push({format,hex:hex(raw),expected,legacyExpected:false,standard,legacy});
 }
 for(const input of [NaN,Infinity,null,undefined,'32',{},-1])c.same(floatingVertexFormat(input),null,'scalar lookup does not coerce');
 return {status:'passed',records,predictions:c.rows,legacy:legacyWire()};
}
export async function runAcceptance({smoke=false,constantFault=false}={}){
 const c=checks(),report={schema:'standard-scalar-physical-v1',status:'running',frames:[],runs:[],rejections:[],suspensions:[],ownership:[],blobs:[],predictions:c.rows,guestExecution:false,productionNegotiation:false,portableDomainCertified:false};window.__standardScalarEvidence=report;
 const gl=document.getElementById('gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw Error('real WebGL2 required');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};
 if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('hardware scalar proof required');
 const bridge=await createVirglStandardShaderBridge(),make=(s,opts={})=>{const r=scalarRig(gl,bridge,c,s,opts);r.frames=report.frames;r.blobs=report.blobs;return r;},done=r=>{
  const inspection=c.ok(r.renderer.inspect(),'scalar ownership');for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspection.jobs[key],0,'released scalar '+key);
  report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),nativeState:r.nativeState,inspection});dispose(r);
 };
 const draw=async(options,label,opts={})=>{const s=scalarSpec(options),r=make(s,opts);await scalarFrame(r,await scalarSubmit(r,1,join(scalarSetup(r,s),scalarDraw(s)),label));done(r);};
 if(smoke){await draw({format:47,wordLane:0,values:[[constantFault?16777217:-2147483648,-16777217,-1,2147483647]],...(constantFault?{stride:0}:{})},'scalar-smoke');report.status='passed';return report;}
 for(const [delay,step]of [[0,64],[2,1],[5,3]])for(const [base]of families)for(let lane=0;lane<4;lane++)for(const constant of [false,true])
  await draw({format:base+lane,...(constant?{stride:0,divisor:0xffffffff}:{})},'scalar-format-'+(base+lane)+'-'+(constant?'constant':'array')+'-'+delay,{delay,step});
 const wide=[
  [36,[[0,1,16777215,16777216],[16777217,16777218,16777219,33554431],[2147483647,2147483648,4294967294,4294967295]]],
  [44,[[-2147483648,-2147483647,-16777217,-16777216],[-16777215,-1,0,1],[16777215,16777216,16777217,2147483647]]]
 ];
 for(const [base,rows]of wide)for(const [i,row]of rows.entries())for(const constant of [false,true])for(let lane=0;lane<4;lane++)
  await draw({format:base+3,values:[row,row.slice(1).concat(row[0]),row.slice(2).concat(row.slice(0,2))],wordLane:lane,...(constant?{stride:0}:{})},'scaled32-round-'+base+'-'+i+'-'+lane+'-'+constant,{delay:2,step:1});
 for(const [base,row]of [[52,[0,1,65534,65535]],[60,[-32768,-1,32767,1]],[69,[0,1,254,255]],[82,[-128,-1,127,1]]])for(const constant of [false,true])for(let lane=0;lane<4;lane++)
  await draw({format:base+3,values:[row,row.slice().reverse()],wordLane:lane,...(constant?{stride:0}:{})},'scaled-small-word-'+base+'-'+lane+'-'+constant);
 for(const [base,row]of [[32,[0,4294967295,1,4294967294]],[40,[-2147483648,-2147483647,2147483647,0]]])for(const constant of [false,true])for(let lane=0;lane<4;lane++)
  await draw({format:base+3,values:[row],wordLane:lane,...(constant?{stride:0}:{})},'norm32-endpoint-word-'+base+'-'+lane+'-'+constant);
 // Interior native array arithmetic has no portable word certificate. These
 // retained generic values have an exact original full-range scalar contract.
 for(const [base,row]of [[32,[16777217,16777219,33554431,33554433]],[40,[16777217,-16777217,33554431,-33554431]]])for(let lane=0;lane<4;lane++)
  await draw({format:base+3,values:[row],wordLane:lane,stride:0},'norm32-generic-round-'+base+'-'+lane,{delay:4,step:1});
 for(const [base]of families)for(const constant of [false,true])for(let lane=0;lane<4;lane++)
  await draw({format:base,values:[[1]],wordLane:lane,...(constant?{stride:0}:{})},'scalar-missing-'+base+'-'+lane+'-'+constant);
 for(const [label,options]of [
  ['normalized32-divisor',{format:35,instances:5,divisor:2}],['normalized32-shared',{format:43,shared:true}],
  ['scaled32-shared-overlap',{format:47,shared:true,stride:8,wordLane:1}],['scaled32-overlap',{format:39,stride:4,wordLane:2}],
  ['scaled16-overlap',{format:55,stride:2,wordLane:1}],['scaled-byte-stride-three',{format:84,stride:3}],['scaled-short-stride-six',{format:62,stride:6}],
  ['scaled32-constant-round',{format:39,stride:0,values:[[16777217,4294967295,33554431,1]],wordLane:0}],
  ['scaled32-divisor',{format:39,instances:3,divisor:1,wordLane:2}],['scaled32-huge-divisor',{format:47,instances:3,divisor:0xffffffff,wordLane:2}],
  ['scalar-array-instance',{format:43,indexed:false,instances:3}],['scalar-constant-array',{format:32,indexed:false,stride:0}],
  ['scalar-negative-y',{format:44,negativeY:true,wordLane:0}],['scalar-wide-byte-index',{format:69,indexSize:1,ids:[7,9,255],wordLane:0}],
  ['scalar-u32-index',{format:60,indexSize:4,wordLane:0}],['scalar-restart-byte',{format:82,indexSize:1,enabled:true}],
  ['scalar-restart-u16',{format:35,enabled:true}],['scalar-restart-u32',{format:47,indexSize:4,enabled:true,wordLane:0}],
  ['scalar-native-marker',{format:69,enabled:true,restartIndex:65535}],['scalar-all-restart',{format:36,stride:0,enabled:true,ids:[61,61,61]}],
  ['scalar-zero-instance',{format:84,indexed:false,instances:0}],['scalar-shared-constant',{format:47,shared:true,stride:0,wordLane:0}],
  ['scalar-shared-byte',{format:82,shared:true,stride:1,wordLane:0}],['scalar-rgb32-stride12',{format:42,stride:12}],
 ])await draw(options,label,{delay:3,step:2});
 for(const options of [{shortColor:true},{format:32,stride:0,shortColor:true},{shortPosition:true},{shortIndex:true},{format:36,stride:3},{format:47,bufferOffset:0,sourceOffset:1},{positionOffset:0,positionSourceOffset:1},{format:69,stride:256}]){
  const s=scalarSpec(options),r=make(s),record=await scalarSubmit(r,1,join(scalarSetup(r,s),scalarDraw(s)),'reject-'+JSON.stringify(options));c.same(record.result.ok,false,'compact invalid source rejects');c.same(r.trace.calls.length,0,'compact invalid source before native draw');report.rejections.push({record,events:r.trace.events});done(r);
 }
 for(const admitted of [true,false]){const s=scalarSpec({format:39,stride:0,wordLane:0}),limit=22-(admitted?0:1),r=make(s,{jobLimits:{transferBytes:limit}}),record=await scalarSubmit(r,1,join(scalarSetup(r,s,{uploadChunk:limit}),scalarDraw(s)),admitted?'exact-compact-staging':'short-compact-staging');
  if(admitted)await scalarFrame(r,record);else {c.same(record.result.error.code,'limit-exceeded','compact aggregate source staging bound');c.same(r.trace.calls.length,0,'compact staging bound before draw');c.same(r.trace.events.filter(e=>e.name==='copyBufferSubData').length,0,'compact staging before read allocation');report.rejections.push({record,events:r.trace.events});}done(r);}
 for(const admitted of [true,false]){const s=scalarSpec({format:47,instances:2,divisor:1,wordLane:0}),r=make(s,{drawLimits:{indicesPerSubmission:admitted?6:5}}),record=await scalarSubmit(r,1,join(scalarSetup(r,s),scalarDraw(s)),admitted?'scalar-exact-work':'scalar-short-work');
  if(admitted)await scalarFrame(r,record);else {c.same(record.result.error.code,'limit-exceeded','scalar total original vertex work');c.same(r.trace.calls.length,0,'scalar work ceiling before native draw');report.rejections.push({record,events:r.trace.events});}done(r);
 }
 for(const phase of ['waiting-index','waiting-attributes'])for(const action of ['revision','cancel','reuse']){
  const s=scalarSpec({format:47,wordLane:0,...(phase==='waiting-attributes'?{stride:0}:{})}),r=make(s,{delay:7,step:1});c.ok((await scalarSubmit(r,1,scalarSetup(r,s),'pending-setup-'+phase+'-'+action)).result,'compact pending setup');let fired=false,point;
  const oldGeneration=r.allocations.find(a=>a.metadata.id===s.colorId).generation,record=await scalarSubmit(r,1,join(clear([0,0,0,0]),scalarDraw(s)),'pending-'+phase+'-'+action,(_step,token)=>{
   const inspection=c.ok(r.renderer.inspect(),'compact suspended ownership');if(fired||inspection.jobs.status!==phase)return;fired=true;point={inspection,events:r.trace.events.map(a=>({...a}))};
   if(action==='cancel')c.ok(r.renderer.cancel(token),'cancel compact batch');
   else if(action==='revision'){const id=phase==='waiting-index'?6:s.colorId,bytes=s.data.get(id).slice();bytes.fill(123);c.ok(r.store.writeBacking(id,0,bytes),'change retained compact backing');const command=c.ok(decodeStandardSubmission(packet(43,0,[id,0,0,0,0,0,0,0,bytes.length,1,1,0,1])),'compact concurrent transfer packet').commands[0],access=c.ok(r.store.prepareTransfer(1,command),'compact concurrent upload ownership');c.ok(r.store.executeTransfer(access.ticket),'actual compact GPU revision');}
   else {c.ok(r.store.unref(s.colorId),'drop public compact name');add(r,meta(s.colorId,0,64,16,s.data.get(s.colorId).length),new Uint8Array(s.data.get(s.colorId).length));}
  });c.same(fired,true,'actual compact pending phase reached');if(action==='reuse'){await scalarFrame(r,record);c.same(record.result.draws[0].vertexFetches.find(f=>f.attributeIndex===1).resourceGeneration,oldGeneration,'compact retained old source generation');}
  else {c.same(record.result.ok,false,'compact pending mutation rejects');c.same(record.result.gpuComplete,true,'compact pending error drains fences');c.same(r.trace.calls.length,0,'compact pending error never draws');}
  report.suspensions.push({phase,action,point,record});done(r);
 }
 {const a=scalarSpec({format:43}),b=scalarSpec({format:47,stride:0,negativeY:true}),r=make(a,{delay:4,step:1}),vao=gl.createVertexArray(),buffer=gl.createBuffer(),ebo=gl.createBuffer();await scalarFrame(r,await scalarSubmit(r,1,join(scalarSetup(r,a),scalarDraw(a)),'restore-A-first'));
  const poison=()=>{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(256),gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.vertexAttribPointer(i,2,gl.UNSIGNED_BYTE,false,3,1);gl.vertexAttribDivisor(i,11);gl.vertexAttrib4f(i,.9,.8,.7,.6);gl.enableVertexAttribArray(i);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([1,1,1]),gl.STATIC_DRAW);c.same(gl.getError(),gl.NO_ERROR,'legal native compact poison');};
  poison();await scalarFrame(r,await scalarSubmit(r,2,join(scalarSetup(r,b,{create:false}),scalarDraw(b)),'restore-B'));poison();r.spec=a;r.bufferBytes=a.data;for(const [id,raw]of a.data)c.ok(r.store.writeBacking(id,0,raw),'restore original A compact backing');await scalarFrame(r,await scalarSubmit(r,1,join(...[...a.data].map(([id,raw])=>packet(43,0,[id,0,0,0,0,0,0,0,raw.length,1,1,0,1])),clear([0,0,0,0]),scalarDraw(a)),'restore-A-last'));gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);gl.deleteBuffer(ebo);done(r);
 }
 {const s=scalarSpec({format:47,stride:0,wordLane:0}),r=make(s,{delay:6,step:1});c.ok((await scalarSubmit(r,1,scalarSetup(r,s),'dispose-setup')).result,'compact disposal setup');r.currentLabel='dispose';r.trace.label('dispose');const token=c.ok(r.renderer.beginSubmission(1,scalarDraw(s)),'compact disposal job').job;let before;
  for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'compact disposal advance');const state=r.renderer.inspect();if(state.jobs.status==='waiting-attributes'){before=state;break;}}
  c.same(Boolean(before),true,'compact disposal has actual retained read batch');c.ok(r.renderer.dispose(),'dispose compact active batch');report.ownership.push({phase:'waiting-attributes',before,after:r.asyncAccess.inspect(),events:r.trace.events.map(a=>({...a}))});c.same(r.renderer.step(token).ok,false,'disposed compact token rejects');done(r);
 }
 report.range=[...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];report.status='passed';return report;
}
