import {rig,finish,blob,submit} from './standard-image-rig.mjs';
import {createVirglStandardUniformShaderBridge} from '../../virgl-shader/standard.mjs';
import {checks,dispose} from './standard-instanced-draws.mjs';
import {nativeRead} from './standard-texture-storage.mjs';
import {packet,join,meta,sampler,bind,draw,specimen,shapes,source,statePackets,imageView,originalPixels,hex,nativeFromGuest} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
export async function runAcceptance({smoke=false}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),bridge=await createVirglStandardUniformShaderBridge(),debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),report={status:'running',guestExecution:false,productionNegotiation:false,gpu,frames:[],runs:[],blobs:[],predictions:c.rows};window.__standardImageEvidence=report;
 let index=0;
 for(const format of [2,67,233])for(const [w,h]of (smoke?shapes.slice(0,1):shapes))for(const truncation of (smoke?[0]:[0,1])){
  const s=specimen({stage:'both',scale:0,offset:[.25,.25],vsCoord:[.25,.25]}),src=source(w,h,format,0x92341af5+index,Math.max(0,Math.floor(Math.log2(Math.max(w,h)))-truncation)),r=rig(gl,bridge,c,s,{delay:2,step:index%2?1:64}),initial=r.allocations[0];r.blobs=report.blobs;r.add(meta(3,0,64,0,s.positions.length),s.positions);r.add(src.metadata,src.backing);
  const setup=await submit(r,1,statePackets(s,src),'original-image-setup');c.ok(setup.result,'mip source setup and final fence');const run={originalSeed:0x92341af5+index,metadata:src.metadata,backing:await blob(report,src.backing),planes:[],frames:[],final:null};for(const p of src.planes)run.planes.push({...p,input:await blob(report,p.input)});report.runs.push(run);let bound=false;
  for(let first=0;first<=src.metadata.lastLevel;first++)for(let last=first;last<=src.metadata.lastLevel;last++){
   const vs=[(first+1)%(src.metadata.lastLevel+1),src.metadata.lastLevel],fs=[first,last],cases=[];
   for(const mip of [0,1])for(let local=0;local<=last-first;local++){cases.push({mip,lambda:local});if(mip===1&&local<last-first)cases.push({mip,lambda:local+.375});}
   cases.push({mip:2,lambda:2});if(smoke)cases.splice(1);
   for(const entry of cases){
    const min=(index>>>1)&1,mag=index&1,p={s:2,t:2,r:2,min,mip:entry.mip,mag,minLod:entry.lambda,maxLod:entry.lambda},vertexSwizzle=index%3===0?[2,1,0,3]:[0,1,2,3],fragmentSwizzle=index%5===0?[0,4,2,5]:[0,1,2,3];
    const wire=join(...(bound?[packet(3,6,[5]),packet(3,6,[6]),packet(3,7,[8])]:[]),imageView(5,6,format,...vs,vertexSwizzle),imageView(6,6,format,...fs,fragmentSwizzle),sampler(8,p),bind(0,5,8),bind(1,6,8),draw());bound=true;
    const label='mip-range-'+index;r.currentLabel=label;const record=await submit(r,1,wire,label);c.ok(record.result,'original mip-range draw');c.same(record.result.gpuComplete,true,'actual range completion fence');
    const pixels=nativeRead(gl,initial.storage.texture,67,s.width,s.height,0),expected=originalPixels(src,vs,fs,p,vertexSwizzle,fragmentSwizzle),miss=[];for(let i=0;i<pixels.length;i++)if(Math.abs(pixels[i]-expected.pixels[i])>1)miss.push({at:i,actual:pixels[i],expected:expected.pixels[i]});report.diagnostic={format,w,h,vs,fs,p,pixels:hex(pixels),expected:hex(expected.pixels),draw:r.draws.at(-1),dump:record.dump,allocations:r.allocations.map(a=>({metadata:a.metadata,id:r.trace.id(a.storage.texture??a.storage.buffer)})),resource:r.store.inspect(),renderer:r.renderer.inspect()};c.same(miss.slice(0,8),[],'independent original mip selection and complete pixels');
    const bindings=[];for(const [stage,range]of [[0,vs],[1,fs]]){
     gl.activeTexture(gl.TEXTURE0+(stage?0:16));const texture=gl.getParameter(gl.TEXTURE_BINDING_2D),allocation=r.allocations.find(row=>row.storage.texture===texture),planes=[];c.same(Boolean(allocation),true,'selected range has actual private or original allocation');
     c.same(gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_BASE_LEVEL),0,'native original range base restores');c.same(gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL),range[1]-range[0],'native original range end restores');
     for(let local=0;local<=range[1]-range[0];local++){const original=src.planes[range[0]+local],raw=nativeRead(gl,texture,format,original.width,original.height,local);c.same([...raw],nativeFromGuest(format,original.input),'every copied native plane is the original GPU plane');planes.push({local,original:range[0]+local,width:original.width,height:original.height,native:await blob(report,raw)});}
     bindings.push({stage,range,metadata:allocation.metadata,nativeTexture:r.trace.id(texture),planes});
    }
    gl.activeTexture(gl.TEXTURE0);c.same(gl.getError(),gl.NO_ERROR,'actual range capture no native errors');const frame={run:report.runs.length-1,label,wire:r.history.at(-1).hex,vs,fs,p,vertexSwizzle,fragmentSwizzle,bindings,color:expected.color,pixels:await blob(report,pixels),historyIndex:r.history.length-1,dump:record.dump};report.frames.push(frame);run.frames.push(report.frames.length-1);index++;
   }
  }
  await finish(r,report,run);
 }
 report.status='passed';report.resources=report.runs.at(-1).final.resources;return report;
}
