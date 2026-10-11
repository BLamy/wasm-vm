#!/usr/bin/env python3
"""Invert original UN16 transfer bytes, native fields and exact public rows."""
import gzip,hashlib,json,math,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'virgl-packed-unsigned-consumer'))
from pixels import packets,word
from lifetimes import audit_lifetimes
sha=lambda raw:hashlib.sha256(raw).hexdigest()

def audit(directory):
    directory=Path(directory);report=json.loads((directory/'report.json').read_text());e=report.get('partial') or report['browserResult']['result']
    assert report['status']=='passed' and report['browserErrors']==dict(console=[],page=[],requests=[])
    refs={r['key']:r for r in e['blobs']};assert len(refs)==len(e['blobs'])
    def load(ref):
        r=refs[ref['key']];assert r['sha256']==ref['sha256'];z=(directory/r['path']).read_bytes();assert sha(z)==r['gzipSha256'];raw=gzip.decompress(z)
        assert sha(raw)==r['sha256'] and len(raw)==r['bytes'];return raw
    counts=dict(runs=0,nativePixels=0,publicBytes=0,syncs=0,polls=0,cpuReads=0,fencedCPUReads=0,synchronousCPUReads=0,privateViews=0,synchronousReads=0,stagedReads=0)
    def native(raw,pred,width,height):
        count=width*height;assert len(raw)==count*20 and len(pred)==count*2
        for i in range(count):
            original=struct.unpack_from('<H',pred,i*2)[0];actual,*constants=struct.unpack_from('<4I',raw,i*16);expected=word(original/65535)
            assert actual<=0x3f800000 and abs(actual-expected)<=1,(i,original,actual,expected)
            assert constants==[0,0,1]
        assert raw[count*16:]==bytes(count*4);counts['nativePixels']+=count
    for run in e['runs']:
        counts['runs']+=1;meta=run['source'];
        if run['kind']=='budget-refusal':
            assert meta['format']==16 and (meta['width'],meta['height'],meta['lastLevel'])==(13,7,2)
            cost=sum(max(1,meta['width']>>level)*max(1,meta['height']>>level)*2 for level in range(3));private=cost-meta['width']*meta['height']*2;read=meta['width']*meta['height']*4;phase=run['phase']
            limits={'scratchBytes':read-1} if phase=='scratch' else {'gpuBytes':cost-1 if phase=='resource' else cost+private-1 if phase=='view' else cost+read*2-1}
            assert run['limits']==limits and run['before']==run['after'] and run['result']['error']['code']=='limit-exceeded'
            assert run['before']['gpuBytes']==(0 if phase=='resource' else cost) and run['nativeObjectsBefore']==run['nativeObjectsAfter'] and run['allocationsBefore']==run['allocationsAfter'] and run['readsBefore']==run['readsAfter']==0
            if phase in ['scratch','staging']:
                op,kind,w,raw=next(packets(run['wire']));assert op==43 and w[0]==6 and w[1]==0 and w[8:11]==[13,7,1] and w[12]==2
                assert run['before']['scratchBytes']==(read if phase=='staging' else 0)
            for key,value in audit_lifetimes(run).items():counts[key]+=value
            assert run['final']['async']['stagingBytes']==0;continue
        if run['kind']=='allocation-failure':
            assert run['result']['error']['code']=='backend-error' and run['badProfile']['error']['code']=='invalid-input' and run['before']==run['after']
            last=run['allocations'][-1];cost=last['metadata']['gpuByteLength'];assert last['atAllocation']['gpuBytes']==run['before']['gpuBytes']+cost
            for key,value in audit_lifetimes(run).items():counts[key]+=value
            assert run['final']['async']['stagingBytes']==0;continue
        assert meta['format']==16 and meta['bind'] in [1,8,9]
        original=load(run['sourceBacking']);wanted=bytearray([0xa7]*len(original));planes={}
        for p in run['planes']:
            raw=load(p['input']);level=p['level'];w=max(1,meta['width']>>level);h=max(1,meta['height']>>level)
            assert (p['width'],p['height'],len(raw))==(w,h,w*h*2)
            for y in range(h):wanted[p['offset']+y*p['stride']:p['offset']+y*p['stride']+w*2]=raw[y*w*2:(y+1)*w*2]
            planes[level]=dict(p,raw=raw);native(load(p['native']),raw,w,h)
        assert wanted==original and set(planes)==set(range(meta['lastLevel']+1))
        expected={level:bytearray(p['raw']) for level,p in planes.items()}
        for op in run['operations']:
            opcode,kind,w,raw=next(packets(op['wire']));assert opcode in [9,43] and w[0]==6
            p=planes[w[1]];assert w[3]==p['stride'] and w[5:11]==[0,0,0,p['width'],p['height'],1]
            layout=op['layout'];assert layout['rowBytes']==p['width']*2 and layout['tightBytes']==p['width']*p['height']*2
            assert layout['scratchBytes']==layout['tightBytes']
            if opcode==9:
                payload=raw[48:]
                for y in range(p['height']):assert payload[y*w[3]:y*w[3]+p['width']*2]==p['raw'][y*p['width']*2:(y+1)*p['width']*2]
            else:assert w[11]==p['offset'] and w[12]==1
            assert op['afterPrepare']['scratchBytes']-op['before']['scratchBytes']==layout['scratchBytes']
            assert op['after']['scratchBytes']==op['before']['scratchBytes'] and op['after']['tickets']==op['before']['tickets']
        for patch in run['patches']:
            op,kind,w,raw=next(packets(patch['wire']));assert op==9 and w[0]==6
            data=load(patch['input']);p=planes[w[1]];assert w[5:11]==[patch['x'],patch['y'],0,patch['width'],patch['height'],1]
            for y in range(patch['height']):
                row=data[y*patch['width']*2:(y+1)*patch['width']*2];assert raw[48+y*w[3]:48+y*w[3]+len(row)]==row
                at=((patch['y']+y)*p['width']+patch['x'])*2;expected[w[1]][at:at+len(row)]=row
            native(load(patch['native']),expected[w[1]],p['width'],p['height'])
        for view in run['views']:
            assert view['caller']['before']==view['caller']['after'];assert view['first']<=view['last']<=meta['lastLevel']
            assert view['metadata']['format']==16 and view['metadata']['unormDepth'] is True
            assert view['metadata']['gpuByteLength']==sum(len(expected[level]) for level in range(view['first'],view['last']+1))
            cost=0 if view['first']==0 and view['last']==meta['lastLevel'] else view['metadata']['gpuByteLength']
            assert view['afterCapture']['gpuBytes']-view['beforeCapture']['gpuBytes']==cost and view['afterRelease']['gpuBytes']==view['beforeCapture']['gpuBytes']
            for p in view['planes']:
                assert p['original']==view['first']+p['local'];native(load(p['native']),expected[p['original']],p['width'],p['height'])
            counts['privateViews']+=1
        if 'leaseRead' in run:
            assert run['leaseRead']['caller']['before']==run['leaseRead']['caller']['after'] and load(run['leaseRead']['bytes'])==expected[0];counts['synchronousReads']+=1
        for point in run['clears']:
            p=planes[point['level']];scaled=point['depth']*65535;allowed={math.floor(scaled),math.ceil(scaled)}
            raw=load(point['native']);z=struct.unpack_from('<f',raw)[0];chosen=math.floor(z*65535+.5)
            assert chosen in allowed and chosen==point['chosenNativeWord'];assert set(point['allowedOriginalWords'])==allowed
            assert load(point['backingBefore'])==load(point['backingAfter'])==original
            # Predictions come from the primary rule before examining native data;
            # public bytes below must exactly match this validated native choice.
            expected[point['level']]=bytearray(struct.pack('<H',chosen)*(p['width']*p['height']))
            native(raw,expected[point['level']],p['width'],p['height'])
            events=[event for event in run['events'] if event['name']=='clearBufferfv' and event['args'][0]==6145]
            assert any(event['args'][2]==[point['depth']] for event in events)
        staged=bytearray(load(run['stagingBacking']));wanted=bytearray(original)
        for row in run['publicReads']:
            op,kind,w,raw=next(packets(row['wire']));assert op==43 and w[0]==6 and w[12]==2;p=planes[w[1]];assert row['caller']['before']==row['caller']['after']
            for y in range(p['height']):wanted[w[11]+y*w[3]:w[11]+y*w[3]+p['width']*2]=expected[w[1]][y*p['width']*2:(y+1)*p['width']*2]
            assert load(row['backing'])==wanted;counts['publicBytes']+=len(wanted);counts['synchronousReads']+=1
            for read in row['reads']:
                op,kind,rw,raw=next(packets(read['wire']));assert op in [43,45] and rw[0]==6
                assert load(read['bytes'])==expected[rw[1]];layout=read['layout'];pixels=p['width']*p['height']
                assert layout['nativeReadBytes']==layout['scratchBytes']==layout['conversionBytes']==pixels*4 and layout['stagingBytes']==pixels*8
                assert read['afterPrepare']['scratchBytes']-read['before']['scratchBytes']==pixels*4
                assert read['afterIssue']['stagingBytes']-read['before']['stagingBytes']==pixels*8
                assert read['afterRelease']['stagingBytes']==read['before']['stagingBytes'] and read['afterRelease']['scratchBytes']==read['before']['scratchBytes']
                if op==45:
                    assert rw[11]==8 and rw[13]==3
                    for y in range(p['height']):staged[rw[12]+y*rw[3]:rw[12]+y*rw[3]+p['width']*2]=expected[rw[1]][y*p['width']*2:(y+1)*p['width']*2]
                counts['stagedReads']+=1
        assert load(run['finalBacking'])==wanted and load(run['finalStagingBacking'])==staged
        counts['publicBytes']+=len(wanted)+len(staged)
        for key,value in audit_lifetimes(run).items():counts[key]+=value
        assert run['final']['async']['stagingBytes']==0
    result=dict(schema='original-unorm-depth-transfer-inverse-v1',status='passed',oracleImportsProductCode=False,counts=counts)
    (directory/'value-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));return result

if __name__=='__main__':audit(sys.argv[1])
