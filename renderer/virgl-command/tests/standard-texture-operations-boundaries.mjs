import {rig,finish,blob,submit,nativeRead} from './standard-texture-operations-rig.mjs';
import {createVirglStandardTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks} from './standard-instanced-draws.mjs';
import {operationCases,setupPackets,viewPackets,operationDraw,packet,join,meta,imageView,surface,clear,word,hex,sampler,textureTransfer} from '../../../tools/virgl-command/standard-texture-operations-fixtures.mjs';
import {pixelsEqual} from './standard-texture-operations.mjs';
export async function runBoundaries({seed=0x612309af}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardTextureShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),seed,mode:'boundaries',frames:[],runs:[],blobs:[],predictions:c.rows};window.__standardTextureOperationsEvidence=report;
 let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%4;};
 const fixtures=operationCases({smoke:true});
 async function make(opcode='TXQ',stage='fragment',extra={}){
  const f=fixtures.find(f=>f.opcode===opcode&&f.stage===stage&&f.range==='restricted'&&f.queryMask==='xyw'&&f.swizzle.join('')==='2405'&&!f.deadQuery),r=rig(gl,bridge,c,f,{delay:jitter,step:1,...extra}),src=f.source;r.blobs=report.blobs;r.add(meta(3,0,64,0,f.positions.length),f.positions);r.add(meta(7,0,64,0,f.coordinates.length),f.coordinates);const sourceResource=r.add(src.metadata,src.backing);
  const row={opcode,stage,kind:'unorm',parameters:f.parameters,slot:f.slot,source:src.metadata,queryMask:f.queryMask,metadata:src.metadata,sourceGeneration:sourceResource.generation,vertex:f.vertex,fragment:f.fragment,range:[f.firstLevel,f.lastLevel],swizzle:f.swizzle,positions:await blob(report,f.positions),coordinates:await blob(report,f.coordinates),backing:await blob(report,src.backing),planes:[],actions:[],final:null};for(const p of src.planes)row.planes.push({...p,input:await blob(report,p.input)});report.runs.push(row);
  c.ok((await submit(r,1,setupPackets(f),'boundary-texture-setup')).result,'original texture boundary link before view');c.ok((await submit(r,1,viewPackets(f),'boundary-texture-views')).result,'original texture boundary retained local range');return{f,r,row,target:r.allocations[0].storage.texture};
 }
 async function frame(t,wire,label,ctx=1,expected=t.f.expectedPixels()){
  const {f,r,row,target}=t,record=await submit(r,ctx,wire,label);c.ok(record.result,'original retained texture boundary draw');c.same(record.result.gpuComplete,true,'original retained texture boundary physical fence');const pixels=nativeRead(gl,target,67,f.width,f.height,0),entry={run:report.runs.indexOf(row),label,ctx,historyIndex:r.history.length-1,dump:record.dump,pixels:await blob(report,pixels),expected:await blob(report,expected)};report.frames.push(entry);pixelsEqual(c,pixels,expected,'independent original retained texture boundary pixels');return record;
 }
 for(const stage of ['vertex','fragment'])for(const opcode of ['TXL','TXQ']){
  const t=await make(opcode,stage),{f,r,row}=t;
  try{
   await frame(t,operationDraw(),'original-retained-before-ID-reuse');
   c.ok((await submit(r,1,join(packet(29,0,[7]),setupPackets(f,{upload:false}),viewPackets(f)),'original-texture-subcontext')).result,'original texture subcontext owns fresh shader bindings');await frame(t,operationDraw(),'original-texture-subcontext-draw');c.ok((await submit(r,1,join(packet(28,0,[0]),packet(30,0,[7])),'original-texture-subcontext-restore')).result,'original texture subcontext returns to old range');await frame(t,operationDraw(),'original-texture-parent-context-draw');

   c.ok((await submit(r,2,join(setupPackets(f,{upload:false}),viewPackets(f)),'texture-second-context')).result,'independent second texture context retains the original allocation');const oldBudget=r.store.inspect().budgets.gpuBytes;c.ok(r.store.unref(6),'original texture public ID unref');const replacement={...meta(6,2,67,10,11,7),lastLevel:1},backing=new Uint8Array((77+15)*4).fill(201),fresh=r.add(replacement,backing);row.actions.push({kind:'unequal-source-ID-reuse',oldBudget,replacement,newGeneration:fresh.generation,inspection:r.store.inspect()});c.same(fresh.generation>row.sourceGeneration,true,'unequal original texture replacement owns new generation');await frame(t,operationDraw(),'original-retained-after-unequal-ID-reuse');
   const queries=r.draws.at(-1).queries;for(const q of queries)c.same(q.value,f.levels,'query accessible levels follow retained old range');
   for(const ctx of [2,1]){if(ctx===2)await frame(t,operationDraw(),'second-context-retained-original-texture',2);else{c.ok(r.renderer.resetCaches(),'reset selected texture caches');c.ok(r.renderer.restoreContext(1),'restore retained original texture context');await frame(t,operationDraw(),'restored-retained-texture-context');}}

  }finally{await finish(r,report,row);}
 }
 // Native query reflection and writes fail closed and retire every allocation.
 for(const nativeFault of ['query-type','query-size','query-location','query-budget','query-write']){
  const f=nativeFault==='query-budget'?fixtures.find(f=>f.views):fixtures.find(f=>f.opcode==='TXQ'&&f.stage==='fragment'&&f.range==='full'&&f.queryMask==='xyw'&&!f.deadQuery&&!f.views),r=rig(gl,bridge,c,f,{delay:jitter,step:1,nativeFault});r.blobs=report.blobs;r.add(meta(3,0,64,0,f.positions.length),f.positions);r.add(meta(7,0,64,0,f.coordinates.length),f.coordinates);r.add(f.source.metadata,f.source.backing);
  const row={kind:'native-query-failure',nativeFault,vertex:f.vertex,fragment:f.fragment,source:f.source.metadata,actions:[],final:null};report.runs.push(row);
  try{r.armFault();const wire=join(setupPackets(f),viewPackets(f),operationDraw()),record=await submit(r,1,wire,'original-native-query-failure-'+nativeFault);row.actions.push(record);c.same(record.result.ok,false,'native query '+nativeFault+' refuses');c.same(record.result.error.code,nativeFault==='query-write'?'backend-error':'shader-reflection-error','native query failure has bounded error');c.same(r.faultEvents.length>0,true,'actual native query path fault executed');c.same(r.draws.length,0,'native query failure executes no draw');}
  finally{await finish(r,report,row);}
 }
 // A query-only view and a sampling view keep their exact old image ownership
 // through native completion, unequal public-name reuse and cancellation.
 for(const mode of ['complete','cancel','renderer-dispose','resource-dispose'])for(const opcode of ['TXQ','TXL']){
  const t=await make(opcode),{f,r,row}=t;let point=null;
  try{
   await frame(t,operationDraw(),'original-texture-queue-before');
   const stage=f.stage==='vertex'?0:1,wire=join(operationDraw(),packet(3,6,[5]),packet(10,0,[stage,f.slot,0]),packet(5,0,[0,0]),packet(3,8,[4]));r.currentLabel='queued-texture-'+mode;
   const result=await submit(r,1,wire,r.currentLabel,async(step,job)=>{const state=r.renderer.inspect();if(state.jobs.status==='finishing'&&!point){c.ok(r.store.unref(6),'queued original texture source unref');c.ok(r.store.unref(1),'queued original texture target unref');point={before:r.store.inspect(),renderer:r.renderer.inspect(),images:r.imageAccess.inspect()};const fresh=r.add({...meta(6,2,67,10,11,7),lastLevel:1},new Uint8Array(368).fill(199));r.add(meta(1,2,67,2,9,3),new Uint8Array(108));point.after=r.store.inspect();point.freshGeneration=fresh.generation;row.actions.push({kind:'owned-final-fence-reuse',...point});c.same(point.before.budgets.imageHolds,2,'exact old texture view and output stay held at final fence');c.same(point.after.budgets.gpuBytes>point.before.budgets.gpuBytes,true,'unequal replacement remains a separate physical allocation');if(mode==='cancel')c.ok(r.renderer.cancel(job),'cancel pending original texture native completion');if(mode.endsWith('dispose')){if(mode==='resource-dispose')c.ok(r.store.dispose(),'dispose original texture source owner with pending holds');c.ok(r.renderer.dispose(),'dispose selected texture renderer with pending native completion');return{disposed:true,appliedCommands:state.jobs.appliedCommands};}}});row.actions.push(result);c.same(Boolean(point),true,'original texture job reaches a real later-task final fence');if(mode==='complete')c.ok(result.result,'retained original texture final completion');else c.same(result.result.error.code,mode==='cancel'?'cancelled':'disposed','original texture pending terminal result');
  }finally{await finish(r,report,row);}
  if(mode==='complete'||mode==='cancel'){const draw=row.draws.at(-1),retired=row.retiredPlanes.find(p=>p.texture===draw.native.attachment);c.same(Boolean(retired),true,'old original texture output captured before native deletion');c.same([gl.ALREADY_SIGNALED,gl.CONDITION_SATISFIED].includes(retired.fencePoint.delivered),true,'retired texture output observed after completed native fence');row.retiredExpected=await blob(report,f.expectedPixels());}
 }
 // Native mutation changes an original resource plane while its CPU backing
 // stays byte-identical; the next texelFetch must observe the copied GPU plane.
 {
  const t=await make('TXF'),{f,r,row}=t,plane=f.source.planes[f.firstLevel+f.lod],texture=r.allocations.find(a=>a.metadata.id===6&&a.metadata.width===17).storage.texture,clearValues=[.125,.375,.625,.875],originalBacking=f.source.backing.slice();
  try{
   await frame(t,operationDraw(),'original-fetch-before-GPU-plane-change');c.ok((await submit(r,1,join(surface(20,6,67,plane.level),packet(5,0,[1,0,20]),clear(clearValues)),'original-GPU-only-selected-plane-clear')).result,'GPU-only original source mip change');const values=clearValues.map(n=>Math.round(n*255)),color=f.swizzle.map(k=>k===4?0:k===5?255:values[k]),expected=Uint8Array.from({length:256},(_,i)=>color[i%4]);await frame(t,join(packet(5,0,[1,0,4]),operationDraw()),'original-fetch-after-GPU-only-change',1,expected);report.frames.at(-1).sourceClear={level:plane.level,values:clearValues};c.same([...f.source.backing],[...originalBacking],'GPU-only source change keeps original CPU backing intact');row.actions.push({kind:'gpu-only-plane',level:plane.level,values:clearValues,native:await blob(report,nativeRead(gl,texture,67,plane.width,plane.height,plane.level))});
   const rejected=await submit(r,1,join(packet(5,0,[1,0,20]),operationDraw()),'original-query-same-image-feedback');row.actions.push(rejected);c.same(rejected.result.ok,false,'original sampling range overlapping its output refuses');c.same(rejected.result.error.code,'framebuffer-feedback','original texture feedback boundary explicit');
  }finally{await finish(r,report,row);}
 }
 // Exercise original integer and packed vertex selectors together with raw
 // dimensional/slot-zero banks and a native retained-view query in one program.
 {
  const {specimen,setup,draw}=await import('../../../tools/virgl-command/standard-uniform-binding-fixtures.mjs');
  for(const constant of [false,true])for(const zeroInlineMask of [0,3])for(const shift of [0,8,16,24]){
   const alignment=gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT),s=specimen({slots:[0,12],count:4,vector:3,zeroInlineMask,formats:true,constant,shift,alignment,indexed:true,seed}),lines=s.fragment.replace(/^\d+: /gm,'').trim().split('\n'),first=lines.findIndex(l=>/^(MOV|ARL|UADD|USHR|AND|U2F|MUL|END)\b/.test(l)),decl=lines.slice(0,first).map(l=>l==='DCL TEMP[0]'?'DCL TEMP[0..1]':l),ops=lines.slice(first);
   decl.push('DCL SAMP[3]','DCL SVIEW[3], 2D, FLOAT');const before=ops.findIndex(l=>l.startsWith('USHR TEMP[0]'));ops.splice(before,0,'MOV TEMP[1], IMM[0]','TXQ TEMP[1].w, IMM[0], SAMP[3], 2D','UADD TEMP[0], TEMP[0], TEMP[1].wwww');
   // An explicit zero original coordinate keeps query LOD independent of shift.
   const imm=decl.filter(l=>/^IMM\[/.test(l)).length;decl.push(`IMM[${imm}] INT32 {0,0,0,0}`);ops[before+1]=`TXQ TEMP[1].w, IMM[${imm}], SAMP[3], 2D`;s.fragment=decl.join('\n')+'\n'+ops.map((l,i)=>i+': '+l+'\n').join('');
   const r=rig(gl,bridge,c,s,{delay:jitter,step:1}),target=r.allocations[0].storage.texture;r.blobs=report.blobs;const f=fixtures.find(f=>f.opcode==='TXQ'&&f.range==='full'&&f.queryMask==='xyw'&&!f.deadQuery),src=f.source;r.add({...src.metadata,id:77},src.backing);
   const row={kind:'query-uniform-vertex-composition',constant,zeroInlineMask,shift,seed,source:{...src.metadata,id:77},vertex:s.vertex,fragment:s.fragment,banks:s.banks.map(b=>({...b,words:[...b.words],data:null})),data:[],planes:[],actions:[],final:null};for(const[id,data]of s.data)row.data.push({id,bytes:await blob(report,data)});for(const p of src.planes)row.planes.push({...p,input:await blob(report,p.input)});report.runs.push(row);
   try{
    const uploads=src.planes.map(p=>textureTransfer(77,p.level,p.width,p.height,p.offset,p.stride)),wire=join(...uploads,setup(r,s),imageView(81,77,67,0,3),sampler(82,f.parameters),packet(10,0,[1,3,81]),packet(18,0,[1,3,82]),draw(s)),record=await submit(r,1,wire,'texture-query-bank-composition');c.ok(record.result,'original texture query with raw banks and typed/packed selectors');c.same(record.result.gpuComplete,true,'original texture query composition completes native fence');
    const contributions=Array(4).fill(0);for(const bank of s.banks)for(let k=0;k<4;k++)contributions[k]=(contributions[k]+2*bank.words[3*4+k])>>>0;
    const packed=[1,-1,255,1].map(word),normalized=[-1,Math.fround(-256/511),1,-1].map(word);for(let k=0;k<4;k++)contributions[k]=(contributions[k]+[-1,2,3,4][k]+[0xffffffff,7,9,11][k]+packed[k]+normalized[k]+4)>>>0;
    const color=contributions.map(n=>(n>>>shift)&255),expected=Uint8Array.from({length:s.width*s.height*4},(_,i)=>color[i%4]),pixels=nativeRead(gl,target,67,s.width,s.height,0);pixelsEqual(c,pixels,expected,'independent original raw-word/query composition pixels',0);report.frames.push({run:report.runs.indexOf(row),label:'texture-query-bank-composition',historyIndex:r.history.length-1,dump:record.dump,pixels:await blob(report,pixels),expected:await blob(report,expected)});row.actions.push({kind:'completed-composition',selectors:r.requests.at(-1)?.request,nativeQueries:r.draws.at(-1).queries});
    row.rawBufferReads=[];for(const [id,input]of s.data){const lease=c.ok(r.store.retainStorage(1,id,'readback'),'original raw buffer direct read lease').lease;try{const raw=c.ok(r.store.readStorage(lease),'selected buffer readback preserves raw bytes').bytes;c.same([...raw],[...input],'complete selected raw buffer bytes');row.rawBufferReads.push({id,bytes:await blob(report,raw)});}finally{c.ok(r.store.releaseStorage(lease),'selected buffer read lease release');}}
   }finally{await finish(r,report,row);}
  }
 }
 report.status='passed';return report;
}
