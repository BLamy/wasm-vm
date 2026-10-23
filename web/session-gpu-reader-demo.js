// Browser-visible long-history read and private physical replay check.
import {runGpuHistoryReaderRecording} from './gpu-history-reader-probe.js';
import {SessionStore} from './session-store.js';
import {SessionGpuHistoryReader} from './session-gpu-history-reader.js';
import {openGpuTimelineReplay} from './session-gpu-replay.js';
export async function runGpuHistoryReaderDemo({notify=()=>{},signal}={}){
  const recorded=await runGpuHistoryReaderRecording({idPrefix:'bounded-'+crypto.randomUUID(),notify,signal});
  if(recorded.status!=='recorded')throw Error(recorded.cases.find(row=>row.error)?.error??'recording incomplete');
  const store=await SessionStore.open(recorded.database),cases=[];
  try{
    for(const original of recorded.cases){
      await SessionGpuHistoryReader.withOpen(store,original.id,{signal},async reader=>{
        let cursor=reader.initialEventCursor,receipts=0,bytes=0;const windows=[];
        while(cursor){const window=await reader.nextReceiptWindow(cursor);receipts+=window.range.count;bytes+=window.range.ownedReceiptBytes;windows.push({index:window.index,range:window.range,receiptDigest:window.receiptDigest,windowDigest:window.windowDigest});cursor=window.nextCursor;}
        let witnessCursor=reader.initialWitnessCursor,witnesses=0;while(witnessCursor){const page=await reader.nextWitnessWindow(witnessCursor);witnesses+=page.rows.length;witnessCursor=page.nextCursor;}
        if(receipts!==original.receipts||bytes!==original.envelopeBytes||witnesses!==reader.metadata.witnesses||reader.metadata.nativeAdmitted!==false)throw Error('complete storage read differs from recording');
        cases.push({variant:original.variant,receipts,envelopeBytes:bytes,witnesses,windows,begin:reader.metadata.begin,end:reader.metadata.end,resident:reader.resident,storageAuthenticated:true,nativeAdmitted:false});
      });
      const replay=await openGpuTimelineReplay({store,id:original.id,configuration:original.configuration,
        onProgress:message=>notify({variant:original.variant,stage:'replay',message})});
      try{
        const selection=await replay.controller.seekPosition(replay.manifest.end);
        if(selection.status!=='ready'||selection.rendered.digest!==original.final.digest
          ||selection.rendered.replay?.wholeChain!==true
          ||selection.rendered.replay.eventCursor!==original.receipts
          ||selection.rendered.replay.windows<2
          ||replay.events.length!==original.receipts)throw Error('whole-chain GPU replay differs from the recorded history');
        cases.at(-1).replay={status:'passed',position:selection.position,digest:selection.rendered.digest,
          windows:selection.rendered.replay.windows,eventCursor:selection.rendered.replay.eventCursor};
      }finally{replay.controller.close();}
    }
    return {status:'passed',scope:'Complete bounded stored histories and same-machine physical GPU browser replay; full desktop qualification remains separate',
      replay:{status:'passed',cases:cases.map(({variant,replay})=>({variant,...replay}))},cases};
  }finally{await store.close();}
}
