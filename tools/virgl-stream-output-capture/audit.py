"""Reopen complete original DMA bodies and actual native feedback/copy recordings."""
import gzip,json,sys
from pathlib import Path
root=Path(sys.argv[1]);counts={'layouts':0,'primitiveRows':0,'phases':0,'readbacks':0,'nativeCaptures':0,'nativeCopies':0,'physicalRefutations':0}
for mode in ['layouts','primitives','retirement','scatter-fault','selected-regression']:
    p=root/mode;r=json.loads((p/'report.json').read_text());assert not any(r['browserErrors'].values())
    assert r['status']==('failed' if mode=='scatter-fault' else 'passed')
    rows=[]
    for pin in r['runs']:
        body=gzip.decompress((p/pin['path']).read_bytes());import hashlib
        assert len(body)==pin['bytes'] and hashlib.sha256(body).hexdigest()==pin['sha256'];rows.append(json.loads(body))
    if not rows: rows=r['browserResult'].get('result',{}).get('rows',[])
    for row in rows:
        if mode=='selected-regression':continue
        calls=row['calls'];active=False;captured=set();read=None;write=None;feedbacks=set();deleted=set();captures=0;copies=0
        for call in calls:
            method=call['method'];args=call['args'];out=call.get('result')
            if method=='createTransformFeedback' and out:feedbacks.add(out['object'])
            if method=='deleteTransformFeedback' and args[0]:deleted.add(args[0]['object'])
            if method=='bindBufferBase' and args[0]==0x8c8e and args[2]:captured.add(args[2]['object'])
            if method=='beginTransformFeedback':assert not active and args==[0];active=True;captures+=1
            if method=='endTransformFeedback':assert active;active=False
            if method in ['drawElements','drawElementsInstanced']:assert not active
            if method=='drawArrays' and active:assert args[0]==0 and args[1]>=0 and args[2]>0
            if method=='bindBuffer':
                if args[0]==0x8f36:read=args[1]['object'] if args[1] else None
                if args[0]==0x8f37:write=args[1]['object'] if args[1] else None
            if method=='copyBufferSubData' and read in captured:
                assert not active and write is not None and write not in captured;assert args[2]>=0 and args[3]>=0 and args[4]>0;copies+=1
        assert not active and feedbacks==deleted and captures>0 and copies>0
        counts['nativeCaptures']+=captures;counts['nativeCopies']+=copies
        if mode=='layouts':
            assert row['status']=='passed' and len(row['actual'])==len(row['expected'])
            for actual,expected in zip(row['actual'],row['expected']):assert actual['bytes']==expected['bytes'];counts['readbacks']+=1
            counts['layouts']+=1
        elif mode=='retirement':
            for phase in row['phases']: assert phase['actual']==phase['expected']
            if row.get('physicalOldRead'): assert row['physicalOldRead']['actual']==row['physicalOldRead']['expected']
        else:
            counts['primitiveRows']+=1
            for phase in row['phases']:
                assert phase.get('completedOriginalReadbacks')==len(phase['actual'])
                counts['phases']+=1;counts['readbacks']+=len(phase['actual'])
                if mode=='scatter-fault':
                    assert phase['actual']!=phase['expected'];counts['physicalRefutations']+=1
                else:assert phase['actual']==phase['expected']
        assert len(row['machineDigest'])==64 and row['guestTrace']['records'] and row['cleaned']['liveObjects']==0 and row['cleaned']['liveSyncs']==0
assert counts['layouts']==480 and counts['primitiveRows']==4 and counts['physicalRefutations']==1
(root/'audit.json').write_text(json.dumps({'status':'passed','counts':counts},indent=2)+'\n');print(json.dumps(counts))
