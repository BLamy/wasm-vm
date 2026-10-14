// Literal asymmetric guest draw -> original scanout, for both resource origins.
import {checker,makeRig,context,idCommand,header,backing,transfer,submission} from '../../renderer/virgl-command/tests/submit-acceptance.mjs';
import {packet,join,shader,word} from '../virgl-command/standard-image-fixtures.mjs';
import {createVirglProductionBridge} from '../../renderer/virgl-command/control-bridge.mjs';
import {qualifyVirglHost,createWorkerScanoutPresenter} from '../../renderer/virgl-command/production.mjs';
import {createVirglStandardStreamOutputShaderBridge} from '../../renderer/virgl-shader/standard.mjs';
const copy=value=>JSON.parse(JSON.stringify(value,(_,v)=>ArrayBuffer.isView(v)?[...v]:typeof v==='bigint'?v.toString():v));
const put=(bytes,at,value)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint32(at,value,true);
function resource(id,target,format,bind,width,height,flags=0){
  const bytes=header(0x204,0,72);[id,target,format,bind,width,height,1,1,0,0,flags,0].forEach((v,i)=>put(bytes,24+i*4,v));return bytes;
}
function display(opcode){const bytes=header(opcode,0,48);[0,0,12,12].forEach((v,i)=>put(bytes,24+i*4,v));put(bytes,opcode===0x103?44:40,1);return bytes;}
const vertex='VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n0: MOV OUT[0], IN[0]\n1: MOV OUT[1], IN[1]\n2: END\n';
const fragment='FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\n0: MOV OUT[0], IN[0]\n1: END\n';
async function one(Wasm,qualification,gl,compiler,flags){
  const c=checker(),frames=[],row={name:'original-draw-scanout-y-origin-'+flags,flags,predictions:{
    screen:'Clip-space positiveY green appears in every top-half display pixel and negativeY red in every bottom-half display pixel, for either resource storage origin.'}};
  const painted=document.createElement('canvas');painted.width=painted.height=12;
  const presenter=createWorkerScanoutPresenter(frame=>{
    frames.push(copy(frame));
    if(!ArrayBuffer.isView(frame.pixels))return;
    const rgba=new Uint8ClampedArray(frame.pixels.length*4);
    for(let i=0;i<frame.pixels.length;i++){
      const value=frame.pixels[i];rgba.set([value>>>16&255,value>>>8&255,value&255,value>>>24],i*4);
    }
    painted.getContext('2d').putImageData(new ImageData(rgba,12,12),0,0);
    // The actual scanout pixels have reached a native visible-image surface.
    // Synchronous acknowledgement also releases its signaled PBO ticket before
    // the shared submission fixture's stricter no-live-fence completion check.
    presenter.acknowledge(frame.presentationToken,'drawn',{drawn:true});
  });
  const Selected=class{constructor(callback){return Wasm.qualified(callback,qualification.hostWords,qualification.formatRoles,qualification.renderer);}};
  const rig=makeRig(Selected,options=>createVirglProductionBridge({...options,presenter}),gl,compiler,c,97,true,false,true),address=rig.q.base+0x210000n;
  try{
    await rig.expect('origin actual context',context(1));
    for(const allocation of [resource(1,2,67,2,12,12,flags),resource(5,0,64,16,384,1)]){
      await rig.expect('origin original allocation',allocation);
      const id=new DataView(allocation.buffer).getUint32(24,true);
      await rig.expect('origin original membership'+id,idCommand(0x202,1,id));
    }
    const red=[1,0,0,1],green=[0,1,0,1],data=[];
    for(const [triangle,color]of [
      [[[-1,-1],[1,-1],[-1,0]],red],[[[1,-1],[1,0],[-1,0]],red],
      [[[-1,0],[1,0],[-1,1]],green],[[[1,0],[1,1],[-1,1]],green],
    ])for(const [x,y]of triangle)data.push(x,y,0,1,...color);
    c.equal(data.length*4,384,'literal asymmetric vertex bytes');
    rig.q.write(address,new Uint8Array(new Float32Array(data).buffer));
    await rig.expect('origin real vertex backing',backing(5,[[address,384]]));
    await rig.expect('origin real vertex DMA',transfer(1,5,1,[0,0,0,384,1,1]));
    await rig.expect('origin original asymmetric GPU draw',submission(1,join(
      shader(10,0,vertex),shader(11,1,fragment),packet(31,0,[10,0]),packet(31,0,[11,1]),
      packet(1,5,[12,0,0,0,31,16,0,0,31]),packet(2,5,[12]),packet(6,0,[32,0,5]),
      packet(1,8,[20,1,67,0,0]),packet(5,0,[1,0,20]),packet(4,0,[0,...[6,6,.5,6,6,.5].map(word)]),
      packet(1,2,[40,2|1<<29,word(1),0,0xffff,word(1),0,0,0]),packet(2,2,[40]),
      packet(8,0,[0,12,4,0,1,0,0,0,0,0,0xffffffff,0])),109n));
    await rig.expect('origin original scanout bind',display(0x103));
    await rig.expect('origin original scanout capture',display(0x104));
    const captured=frames.findLast(frame=>Array.isArray(frame.pixels));row.frame=captured;
    c.truth(captured,'actual worker presenter receives original GPU pixels');
    c.equal(captured.pixels.length,144,'full physical display pixels');
    row.canvasPixels=[...painted.getContext('2d').getImageData(0,0,12,12).data];
    for(let y=0;y<12;y++)for(let x=0;x<12;x++)
      c.equal(captured.pixels[y*12+x],y<6?0xff00ff00:0xffff0000,'independent display top/bottom at'+x+','+y);
    row.status='passed';
  }catch(error){row.status='failed';row.failure={message:error.message,stack:error.stack};}
  finally{
    row.frames=frames;row.records=copy(rig.q.records);row.events=copy(rig.events);row.completions=copy(rig.completions);
    row.guestTrace=rig.q.vm.commandTrace();row.machineDigest=rig.q.vm.machineDigest();row.beforeDispose=copy(rig.host.bridge.inspect());
    row.disposed=copy(rig.host.bridge.dispose());rig.q.vm.free();row.cleaned=rig.trace.snapshot();row.assertions=c.assertions;
    if(row.cleaned.liveObjects||row.cleaned.liveSyncs){row.status='failed';row.cleanupFailure='Native owners leaked';}
  }
  return row;
}
export async function runProductionOriginCritic({WasmVirglSubmitProof}){
  const gl=document.querySelector('#gpu').getContext('webgl2',{antialias:false,failIfMajorPerformanceCaveat:true}),qualification=await qualifyVirglHost(gl),compiler=await createVirglStandardStreamOutputShaderBridge();
  const report={status:'running',qualification:copy(qualification),rows:[],actualLinuxGuest:false};window.__productionCriticReport=report;
  for(const flags of [0,1]){const row=await one(WasmVirglSubmitProof,qualification,gl,compiler,flags),pin=await window.__recordProductionCriticRun(report.rows.length,JSON.stringify(row));report.rows.push({...pin,name:row.name,status:row.status,...(row.failure?{failure:row.failure}:{})});}
  report.status=report.rows.every(row=>row.status==='passed')?'passed':'failed';report.summary={status:report.status,runs:report.rows.length,failed:report.rows.filter(row=>row.status!=='passed'),hardware:qualification.identity};return report;
}
