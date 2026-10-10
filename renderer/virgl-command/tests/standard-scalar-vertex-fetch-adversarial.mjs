import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {decodeStandardSubmission,decodeSubmission,floatingVertexFormat} from '../decoder.mjs';
import {checks,packet,join,hex,blob,clear,meta,add,dispose} from './standard-instanced-draws.mjs';
import {compactSetup,compactRig,compactSubmit,compactDraw} from './standard-compact-vertex-fetch.mjs';
import {criticModel,criticCompare,criticFormat} from '../../../tools/virgl-command/standard-scalar-adversarial-oracle.mjs';

const SEED=0xd35a7e19;

// Generate literal original bytes independently of both runtime and worker
// fixture. The separate critic model derives its expectations from these bytes.
function compactSpec(options={}) {
 const row=[[32,4,false],[40,4,true],[36,4,false],[44,4,true],[52,2,false],[60,2,true],[69,1,false],[82,1,true]].find(([b])=>options.format>=b&&options.format<b+4);
 if(!row)throw Error('critic literal storage format');
 const [base,bytes,signed]=row,components=options.format-base+1,s={instances:3,indexed:true,indexSize:2,indexOffset:10,start:4,enabled:false,restartIndex:53,divisor:0,positionOffset:3,positionSourceOffset:1,positionStride:16,shared:true,seed:SEED,wordLane:null,negativeY:false,...options};
 s.stride=s.stride??components*bytes;s.ids=s.ids??[3,8,13];
 if(s.enabled&&options.ids===undefined)s.ids=[s.restartIndex,...s.ids,s.restartIndex];
 s.count=s.ids.length;s.width=16*Math.max(1,s.instances);s.height=16;
 const valid=s.ids.filter(id=>!s.enabled||id!==s.restartIndex),max=valid.length?Math.max(...valid):0,n=Math.max(1,s.instances),positionPrefix=s.positionOffset+s.positionSourceOffset,positionLength=positionPrefix+max*s.positionStride+16;
 s.bufferOffset=options.bufferOffset??(s.shared?positionLength+1:1);s.sourceOffset=options.sourceOffset??bytes-1;
 const prefix=s.bufferOffset+s.sourceOffset,last=s.stride===0?0:s.divisor?Math.floor((n-1)/s.divisor):max,colorLength=prefix+last*s.stride+components*bytes-(s.shortColor?1:0);
 const position=new Uint8Array(s.shared?Math.max(positionLength,colorLength):positionLength-(s.shortPosition?1:0)),color=s.shared?position:new Uint8Array(colorLength);
 let seed=s.seed>>>0;const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 for(const raw of [...new Set([position,color])])raw.forEach((_,i)=>raw[i]=next()&255);
 const pv=new DataView(position.buffer),centers=[[3.375,4.375],[8.375,9.375],[12.375,5.375]];
 for(const [i,id]of [...new Set(valid)].entries())for(const [lane,value]of [Math.fround(centers[i%3][0]/8-1),Math.fround(centers[i%3][1]/8-1),id,1].entries()){
  const at=positionPrefix+id*s.positionStride+4*lane;if(at+4<=position.length)pv.setFloat32(at,value,true);
 }
 const indices=s.stride===0?[0]:s.divisor?Array.from({length:last+1},(_,i)=>i):[...new Set(valid)];
 const top=signed?2**(8*bytes-1)-1:2**(8*bytes)-1,bottom=signed?-(2**(8*bytes-1)):0;
 for(const [i,index]of indices.entries())for(let lane=0;lane<components;lane++){
  const at=prefix+index*s.stride+lane*bytes;if(at+bytes>color.length)continue;
  let value=s.values?.[i%s.values.length]?.[lane]??(i===0?bottom:i===1?top:signed?-(next()%(top+1)):next()%(top+1));
  let integer=BigInt(value);if(integer<0)integer+=1n<<BigInt(bytes*8);
  for(let j=0;j<bytes;j++)color[at+j]=Number(integer>>BigInt(j*8)&255n);
 }
 s.data=new Map([[3,position],...(s.shared?[]:[[4,color]])]);s.colorId=s.shared?3:4;
 if(s.indexed){const raw=new Uint8Array(s.indexOffset+s.count*s.indexSize-(s.shortIndex?1:0));for(const [i,id]of s.ids.entries())for(let j=0;j<s.indexSize;j++){const at=s.indexOffset+i*s.indexSize+j;if(at<raw.length)raw[at]=id/2**(8*j)&255;}s.data.set(6,raw);}
 const f=Math.fround,body=['I2F TEMP[0].x, SV[0].xxxx','MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].yyyy, IMM[0].zzzz','MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx','MOV OUT[0].y, IN[0].yyyy','MOV OUT[0].z, IMM[3].wwww','I2F TEMP[1].x, SV[1].xxxx','SEQ TEMP[1].x, TEMP[1].xxxx, IN[0].zzzz','MUL OUT[0].w, TEMP[1].xxxx, IN[0].wwww',...(s.wordLane===null?['MAD OUT[1], IN[1], IMM[1], IMM[3]']:[`MOV TEMP[2].x, IN[1].${'xyzw'[s.wordLane].repeat(4)}`,'USHR TEMP[2], TEMP[2].xxxx, IMM[2]','AND TEMP[2], TEMP[2], IMM[4]','U2F TEMP[2], TEMP[2]','MUL OUT[1], TEMP[2], IMM[0].wwww'])];
 s.vertex='VERT\nDCL IN[0]\nDCL IN[1]\nDCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..2]\n'+`IMM[0] FLT32 {${f(1/n)},${f(2/n)},${f(-1+1/n)},0.00392156862745098}\nIMM[1] FLT32 {0.5,0.5,0.5,1}\nIMM[2] UINT32 {0,8,16,24}\nIMM[3] FLT32 {0.5,0.5,0.5,0}\nIMM[4] UINT32 {255,255,255,255}\n`+[...body,'END'].map((line,i)=>i+': '+line+'\n').join('');
 s.fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';return s;
}

export async function runAcceptance({smoke=false,mutation}={}) {
 const c=checks(),report={schema:'standard-scalar-critic-seeded-v1',seed:SEED,status:'running',frames:[],runs:[],wire:[],rejections:[],suspensions:[],ownership:[],blobs:[],predictions:c.rows,guestExecution:false,productionNegotiation:false,portableNaNPayload:false};
 window.__standardScalarEvidence=report;
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw Error('critic requires actual WebGL2');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};
 if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('critic requires hardware');
 const bridge=await createVirglStandardShaderBridge();let seed=SEED;
 const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 const make=s=>{const schedule=next(),r=compactRig(gl,bridge,c,s,{step:1+next()%3,delay:({ordinal})=>(schedule>>>((ordinal%8)*4))&7});r.blobs=report.blobs;r.frames=report.frames;return r;};
 const prediction=(r,s,bytes,ctx=1)=>criticModel([...r.history,{ctx,hex:hex(bytes)}],s.data,r.range);
 const assertWords=(a,b,nan,label)=>{c.same(a.length,b.length,label+' word count');a.forEach((w,i)=>c.same(nan[i]?(w&0x7f800000)===0x7f800000&&(w&0x7fffff)!==0:w===b[i],true,label+' lane'+i));};
 async function frame(r,record,expected) {
  c.ok(record.result,'critic actual native draw completed');c.same(record.result.gpuComplete,true,'critic actual final fence');
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
  for(const n of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[n],0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
  const pixels=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.deleteFramebuffer(fb);
  const draw=record.result.draws.at(-1),native=[],normalized=[];
  for(const [id,original]of r.bufferBytes){const generation=id===6?draw.indexResourceGeneration:draw.vertexFetches.find(f=>f.resourceId===id).resourceGeneration,a=r.allocations.find(a=>a.metadata.id===id&&a.generation===generation),raw=new Uint8Array(original.length);
   gl.bindBuffer(gl.COPY_READ_BUFFER,a.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,null);c.same(hex(raw),hex(original),'critic original full native upload '+id);native.push({resourceId:id,generation,nativeBuffer:r.trace.id(a.storage.buffer),blob:await blob(r,raw)});}
  for(const n of r.normalized.filter(n=>n.label===record.label)){c.same(n.deleted,true,'critic private indices released');c.same(hex(n.raw),hex(expected.normalized),'critic original restart conversion');normalized.push({nativeBuffer:n.nativeBuffer,blob:await blob(r,n.raw)});}
  const audit=criticCompare(pixels,expected,r.width,r.height),state=r.nativeState.filter(s=>s.label===record.label),calls=r.trace.calls.filter(a=>a.label===record.label).map(({program,...a})=>a),f={label:record.label,width:r.width,height:r.height,range:r.range,history:r.history.map(h=>({...h})),inputs:r.exchanges.map(e=>({...e})),native:{buffers:native,normalized,state,calls},prediction:{fetches:expected.fetches,ids:expected.ids,vertices:expected.vertices},audit,pixels:await blob(r,pixels)};
  report.frames.push(f);
  // Pixel comparison comes first so a real served conversion sabotage must
  // complete its draw/fence and be caught by this promoted TGSI oracle.
  c.same(audit.misses,[],record.label+' critic original TGSI pixels');
  c.same(calls.length,1,'critic native draw count');const instanced=expected.draw.instances>1;
  c.same(calls[0].name,(expected.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''),'critic original native draw entry');
  c.same(calls[0].args,expected.draw.indexed?[0,expected.draw.count,{1:5121,2:5123,4:5125}[expected.nativeSize],expected.nativeOffset,...(instanced?[expected.draw.instances]:[])]:[0,expected.draw.start,expected.draw.count,...(instanced?[expected.draw.instances]:[])],'critic literal native draw arguments');
  const physical=state.at(-1);c.same(physical.pointSize,expected.pointUniform,'critic native point uniform');
  for(const fetch of expected.fetches){const a=physical.attributes.find(a=>a.name==='in_'+fetch.attributeIndex),actual=draw.vertexFetches.find(a=>a.attributeIndex===fetch.attributeIndex),source=native.find(b=>b.resourceId===fetch.resourceId);
   for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])c.same(actual[key],fetch[key],'critic literal fetch '+key);
   c.same([a.enabled,a.integer,a.divisor],[!fetch.constant,false,fetch.nativeDivisor],'critic native input/divisor');c.same(actual.resourceGeneration,source.generation,'critic retained source generation');
   if(fetch.constant){const all=[...new Uint32Array(new Float32Array(fetch.genericValues).buffer)];assertWords(actual.componentWords,fetch.componentWords,fetch.nan,'critic supplied generic');assertWords(a.genericWords,all,fetch.nan,'critic actual generic');
    const raw=r.bufferBytes.get(fetch.resourceId).subarray(fetch.offset,fetch.offset+fetch.elementBytes),events=r.trace.events.filter(e=>e.label===record.label);c.same(events.some(e=>e.name==='getBufferSubData'&&e.bytes===fetch.elementBytes&&e.hex===hex(raw)),true,'critic exact retained source bytes');c.same(events.some(e=>e.name==='copyBufferSubData'&&e.source===source.nativeBuffer&&e.args[2]===fetch.offset&&e.args[4]===fetch.elementBytes),true,'critic retained original source range');
   }else c.same([a.buffer,a.type,a.normalized,a.components,a.stride,a.offset],[source.nativeBuffer,fetch.nativeType,fetch.normalized,fetch.components,fetch.stride,fetch.offset],'critic actual native pointer');}
  c.same(gl.getError(),gl.NO_ERROR,'critic GPU capture');return f;
 }
 function done(r){const inspect=c.ok(r.renderer.inspect(),'critic ownership');for(const k of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspect.jobs[k],0,'critic zero '+k);report.runs.push({inspection:inspect,history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a)});dispose(r);}
 async function draw(options,label){const s=compactSpec(options),r=make(s),bytes=join(compactSetup(r,s),compactDraw(s)),expected=prediction(r,s,bytes);await frame(r,await compactSubmit(r,1,bytes,label),expected);done(r);}
 for(const base of [32,40,36,44,52,60,69,82])for(let lane=0;lane<4;lane++)for(const divisor of [0,5,0xffffffff])for(const offset of [0,1,0xffffffff-criticFormat(base+lane).bytes*(lane+1),0xffffffff-criticFormat(base+lane).bytes*(lane+1)+1]){
  const format=base+lane,spec=criticFormat(format),expected=offset+spec.bytes*spec.components<=0xffffffff,raw=packet(1,5,[777,offset,divisor,0,format]),standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw);
  c.same(standard.ok,expected,'critic literal scalar packet end');c.same(legacy.ok,false,'critic legacy remains gated');report.wire.push({hex:hex(raw),expected,legacyExpected:false,standard,legacy});
 }
 for(const format of [0,27,68,78,87,95,123,172,173,177,193,0xffffffff]){const raw=packet(1,5,[777,0,0,0,format]),standard=decodeStandardSubmission(raw),legacy=decodeSubmission(raw);c.same([standard.ok,legacy.ok],[false,false],'critic packed and integer remain gated');report.wire.push({hex:hex(raw),expected:false,legacyExpected:false,standard,legacy});}
 for(const value of [NaN,Infinity,null,undefined,'32',{},-1])c.same(floatingVertexFormat(value),null,'critic descriptor caller type does not coerce');
 if(smoke){await draw({format:47,shared:true,ids:[2,5,11],values:[[mutation==='constant-scaled'?16777223:-2147483648,-16777223,33554435,2147483647]],wordLane:0,...(mutation==='constant-scaled'?{stride:0}:{})},'critic-sabotage-'+mutation);report.status='passed';return report;}
 for(const base of [32,40,36,44,52,60,69,82])for(let lane=0;lane<4;lane++)for(const constant of [false,true]){
  await draw({format:base+lane,seed:next(),shared:true,ids:[2+next()%2,7+next()%2,13+next()%3],instances:3,divisor:constant?0xffffffff:next()%2?2:0,stride:constant?0:(lane+1)*criticFormat(base+lane).bytes+(next()%2)*criticFormat(base+lane).bytes,
    wordLane:[32,40].includes(base)&&!constant?null:next()%4},'critic-seeded-'+(base+lane)+'-'+constant);
 }
 for(const [format,values]of [[39,[16777221,16777223,33554433,33554435]],[47,[-16777221,-16777223,-2147483648,2147483647]],[35,[16777221,16777223,33554433,33554435]],[43,[-2147483648,-16777223,33554435,2147483647]]])for(const constant of [false,true])for(let lane=0;lane<2;lane++){
  await draw({format,seed:next(),values:[values],stride:constant?0:16,wordLane:[35,43].includes(format)&&!constant?null:lane},'critic-rational-'+format+'-'+constant+'-'+lane);
 }
 for(const [label,options]of [
  ['byte-non4-overlap',{format:85,stride:3,wordLane:2}],['short-non4-overlap',{format:63,stride:6,wordLane:1}],
  ['u32-overlap',{format:39,stride:4,wordLane:3}],['signed-huge-divisor',{format:47,instances:5,divisor:0xffffffff,wordLane:2}],
  ['restart-u32',{format:43,indexSize:4,indexOffset:12,enabled:true}],['native-byte-marker',{format:70,indexSize:1,indexOffset:3,enabled:true,restartIndex:255,wordLane:1}],
  ['zero-instance-array',{format:82,instances:0,indexed:false,stride:0,wordLane:3}],['negative-y',{format:61,negativeY:true,wordLane:1}]
 ])await draw({seed:next(),...options},'critic-'+label);
 // A shared buffer holds both float32 position and compact color. Poison every
 // relevant native state and restore A/B/A from original upload packets.
 {
  const a=compactSpec({format:83,shared:true,ids:[3,8,13],values:[[-128,127],[0,37],[127,-64]],wordLane:0}),b=compactSpec({format:43,shared:true,stride:0,ids:[3,8,13],values:[[-2147483648,-16777223,33554435,2147483647]],wordLane:1}),r=make(a);
  const av=join(compactSetup(r,a),compactDraw(a)),ae=prediction(r,a,av);await frame(r,await compactSubmit(r,1,av,'critic-restore-A1'),ae);
  const vao=gl.createVertexArray(),buffer=gl.createBuffer(),ebo=gl.createBuffer(),poison=()=>{gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(512),gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.vertexAttribPointer(i,1,gl.UNSIGNED_BYTE,false,5,1);gl.vertexAttribDivisor(i,17);gl.vertexAttrib4f(i,.2,.4,.6,.8);gl.enableVertexAttribArray(i);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ebo);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array([3,3,3]),gl.STATIC_DRAW);c.same(gl.getError(),gl.NO_ERROR,'critic legal poison');};
  poison();const bv=join(compactSetup(r,b,{create:false}),compactDraw(b)),bp=prediction(r,b,bv,2);await frame(r,await compactSubmit(r,2,bv,'critic-restore-B'),bp);
  poison();r.bufferBytes=a.data;for(const [id,raw]of a.data)c.ok(r.store.writeBacking(id,0,raw),'critic original A backing');const restore=join(...[...a.data].map(([id,raw])=>packet(43,0,[id,0,0,0,0,0,0,0,raw.length,1,1,0,1])),clear([0,0,0,0]),compactDraw(a)),ap=prediction(r,a,restore);await frame(r,await compactSubmit(r,1,restore,'critic-restore-A2'),ap);gl.deleteVertexArray(vao);gl.deleteBuffer(buffer);gl.deleteBuffer(ebo);done(r);
 }
 for(const options of [{format:85,shared:false,shortColor:true},{format:42,shared:false,stride:0,shortColor:true},{format:39,stride:3},{format:47,bufferOffset:0,sourceOffset:1},{format:62,shortIndex:true}]){
  const s=compactSpec(options),r=make(s),bytes=join(compactSetup(r,s),compactDraw(s));let rejected=false;try{prediction(r,s,bytes);}catch{rejected=true;}c.same(rejected,true,'critic predicts original bounds/alignment failure');const rec=await compactSubmit(r,1,bytes,'critic-short-'+JSON.stringify(options));c.same(rec.result.ok,false,'critic short/alignment rejects');c.same(r.trace.calls.length,0,'critic rejected input never draws');report.rejections.push({record:rec,events:r.trace.events});done(r);
 }
 for(const action of ['revision','cancel','reuse','dispose']){
  const s=compactSpec({format:47,shared:true,stride:0,ids:[3,10,17],values:[[-2147483648,-16777223,33554435,2147483647]],wordLane:1}),r=make(s);await compactSubmit(r,1,compactSetup(r,s),'critic-pending-setup-'+action);
  const old=r.allocations.find(a=>a.metadata.id===3).generation,bytes=join(clear([0,0,0,0]),compactDraw(s)),expected=prediction(r,s,bytes);let fired=false,before;
  if(action==='dispose'){
   r.trace.label('critic-dispose');r.currentLabel='critic-dispose';const token=c.ok(r.renderer.beginSubmission(1,bytes),'critic active disposal').job;
   for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'critic disposal step');const inspection=r.renderer.inspect();if(inspection.jobs.status==='waiting-attributes'){fired=true;before=inspection;break;}}
   c.same(fired,true,'critic delayed scalar batch reached');c.ok(r.renderer.dispose(),'critic dispose entire batch');c.same(r.renderer.step(token).ok,false,'critic disposed token stale');report.ownership.push({before,after:r.asyncAccess.inspect(),events:r.trace.events});done(r);continue;
  }
  const rec=await compactSubmit(r,1,bytes,'critic-pending-'+action,(_step,token)=>{const inspection=r.renderer.inspect();if(fired||inspection.jobs.status!=='waiting-attributes')return;fired=true;before=inspection;
   if(action==='cancel')c.ok(r.renderer.cancel(token),'critic cancel whole shared batch');
   else if(action==='reuse'){c.ok(r.store.unref(3),'critic public shared source reuse');add(r,meta(3,0,64,16,s.data.get(3).length),new Uint8Array(s.data.get(3).length));}
   else {const raw=s.data.get(3).slice();raw.fill(157);c.ok(r.store.writeBacking(3,0,raw),'critic source revision');const command=c.ok(decodeStandardSubmission(packet(43,0,[3,0,0,0,0,0,0,0,raw.length,1,1,0,1])),'critic literal revision command').commands[0],ticket=c.ok(r.store.prepareTransfer(1,command),'critic revision ownership').ticket;c.ok(r.store.executeTransfer(ticket),'critic actual GPU source revision');}
  });c.same(fired,true,'critic delayed shared source reached');c.same(rec.result.gpuComplete,true,'critic source failure or reuse drained');
  if(action==='reuse'){await frame(r,rec,expected);c.same(rec.result.draws[0].vertexFetches.map(f=>f.resourceGeneration),[old,old],'critic both shared bindings retain old generation');}
  else {c.same(rec.result.ok,false,'critic stale shared source rejects');c.same(r.trace.calls.length,0,'critic stale source never draws');}
  report.suspensions.push({action,before,record:rec,events:r.trace.events});done(r);
 }
 report.status='passed';return report;
}
