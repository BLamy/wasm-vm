// Independent critic: same numeric VS/FS slot, distinct mip ranges and retained owner.
import {rig,finish,blob,submit,nativeRead} from './standard-shared-exponent-consumer-rig.mjs';
import {checks} from './standard-instanced-draws.mjs';
import {createVirglStandardTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import * as decoders from '../decoder.mjs';
import {source} from '../../../tools/virgl-command/standard-shared-exponent-fixtures.mjs';
import {setup,draw,outputRead,packet,join,meta,sampler,imageView} from '../../../tools/virgl-command/standard-shared-exponent-consumer-fixtures.mjs';
import {frameMisses} from '../../../tools/virgl-command/standard-shared-exponent-consumer-pixels.mjs';
export {runWireAcceptance} from './standard-shared-exponent-consumer.mjs';

export function preparation(seed=0x243f6a88){
 const src=source(125,13,7,3,seed);let random=seed>>>0;const next=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;};
 for(const plane of src.planes){const bits=new DataView(plane.input.buffer);for(let i=0;i<plane.width*plane.height;i++)bits.setUint32(i*4,((32+32*(next()%8))|(32+32*(next()%8))<<9|(32+32*(next()%8))<<18|16<<27)>>>0,true);for(let y=0;y<plane.height;y++)src.backing.set(plane.input.subarray(y*plane.width*4,(y+1)*plane.width*4),plane.offset+y*plane.stride);}
 const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0]\nDCL SAMP[3]\nDCL SVIEW[3], 2D, FLOAT\nIMM[0] FLT32 {0.375,0.625,0,1}\n0: MOV OUT[0], IN[0]\n1: TXL TEMP[0], IMM[0], SAMP[3], 2D\n2: MOV OUT[1], TEMP[0]\n3: END\n';
 const fragment='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL TEMP[0]\nDCL SAMP[3]\nDCL SVIEW[3], 2D, FLOAT\nIMM[0] FLT32 {0.375,0.625,0,0}\n0: TXL TEMP[0], IMM[0], SAMP[3], 2D\n1: ADD OUT[0], TEMP[0], IN[0]\n2: END\n';
 const positions=new Uint8Array(new Float32Array([-1,-1,0,1,1,-1,0,1,1,1,0,1,-1,-1,0,1,1,1,0,1,-1,1,0,1]).buffer);
 const f={name:'critic-dual-stage-'+seed.toString(16),width:5,height:3,source:src,stage:'both',opcode:'TXL+TXL',slot:3,firstLevel:1,lastLevel:3,swizzle:[0,1,2,3],outputFormat:31,outputLevel:0,clearColor:[.125,.25,.5,.75],vertex,fragment,positions,parameters:{s:2,t:2,r:2,min:0,mip:0,mag:0,minLod:-1000,maxLod:1000},views:[{stage:0,slot:3,handle:5,range:[1,3]},{stage:1,slot:3,handle:9,range:[0,2]}]};
 const decode=(level,u,v)=>{const p=src.planes[level],i=(Math.floor(v*p.height)*p.width+Math.floor(u*p.width))*4,n=new DataView(p.input.buffer).getUint32(i,true),scale=2**((n>>>27)-24);return[(n&511)*scale,(n>>>9&511)*scale,(n>>>18&511)*scale,1];};
 const A=decode(2,.375,.625),B=decode(0,.375,.625);f.originalPrediction=A.map((n,k)=>n+B[k]);return f;
}
const bothViews=f=>join(sampler(8,f.parameters),...f.views.flatMap(v=>[imageView(v.handle,6,125,...v.range,[0,1,2,3]),packet(10,0,[v.stage,v.slot,v.handle]),packet(18,0,[v.stage,v.slot,8])]));

async function novel({seed,fault}){
 const f=preparation(seed),c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardTextureShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:'novel',gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seed,guestExecution:false,productionNegotiation:false,frames:[],runs:[],blobs:[],predictions:c.rows,preGpuPrediction:f.originalPrediction};window.__standardSharedExponentConsumerEvidence=report;
 const r=rig(gl,bridge,c,f,{delay:3,step:1}),target=r.allocations[0].storage.texture;r.blobs=report.blobs;r.add(meta(3,0,64,0,f.positions.length),f.positions);const old=r.add(f.source.metadata,f.source.backing);
 const row={name:f.name,stage:f.stage,opcode:f.opcode,slot:f.slot,range:[1,3],swizzle:f.swizzle,parameters:f.parameters,views:f.views,source:f.source.metadata,target:r.allocations[0].metadata,width:f.width,height:f.height,outputLevel:0,clearColor:f.clearColor,vertex:f.vertex,fragment:f.fragment,positions:await blob(report,f.positions),backing:await blob(report,f.source.backing),planes:[],sourceGeneration:old.generation,originalPrediction:f.originalPrediction,cache:[],actions:[]};report.runs.push(row);for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
 async function capture(record,kind){
  c.ok(record.result,'critic original submission completes');c.same(record.result.gpuComplete,true,'critic actual terminal fence consumed');
  if(fault&&kind==='draw'){
   // A real native output corruption AFTER the original draw fence; the oracle is unchanged.
   const oldFb=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),oldMask=gl.getParameter(gl.COLOR_WRITEMASK),scissor=gl.isEnabled(gl.SCISSOR_TEST),fb=gl.createFramebuffer();
   try{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);gl.disable(gl.SCISSOR_TEST);gl.colorMask(true,false,false,false);gl.clearBufferfv(gl.COLOR,0,new Float32Array([7,0,0,0]));c.same(gl.getError(),gl.NO_ERROR,'actual post-fence red output corruption');report.sabotage={fault,physicalFenceConsumed:true,originalPrediction:f.originalPrediction,originalLabel:record.label,mutation:{method:'clearBufferfv',mask:[true,false,false,false],value:7}};}finally{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,oldFb);gl.colorMask(...oldMask);gl[scissor?'enable':'disable'](gl.SCISSOR_TEST);gl.deleteFramebuffer(fb);}
  }
  const pixels=nativeRead(r,target,31,f.width,f.height,0),color=kind==='clear'?f.clearColor:f.originalPrediction,expected=new Float32Array(f.width*f.height*4);for(let i=0;i<f.width*f.height;i++)expected.set(color,i*4);
  const frame={run:0,label:record.label,kind,historyIndex:r.history.length-1,pixels:await blob(report,pixels),mask:15,blend:false,previous:null,outputs:[{level:0,width:f.width,height:f.height,native:await blob(report,pixels)}],bindings:[]};report.frames.push(frame);
  if(kind==='draw')for(const view of f.views){gl.activeTexture(gl.TEXTURE0+(view.stage===0?16:0)+view.slot);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),a=r.allocations.find(a=>a.storage.texture===texture),planes=[];c.same(Boolean(a),true,'critic retained view native identity');for(let local=0;local<=view.range[1]-view.range[0];local++){const p=f.source.planes[view.range[0]+local];planes.push({local,original:p.level,width:p.width,height:p.height,native:await blob(report,nativeRead(r,texture,125,p.width,p.height,local))});}frame.bindings.push({stage:view.stage===0?'vertex':'fragment',slot:view.slot,range:view.range,metadata:a.metadata,nativeTexture:r.trace.id(texture),planes});}gl.activeTexture(gl.TEXTURE0);
  const misses=frameMisses(pixels,expected);if(report.sabotage)Object.assign(report.sabotage,{held:misses.length===0,observed:frame.pixels,misses:misses.slice(0,8)});c.same(misses.slice(0,8),[],'unchanged fixed-budget pixel oracle sees original dual-stage arithmetic');
  const read=await submit(r,1,outputRead(f),record.label+'/public');c.ok(read.result,'critic original public output');c.same(read.result.gpuComplete,true,'critic actual public output fence');frame.publicHistory=r.history.length-1;frame.outputBacking=await blob(report,c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'critic whole SG output backing').bytes);
 }
 try{
  await capture(await submit(r,1,setup(f),'critic-dual-setup'),'clear');c.ok((await submit(r,1,bothViews(f),'critic-dual-views')).result,'critic both stage slot3 view bind');
  for(const temperature of ['first','warm']){await capture(await submit(r,1,draw(),'critic-dual-'+temperature),'draw');row.cache.push({temperature,snapshot:r.renderer.inspect()});}c.same(row.cache[0].snapshot.work.programLinks,row.cache[1].snapshot.work.programLinks,'critic warm dual-stage native program reused');
  c.ok((await submit(r,2,join(setup(f),bothViews(f)),'critic-dual-second-context')).result,'critic both ranges retained in context2');c.ok(r.store.unref(6),'critic remove public source name');const replacement=source(125,9,5,2,seed^0x9e3779b9),fresh=r.add(replacement.metadata,replacement.backing);row.actions.push({kind:'critic-dual-source-reuse',oldGeneration:old.generation,newGeneration:fresh.generation,replacement:replacement.metadata});c.same(fresh.generation>old.generation,true,'critic unequal native source generation');
  for(const ctx of [2,1])await capture(await submit(r,ctx,draw(),'critic-dual-retained-context-'+ctx),'draw');c.ok(r.renderer.resetCaches(),'critic dual-stage reset all caches');c.ok(r.renderer.restoreContext(1),'critic dual-stage native context restore');await capture(await submit(r,1,draw(),'critic-dual-after-cache-reset'),'draw');
 }finally{await finish(r,report,row);}report.status='passed';return report;
}
export async function runAcceptance({mode='novel',seed=0x243f6a88,fault=null}={}){
 if(mode==='boundaries')return(await import('./standard-shared-exponent-consumer-boundaries.mjs')).runBoundaries({seed});
 if(mode==='historical'){const result=await(await import('./standard-packed-float-consumer-critic.mjs')).runAcceptance({mode:'historical'});result.wireControls=[];for(const [name,decode]of Object.entries(decoders).filter(([n])=>/^decode.*Submission$/.test(n)))for(const wire of [imageView(5,6,125,1,3,[0,1,2,3]),imageView(5,6,125,1,3,[2,4,0,5])]){const accepted=name==='decodeStandardSharedExponentImageSubmission',answer=decode(wire);if(answer.ok!==accepted)throw Error('historical original125 admission escaped '+name);result.wireControls.push({name,hex:[...wire].map(n=>n.toString(16).padStart(2,'0')).join(''),accepted,result:answer});}window.__standardSharedExponentConsumerEvidence=result;return result;}
 return novel({seed,fault});
}
