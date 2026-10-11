// Fresh critic assertion: sparse original COLOR0 broadcast, mixed native types,
// HDR constant folding and indexed masks survive an A/B/A shape change.
import {rig,finish,blob,submit,nativeRead,physicalFence,checks} from './standard-multiple-color-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {positions,metadata,setup,state,draw,clear,framebuffer,packet,join,surface,read} from '../../../tools/virgl-multiple-color/fixtures.mjs';
const word=n=>new Uint32Array(new Float32Array([n]).buffer)[0];
const initial=[.125,.25,.5,.75].map(word),original=[.5,1.5,-2,1].map(word);
const fragment='FRAG\nDCL OUT[19], COLOR\nPROPERTY FS_COLOR0_WRITES_ALL_CBUFS 1\nIMM[0] UINT32 {'+original.join(',')+'}\n0: MOV OUT[19], IMM[0]\n1: END\n';
export async function runNovel({fault=null,seed=0x5a17f00d}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardIntegerImageShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const report={status:'running',guestExecution:false,productionNegotiation:false,mode:'critic',seed,gpu:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),runs:[],frames:[],blobs:[],predictions:c.rows};window.__standardMultipleColorEvidence=report;
 const f={name:'critic-sparse-broadcast-HDR-mixed-ABA',formats:[null,31,200,196],width:4,height:4,targetWidth:4,targetHeight:4,outputLevel:0,outputLastLevel:0,
  vertex:'VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n0: MOV OUT[0], IN[0]\n1: END\n',fragment,clearWords:initial,mask:5,blendEnabled:true,source:7,destination:8,alphaSource:1,alphaDestination:1,scissored:true};
 const r=rig(gl,bridge,c,f,{delay:seed%4,step:1}),row={...f,frames:[]},targets=[];r.blobs=report.blobs;report.runs.push(row);row.positions=await blob(report,positions);
 const planes=Array(4).fill(null);for(const slot of [1,2,3]){r.add(metadata([1,2,4,5][slot],f.formats[slot],4,4,0,10),new Uint8Array(20000).fill(0x2e));targets[slot]=r.allocations.at(-1);targets[slot].slot=slot;planes[slot]=new Uint32Array(64);}
 r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
 let slots=[1,3];
 // Predictions update before native inspection and derive solely from original
 // raw immediates and original RT0/scissor fields encoded by this test.
 const predictClear=(selected,words)=>{for(const slot of slots)if(selected&(4<<slot))for(let at=0;at<64;at++)planes[slot][at]=words[at%4];};
 const predictDraw=()=>{for(const slot of slots)for(let y=1;y<3;y++)for(let x=1;x<3;x++)for(const lane of [0,2]){
  const at=(y*4+x)*4+lane;planes[slot][at]=slot===1?word([.5,1.5,-2,1][lane]*[.25,.5,.75,.25][lane]+new Float32Array(new Uint32Array([planes[slot][at]]).buffer)[0]*.25):original[lane];
 }};
 async function capture(record,kind){
  c.ok(record.result,'critic original transaction');c.same(record.result.gpuComplete,true,'critic actual owned completion');
  const frame={run:0,label:record.label,kind,historyIndex:r.history.indexOf(record),completion:{...r.lastCompletion},targets:[]};report.frames.push(frame);row.frames.push(report.frames.length-1);
  for(const slot of slots){const target=targets[slot];
   if(fault==='completed-output'&&record.label==='critic/A-return'&&slot===3){
    const before=nativeRead(r,target.storage.texture,target.metadata.format,4,4),words=new Uint32Array(before.buffer).slice();words[0]^=1;
    frame.beforeSabotage=await blob(report,before);frame.originalCompletion={...r.lastCompletion};r.traced.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);r.traced.bindTexture(gl.TEXTURE_2D,target.storage.texture);
    r.traced.pixelStorei(gl.UNPACK_ALIGNMENT,1);r.traced.pixelStorei(gl.UNPACK_ROW_LENGTH,0);r.traced.texSubImage2D(gl.TEXTURE_2D,0,0,0,4,4,gl.RGBA_INTEGER,gl.UNSIGNED_INT,words);
    frame.sabotageCompletion=await physicalFence(r,'critic/completed-COLOR3-corruption');c.same(frame.originalCompletion.sync===frame.sabotageCompletion.sync,false,'critic corruption has a distinct real completed fence');
   }
   const native=nativeRead(r,target.storage.texture,target.metadata.format,4,4),words=[...new Uint32Array(native.buffer,native.byteOffset,native.byteLength/4)],wanted=[...planes[slot]],capture={slot,metadata:target.metadata,generation:target.generation,texture:r.trace.id(target.storage.texture),level:0,native:await blob(report,native),planes:[]};frame.targets.push(capture);
   if(words.some((n,i)=>n!==wanted[i])&&fault)report.sabotage={fault,slot,held:false,completion:{...r.lastCompletion}};
   c.same(words,wanted,'critic complete original physical COLOR'+slot+' words');
   capture.planes.push({level:0,width:4,height:4,native:await blob(report,native)});
   const transfer=await submit(r,1,read(f,slot),record.label+'/public-slot'+slot);c.ok(transfer.result,'critic original public target transfer');capture.publicHistory=r.history.indexOf(transfer);
   const backing=c.ok(r.store.readBacking(target.metadata.id,0,20000),'critic original public backing').bytes;capture.backing=await blob(report,backing);
   const expected=new Uint8Array(20000).fill(0x2e),v=new DataView(expected.buffer);for(let y=0;y<4;y++)for(let x=0;x<4;x++)for(let lane=0;lane<4;lane++)v.setUint32(5+y*67+x*16+lane*4,wanted[(y*4+x)*4+lane],true);
   c.same([...backing],[...expected],'critic every original backing byte and padding');
  }
 }
 try{
  const a={...f,formats:[null,31,null,196]};predictClear(40,initial);await capture(await submit(r,1,setup(a),'critic/A-setup'),'clear');
  c.ok((await submit(r,1,state(f),'critic/RT0-scissored-mask5')).result,'critic original replicated blend state');
  predictDraw();await capture(await submit(r,1,draw(),'critic/A-first'),'draw');const firstLinks=r.renderer.inspect().work.programLinks;
  predictClear(32,[7,11,13,17]);await capture(await submit(r,1,clear(32,[7,11,13,17]),'critic/COLOR3-full-selective-clear'),'clear');
  predictDraw();await capture(await submit(r,1,draw(),'critic/A-warm'),'draw');c.same(r.renderer.inspect().work.programLinks,firstLinks,'critic A reuses typed sparse broadcast native program');
  slots=[1,2,3];predictClear(16,initial);await capture(await submit(r,1,join(surface(22,4,200,0),framebuffer(f),clear(16,initial)),'critic/B-add-SINT-COLOR2'),'clear');
  predictDraw();await capture(await submit(r,1,draw(),'critic/B-draw'),'draw');const bLinks=r.renderer.inspect().work.programLinks;c.same(bLinks>firstLinks,true,'critic nonzero signed target selects new native variant');
  slots=[1,3];c.ok((await submit(r,1,framebuffer(a),'critic/A-rebind')).result,'critic sparse A rebound');predictDraw();await capture(await submit(r,1,draw(),'critic/A-return'),'draw');
  c.same(r.renderer.inspect().work.programLinks,bLinks,'critic A/B/A returns to original typed native variant');
  c.same(r.draws.at(-1).native.colors[2].attachment,null,'critic retired sparse COLOR2 attachment detaches');
 }finally{await finish(r,report,row);}
 report.status='passed';return report;
}
