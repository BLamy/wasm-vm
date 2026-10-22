// The unchanged T01 workload's exact UART offers. This is qualification tooling,
// not a recorder, guest program, renderer, or benchmark result.
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),max=(1n<<64n)-1n;
const need=(ok,why)=>{if(!ok)throw Error('frozen workload: '+why);};
const exact=value=>{need(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&BigInt(value)<=max,'unsigned coordinate');return BigInt(value);};
const bytes=value=>{need(value instanceof Uint8Array||Array.isArray(value),'owned offer bytes');const copy=Uint8Array.from(value);need(copy.length<=4096&&[...value].every((v,i)=>Number.isInteger(v)&&v>=0&&v<=255&&v===copy[i]),'offer byte bound');return copy;};
export function frozenWorkloadSchedule(contract){
 const work=contract?.workload,s=work?.schedule;
 need(work?.seed===17&&s?.input_frames===100&&s.input_transition_offsets?.first===500000&&s.input_transition_offsets.stride===500000&&s.rewrites===10&&s.rewrite_every_frame===10&&s.http_responses===10&&s.http_response_bytes===1024,'original amounts');
 need(typeof work.input_frame_template==='string'&&work.input_frame_template.split('FRAME_INDEX').length===2&&typeof work.rewrite_command==='string'&&work.rewrite_command.split('INDEX').length===2,'original template tokens');
 return Array.from({length:100},(_,offset)=>{
  const index=offset+1,rewriteIndex=index%10===0?index/10:null;
  const text=work.input_frame_template.replace('FRAME_INDEX',String(index))+'\n'+(rewriteIndex===null?'':work.rewrite_command.replace('INDEX',String(rewriteIndex))+'\n');
  const payload=encoder.encode(text);need(payload.length>0&&payload.length<=4096,'payload bound');
  return {index,offset:String(500000*index),rewriteIndex,text,bytes:payload};
 });
}
export function scheduledTransition(origin,offset){const start=exact(origin),delta=exact(offset);need(start+delta<=max,'target overflow');return String(start+delta);}
export function verifyFrozenWorkloadOffers(contract,origin,receipts){
 need(Array.isArray(receipts),'receipt list');exact(origin);const plan=frozenWorkloadSchedule(contract);
 // UART offer channel 1 is authoritative. FIFO feed slices (channel 2), setup
 // RPC commands and auxiliary display/probe controls have separate ledgers.
 const actual=receipts.filter(row=>row.channel===1&&decoder.decode(bytes(row.bytes)).startsWith("printf 'E9_INPUT_%03d"));
 need(actual.length===100,'exactly 100 scheduled offers');let sequence=-1n;
 for(let i=0;i<100;i++){
  const row=actual[i],frame=plan[i],payload=bytes(row.bytes),target=scheduledTransition(origin,frame.offset);
  need(row.transition===target&&row.phase==='before','frame '+frame.index+' absolute transition');
  need(decoder.decode(payload)===frame.text,'frame '+frame.index+' literal payload');
  need(Array.isArray(row.outcome)&&row.outcome.length===4&&row.outcome[0]==='0'&&row.outcome[1]===String(payload.length)&&row.outcome[2]===String(payload.length)&&row.outcome[3]==='0','frame '+frame.index+' accepted in full');
  const next=exact(row.sequence);need(next>sequence,'scheduled source order');sequence=next;
  exact(row.retired);need(Number.isInteger(row.ordinal)&&row.ordinal>=0&&row.ordinal<=0xffffffff,'source ordinal');
 }
 return {offers:actual.length,rewrites:plan.filter(row=>row.rewriteIndex!==null).length,origin,first:actual[0].transition,last:actual.at(-1).transition};
}

// Qualifying the scheduled subset never authorizes unexplained other input.
// The caller seals each known setup/auxiliary producer before execution and
// associates its native offer at collection time; an independent artifact
// reader supplies its own SHA-256 function for these byte identities.
export function verifyUartActivityLedger(contract,origin,receipts,ledger,digest){
 const scheduled=verifyFrozenWorkloadOffers(contract,origin,receipts);
 need(Array.isArray(ledger)&&ledger.length<=65536&&typeof digest==='function','UART ledger bound/hasher');
 const offers=receipts.filter(row=>row.channel===1);need(ledger.length===offers.length,'complete UART ledger union');
 const kinds=new Set(['setup','advance','terminal-reply','scheduled','network-setup','probe-transfer','probe-inspection','probe-invoke','file-witness','guest-inspection']);
 const bySequence=new Map(),counts={};
 for(const entry of ledger){need(kinds.has(entry.kind)&&entry.channel===1,'known UART producer');exact(entry.sequence);need(!bySequence.has(entry.sequence),'disjoint UART ledger');bySequence.set(entry.sequence,entry);counts[entry.kind]=(counts[entry.kind]??0)+1;}
 for(const row of offers){
  const entry=bySequence.get(row.sequence);need(entry,'classified UART offer');
  need(['transition','retired','sequence','phase','ordinal'].every(key=>entry[key]===row[key]),'UART ledger coordinate');
  const payload=bytes(row.bytes),hash=digest(payload);need(typeof hash==='string'&&/^[0-9a-f]{64}$/.test(hash)&&entry.sha256===hash&&entry.bytes===payload.length,'UART ledger byte identity');
  need((entry.kind==='scheduled')===decoder.decode(payload).startsWith("printf 'E9_INPUT_%03d"),'scheduled/auxiliary partition');
 }
 need(counts.scheduled===scheduled.offers,'scheduled ledger total');
 return {total:offers.length,scheduled:scheduled.offers,auxiliary:offers.length-scheduled.offers,byKind:counts};
}
