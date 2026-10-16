// Fresh original TGSI/packets: two same-stage sparse slots, fixed/float projective endpoints.
// No generated ESSL or renderer result is read to produce the expected words.
import {rig,finish,blob,nativeRead,submit,checks} from '../../../renderer/virgl-command/tests/standard-shadow-samplers-rig.mjs';
import {createVirglStandardShadowTextureShaderBridge as create} from '../../../renderer/virgl-shader/standard.mjs';
import {packet,join,shader,word,imageView,textureTransfer,surface,metadata} from '../../../tools/virgl-shadow-samplers/fixtures.mjs';
const numbered=(decl,ops)=>decl.join('\n')+'\n'+ops.map((op,i)=>i+': '+op+'\n').join('');
const originalSampler=(handle,fn,linear)=>packet(1,7,[handle,2|2<<3|2<<6|Number(linear)<<9|2<<11|Number(linear)<<13|1<<15|fn<<16,0,word(-2),word(4),0,0,0,0]);
function pair(owner){
 const declarations=['DCL TEMP[0..1]','DCL SAMP[13]','DCL SVIEW[13], 2D, FLOAT','DCL SAMP[1]','DCL SVIEW[1], 2D, FLOAT'];
 const sample=out=>['TXP TEMP[0], IN[1], SAMP[13], SHADOW2D','TXP TEMP[1], IN[1], SAMP[1], SHADOW2D','XOR '+out+', TEMP[0], TEMP[1]','END'];
 return owner==='vertex'?{
  vertexText:numbered(['VERT','DCL IN[0]','DCL IN[1]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]',...declarations],['MOV OUT[0], IN[0]',...sample('OUT[1]')]),
  fragmentText:numbered(['FRAG','DCL IN[0], GENERIC[0], CONSTANT','DCL OUT[0], COLOR'],['MOV OUT[0], IN[0]','END'])
 }:{
  vertexText:numbered(['VERT','DCL IN[0]','DCL IN[1]','DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]'],['MOV OUT[0], IN[0]','MOV OUT[1], IN[1]','END']),
  fragmentText:numbered(['FRAG','DCL IN[1], GENERIC[0], CONSTANT','DCL OUT[0], COLOR',...declarations],sample('OUT[0]'))
 };
}
function prediction(f,swizzles){
 const coords=new Float32Array(f.inputs[1].buffer),words=[];
 for(let i=0;i<f.width*f.height;i++){
  const reference=coords[i*4+2]/coords[i*4+3],fixed=Number(Math.min(1,Math.max(0,reference))===f.depth),floating=Number(reference===f.depth);
  const results=[fixed,floating].map((value,j)=>swizzles[j].map(c=>word(c===4?0:c===5?1:value)));
  words.push(...results[0].map((w,j)=>(w^results[1][j])>>>0));
 }
 return new Uint8Array(new Uint32Array(words).buffer);
}
export async function runAcceptance({seed=0x61a387d9,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await create(),ext=gl.getExtension('WEBGL_debug_renderer_info');
 const report={status:'running',mode:'critic-original-dual-slot-projective',seed,fault,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};window.__standardShadowSamplerEvidence=report;
 for(const stage of ['vertex','fragment'])for(const depth of [0,1]){
  const width=3,height=3,positions=[],coordinates=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   positions.push(2*(x+.5)/width-1,2*(y+.5)/height-1,0,1);
   const q=[.5,2,-2][(y+(seed>>>0)%3)%3],ref=(depth?[.75,1,1.25]:[-.25,0,.25])[x];coordinates.push(.25*q,.75*q,ref*q,q);
  }
  const inputs=[new Uint8Array(new Float32Array(positions).buffer),new Uint8Array(new Float32Array(coordinates).buffer)],f={stage,depth,width,height,inputs,...pair(stage)};
  const r=rig(gl,bridge,c,f,{step:1,delay:(seed+depth)%4,fault}),snapshot=JSON.stringify({vertexText:f.vertexText,fragmentText:f.fragmentText,inputs:[...inputs[1]]}),row={name:'critic/'+stage+'/endpoint'+depth,width,height,stage,depth,vertexText:f.vertexText,fragmentText:f.fragmentText,originalCallerSnapshot:snapshot,inputs:[],depthInputs:[],frames:[]};r.blobs=report.blobs;report.runs.push(row);
  try{
   r.add(metadata(1,196,width,height,0,2),new Uint8Array(20000).fill(0x2e));
   for(const [i,bytes]of inputs.entries()){const id=[3,4][i];r.add({id,target:0,format:64,bind:0,width:bytes.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},bytes);row.inputs.push(await blob(report,bytes));}
   for(const [id,format]of [[6,16],[9,18]]){
    const input=new Uint8Array(format===16?new Uint16Array(8).fill(depth*65535).buffer:new Float32Array(8).fill(depth).buffer);
    r.add(metadata(id,format,4,2,0,8),input);row.depthInputs.push({id,format,input:await blob(report,input)});
   }
   const configured=await submit(r,1,join(...inputs.map((bytes,i)=>textureTransfer([3,4][i],0,bytes.length,1)),textureTransfer(6,0,4,2,0,8),textureTransfer(9,0,4,2,0,16),shader(10,0,f.vertexText),shader(11,1,f.fragmentText),packet(1,5,[12,0,0,0,31,0,0,1,31]),packet(2,5,[12]),packet(6,0,[16,0,3,16,0,4]),surface(20,1,196,0),packet(5,0,[1,0,20]),packet(4,0,[0,...[width/2,height/2,.5,width/2,height/2,.5].map(word)]),packet(31,0,[10,0]),packet(31,0,[11,1]),packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40])),'critic-original-setup');c.ok(configured.result,'original dual sparse shadow setup');
   const bind=async(swizzles,generation)=>{
    const owner=stage==='vertex'?0:1;
    const bytes=join(...[[13,6,16],[1,9,18]].map(([slot,id,format],i)=>{
     const handle=50+generation*10+i*2;return join(originalSampler(handle,2,true),imageView(handle+1,id,format,0,0,swizzles[i]),packet(10,0,[owner,slot,handle+1]),packet(18,0,[owner,slot,handle]));
    }));c.ok((await submit(r,1,bytes,'critic-original-bind-'+generation)).result,'distinct fixed/floating projective sampler ownership');
   };
   const take=async(label,swizzles,corrupted=false)=>{
    const expected=prediction(f,swizzles),execution=await submit(r,1,packet(8,0,[0,width*height,0,0,1,0,0,0,0,0,0xffffffff,0]),label);c.ok(execution.result,'complete native projective shadow draw');c.same(execution.result.gpuComplete,true,'actual hardware completion before collection');
    const native=await nativeRead(r,r.allocations.find(a=>a.metadata.id===1).storage.texture,196,width,height),completion={...r.lastCompletion},aw=new Uint32Array(native.buffer),bw=new Uint32Array(expected.buffer),differences=[];
    for(let i=0;i<aw.length;i++)if(aw[i]!==bw[i])differences.push({word:i,expected:bw[i],observed:aw[i]});
    row.frames.push({label,historyIndex:r.history.length-1,swizzles,completion,expected:await blob(report,expected),native:await blob(report,native),differences,corrupted});
    c.same(corrupted?differences.length>0:differences.length===0,true,corrupted?'completed physical sabotage refutes unchanged original expectation':'complete novel original-word plane');
   };
   const initial=[[0,5,4,3],[5,0,3,4]],rebound=[[5,4,2,0],[0,3,5,4]];
   await bind(initial,0);await take('critic-original-baseline',initial);
   await bind(rebound,1);await take('critic-original-new-view-generations',rebound);
   if(fault){r.armShadow(true);await take('critic-physical-'+fault,rebound,true);r.armShadow(false);}
   c.same(JSON.stringify({vertexText:f.vertexText,fragmentText:f.fragmentText,inputs:[...inputs[1]]}),snapshot,'original caller shader/coordinate custody');
  }finally{await finish(r,report,row);}
  if(window.__recordPackedConsumerRun){row.predictions=c.rows.splice(0);report.runs[report.runs.indexOf(row)]={name:row.name,...await window.__recordPackedConsumerRun(report.runs.indexOf(row),JSON.stringify(row))};}
 }
 report.status='passed';return report;
}
