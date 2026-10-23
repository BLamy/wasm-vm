// Short built-browser acceptance of the core/Wasm bounded exact replay handoff. Native tests
// cover the >4096-event and >64-MiB cases; this exercises the actual browser ABI and host queues.
import {WasmLinux} from './pkg/wasm_vm_wasm.js';

const need=(condition,message)=>{if(!condition)throw Error('streamed replay: '+message);};
const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const sameBytes=(a,b)=>a.length===b.length&&a.every((byte,index)=>byte===b[index]);
const bootargs='root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh -- +i';

export async function runSessionStreamedReplayProbe(){
 const artifacts=await (await fetch(new URL('./artifacts.json',import.meta.url))).json();
 const [kernelResponse,manifestResponse]=await Promise.all([
  fetch(new URL(artifacts.artifacts.kernel.url,import.meta.url)),
  fetch(new URL('./session-alpine-image.json',import.meta.url)),
 ]);
 need(kernelResponse.ok&&manifestResponse.ok,'pinned kernel and image manifest');
 const kernel=new Uint8Array(await kernelResponse.arrayBuffer()),manifest=await manifestResponse.text();
 const make=replay=>WasmLinux.newExactSession(kernel,manifest,bootargs,()=>{},replay);
 const original=make(false);
 let initial,middle,final,first,second,queues;
 try{
  initial=original.exactSessionWitness(true);
  const initialQueues=original.exactSessionHostQueues();
  need(!original.runChunk(64).done,'first recorded guest interval');
  first=original.takeExactSessionDeliveries();
  original.sendInput(new Uint8Array([120]));
  first.push(...original.takeExactSessionDeliveries());
  middle=original.exactSessionWitness(false);
  queues=original.exactSessionHostQueues();
  need(queues.pending.length>0,'nonempty host pending queue at the handoff');
  need(!original.runChunk(256).done,'second recorded guest interval');
  second=original.takeExactSessionDeliveries();
  final=original.exactSessionWitness(false);
  const drive=(candidate,end)=>{
   let result;
   for(let calls=0;calls<1000;calls++){
    result=candidate.runExactReplayChunkTo(end,64);
    if(result.reached)return result;
   }
   throw Error('streamed replay: bounded browser replay did not reach endpoint');
  };
  const firstCandidate=()=>{
   const candidate=make(true);
   candidate.beginExactReplay(initial.resume,first,[initial,middle],middle,initialQueues);
   const reached=drive(candidate,middle);
   need(reached.status==='Completed','first native replay window completed');
   need(hex(candidate.exactSessionWitness(false).digest)===hex(middle.digest),'first endpoint native witness');
   return candidate;
  };
  const candidate=firstCandidate();
  let predecessor;
  try{
   predecessor=candidate.exactReplayFrontier();
   const parsed=JSON.parse(predecessor),actualQueues=candidate.exactSessionHostQueues();
   need(parsed.version===1&&parsed.position.sequence===middle.sequence,'first predecessor coordinate');
   need(parsed.stateSha256===hex(middle.digest),'first predecessor state digest');
   need(sameBytes(actualQueues.pending,queues.pending)&&sameBytes(actualQueues.output,queues.output),'full host queue continuity');
   candidate.continueExactReplay(predecessor,second,[middle,final],final,queues);
   const reached=drive(candidate,final);
   need(reached.status==='Completed'&&reached.eventCursor===first.length+second.length,'global event cursor');
   need(hex(candidate.exactSessionWitness(false).digest)===hex(final.digest),'final native witness');
   const finish=JSON.parse(candidate.exactReplayFrontier());
   need(finish.eventCursor===String(first.length+second.length),'final predecessor cursor');
  }finally{candidate.free();}
  const attacks=[];
  for(const [name,edit,pattern] of [
   ['stale-predecessor',value=>[value+' ',queues],/InvalidPlan/],
   ['wrong-pending-queue',value=>[value,{pending:new Uint8Array([...queues.pending,1]),output:queues.output}],/InvalidPlan/],
   ['wrong-output-queue',value=>[value,{pending:queues.pending,output:new Uint8Array([...queues.output,1])}],/InvalidPlan/],
   ['duplicate-window',value=>[value,queues,final,first],/InvalidPlan/],
   ['wrong-endpoint',value=>[value,queues,{...final,transition:String(BigInt(final.transition)+1n)}],/InvalidPlan/],
   ['malformed-shared-queue',value=>[value,{pending:new Uint8Array(new SharedArrayBuffer(1)),output:queues.output}],/ownership/],
  ]){
   const rejected=firstCandidate();
   try{
    const before=hex(rejected.exactSessionWitness(false).digest),receipt=rejected.exactReplayFrontier();
    const [wrongPredecessor,wrongQueues,wrongEnd=final,wrongEvents=second]=edit(receipt);
    let refusal='';try{rejected.continueExactReplay(wrongPredecessor,wrongEvents,[middle,final],wrongEnd,wrongQueues);}catch(error){refusal=String(error);}
    need(pattern.test(refusal),name+' refusal: '+refusal);
    need(hex(rejected.exactSessionWitness(false).digest)===before,name+' did not execute next guest work');
    let stopped='';try{rejected.runExactReplayChunkTo(final,1);}catch(error){stopped=String(error);}
    need(/InvalidPlan|Exhausted|stopped/.test(stopped),name+' poisoned the candidate');
    attacks.push({name,refusal});
   }finally{rejected.free();}
  }
  return {status:'passed',initial:initial.transition,middle:middle.transition,end:final.transition,
   firstEvents:first.length,secondEvents:second.length,finalDigest:hex(final.digest),
   pendingBytes:queues.pending.length,outputBytes:queues.output.length,attacks};
 }finally{original.free();}
}
