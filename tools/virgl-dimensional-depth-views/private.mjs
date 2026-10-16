// Independently selected original fields, literal NPOT costs and physical inverses.
import {createStandardDimensionalDepthViewResourceStore,createStandardDimensionalDepthViewTransferBackend,computeStandardDimensionalDepthTransferLayout} from '../../renderer/virgl-command/resources.mjs';
import {decodeStandardDimensionalDepthViewSubmission} from '../../renderer/virgl-command/decoder.mjs';
import {shapes,formats,plane,pixelBytes,whole,wire,hex} from '../virgl-dimensional-depth/fixtures.mjs';
const copy=v=>JSON.parse(JSON.stringify(v,(_,x)=>ArrayBuffer.isView(x)?[...x]:x));
const charge=format=>format===16?2:format===126?16:4;
function original(shape,format){return {id:6,target:shape.target,format,bind:9,width:shape.width,height:shape.height,depth:1,arraySize:shape.arraySize,lastLevel:2,nrSamples:0,flags:0};}
function fields(c,format,wanted,observed,label){
 c.equal(observed.length,wanted.length,label+' complete public fields');
 const a=new DataView(observed.buffer,observed.byteOffset,observed.byteLength),b=new DataView(wanted.buffer,wanted.byteOffset,wanted.byteLength),size=pixelBytes(format);
 for(let at=0;at<wanted.length;at+=size){
  if(format===16)c.equal(a.getUint16(at,true),b.getUint16(at,true),label+' UN16 '+at/size);
  else if(format===20||format===21)c.equal(a.getUint32(at,true),format===20?b.getUint32(at,true):b.getUint32(at,true)&0xffffff,label+' packed depth/stencil '+at/size);
  else{
   const bits=b.getUint32(at,true),value=b.getFloat32(at,true),exponent=bits>>>23&255;
   if(exponent!==255){
    const choices=(bits&0x7fffffff)===0||bits>>>31?[0,0x80000000]:exponent===0?[bits,0,0x80000000]:[value>1?0x3f800000:bits];
    c.truth(choices.includes(a.getUint32(at,true)),label+' original FLOAT '+at/size);
   }
   if(format===126)c.same([...observed.subarray(at+4,at+8)],[wanted[at+4],0,0,0],label+' exact stencil and canonical X24 '+at/size);
  }
 }
}
async function finish(gl,c){
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);c.truth(sync,'real private-copy GPU fence');gl.flush();let waits=0;
 try{while(true){const state=gl.clientWaitSync(sync,0,0);c.truth(state!==gl.WAIT_FAILED,'private-copy fence succeeds');if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED)break;c.truth(++waits<20000,'bounded host fence');await new Promise(resolve=>setTimeout(resolve,0));}}
 finally{gl.deleteSync(sync);}
 return {waits};
}
export async function runPrivate({gl,c,seed=0x7e8193a5,recording}){
 const rows=[];
 for(const shape of shapes)for(const format of formats){
  const backend=c.ok(createStandardDimensionalDepthViewTransferBackend(gl),'private selected backend').backend;
  const owner=c.ok(createStandardDimensionalDepthViewResourceStore({backend}),'private selected owner'),s=owner.store,a=owner.imageAccess;
  const meta=original(shape,format),row={metadata:meta,seed,views:[],budgets:[],planes:[]};rows.push(row);
  if(recording)recording.addRow(row);
  if(recording)recording.setBudgets(()=>s.inspect().budgets);
  let lease;
  try{
   c.ok(s.createContext(1),'private original context');c.ok(s.createResource(meta),'private original resource');c.ok(s.attachContext(1,6),'private original membership');c.ok(s.attachBacking(6,[new Uint8Array(4096)]),'private original backing');
   const completePixels=shape.target===4?180:294,privatePixels=shape.target===4?30:21;
   row.prediction={completePixels,privatePixels,publicBytes:completePixels*pixelBytes(format),nativeBytes:completePixels*charge(format),privatePublicBytes:privatePixels*pixelBytes(format),privateNativeBytes:privatePixels*charge(format)};
   c.equal(s.inspect().budgets.gpuBytes,row.prediction.nativeBytes,'literal complete original native NPOT chain');
   for(const [level,extent]of shape.levels.entries()){
    const bytes=plane(seed,format,shape.target,level,extent,37),command=c.ok(decodeStandardDimensionalDepthViewSubmission(wire(6,level,whole(extent),{opcode:9,data:bytes})),'private original inline words').commands[0];
    const prepared=c.ok(s.prepareTransfer(1,command),'private original upload');c.ok(s.executeTransfer(prepared.ticket),'private physical native upload');row.planes.push({level,extent,input:hex(bytes),wire:hex(wire(6,level,whole(extent),{opcode:9,data:bytes}))});
   }
   lease=c.ok(s.retainStorage(1,6,'view'),'private original retained lease').lease;
   const full=c.ok(a.capture(lease,0,2,0,shape.arraySize-1),'full depth range'),source=c.ok(owner.bindings.resolve(lease),'full actual original storage');
   c.truth(c.ok(a.resolve(full.token),'full depth storage').storage===source.storage,'full original range shares native identity');c.equal(s.inspect().budgets.gpuBytes,row.prediction.nativeBytes,'full view allocates no bytes');c.ok(a.refresh(full.token),'full range inert refresh');c.ok(a.release(full.token),'full range release');
   const firstLayer=shape.target===4?0:1,lastLayer=shape.target===4?5:3;
   const captured=c.ok(a.capture(lease,1,2,firstLayer,lastLayer),'private original depth range'),resolved=c.ok(a.resolve(captured.token),'private native depth storage');
   c.equal(resolved.metadata.byteLength,row.prediction.privatePublicBytes,'literal private public chain');c.equal(resolved.metadata.gpuByteLength,row.prediction.privateNativeBytes,'literal private native chain');
   c.equal(s.inspect().budgets.gpuBytes,row.prediction.nativeBytes+row.prediction.privateNativeBytes,'private range charges complete native storage and PBO');
   row.views.push({firstLevel:1,lastLevel:2,firstLayer,lastLayer,metadata:copy(resolved.metadata),generation:captured.generation,beforeRefresh:copy(s.inspect().budgets)});
   c.ok(a.refresh(captured.token),'private depth/stencil GPU range copy');row.copyFence=await finish(gl,c);
   for(let level=0;level<2;level++){
    const [width,height]=shape.levels[level+1],layers=lastLayer-firstLayer+1,box=whole([width,height,layers]);
    const selectedMeta={...meta,width:shape.levels[1][0],height:shape.levels[1][1],arraySize:layers,lastLevel:1};
    const command=c.ok(decodeStandardDimensionalDepthViewSubmission(wire(6,level,box,{direction:2})),'private independent inverse wire').commands[0];
    const layout=c.ok(computeStandardDimensionalDepthTransferLayout(selectedMeta,command.fields,4096),'private independent physical layout').layout;
    const output=backend.readback(resolved.storage,resolved.metadata,layout),input=Uint8Array.from(row.planes[level+1].input.match(/../g),v=>parseInt(v,16));
    const bytes=width*height*pixelBytes(format),wanted=input.subarray(firstLayer*bytes,(lastLayer+1)*bytes);
    fields(c,format,wanted,output,'private mip'+level+' target'+shape.target+' format'+format);
    row.views[0].inverse??=[];row.views[0].inverse.push({level,width,height,layers,expected:hex(wanted),observed:hex(output),layout:copy(layout)});
   }
   const hold=c.ok(a.hold(captured.token),'private pending GPU hold');c.ok(a.release(captured.token),'private public view release');
   c.equal(s.inspect().budgets.gpuBytes,row.prediction.nativeBytes+row.prediction.privateNativeBytes,'pending hold retains exact depth allocation');
   c.ok(s.unref(6),'private original name retirement');c.ok(s.releaseStorage(lease),'private source lease retirement');lease=null;
   c.equal(s.inspect().budgets.gpuBytes,row.prediction.nativeBytes+row.prediction.privateNativeBytes,'private hold retains original source identity');
   c.ok(a.release(hold.token),'private fence hold retirement');c.equal(s.inspect().budgets.gpuBytes,0,'final private and original depth allocation retired');
   row.final=copy(s.inspect());
  }finally{if(lease)s.releaseStorage(lease);c.ok(s.dispose(),'private exact native disposal');c.equal(gl.getError(),gl.NO_ERROR,'private terminal native error');if(recording)recording.setBudgets(()=>null);}
 }
 return {schema:'dimensional-depth-private-inverse-v1',rows,actualLinuxGuest:false,productionAuthority:false};
}
