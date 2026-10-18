// Actual RV64 RTC/RNG reads, pause and WFI, replayed without either live host provider.
import {SessionSourceProbe} from './pkg/wasm_vm_wasm.js';
import {checkpointHash} from './session-checkpoints.js';
const need=(ok,why)=>{if(!ok)throw Error('time/entropy: '+why);};
const equal=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const own=r=>({...r,bytes:r.bytes.slice(),outcome:[...r.outcome]});
const canonical=rows=>JSON.stringify(rows.map(r=>[r.transition,r.phase,r.ordinal,r.sequence,r.retired,r.channel,r.outcome,[...r.bytes]]));
function entries(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint32(28,true);let at=32;const out=[];
 for(let i=0;i<count;i++){const length=view.getUint32(at+34,true);out.push({at,kind:bytes[at+28],requested:view.getUint32(at+30,true),length,data:at+38});at+=38+length;}
 need(at===bytes.length,'independent observation tape layout');return out;
}
export async function runTimeEntropyProbe({onPaused,recordQuantum=17}={}){
 const program=new Uint8Array(await(await fetch(new URL('./assets/e9-time-entropy.bin',import.meta.url))).arrayBuffer());
 const meta=await(await fetch(new URL('./assets/e9-time-entropy.json',import.meta.url))).json();
 need(program.length===meta.bytes&&checkpointHash(program)===meta.sha256,'declared guest bytes');
 const report={status:'running',scope:'RTC/entropy source adapter replay on the fixed real guest. Full Linux provider replay remains gated by completion/network adapters.',program:meta,refusals:[],replays:[]};
 let record;
 const drain=(probe,rows)=>rows.push(...probe.takeDeliveries().map(own));
 const drive=async(probe,target,quantum,rows)=>{
  let calls=0;while(BigInt(probe.position().transition)<BigInt(target)){
   probe.runUntil(target,quantum);drain(probe,rows);need(++calls<2048,'bounded fixture execution');
   if(calls%64===0)await Promise.resolve();
  }
 };
 const apply=(probe,r)=>probe.applyRecordedLifecycle(r.bytes[0],r.transition,r.sequence,r.ordinal,r.retired);
 try{
  record=new SessionSourceProbe(5,undefined,0);const receipts=[];
  report.policy=record.policy();report.initialFrame=record.frame();
  record.control(1);drain(record,receipts);await drive(record,meta.pauseTransition,recordQuantum,receipts);
  record.control(0);drain(record,receipts);report.pausedFrame=record.frame();const reads=record.hostReads(),before=performance.now();
  if(onPaused)await onPaused();else await sleep(160);
  const elapsed=performance.now()-before;if(elapsed<150)await sleep(150-elapsed);
  need(equal(record.frame(),report.pausedFrame),'pause/background changed guest state');need(JSON.stringify(record.hostReads())===JSON.stringify(reads),'pause sampled a guest provider');
  report.pause={milliseconds:performance.now()-before,hostReads:reads,position:record.position()};
  record.control(1);drain(record,receipts);await drive(record,meta.endTransition,recordQuantum,receipts);record.control(0);record.control(2);drain(record,receipts);
  report.finalFrame=record.frame();report.tape=record.observationTape();report.guestBytes=record.guestBytes();report.trace=record.traceText();report.receipts=receipts;report.position=record.position();report.hostReads=record.hostReads();
  need(report.guestBytes.length===113&&report.guestBytes[48]===0,'actual guest report and RTC alarm');need(report.hostReads.entropy===2,'two actual Web Crypto fills');
  const rtc=receipts.filter(r=>r.channel===17),rng=receipts.filter(r=>r.channel===18);need(rtc.length===report.hostReads.rtc&&rng.length===2,'all external source samples have receipts');
  need(rng.map(r=>r.bytes.length).join(',')==='16,33','actual entropy lengths');need(rtc.some(r=>r.outcome[1]==='5'),'alarm polling captured');
  const controls=receipts.filter(r=>r.channel===16);need(controls.length===5,'resume, pause/background, resume, pause, stop');
  for(const quantum of [1,7,64]){
   const owned=report.tape.slice(),replay=new SessionSourceProbe(5,owned,3),rows=[];owned.fill(255);
   try{
    need(equal(replay.frame(),report.initialFrame),'replay initial frame');
    for(const control of controls){await drive(replay,control.transition,quantum,rows);apply(replay,control);drain(replay,rows);
     if(control.bytes[0]===0&&control.transition===meta.pauseTransition)need(equal(replay.frame(),report.pausedFrame),'replay paused frame');}
    replay.finishReplay();const frame=replay.frame(),bytes=replay.guestBytes(),trace=replay.traceText(),hostReads=replay.hostReads();
    need(equal(frame,report.finalFrame)&&equal(bytes,report.guestBytes)&&trace===report.trace&&canonical(rows)===canonical(receipts),'exact guest/frame/observation replay');need(hostReads.rtc===0&&hostReads.entropy===0,'replay consulted a live provider');
    let liveError;const position=JSON.stringify(replay.position());try{replay.control(0);}catch(error){liveError=error;}need(liveError&&/forbidden/.test(liveError.message)&&JSON.stringify(replay.position())===position,'live replay control refusal');
    report.replays.push({quantum,frame,guestBytes:bytes,trace,hostReads,position:replay.position(),receipts:rows});
   }finally{replay.free();}
  }
  const reject=async(name,tape,code,divider=5)=>{
   let probe,failure,rows=[];
   try{probe=new SessionSourceProbe(divider,tape,3);
    for(const control of controls){await drive(probe,control.transition,7,rows);apply(probe,control);drain(probe,rows);}probe.finishReplay();
   }catch(error){failure=error;if(probe)drain(probe,rows);}
   try{need(failure?.name==='SessionDivergence'&&failure.code===code,name+' typed divergence');
    const hostReads=probe?.hostReads();need(!hostReads||hostReads.rtc===0&&hostReads.entropy===0,name+' called a live provider');
    report.refusals.push({name,tape:tape.slice(),code:failure.code,message:failure.message,point:failure.position??null,position:probe?.position()??null,hostReads,receipts:rows});
   }finally{probe?.free();}
  };
  await reject('clock policy mismatch',report.tape,'ClockPolicyMismatch',6);
  const empty=report.tape.slice(0,32);new DataView(empty.buffer).setUint32(28,0,true);await reject('exhausted source log',empty,'MissingRecord');
  const layout=entries(report.tape),entropy=layout.find(r=>r.kind===6);
  const malformed=report.tape.slice();new DataView(malformed.buffer).setUint32(entropy.at+30,15,true);await reject('malformed entropy length',malformed,'MalformedObservation');
  const short=new Uint8Array(report.tape.length-1);short.set(report.tape.subarray(0,entropy.data+15));short.set(report.tape.subarray(entropy.data+16),entropy.data+15);const sv=new DataView(short.buffer);sv.setUint32(entropy.at+30,15,true);sv.setUint32(entropy.at+34,15,true);await reject('different requested entropy length',short,'Length');
  const kind=report.tape.slice();kind[layout[0].at+28]=5;await reject('misordered RTC call intent',kind,'Kind');
  const position=report.tape.slice(),pv=new DataView(position.buffer);pv.setBigUint64(layout[0].at,pv.getBigUint64(layout[0].at,true)+1n,true);await reject('wrong observation transition',position,'Position');
  const extra=new Uint8Array(report.tape.length+46);extra.set(report.tape);const ev=new DataView(extra.buffer);ev.setUint32(28,layout.length+1,true);let at=report.tape.length;ev.setBigUint64(at,BigInt(meta.endTransition)+1n,true);ev.setBigUint64(at+8,BigInt(meta.endTransition),true);ev.setBigUint64(at+16,BigInt(report.position.sequence)+1n,true);ev.setUint32(at+24,1,true);extra[at+28]=1;ev.setUint32(at+30,8,true);ev.setUint32(at+34,8,true);await reject('unconsumed source log tail',extra,'ExtraRecords');
  report.unavailable=[];
  for(const hostMode of [1,2]){
   const failed=new SessionSourceProbe(5,undefined,hostMode);let failure,rows=[];
   try{failed.control(1);drain(failed,rows);try{await drive(failed,meta.pauseTransition,7,rows);}catch(error){failure=error;drain(failed,rows);}
    need(failure?.name==='SessionDivergence'&&failure.code==='ProviderUnavailable','provider failure typed');need(rows.at(-1).channel===(hostMode===1?17:18)&&rows.at(-1).outcome[0]==='1','failed provider identity');const tape=failed.observationTape();const replay=new SessionSourceProbe(5,tape,3);let replayError,replayed=[];
    try{apply(replay,rows.find(r=>r.channel===16));drain(replay,replayed);try{await drive(replay,meta.pauseTransition,31,replayed);}catch(error){replayError=error;drain(replay,replayed);}
     need(replayError?.code==='ProviderUnavailable'&&canonical(replayed)===canonical(rows),'recorded provider failure replay');need(replay.hostReads().rtc===0&&replay.hostReads().entropy===0,'failure replay reached a provider');
     report.unavailable.push({hostMode,tape,receipts:rows,hostReads:failed.hostReads(),replayHostReads:replay.hostReads(),point:failure.position,replayPoint:replayError.position});
    }finally{replay.free();}
   }finally{failed.free();}
  }
  report.status='passed';return report;
 }finally{record?.free();}
}
