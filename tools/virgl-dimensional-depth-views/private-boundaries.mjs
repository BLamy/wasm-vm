// Literal costs, actual driver failures and retired original view identities.
import * as resources from '../../renderer/virgl-command/resources.mjs';
import * as decoders from '../../renderer/virgl-command/decoder.mjs';
import {shapes,formats} from '../virgl-dimensional-depth/fixtures.mjs';
import {packet} from './fixtures.mjs';
const copy=v=>JSON.parse(JSON.stringify(v));
const bytes=format=>format===16?2:format===126?16:4;
export function runPrivateBoundaries({gl,c,recording}){
 const rows=[];
 for(const shape of shapes)for(const format of formats){
  const meta={id:6,target:shape.target,format,bind:9,width:shape.width,height:shape.height,depth:1,arraySize:shape.arraySize,lastLevel:2,nrSamples:0,flags:0};
  const base=(meta.target===4?180:294)*bytes(format),privateCost=(meta.target===4?30:21)*bytes(format),layers=meta.target===4?[0,5]:[1,3];
  const row={metadata:meta,prediction:{base,privateCost},budgetCases:[],faults:[],ranges:[],historical:[]};rows.push(row);recording.addRow(row);
  const create=(limits)=>{
   const backend=c.ok(resources.createStandardDimensionalDepthViewTransferBackend(gl),'boundary actual backend').backend;
   const owner=c.ok(resources.createStandardDimensionalDepthViewResourceStore({backend,...(limits?{limits}: {})}),'boundary selected store'),s=owner.store;
   recording.setBudgets(()=>s.inspect().budgets);c.ok(s.createContext(1),'boundary context');c.ok(s.createResource(meta),'boundary original storage');c.ok(s.attachContext(1,6),'boundary original membership');
   const lease=c.ok(s.retainStorage(1,6,'view'),'boundary retained source').lease;
   return {owner,s,a:owner.imageAccess,lease};
  };
  for(const limit of [base+privateCost-1,base+privateCost,base+2*privateCost]){
   const {s,a,lease}=create({gpuBytes:limit});
   try{
    const at=recording.calls(),before=copy(s.inspect().budgets),capture=a.capture(lease,1,2,...layers);
    const result={limit,before,capture:copy(capture),callsBefore:at,callsAfter:recording.calls()};row.budgetCases.push(result);
    if(limit===base+privateCost-1){c.truth(!capture.ok,'exact native byte neighbor refuses');c.equal(capture.error.code,'limit-exceeded','native byte neighbor code');c.equal(recording.calls(),at,'native byte refusal precedes every driver call');c.same(s.inspect().budgets,before,'byte neighbor leaves all budgets exact');}
    else{
     const token=c.ok(capture,'exact complete native allocation').token;c.equal(s.inspect().budgets.gpuBytes,base+privateCost,'exact private allocation');
     const second=a.capture(lease,1,2,...layers);result.second=copy(second);
     if(limit===base+privateCost){c.truth(!second.ok,'aggregate private neighbor refuses');c.equal(s.inspect().budgets.gpuBytes,base+privateCost,'aggregate failure leaves first owner exact');}
     else{const token2=c.ok(second,'exact aggregate private limit').token;c.equal(s.inspect().budgets.gpuBytes,base+2*privateCost,'literal aggregate allocation');c.ok(a.release(token2),'second private owner retirement');}
     c.ok(a.release(token),'first private owner retirement');
    }
   }finally{c.ok(s.releaseStorage(lease),'budget lease retirement');c.ok(s.dispose(),'budget disposal');c.equal(s.inspect().budgets.gpuBytes,0,'budget terminal ownership');}
  }
  for(const name of ['createTexture',meta.target===4?'texStorage2D':'texStorage3D',...(format===126?['createBuffer','bufferData']:[])]){
   const {s,a,lease}=create();
   try{
    const before=copy(s.inspect().budgets);recording.arm(name);const result=a.capture(lease,1,2,...layers),fault=recording.disarm();row.faults.push({name,before,result:copy(result),fault});
    c.truth(!result.ok,'actual private driver allocation refusal '+name);c.equal(fault.hits,1,'one actual armed allocation failure');c.same(s.inspect().budgets,before,'failed allocation rolls back every reserved native byte');c.equal(gl.getError(),gl.NO_ERROR,'allocation driver error consumed');
    const recovered=c.ok(a.capture(lease,1,2,...layers),'allocation retry after real failure');c.ok(a.release(recovered.token),'allocation recovery retirement');
   }finally{recording.disarm();c.ok(s.releaseStorage(lease),'allocation lease retirement');c.ok(s.dispose(),'allocation disposal');}
  }
  {
   const {s,a,lease}=create();
   try{
    const before=copy(s.inspect().budgets);
    for(const range of [[3,3,...layers],[2,1,...layers],[1,2,0,meta.arraySize],...(meta.target===4?[[1,2,0,4],[1,2,1,5]]:[[1,2,3,2]])]){
     const at=recording.calls(),result=a.capture(lease,...range);row.ranges.push({range,result:copy(result),at,after:recording.calls()});c.truth(!result.ok,'original invalid private range refuses');c.same(s.inspect().budgets,before,'invalid original range leaves every budget');c.equal(recording.calls(),at,'invalid range refuses before driver');
    }
    const captured=c.ok(a.capture(lease,1,2,...layers),'copy failure private range'),read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),draw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),scissor=gl.isEnabled(gl.SCISSOR_TEST),allocated=copy(s.inspect().budgets);
    recording.arm('blitFramebuffer');const failed=a.refresh(captured.token),fault=recording.disarm();row.faults.push({name:'blitFramebuffer',result:copy(failed),fault});c.truth(!failed.ok,'actual depth/stencil blit refuses');c.equal(fault.hits,1,'physical copy argument fault executed');c.same(s.inspect().budgets,allocated,'failed copy retains exactly its two native owners');c.equal(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),read,'failed copy restores read framebuffer');c.equal(gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),draw,'failed copy restores draw framebuffer');c.equal(gl.isEnabled(gl.SCISSOR_TEST),scissor,'failed copy restores scissor');c.equal(gl.getError(),gl.NO_ERROR,'physical blit error consumed');c.ok(a.refresh(captured.token),'GPU copy recovers after actual driver failure');
    const hold=c.ok(a.hold(captured.token),'actual retained completion hold');c.ok(a.release(captured.token),'private name retired during hold');c.ok(s.unref(6),'original name retired during hold');
    c.ok(s.createResource(meta),'same original resource ID new owner');c.ok(s.attachContext(1,6),'replacement original membership');const replacement=c.ok(s.retainStorage(1,6,'view'),'replacement retained identity').lease;
    const next=c.ok(a.capture(replacement,1,2,...layers),'replacement new private identity');c.truth(next.generation!==captured.generation,'same ID never reuses original native generation');c.truth(!a.resolve(captured.token).ok,'released private token cannot alias replacement');
    c.ok(s.destroyContext(1),'context retirement during retained holds');c.truth(!a.resolve(next.token).ok,'retired original context cannot resolve replacement view');
    row.retired=copy(s.inspect());c.ok(s.dispose(),'dispose pending retired identities');c.equal(s.inspect().budgets.gpuBytes,0,'dispose retires original, replacement and both private owners');c.ok(a.release(hold.token),'revoked original hold releases once');c.truth(!a.release(hold.token).ok,'revoked hold cannot release twice');c.ok(a.release(next.token),'revoked replacement view releases once');c.truth(!a.resolve(next.token).ok,'disposed replacement token remains stale');
   }finally{recording.disarm();c.ok(s.dispose(),'idempotent exact disposal');}
  }
  {
   const backend=c.ok(resources.createStandardDimensionalDepthTransferBackend(gl),'D59 consumer qualifier control').backend,at=recording.calls();
   try{const refused=resources.createStandardDimensionalDepthViewResourceStore({backend});c.truth(!refused.ok,'D59-only backend cannot select retained dimensional depth views');c.equal(refused.error.code,'invalid-input','separate view backend profile required');c.equal(recording.calls(),at,'backend qualifier refuses before driver');row.backendQualification={result:copy(refused),at,after:recording.calls()};}
   finally{backend.dispose();}
  }
  {
   for(const [name,factory]of Object.entries(resources).filter(([name])=>/^create.*ResourceStore$/.test(name)&&name!=='createStandardDimensionalDepthViewResourceStore')){
    const backend=c.ok(resources.createStandardDimensionalDepthViewTransferBackend(gl),'historical actual backend').backend;
    const owner=c.ok(factory({backend}),'historical actual factory '+name),s=owner.store;recording.setBudgets(()=>s.inspect().budgets);
    try{c.ok(s.createContext(1),'historical context');const created=s.createResource(meta);if(name==='createStandardDimensionalDepthResourceStore')c.ok(created,'D59 historical storage remains admitted');let result=created;if(created.ok){c.ok(s.attachContext(1,6),'historical depth membership');result=s.retainStorage(1,6,'view');}row.historical.push({name,created:copy(created),result:copy(result)});c.truth(!result.ok,'every historical original dimensional depth view remains closed '+name);}
    finally{c.ok(s.dispose(),'historical disposal');}
   }
  }
  const request=packet(1,6,[51,6,format|meta.target<<24,0|(meta.arraySize-1)<<16,2<<8,0x688]);
  for(const [name,decode]of Object.entries(decoders).filter(([name])=>/^decode.*Submission$/.test(name)&&name!=='decodeStandardDimensionalDepthViewSubmission')){const result=decode(request),ordinary=decode(new Uint8Array());c.ok(ordinary,'historical empty original submission remains admitted');row.historical.push({name,request:[...request],result:copy(result),ordinary:copy(ordinary)});c.truth(!result.ok,'historical original view decoder stays closed '+name);}
  recording.setBudgets(()=>null);c.equal(gl.getError(),gl.NO_ERROR,'boundary terminal native errors');
 }
 return {rows};
}
