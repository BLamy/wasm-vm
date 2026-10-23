// Re-group authenticated storage pages at recorded state witnesses. Native replay
// cannot continue at a storage-page edge without a committed state digest.
import {gpuCompare as compare,gpuHex,gpuSamePosition as same} from './session-gpu-replay-format.js';

const MAX_ROWS=4096,MAX_BYTES=64*1048576,MAX_BODIES=256;
const need=(ok,message)=>{if(!ok)throw Error('GPU replay window: '+message);};

export async function* gpuReplayWitnessWindows(reader,{start=reader.metadata.begin}={}){
  const metadata=reader.metadata;
  need(compare(start,metadata.begin)>=0&&compare(start,metadata.end)<=0,'start outside authenticated history');
  let receiptCursor=reader.initialEventCursor,witnessCursor=reader.initialWitnessCursor;
  let receiptRows=[],receiptAt=0,receiptBodies=new Map(),receiptWindow=-1;
  let witnessRows=[],witnessAt=0,priorStorage=-1,previousWitness=null,consumed=0;
  const nextWitness=async()=>{
    while(witnessAt===witnessRows.length){
      if(!witnessCursor)return null;
      const page=await reader.nextWitnessWindow(witnessCursor);
      witnessCursor=page.nextCursor;witnessRows=page.rows;witnessAt=0;
    }
    const row=witnessRows[witnessAt++];
    need(!previousWitness||compare(row,previousWitness)>0,'non-increasing witness');
    previousWitness=row;return row;
  };
  const peekReceipt=async()=>{
    while(receiptAt===receiptRows.length){
      if(!receiptCursor)return null;
      const window=await reader.nextReceiptWindow(receiptCursor);
      need(window.index===priorStorage+1&&window.nativeAdmitted===false,'storage window order');
      priorStorage=window.index;receiptWindow=window.index;receiptCursor=window.nextCursor;
      receiptRows=window.receipts;receiptAt=0;
      receiptBodies=new Map(window.payloads.map(body=>[gpuHex(body.sha256),body]));
    }
    return receiptRows[receiptAt];
  };
  let begin;
  while((begin=await nextWitness())&&compare(begin,start)<0){}
  need(begin&&same(begin,start),'start lacks a committed state witness');
  while(await peekReceipt()){
    if(BigInt(receiptRows[receiptAt].sequence)>BigInt(start.sequence))break;
    receiptAt++;consumed++;
  }
  for(let end; (end=await nextWitness());){
    need(compare(end,begin)>0,'non-increasing native replay interval');
    const events=[],bodies=new Map(),storageWindows=new Set();let receiptBytes=0,bodyBytes=0;
    for(let row; (row=await peekReceipt())&&compare(row,end)<=0;){
      const nextBytes=receiptBytes+row.bytes.length,body=row.body;
      let payload;
      if(body){payload=receiptBodies.get(body.sha256);need(payload&&payload.length===Number(body.length),'missing authenticated body');}
      const newBody=body&&!bodies.has(body.sha256);
      need(events.length<MAX_ROWS&&nextBytes<=MAX_BYTES&&bodyBytes+(newBody?payload.length:0)<=MAX_BYTES
        &&bodies.size+Number(!!newBody)<=MAX_BODIES,'witness interval exceeds native replay bounds');
      events.push(row);receiptBytes=nextBytes;storageWindows.add(receiptWindow);
      if(newBody){bodies.set(body.sha256,payload);bodyBytes+=payload.length;}
      receiptAt++;consumed++;
    }
    need(BigInt(end.sequence)===BigInt(begin.sequence)+BigInt(events.length),'witness interval receipt coverage');
    yield {begin,end,events,witnesses:[begin,end],payloads:[...bodies.values()],
      receiptBytes,bodyBytes,storageWindows:[...storageWindows],completedEvents:consumed};
    begin=end;
  }
  need(same(begin,metadata.end)&&!(await peekReceipt())&&consumed===metadata.receipts,
    'final history coverage');
}
