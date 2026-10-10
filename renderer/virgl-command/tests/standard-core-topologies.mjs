import {createVirglStandardShaderBridge} from '../../virgl-shader/standard.mjs';
import {decodeSubmission,decodeStandardSubmission} from '../decoder.mjs';
import {checks,rig,meta,add,transfer,shader,clear,submit,dispose,packet,join,blob,hex} from './standard-instanced-draws.mjs';
import {topologyModel,comparePixels} from '../../../tools/virgl-command/standard-topology-oracle.mjs';
const word=value=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,value,true);return v.getUint32(0,true);};
export function topologySpec(options={}) {
  const s={mode:2,count:4,instances:4,indexed:true,indexSize:4,indexOffset:12,start:4,base:70000,
    offsets:[16,32,48],sourceOffsets:[8,12,4],seed:0x419ca76d,...options};
  s.used=[0,1,2];s.width=Math.max(1,s.instances)*16;s.height=16;
  const base=s.indexed?s.base:s.start,n=Math.max(1,s.instances);s.ids=Array.from({length:s.count},(_,i)=>base+i);
  s.elements=[[s.sourceOffsets[0],0,0,31],[s.sourceOffsets[1],0xffffffff,1,31],[s.sourceOffsets[2],2,2,31]];
  s.bindings=[[16,s.offsets[0],3],[0,s.offsets[1],4],[16,s.offsets[2],5]];s.data=new Map();
  let seed=s.seed>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  const corners=s.mode===6?[[2,2],[14,2],[14,14],[2,14],[2,2]]:[[2.5,2.5],[13.5,2.5],[13.5,13.5],[2.5,13.5],[2.5,2.5]];
  if(s.mode===2&&s.count===3)corners[2]=corners[0]; // Collinear three-vertex loop keeps this oracle axis aligned.
  for(let slot=0;slot<3;slot++){
    const last=slot===0?Math.max(...s.ids):slot===1?0:Math.floor((n-1)/2),prefix=s.offsets[slot]+s.sourceOffsets[slot],
      raw=new Uint8Array(prefix+last*(slot===1?0:16)+16-(s.shortSlot===slot?1:0)),v=new DataView(raw.buffer);
    const ids=slot===0?s.ids:slot===1?[0]:Array.from({length:last+1},(_,i)=>i);
    for(const id of ids){
      const point=slot===0?corners[id-base]:null;
      const value=slot===0?[point[0]/16,point[1]/8-1,0,1]:slot===1?[(32+random()%96)/256,(32+random()%96)/256,(32+random()%96)/256,1]:
        [(8+random()%48)/256,(8+random()%48)/256,(8+random()%48)/256,0];
      for(let k=0;k<4;k++){const at=prefix+id*(slot===1?0:16)+4*k;if(at+4<=raw.length)v.setFloat32(at,value[k],true);}
    }
    s.data.set(3+slot,raw);
  }
  if(s.indexed){const raw=new Uint8Array(s.indexOffset+s.count*s.indexSize-(s.shortIndex?1:0)),v=new DataView(raw.buffer);
    s.ids.forEach((id,i)=>{const at=s.indexOffset+i*s.indexSize;if(at+s.indexSize<=raw.length){
      if(s.indexSize===1)v.setUint8(at,id);else if(s.indexSize===2)v.setUint16(at,id,true);else v.setUint32(at,id,true);}});s.data.set(22,raw);}
  const lines=['I2F TEMP[0].x, SV[0].xxxx','MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].xxxx, IMM[0].yyyy',
    'MOV OUT[0], IN[0]','MAD OUT[0].x, IN[0].xxxx, IMM[0].xxxx, TEMP[0].xxxx','ADD TEMP[1], IN[1], IN[2]','MUL OUT[1], TEMP[1], IMM[1].xxxx','END'];
  s.vertex='VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL SV[0], INSTANCEID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..1]\n'+
    'IMM[0] FLT32 {'+Math.fround(2/n)+', -1.0, 0.0, 1.0}\nIMM[1] FLT32 {0.5,0.5,0.5,0.5}\n'+lines.map((l,i)=>i+': '+l+'\n').join('');
  s.fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';return s;
}
export const topologyDraw=(s,overrides={})=>{const a={...s,...overrides};return packet(8,0,[a.indexed?0:a.start,a.count,a.mode,a.indexed?1:0,a.instances,0,0,0,0,0,0,0]);};
export function topologySetup(r,s,{create=true}={}) {
  r.spec=s;r.bufferBytes=s.data;
  if(create)for(const [id,raw]of s.data)add(r,meta(id,0,64,id===22?32:16,raw.length),raw);
  return join(...[...s.data].map(([id,raw])=>transfer(id,raw.length)),shader(1,0,s.vertex),shader(2,1,s.fragment),
    packet(1,5,[3,...s.elements.flat()]),packet(2,5,[3]),packet(6,0,s.bindings.flat()),
    ...(s.indexed?[packet(11,0,[22,s.indexSize,s.indexOffset])]:[]),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),
    packet(4,0,[0,...[r.width/2,r.height/2,.5,r.width/2,r.height/2,.5].map(word)]),packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
export async function topologyFrame(r,record) {
  const {gl,c}=r;c.ok(record.result,record.label+' completed draw');c.same(record.result.gpuComplete,true,'actual completion fence');
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const n of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[n],0);gl.pixelStorei(gl.PACK_ALIGNMENT,1);
  const pixels=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);gl.deleteFramebuffer(fb);
  const result=record.result.draws.at(-1),buffers=[],calls=r.trace.calls.filter(call=>call.label===record.label).map(({program,...a})=>a);
  for(const [id,raw]of r.bufferBytes){const generation=id===22?result.indexResourceGeneration:result.vertexFetches.find(f=>f.resourceId===id).resourceGeneration,
    allocation=r.allocations.find(a=>a.metadata.id===id&&a.generation===generation),physical=new Uint8Array(raw.length);
    gl.bindBuffer(gl.COPY_READ_BUFFER,allocation.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,physical);gl.bindBuffer(gl.COPY_READ_BUFFER,null);
    const saved=await blob(r,physical);c.same(saved.sha256,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))),'original GPU topology input '+id);
    buffers.push({resourceId:id,generation,nativeBuffer:r.trace.id(allocation.storage.buffer),blob:saved});}
  const model=topologyModel(r.history,r.bufferBytes,r.spec.used),audit=comparePixels(pixels,model,r.width,r.height),frame={label:record.label,width:r.width,height:r.height,used:r.spec.used,
    history:r.history.map(h=>({...h})),inputs:r.exchanges.map(e=>({...e})),native:{calls,buffers},predicted:{ids:model.ids,fetches:model.fetches},audit,pixels:await blob(r,pixels)};
  r.frames.push(frame);c.same(audit.misses,[],record.label+' independent topology pixel oracle');
  const call=calls.at(-1),instanced=model.effective>1;c.same(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''),'native call kind');
  c.same(call.args,model.draw.indexed?[model.draw.mode,model.draw.count,{1:5121,2:5123,4:5125}[model.index.size],model.index.offset,...(instanced?[model.effective]:[])]:
    [model.draw.mode,model.draw.start,model.draw.count,...(instanced?[model.effective]:[])],'literal Gallium/native core mode and args');
  c.same(result.actualMinIndex,model.min,'actual minimum despite false hints');c.same(result.actualMaxIndex,model.max,'actual maximum despite false hints');c.same(result.vertexWork,model.draw.count*model.effective,'all vertices charged including incomplete tails');
  for(const f of model.fetches){const a=call.attributes.find(a=>a.name==='in_'+f.attributeIndex),observed=result.vertexFetches.find(a=>a.attributeIndex===f.attributeIndex);
    const keys=['resourceId','stride','offset','components','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'];
    c.same(Object.fromEntries(keys.map(k=>[k,observed[k]])),Object.fromEntries(keys.map(k=>[k,f[k]])),'complete topology byte extent '+f.attributeIndex);
    c.same(a.enabled,!f.constant,'generic/array state');c.same(a.divisor,f.nativeDivisor,'native instance divisor');
    if(f.constant){c.same(a.genericValues,f.genericValues,'GPU-read generic values');c.same(observed.componentWords,f.componentWords,'original generic component words');}
    else c.same([a.stride,a.offset,a.components],[f.stride,f.offset,f.components],'native vertex binding');}
  c.same(gl.getError(),gl.NO_ERROR,'native topology draw/capture error');return frame;
}
export function runWireAcceptance(){
  const c=checks(),records=[];
  const test=(bytes,expected,legacy,label)=>{const standard=decodeStandardSubmission(bytes),old=decodeSubmission(bytes);c.same(standard.ok,expected,label+' standard');c.same(old.ok,legacy,label+' legacy');records.push({label,hex:hex(bytes),standard,legacy:old,expected,legacyExpected:legacy});};
  for(const mode of [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0xffffffff])for(const instances of [0,1,4])
    test(packet(8,0,[0,4,mode,0,instances,0,0,0,0,0,0xffffffff,0]),mode>=0&&mode<=6,instances===1&&[4,5].includes(mode),'mode-'+mode+'-'+instances);
  for(const mode of [1,2,3,6]){
    for(const [label,slot,value]of [['bias',5,1],['base-instance',6,1],['restart',7,1],['restart-index',8,255],['stream',11,1],['invalid-indexed',3,2]]){
      const w=[0,4,mode,0,1,0,0,0,0,0,0xffffffff,0];w[slot]=value;test(packet(8,0,w),false,false,label+'-'+mode);}
    test(join(topologyDraw(topologySpec({mode})),packet(8,0,[])),false,false,'malformed-tail-'+mode);
  }
  return {status:'passed',records,predictions:c.rows};
}
function poison(gl){gl.viewport(0,0,1,1);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.colorMask(false,false,false,false);gl.lineWidth(3);
  for(let i=0;i<gl.getParameter(gl.MAX_VERTEX_ATTRIBS);i++){gl.enableVertexAttribArray(i);gl.vertexAttribDivisor(i,9);gl.vertexAttrib4f(i,.9,.8,.7,.6);}}
export async function runAcceptance({smoke=false}={}) {
  const c=checks(),report={schema:'virgl-standard-topology-v1',status:'running',guestExecution:false,productionNegotiation:false,predictions:c.rows,frames:[],runs:[],blobs:[],rejections:[],suspensions:[]};window.__standardTopologyEvidence=report;report.wire=runWireAcceptance();
  const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info');
  c.same(gl instanceof WebGL2RenderingContext,true,'actual WebGL2');c.same(Boolean(debug),true,'native GPU identity');report.gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu),false,'hardware GPU');
  const bridge=await createVirglStandardShaderBridge(),make=(s,options={})=>{const r=rig(gl,bridge,c,{width:s.width,height:s.height,...options});r.frames=report.frames;r.blobs=report.blobs;return r;},
    done=r=>{const inspection=c.ok(r.renderer.inspect(),'completed topology counters');c.same(inspection.jobs.reads,0,'no pending reads');c.same(inspection.jobs.stagingBytes,0,'no pending staging');
      report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),inspection});dispose(r);};
  for(const [delay,step]of smoke?[[0,64]]:[[0,64],[2,1],[5,3]])for(const mode of smoke?[2]:[1,2,3,6]){
    const configs=[['wide-instanced',{}],['arrays-zero',{indexed:false,instances:0}],['arrays-instanced',{indexed:false,instances:2}],['byte-one',{indexSize:1,base:48,instances:1}],['short-instanced',{indexSize:2,base:96,instances:4}]];
    for(const [label,options]of smoke?configs.slice(0,1):configs){const s=topologySpec({mode,...options}),r=make(s,{delay,step}),name='mode-'+mode+'-'+label+'-'+delay;
      await topologyFrame(r,await submit(r,1,join(topologySetup(r,s),topologyDraw(s)),name));
      if(mode===2&&label==='wide-instanced'&&!smoke){const b=topologySpec({mode:3});poison(gl);await topologyFrame(r,await submit(r,2,join(topologySetup(r,b,{create:false}),topologyDraw(b)),'mode-B-'+delay));
        poison(gl);r.spec=s;await topologyFrame(r,await submit(r,1,join(clear([0,0,0,0]),topologyDraw(s)),'mode-A-restored-'+delay));}
      done(r);
    }
  }
  if(!smoke){
    for(const mode of [1,2,3,6])for(const count of [1,2,3,5]){const s=topologySpec({mode,count,instances:1}),r=make(s,{delay:2,step:1});
      await topologyFrame(r,await submit(r,1,join(topologySetup(r,s),topologyDraw(s)),'tail-'+mode+'-'+count));done(r);}
    for(const mode of [1,2,3,6]){
      for(const options of [{shortSlot:0,count:5},{shortIndex:true}]){const s=topologySpec({mode,...options}),r=make(s),rec=await submit(r,1,join(topologySetup(r,s),topologyDraw(s)),(options.shortIndex?'short-index-':'short-tail-')+mode);
        c.same(rec.result.error.code,'out-of-bounds','one-byte-short topology range');c.same(r.trace.calls.length,0,'short range before native draw');report.rejections.push({label:rec.label,record:rec,events:r.trace.events,draws:0});done(r);}
      for(const budget of [8,7]){const s=topologySpec({mode,instances:2}),r=make(s,{drawLimits:{indicesPerSubmission:budget}}),rec=await submit(r,1,join(topologySetup(r,s),topologyDraw(s)),'work-'+mode+'-'+budget);
        if(budget===8)await topologyFrame(r,rec);else{c.same(rec.result.error.code,'limit-exceeded','exact work budget minus one');c.same(r.trace.calls.length,0,'work limit before native draw');report.rejections.push({label:rec.label,record:rec,events:r.trace.events,draws:0});}done(r);}
    }
    for(const action of ['stale-index','cancel','reuse']){const s=topologySpec(),r=make(s,{delay:7,step:2});c.ok((await submit(r,1,topologySetup(r,s),'pending-setup-'+action)).result,'pending original uploads');
      const oldGeneration=r.allocations.find(a=>a.metadata.id===4).generation;let point,fired=false,newGeneration;
      const rec=await submit(r,1,join(clear([0,0,0,0]),topologyDraw(s)),'pending-'+action,async(_step,token)=>{
        const inspection=c.ok(r.renderer.inspect(),'topology suspension');if(fired||inspection.jobs.status!=='waiting-attributes')return;fired=true;point={inspection,events:r.trace.events.map(e=>({...e}))};c.same(inspection.jobs.reads,2,'constant and index tickets retained');
        if(action==='cancel')c.ok(r.renderer.cancel(token),'cancel pending topology');
        else if(action==='reuse'){c.ok(r.store.unref(4),'retire generic public resource');newGeneration=add(r,meta(4,0,64,16,s.data.get(4).length),new Uint8Array(s.data.get(4).length)).generation;c.same(newGeneration>oldGeneration,true,'generic public name generation advanced');}
        else{const bytes=s.data.get(22).slice();bytes.fill(0);c.ok(r.store.writeBacking(22,0,bytes),'mutate pending index backing');
          const command=c.ok(decodeStandardSubmission(transfer(22,bytes.length)),'literal concurrent index upload').commands[0],access=c.ok(r.store.prepareTransfer(1,command),'owned concurrent index upload');c.ok(r.store.executeTransfer(access.ticket),'actual index GPU revision changed');}
      });c.same(fired,true,'pending topology reached');
      if(action==='reuse'){await topologyFrame(r,rec);c.same(rec.result.draws[0].vertexFetches[1].resourceGeneration,oldGeneration,'retained constant generation used');}
      else{c.same(rec.result.ok,false,'pending topology rejected');c.same(rec.result.error.code,action==='cancel'?'cancelled':'stale-storage','pending specific rejection');c.same(rec.result.gpuComplete,true,'pending topology drains final fence');c.same(r.trace.calls.length,0,'pending invalid topology never draws');}
      report.suspensions.push({action,point,oldGeneration,newGeneration,record:rec,async:r.asyncAccess.inspect(),events:r.trace.events});done(r);
    }
  }
  report.status='passed';return report;
}
