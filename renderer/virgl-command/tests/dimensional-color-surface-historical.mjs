// Actual historical selected queue admission is kept closed for dimensional surfaces.
import {makeRig,context,idCommand,submission} from './submit-acceptance.mjs';
import {createVirglStandardDimensionalShadowSubmitBridge} from '../control-bridge.mjs';
import {capture,allocation} from './native-dimensional-color-surfaces.mjs';
import {fixture,surface,metadata} from '../../../tools/virgl-dimensional-color-surfaces/fixtures.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:typeof x==='bigint'?x.toString(16):x));
export async function runHistorical(Wasm,native,compiler,c,seed,report){
 for(const target of [3,4,7]){
  const f=fixture({target,bind:10,level:0,layer:0},seed),row={name:'historical-original-surface/target'+target,seed,fixture:copy(f),refusals:[],controls:[]},control={armed:false,hits:0},trace=capture(native,row,control),Selected=class{constructor(cb){return Wasm.standardDimensionalDepth(cb);}},rig=makeRig(Selected,createVirglStandardDimensionalShadowSubmitBridge,trace.gl,compiler,c,seed,true,false,true);report.rows.push(row);
  try{
   await rig.expect('historical original context',context(1));
   await rig.expect('historical original dimensional allocation',allocation(f.source));await rig.expect('historical original dimensional membership',idCommand(0x202,1,6));
   await rig.expect('historical original2D mip allocation',allocation(metadata(1,2,67,10,5,target===4?5:3,1,1,2)));await rig.expect('historical original2D membership',idCommand(0x202,1,1));
   for(const p of f.levels){
    const before=copy(rig.host.bridge.inspect()),at=trace.calls.length,record=await rig.expect('historical dimensional surface stays refused',submission(1,surface(20,6,p.level,p.layers-1)),0x1205),after=copy(rig.host.bridge.inspect());
    c.same(after.store,before.store,'historical refusal preserves all original owners and charges');c.truth(!trace.calls.slice(at).some(v=>/^draw/.test(v.name)||v.name==='framebufferTextureLayer'||v.name==='framebufferTexture2D'),'historical refusal performs no attachment or draw');row.refusals.push({level:p.level,layer:p.layers-1,record,before,after});
    row.controls.push(await rig.expect('historical original2D mip surface admitted',submission(1,surface(21+p.level,1,p.level,0))));
   }
   row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};throw error;}
  finally{row.calls=trace.calls;row.records=copy(rig.q.records);row.events=copy(rig.events);row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();rig.dispose();row.cleaned=rig.trace.snapshot();const index=report.rows.length-1;if(window.__recordDimensionalColorSurfaceRun)report.rows[index]=await window.__recordDimensionalColorSurfaceRun(index,JSON.stringify(row));}
 }
}
