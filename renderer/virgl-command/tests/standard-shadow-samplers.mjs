import {rig,finish,blob,nativeRead,submit,checks} from './standard-shadow-samplers-rig.mjs';
import {createVirglStandardShadowTextureShaderBridge as create} from '../../virgl-shader/standard.mjs';
import {shader,word,surface,imageView,textureTransfer} from '../../../tools/virgl-shadow-samplers/fixtures.mjs';
import {cases,fixture,setup,view,draw,expected,metadata,packet,join} from '../../../tools/virgl-shadow-samplers/fixtures.mjs';
export async function runAcceptance({smoke=false,mode='matrix',fault=null,seed=0x493a170d}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await create(),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),mode,seed,fault,guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};window.__standardShadowSamplerEvidence=report;
 let selected=cases({smoke,mode,seed});if(fault)selected=selected.filter(f=>f.stage==='fragment'&&f.opcode==='TEX'&&f.compareFunction===7&&f.slot===0&&f.swizzle.join('')==='0123'&&f.filter==='nearest').slice(0,1);
 if(mode==='refusals')selected=['missing','mode','color','integer','ordinary-mode','feedback','linear-ordinary','binding'].map(refusal=>({...selected[0],refusal,name:'refusal/'+refusal}));
 if(mode==='reflection')selected=['location','index','undefined-index','type','size','default','shape','budget','omitted','pruned'].map(reflection=>({...selected[0],reflection,name:'reflection/'+reflection}));
 if(mode==='boundaries')selected=['rebind','destroy-reuse','cancel','owner-first','renderer-first','shader-reuse','context-destroy'].map(boundary=>({...selected[0],boundary,name:'boundary/'+boundary}));
 for(const spec of selected){const f=fixture(spec),r=rig(gl,spec.reflection==='omitted'?{...bridge,translateImages(request){const x=JSON.parse(JSON.stringify(bridge.translateImages(request)));if(x.ok)x.metadata.shadowUniforms=[];return x;},translatePairImages(request){const x=JSON.parse(JSON.stringify(bridge.translatePairImages(request)));if(x.ok){x.vertex.metadata.shadowUniforms=[];x.fragment.metadata.shadowUniforms=[];}return x;}}:bridge,c,f,{delay:f.delay,step:f.step,fault,reflection:spec.reflection,failure:spec.refusal==='binding'?'binding':null}),row={name:f.name,refusal:spec.refusal,reflection:spec.reflection,boundary:spec.boundary,kind:'shadow-sample',format:f.format,width:f.width,height:f.height,vertexText:f.vertexText,fragmentText:f.fragmentText,stage:f.stage,slot:f.slot,opcode:f.opcode,swizzle:f.swizzle,frames:[],inputs:[],planes:[]};report.runs.push(row);r.blobs=report.blobs;
  try{
   r.add(f.target,new Uint8Array(20000).fill(0x2e));for(const [i,bytes]of f.inputs.entries()){r.add({id:[3,4,5,7][i],target:0,format:64,bind:0,width:bytes.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},bytes);row.inputs.push(await blob(report,bytes));}
   r.add(f.source.metadata,f.source.backing);row.source={metadata:f.source.metadata,backing:await blob(report,f.source.backing)};for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
   if(spec.reflection==='pruned')f.fragmentText=f.fragmentText.replace('MOV OUT[0], TEMP[0]','MOV OUT[0], IMM[0]');
   if(mode==='same-image'){
    f.sameImage=true;f.fragmentText=f.fragmentText.replace('DCL TEMP[0..1]','DCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nDCL TEMP[0..1]').replace('IMM[1] INT32 {0,0,0,0}','IMM[1] INT32 {0,0,0,0}\nIMM[2] FLT32 {0.5,0.5,0,1}').replace(/(\d+): END\n/,(_,n)=>n+': TXP TEMP[1], IMM[2], SAMP[0], 2D\n'+(+n+1)+': MOV OUT[0].y, TEMP[1].xxxx\n'+(+n+2)+': MOV OUT[0].z, IMM[2].zzzz\n'+(+n+3)+': MOV OUT[0].w, IMM[2].wwww\n'+(+n+4)+': END\n');
   }
   if(f.crossStage){
    f.vertexText=f.vertexText.replace('DCL IN[3]','DCL IN[3]\nDCL TEMP[0]\nDCL SAMP[7]\nDCL SVIEW[7], 2D, FLOAT').replace('DCL OUT[3], GENERIC[2]','DCL OUT[3], GENERIC[2]\nDCL OUT[4], GENERIC[3]').replace('4: END\n','4: TEX OUT[4], IN[1], SAMP[7], SHADOW2D\n5: END\n');
    f.fragmentText=f.fragmentText.replace('DCL OUT[0], COLOR','DCL IN[4], GENERIC[3], CONSTANT\nDCL OUT[0], COLOR').replace(/(\d+): END\n/,(_,n)=>n+': XOR OUT[0], TEMP[0], IN[4]\n'+(+n+1)+': END\n');
   }
   if(f.typed)f.fragmentText=f.fragmentText.replace('2D, FLOAT','2D, '+(f.format===196?'UINT':'SINT')).replace(/SHADOW2D/g,'2D');
   if(spec.refusal==='ordinary-mode'||spec.refusal==='linear-ordinary')f.fragmentText=f.fragmentText.replace(/SHADOW2D/g,'2D');
   row.vertexText=f.vertexText;row.fragmentText=f.fragmentText;row.beforeSetup=r.renderer.inspect();
   const configured=await submit(r,1,setup(f),'shadow-setup');row.setup=configured;
   if(spec.reflection&&spec.reflection!=='pruned'){
    const result=configured.result.ok?(await submit(r,1,view(f),'shadow-reflection-view')).result:configured.result;
    const failed=result.ok?(await submit(r,1,draw(f),'shadow-reflection-draw')).result:result;
    c.same(failed.ok,false,'invalid native reflection refuses');c.same(failed.error.code,'shader-reflection-error','reflection failure reported');row.refused=failed;c.same(r.shadowControls.length>0||spec.reflection==='omitted',true,'actual reflection control executed');continue;
   }
   c.ok(configured.result,'original shadow renderer setup');
   if(!spec.refusal)c.ok(r.renderer.restoreContext(1),'native link before retained view binding');
   let binding=view(f);
   if(spec.refusal==='missing')binding=join(packet(18,0,[1,f.slot,0]));
   if(spec.refusal==='mode')binding=view(f,{mode:0});
   if(f.typed)binding=view(f,{mode:0});
   if(spec.refusal==='color'||spec.refusal==='integer'){
    const format=spec.refusal==='color'?67:196;r.add(metadata(9,format,4,2,2,8),new Uint8Array(2000));binding=view(f,{resource:9,format});
   }
   if(spec.refusal==='linear-ordinary')binding=view({...f,filter:'linear'},{mode:0});
   row.binding=await submit(r,1,binding,'shadow-view-state');
   if(mode==='same-image')c.ok((await submit(r,1,view({...f,slot:0,swizzle:[0,0,4,5]},{viewHandle:53,stateHandle:52,mode:0}),'ordinary-same-depth')).result,'same depth with distinct native ordinary sampler');
   if(f.crossStage)c.ok((await submit(r,1,view({...f,stage:'vertex',compareFunction:1,swizzle:[5,0,4,1]},{viewHandle:53,stateHandle:52}),'same-slot-different-stage')).result,'same original slot owns distinct vertex and fragment state');
   if(spec.refusal){
    if(spec.refusal==='feedback'){r.add(metadata(9,196,4,2,0,2),new Uint8Array(2000));c.ok((await submit(r,1,join(surface(22,9,196,0),surface(21,6,18,0),packet(5,0,[1,21,22])),'shadow-feedback')).result,'original depth framebuffer attachment');}
    const before=r.events.filter(e=>['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(e.name)).length;
    if(spec.refusal==='binding')r.armShadow(true);
    const refused=row.binding.result.ok?await submit(r,1,draw(f),'shadow-refused-draw'):row.binding;r.armShadow(false);row.refused=refused;
    c.same(refused.result.ok,false,'invalid original comparison state refuses');c.same(r.events.filter(e=>['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'].includes(e.name)).length,before,'refusal precedes every native draw');c.same(gl.getError(),gl.NO_ERROR,'native failure drained');
    if(spec.refusal==='binding'){const recovered=await submit(r,1,draw(f),'shadow-binding-recovery');c.ok(recovered.result,'native binding recovery');row.recovered=recovered;}
    continue;
   }
   c.ok(row.binding.result,'original shadow sampler binding');
   const wanted=spec.reflection==='pruned'?new Uint8Array(new Uint32Array(Array.from({length:f.width*f.height},()=>[0x12345678,0x80000001,0xdeadbeef,0xffffffff]).flat()).buffer):expected(f);row.expected=await blob(report,wanted);
   const take=async label=>{const execution=await submit(r,1,draw(f),label);c.ok(execution.result,'native shadow draw completed');c.same(execution.result.gpuComplete,true,'actual GPU shadow completion');
    const texture=r.allocations.find(a=>a.metadata.id===1).storage.texture,native=await nativeRead(r,texture,196,f.width,f.height),frame={label,historyIndex:r.history.length-1,completion:{...r.lastCompletion},native:await blob(report,native)};row.frames.push(frame);
    const a=new Uint32Array(native.buffer),b=new Uint32Array(wanted.buffer),miss=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])miss.push({word:i,expected:b[i],observed:a[i]});
    if(miss.length)report.sabotage={fault,miss,completion:frame.completion};c.same(miss,[],'complete original shadow result word plane');return frame;};
   await take('shadow-baseline');
   if(fault){r.armShadow(true);await take('shadow-corruption');}
   if(spec.boundary){
    row.beforeBoundary={renderer:r.renderer.inspect(),resources:r.store.inspect()};
    if(spec.boundary==='rebind'){c.ok((await submit(r,1,view(f,{viewHandle:53,stateHandle:52}),'shadow-new-view-sampler')).result,'new retained comparison objects');await take('shadow-rebound');}
    if(spec.boundary==='destroy-reuse'){c.ok((await submit(r,1,join(packet(3,6,[51]),packet(3,7,[50])),'shadow-destroy-bound-objects')).result,'names destroyed while bindings retained');row.destroyedState=await submit(r,1,draw(f),'shadow-destroyed-sampler-refusal');c.same(row.destroyedState.result.error.code,'incomplete-draw','original sampler destruction unbinds/compacts');c.ok((await submit(r,1,view(f),'shadow-object-name-reuse')).result,'same names get new generations');await take('shadow-new-generations');}
    if(spec.boundary==='shader-reuse'){c.ok((await submit(r,1,join(packet(3,4,[11]),shader(11,1,f.fragmentText),packet(31,0,[11,1])),'shadow-shader-name-reuse')).result,'shader name generations');await take('shadow-relinked');}
    if(spec.boundary==='cancel'){let cancelled=false;row.cancelled=await submit(r,1,draw(f),'shadow-cancel',(step,job)=>{if(!cancelled&&step.status==='waiting-gpu'){cancelled=true;c.ok(r.renderer.cancel(job),'cancel native shadow job');}});c.same(cancelled,true,'cancel reached waiting physical job');c.same(row.cancelled.result.ok,false,'cancelled shadow job refuses');await take('shadow-cancel-recovery');}
    if(spec.boundary==='owner-first')c.ok(r.store.dispose(),'owner first drains retained comparison state');
    if(spec.boundary==='renderer-first')c.ok(r.renderer.dispose(),'renderer first releases retained native state');
    if(spec.boundary==='context-destroy')c.ok(r.renderer.destroyContext(1),'comparison context destroys native bindings');
    row.afterBoundary={renderer:r.renderer.inspect(),resources:r.store.inspect()};
   }
  }finally{await finish(r,report,row);}
  if(window.__recordPackedConsumerRun){row.predictions=c.rows.splice(0);const index=report.runs.indexOf(row);report.runs[index]={name:row.name,...await window.__recordPackedConsumerRun(index,JSON.stringify(row))};}
 }
 report.status='passed';return report;
}
