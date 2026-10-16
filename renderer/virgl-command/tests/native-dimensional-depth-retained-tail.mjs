// A critic-promoted overlapping range and retired native identity regression.
import {createStandardDimensionalDepthViewResourceStore,createStandardDimensionalDepthViewTransferBackend,computeStandardDimensionalDepthTransferLayout} from '../resources.mjs';
import {decodeStandardDimensionalDepthViewSubmission} from '../decoder.mjs';
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
const copy=v=>JSON.parse(JSON.stringify(v));
function wire(level,width,height,layers,direction=2,data){
 const words=[6,level,0,0,0,0,0,0,width,height,layers];
 if(data){const aligned=new Uint8Array(Math.ceil(data.length/4)*4);aligned.set(data);const v=new DataView(aligned.buffer);for(let i=0;i<aligned.length;i+=4)words.push(v.getUint32(i,true));}
 else words.push(0,direction);
 const out=new Uint8Array((words.length+1)*4),v=new DataView(out.buffer);v.setUint32(0,(words.length<<16)|(data?9:43),true);words.forEach((n,i)=>v.setUint32(4+i*4,n,true));return out;
}
function wanted(format,width,height,firstLayer,layers,level,seed,opposite=false){
 const size=format===16?2:format===126?8:4,out=new Uint8Array(width*height*layers*size),v=new DataView(out.buffer);
 for(let layer=0;layer<layers;layer++)for(let i=0;i<width*height;i++){
  const original=firstLayer+layer,z=((seed+level+original)&1)^(opposite?1:0),stencil=((seed+level*53+original*17)&255)^(opposite?255:0),at=(layer*width*height+i)*size;
  if(format===16)v.setUint16(at,z?65535:0,true);
  else if(format===20)v.setUint32(at,((z?0xffffff:0)<<8|stencil)>>>0,true);
  else if(format===21)v.setUint32(at,z?0xffffff:0,true);
  else {v.setFloat32(at,z,true);if(format===126)v.setUint32(at+4,stencil,true);}
 }
 return out;
}
export async function runRetainedTail({gl,c,seed=362436069,recording}){
 const rows=[];
 for(const format of [16,18,20,21,126]){
  const charge=format===16?2:format===126?16:4,meta={id:6,target:7,format,bind:9,width:7,height:5,depth:1,arraySize:7,lastLevel:2,nrSamples:0,flags:0};
  const {backend}=c.ok(createStandardDimensionalDepthViewTransferBackend(gl),'tail selected native backend'),owner=c.ok(createStandardDimensionalDepthViewResourceStore({backend}),'tail retained native owner'),s=owner.store,a=owner.imageAccess;
  const row={seed,format,metadata:meta,pixels:{original:294,overlap:14,tail:1,replacement:294},budgets:[],copies:[],uploads:[]};rows.push(row);recording?.addRow(row);recording?.setBudgets(()=>s.inspect().budgets);
  const snapshot=label=>{const state=copy(s.inspect());row.budgets.push({label,state});return state;};
  const clear=(storage,opposite)=>{
   const fb=gl.createFramebuffer(),prior=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),scissor=gl.isEnabled(gl.SCISSOR_TEST);c.truth(fb,'tail physical clear framebuffer');
   try{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,fb);gl.disable(gl.SCISSOR_TEST);gl.drawBuffers([gl.NONE]);gl.depthMask(true);gl.stencilMask(255);
    for(let level=0;level<3;level++)for(let layer=0;layer<7;layer++){
     gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER,[20,126].includes(format)?gl.DEPTH_STENCIL_ATTACHMENT:gl.DEPTH_ATTACHMENT,storage.texture,level,layer);
     c.equal(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER),gl.FRAMEBUFFER_COMPLETE,'tail physical source layer complete');
     const depth=((seed+level+layer)&1)^(opposite?1:0),stencil=((seed+level*53+layer*17)&255)^(opposite?255:0);
     if([20,126].includes(format))gl.clearBufferfi(gl.DEPTH_STENCIL,0,depth,stencil);else gl.clearBufferfv(gl.DEPTH,0,new Float32Array([depth]));
     (row.gpuWrites??=[]).push({owner:opposite?'replacement':'retained-old',level,layer,depth,stencil});
    }
   }finally{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,prior);gl.deleteFramebuffer(fb);if(scissor)gl.enable(gl.SCISSOR_TEST);}
  };
  try{
   c.ok(s.createContext(1));c.ok(s.createResource(meta));c.ok(s.attachContext(1,6));c.ok(s.attachBacking(6,[new Uint8Array(4096).fill(0xbd)]));
   for(const [level,[width,height]] of [[7,5],[3,2],[1,1]].entries()){
    const data=wanted(format,width,height,0,7,level,seed),raw=wire(level,width,height,7,1,data),command=c.ok(decodeStandardDimensionalDepthViewSubmission(raw)).commands[0],ticket=c.ok(s.prepareTransfer(1,command)).ticket;c.ok(s.executeTransfer(ticket));row.uploads.push({level,width,height,wire:hex(raw),input:hex(data)});
   }
   const lease=c.ok(s.retainStorage(1,6,'view')).lease,old=c.ok(owner.bindings.resolve(lease)).storage;
   const overlap=c.ok(a.capture(lease,1,2,5,6)),tail=c.ok(a.capture(lease,2,2,6,6)),overlapStorage=c.ok(a.resolve(overlap.token)),tailStorage=c.ok(a.resolve(tail.token)),oldFull=c.ok(a.capture(lease,0,2,0,6));
   c.equal(overlap.metadata.byteLength,14*(format===126?8:charge),'overlapping public field bytes');c.equal(tail.metadata.byteLength,format===126?8:charge,'tail public field bytes');
   c.equal(snapshot('old-two-private-and-full').budgets.gpuBytes,309*charge,'literal source and overlapping native ranges');
   const holdA=c.ok(a.hold(overlap.token)).token,holdTail=c.ok(a.hold(tail.token)).token;
   c.ok(s.detachBacking(6));c.ok(s.unref(6));c.ok(s.createResource(meta));c.ok(s.attachContext(1,6));c.ok(s.attachBacking(6,[new Uint8Array(4096).fill(0xbd)]));
   const replacementLease=c.ok(s.retainStorage(1,6,'view')).lease,replacement=c.ok(owner.bindings.resolve(replacementLease)).storage,newFull=c.ok(a.capture(replacementLease,0,2,0,6));
   c.truth(old!==replacement,'same original ID creates different native storage');c.truth(oldFull.generation!==newFull.generation,'same original ID creates different original generation');row.generations=[oldFull.generation,newFull.generation];
   c.equal(snapshot('old-retained-with-same-ID-replacement').budgets.gpuBytes,603*charge,'literal two original chains and overlapping ranges');
   clear(old,false);clear(replacement,true);recording?.armTail?.();
   for(const [label,view] of [['overlap',overlap],['last-layer-single-tail',tail]]){const before=recording?.calls();c.ok(a.refresh(view.token),label+' native refresh after replacement');row.copies.push({label,range:label==='overlap'?[1,2,5,6]:[2,2,6,6],before,after:recording?.calls()});}
   const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);c.truth(fence,'tail actual GPU fence');gl.flush();
   c.ok(a.release(overlap.token));c.ok(a.release(tail.token));c.truth(!a.resolve(overlap.token).ok&&!a.resolve(tail.token).ok,'released private tokens cannot alias same-ID replacement');
   c.equal(snapshot('public-views-released-before-fence-wait').budgets.gpuBytes,603*charge,'completion holds retain old physical source and both private ranges');
   let waits=0;try{while(true){const state=gl.clientWaitSync(fence,0,0);c.truth(state!==gl.WAIT_FAILED,'tail fence succeeds');if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED)break;c.truth(++waits<20000,'tail fence bounded');await new Promise(resolve=>setTimeout(resolve,0));}}finally{gl.deleteSync(fence);}row.fence={waits};
   row.inverse=[];
   for(const [label,saved,base,firstLayer,layers] of [['overlap',overlapStorage,1,5,2],['last-layer-single-tail',tailStorage,2,6,1]])for(let level=0;level<=saved.metadata.lastLevel;level++){
    const extent=saved.metadata.levels[level],raw=wire(level,extent.width,extent.height,layers),cmd=c.ok(decodeStandardDimensionalDepthViewSubmission(raw)).commands[0],layout=c.ok(computeStandardDimensionalDepthTransferLayout({...meta,width:saved.metadata.width,height:saved.metadata.height,arraySize:layers,lastLevel:saved.metadata.lastLevel},cmd.fields,4096)).layout,observed=backend.readback(saved.storage,saved.metadata,layout),expected=wanted(format,extent.width,extent.height,firstLayer,layers,base+level,seed);
    row.inverse.push({label,level,width:extent.width,height:extent.height,layers,originalMip:base+level,firstLayer,wire:hex(raw),layout:copy(layout),observed:hex(observed),expected:hex(expected)});
    c.same([...observed],[...expected],label+' exact old native depth and stencil after name replacement and public token release');
   }
   c.same([...c.ok(s.readBacking(6,0,4096)).bytes],[...new Uint8Array(4096).fill(0xbd)],'GPU-only writes keep replacement guest backing poisoned');
   c.ok(s.destroyContext(1));c.ok(s.createContext(1));c.ok(s.attachContext(1,6));
   for(const token of [oldFull.token,newFull.token]){const stale=a.resolve(token);c.truth(!stale.ok,'same numeric context cannot revive old view identity');c.equal(stale.error.code,'stale-context','old context generation refused');(row.stale??=[]).push(copy(stale));}
   const freshLease=c.ok(s.retainStorage(1,6,'view')).lease,fresh=c.ok(a.capture(freshLease,0,2,0,6));c.equal(fresh.generation,newFull.generation,'recreated context retains only replacement native generation');c.ok(a.release(fresh.token));c.ok(s.releaseStorage(freshLease));
   c.ok(a.release(oldFull.token));c.ok(a.release(newFull.token));c.ok(s.releaseStorage(lease));c.ok(s.releaseStorage(replacementLease));
   c.ok(a.release(holdA));c.equal(snapshot('only-old-tail-and-replacement').budgets.gpuBytes,589*charge,'first overlapping hold retirement releases exactly fourteen native pixels');
   c.ok(a.release(holdTail));c.equal(snapshot('only-replacement').budgets.gpuBytes,294*charge,'last hold releases old source and single tail');
   c.truth(!a.release(holdTail).ok,'hold cannot release twice');c.ok(s.unref(6));c.ok(s.destroyContext(1));c.ok(s.dispose());
   row.final=snapshot('terminal');c.truth(Object.values(row.final.budgets).every(v=>v===0),'tail final all ownership budgets zero');c.equal(gl.getError(),gl.NO_ERROR,'tail final actual GL error');
  }finally{c.ok(s.dispose());recording?.setBudgets(()=>null);}
 }
 return {schema:'dimensional-depth-retained-tail-v1',rows};
}
