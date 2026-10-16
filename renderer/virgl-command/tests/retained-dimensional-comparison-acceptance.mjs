// Fresh D62 critic regression: retained old comparison and replacement ordinary storage.
// Predictions decode original bytes before every draw; no renderer oracle is imported.
import {captureGL,initialize,guestBacking} from './native-dimensional-shadow-samplers.mjs';
import {checker,makeRig,idCommand,header,transfer,submission} from './submit-acceptance.mjs';
import {createVirglStandardDimensionalShadowTextureShaderBridge} from '../../virgl-shader/standard.mjs';
import {fixture,view,draw,packet,join,keys,pixelBytes} from '../../../tools/virgl-dimensional-shadow-samplers/fixtures.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join(''),clone=v=>JSON.parse(JSON.stringify(v,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString(16):v));
const bits=v=>new Uint32Array(new Float32Array([v]).buffer)[0];
function put(b,at,v){new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);}
function createResource(meta){const b=header(0x204,0,72);keys.forEach((k,i)=>put(b,24+i*4,meta[k]));return b;}
function oldDepth(f,c,level,firstLayer,lastLayer){
 const p=f.levels[level];let u=c[0],v=c[1],layer;
 if(f.target==='CUBE'){
  const a=c.slice(0,3).map(Math.abs),axis=a.indexOf(Math.max(...a));layer=axis*2+Number(c[axis]<0);const major=a[axis];
  const s=axis===0?(c[0]>0?-c[2]:c[2]):axis===1?c[0]:c[2]>0?c[0]:-c[0],t=axis===1?(c[1]>0?c[2]:-c[2]):-c[1];u=(s/major+1)/2;v=(t/major+1)/2;
 }else layer=Math.min(lastLayer-firstLayer,Math.max(0,Math.floor(c[2]+.5)))+firstLayer;
 const x=Math.min(p.width-1,Math.max(0,Math.floor(u*p.width))),y=Math.min(p.height-1,Math.max(0,Math.floor(v*p.height))),at=((layer*p.height+y)*p.width+x)*pixelBytes(f.format),dv=new DataView(p.bytes.buffer);
 return Math.fround(f.format===16?dv.getUint16(at,true)/65535:f.format===20?(dv.getUint32(at,true)>>>8)/16777215:f.format===21?(dv.getUint32(at,true)&0xffffff)/16777215:dv.getFloat32(at,true));
}
function predict(f,fn,replacement){
 const wanted=new Uint32Array(f.grid.width*f.grid.height*4),coords=new DataView(f.inputs[1].buffer);
 for(let i=0;i<f.grid.width*f.grid.height;i++){
  const c=Array.from({length:4},(_,lane)=>coords.getFloat32(i*16+lane*4,true)),z=oldDepth(f,c,f.firstLevel,f.firstLayer,f.lastLayer),r=[16,20,21].includes(f.format)?Math.max(0,Math.min(1,c[3])):c[3];
  const scalar=fn===3?Number(r<=z):Number(r>z),ordinary=replacement?0:oldDepth(f,c,0,0,f.source.arraySize-1);wanted.set([bits(scalar),bits(ordinary),0,bits(1)],i*4);
 }
 return new Uint8Array(wanted.buffer);
}
async function plane(rig,f,c,row,memory,label,fn,replacement,swizzle){
 const predicted=predict(f,fn,replacement);row.predictions.push({label,comparisonFunction:fn,replacementOrdinary:replacement,swizzle,bytes:hex(predicted),beforeRecords:rig.q.records.length});
 const q=rig.q,e=q.enqueue(label,submission(1,draw(f),0xffffffffffffffffn));q.kick();q.run();c.equal(q.usedIndex(),e.number,'fresh retained draw withholds original completion');await rig.drain();const record=q.collect(e);q.vm.writeMmio(0x64,1);c.equal(rig.trace.syncs.size,0,'fresh comparison fences retire before completion');
 const ram=memory.get(1),stride=f.grid.width*16+3;ram.write(new Uint8Array(4096).fill(0xc7));const at=rig.exchanges.length,read=await rig.expect(label+'/output206',transfer(1,1,2,[0,0,0,f.grid.width,f.grid.height,1],5n,stride,0,0xffffffffffffffffn));const whole=ram.read(),observed=new Uint8Array(predicted.length),occupied=new Set();
 for(let y=0;y<f.grid.height;y++){observed.set(whole.subarray(5+y*stride,5+y*stride+f.grid.width*16),y*f.grid.width*16);for(let x=0;x<f.grid.width*16;x++)occupied.add(5+y*stride+x);}
 const state=rig.capture.drawStates.at(-1),result={label,predicted:hex(predicted),observed:hex(observed),wholeBacking:hex(whole),guards:ram.guards(),native:state,record,read,exchanges:clone(rig.exchanges.slice(at))};row.planes.push(result);
 const a=new DataView(observed.buffer),b=new DataView(predicted.buffer);
 for(let i=0;i<predicted.length/4;i++){
  const actual=a.getUint32(i*4,true),wanted=b.getUint32(i*4,true);
  if(i%4===1&&[16,20,21].includes(f.format)&&!replacement)c.truth(actual<=0x3f800000&&Math.abs(actual-wanted)<=1,'original normalized ordinary depth within one ULP');else c.equal(actual,wanted,'fresh whole-plane word '+i);
 }
 for(let i=0;i<whole.length;i++)if(!occupied.has(i))c.equal(whole[i],0xc7,'fresh whole SG padding');
 const prefix=f.stage==='vertex'?'vs':'fs',ordinary=state.state.samplers.find(s=>s.name===prefix+'samp0'),comparison=state.state.samplers.find(s=>s.name===prefix+'samp7');c.truth(ordinary&&comparison,'both original slots reach real native reflection');c.truth(ordinary.texture.handle!==comparison.texture.handle,'ordinary and private comparison have distinct physical storage');c.equal(ordinary.parameters.TEXTURE_COMPARE_MODE,0,'ordinary original mode remains disabled');c.equal(comparison.parameters.TEXTURE_COMPARE_MODE,34894,'retained comparison mode remains enabled');c.equal(comparison.parameters.TEXTURE_COMPARE_FUNC,512+fn,'retained original function binds literally');c.equal(comparison.base,0,'private comparison base rebinds to zero');c.equal(comparison.last,1,'private comparison has two original mips');c.equal(ordinary.last,2,'replacement ordinary preserves full original mip range');
 for(const [suffix,values] of [['shadmask',swizzle.map(v=>Number(v<4))],['shadadd',swizzle.map(v=>Number(v===5))]]){const u=state.state.uniforms.find(u=>u.name===prefix+suffix+'7');c.truth(u,'owned native comparison control');c.equal(u.value.bytes,hex(new Uint8Array(new Float32Array(values).buffer)),'every retained mask/add component remains original');}
 return result;
}
export async function runAcceptance({WasmVirglSubmitProof,createVirglStandardDimensionalShadowSubmitBridge,seeds=[803201,1059227],fault=false,sabotage='compare'}={}){
 const c=checker(),native=document.querySelector('#gpu').getContext('webgl2',{antialias:false,preserveDrawingBuffer:true,failIfMajorPerformanceCaveat:true});c.truth(native,'fresh retained comparison hardware WebGL2');const info=native.getExtension('WEBGL_debug_renderer_info'),gpu=native.getParameter(info.UNMASKED_RENDERER_WEBGL);c.truth(/Apple M4 Max.*Metal|Metal.*Apple M4 Max/.test(gpu),'fresh retained real Metal hardware');
 const compiler=await createVirglStandardDimensionalShadowTextureShaderBridge(),report={schema:'fresh-d62-retained-comparison-split-v1',status:'running',gpu,seeds,runs:[],actualLinuxGuest:false,productionAuthority:false};window.__dimensionalShadowSamplerReport=report;
 const specs=['CUBE','2D_ARRAY'].flatMap(target=>[16,18,20,21,126].map(format=>({stage:'fragment',target,format,slot:7,opcode:'TEX',firstLevel:1,lastLevel:2,firstLayer:target==='CUBE'?0:1,lastLayer:target==='CUBE'?5:3,sameImage:true,swizzle:[0,4,5,3]})));
 try{for(const seed of fault?seeds.slice(0,1):seeds)for(const spec of fault?specs.slice(0,1):specs){
  const f=fixture({...spec,seed,name:'retained-split/'+spec.target+'/'+spec.format});f.extraViews[0].fixture={...f,firstLevel:0,lastLevel:2,firstLayer:0,lastLayer:f.source.arraySize-1};delete f.extraViews[0].fixture.extraViews;
  const row={name:f.name,seed,fixture:clone({...f,levels:f.levels.map(p=>({...p,bytes:hex(p.bytes)})),inputs:f.inputs.map(hex)}),compiler:[],planes:[],predictions:[]};report.runs.push(row);const control={armed:false,stage:f.stage,sabotage},capture=captureGL(native,c,row,control),bridge=new Proxy({...compiler},{get(t,k){const method=Reflect.get(t,k,t);return typeof method==='function'?request=>{const result=method.call(t,request);row.compiler.push({method:k,request:clone(request),result:clone(result)});return result;}:method;}}),Selected=class{constructor(callback){return WasmVirglSubmitProof.standardDimensionalDepth(callback);}},rig=makeRig(Selected,createVirglStandardDimensionalShadowSubmitBridge,capture.gl,bridge,c,seed,true,false,true);rig.capture=capture;
  try{
   const memory=await initialize(rig,f,c,row);await rig.expect('original retained comparison private view',submission(1,view(f)));await rig.expect('ordinary original full range',submission(1,view(f.extraViews[0].fixture,f.extraViews[0])));const baseline=await plane(rig,f,c,row,memory,'original-distinct-private-and-full',3,false,f.swizzle);
   const alternate=[3,5,4,0];await rig.expect('second retained old comparison and independent function',submission(1,view(f,{handle:61,stateHandle:60,swizzle:alternate,compareFunction:4})));const primed=await plane(rig,f,c,row,memory,'prime-alternate-old-comparison',4,false,alternate);const budgets=clone(rig.host.bridge.inspect().store.budgets);await rig.expect('restore original comparison view/state',submission(1,join(packet(10,0,[1,7,51]),packet(18,0,[1,7,50]))));
   await rig.expect('unref original resource6 public name',idCommand(0x102,0,6));const retired=rig.host.bridge.inspect().store.budgets;c.equal(retired.gpuBytes,budgets.gpuBytes,'retained native ranges keep literal GPU charges');c.equal(retired.backingBytes,budgets.backingBytes-4096,'public original SG backing retires');c.equal(retired.cpuBytes,budgets.cpuBytes-4096,'public original CPU backing retires');row.retainedBeforeReplacement=clone(rig.host.bridge.inspect());
   await rig.expect('resource6 name reuse creates distinct storage',createResource(f.source));const replacement=guestBacking(rig,6,0,c);await rig.expect('replacement guarded backing',replacement.attach);await rig.expect('replacement membership',idCommand(0x202,1,6));row.replacementUploads=[];const sourceCost=f.levels.reduce((sum,p)=>sum+p.width*p.height*p.layers*(f.format===16?2:f.format===126?16:4),0);c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,budgets.gpuBytes+sourceCost,'new public native source adds its exact literal charge');
   for(const p of f.levels){const bytes=new Uint8Array(4096).fill(0x6f),stride=p.width*pixelBytes(f.format)+7,layerStride=stride*p.height+11;for(let z=0;z<p.layers;z++)for(let y=0;y<p.height;y++)bytes.fill(0,5+z*layerStride+y*stride,5+z*layerStride+y*stride+p.width*pixelBytes(f.format));replacement.write(bytes);const request=transfer(1,6,1,[0,0,0,p.width,p.height,p.layers],5n,stride,layerStride);put(request,60,p.level);row.replacementUploads.push({level:p.level,record:await rig.expect('replacement full zero depth mip'+p.level,request)});replacement.guards();}
   await rig.expect('ordinary slot0 binds replacement full range',submission(1,view(f.extraViews[0].fixture,{handle:55,stateHandle:54,slot:0,stage:'fragment',mode:0,swizzle:[0,0,4,5]})));const cache=clone(rig.host.bridge.inspect().renderer.work);const retained=await plane(rig,f,c,row,memory,'old-comparison-with-new-ordinary',3,true,f.swizzle);
   const find=(p,slot)=>p.native.state.samplers.find(s=>s.name==='fssamp'+slot).texture.handle;c.equal(find(retained,7),find(baseline,7),'old comparison native owner survives public resource name reuse');c.truth(find(retained,0)!==find(baseline,0),'ordinary binding reaches replacement native generation');
   await rig.expect('rebind primed retained alternative comparison',submission(1,join(packet(10,0,[1,7,61]),packet(18,0,[1,7,60]))));const rebound=await plane(rig,f,c,row,memory,'cached-alternate-old-with-new-ordinary',4,true,alternate);c.equal(find(rebound,7),find(primed,7),'alternative old comparison owner survives name reuse');c.equal(find(rebound,0),find(retained,0),'comparison rebind cannot change replacement ordinary owner');c.equal(rig.host.bridge.inspect().renderer.work.programLinks,cache.programLinks,'primed checked program reused across storage name replacement');c.equal(rig.host.bridge.inspect().renderer.work.pairTranslations,cache.pairTranslations,'original shader pair translation remains cached');
   await rig.expect('restore original retained comparison after alternate',submission(1,join(packet(10,0,[1,7,51]),packet(18,0,[1,7,50]))));await plane(rig,f,c,row,memory,'cached-original-old-with-new-ordinary',3,true,f.swizzle);row.retainedAfterReplacement=clone(rig.host.bridge.inspect());
   if(fault){control.armed=true;await plane(rig,f,c,row,memory,'physically-corrupted-retained-comparison',3,true,f.swizzle);}
   c.equal(native.getError(),native.NO_ERROR,'fresh retained comparison leaves zero native errors');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};throw error;}finally{row.records=rig.q.records;row.events=rig.events;row.exchanges=rig.exchanges;row.physical=rig.trace.events;row.nativeCalls=capture.calls;row.drawStates=capture.drawStates;row.faults=capture.faults;row.commandTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();rig.dispose();row.cleaned=rig.trace.snapshot();c.equal(row.cleaned.liveObjects,0,'every fresh retained native owner retires');c.equal(row.cleaned.liveSyncs,0,'every fresh retained native fence retires');if(window.__recordDimensionalViewRun){const index=report.runs.indexOf(row);report.runs[index]={name:row.name,seed,...await window.__recordDimensionalViewRun(index,JSON.stringify(row))};}}
 }
 report.status='passed';report.summary={status:'passed',gpu,runs:report.runs.length,schedules:seeds,assertions:c.assertions};return report;
 }finally{report.assertions=c.assertions;report.attacks=c.attacks;}
}
