import { createVirglStandardShaderBridge } from '../../virgl-shader/standard.mjs';
import { createVirglShaderBridge } from '../../virgl-shader/index.mjs';
import { createVirglAsyncRenderer } from '../state.mjs';
import { decodeStandardSubmission } from '../decoder.mjs';
import { checks, rig, meta, add, transfer, shader, clear, submit, dispose, packet, join, blob, hex } from './standard-instanced-draws.mjs';
import { constantModel } from '../../../tools/virgl-command/standard-constant-oracle.mjs';
import { comparePixels } from '../../../tools/virgl-command/standard-draw-oracle.mjs';
const word=value=>{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,value,true);return v.getUint32(0,true);};
const tgsi=(stage,declarations,instructions)=>(stage===0?'VERT\n':'FRAG\n')+declarations+'\n'+[...instructions,'END'].map((s,i)=>i+': '+s+'\n').join('');
export function constantSpec(options={}) {
  const s={components:[1,2,3,4],strides:[0,0,0,0],divisors:[0,2,0xffffffff,3],instances:5,
    indexed:true,indexSize:4,indexOffset:12,base:70000,start:4,mode:5,seed:0x4285a1db,...options};
  s.used=s.components.map((_,i)=>i);s.width=Math.max(1,s.instances)*10;s.height=10;
  const base=s.indexed?s.base:s.start;
  s.ids=s.mode===4?[base,base+1,base+2,base+2,base+1,base+3]:[base,base+1,base+2,base+3];
  let end=16,seed=s.seed>>>0;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  s.elements=[];s.bindings=[];const writes=[];
  s.components.forEach((components,i)=>{
    const stride=s.strides[i]??0,divisor=s.divisors[i]??0,bufferOffset=Math.ceil((end+12)/4)*4,sourceOffset=4+(i%4)*4;
    const last=stride===0?0:divisor?Math.floor((Math.max(1,s.instances)-1)/divisor):Math.max(...s.ids);
    s.elements.push([sourceOffset,divisor,i,27+components]);s.bindings.push([stride,bufferOffset,3]);
    const ids=stride===0?[0]:divisor?Array.from({length:last+1},(_,n)=>n):[...new Set(s.ids)];
    for(const id of ids)for(let lane=0;lane<components;lane++)writes.push([bufferOffset+sourceOffset+id*stride+lane*4,(8+random()%192)/256]);
    end=bufferOffset+sourceOffset+last*stride+components*4;
  });
  const raw=new Uint8Array(end-(s.short?1:0)),view=new DataView(raw.buffer);
  for(const [at,value]of writes)if(at+4<=raw.length)view.setFloat32(at,value,true);
  s.data=new Map([[3,raw]]);
  if(s.indexed){const bytes=new Uint8Array(s.indexOffset+s.ids.length*s.indexSize),v=new DataView(bytes.buffer);
    s.ids.forEach((id,i)=>{const at=s.indexOffset+i*s.indexSize;
      if(s.indexSize===1)v.setUint8(at,id);else if(s.indexSize===2)v.setUint16(at,id,true);else v.setUint32(at,id,true);});s.data.set(22,bytes);}
  const dx=Math.fround(2/Math.max(1,s.instances)),scale=Math.fround(.5/s.used.length);
  s.vertex=tgsi(0,s.used.map(i=>'DCL IN['+i+']').join('\n')+
    '\nDCL SV[0], INSTANCEID\nDCL SV[1], VERTEXID\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..3]\n'+
    'IMM[0] FLT32 {'+dx+', -1.0, 2.0, 1.0}\nIMM[1] UINT32 {1,1,7,255}\n'+
    'IMM[2] FLT32 {'+scale+', 0.03125, 0.0009765625, 0.0}\nIMM[3] FLT32 {0.0,0.0,0.0,0.0}',[
      'I2F TEMP[0].x, SV[0].xxxx','MAD TEMP[0].x, TEMP[0].xxxx, IMM[0].xxxx, IMM[0].yyyy',
      'AND TEMP[1].x, SV[1].xxxx, IMM[1].xxxx','U2F TEMP[1].x, TEMP[1].xxxx',
      'MAD OUT[0].x, TEMP[1].xxxx, IMM[0].xxxx, TEMP[0].xxxx',
      'USHR TEMP[1].x, SV[1].xxxx, IMM[1].yyyy','AND TEMP[1].x, TEMP[1].xxxx, IMM[1].xxxx','U2F TEMP[1].x, TEMP[1].xxxx',
      'MAD OUT[0].y, TEMP[1].xxxx, IMM[0].zzzz, IMM[0].yyyy','MOV OUT[0].zw, IMM[3].zzzw','MOV OUT[0].w, IMM[0].wwww',
      'MOV TEMP[2], IMM[3]',...s.used.map(i=>'ADD TEMP[2], TEMP[2], IN['+i+']'),
      'MUL TEMP[2], TEMP[2], IMM[2].xxxx','AND TEMP[3].x, SV[0].xxxx, IMM[1].zzzz','U2F TEMP[3].x, TEMP[3].xxxx',
      'MAD TEMP[2].z, TEMP[3].xxxx, IMM[2].yyyy, TEMP[2].zzzz','AND TEMP[3].x, SV[1].xxxx, IMM[1].wwww','U2F TEMP[3].x, TEMP[3].xxxx',
      'MAD TEMP[2].y, TEMP[3].xxxx, IMM[2].zzzz, TEMP[2].yyyy','MOV OUT[1], TEMP[2]',
    ]);
  s.fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
  return s;
}
export const constantDraw=s=>packet(8,0,[s.indexed?0:s.start,s.ids.length,s.mode,s.indexed?1:0,s.instances,0,0,0,0,0,0xffffffff,0]);
export function constantSetup(r,s,{uploadChunk=Infinity,create=true}={}) {
  r.spec=s;r.bufferBytes=s.data;
  if(create)for(const [id,raw]of s.data)add(r,meta(id,0,64,id===22?32:16,raw.length),raw);
  const uploads=[];
  for(const [id,raw]of s.data)for(let at=0;at<raw.length;at+=uploadChunk){
    const width=Math.min(uploadChunk,raw.length-at);
    uploads.push(packet(43,0,[id,0,0,0,0,at,0,0,width,1,1,at,1]));
  }
  return join(...uploads,shader(1,0,s.vertex),shader(2,1,s.fragment),
    packet(1,5,[3,...s.elements.flat()]),packet(2,5,[3]),packet(6,0,s.bindings.flat()),
    ...(s.indexed?[packet(11,0,[22,s.indexSize,s.indexOffset])]:[]),packet(1,8,[4,1,67,0,0]),packet(5,0,[1,0,4]),
    packet(4,0,[0,...[r.width/2,r.height/2,.5,r.width/2,r.height/2,.5].map(word)]),
    packet(31,0,[1,0]),packet(31,0,[2,1]),clear([0,0,0,0]));
}
export async function constantFrame(r,record) {
  const {gl,c}=r;c.ok(record.result,record.label+' completed draw');c.same(record.result.gpuComplete,true,'real final completion fence');
  const model=constantModel(r.history,r.bufferBytes,r.spec.used),result=record.result.draws.at(-1);
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.allocations[0].storage.texture,0);gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const n of ['PACK_ROW_LENGTH','PACK_SKIP_PIXELS','PACK_SKIP_ROWS'])gl.pixelStorei(gl[n],0);
  gl.pixelStorei(gl.PACK_ALIGNMENT,1);const raw=new Uint8Array(r.width*r.height*4);
  gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,raw);gl.deleteFramebuffer(fb);
  const calls=r.trace.calls.filter(call=>call.label===record.label),call=calls.at(-1),buffers=[];
  for(const [id,original]of r.bufferBytes){
    const generation=id===22?result.indexResourceGeneration:result.vertexFetches.find(f=>f.resourceId===id).resourceGeneration;
    const allocation=r.allocations.find(a=>a.metadata.id===id&&a.generation===generation),bytes=new Uint8Array(original.length);
    gl.bindBuffer(gl.COPY_READ_BUFFER,allocation.storage.buffer);gl.getBufferSubData(gl.COPY_READ_BUFFER,0,bytes);gl.bindBuffer(gl.COPY_READ_BUFFER,null);
    const saved=await blob(r,bytes);
    buffers.push({resourceId:id,generation,nativeBuffer:r.trace.id(allocation.storage.buffer),blob:saved});
    c.same(saved.sha256,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',original))),'original uploaded bytes equal actual GPU source '+id);
  }
  const audit=comparePixels(raw,model,r.width,r.height),frame={label:record.label,width:r.width,height:r.height,used:r.spec.used,
    history:r.history.map(h=>({label:h.label,hex:h.hex,ctx:h.ctx,result:h.result})),inputs:r.exchanges.map(e=>({resource:e.resource,layout:e.layout,blob:e.blob})),
    native:{calls:calls.map(({program,...a})=>a),buffers},predicted:{ids:model.ids,fetches:model.fetches},dump:record.dump,audit,pixels:await blob(r,raw)};
  r.frames.push(frame);c.same(audit.misses,[],record.label+' independent constant pixel oracle');
  c.same(result.actualMinIndex,model.min,'minimum from original indices');c.same(result.actualMaxIndex,model.max,'maximum from original indices');
  c.same(result.vertexWork,model.draw.count*model.effective,'constant reads do not alter total work');
  const instanced=model.effective>1;
  c.same(call.name,(model.draw.indexed?'drawElements':'drawArrays')+(instanced?'Instanced':''),'native draw kind');
  c.same(call.args,model.draw.indexed?[model.draw.mode===4?gl.TRIANGLES:gl.TRIANGLE_STRIP,model.draw.count,
    {1:gl.UNSIGNED_BYTE,2:gl.UNSIGNED_SHORT,4:gl.UNSIGNED_INT}[model.index.size],model.index.offset,...(instanced?[model.effective]:[])]:
    [model.draw.mode===4?gl.TRIANGLES:gl.TRIANGLE_STRIP,model.draw.start,model.draw.count,...(instanced?[model.effective]:[])],'literal native draw arguments');
  for(const f of model.fetches){
    const a=call.attributes.find(a=>a.name==='in_'+f.attributeIndex),observed=result.vertexFetches.find(a=>a.attributeIndex===f.attributeIndex);
    c.same(a.enabled,!f.constant,'array enablement '+f.attributeIndex);c.same(a.divisor,f.nativeDivisor,'native divisor '+f.attributeIndex);
    if(f.constant){c.same(a.genericValues,f.genericValues,'native generic missing-lane values '+f.attributeIndex);
      c.same(observed.componentWords,f.componentWords,'original constant component words '+f.attributeIndex);c.same(observed.genericValues,f.genericValues,'draw generic values');}
    else c.same([a.stride,a.offset,a.components],[f.stride,f.offset,f.components],'native array layout');
    const keys=['attributeIndex','resourceId','stride','offset','components','firstByte','requiredEnd','divisor','nativeDivisor','firstElement','lastElement'];
    c.same(Object.fromEntries(keys.map(k=>[k,observed[k]])),Object.fromEntries(keys.map(k=>[k,f[k]])),'independent byte extent '+f.attributeIndex);
  }
  c.same(gl.getError(),gl.NO_ERROR,'native completion/readback has no error');return frame;
}
function poison(gl){
  gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,0,0);gl.viewport(0,0,1,1);gl.colorMask(false,false,false,false);
  for(let i=0;i<gl.getParameter(gl.MAX_VERTEX_ATTRIBS);i++){gl.enableVertexAttribArray(i);gl.vertexAttribDivisor(i,9);gl.vertexAttrib4f(i,.91,.82,.73,.64);}
}
export async function runAcceptance({smoke=false}={}) {
  const c=checks(),report={schema:'virgl-standard-constant-v1',status:'running',guestExecution:false,productionNegotiation:false,
    predictions:c.rows,frames:[],runs:[],blobs:[],rejections:[],suspensions:[],invalidations:[]};window.__standardConstantEvidence=report;
  const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
  c.same(gl instanceof WebGL2RenderingContext,true,'actual WebGL2');const debug=gl.getExtension('WEBGL_debug_renderer_info');
  c.same(Boolean(debug),true,'GPU identity');report.gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
  c.same(/swiftshader|llvmpipe|software|softpipe/i.test(report.gpu),false,'physical GPU');
  const bridge=await createVirglStandardShaderBridge(),make=(s,options={})=>{
    const r=rig(gl,bridge,c,{width:s.width,height:s.height,...options});r.frames=report.frames;r.blobs=report.blobs;return r;};
  const done=r=>{const inspection=c.ok(r.renderer.inspect(),'completed counters');
    c.same(inspection.jobs.reads,0,'all job read tickets released');c.same(inspection.jobs.stagingBytes,0,'all job staging released');
    report.runs.push({history:r.history,exchanges:r.exchanges,events:r.trace.events,calls:r.trace.calls.map(({program,...a})=>a),inspection});dispose(r);};
  const schedules=smoke?[[0,64]]:[[0,64],[2,1],[5,3]];
  for(const [delay,step]of schedules){
    const configs=[['all-widths',{}],['mixed-fetch',{components:[1,2,3,4],strides:[0,16,0,16],divisors:[0xffffffff,2,0,0]}],
      ['arrays-zero',{indexed:false,instances:0}],['byte-one',{indexSize:1,base:32,instances:1}],
      ['short-instanced',{indexSize:2,base:48,instances:3,mode:4}],['all-sixteen',{components:Array(16).fill(4),strides:Array(16).fill(0),divisors:Array.from({length:16},(_,i)=>i%2?0xffffffff:0),base:0x80010000}]];
    for(const [label,options]of smoke?configs.slice(0,1):configs){
      const s=constantSpec(options),r=make(s,{delay,step}),rec=await submit(r,1,join(constantSetup(r,s),constantDraw(s)),label+'-'+delay);
      await constantFrame(r,rec);
      if(label==='all-widths'){
        poison(gl);const b=await submit(r,2,join(constantSetup(r,s,{create:false}),constantDraw(s)),'B-'+delay);await constantFrame(r,b);
        poison(gl);const a=await submit(r,1,join(clear([0,0,0,0]),constantDraw(s)),'A-restored-'+delay);await constantFrame(r,a);
      }
      done(r);
    }
  }
  if(!smoke){
    for(const components of [1,2,3,4]){
      const s=constantSpec({components:[components],strides:[0],divisors:[0xffffffff]}),r=make(s);
      await constantFrame(r,await submit(r,1,join(constantSetup(r,s),constantDraw(s)),'exact-end-'+components));done(r);
      const bad=constantSpec({components:[components],strides:[0],divisors:[0],short:true}),q=make(bad);
      const rec=await submit(q,1,join(constantSetup(q,bad),constantDraw(bad)),'one-byte-short-'+components);
      c.same(rec.result.error.code,'out-of-bounds','short constant rejects');c.same(q.trace.calls.length,0,'short record before draw');
      report.rejections.push({label:rec.label,record:rec,events:q.trace.events,draws:q.trace.calls.length});done(q);
    }
    const staging=4+8+12+16+16;
    for(const admitted of [true,false]){
      const s=constantSpec(),r=make(s,{jobLimits:{transferBytes:staging-(admitted?0:1)}});
      const rec=await submit(r,1,join(constantSetup(r,s,{uploadChunk:staging-(admitted?0:1)}),constantDraw(s)),admitted?'exact-staging':'short-staging');
      if(admitted)await constantFrame(r,rec);else{c.same(rec.result.error.code,'limit-exceeded','aggregate staging rejects');
        c.same(r.trace.calls.length,0,'staging rejection before draw');c.same(r.trace.events.filter(e=>e.name==='copyBufferSubData').length,0,'aggregate limit before any read allocation');
        report.rejections.push({label:rec.label,record:rec,events:r.trace.events,draws:0});}done(r);
    }
    for(const action of ['cancel','collected-revision','reuse','cpu-backing','reset-cancel','store-dispose']){
      const count=new Map(),s=constantSpec(),r=make(s,{step:2,delay:({label})=>{
        const n=count.get(label)??0;count.set(label,n+1);return label==='pending-'+action?(n===0?0:6):1;}});
      c.ok((await submit(r,1,constantSetup(r,s),'setup-'+action)).result,'initialized sources');
      let fired=false,point=null,newGeneration=null,oldGeneration=r.allocations.find(a=>a.metadata.id===3).generation;
      const rec=await submit(r,1,join(clear([0,0,0,0]),constantDraw(s)),'pending-'+action,async(_step,token)=>{
        const inspection=c.ok(r.renderer.inspect(),'suspended batch');if(fired||inspection.jobs.status!=='waiting-attributes')return;
        const collected=r.trace.events.filter(e=>e.label==='pending-'+action&&e.name==='getBufferSubData');
        if(action==='collected-revision'&&collected.length===0)return;
        fired=true;point={inspection,collected,events:r.trace.events.map(e=>({...e}))};
        c.same(inspection.jobs.reads,5,'all four constant reads plus index retained');
        if(action==='cancel'||action==='reset-cancel'){
          if(action==='reset-cancel')c.same(r.renderer.resetCaches().error.code,'busy','reset cannot invalidate pending batch silently');
          c.ok(r.renderer.cancel(token),'cancel whole pending batch');
        }else if(action==='collected-revision'){
          c.same(collected.length,1,'first constant collected while later tickets wait');
          const original=s.data.get(3),changed=new Uint8Array(original.length);changed.fill(127);c.ok(r.store.writeBacking(3,0,changed),'change owner input');
          const command=c.ok(decodeStandardSubmission(transfer(3,original.length)),'concurrent source transfer').commands[0];
          const access=c.ok(r.store.prepareTransfer(1,command),'concurrent transfer ticket');c.ok(r.store.executeTransfer(access.ticket),'actual GPU content revision changed');
        }else if(action==='reuse'){
          c.ok(r.store.unref(3),'retire public constant buffer name');newGeneration=add(r,meta(3,0,64,16,s.data.get(3).length),new Uint8Array(s.data.get(3).length)).generation;
          c.same(newGeneration>oldGeneration,true,'reused name is a new generation');
        }else if(action==='cpu-backing'){
          const changed=new Uint8Array(s.data.get(3).length);changed.fill(127);c.ok(r.store.writeBacking(3,0,changed),'CPU backing mutation without GPU upload');
        }else c.ok(r.store.dispose(),'invalidate all store read tickets');
      });
      c.same(fired,true,'actual multi-read suspension reached');
      if(action==='reuse'||action==='cpu-backing'){
        await constantFrame(r,rec);c.same(rec.result.draws[0].vertexFetches.every(f=>f.resourceGeneration===oldGeneration),true,'retained original constant generation');
      }else{
        c.same(rec.result.ok,false,'invalid/cancelled batch fails');c.same(r.trace.calls.length,0,'invalid batch does not draw');
        c.same(rec.result.gpuComplete,action!=='store-dispose','drained fence or explicit store invalidation');
        if(action!=='store-dispose')c.same(rec.result.error.code,action==='collected-revision'?'stale-storage':'cancelled','specific batch error');
        if(action==='reset-cancel')c.ok(r.renderer.resetCaches(),'reset succeeds after every read drained');
      }
      report.suspensions.push({action,point,oldGeneration,newGeneration,record:rec,async:r.asyncAccess.inspect(),events:r.trace.events});done(r);
    }
    {const s=constantSpec(),r=make(s,{resourceLimits:{tickets:1}});
      const rec=await submit(r,1,join(constantSetup(r,s),constantDraw(s)),'partial-ticket-allocation');
      c.same(rec.result.error.code,'limit-exceeded','second actual read ticket fails bounded allocation');c.same(rec.result.gpuComplete,true,'partial batch drains and fences');
      c.same(r.trace.events.filter(e=>e.name==='copyBufferSubData').length,1,'first real GPU copy precedes allocation failure');
      c.same(r.trace.calls.length,0,'partial allocation never draws');report.rejections.push({label:rec.label,record:rec,events:r.trace.events,draws:0});done(r);}
    {const s=constantSpec(),r=make(s,{delay:6});c.ok((await submit(r,1,constantSetup(r,s),'dispose-setup')).result,'dispose setup');
      const bytes=constantDraw(s),token=c.ok(r.renderer.beginSubmission(1,bytes),'disposal job').job;bytes.fill(255);
      for(let i=0;i<1000;i++){await new Promise(resolve=>setTimeout(resolve,0));r.trace.nextTurn();c.ok(r.renderer.step(token),'disposal later step');
        if(r.renderer.inspect().jobs.status==='waiting-attributes')break;}
      const before=c.ok(r.renderer.inspect(),'pending disposal state');c.same(before.jobs.reads,5,'dispose owns all five reads');
      c.ok(r.renderer.dispose(),'explicit renderer invalidation');const access=r.asyncAccess.inspect();c.same(access.reads,0,'disposal releases all read tickets');
      c.same(access.stagingBytes,0,'disposal releases all staging');c.same(r.renderer.step(token).ok,false,'disposed job token cannot draw');
      report.invalidations.push({action:'renderer-dispose',before,after:access,events:r.trace.events,nativeDraws:r.trace.calls.length});dispose(r);}
    {const legacyBridge=await createVirglShaderBridge(),s=constantSpec({components:[4],strides:[0],divisors:[0],instances:1,indexed:false});
      s.vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n';
      s.fragment='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.25,0.5,0.75,1.0}\n0: MOV OUT[0], IMM[0]\n1: END\n';
      const r=rig(gl,legacyBridge,c,{width:s.width,height:s.height,factory:createVirglAsyncRenderer});r.frames=report.frames;r.blobs=report.blobs;
      const rec=await submit(r,1,join(constantSetup(r,s),constantDraw(s)),'legacy-zero-stride');
      c.same(rec.result.error.code,'unsupported-draw','legacy zero stride remains unsupported');c.same(r.trace.calls.length,0,'legacy rejects before draw');
      report.rejections.push({label:rec.label,record:rec,events:r.trace.events,draws:0});done(r);}
  }
  report.status='passed';return report;
}
