import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-integer-image-consumer-rig.mjs';
import {describe} from './standard-integer-image-consumer.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {consumerCases,setup,views,draw,surface,packet,join,metadata} from '../../../tools/virgl-integer-image-consumer/fixtures.mjs';
export async function runCritic({seed=0x4572c975,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:'critic',seed,guestExecution:false,productionNegotiation:false,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],frames:[],blobs:[],predictions:c.rows};window.__standardIntegerImageConsumerEvidence=report;
 const original=consumerCases().find(f=>f.source.metadata.format===196&&f.stage==='fragment'&&f.opcode==='TXQ'&&f.firstLevel===0&&f.name.includes('/base/'));c.same(Boolean(original),true,'critic consumes original frozen UINT TXQ input');const f={...original,fragment:original.fragment.replaceAll('OUT[0]','OUT[5]')};
 let random=seed>>>0;const jitter=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%5;};
 const r=rig(gl,bridge,c,f,{delay:jitter,step:1}),row={...describe(f),kind:'same-sign-target-material-and-RGB-alpha',actions:[],observations:[]};report.runs.push(row);r.blobs=report.blobs;row.target=r.allocations[0].metadata;row.positions=await blob(report,f.positions);row.backing=await blob(report,f.source.backing);
 for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
 r.add({id:3,target:0,format:64,bind:0,width:f.positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},f.positions);r.add(f.source.metadata,f.source.backing);
 // The expected native query words come from original declarations/immediates
 // and retained NPOT range sizes; no fixture expected-pixel helper is imported.
 const lod=Number(/^IMM\[0\] INT32 \{([^,}]+)/m.exec(f.fragment)[1]),initial=/^IMM\[1\] UINT32 \{([^}]+)\}/m.exec(f.fragment)[1].split(',').map(Number),query=[Math.max(1,f.source.metadata.width>>(f.firstLevel+lod)),Math.max(1,f.source.metadata.height>>(f.firstLevel+lod)),initial[2],f.lastLevel-f.firstLevel+1];
 c.same(query,[8,4,33,5],'critic predicts original query words before any native draw');
 function expected(format){const components=(format-177)%4+1,words=new Uint32Array(f.width*f.height*4);for(let p=0;p<f.width*f.height;p++)for(let lane=0;lane<4;lane++)words[p*4+lane]=lane<components?query[lane]:lane===3?1:0;return new Uint8Array(words.buffer);}
 const targets=new Map([[196,{id:1,handle:4,texture:r.allocations[0].storage.texture}]]),programs=new Map();let originalLinks;
 async function frame(format,label){
  const target=targets.get(format),record=await submit(r,1,draw(),label);c.ok(record.result,'critic original native target draw');c.same(record.result.gpuComplete,true,'critic output follows real native job completion');
  const d=r.draws.at(-1),frame={run:0,kind:'draw',boundary:true,label:record.label,historyIndex:r.history.length-1,dump:record.dump,completion:{...r.lastCompletion},outputFormat:format,outputResource:target.id,bindings:[],outputs:[],mask:15,previous:null};
  c.same(d.native.componentType,format===200?gl.INT:gl.UNSIGNED_INT,'critic actual COLOR0 component type');c.same(d.native.mask,[true,true,true,(format-177)%4===3],'critic native target channels and RGB implicit-alpha mask');c.same(d.native.blend,false,'critic native integer target ignores blending');
  const key=r.history.at(-1).dump.programs.at(-1)?.key??r.history.at(-1).dump.draws.at(-1)?.programKey;row.observations.push({label,format,nativeProgram:d.native.program,nativeAttachment:d.native.attachment,materialKey:key,links:r.renderer.inspect().work.programLinks});
  const rawBefore=nativeRead(r,target.texture,format,f.width,f.height,0),want=expected(format);
  if(fault==='completed-output'&&format===179){
   frame.beforeSabotage=await blob(report,rawBefore);frame.originalCompletion={...r.lastCompletion};
   const input=new Uint8Array(rawBefore.byteLength/4);for(let i=0;i<input.length;i++)input[i]=new Uint32Array(rawBefore.buffer)[i];input[0]^=1;
   const old=gl.getParameter(gl.TEXTURE_BINDING_2D),unpack=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);try{r.setLabel('critic-postcompletion-corruption');r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);r.traced.bindTexture(gl.TEXTURE_2D,target.texture);r.traced.pixelStorei(gl.UNPACK_ALIGNMENT,1);r.traced.pixelStorei(gl.UNPACK_ROW_LENGTH,0);r.traced.texSubImage2D(gl.TEXTURE_2D,0,0,0,f.width,f.height,gl.RGBA_INTEGER,gl.UNSIGNED_BYTE,input);}finally{r.traced.bindTexture(gl.TEXTURE_2D,old);r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpack);}
   frame.sabotageCompletion=await physicalFence(r,'critic-physical-sabotage-fence');frame.completion={...r.lastCompletion};c.same(frame.sabotageCompletion.sync!==frame.originalCompletion.sync,true,'critic sabotage has another actual native sync');
  }
  const raw=nativeRead(r,target.texture,format,f.width,f.height,0);frame.native=await blob(report,raw);frame.expected=await blob(report,want);report.frames.push(frame);row.frames.push(report.frames.length-1);
  if(fault==='completed-output'&&format===179)report.sabotage={fault,fenceCompleted:true,completion:{...r.lastCompletion},held:false,frame:report.frames.length-1};
  c.same([...new Uint32Array(raw.buffer)],[...new Uint32Array(want.buffer)],'critic full original TXQ integer output after native completion');
  const stride=f.width*((format-177)%4+1)*(format<=184?1:format<=192?2:4)+3,read=await submit(r,1,packet(43,0,[target.id,0,0,stride,0,0,0,0,f.width,f.height,1,5,2]),label+'/public-read');c.ok(read.result,'critic original typed public read');frame.publicHistory=r.history.length-1;frame.outputBacking=await blob(report,c.ok(r.store.readBacking(target.id,0,20000),'critic full retained public backing').bytes);
  if(programs.has(format))c.same(d.native.program,programs.get(format),'critic return to same retained format reuses exact native program');else{for(const program of programs.values())c.same(d.native.program===program,false,'critic distinct same-sign formats own distinct material');programs.set(format,d.native.program);}
  return r.renderer.inspect().work.programLinks;
 }
 try{
  c.ok((await submit(r,1,setup(f),'critic-query-setup')).result,'critic original setup');c.ok((await submit(r,1,views(f),'critic-query-original-view')).result,'critic original UINT range');originalLinks=await frame(196,'critic-query-RGBA32UI');
  for(const [i,format]of [179,193,200].entries()){const id=7+i,handle=20+i;r.add(metadata(id,format,f.width,f.height,0,2),new Uint8Array(20000).fill(0x2e));targets.set(format,{id,handle,texture:r.allocations.find(a=>a.metadata.id===id).storage.texture});const before=r.renderer.inspect().work.programLinks;c.ok((await submit(r,1,join(surface(handle,id,format,0),packet(5,0,[1,0,handle])),'critic-target-'+format)).result,'critic actual same-source target format switch');await frame(format,'critic-query-target-'+format);c.same(r.renderer.inspect().work.programLinks>before,true,'critic exact retained target format enters program and pair identities');}
  const links=r.renderer.inspect().work.programLinks;for(const format of [179,193,196,200]){const target=targets.get(format);c.ok((await submit(r,1,packet(5,0,[1,0,target.handle]),'critic-return-target-'+format)).result,'critic restore retained target');await frame(format,'critic-query-return-'+format);c.same(r.renderer.inspect().work.programLinks,links,'critic returning typed format performs no additional program link');}
  c.same(programs.size,4,'critic exact native material identities cover three unsigned formats and opposite sign');c.same(gl.getError(),gl.NO_ERROR,'critic native novel consumer has no errors');
 }finally{await finish(r,report,row);}
 report.status='passed';return report;
}
