import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-packed-depth-consumer-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {source,metadata,positions,word,packet,join,shader,surface,imageView,sampler,textureTransfer,draw,dsa,depthClear} from '../../../tools/virgl-packed-depth-consumer/fixtures.mjs';

// A critic-promoted original packet attack: two sampled ranges straddle an
// attached depth mip, in both shader stages, then narrow/reject/refresh a range.
export async function runAcceptance({seed=0x43c17a6d,fault=null}={}) {
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:'critic',seed,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],blobs:[],predictions:c.rows};
 report.fault=fault;window.__standardPackedDepthConsumerEvidence=report;
 const vertex='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0]\nDCL SAMP[15]\nDCL SVIEW[15], 2D, FLOAT\nIMM[0] FLT32 {.375,.25,0,0}\n0: MOV OUT[0], IN[0]\n1: TXL TEMP[0], IMM[0], SAMP[15], 2D\n2: MOV OUT[1], TEMP[0]\n3: END\n';
 const fragment=lod=>'FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL TEMP[0..1]\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nIMM[0] FLT32 {.375,.25,0,'+lod+'}\nIMM[1] FLT32 {0,0,0,1}\n0: TXL TEMP[0], IMM[0], SAMP[0], 2D\n1: MOV TEMP[1], IN[0]\n2: MOV TEMP[1].y, TEMP[0].xxxx\n3: MOV TEMP[1].zw, IMM[1]\n4: MOV OUT[0], TEMP[1]\n5: END\n';
 for(const format of [20,21]) {
  const src=source(format,seed^format,17,9,3),width=src.planes[1].width,height=src.planes[1].height,f={format,source:src,width,height,outputLevel:0,outputFormat:31},r=rig(gl,bridge,c,f,{delay:format===20?2:1,step:1}),row={name:'critic-dual-stage-straddling-depth-'+format,format,width,height,source:src.metadata,sourceBacking:await blob(report,src.backing),positions:await blob(report,positions),planes:[],frames:[],actions:[]};
  report.runs.push(row);r.blobs=report.blobs;
  r.add(metadata(1,31,width,height),new Uint8Array(20000).fill(0x2e));r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);const original=r.add(src.metadata,src.backing);row.sourceGeneration=original.generation;
  for(const p of src.planes)row.planes.push({...p,input:await blob(report,p.input)});
  const target=r.allocations.find(a=>a.metadata.id===1),storage=r.allocations.find(a=>a.metadata.id===6);
  const execute=async(bytes,label)=>{const value=await submit(r,1,bytes,label);row.actions.push({label,historyIndex:r.history.length-1,result:value.result});return value;};
  const capture=async(label)=>{
   const completion={...r.lastCompletion},historyIndex=r.history.length-1,frame={label,completion,historyIndex,native:await blob(report,await nativeRead(r,target.storage.texture,31,width,height)),depths:[],samplers:[]};
   const actual=r.draws.at(-1),active=gl.getParameter(gl.ACTIVE_TEXTURE);
   for(const q of actual.samplers) {
    gl.activeTexture(gl.TEXTURE0+q.unit);const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),a=r.allocations.find(a=>a.storage.texture===texture),entry={...q,planes:[]};c.same(Boolean(a),true,'critic sampled private texture is owned');
    for(let local=0;local<=q.last;local++)entry.planes.push({local,width:Math.max(1,a.metadata.width>>local),height:Math.max(1,a.metadata.height>>local),native:await blob(report,await nativeRead(r,texture,format,Math.max(1,a.metadata.width>>local),Math.max(1,a.metadata.height>>local),local))});
    frame.samplers.push(entry);
   }
   gl.activeTexture(active);
   for(const p of src.planes)frame.depths.push({level:p.level,width:p.width,height:p.height,native:await blob(report,await nativeRead(r,storage.storage.texture,format,p.width,p.height,p.level))});
   const read=packet(43,0,[1,0,0,width*16+3,0,0,0,0,width,height,1,5,2]);c.ok((await execute(read,label+'/public')).result,'critic output public native read');frame.publicHistory=r.history.length-1;frame.backing=await blob(report,c.ok(r.store.readBacking(1,0,20000),'critic all output backing').bytes);row.frames.push(frame);
  };
  try {
   c.ok((await execute(join(textureTransfer(3,0,positions.length,1),...src.planes.map(p=>textureTransfer(6,p.level,p.width,p.height,p.offset,p.stride)),shader(10,0,vertex),shader(11,1,fragment(1)),packet(1,5,[12,0,0,0,31]),packet(2,5,[12]),packet(6,0,[16,0,3]),surface(20,1,31,0),surface(21,6,format,1),packet(5,0,[1,21,20]),packet(4,0,[0,...[width/2,height/2,.5,width/2,height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),dsa(30,7,true,false),sampler(50,{s:2,t:2,r:2,min:0,mip:0,mag:0,minLod:-1000,maxLod:1000}),imageView(51,6,format,0,0,[0,1,2,3]),imageView(52,6,format,2,3,[0,1,2,3]),packet(10,0,[0,15,51]),packet(18,0,[0,15,50]),packet(10,0,[1,0,52]),packet(18,0,[1,0,50])), 'critic-dual-setup-'+format)).result,'critic original dual stage setup');
   c.ok((await execute(draw(),'critic-disjoint-dual-draw-'+format)).result,'critic nonoverlapping dual original ranges');
   if(fault==='completed-stencil'&&format===20) {
    row.corruption={before:{...r.lastCompletion}};r.traced.stencilMask(255);r.traced.clearStencil(233);r.traced.clear(gl.STENCIL_BUFFER_BIT);row.corruption.after=await physicalFence(r,'critic-completed-stencil-corruption');
   }
   await capture('straddle');
   c.ok((await execute(join(shader(13,1,fragment(0)),packet(31,0,[13,1]),imageView(53,6,format,2,2),packet(10,0,[1,0,53]),draw()),'critic-narrow-dual-draw-'+format)).result,'critic narrow original upper view');await capture('narrow');
   const before={draws:r.draws.length,copies:r.events.filter(e=>e.name==='blitFramebuffer').length};
   const refusal=await execute(join(imageView(54,6,format,1,2),packet(10,0,[1,0,54]),draw()),'critic-overlap-refusal-'+format);c.same(refusal.result.error.code,'framebuffer-feedback','critic middle mip overlap refused');c.same(r.draws.length,before.draws,'critic overlap issues no native draw');c.same(r.events.filter(e=>e.name==='blitFramebuffer').length,before.copies,'critic overlap issues no private copy');row.refusal={historyIndex:r.history.length-1,before,after:{draws:r.draws.length,copies:r.events.filter(e=>e.name==='blitFramebuffer').length}};
   c.ok((await execute(join(packet(10,0,[1,0,53]),surface(22,6,format,2),packet(5,0,[0,22]),depthClear(.3125)),'critic-GPU-upper-only-clear-'+format)).result,'critic GPU-only upper original mip clear');row.clear={level:2,depth:.3125,historyIndex:r.history.length-1,completion:{...r.lastCompletion}};
   c.ok((await execute(join(packet(5,0,[1,21,20]),draw()),'critic-upper-refresh-dual-draw-'+format)).result,'critic refreshes upper view independently of lower');await capture('refresh');
   row.depthPublic={backingBefore:await blob(report,c.ok(r.store.readBacking(6,0,src.backing.length),'critic before all public depth reads').bytes),reads:[]};
   for(const p of src.planes) {
    const stride=p.width*4+7,offset=7000+p.level*1500;const read=packet(43,0,[6,p.level,0,stride,0,0,0,0,p.width,p.height,1,offset,2]);c.ok((await execute(read,'critic-depth-public-'+format+'-'+p.level)).result,'critic original packed public native field read');row.depthPublic.reads.push({level:p.level,historyIndex:r.history.length-1,backing:await blob(report,c.ok(r.store.readBacking(6,0,src.backing.length),'critic all public packed fields and padding').bytes)});
   }
  } finally {await finish(r,report,row);}
  if(window.__recordPackedConsumerRun){row.predictions=c.rows.splice(0);const index=report.runs.indexOf(row);report.runs[index]={name:row.name,format:row.format,...await window.__recordPackedConsumerRun(index,JSON.stringify(row))};}
 }
 report.status='passed';return report;
}
