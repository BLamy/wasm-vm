import {makeRig,context,idCommand,submission} from './submit-acceptance.mjs';
import {createVirglSubmitBridge,createVirglStandardDimensionalColorSurfaceSubmitBridge,createVirglStandardDimensionalShadowSubmitBridge} from '../control-bridge.mjs';
import {capture} from './native-dimensional-depth-surfaces.mjs';
import {allocation} from './native-dimensional-color-surfaces.mjs';
import {fixture,surface,metadata,packet,join} from '../../../tools/virgl-dimensional-depth-surfaces/fixtures.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
export async function runHistorical(Wasm,native,compiler,c,seed,report){
 {
  const row={name:'historical-base-Z16-surface',seed,refusals:[],controls:[]},trace=capture(native,row,{armed:false,hits:0}),Selected=class{constructor(cb){return Wasm.standardDimensionalDepth(cb);}},rig=makeRig(Selected,createVirglSubmitBridge,trace.gl,compiler,c,seed,true,false,false);report.rows.push(row);
  try{
   await rig.expect('base original depth context',context(1));const meta=metadata(6,2,16,1,5,3);await rig.expect('base original Z16 allocation',allocation(meta));await rig.expect('base original depth membership',idCommand(0x202,1,6));row.metadata=meta;
   row.controls.push(await rig.expect('base original Z16 surface and framebuffer',submission(1,join(surface(20,6,0,0,16),packet(5,0,[0,20])))));row.status='passed';
  }finally{row.calls=trace.calls;row.records=copy(rig.q.records);row.events=copy(rig.events);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();rig.dispose();row.cleaned=rig.trace.snapshot();c.equal(rig.trace.objects.size,0,'base original Z16 owners retire');const index=report.rows.length-1;if(window.__recordDimensionalDepthSurfaceRun)report.rows[index]=await window.__recordDimensionalDepthSurfaceRun(index,JSON.stringify(row));}
 }
 for(const [name,factory]of [['D63',createVirglStandardDimensionalColorSurfaceSubmitBridge],['D62',createVirglStandardDimensionalShadowSubmitBridge]])for(const target of [4,7])for(const format of [16,18,20,21,126]){
  const f=fixture({target,format,bind:9,level:0,layer:0},seed),row={name:`historical-${name}/target${target}/format${format}`,seed,fixture:copy(f),refusals:[],controls:[]},trace=capture(native,row,{armed:false,hits:0}),Selected=class{constructor(cb){return Wasm.standardDimensionalDepth(cb);}},rig=makeRig(Selected,factory,trace.gl,compiler,c,seed,true,false,true);report.rows.push(row);
  try{
   await rig.expect('historical original depth context',context(1));await rig.expect('historical original dimensional depth allocation',allocation(f.source));await rig.expect('historical original depth membership',idCommand(0x202,1,6));
   await rig.expect('historical original2D depth allocation',allocation(metadata(1,2,format,9,5,target===4?5:3,1,1,2)));await rig.expect('historical original2D depth membership',idCommand(0x202,1,1));
   for(const p of f.levels)for(const layer of [0,p.layers-1]){
    const before=copy(rig.host.bridge.inspect()),at=trace.calls.length,record=await rig.expect('historical dimensional depth surface stays refused',submission(1,surface(20,6,p.level,layer,format)),0x1205),after=copy(rig.host.bridge.inspect());
    c.same(after.store,before.store,'historical refusal retains exact original owners and GPU charges');c.truth(!trace.calls.slice(at).some(v=>/^draw/.test(v.name)||v.name==='framebufferTextureLayer'||v.name==='framebufferTexture2D'),'historical refusal has no native attachment or draw');row.refusals.push({level:p.level,layer,record,before,after});
   }
   for(const p of f.levels)row.controls.push(await rig.expect('historical original2D depth mip still admitted',submission(1,surface(21+p.level,1,p.level,0,format))));row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};throw error;}
  finally{row.calls=trace.calls;row.records=copy(rig.q.records);row.events=copy(rig.events);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();rig.dispose();row.cleaned=rig.trace.snapshot();c.equal(rig.trace.objects.size,0,'historical depth surface owners retire');const index=report.rows.length-1;if(window.__recordDimensionalDepthSurfaceRun)report.rows[index]=await window.__recordDimensionalDepthSurfaceRun(index,JSON.stringify(row));}
 }
}
