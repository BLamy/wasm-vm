import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {decodeStandardSubmission,decodeSubmission,vertexFormat} from '../decoder.mjs';
import {checks,packet,join,hex,blob,clear,meta,add,dispose,shader} from './standard-instanced-draws.mjs';
import {compactRig,compactSubmit,compactDraw} from './standard-compact-vertex-fetch.mjs';
import {criticIntegerFormat,criticIntegerModel,criticIntegerCompare} from '../../../tools/virgl-command/standard-integer-adversarial-oracle.mjs';
const SEEDS=[0x6e624eb7,0x9d57a091,0xc170a425];
const word=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
function specimen(seed,{format=184,constant=true,high=false,lane=0,variants=false,short=false}={}){
 let state=seed>>>0;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
 const s={instances:3,indexed:true,indexSize:2,indexOffset:10,start:4,enabled:false,restartIndex:53,positionStride:16,positionOffset:3,positionSourceOffset:1,width:48,height:16,ids:[3,8,13],count:3,high,variant:variants};
 const families=[177,181,185,189,193,197],posEnd=4+13*16+16,defs=[];let size=posEnd;
 for(let i=1;i<=(high?15:1);i++){
  const enumValue=variants?31:i===1?format:families[(i+next()%6)%6]+next()%4,a=criticIntegerFormat(enumValue),bytes=a.bytes*a.components;
  size=Math.ceil((size+1)/a.bytes)*a.bytes;const offset=size,stride=constant?0:bytes,divisor=constant?0xffffffff:i%3===0?2:0,last=stride===0?0:divisor?1:13;
  size+=last*stride+bytes;defs.push({index:i,format:enumValue,offset,stride,divisor,...a});
 }
 const raw=new Uint8Array(size-(short?1:0));raw.forEach((_,i)=>raw[i]=next()&255);
 const pv=new DataView(raw.buffer),centers=[[3.375,4.375],[8.375,9.375],[12.375,5.375]];
 s.ids.forEach((id,i)=>[Math.fround(centers[i][0]/8-1),Math.fround(centers[i][1]/8-1),id,1].forEach((n,k)=>pv.setFloat32(4+id*16+k*4,n,true)));
 for(const a of defs){const last=a.stride===0?0:a.divisor?1:13,indices=a.stride===0?[0]:a.divisor?[0,1]:s.ids;
  for(const index of indices)for(let k=0;k<a.components;k++){
   const at=a.offset+index*a.stride+k*a.bytes;if(at+a.bytes>raw.length)continue;
   let w;if(variants){pv.setFloat32(at,[.5,-.25,.75,1][k],true);continue;}
   if(a.bytes===4)w=[0x80000000,0x7fc00001,0xff800003,0xffffffff,16777217,2147483647,next()][(k+index+a.index)%7];
   else w=a.signed?[2**(8*a.bytes-1),2**(8*a.bytes)-1,2**(8*a.bytes-1)-1,next()][(k+index)%4]:[2**(8*a.bytes)-1,0,1,next()][(k+index)%4];
   for(let j=0;j<a.bytes;j++)raw[at+j]=w>>>8*j&255;
  }
 }
 // Every selected pure input must contribute to the observed raw-word checksum.
 const color=high?['MOV TEMP[2].x, IN[1].'+('xyzw'[lane].repeat(4)),...defs.slice(1).map(a=>'XOR TEMP[2].x, TEMP[2].xxxx, IN['+a.index+'].'+('xyzw'[lane].repeat(4)))]:['MOV TEMP[2].x, IN[1].'+('xyzw'[lane].repeat(4))];
 const body=['I2F TEMP[0].x, SV[0].xxxx','MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].yyyy, IMM[0].zzzz','MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx','MOV OUT[0].y, IN[0].yyyy','MOV OUT[0].z, IMM[3].wwww','I2F TEMP[1].x, SV[1].xxxx','SEQ TEMP[1].x, TEMP[1].xxxx, IN[0].zzzz','MUL OUT[0].w, TEMP[1].xxxx, IN[0].wwww',...color,'USHR TEMP[2], TEMP[2].xxxx, IMM[2]','AND TEMP[2], TEMP[2], IMM[4]','U2F TEMP[2], TEMP[2]','MUL OUT[1], TEMP[2], IMM[0].wwww'];
 s.vertex='VERT\nDCL IN[0]\n'+defs.map(a=>'DCL IN['+a.index+']\n').join('')+'DCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..2]\nIMM[0] FLT32 {0.3333333432674408,0.6666666865348816,-0.6666666865348816,0.00392156862745098}\nIMM[1] FLT32 {0.5,0.5,0.5,1}\nIMM[2] UINT32 {0,8,16,24}\nIMM[3] FLT32 {0.5,0.5,0.5,0}\nIMM[4] UINT32 {255,255,255,255}\n'+[...body,'END'].map((line,i)=>i+': '+line+'\n').join('');
 s.fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
 const indices=new Uint8Array(s.indexOffset+2*s.ids.length);s.ids.forEach((id,i)=>{indices[s.indexOffset+i*2]=id&255;indices[s.indexOffset+i*2+1]=id>>>8;});
 s.data=new Map([[3,raw],[6,indices]]);s.defs=defs;s.seed=seed;return s;
}
function elements(s,handle=3,override=null){return packet(1,5,[handle,s.positionSourceOffset,0,0,31,...s.defs.flatMap(a=>[a.offset,a.divisor,a.index,override??a.format])]);}
function setup(r,s){for(const [id,raw]of s.data)add(r,meta(id,0,64,id===6?32:16,raw.length),raw);r.bufferBytes=s.data;
 return join(...[...s.data].map(([id,raw])=>packet(43,0,[id,0,0,0,0,0,0,0,raw.length,1,1,0,1])),shader(1,0,s.vertex),shader(2,1,s.fragment),elements(s),packet(2,5,[3]),packet(6,0,[16,3,3,...s.defs.flatMap(a=>[a.stride,0,3])]),packet(11,0,[6,2,10]),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),packet(4,0,[0,...[24,8,.5,24,8,.5].map(word)]),packet(1,2,[9,2|(1<<29),word(4),0,65535,word(1),0,0,0]),packet(2,2,[9]),packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
export async function runAcceptance({smoke=false,mutation}={}){
 const c=checks(),report={schema:'standard-integer-fresh-critic-v1',seeds:SEEDS,status:'running',frames:[],runs:[],wire:[],rejections:[],suspensions:[],ownership:[],blobs:[],predictions:c.rows,guestExecution:false,productionNegotiation:false,portableNaNPayload:false};window.__standardIntegerEvidence=report;
 const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});if(!gl)throw Error('critic requires WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info');report.gpu={vendor:gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL??gl.VENDOR),renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)};if(/swiftshader|llvmpipe|softpipe|lavapipe/i.test(report.gpu.renderer))throw Error('critic requires hardware');
 const bridge=await createVirglStandardShaderBridge();
 const make=(s,options={})=>{const schedule=s.seed>>>0,r=compactRig(gl,options.bridge??bridge,c,s,{step:1+schedule%3,delay:({ordinal})=>1+(schedule>>>((ordinal%8)*4)&7),...options});r.blobs=report.blobs;r.frames=report.frames;r.bufferBytes=s.data;return r;};
 const predict=(r,bytes)=>criticIntegerModel([...r.history,{ctx:1,hex:hex(bytes)}],r.bufferBytes,r.range);
 async function frame(r,record,expected){
  c.ok(record.result,'critic native draw');c.same(record.result.gpuComplete,true,'critic final GPU fence');
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const n of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[n],0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);const pixels=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.deleteFramebuffer(fb);
  const draw=record.result.draws.at(-1),native=[];
  for(const [id,original]of r.bufferBytes){const generation=id===6?draw.indexResourceGeneration:draw.vertexFetches.find(a=>a.resourceId===id).resourceGeneration,a=r.allocations.find(a=>a.metadata.id===id&&a.generation===generation),raw=new Uint8Array(original.length);gl.bindBuffer(gl.COPY_READ_BUFFER,a.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,raw);gl.bindBuffer(gl.COPY_READ_BUFFER,null);c.same(hex(raw),hex(original),'critic original full GPU bytes '+id);native.push({resourceId:id,generation,nativeBuffer:r.trace.id(a.storage.buffer),blob:await blob(r,raw)});}
  const audit=criticIntegerCompare(pixels,expected,r.width,r.height),state=r.nativeState.filter(s=>s.label===record.label),calls=r.trace.calls.filter(a=>a.label===record.label).map(({program,...a})=>a),saved={label:record.label,width:r.width,height:r.height,range:r.range,history:r.history.map(a=>({...a})),inputs:r.exchanges.map(e=>({...e})),native:{buffers:native,state,calls},prediction:{masks:[expected.signedMask,expected.unsignedMask],fetches:expected.fetches,ids:expected.ids,points:expected.points},audit,pixels:await blob(r,pixels)};report.frames.push(saved);
  // Catch physical sabotage after its real draw/fence, ahead of state assertions.
  c.same(audit.misses,[],record.label+' critic original TGSI pixels');c.same(calls.length,1,'critic one original native draw');c.same(calls[0].name,'drawElementsInstanced','critic native instanced indexed call');c.same(calls[0].args,[0,3,5123,10,3],'critic original native draw arguments');
  for(const fetch of expected.fetches){const a=state.at(-1).attributes.find(a=>a.name==='in_'+fetch.attributeIndex),actual=draw.vertexFetches.find(a=>a.attributeIndex===fetch.attributeIndex),source=native.find(b=>b.resourceId===fetch.resourceId);c.same(Boolean(a),true,'all declared checksum attributes active');
   for(const key of ['resourceId','stride','offset','components','sourceFormat','elementBytes','nativeType','normalized','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'])c.same(actual[key],fetch[key],'critic fetched '+key);c.same(a.shaderType,fetch.shaderType,'critic actual typed reflection');c.same([a.enabled,a.divisor],[!fetch.constant,fetch.nativeDivisor],'critic array/generic divisor');c.same(actual.resourceGeneration,source.generation,'critic retained original generation');
   if(fetch.constant){c.same(actual.componentWords,fetch.componentWords,'critic original expanded generic words');c.same(a.genericWords,fetch.genericWords,'critic actual native generic raw words');c.same(a.genericKind,fetch.integer?fetch.signed?'Int32Array':'Uint32Array':'Float32Array','critic native typed generic kind');const raw=r.bufferBytes.get(fetch.resourceId).subarray(fetch.offset,fetch.offset+fetch.elementBytes),events=r.trace.events.filter(e=>e.label===record.label);c.same(events.some(e=>e.name==='getBufferSubData'&&e.bytes===fetch.elementBytes&&e.hex===hex(raw)),true,'critic exact declared read');c.same(events.some(e=>e.name==='copyBufferSubData'&&e.source===source.nativeBuffer&&e.args[2]===fetch.offset&&e.args[4]===fetch.elementBytes),true,'critic exact original source ticket');}
   else c.same([a.buffer,a.type,a.integer,a.normalized,a.components,a.stride,a.offset],[source.nativeBuffer,fetch.nativeType,fetch.integer,false,fetch.components,fetch.stride,fetch.offset],'critic native original pointer');
  }
  c.same(gl.getError(),gl.NO_ERROR,'critic GPU capture');return saved;
 }
 function done(r){const inspection=c.ok(r.renderer.inspect(),'critic ownership');for(const k of ['reads','stagingBytes','normalizedBuffers','normalizedBytes','normalizationScratchBytes'])c.same(inspection.jobs[k],0,'critic released '+k);report.runs.push({inspection,history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),nativeState:r.nativeState});dispose(r);}
 async function draw(seed,options,label){const s=specimen(seed,options),r=make(s),bytes=join(setup(r,s),compactDraw(s)),expected=predict(r,bytes);await frame(r,await compactSubmit(r,1,bytes,label),expected);done(r);}
 for(const format of [0,27,177,181,185,189,193,197,200,0xffffffff]){const bytes=packet(1,5,[777,0,0,0,format]),standard=decodeStandardSubmission(bytes),legacy=decodeSubmission(bytes),expected=format>=177&&format<=200;c.same(standard.ok,expected,'critic literal integer wire admission');c.same(legacy.ok,false,'critic historical integer isolation');report.wire.push({hex:hex(bytes),expected,legacyExpected:false,standard,legacy});}
 for(const value of [NaN,Infinity,null,undefined,'177',{},-1])c.same(vertexFormat(value),null,'critic lookup never coerces');
 if(smoke){await draw(SEEDS[0],{high:true,constant:mutation!=='native-signedness',lane:0},'critic-high16-sabotage-'+mutation);report.status='passed';return report;}
 for(const base of [177,181,185,189,193,197])for(let components=1;components<=4;components++)for(const constant of [false,true]){const seed=SEEDS[(base+components+(constant?1:0))%3];await draw(seed,{format:base+components-1,constant,lane:seed%4},'critic-seeded-format-'+(base+components-1)+'-'+constant);}
 for(const seed of SEEDS)for(let lane=0;lane<4;lane++)await draw(seed,{high:true,constant:true,lane},'critic-high16-'+seed+'-'+lane);
 for(const evict of [false,true]){
  const s=specimen(SEEDS[1],{high:true,constant:true,variants:true}),requests=[],traced={...bridge,translatePair(r){requests.push({signedMask:0,unsignedMask:0});return bridge.translatePair(r);},translatePairTyped(r){requests.push({signedMask:r.signedMask,unsignedMask:r.unsignedMask});return bridge.translatePairTyped(r);}},r=make(s,{bridge:traced,...(evict?{stateLimits:{programs:1},cacheLimits:{translations:1}}:{})}),programs=[];
  for(const [i,format]of [31,200,196,31].entries()){const bytes=i===0?join(setup(r,s),compactDraw(s)):join(elements(s,10+i,format),packet(2,5,[10+i]),clear([0,0,0,0]),compactDraw(s)),expected=predict(r,bytes);await frame(r,await compactSubmit(r,1,bytes,'critic-high16-variant-'+evict+'-'+i),expected);programs.push(r.nativeState.at(-1).program);}
  c.same(requests,evict?[{signedMask:0,unsignedMask:0},{signedMask:65534,unsignedMask:0},{signedMask:0,unsignedMask:65534},{signedMask:0,unsignedMask:0}]:[{signedMask:0,unsignedMask:0},{signedMask:65534,unsignedMask:0},{signedMask:0,unsignedMask:65534}],'critic complete high15 masks/cache identity');c.same(programs[0]===programs[3],!evict,'critic actual variant eviction/reuse');c.same(new Set(programs.slice(0,3)).size,3,'critic native programs distinct');report.ownership.push({kind:'high16-variants',evict,requests,programs,inspection:r.renderer.inspect()});done(r);
 }
 for(const action of ['revision','cancel','reuse','dispose']){
  const s=specimen(SEEDS[2],{high:true,constant:true}),r=make(s),initial=setup(r,s);c.ok((await compactSubmit(r,1,initial,'critic-high16-pending-setup-'+action)).result,'critic high batch setup');const bytes=join(clear([0,0,0,0]),compactDraw(s)),expected=predict(r,bytes),old=r.allocations.find(a=>a.metadata.id===3).generation;let fired=false,before;
  if(action==='dispose'){r.currentLabel='critic-high16-dispose';r.trace.label(r.currentLabel);const token=c.ok(r.renderer.beginSubmission(1,bytes),'critic high disposal job').job;
   for(let i=0;i<200;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'critic high disposal step');const inspection=r.renderer.inspect();if(inspection.jobs.status==='waiting-attributes'){fired=true;before=inspection;break;}}
   c.same(fired,true,'critic high16 retained batch reached');c.ok(r.renderer.dispose(),'critic high16 disposal');c.same(r.renderer.step(token).ok,false,'critic disposed batch stale');report.ownership.push({kind:'high16-disposal',before,after:r.asyncAccess.inspect(),events:r.trace.events});done(r);continue;
  }
  const rec=await compactSubmit(r,1,bytes,'critic-high16-pending-'+action,(_step,token)=>{const inspection=r.renderer.inspect();if(fired||inspection.jobs.status!=='waiting-attributes')return;fired=true;before=inspection;
   if(action==='cancel')c.ok(r.renderer.cancel(token),'critic high16 cancel');else if(action==='reuse'){c.ok(r.store.unref(3),'critic reused public shared source');add(r,meta(3,0,64,16,s.data.get(3).length),new Uint8Array(s.data.get(3).length));}else{const raw=s.data.get(3).slice();raw.fill(0x5a);c.ok(r.store.writeBacking(3,0,raw),'critic revision backing');const cmd=c.ok(decodeStandardSubmission(packet(43,0,[3,0,0,0,0,0,0,0,raw.length,1,1,0,1])),'critic original revision packet').commands[0],ticket=c.ok(r.store.prepareTransfer(1,cmd),'critic actual shared revision ticket').ticket;c.ok(r.store.executeTransfer(ticket),'critic actual GPU revision');}
  });c.same(fired,true,'critic high batch suspend');c.same(rec.result.gpuComplete,true,'critic high stale/reuse fences drained');
  if(action==='reuse'){await frame(r,rec,expected);c.same(rec.result.draws[0].vertexFetches.map(a=>a.resourceGeneration),Array(16).fill(old),'all16 shared bindings retain old source');}else{c.same(rec.result.ok,false,'critic high stale/cancel rejects');c.same(r.trace.calls.length,0,'critic high rejected never draws');}report.suspensions.push({action,before,record:rec,events:r.trace.events});done(r);
 }
 {const s=specimen(SEEDS[0],{high:true,constant:true}),r=make(s),initial=setup(r,s),bytes=join(initial,packet(1,5,[55,1,0,0,31]),packet(2,5,[55]),compactDraw(s)),rec=await compactSubmit(r,1,bytes,'critic-high16-missing-elements');c.same(rec.result.ok,false,'critic missing declared attribute binding rejects');c.same(r.trace.calls.length,0,'critic missing binding before native draw');report.rejections.push({record:rec,events:r.trace.events});done(r);}
 // Literal one-byte-short high shared batch must fail without native draw.
 {const s=specimen(SEEDS[0],{high:true,constant:true,short:true}),r=make(s),bytes=join(setup(r,s),compactDraw(s));let predicted=false;try{predict(r,bytes);}catch{predicted=true;}c.same(predicted,true,'critic predicts original high last byte failure');const rec=await compactSubmit(r,1,bytes,'critic-high16-short');c.same(rec.result.ok,false,'critic high short rejected');c.same(r.trace.calls.length,0,'critic high short before native draw');report.rejections.push({record:rec,events:r.trace.events});done(r);}
 report.status='passed';return report;
}
