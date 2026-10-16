import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-integer-image-consumer-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {consumerCases,setup,views,draw,outputRead,expectedFrame,fullMisses,originalFormat,
 packet,join,imageView,surface,integerClear} from '../../../tools/virgl-integer-image-consumer/fixtures.mjs';
import {decodeStandardIntegerImageSubmission,decodeStandardSharedExponentImageSubmission} from '../decoder.mjs';
export function runWireAcceptance(){
 const c=checks(),records=[];
 for(let format=177;format<=200;format++)for(const [kind,wire]of [
  ['view',imageView(9,6,format,1,3,[2,4,0,5])],['surface',surface(10,6,format,2)]]){
  const selected=decodeStandardIntegerImageSubmission(wire),prior=decodeStandardSharedExponentImageSubmission(wire);
  c.ok(selected,'original integer '+kind);c.same(prior.ok,false,'historical original integer packets stay closed');
  records.push({kind,format,hex:[...wire].map(n=>n.toString(16).padStart(2,'0')).join(''),selected,prior});
 }
 for(const[reason,index,value]of [['target',3,196|3<<24],['layer',4,1],['range',5,3|1<<8],
  ['extent',5,0xf00],['swizzle',6,6],['swizzle-bits',6,0x1000]]){
  const wire=imageView(9,6,196,1,3);new DataView(wire.buffer).setUint32(index*4,value,true);
  const result=decodeStandardIntegerImageSubmission(wire);c.same(result.ok,false,'original integer view refuses '+reason);
  records.push({kind:'refusal',reason,hex:[...wire].map(n=>n.toString(16).padStart(2,'0')).join(''),result});
 }
 for(const format of [0,16,17,20,125,201,0xffffff]){
  const wire=surface(10,6,format,2),result=decodeStandardIntegerImageSubmission(wire);
  c.same(result.ok,false,'unqualified surface stays closed');records.push({kind:'surface-refusal',format,result});
 }
 const raw=integerClear([0xffffffff,0x80000000,0x7fc01234,1]),selected=decodeStandardIntegerImageSubmission(raw),
  prior=decodeStandardSharedExponentImageSubmission(raw);
 c.ok(selected,'owned original integer clear union');c.same(prior.ok,false,'historical nonfinite float clear stays closed');
 c.same(selected.commands[0].fields.colorWords,[0xffffffff,0x80000000,0x7fc01234,1],'original clear union words');
 records.push({kind:'clear-union',hex:[...raw].map(n=>n.toString(16).padStart(2,'0')).join(''),selected,prior});
 return{status:'passed',records,predictions:c.rows};
}
export function describe(f){
 const fixture={...f.compilerFixture};delete fixture.planes;delete fixture.targets;delete fixture.vertexText;delete fixture.fragmentText;
 return{name:f.name,stage:f.stage,opcode:f.opcode,slot:f.slot,range:[f.firstLevel,f.lastLevel],swizzle:f.swizzle,parameters:f.parameters,
  source:f.source.metadata,outputFormat:f.outputFormat,outputLevel:f.outputLevel,width:f.width,height:f.height,
  clearWords:f.clearWords,fixture,vertex:f.vertex,fragment:f.fragment,frames:[],planes:[]};
}
export async function runAcceptance({smoke=false,fault=null,seed=0x612309af,mode='matrix'}={}){
 if(mode==='boundaries')return (await import('./standard-integer-image-consumer-boundaries.mjs')).runBoundaries({seed});
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),
  bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),
  report={status:'running',guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seed,mode,
   runs:[],frames:[],blobs:[],predictions:c.rows};window.__standardIntegerImageConsumerEvidence=report;
 let cases=mode==='float'?consumerCases().filter(f=>f.source.metadata.format===31):consumerCases({smoke});
 if(mode==='typed')cases=consumerCases().filter(f=>f.constants);
 if(fault)cases=consumerCases().filter(f=>f.source.metadata.format===196&&f.stage==='fragment'&&f.opcode==='TXF'&&
  f.firstLevel===1&&f.outputFormat===196).slice(0,1).map(f=>({...f,swizzle:[0,1,2,3],name:f.name+'/physical-control-identity'}));
 c.same(cases.length>0,true,'original native consumer matrix is nonempty');
 for(const [ordinal,f]of cases.entries()){
  const r=rig(gl,bridge,c,f,{delay:ordinal%3,step:ordinal%2?1:64,fault}),target=r.allocations[0].storage.texture,
   run=describe(f);r.blobs=report.blobs;report.runs.push(run);
  run.target=r.allocations[0].metadata;run.positions=await blob(report,f.positions);run.backing=await blob(report,f.source.backing);
  if(f.constants)run.constants=await blob(report,f.constants);run.vertexFormat=f.vertexFormat??31;
  for(const p of f.source.planes)run.planes.push({...p,input:await blob(report,p.input)});
  r.add({id:3,target:0,format:64,bind:0,width:f.positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},f.positions);
  r.add(f.source.metadata,f.source.backing);
  if(f.constants)r.add({id:200,target:0,format:64,bind:80,width:f.constants.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},f.constants);
  async function capture(kind,record){
   c.ok(record.result,'complete original integer '+kind);c.same(record.result.gpuComplete,true,'original owned completion fence');
   const frame={run:report.runs.length-1,kind,label:record.label,historyIndex:r.history.length-1,completion:r.lastCompletion,
    dump:record.dump,native:null,outputs:[],bindings:[]};
   if(fault==='completed-output'&&kind==='draw'){
    const before=nativeRead(r,target,f.outputFormat,f.width,f.height,f.outputLevel),words=new Uint32Array(before.buffer).slice();
    words[0]^=1;frame.beforeSabotage=await blob(report,before);frame.originalCompletion={...r.lastCompletion};
    const old=gl.getParameter(gl.TEXTURE_BINDING_2D),unpack=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
    try{r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);r.traced.bindTexture(gl.TEXTURE_2D,target);
     r.traced.pixelStorei(gl.UNPACK_ALIGNMENT,1);r.traced.pixelStorei(gl.UNPACK_ROW_LENGTH,0);
     r.traced.texSubImage2D(gl.TEXTURE_2D,f.outputLevel,0,0,f.width,f.height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,words);
    }finally{r.traced.bindTexture(gl.TEXTURE_2D,old);r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpack);}
    frame.sabotageCompletion=await physicalFence(r,'completed-original-output-corruption');
    c.same(frame.sabotageCompletion.sync!==frame.originalCompletion.sync,true,'corruption consumes a second distinct native sync');
   }
   const native=nativeRead(r,target,f.outputFormat,f.width,f.height,f.outputLevel),expected=expectedFrame(f,kind),miss=fullMisses(native,expected);
   frame.native=await blob(report,native);frame.expected=await blob(report,expected);
   report.frames.push(frame);run.frames.push(report.frames.length-1);
   if(fault&&miss.length)report.sabotage={fault,fenceCompleted:record.result.gpuComplete,completion:r.lastCompletion,
    frame:report.frames.length-1,held:false,miss:miss.slice(0,16)};
   c.same(miss.slice(0,16),[],'complete original integer output words after physical completion');
   for(let level=0;level<=run.target.lastLevel;level++){
    const width=Math.max(1,Math.floor(run.target.width/2**level)),height=Math.max(1,Math.floor(run.target.height/2**level));
    frame.outputs.push({level,width,height,native:await blob(report,nativeRead(r,target,f.outputFormat,width,height,level))});
   }
   if(kind==='draw'){
    const unit=(f.stage==='vertex'?16:0)+f.slot,active=gl.getParameter(gl.ACTIVE_TEXTURE);gl.activeTexture(gl.TEXTURE0+unit);
    const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),allocation=r.allocations.find(a=>a.storage.texture===texture);
    c.same(Boolean(allocation),true,'native retained original integer texture');
    const planes=[];for(let local=0;local<=f.lastLevel-f.firstLevel;local++){
     const p=f.source.planes[f.firstLevel+local];planes.push({local,original:p.level,width:p.width,height:p.height,
      native:await blob(report,nativeRead(r,texture,f.source.metadata.format,p.width,p.height,local))});
    }
    frame.bindings.push({stage:f.stage,slot:f.slot,texture:r.trace.id(texture),metadata:allocation.metadata,planes});
    gl.activeTexture(active);
    frame.uniformBlocks=[];const program=gl.getParameter(gl.CURRENT_PROGRAM);
    for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORM_BLOCKS);i++){
     const name=gl.getActiveUniformBlockName(program,i);if(name!=='VirglFSConst0')continue;
     const binding=gl.getActiveUniformBlockParameter(program,i,gl.UNIFORM_BLOCK_BINDING),size=gl.getActiveUniformBlockParameter(program,i,gl.UNIFORM_BLOCK_DATA_SIZE),
      buffer=gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,binding),start=gl.getIndexedParameter(gl.UNIFORM_BUFFER_START,binding),old=gl.getParameter(gl.COPY_READ_BUFFER_BINDING),bytes=new Uint8Array(size);
     r.traced.bindBuffer(gl.COPY_READ_BUFFER,buffer);r.traced.getBufferSubData(gl.COPY_READ_BUFFER,start,bytes);r.traced.bindBuffer(gl.COPY_READ_BUFFER,old);
     frame.uniformBlocks.push({name,binding,size,start,native:await blob(report,bytes)});
    }
    if(f.constants)c.same(frame.uniformBlocks.length,1,'original constant0 has actual native uniform block');
   }
   const read=await submit(r,1,outputRead(f),record.label+'/public-read');c.ok(read.result,'original integer public transfer');
   frame.publicHistory=r.history.length-1;frame.outputBacking=await blob(report,c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'full original output backing').bytes);
   c.same(gl.getError(),gl.NO_ERROR,'native integer output/source captures');
  }
  try{
   const set=await submit(r,1,setup(f),'integer-setup-'+ordinal);await capture('clear',set);
   c.ok((await submit(r,1,views(f),'integer-view-'+ordinal)).result,'original integer view/native sampler');
   for(const temperature of ['first','warm']){
    const record=await submit(r,1,draw(),'integer-draw-'+ordinal+'-'+temperature);await capture('draw',record);
    run.cache??=[];run.cache.push({temperature,snapshot:r.renderer.inspect()});
   }
   c.same(run.cache[0].snapshot.work.programLinks,run.cache[1].snapshot.work.programLinks,'warm native typed program reuse');
  }finally{await finish(r,report,run);}
  if((ordinal+1)%32===0)await window.textureProgress?.({cases:ordinal+1,frames:report.frames.length});
 }
 report.status='passed';return report;
}
