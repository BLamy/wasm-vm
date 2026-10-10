import {rig,finish,blob,submit,nativeRead} from '/renderer/virgl-command/tests/standard-byte-color-rig.mjs';
import {checks} from '/renderer/virgl-command/tests/standard-instanced-draws.mjs';
import {createVirglStandardUniformShaderBridge} from '/renderer/virgl-shader/standard.mjs';
import {colorSpecimen,statePackets,packet,join,meta,imageView,sampler,bind,draw} from '/tools/virgl-command/standard-byte-color-fixtures.mjs';
const channels={76:{bpp:3,signed:true,order:[0,1,2,'1']},77:{bpp:4,signed:true,order:[0,1,2,3]},103:{bpp:4,srgb:true,order:[1,2,3,'1']},387:{bpp:3,srgb:true,order:[2,1,0,'1']}};
const decode=v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);
function customSource(format,seed,width=11,height=7){
 const p=channels[format],metadata={...meta(6,2,format,p.signed?8:10,width,height),lastLevel:Math.floor(Math.log2(Math.max(width,height)))},planes=[];let length=3,x=seed>>>0;
 const signed=[128,129,192,255,0,1,63,127],encoded=[0,4,10,11,12,31,64,128,200,255];
 for(let level=0,w=width,h=height;level<=metadata.lastLevel;level++,w=Math.max(1,Math.floor(w/2)),h=Math.max(1,Math.floor(h/2))){
  const input=new Uint8Array(w*h*p.bpp),pool=p.signed?signed:encoded;
  for(let i=0;i<input.length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;input[i]=pool[((x>>>0)+i+level*3)%pool.length];}
  const stride=w*p.bpp+5,offset=length;planes.push({level,width:w,height:h,input,stride,offset});length+=(h-1)*stride+w*p.bpp+7;
 }
 const backing=new Uint8Array(length).fill(0x6b);for(const plane of planes)for(let row=0;row<plane.height;row++)backing.set(plane.input.subarray(row*plane.width*p.bpp,(row+1)*plane.width*p.bpp),plane.offset+row*plane.stride);
 return{metadata,planes,backing};
}
function independentSample(src,range,lod,coord){
 const p=channels[src.metadata.format],at=level=>{
  const q=src.planes[range[0]+level],xf=coord[0]*q.width-.5,yf=coord[1]*q.height-.5,x0=Math.floor(xf),y0=Math.floor(yf),dx=xf-x0,dy=yf-y0;
  const texel=(x,y)=>{const offset=(Math.max(0,Math.min(q.height-1,y))*q.width+Math.max(0,Math.min(q.width-1,x)))*p.bpp;return p.order.map((lane,k)=>{if(lane==='1')return 1;const b=q.input[offset+lane],v=p.signed?Math.max(-1,(b<128?b:b-256)/127):b/255;return p.srgb&&k<3?decode(v):v;});};
  const a=texel(x0,y0),b=texel(x0+1,y0),c=texel(x0,y0+1),d=texel(x0+1,y0+1);return a.map((v,k)=>v*(1-dx)*(1-dy)+b[k]*dx*(1-dy)+c[k]*(1-dx)*dy+d[k]*dx*dy);
 };
 const l=Math.max(0,Math.min(range[1]-range[0],lod)),first=Math.floor(l),last=Math.min(range[1]-range[0],first+1),fraction=l-first,a=at(first),b=at(last);return a.map((v,k)=>v*(1-fraction)+b[k]*fraction);
}
function independentPixels(src,vr,fr,lod){const p=channels[src.metadata.format],a=independentSample(src,vr,lod,[.625,.375]),b=independentSample(src,fr,lod,[.375,.625]),color=a.map((v,k)=>Math.max(0,Math.min(255,Math.round((p.signed?(v+b[k])*.25+.5:(v+b[k])*.5)*255))));return new Uint8Array(Array.from({length:64},()=>color).flat());}
function compare(raw,expected){return[...raw].map((v,i)=>({byte:i,actual:v,expected:expected[i]})).filter(row=>Math.abs(row.actual-row.expected)>1);}
export async function runAcceptance({seed=0x31415927,fault=null}={}){
 const c=checks(),gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true}),debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),bridge=await createVirglStandardUniformShaderBridge(),report={status:'running',task:'E6-T11d22',role:'fresh-critic',seed,fault,gpu,guestExecution:false,productionNegotiation:false,runs:[],frames:[],blobs:[],predictions:c.rows};window.__standardByteColorEvidence=report;
 for(const format of fault?[103]:[76,77,103,387])for(const cancellation of fault?[false]:[false,true]){
  const src=customSource(format,(seed^format^(cancellation?0xabc1347:0))>>>0),fresh=customSource(format,(seed^0x73a3de1)>>>0,9,3),s=colorSpecimen(format);s.vertex=s.vertex.replace('IMM[1] FLT32 {0.25,0.25,0,0}','IMM[1] FLT32 {0.375,0.625,0,0}').replace('IMM[2] FLT32 {0.25,0.25,0,0}','IMM[2] FLT32 {0.625,0.375,0,0}');
  const r=rig(gl,bridge,c,s,{step:1,delay:({ordinal})=>((ordinal+(seed>>>0))%5)+1,fault:fault?'srgb-storage':null});r.blobs=report.blobs;r.add(meta(3,0,64,0,s.positions.length),s.positions);r.add(src.metadata,src.backing);
  const run={kind:'independent-retained-generation',format,cancellation,metadata:src.metadata,backing:await blob(report,src.backing),planes:[],fresh:{metadata:fresh.metadata,backing:await blob(report,fresh.backing)},frames:[],actions:[],final:null};for(const p of src.planes)run.planes.push({...p,input:await blob(report,p.input)});report.runs.push(run);
  try{
   c.ok((await submit(r,1,statePackets(s,src),'critic-original-setup')).result,'fresh original byte-color setup');
   const vr=[1,3],fr=[2,3],lod=(seed&1)?1.375:.3125,p={s:2,t:2,r:2,min:1,mip:1,mag:1,minLod:lod,maxLod:lod},wanted=independentPixels(src,vr,fr,lod),wire=join(imageView(5,6,format,...vr),imageView(6,6,format,...fr),sampler(8,p),bind(0,5,8),bind(1,6,8),draw()),drawn=await submit(r,1,wire,'critic-before-retirement');
   c.ok(drawn.result,'fresh native signed/encoded original draw');c.same(drawn.result.gpuComplete,true,'fresh completed physical fence');
   const pixels=nativeRead(gl,r.allocations[0].storage.texture,67,8,8,0),miss=compare(pixels,wanted);run.before={vr,fr,lod,historyIndex:r.history.length-1,expected:await blob(report,wanted),pixels:await blob(report,pixels),fenceCompleted:true};
   if(fault)report.sabotage={fault,fenceCompleted:true,held:miss.length===0,miss:miss.slice(0,8),expected:run.before.expected,observed:run.before.pixels};c.same(miss.slice(0,8),[],'independent original color-space oracle after physical fence');
   const queued=join(draw(),packet(3,6,[5]),packet(3,6,[6]),packet(10,0,[0,0,0]),packet(10,0,[1,0,0]),packet(5,0,[0,0]),packet(3,8,[4]));let reused=false;const oldTarget=r.trace.id(r.allocations[0].storage.texture);
   const done=await submit(r,1,queued,'queued-color-critic-'+(cancellation?'cancel':'complete'),async(step,job)=>{
    const inspection=r.renderer.inspect();if(inspection.jobs.status==='finishing'&&!reused){reused=true;c.ok(r.store.unref(6),'retire old original signed/encoded source ID');c.ok(r.store.unref(1),'retire old output ID');const before=r.store.inspect();c.same(before.budgets.gpuBytes,768,'95 old padded texels plus distinct restricted chains remain charged');c.same(before.budgets.imageHolds,3,'old two views plus output held');const created=r.add(fresh.metadata,fresh.backing);r.add(meta(1,2,67,2,8,8),new Uint8Array(256));const after=r.store.inspect();c.same(after.budgets.gpuBytes,1160,'new34-texel original generation and target charge independently');c.same(after.resources.filter(row=>row.id===6).length,2,'two distinct same-ID original generations');run.actions.push({before,after,freshGeneration:created.generation});if(cancellation)c.ok(r.renderer.cancel(job),'fresh later-task cancellation');}
   });c.same(reused,true,'independent retained source reaches final fence');if(cancellation)c.same(done.result.error.code,'cancelled','fresh cancel result is explicit');else c.ok(done.result,'fresh retained old output completes');run.expectedRetired=await blob(report,wanted);run.oldTarget=oldTarget;
  }finally{await finish(r,report,run);}
  const retired=run.retiredPlanes.find(row=>row.texture===run.oldTarget);c.same(Boolean(retired),true,'old original output captured before native deletion');c.same([gl.ALREADY_SIGNALED,gl.CONDITION_SATISFIED].includes(retired.fencePoint.actual),true,'old original output actual physical fence completed');c.same([gl.ALREADY_SIGNALED,gl.CONDITION_SATISFIED].includes(retired.fencePoint.delivered),true,'old original output consumed physical fence completed');
  const expected=independentPixels(src,[1,3],[2,3],(seed&1)?1.375:.3125),captured=report.blobs.find(row=>row.key===retired.pixels.key);run.retirementComparison={expectedSha256:await crypto.subtle.digest('SHA-256',expected).then(b=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('')),observedSha256:captured.sha256};
  const packed=Uint8Array.from(atob(captured.gzipBase64),v=>v.charCodeAt(0)),retiredBytes=new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  c.same(compare(retiredBytes,expected).slice(0,8),[],'independent original retained pixels after consumed fence before deletion');
 }
 report.status='passed';return report;
}
