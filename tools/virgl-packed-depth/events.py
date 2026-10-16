#!/usr/bin/env python3
"""Audit actual monotonic native writer, sync ownership and CPU collection events."""
import json,sys
from pathlib import Path
READY={37146,37148}
WRITERS={'drawArrays','blitFramebuffer','clearBufferfv','clearBufferiv','clearBufferuiv','clearBufferfi','texSubImage2D','bufferSubData'}
def need(value,message):
    if not value:raise ValueError(message)
def main(directory):
    directory=Path(directory);totals=dict(runs=0,ownedFences=0,consumedCompletions=0,disposalOnly=0,fencedCpuReads=0,driverSynchronousReads=0);records=[]
    for path in sorted(directory.glob('hardware-*/report.json')):
        envelope=json.loads(path.read_text());need(envelope['status']=='passed','positive event recording');report=envelope['browserResult']['result']
        for index,row in enumerate(report['runs']):
            totals['runs']+=1;events=row['events'];owned={};consumed={};deleted=set()
            for event in events:
                seq=event['sequence'];name=event['name'];sync=event.get('sync')
                if name=='fenceSync':need(sync not in owned,'unique actual sync ownership');owned[sync]=seq
                elif name=='clientWaitSync':
                    need(sync in owned and sync not in deleted and owned[sync]<seq,'poll owned actual sync after creation')
                    if event['delivered'] in READY:need(event['actual'] in READY,'actual physical completion');consumed.setdefault(sync,seq)
                elif name=='deleteSync':need(sync in owned and sync not in deleted,'once-only actual sync retirement');deleted.add(sync)
            need(set(owned)==deleted,'all actual syncs retired once');totals['ownedFences']+=len(owned);totals['consumedCompletions']+=len(consumed);totals['disposalOnly']+=len(owned)-len(consumed)
            writers=[e['sequence'] for e in row['nativeEvents'] if e['name'] in WRITERS]+[e['sequence'] for e in row['uploads']]
            writers += [e['sequence'] for e in events if e['name']=='copyBufferSubData']
            writers += [e['sequence'] for e in row['readbacks'] if e['name']=='readPixels' and e['type']=='PBO']
            for read in row['readbacks']:
                if read['name']=='readPixels' and read['type']=='PBO':continue
                seq=read['sequence'];writer=max((s for s in writers if s<seq),default=0)
                after=[sync for sync,done in consumed.items() if writer<owned[sync]<=done<seq]
                if read['name']=='getBufferSubData':need(after,'CPU PBO collection follows a post-writer consumed actual fence');totals['fencedCpuReads']+=1
                elif after:totals['fencedCpuReads']+=1
                else:need(read['name']=='readPixels' and read['type']!='PBO','synchronous driver readPixels return');totals['driverSynchronousReads']+=1
            need(all(v==0 for v in row['final']['budgets'].values()) and all(o['deleted']==1 for o in row['nativeObjects']),'terminal budgets and once-only native objects')
            records.append(dict(file=path.relative_to(directory).as_posix(),run=index,owned=len(owned),consumed=len(consumed),disposalOnly=len(owned)-len(consumed)))
    need(totals['ownedFences']==totals['consumedCompletions']+totals['disposalOnly'],'separate ownership/completion/disposal accounting')
    result=dict(schema='packed-depth-actual-event-audit-v1',status='passed',totals=totals,records=records);(directory/'event-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(totals))
if __name__=='__main__':main(sys.argv[1])
