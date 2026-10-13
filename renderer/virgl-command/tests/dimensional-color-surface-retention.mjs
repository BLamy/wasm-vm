// Original queue lifetime and private-range witnesses, with literal complete images.
import {makeRig,context,idCommand,transfer,submission} from './submit-acceptance.mjs';
import {capture,memory,allocation,padded} from './native-dimensional-color-surfaces.mjs';
import {fixture,expected,metadata,setup,draw,surface,packet,join,shader,clear,word,CLEAR} from '../../../tools/virgl-dimensional-color-surfaces/fixtures.mjs';
import {sampler} from '../../../tools/virgl-command/standard-image-fixtures.mjs';
import {pairTexts} from '../../../tools/virgl-dimensional-shaders/fixtures.mjs';
import {witness,witnessWords} from '../../../tools/virgl-dimensional-color-surfaces/witness.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const put=(b,at,v)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(at,v,true);
const viewport=(w,h)=>packet(4,0,[0,...[w/2,h/2,.5,w/2,h/2,.5].map(word)]);
const pointDraw=n=>packet(8,0,[0,n,0,0,1,0,0,0,0,0,0xffffffff,0]);
function sourceRequest(p,direction){const stride=p.width*4+7,layerStride=stride*p.height+11,wire=transfer(1,6,direction,[0,0,0,p.width,p.height,p.layers],5n,stride,layerStride,0xffffffffffffffffn);put(wire,60,p.level);return {wire,stride,layerStride};}
const imageCost=planes=>planes.reduce((n,p)=>n+p.bytes.length,0);
export async function runRetention(Wasm,createBridge,native,compiler,c,seed,report,{boundaries=false}={}){
 for(const target of [3,4,7]){
  const level=1,layer=target===3?1:target===4?5:2,f=fixture({target,bind:10,level,layer,name:(boundaries?'retained':'private-refresh')+'/target'+target},seed);
  for(const p of f.levels)for(let i=0;i<p.bytes.length;i++)p.bytes[i]=(p.bytes[i]&1)*255;
  const w=witness(f,boundaries?{}:{first:1,last:2,firstLayer:target===7?1:0,lastLayer:target===7?3:f.source.arraySize-1});
  const row={name:f.name,seed,fixture:copy(f),witness:copy(w),uploads:[],planes:[],outputs:[],colorOperations:[]},control={armed:false,hits:0},trace=capture(native,row,control),Selected=class{constructor(cb){return Wasm.standardDimensionalDepth(cb);}},rig=makeRig(Selected,createBridge,trace.gl,compiler,c,seed,true,false,true),ram=new Map();report.rows.push(row);
  const sourceCost=imageCost(f.levels),outputCost=w.width*w.height*16,bufferCost=w.positions.length+w.coordinates.length;
  const privateCost=boundaries?0:f.levels.filter(p=>p.level>=w.first&&p.level<=w.last).reduce((n,p)=>n+p.width*p.height*(target===7?w.lastLayer-w.firstLayer+1:p.layers)*4,0);
  const baseCost=sourceCost+outputCost+bufferCost,model=f.levels.map(p=>({...p,bytes:p.bytes.slice()}));
  row.costPrediction={sourceCost,outputCost,bufferCost,privateCost,baseCost};
  window.__colorSurfaceActive=()=>({row,native:copy(rig.q.vm.inspect()),host:copy(rig.host.bridge.inspect())});
  try{
   await rig.expect('original lifetime context',context(1));
   const metas=[f.source,metadata(1,2,196,2,w.width,w.height),metadata(3,0,64,16,w.positions.length,1),metadata(4,0,64,16,w.coordinates.length,1)];
   for(const [i,meta]of metas.entries()){await rig.expect('original lifetime allocation '+meta.id,allocation(meta));const m=memory(rig,meta.id,i,c);ram.set(meta.id,m);await rig.expect('original lifetime backing '+meta.id,m.attach);await rig.expect('original lifetime membership '+meta.id,idCommand(0x202,1,meta.id));}
   for(const p of f.levels){const r=sourceRequest(p,1),body=padded(p,p.bytes,r.stride,r.layerStride,0x8d);ram.get(6).write(body);const at=rig.exchanges.length,record=await rig.expect('original lifetime source upload '+p.level,r.wire);c.equal(rig.exchanges[at].bytes,hex(p.bytes),'original binary source upload');row.uploads.push({level:p.level,input:hex(p.bytes),backing:hex(body),record,guards:ram.get(6).guards()});}
   const bufferUpload=async(id,bytes,label)=>{const m=ram.get(id),body=new Uint8Array(4096).fill(0x9b);body.set(bytes,5);m.write(body);const at=rig.exchanges.length,record=await rig.expect(label,transfer(1,id,1,[0,0,0,bytes.length,1,1],5n));c.equal(rig.exchanges[at].bytes,hex(bytes),'every original witness buffer word');m.guards();return record;};
   await bufferUpload(3,f.positions,'original lifetime color points');await rig.expect('original retained color surface',submission(1,setup(f)));
   const pair=pairTexts('fragment',{target:{3:'3D',4:'CUBE',7:'2D_ARRAY'}[target],type:'FLOAT',opcode:'TXL',slot:7}),view=handle=>packet(1,6,[handle,6,67|target<<24,w.firstLayer|w.lastLayer<<16,w.first|w.last<<8,0|1<<3|2<<6|3<<9]);
   await rig.expect('original witness objects',submission(1,join(shader(41,0,pair.vertexText),shader(42,1,pair.fragmentText),packet(1,5,[13,0,0,0,31,0,0,1,31,0,0,2,31,0,0,3,31]),surface(21,1,0,0,196),sampler(50,{mip:0,min:0,mag:0}),view(51),packet(10,0,[1,7,51]),packet(18,0,[1,7,50]))));
   c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,baseCost+privateCost,'exact native chain, output, buffers and private range charges');
   const sample=async(label,planes,zero=false,handle=51)=>{
    await bufferUpload(3,w.positions,label+'/original positions');await bufferUpload(4,w.coordinates,label+'/original coordinates');
    await rig.expect(label+'/original sampler bindings',submission(1,join(packet(31,0,[0,1]),packet(5,0,[1,0,21]),viewport(w.width,w.height),packet(2,5,[13]),packet(6,0,[16,0,3,16,0,4,16,0,4,16,0,4]),packet(10,0,[1,7,handle]),packet(31,0,[41,0]),packet(31,0,[42,1]))));
    const callsAt=trace.calls.length,entry=rig.q.enqueue(label+'/original draw',submission(1,join(clear([0,0,0,0]),pointDraw(w.texels.length)),0xffffffffffffffffn));rig.q.kick();rig.q.run();c.equal(rig.q.usedIndex(),entry.number,'sampler draw withholds original used publication');await rig.drain();const operation=rig.q.collect(entry);rig.q.vm.writeMmio(0x64,1);
    const wanted=witnessWords(w,planes,zero),stride=w.width*16+7,body=new Uint8Array(4096).fill(0xc7),predicted=body.slice();ram.get(1).write(body);
    for(let y=0;y<w.height;y++)predicted.set(wanted.subarray(y*w.width*16,(y+1)*w.width*16),5+y*stride);
    const at=rig.exchanges.length,record=await rig.expect(label+'/original output206',transfer(1,1,2,[0,0,0,w.width,w.height,1],5n,stride,0,0xffffffffffffffffn)),observed=ram.get(1).read(),drawState=trace.states.filter(s=>s.sequence>=callsAt&&trace.calls[s.sequence].name.startsWith('draw')).at(-1);
    const plane={label,operation,record,width:w.width,height:w.height,texels:w.texels.length,denseActual:rig.exchanges[at].bytes,denseExpected:hex(wanted),backingActual:hex(observed),backingExpected:hex(predicted),guards:ram.get(1).guards(),native:drawState,host:copy(rig.host.bridge.inspect())};row.planes.push(plane);
    c.equal(plane.denseActual,plane.denseExpected,'every original sampled float word and untouched output pixel');c.equal(plane.backingActual,plane.backingExpected,'every sampled output SG and padding byte');c.truth(drawState,'sampler witness reaches real native point draw');return plane;
   };
   const warm=await sample('warm-original-view',model);const links=rig.host.bridge.inspect().renderer.work.programLinks;
   const paint=async(label,handle,p)=>{
    await bufferUpload(3,p.positions,label+'/original color positions');
    await rig.expect(label+'/original color bindings',submission(1,join(packet(31,0,[0,1]),packet(5,0,[1,0,handle]),viewport(p.width,p.height),packet(2,5,[12]),packet(6,0,[16,0,3]),packet(31,0,[10,0]),packet(31,0,[11,1]))));
    const start=trace.calls.length,record=await rig.expect(label+'/original color clear and draw',submission(1,join(clear(CLEAR),draw()),0x20000000000001n)),states=trace.states.filter(s=>s.sequence>=start);
    for(const s of states){const a=s.state.attachments[0];c.equal(a.type,native.TEXTURE,'retained original color native image');c.equal(a.level,p.level,'retained original selected mip');c.equal(target===4?a.face-native.TEXTURE_CUBE_MAP_POSITIVE_X:a.layer,p.layer,'retained original selected layer/face');}
    c.truth(states.some(s=>trace.calls[s.sequence].name.startsWith('draw')),'retained color draw reaches native GPU');
    const updated=expected({...p,levels:model});for(let i=0;i<model.length;i++)model[i]=updated[i];const result={label,handle,level:p.level,layer:p.layer,record,native:states,host:copy(rig.host.bridge.inspect())};row.colorOperations.push(result);return result;
   };
   if(boundaries){
    const alternate=fixture({target,bind:10,level:0,layer:0},seed);await rig.expect('original second retained mip/layer surface',submission(1,surface(22,6,0,0)));const altered=await paint('original-layer-mip-rebind',22,alternate),after=await sample('same-view-after-layer-mip-rebind',model);
    c.same(after.native.state.program,warm.native.state.program,'original sampler program reused across native mip/layer writes');c.equal(rig.host.bridge.inspect().renderer.work.programLinks,links,'no new checked program link after mip/layer rebind');row.rebind={color:altered,sampled:after.label};
    const before=copy(rig.host.bridge.inspect()),oldResource=before.store.resources.find(r=>r.id===6&&r.public);await rig.expect('original public dimensional name unref',idCommand(0x102,0,6));const unref=copy(rig.host.bridge.inspect());
    c.equal(unref.store.budgets.gpuBytes,before.store.budgets.gpuBytes,'retained surface/view keep exact old GPU charges');c.equal(unref.store.budgets.backingBytes,before.store.budgets.backingBytes-4096,'unref retires only original public backing');c.equal(unref.store.budgets.cpuBytes,before.store.budgets.cpuBytes-4096,'unref retires only original public CPU charge');
    await rig.expect('replacement original public name allocation',allocation(f.source));const replacement=memory(rig,6,4,c);await rig.expect('replacement original backing',replacement.attach);await rig.expect('replacement original membership',idCommand(0x202,1,6));ram.set(6,replacement);row.replacementUploads=[];
    for(const p of f.levels){const zero=new Uint8Array(p.bytes.length),r=sourceRequest(p,1),body=padded(p,zero,r.stride,r.layerStride,0x6f);replacement.write(body);const at=rig.exchanges.length,record=await rig.expect('replacement original zero upload '+p.level,r.wire);c.equal(rig.exchanges[at].bytes,hex(zero),'every replacement original color byte is zero');row.replacementUploads.push({level:p.level,input:hex(zero),record,guards:replacement.guards()});}
    const reused=copy(rig.host.bridge.inspect()),newResource=reused.store.resources.find(r=>r.id===6&&r.public);c.truth(newResource.generation!==oldResource.generation,'public name reuse has a distinct original resource generation');c.equal(reused.store.budgets.gpuBytes,baseCost+sourceCost,'old retained and replacement native chains charged exactly');row.retainedUnref={before,unref,reused,oldGeneration:oldResource.generation,newGeneration:newResource.generation};
   }
   const sourceBody=ram.get(6);sourceBody.write(new Uint8Array(4096).fill(0xbd));const uploads=trace.calls.filter(x=>/^texSubImage/.test(x.name)).length;
   const painted=await paint('old-original-surface-GPU-write',20,f),after=await sample('old-view-observes-original-GPU-write',model);
   c.same(after.native.state.program,warm.native.state.program,'GPU source refresh retains original checked sampler program');c.equal(rig.host.bridge.inspect().renderer.work.programLinks,links,'GPU source refresh reuses checked program cache');c.equal(trace.calls.filter(x=>/^texSubImage/.test(x.name)).length,uploads,'native GPU writes refresh without CPU texture upload');c.equal(hex(sourceBody.read()),'bd'.repeat(4096),'color rendering and sampler refresh leave source guest backing untouched');sourceBody.guards();
   if(boundaries){
    const oldImage=painted.native[0].state.attachments[0].texture,newCreation=trace.calls.filter(x=>x.name==='createTexture').at(-1).result;row.retainedUnref.oldNativeImage=oldImage;row.retainedUnref.replacementNativeImage=newCreation;c.truth(oldImage.object!==newCreation.object,'old color surface and replacement native images stay separate');
    for(const p of f.levels){const r=sourceRequest(p,2),zero=new Uint8Array(p.bytes.length);sourceBody.write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length,record=await rig.expect('replacement untouched original image206 '+p.level,r.wire),wanted=padded(p,zero,r.stride,r.layerStride,0x4e);row.outputs.push({level:p.level,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(zero),backingActual:hex(sourceBody.read()),backingExpected:hex(wanted),guards:sourceBody.guards()});c.equal(row.outputs.at(-1).denseActual,hex(zero),'old retained surface never writes public replacement image');c.equal(row.outputs.at(-1).backingActual,hex(wanted),'replacement readback preserves every guarded SG byte');}
    await rig.expect('replacement original sampler view',submission(1,view(53)));const fresh=await sample('replacement-same-name-view',model,true,53);c.same(fresh.native.state.program,warm.native.state.program,'new resource generation reuses shader program without old pixels');
    await bufferUpload(3,f.positions,'reset original color positions');await rig.expect('reset original old surface bindings',submission(1,join(packet(31,0,[0,1]),packet(5,0,[1,0,20]),viewport(f.width,f.height),packet(2,5,[12]),packet(6,0,[16,0,3]),packet(31,0,[10,0]),packet(31,0,[11,1]))));
    const q=rig.q,entry=q.enqueue('cancel real pending old color draw',submission(1,join(clear(CLEAR),draw()),0x20000000000003n));q.kick();q.run();let turns=0;while(rig.trace.syncs.size===0){c.truth(++turns<50,'old color draw reaches a real pending native fence');await rig.step();}
    c.equal(q.usedIndex(),entry.number,'pending old color draw has no used publication');const pending={entry:copy(entry),host:copy(rig.host.bridge.inspect()),native:copy(q.vm.inspect()),response:hex(q.read(entry.responseAddress,64)),syncs:rig.trace.syncs.size,completions:rig.completions.length,calls:trace.calls.length,owners:copy([...rig.trace.objects.values()])};q.reset();
    c.equal(rig.trace.syncs.size,0,'reset cancels every pending native color fence');c.equal(rig.host.bridge.inspect().store.budgets.gpuBytes,0,'reset retires retained and public GPU charges');c.equal(rig.host.bridge.inspect().store.budgets.backingBytes,0,'reset retires every original SG owner');
    const resetOwners=copy([...rig.trace.objects.values()]);c.same(resetOwners.map(o=>o.kind).sort(),['Framebuffer','VertexArray'],'reset creates only its fresh empty renderer scope');for(const o of resetOwners)c.truth(!pending.owners.some(old=>old.id===o.id),'every old native owner retires before the fresh renderer scope');
    const completions=rig.completions.length;for(let i=0;i<8;i++){await rig.step();q.run();}c.equal(q.usedIndex(),0,'late host turns cannot publish the cancelled old used ring');c.equal(rig.completions.length,completions,'late host turns cannot complete the cancelled original submission');c.equal(hex(q.read(entry.responseAddress,64)),pending.response,'cancelled original response remains untouched');row.cancelled={pending,resetOwners,after:copy(rig.host.bridge.inspect()),response:hex(q.read(entry.responseAddress,64)),usedIndex:q.usedIndex(),completions};await rig.expect('fresh original context after reset',context(2));
   }else{
    c.truth(trace.calls.some(x=>x.name==='blitFramebuffer'||/^copyTexSubImage/.test(x.name)),'private original range copies actual native GPU storage');
    for(const p of model){const r=sourceRequest(p,2);sourceBody.write(new Uint8Array(4096).fill(0x4e));const at=rig.exchanges.length,record=await rig.expect('GPU-written complete original image206 '+p.level,r.wire),wanted=padded(p,p.bytes,r.stride,r.layerStride,0x4e);row.outputs.push({level:p.level,record,denseActual:rig.exchanges[at].bytes,denseExpected:hex(p.bytes),backingActual:hex(sourceBody.read()),backingExpected:hex(wanted),guards:sourceBody.guards()});c.equal(row.outputs.at(-1).denseActual,hex(p.bytes),'every GPU-written and untouched original source texel');c.equal(row.outputs.at(-1).backingActual,hex(wanted),'every GPU-written source SG padding byte');}
   }
   c.equal(native.getError(),native.NO_ERROR,'zero retained color hardware errors');row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};throw error;}
  finally{row.calls=trace.calls;row.attachmentStates=trace.states;row.records=copy(rig.q.records);row.events=copy(rig.events);row.exchanges=copy(rig.exchanges);row.completions=copy(rig.completions);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());rig.dispose();row.cleaned=rig.trace.snapshot();c.equal(rig.trace.objects.size,0,'all lifetime color owners retire');c.equal(rig.trace.syncs.size,0,'all lifetime color syncs retire');window.__colorSurfaceActive=null;const index=report.rows.length-1;if(window.__recordDimensionalColorSurfaceRun)report.rows[index]=await window.__recordDimensionalColorSurfaceRun(index,JSON.stringify(row));}
 }
}
