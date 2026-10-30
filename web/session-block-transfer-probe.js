import {WasmMachine} from './pkg/wasm_vm_wasm.js';
import {checkpointHash} from './session-checkpoints.js';

const need=(ok,why)=>{if(!ok)throw Error('session block transfer: '+why);};

export async function runSessionBlockTransferProbe(){
 const [elf,meta]=await Promise.all(['assets/e9-block-transfer.elf','assets/e9-block-transfer.json'].map(async name=>{
  const response=await fetch(new URL(name,import.meta.url));need(response.ok,'asset '+name);
  return name.endsWith('.json')?response.json():new Uint8Array(await response.arrayBuffer());
 }));
 need(checkpointHash(elf.subarray(120))===meta.sha256,'guest fixture hash');
 need(meta.length===1179648&&meta.sector===20000,'frozen guest transfer');
 const chunk=new Uint8Array(256*1024).fill(0x63),reference={sha256:checkpointHash(chunk),length:chunk.length};
 const policy={version:1,base:{identity:'37'.repeat(32),sectors:'32768',chunk_bytes:chunk.length,chunks:Array(64).fill(reference)},agent:false,capture:false};
 const machine=new WasmMachine(16);
 try{
  machine.loadElf(elf);machine.startEventClock(1,1);machine.installDeviceSession(JSON.stringify(policy),false);machine.setTrace(true);
  let marker=0,position;
  for(let step=1;step<=300;step++){
   const outcome=machine.runEventUntil(String(step*128),128);
   need(outcome.kind==='max','guest run '+outcome.kind);
   const report=machine.readDeviceMemory(meta.reportAddress,12);
   marker=new DataView(report.buffer,report.byteOffset,report.byteLength).getUint32(8,true);
   if(marker===0xb10c){position=machine.eventPosition();break;}
  }
  need(marker===0xb10c,'guest completed both real virtio requests');
  const report=machine.readDeviceMemory(meta.reportAddress,12),view=new DataView(report.buffer,report.byteOffset,report.byteLength);
  const statusWrite=view.getUint32(0,true),statusRead=view.getUint32(4,true);
  need(statusWrite===0&&statusRead===0,'guest saw S_OK for OUT and IN');
  const used=machine.readDeviceMemory(meta.usedAddress,2);
  need(new DataView(used.buffer,used.byteOffset,2).getUint16(0,true)===2,'used ring completed twice');
  need(machine.deviceRequests().length===0,'local COW path issued no host completion');
  const first=machine.readDeviceMemory(meta.readbackAddress,1048576);
  const rest=machine.readDeviceMemory(String(BigInt(meta.readbackAddress)+1048576n),meta.length-1048576);
  need(first.every(byte=>byte===0)&&rest.every(byte=>byte===0),'readback is the zero-filled COW write, not nonzero base');
  const trace=machine.takeTrace();need(trace.includes('pc=')||trace.length>1000,'retired guest trace');
  return{status:'passed',guest:meta,transition:position.transition,statusWrite,statusRead,used:2,
   readbackSha256:checkpointHash(new Uint8Array(meta.length)),trace};
 }finally{machine.free();}
}
