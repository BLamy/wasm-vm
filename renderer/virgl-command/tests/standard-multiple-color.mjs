import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-multiple-color-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {cases,positions,ids,metadata,setup,state,draw,clear,read,initial,update,miss,originalFormat,outputFormat,packedFloatWord,halfFloatWord,packet,join} from '../../../tools/virgl-multiple-color/fixtures.mjs';
import {decodeStandardMultipleColorSubmission,decodeStandardIntegerImageSubmission} from '../decoder.mjs';
export function runWireAcceptance(){
 const c=checks(),records=[];
 for(let count=0;count<=4;count++){
  const wire=packet(5,0,[count,0,...Array.from({length:count},(_,slot)=>slot%2?0:20+slot)]),selected=decodeStandardMultipleColorSubmission(wire),prior=decodeStandardIntegerImageSubmission(wire);
  c.ok(selected,'original multiple framebuffer words');if(count>1)c.same(prior.ok,false,'single-color decoder stays closed');
  records.push({kind:'framebuffer',hex:[...wire].map(n=>n.toString(16).padStart(2,'0')).join(''),selected,prior});
 }
 for(const buffers of [4,8,16,32,60,61]){
  const wire=clear(buffers,[0xffffffff,0x80000000,0x7fc01234,1]),selected=decodeStandardMultipleColorSubmission(wire),prior=decodeStandardIntegerImageSubmission(wire);
  c.ok(selected,'original selected clear words');if(buffers!==4)c.same(prior.ok,false,'single-color clear masks stay closed');
  records.push({kind:'clear',buffers,selected,prior});
 }
 for(const [kind,wire]of [['count5',packet(5,0,[5,0,20,21,22,23,24])],['short',packet(5,0,[4,0,20,21,22])],
  ...[0,2,64,0xffffffff].map(mask=>['clear-mask',clear(mask,[0,0,0,0])])]){
  const result=decodeStandardMultipleColorSubmission(wire);c.same(result.ok,false,'original selected malformed '+kind);records.push({kind,result});
 }
 return{status:'passed',records,predictions:c.rows};
}
function publicExpected(f,slot,plane,bytes){
 const format=f.formats[slot],integer=originalFormat(format),descriptor=outputFormat(format),pixel=descriptor.pixelBytes,stride=f.width*pixel+3,
  expected=new Uint8Array(bytes).fill(0x2e),view=new DataView(expected.buffer);
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
  if(descriptor.packed){view.setUint32(5+y*stride+x*pixel,packedFloatWord([...plane.slice((y*f.width+x)*4,(y*f.width+x+1)*4)]),true);continue;}
  for(let lane=0;lane<descriptor.components;lane++){
  const value=plane[(y*f.width+x)*4+lane],at=5+y*stride+x*pixel+lane*descriptor.bits/8;
  if(integer?.bits===8||format===67)view.setUint8(at,value);else if(integer?.bits===16)view.setUint16(at,value,true);else if(descriptor.bits===16)view.setUint16(at,halfFloatWord(value),true);else view.setUint32(at,value,true);
 }}
 return expected;
}
export async function runAcceptance({smoke=false,fault=null,seed=0x91230ae1,mode='matrix'}={}){
 if(mode==='boundaries')return(await import('./standard-multiple-color-boundaries.mjs')).runBoundaries({seed});
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),
  bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),
  report={status:'running',guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seed,mode,
   host:{drawBuffers:gl.getParameter(gl.MAX_DRAW_BUFFERS),colorAttachments:gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),indexed:Boolean(gl.getExtension('OES_draw_buffers_indexed'))},
   runs:[],frames:[],blobs:[],predictions:c.rows};window.__standardMultipleColorEvidence=report;
 const fixtures=fault?cases({smoke:true}).slice(0,1):cases({smoke});
 for(const [ordinal,f]of fixtures.entries()){
  const r=rig(gl,bridge,c,f,{delay:ordinal%3,step:ordinal%2?1:64,fault}),row={...f,frames:[]},planes=initial(f),targets=[];
  r.blobs=report.blobs;report.runs.push(row);row.positions=await blob(report,positions);
  for(let slot=0;slot<4;slot++)if(f.formats[slot]){
   const m=metadata(ids[slot],f.formats[slot],f.targetWidth,f.targetHeight,f.outputLastLevel,10);
   r.add(m,new Uint8Array(r.outputBackingBytes).fill(0x2e));targets[slot]=r.allocations.at(-1);targets[slot].slot=slot;
  }
  r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
  if(fault==='nonzero-attachment')r.add(metadata(9,196,f.targetWidth,f.targetHeight,f.outputLastLevel,10),new Uint8Array(r.outputBackingBytes).fill(0x2e));
  async function capture(kind,record,options={}){
   c.ok(record.result,'original multiple-color '+kind);c.same(record.result.gpuComplete,true,'owned multiple-color physical completion');
   update(f,planes,kind,options);
   const frame={run:report.runs.length-1,kind,historyIndex:r.history.length-1,label:record.label,completion:{...r.lastCompletion},targets:[]};
   report.frames.push(frame);row.frames.push(report.frames.length-1);
   for(const target of targets.filter(Boolean)){
    const slot=target.slot,format=f.formats[slot],texture=target.storage.texture;
    if(fault==='completed-output'&&kind==='draw'&&slot===3){
     const before=nativeRead(r,texture,format,f.width,f.height,f.outputLevel),words=new Uint32Array(before.buffer).slice();words[0]^=1;
     frame.beforeSabotage=await blob(report,before);frame.originalCompletion={...r.lastCompletion};
     r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);r.traced.bindTexture(gl.TEXTURE_2D,texture);
     r.traced.pixelStorei(gl.UNPACK_ALIGNMENT,1);r.traced.pixelStorei(gl.UNPACK_ROW_LENGTH,0);
     r.traced.texSubImage2D(gl.TEXTURE_2D,f.outputLevel,0,0,f.width,f.height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,words);
     frame.sabotageCompletion=await physicalFence(r,'completed-nonzero-color-corruption');
     c.same(frame.sabotageCompletion.sync!==frame.originalCompletion.sync,true,'nonzero target corruption has a second native sync');
    }
    const native=nativeRead(r,texture,format,f.width,f.height,f.outputLevel),differences=miss(native,planes[slot],format),capture={slot,metadata:target.metadata,
     generation:target.generation,texture:r.trace.id(texture),level:f.outputLevel,native:await blob(report,native),expected:[...planes[slot]],planes:[]};
    frame.targets.push(capture);
    if(differences.length&&fault)report.sabotage={fault,slot,completion:{...r.lastCompletion},held:false,miss:differences.slice(0,16)};
    c.same(differences.slice(0,16),[],'entire original multiple-color target '+slot+' after actual completion');
    for(let level=0;level<=f.outputLastLevel;level++){
     const width=Math.max(1,f.targetWidth>>level),height=Math.max(1,f.targetHeight>>level);
     capture.planes.push({level,width,height,native:await blob(report,nativeRead(r,texture,format,width,height,level))});
    }
    const result=await submit(r,1,read(f,slot),record.label+'/public-slot'+slot);c.ok(result.result,'original per-target public transfer');
    capture.publicHistory=r.history.length-1;const backing=c.ok(r.store.readBacking(ids[slot],0,r.outputBackingBytes),'original complete per-target backing').bytes;
    capture.backing=await blob(report,backing);const expectedBacking=publicExpected(f,slot,planes[slot],r.outputBackingBytes);
    const backingDifferences=[];for(let at=0;at<backing.length;at++)if(backing[at]!==expectedBacking[at]&&backingDifferences.length<16)backingDifferences.push({at,observed:backing[at],expected:expectedBacking[at]});
    c.same(backingDifferences,[],'complete original target backing with padding');
   }
   c.same(gl.getError(),gl.NO_ERROR,'native complete multiple-color capture');
  }
  try{
   await capture('clear',await submit(r,1,setup(f),'multiple-setup-'+ordinal));
   c.ok((await submit(r,1,state(f),'multiple-state-'+ordinal)).result,'original replicated RT0 state');
   if(fault==='nonzero-attachment')r.armFault();
   for(const temperature of ['first','warm']){
    await capture('draw',await submit(r,1,draw(),'multiple-draw-'+ordinal+'-'+temperature));
    row.cache??=[];row.cache.push(r.renderer.inspect());
   }
   c.same(row.cache[0].work.programLinks,row.cache[1].work.programLinks,'warm multiple-color native program reuse');
   if(!smoke&&!fault){
    const slot=f.formats.findLastIndex(Boolean),buffers=4<<slot;
    await capture('clear',await submit(r,1,clear(buffers,f.clearWords),'multiple-selective-clear-'+ordinal),{buffers});
   }
  }finally{await finish(r,report,row);}
  if((ordinal+1)%16===0)await window.textureProgress?.({cases:ordinal+1,frames:report.frames.length});
 }
 report.status='passed';return report;
}
