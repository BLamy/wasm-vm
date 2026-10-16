// Fresh critic's ordered original-packet attack. The runtime is not patched.
import {rig,finish,blob,nativeRead,submit,checks,nativeStencil} from './standard-stencil-rig.mjs';
import {createVirglStandardIntegerImageShaderBridge} from '../../virgl-shader/standard.mjs';
import {runWireAcceptance} from './standard-stencil-wire.mjs';
import {specimen,source,positionsFor,setup,expected,packet,join,dsa,refs,face,raster,metadata,draw,uniformPlane,missWords,bytesPerPixel} from '../../../tools/virgl-stencil/fixtures.mjs';
import {nativeMisses} from '../../../tools/virgl-packed-depth-consumer/fixtures.mjs';
export {runWireAcceptance};

export async function runAcceptance({seed=0x29171111}={}) {
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});
 if(!gl)throw Error('critic actual WebGL2 unavailable');
 const bridge=await createVirglStandardIntegerImageShaderBridge(),ext=gl.getExtension('WEBGL_debug_renderer_info'),report={status:'running',mode:'critic-ordered',seed,gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),guestExecution:false,productionNegotiation:false,runs:[],blobs:[],predictions:c.rows};
 window.__standardStencilEvidence=report;
 for(const format of [20,126])for(const step of [1,64]) {
  const f=specimen(format,17,0,{name:`stencil-critic-${format}/ordered-step${step}`,kind:'ordered',frontCcw:false,reverse:false,source:source(format,17),depthWrite:true,front:face({zpass:5}),back:face({enabled:false,valueMask:240,writeMask:0,zpass:7}),frontRef:127,backRef:197,alphaFunc:6,alphaRef:-.375});
  const second={...f,front:face({enabled:false,func:0,fail:4,writeMask:85}),back:face({enabled:true,func:7,zpass:7,writeMask:85}),frontRef:169,backRef:169,frontCcw:true};
  const third={...f,front:face({func:1,valueMask:15,writeMask:170,fail:6,zpass:2}),back:face({enabled:false,func:0,valueMask:240,writeMask:15,zpass:7}),frontRef:245,backRef:29,scissor:true};
  const disabled={...f,front:face({enabled:false,func:0,valueMask:170,writeMask:15,fail:6}),back:face({enabled:false,func:1,valueMask:85,writeMask:240,zpass:3}),frontRef:2,backRef:197};
  const r=rig(gl,bridge,c,f,{step,delay:step===1?3:1}),row={name:f.name,kind:f.kind,format,level:0,width:f.width,height:f.height,outputLevel:0,targetWidth:f.targetWidth,targetHeight:f.targetHeight,outputLastLevel:2,vertex:f.vertex,fragment:f.fragment,frames:[],planes:[],actions:[],steps:step};
  report.runs.push(row);r.blobs=report.blobs;r.outputBackingBytes=Math.max(20000,5+f.height*(f.width*16+3));row.targetBackingBytes=r.outputBackingBytes;
  r.add(metadata(1,31,f.targetWidth,f.targetHeight,2),new Uint8Array(r.outputBackingBytes).fill(0x2e));
  const positions=positionsFor(0,false);r.add({id:3,target:0,format:64,bind:0,width:positions.length,height:1,depth:1,arraySize:1,lastLevel:0,nrSamples:0,flags:0},positions);
  const original=r.add(f.source.metadata,f.source.backing),sourceTexture=r.allocations.find(a=>a.metadata.id===6).storage.texture,colorTexture=r.allocations.find(a=>a.metadata.id===1).storage.texture;
  row.sourceGeneration=original.generation;row.sourceMetadata=f.source.metadata;row.sourceBacking=await blob(report,f.source.backing);row.positions=await blob(report,positions);row.target=metadata(1,31,f.targetWidth,f.targetHeight,2);
  for(const p of f.source.planes)row.planes.push({...p,input:await blob(report,p.input)});
  const observe=async(label,input,record,spots)=>{
   c.ok(record.result,'critic original ordered job completion');c.same(record.result.gpuComplete,true,'critic physical completion');
   const color=uniformPlane(f.width,f.height,f.words),native=await nativeRead(r,colorTexture,31,f.width,f.height,0),frame={label,historyIndex:r.history.length-1,completion:{...r.lastCompletion},native:await blob(report,native),depths:[]};row.frames.push(frame);
   c.same(missWords(native,color),[],'critic all original constant color words');
   c.ok((await submit(r,1,packet(43,0,[1,0,0,f.width*16+3,0,0,0,0,f.width,f.height,1,5,2]),label+'/public-color')).result,'critic public color');frame.publicHistoryIndex=r.history.length-1;
   const backing=c.ok(r.store.readBacking(1,0,r.outputBackingBytes),'critic complete output backing').bytes,wanted=new Uint8Array(r.outputBackingBytes).fill(0x2e);
   for(let y=0;y<f.height;y++)wanted.set(color.subarray(y*f.width*16,(y+1)*f.width*16),5+y*(f.width*16+3));
   frame.backing=await blob(report,backing);c.same([...backing],[...wanted],'critic exact complete output/padding');
   for(const p of f.source.planes){
    const raw=await nativeRead(r,sourceTexture,format,p.width,p.height,p.level),value=p.level===0?input:p.input;
    frame.depths.push({level:p.level,local:p.level,width:p.width,height:p.height,completion:{...r.lastCompletion},native:await blob(report,raw)});
    c.same(nativeMisses(format,value,raw),[],'critic all original depth/S8 mip'+p.level);
    if(p.level===0){row.spots??=[];const actual=Object.fromEntries(Object.keys(spots).map(i=>[i,raw[p.width*p.height*16+Number(i)*4]]));row.spots.push({label,expected:spots,observed:actual});c.same(actual,spots,'critic prior handwritten S8 predictions');}
   }
  };
  try {
   c.ok((await submit(r,1,setup(f),'critic-original-setup')).result,'critic original setup');
   const first=expected(f),afterSecond=expected(second,first.input),firstJob=await submit(r,1,join(dsa(30,f.front,f.back,f),refs(f.frontRef,f.backRef),draw(),dsa(31,second.front,second.back,second),refs(169,169),raster(41,second),draw()),'critic-two-ordered-original-draws');
   await observe('two-ordered',afterSecond.input,firstJob,{0:71,238:85,239:84,197:130,198:141});
   const afterThird=expected(third,afterSecond.input),lastJob=await submit(r,1,join(dsa(32,third.front,third.back,third),refs(245,29),raster(42,third),draw(),dsa(33,disabled.front,disabled.back,disabled),refs(2,197),raster(43,disabled),draw()),'critic-masked-then-disabled-original-draws');
   await observe('masked-then-disabled',afterThird.input,lastJob,{0:71,238:85,239:84,197:128,198:165});
   row.after=nativeStencil(gl);c.same(row.after.enabled,false,'critic unequal inactive stencil is disabled');
   const before=c.ok(r.store.readBacking(6,0,f.source.backing.length),'critic original CPU source').bytes;row.publicBackingBefore=await blob(report,before);c.same([...before],[...f.source.backing],'critic native writes preserve CPU source');
   const wanted=f.source.backing.slice();let cursor=wanted.length-44000;row.publicDepth=[];
   for(const p of f.source.planes){const bpp=bytesPerPixel(format),stride=p.width*bpp+7,offset=cursor;cursor+=stride*p.height+17;
    c.ok((await submit(r,1,packet(43,0,[6,p.level,0,stride,0,0,0,0,p.width,p.height,1,offset,2]),'critic-public-depth-'+p.level)).result,'critic original public depth/S8');
    const tight=(p.level===0?afterThird.input:p.input).slice();if(format===126)for(let i=0;i<tight.length;i+=8)tight.fill(0,i+5,i+8);
    for(let y=0;y<p.height;y++)wanted.set(tight.subarray(y*p.width*bpp,(y+1)*p.width*bpp),offset+y*stride);
    const backing=c.ok(r.store.readBacking(6,0,wanted.length),'critic complete source backing').bytes;row.publicDepth.push({level:p.level,stride,offset,historyIndex:r.history.length-1,backing:await blob(report,backing)});c.same([...backing],[...wanted],'critic exact source/public padding');
   }
  } finally {await finish(r,report,row);}
  if(window.__recordPackedConsumerRun){row.predictions=c.rows.splice(0);const index=report.runs.indexOf(row);report.runs[index]={name:row.name,format:row.format,kind:row.kind,...await window.__recordPackedConsumerRun(index,JSON.stringify(row))};report.predictionCount=(report.predictionCount??0)+row.predictions.length;}
 }
 report.status='passed';return report;
}
