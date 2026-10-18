// Live guest reads actual UART and virtio-input DMA bytes, then the immutable store is reopened.
import {WasmLinux,setSlirpNet} from './pkg/wasm_vm_wasm.js';
import {GPU_CHECKPOINT_BUILD_ID,SOFTWARE_CHECKPOINT_WASM_SHA256,SOFTWARE_CHECKPOINT_WASM_BYTES} from './gpu-checkpoint-build.js';
import {createKeyboardBridge,createWasmKeyboardAdapter} from './src/input/keyboard.js';
import {attachHeldKeyLifecycle} from './src/input/held-keys.js';
const need=(ok,why)=>{if(!ok)throw Error('input recording: '+why);};
const word=(type,code,value)=>{const b=new Uint8Array(8),v=new DataView(b.buffer);v.setUint16(0,type,true);v.setUint16(2,code,true);v.setInt32(4,value,true);return [...b];};
export const INPUT_PROBE_DATABASE='wasm-vm-sessions-v1-input-probe';
const slotMemory=slot=>0x80400000+(slot-3)*0x10000;
export function inputGuestKernel(){
  const words=[],labels=new Map(),patches=[];
  const emit=value=>words.push(value>>>0);
  const addi=(rd,rs,n)=>emit((n<<20)|(rs<<15)|(rd<<7)|0x13);
  const li=(rd,n)=>{const high=((n+0x800)>>>12)&0xfffff,low=(n-(high<<12))<<20>>20;
    emit((high<<12)|(rd<<7)|0x37);addi(rd,rd,low);emit((32<<20)|(rd<<15)|(1<<12)|(rd<<7)|0x13);emit((32<<20)|(rd<<15)|(5<<12)|(rd<<7)|0x13);};
  const store=(rs,base,offset,width=2)=>emit(((offset>>>5)<<25)|(rs<<20)|(base<<15)|(width<<12)|((offset&31)<<7)|0x23);
  const load=(rd,base,offset)=>emit((offset<<20)|(base<<15)|(4<<12)|(rd<<7)|3);
  const branch=(rs1,rs2,label)=>{patches.push({at:words.length,rs1,rs2,label});emit(0);};
  const jump=label=>{patches.push({at:words.length,label,jump:true});emit(0);};
  li(13,8);li(14,2);
  for(const slot of [3,4,5]){
    const memory=slotMemory(slot);li(7,memory);li(8,memory+0x2000);li(9,memory+0x3000);li(10,memory+0x4000);
    for(let i=0;i<16;i++){store(10,7,16*i);store(0,7,16*i+4);store(13,7,16*i+8);store(14,7,16*i+12);li(5,i);store(5,8,4+2*i,1);addi(10,10,8);}
    li(5,16);store(5,8,2,1);li(6,0x10001000+slot*0x1000);
    for(const[offset,value]of [[0x30,0],[0x38,32],[0x80,memory],[0x90,memory+0x2000],[0xa0,memory+0x3000],[0x44,1],[0x50,0]]){li(5,value);store(5,6,offset);}
  }
  li(1,0x10000000);li(5,82);store(5,1,0,0);labels.set('wait',words.length);
  load(5,1,5);emit((1<<20)|(5<<15)|(7<<12)|(5<<7)|0x13);branch(5,0,'wait');load(5,1,0);li(6,33);branch(5,6,'dump');store(5,1,0,0);jump('wait');
  labels.set('dump',words.length);
  for(const[slot,count]of [[3,8],[4,4],[5,3]]){li(7,slotMemory(slot)+0x3000);load(5,7,2);store(5,1,0,0);li(7,slotMemory(slot)+0x4000);
    for(let i=0;i<count*8;i++){load(5,7,i);store(5,1,0,0);}}
  li(5,68);store(5,1,0,0);labels.set('done',words.length);jump('done');
  for(const p of patches){const offset=(labels.get(p.label)-p.at)*4;
    words[p.at]=p.jump?(((offset>>>20)&1)<<31|((offset>>>1)&0x3ff)<<21|((offset>>>11)&1)<<20|((offset>>>12)&0xff)<<12|0x6f)>>>0
      :(((offset>>>12)&1)<<31|((offset>>>5)&0x3f)<<25|(p.rs2<<20)|(p.rs1<<15)|((offset>>>1)&0xf)<<8|((offset>>>11)&1)<<7|0x63)>>>0;
  }
  const bytes=new Uint8Array(words.length*4),view=new DataView(bytes.buffer);words.forEach((w,i)=>view.setUint32(i*4,w,true));return bytes;
}
export async function runInputRecordingProbe(){
  const [{SessionStore},{SessionInputJournal},{checkpointHash}]=await Promise.all([import('./session-store.js'),import('./session-inputs.js'),import('./session-checkpoints.js')]);
  const report={status:'running',refusals:[]},kernel=inputGuestKernel(),kernelUrl=URL.createObjectURL(new Blob([kernel]));
  const zeros=checkpointHash(new Uint8Array(4096)),image=JSON.stringify({version:1,image_len:8192,chunk_size:4096,layout:'split',chunks:[zeros,zeros]});
  const output=[],fresh=()=>WasmLinux.newChunkedDisk(16,kernel,image,new URL('./',location.href).href,1,new Uint32Array(),'console=ttyS0',bytes=>output.push(...bytes),false);
  let vm,replay,bulk,store,writer,detach;
  const refuse=(name,fn)=>{let error;try{fn();}catch(e){error=e;}need(error,name+' must refuse');report.refusals.push({name,message:String(error)});};
  try{
    setSlirpNet(false);vm=fresh();vm.runChunk(4096);need(output.length===1&&output[0]===82,'guest initialized its real event queues');
    const initial=vm.captureInputWitness(),clock=vm.guestClockState();
    store=await SessionStore.open(INPUT_PROBE_DATABASE);for(const id of ['input-probe','input-bulk'])if(await store.openSession(id))await store.deleteSession(id);writer=await store.writer('input-probe');
    const config={version:1,inputPrefixWitness:1,providersComplete:false,runtime:GPU_CHECKPOINT_BUILD_ID,ramMib:16,bootargs:'console=ttyS0',
      clock:{mode:'icount',divider:clock.clockDiv,timebase_hz:String(clock.timebaseHz),interactive:null},
      kernel:{url:kernelUrl,sha256:checkpointHash(kernel),length:String(kernel.length)},
      wasm:{url:new URL('./pkg/wasm_vm_wasm_bg.wasm',import.meta.url).href,sha256:SOFTWARE_CHECKPOINT_WASM_SHA256,length:String(SOFTWARE_CHECKPOINT_WASM_BYTES)},
      devices:JSON.parse(vm.softwareCheckpointTopology()),imageManifest:image,baseUrl:new URL('./',location.href).href};
    const journal=await SessionInputJournal.createWitness(store,writer,config,initial.native,initial.disk,initial.pending,initial.output);
    vm.startInputCapture(false);vm.inputLifecycle(0);
    const keyboard=createKeyboardBridge(createWasmKeyboardAdapter(vm)),lifecycle=new EventTarget();
    detach=attachHeldKeyLifecycle({windowTarget:lifecycle,documentTarget:null,viewTarget:lifecycle,releaseAll:()=>keyboard.releaseAll()});
    keyboard.handleKeyEvent({type:'keydown',code:'ShiftLeft'});keyboard.handleKeyEvent({type:'keydown',code:'KeyA'});
    for(let i=0;i<100;i++)keyboard.handleKeyEvent({type:'keydown',code:'KeyA',repeat:true});
    lifecycle.dispatchEvent(new Event('blur'));need(keyboard.heldCodes().length===0,'focus loss releases both held keys');
    vm.sendTabletEvent(3,0,125);vm.syncTablet();vm.sendTabletEvent(3,0,125);vm.syncTablet();
    vm.setInputPointerMode(true);vm.sendMouseEvent(2,0,-7);vm.sendMouseEvent(2,1,3);vm.syncMouse();
    need(vm.setDisplay(1367,901),'resize accepted');need(vm.displayStats().advertisedWidth===1367,'actual display device changed');
    const paste=new TextEncoder().encode('clip:λ\r!');vm.sendInput(paste);paste.fill(255);
    const offered=Uint8Array.from({length:131072},(_,i)=>(i*17+43)&255),offeredHash=checkpointHash(offered);
    refuse('unsupported upload recorded as failure',()=>vm.pushFileUpload(7,offered,false));offered.fill(0);
    vm.inputLifecycle(1);vm.runChunk(10000);vm.inputLifecycle(0);vm.inputLifecycle(2);
    const expected=[82,...new TextEncoder().encode('clip:λ\r'),8,
      ...word(1,42,1),...word(0,0,0),...word(1,30,1),...word(0,0,0),...word(1,30,0),...word(0,0,0),...word(1,42,0),...word(0,0,0),4,
      ...word(3,0,125),...word(0,0,0),...word(3,0,125),...word(0,0,0),3,...word(2,0,-7),...word(2,1,3),...word(0,0,0),68];
    need(JSON.stringify(output)===JSON.stringify(expected),'RV64 guest observed exact UART and DMA bytes');
    const receipts=vm.takeInputDeliveries(),expectedReceipts=receipts.map(r=>({...r,bytes:r.bytes.slice()}));
    journal.stage(receipts);need(journal.pending===receipts.length,'owned pending batch');for(const r of receipts)r.bytes.fill(255);await journal.flush();need(journal.pending===0,'committed batch drained');
    report.position=vm.inputPosition();report.guestBytes=Uint8Array.from(output);report.guestSha256=checkpointHash(report.guestBytes);report.initial=initial;
    report.largeOffer={bytes:131072,sha256:offeredHash};report.database=INPUT_PROBE_DATABASE;report.id='input-probe';
    await writer.release();writer=null;await store.close();store=await SessionStore.open(INPUT_PROBE_DATABASE);
    const saved=await SessionInputJournal.read(store,'input-probe');need(saved.receipts.length===expectedReceipts.length,'store/reopen event count');
    const canonical=r=>[r.transition,r.phase,r.ordinal,r.sequence,r.retired,r.channel,r.outcome,[...r.bytes]];
    for(let i=0;i<saved.receipts.length;i++)need(JSON.stringify(canonical(saved.receipts[i]))===JSON.stringify(canonical(expectedReceipts[i])),'store/reopen exact receipt '+i);
    report.receipts=saved.receipts;report.manifest=saved.manifest;
    output.length=0;replay=fresh();replay.runChunk(4096);replay.startInputCapture(true);
    for(const r of saved.receipts){if(r.transition!=='0')break;replay.applyRecordedInput(r.channel,r.transition,r.sequence,r.ordinal,r.retired,r.bytes,r.outcome);}
    const cursor=r=>[r.transition,r.phase,r.ordinal,r.sequence,r.retired];
    const before=JSON.stringify(cursor(replay.inputPosition()));
    for(const[name,fn]of [['UART',()=>replay.sendInput(new Uint8Array([1]))],['keyboard',()=>replay.sendKeyboardEvent(1,30,1)],
      ['tablet',()=>replay.sendTabletEvent(3,0,1)],['mouse',()=>replay.sendMouseEvent(2,0,1)],['resize',()=>replay.setDisplay(640,480)],
      ['agent',()=>replay.sendAgentInput(new Uint8Array([1]))],['upload',()=>replay.pushFileUpload(7,new Uint8Array([1]),false)],
      ['lifecycle',()=>replay.inputLifecycle(1)],['general execution',()=>replay.runChunk(1)]])refuse('replay rejects live '+name,fn);
    report.gatedMutations=[];
    const gated=async(name,fn)=>{let error;try{await fn();}catch(e){error=e;}need(error&&/forbidden during replay|input prefix: unsupported mutation/.test(String(error)),name+' reaches the input guard');report.gatedMutations.push({name,message:String(error)});};
    const ring=new SharedArrayBuffer(104),header=new Int32Array(ring,0,10);header[3]=8;header[6]=0x41555247;header[7]=1;header[8]=2;
    for(const[name,fn]of [
      ['keyboard sync',()=>replay.syncKeyboard()],['tablet sync',()=>replay.syncTablet()],['mouse sync',()=>replay.syncMouse()],
      ['agent HELLO',()=>replay.confirmAgentHello()],['upload begin',()=>replay.beginFileUpload(0,'blocked.bin',1,'0'.repeat(64))],
      ['upload cancel',()=>replay.cancelFileUpload(0)],['pointer mode',()=>replay.setInputPointerMode(false)],
      ['download readiness',()=>replay.setFileDownloadReady(true)],['upload dismissal',()=>replay.dismissFileUpload(0)],
      ['download cancellation',()=>replay.cancelFileDownload(0)],['download completion',()=>replay.finishFileDownload(0,true)],
      ['download payload',()=>replay.takeFileDownloadChunk(0)],['download dismissal',()=>replay.dismissFileDownload(0)],
      ['clock mode',()=>replay.setGuestClock('icount')],['clock divider',()=>replay.setICountDivider(10)],
      ['desktop save',()=>replay.saveDesktopSnapshot()],['desktop restore',()=>replay.restoreDesktopSnapshot(new Uint8Array(),640,480)],
      ['ordinary save',()=>replay.saveSnapshot()],['ordinary restore',()=>replay.loadSnapshotBlob(new Uint8Array())],
      ['input witness',()=>replay.captureInputWitness()],['audio output',()=>replay.attachAudioOutput(ring,new SharedArrayBuffer(4),8,48000)],
      ['audio capture',()=>replay.attachAudioCapture(ring,8,48000)],['software checkpoint',()=>replay.captureSoftwareCheckpoint(new Uint8Array())],
      ['stored restore',()=>replay.restoreStoredSnapshot()]])await gated(name,fn);
    need(JSON.stringify(cursor(replay.inputPosition()))===before,'live replay refusals preserve cursor');
    report.replayedBeforeBoundary=replay.inputPosition();
    for(const[name,fn]of [['fractional channel',()=>replay.applyRecordedInput(1.5,'0','23',23,'0',new Uint8Array(),['0','0','0','0'])],
      ['noncanonical cursor',()=>replay.applyRecordedInput(16,'00','23',23,'0',new Uint8Array([0]),['0','0','0','0'])],
      ['wrong sequence',()=>replay.applyRecordedInput(16,'0','25',23,'0',new Uint8Array([0]),['0','0','0','0'])],
      ['outcome shape',()=>replay.applyRecordedInput(16,'0','23',23,'0',new Uint8Array([0]),['0'])]])refuse(name,fn);
    need(JSON.stringify(cursor(replay.inputPosition()))===before,'malformed replay input reserves nothing');
    refuse('outcome divergence stops candidate',()=>replay.applyRecordedInput(16,'0','23',23,'0',new Uint8Array([0]),['1','0','0','0']));
    need(replay.inputPosition().stopped,'divergent candidate stopped');report.divergence=replay.inputPosition();
    output.length=0;bulk=fresh();bulk.runChunk(4096);const bulkInitial=bulk.captureInputWitness();
    writer=await store.writer('input-bulk');const bulkJournal=await SessionInputJournal.createWitness(store,writer,config,bulkInitial.native,bulkInitial.disk,bulkInitial.pending,bulkInitial.output);
    bulk.startInputCapture(false);
    for(let i=0;i<64;i++){const bytes=new Uint8Array(65536).fill(i);bulk.sendInput(bytes);bytes.fill(255);}
    const bulkReceipts=bulk.takeInputDeliveries();need(bulkReceipts.length===64,'bounded same-position bulk offers');
    bulkJournal.stage(bulkReceipts);await bulkJournal.flush();await writer.release();writer=null;
    const bulkSaved=await SessionInputJournal.read(store,'input-bulk');need(bulkSaved.manifest.events.length>1,'record batch splits at chunk byte budget');
    for(let i=0;i<64;i++)need(bulkSaved.receipts[i].bytes.length===65536&&bulkSaved.receipts[i].bytes.every(v=>v===i)
      &&bulkSaved.receipts[i].sequence===String(i+1)&&bulkSaved.receipts[i].ordinal===i+1&&bulkSaved.receipts[i].transition==='0'
      &&bulkSaved.receipts[i].outcome[0]===(i<16?'0':'1'),'bulk order, ownership and actual queue refusal '+i);
    report.bulk={id:'input-bulk',events:64,bytes:4194304,chunks:bulkSaved.manifest.events.length,end:bulkSaved.manifest.end};
    report.status='passed';return report;
  }finally{detach?.();if(writer)await writer.release();if(store)await store.close();bulk?.free();replay?.free();vm?.free();URL.revokeObjectURL(kernelUrl);}
}
