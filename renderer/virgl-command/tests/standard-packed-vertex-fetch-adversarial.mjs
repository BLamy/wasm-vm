// Fresh D15 verifier attacks; fixture construction is separate from the own
// original-wire/original-byte oracle. No production renderer source is changed.
import {decodeStandardSubmission,decodeSubmission,floatingVertexFormat,vertexFormat} from '../decoder.mjs';
import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks,meta,add,clear,dispose,packet,join} from './standard-instanced-draws.mjs';
import {compactFrame} from './standard-compact-vertex-fetch.mjs';
import {packedSpec,packedSetup,packedRig,packedSubmit,packedDraw} from './standard-packed-vertex-fetch.mjs';
import {criticModel,criticPixels,originalPacked} from '../../../tools/virgl-command/standard-packed-adversarial-oracle.mjs';
const seeds=[0x27c52ad1,0xb73e168c,0x694d803f];
const oracle={model:criticModel,compare:criticPixels};
const encode=lanes=>lanes.reduce((word,value,lane)=>word+((value%(lane===3?4:1024)+(lane===3?4:1024))%(lane===3?4:1024))*2**(lane*10),0);
function doubleSpec(options,extra){
 const s=packedSpec(options),valid=s.ids.filter(id=>!s.enabled||id!==s.restartIndex),last=extra.stride===0?0:extra.divisor?Math.floor((Math.max(1,s.instances)-1)/extra.divisor):Math.max(...valid);
 s.extra={format:extra.format,stride:extra.stride,divisor:extra.divisor??0,offset:extra.offset??4};
 const raw=new Uint8Array(s.extra.offset+last*extra.stride+4),v=new DataView(raw.buffer),ids=extra.stride===0?[0]:extra.divisor?Array.from({length:last+1},(_,i)=>i):[...new Set(valid)];
 ids.forEach((id,i)=>v.setUint32(s.extra.offset+id*extra.stride,encode(extra.values[i%extra.values.length]),true));s.data.set(7,raw);
 // The same original slot0 bytes are observed during array -> constant changes.
 new DataView(s.data.get(s.colorId).buffer).setUint32(s.bufferOffset+s.sourceOffset,encode(options.values[0]),true);
 v.setUint32(s.extra.offset,encode(extra.values[0]),true);
 s.vertex=s.vertex.replace('DCL IN[1]','DCL IN[1]\nDCL IN[15]');
 if(s.wordLane===null)s.vertex=s.vertex.replace('MAD OUT[1], IN[1], IMM[1], IMM[3]','ADD TEMP[2], IN[1], IN[15]\nMAD OUT[1], TEMP[2], IMM[1], IMM[3]');
 else s.vertex=s.vertex.replace(`MOV TEMP[2].x, IN[1].${'xyzw'[s.wordLane].repeat(4)}`,`ADD TEMP[2].x, IN[1].${'xyzw'[s.wordLane].repeat(4)}, IN[15].${'xyzw'[s.wordLane].repeat(4)}`);
 return s;
}
function setup(r,s){
 const raw=packedSetup(r,s);if(!s.extra)return raw;
 const view=new DataView(raw.buffer),parts=[];
 for(let at=0;at<raw.length;){const h=view.getUint32(at,true),length=((h>>>16)+1)*4;
  if((h&65535)===1281){const fields=[3];for(let i=0;i<16;i++)fields.push(...(i===1?[s.sourceOffset,s.divisor,1,s.format]:i===15?[0,s.extra.divisor,2,s.extra.format]:[s.positionSourceOffset,0,0,i===0?s.positionFormat:28]));parts.push(packet(1,5,fields));}
  else if((h&65535)===6)parts.push(packet(6,0,[s.positionStride,s.positionOffset,3,s.stride,s.bufferOffset,s.colorId,s.extra.stride,s.extra.offset,7]));
  else parts.push(raw.subarray(at,at+length));at+=length;
 }
 return join(...parts);
}
export async function runAcceptance({smoke=false,constantFault=false,mutation}={}){
 const c=checks(),report={schema:'standard-packed-critic-physical-v1',status:'running',seeds,frames:[],runs:[],rejections:[],suspensions:[],ownership:[],blobs:[],predictions:c.rows,guestExecution:false,productionNegotiation:false,portableDomainCertified:false};window.__standardPackedEvidence=report;
 const gl=document.getElementById('gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw Error('critic requires real WebGL2');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};
 if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('critic hardware renderer');
 const bridge=await createVirglStandardShaderBridge(),make=(s,opts={})=>{const r=packedRig(gl,opts.bridge??bridge,c,s,opts);r.frames=report.frames;r.blobs=report.blobs;return r;},done=r=>{
  const inspection=c.ok(r.renderer.inspect(),'critic final ownership');for(const key of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspection.jobs[key],0,'critic drained '+key);
  report.runs.push({history:r.history,events:r.trace.events,calls:r.trace.calls.map(({program,...x})=>x),nativeState:r.nativeState,inspection});dispose(r);
 };
 const frame=async(r,bytes,label,onYield)=>compactFrame(r,await packedSubmit(r,1,bytes,label,onYield),oracle);
 const draw=async(s,label,opts={})=>{const r=make(s,opts);await frame(r,join(setup(r,s),packedDraw(s)),label);done(r);};
 // Original literal alpha words; these same promoted assertions are attacked by
 // real completed served-runtime faults when --smoke/--mutation is selected.
 if(smoke){
  const s=packedSpec({format:constantFault?173:mutation==='native-normalize'?8:172,attributeIndex:15,
   values:[constantFault||mutation!=='native-normalize'?[-512,-511,511,-2]:[128,512,900,3]],...(constantFault?{stride:0,wordLane:3}:mutation==='native-normalize'?{}:{wordLane:3})});
  await draw(s,'critic-sabotage-'+mutation,{delay:5,step:1});report.status='passed';return report;
 }
 for(const seed of seeds){
  let state=seed>>>0;const rng=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
  const signed=[[-512,-511,511,-2],[-1,0,1,-1],[511,-512,255,1],[rng()%1024-512,rng()%1024-512,rng()%1024-512,0]],
   unsigned=[[0,1023,512,3],[1023,1,1022,2],[1,511,513,1],[rng()%1024,rng()%1024,rng()%1024,0]],delay=5+rng()%6,offset=4*(1+rng()%15),ids=[3+rng()%4,12+rng()%4,24+rng()%4];
  for(const format of [8,123,172,173])for(const constant of [false,true]){
   const s=packedSpec({seed,format,attributeIndex:15,ids,values:format>=172?signed:unsigned,stride:constant?0:252,bufferOffset:offset-3,sourceOffset:3});
   await draw(s,'critic-seed-'+seed+'-'+format+'-'+constant,{delay,step:1+rng()%3});
  }
  for(const format of [172,173])for(const lane of [0,3])await draw(packedSpec({seed,format,attributeIndex:15,ids,wordLane:lane,values:[signed[0]],stride:format===173&&lane===0?0:4}),'critic-sign-'+seed+'-'+format+'-'+lane,{delay,step:1});
  for(const positionFormat of [196,200])await draw(packedSpec({seed,format:173,positionFormat,ids,values:signed,wordLane:3}),'critic-mixed-integer-'+seed+'-'+positionFormat,{delay,step:2});
  for(const format of [172,173])await draw(packedSpec({seed,format,attributeIndex:15,shared:true,positionStride:0,stride:0,ids,values:[signed[0]],wordLane:3}),'critic-shared-mixed-batch-'+seed+'-'+format,{delay,step:1});
  for(const opts of [{format:172,stride:252,shortColor:true},{format:173,stride:0,shortColor:true},{format:172,stride:252,bufferOffset:offset-3,sourceOffset:4},{format:173,stride:256}]){
   const s=packedSpec({seed,attributeIndex:15,ids,...opts}),r=make(s,{delay,step:1}),record=await packedSubmit(r,1,join(setup(r,s),packedDraw(s)),'critic-bound-'+seed+'-'+JSON.stringify(opts));
   c.same(record.result.ok,false,'critic original one-short/alignment/stride');c.same(r.trace.calls.length,0,'critic bound before draw');report.rejections.push({record,events:r.trace.events});done(r);
  }
  for(const action of ['revision','reuse','cancel']){
   const s=packedSpec({seed,format:173,attributeIndex:15,shared:true,positionStride:0,stride:0,ids,values:[signed[0]],wordLane:3}),r=make(s,{delay,step:1});
   c.ok((await packedSubmit(r,1,setup(r,s),'critic-pending-setup-'+seed+'-'+action)).result,'critic pending setup');let fired=false,point;
   const generation=r.allocations.find(a=>a.metadata.id===s.colorId).generation,record=await packedSubmit(r,1,join(clear([0,0,0,0]),packedDraw(s)),'critic-pending-'+seed+'-'+action,(_step,token)=>{
    const inspection=c.ok(r.renderer.inspect(),'critic suspended original source');if(fired||inspection.jobs.status!=='waiting-attributes')return;fired=true;point={inspection,events:r.trace.events.map(e=>({...e}))};
    if(action==='cancel')c.ok(r.renderer.cancel(token),'critic cancel mixed batch');
    else if(action==='reuse'){c.ok(r.store.unref(s.colorId),'critic drop public shared name');add(r,meta(s.colorId,0,64,16,s.data.get(s.colorId).length),new Uint8Array(s.data.get(s.colorId).length));}
    else {const bytes=s.data.get(s.colorId).slice();bytes.fill(0xa5);c.ok(r.store.writeBacking(s.colorId,0,bytes),'critic changed backing');const command=c.ok(decodeStandardSubmission(packet(43,0,[s.colorId,0,0,0,0,0,0,0,bytes.length,1,1,0,1])),'critic original transfer').commands[0],ticket=c.ok(r.store.prepareTransfer(1,command),'critic owned transfer');c.ok(r.store.executeTransfer(ticket.ticket),'critic actual GPU revision');}
   });c.same(fired,true,'critic actual mixed pending read phase');
   if(action==='reuse'){await compactFrame(r,record,oracle);for(const fetch of record.result.draws[0].vertexFetches)c.same(fetch.resourceGeneration,generation,'critic both shared inputs retain old generation');}
   else {c.same(record.result.ok,false,'critic pending stale/cancel rejects');c.same(record.result.gpuComplete,true,'critic pending fence drain');c.same(r.trace.calls.length,0,'critic pending no draw');}
   report.suspensions.push({seed,phase:'waiting-attributes',action,point,record});done(r);
  }
  // Novel bounded attack: both packed inputs are live at once with a mixed
  // normalized subset. A single-bit mask/stride mistake changes exact alpha.
  for(const evict of [false,true]){
   const requests=[],traced={...bridge,translatePairVertexFormats(request){requests.push(Object.fromEntries(['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask'].map(k=>[k,request[k]])));return bridge.translatePairVertexFormats(request);},translatePair(request){requests.push({signedMask:0,unsignedMask:0,packedSignedMask:0,packedNormalizedMask:0});return bridge.translatePair(request);}},
    s=doubleSpec({seed,format:172,ids,values:[signed[0]],wordLane:3},{format:173,stride:4,values:[signed[0]]}),r=make(s,{bridge:traced,delay,step:1,...(evict?{stateLimits:{programs:1},cacheLimits:{translations:1}}:{})}),programs=[];
   for(const [i,[format,stride,extraFormat,extraStride]]of [[172,4,173,4],[173,4,172,4],[173,0,172,4],[173,0,172,0],[172,4,173,4]].entries()){
    const ve=[20+i];for(let j=0;j<16;j++)ve.push(...(j===1?[s.sourceOffset,0,1,format]:j===15?[0,0,2,extraFormat]:[s.positionSourceOffset,0,0,j===0?31:28]));
    const bytes=i===0?setup(r,s):join(packet(1,5,ve),packet(2,5,[20+i]),packet(6,0,[s.positionStride,s.positionOffset,3,stride,s.bufferOffset,s.colorId,extraStride,s.extra.offset,7]),clear([0,0,0,0]));
    await frame(r,join(bytes,packedDraw(s)),'critic-double-packed-'+seed+'-'+evict+'-'+i);programs.push(r.nativeState.at(-1).program);
   }
   const expected=[[0,0,32770,32768],[0,0,32770,2],[0,0,32768,0],[0,0,0,0],...(evict?[[0,0,32770,32768]]:[])].map(a=>Object.fromEntries(['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask'].map((k,i)=>[k,a[i]])));
   c.same(requests,expected,'critic simultaneous masks derive from each original stride/format');c.same(programs[0]===programs[4],!evict,'critic mixed variant cache identity');
   report.ownership.push({seed,phase:'double-packed-variants',evict,requests,programs});done(r);
  }
  // Poison the actual native VAO/generic/divisor/index state between array and
  // mixed constant contexts, then restore original source uploads.
  {const a=packedSpec({seed,format:173,attributeIndex:15,ids,values:signed}),b=packedSpec({seed,format:172,attributeIndex:15,stride:0,ids,values:[signed[0]],wordLane:3}),r=make(a,{delay,step:1});
   await frame(r,join(setup(r,a),packedDraw(a)),'critic-restore-'+seed+'-A');
   const vao=gl.createVertexArray(),buffer=gl.createBuffer(),ebo=gl.createBuffer(),poison=()=>{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(512),gl.STATIC_DRAW);for(let i=0;i<gl.getParameter(gl.MAX_VERTEX_ATTRIBS);i++){gl.vertexAttribPointer(i,2,gl.UNSIGNED_BYTE,false,3,1);gl.vertexAttribDivisor(i,13);gl.vertexAttrib4f(i,.2,.4,.6,.8);gl.enableVertexAttribArray(i);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,0,0]),gl.STATIC_DRAW);c.same(gl.getError(),gl.NO_ERROR,'critic legal poison');};
   poison();const raw=packedSetup(r,b,{create:false});await compactFrame(r,await packedSubmit(r,2,join(raw,packedDraw(b)),'critic-restore-'+seed+'-B'),oracle);
   poison();r.bufferBytes=a.data;for(const[id,bytes]of a.data)c.ok(r.store.writeBacking(id,0,bytes),'critic restore backing');await frame(r,join(...[...a.data].map(([id,bytes])=>packet(43,0,[id,0,0,0,0,0,0,0,bytes.length,1,1,0,1])),clear([0,0,0,0]),packedDraw(a)),'critic-restore-'+seed+'-A2');
   gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);gl.deleteBuffer(ebo);done(r);
  }
 }
 // 4MiB is the unchanged per-resource ceiling. This is the largest legal
 // aligned native attribute offset under that existing dependency boundary.
 for(const stride of [0,252])for(const shortColor of [false,true]){
  const s=packedSpec({format:stride?172:173,attributeIndex:15,ids:[0],stride,bufferOffset:4194297,sourceOffset:3,values:[[-512,-511,511,-2]],wordLane:3,shortColor}),r=make(s,{delay:7,step:1}),label='critic-maximum-offset-'+stride+'-'+shortColor,record=await packedSubmit(r,1,join(setup(r,s),packedDraw(s)),label);
  if(shortColor){c.same(record.result.ok,false,'critic maximum offset one-short rejects');c.same(r.trace.calls.length,0,'critic maximum offset one-short before draw');report.rejections.push({record,events:r.trace.events});}
  else {await compactFrame(r,record,oracle);c.same(record.result.draws[0].vertexFetches.find(f=>f.attributeIndex===15).requiredEnd,4194304,'critic exact per-resource final four-byte extent');}done(r);
 }
 for(const format of [8,123,172,173]){const raw=packet(1,5,[777,0xfffffffb,0xffffffff,0,format]);c.same(decodeStandardSubmission(raw).ok,true,'critic original uint32 exact element end');c.same(decodeSubmission(raw).ok,false,'critic old factory remains isolated');c.same(floatingVertexFormat(format),null,'critic old floating descriptor isolated');c.same(vertexFormat(format).elementBytes,4,'critic original packed extent');c.same(Object.isFrozen(vertexFormat(format)),true,'critic immutable descriptor');c.same(decodeStandardSubmission(packet(1,5,[777,0xfffffffc,0xffffffff,0,format])).ok,false,'critic one-short uint32 end');}
 // Literal decode anchors exist before observing any GPU values.
 const original=new Uint8Array(4);new DataView(original.buffer).setUint32(0,encode([-512,-511,511,-2]),true);
 c.same(originalPacked(original,0,172).values,[-512,-511,511,-2],'critic signed widths literal');c.same(originalPacked(original,0,173).values,[-1,-1,1,-1],'critic signed normalization literal');
 report.range=[...gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)];report.status='passed';return report;
}
