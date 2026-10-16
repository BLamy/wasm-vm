#!/usr/bin/env python3
"""Authenticate complete original RGB9E5, native, public and helper planes."""
import gzip,hashlib,json,struct,sys
from pathlib import Path
from importlib.util import spec_from_file_location,module_from_spec
_spec=spec_from_file_location('rational_shared',Path(__file__).with_name('standard-shared-exponent-scalars.py'))
scalar=module_from_spec(_spec);_spec.loader.exec_module(scalar)
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def blob(directory,entry):
    name=entry.get('path',entry['key']+'.bin.gz');assert name==entry['key']+'.bin.gz'
    packed=(directory/name).read_bytes();assert sha(packed)==entry['gzipSha256']
    raw=gzip.decompress(packed);assert len(raw)==entry['bytes'] and sha(raw)==entry['sha256'];return raw
def dense(backing,plane):
    rowbytes=plane['width']*4
    return b''.join(backing[plane['offset']+y*plane['stride']:plane['offset']+y*plane['stride']+rowbytes] for y in range(plane['height']))
def generated_words(run):
    seed=run['seed']&0xffffffff;result={};fields=run.get('fields',False)
    fixtures=[0,31<<27,1,1<<9,1<<18,0xffffffff,17|33<<9|7<<18|9<<27,511|255<<9|1<<18|16<<27,127|63<<9|15<<18|24<<27]
    for plane in run['planes']:
        level=plane['level'];words=[]
        for i in range(plane['width']*plane['height']):
            if fields and level==0 and i<49152:
                e=i//1536;lane=i//512%3;m=i%512;lanes=[256,271,333];lanes[lane]=m;word=lanes[0]|lanes[1]<<9|lanes[2]<<18|e<<27
            elif i<9:word=fixtures[(i+level)%len(fixtures)]
            else:
                seed^=seed<<13&0xffffffff;seed^=seed>>17;seed^=seed<<5&0xffffffff;seed&=0xffffffff;word=seed
            words.append(word)
        result[level]=b''.join(struct.pack('<I',word) for word in words)
    return result
def original_parts(directory,run):
    raw={p['level']:blob(directory,p['input']) for p in run['planes']};assert raw==generated_words(run),'independently generated original fields and varied seeds'
    backing=blob(directory,run['backing'])
    for plane in run['planes']:assert dense(backing,plane)==raw[plane['level']]
    return raw,backing
def public(directory,run,label,original,entry):
    output=blob(directory,entry);wanted=scalar.canonical_bytes(original);assert output==wanted,(label,'complete canonical original public words')
    native=next(blob(directory,row['bytes']) for row in run['readbacks'] if row['label']==label and row['bytes'] and row['name'] in ('readPixels','getBufferSubData'))
    # Frozen native recordings run on the explicitly pinned little-endian M4.
    assert native==wanted,(label,'native GPU-packed words already match original rational inverse')
    return len(wanted)
def pixel_meta(meta):
    assert meta['format']==125 and meta['bind']==8 and meta['sharedExponent'] is True
    pixels=[max(1,meta['width']//2**level)*max(1,meta['height']//2**level) for level in range(meta['lastLevel']+1)]
    assert meta['byteLength']==meta['gpuByteLength']==sum(pixels)*4
    for level,p in enumerate(meta.get('levels',[])):assert p==dict(level=level,width=max(1,meta['width']//2**level),height=max(1,meta['height']//2**level),byteLength=pixels[level]*4,gpuByteLength=pixels[level]*4)
    return 2+len(pixels)
def footprints(run):
    checks=0;allocations={row['texture']:row for row in run['allocations'] if row['metadata']['format']==125}
    for allocation in allocations.values():
        meta=allocation['metadata'];checks+=pixel_meta(meta)
        if allocation['copyScratch']:
            helper=allocation['copyScratch'];assert helper['width']==meta['width'] and helper['height']==meta['height'];assert meta['sharedCopyScratchBytes']==helper['width']*helper['height']*8
            stages=[e for e in run['nativeEvents'] if e['name']=='texStorage2D' and e.get('texture')==helper['texture']];assert len(stages)==1 and stages[0]['args'][1:]==[1,32856,helper['width'],helper['height']]
            buffers=[e for e in run['nativeEvents'] if e['name']=='bufferData' and e.get('buffer')==helper['buffer']];assert len(buffers)==1 and buffers[0]['args'][1]==helper['width']*helper['height']*4
            checks+=6
    for event in run['nativeEvents']:
        if event['name']=='texStorage2D' and event.get('texture') in allocations:
            meta=allocations[event['texture']]['metadata'];assert event['args'][1:]==[meta['lastLevel']+1,35901,meta['width'],meta['height']];checks+=4
    for op in run['operations']:
        words=struct.unpack('<'+'I'*(len(bytes.fromhex(op['wire']))//4),bytes.fromhex(op['wire']));layout=op['layout'];assert words[0]&255==43 and words[0]>>16==13 and len(words)==14
        rowbytes=words[9]*4;rows=words[10];assert layout['rowBytes']==rowbytes and layout['rowCount']==rows and layout['rowStride']==words[4] and layout['offset']==words[12]
        assert layout['scratchBytes']==rowbytes*rows and layout['stagingBytes']==0 and layout['conversionBytes']==0 and layout['tightBytes']==rowbytes*rows and layout['direction']=='upload';checks+=10
    for read in run['readbacks']:
        if read['name']=='readPixels' and read['label']!='independent-shared-diagnostic':
            wrong=run.get('nativeFault')=='read'
            assert read['args'][4:6]==([6402,5121] if wrong else [6408,5121])
            assert read['type'] in ('Uint8Array','PBO')
            if read['bytes']:assert read['bytes']['bytes']==read['args'][2]*read['args'][3]*4
            checks+=3
    return checks
def patched(original,run,directory,level):
    patch=run.get('patch');wanted=bytearray(original[level])
    if patch and patch['level']==level:
        raw=blob(directory,patch['input']);plane=next(p for p in run['planes'] if p['level']==level)
        for y in range(patch['height']):
            at=((patch['y']+y)*plane['width']+patch['x'])*4;count=patch['width']*4;wanted[at:at+count]=raw[y*count:(y+1)*count]
    return bytes(wanted)
def audit(directory,run,totals):
    originals,backing=original_parts(directory,run);totals['originalInputBytes']+=sum(map(len,originals.values()));totals['footprintChecks']+=footprints(run)
    for plane in run['planes']:
        if 'observed' in plane:totals['nativeComponents']+=scalar.compare(originals[plane['level']],blob(directory,plane['observed']['native']),'original-complete-native-source')
    for view in run.get('views',[]):
        assert view['metadata']['lastLevel']==view['lastLevel']-view['firstLevel']
        for plane in view['planes']:totals['nativeComponents']+=scalar.compare(originals[plane['original']],blob(directory,plane['native']),'original-complete-private-local-mips')
    for transfer in run.get('transfers',[]):
        level=transfer['level'];totals['publicBytes']+=public(directory,run,'original-float-sync-read-'+str(level),originals[level],transfer['sync'])
        for read in transfer['reads']:
            totals['publicBytes']+=public(directory,run,'original-float-staged-'+str(read['opcode'])+'-'+str(level),originals[level],read['nativeBytes']);assert read['fence']['actual'] in (37146,37148) and read['fence']['delivered'] in (37146,37148)
            layout=read['layout'];assert layout['scratchBytes']==len(originals[level]) and layout['stagingBytes']==2*len(originals[level]) and layout['conversionBytes']==len(originals[level])
    for obs in run.get('observations',[]):
        assert obs['fence']['actual'] in (37146,37148) and obs['fence']['delivered'] in (37146,37148)
        if obs['kind']=='retained-old-read':
            raw=blob(directory,obs['native']);assert raw==scalar.canonical_bytes(originals[0]);totals['publicBytes']+=len(raw)
        else:
            wanted=blob(directory,obs['clearInput']) if 'clearInput' in obs else patched(originals,run,directory,obs['original']);totals['nativeComponents']+=scalar.compare(wanted,blob(directory,obs['native']),obs['kind'])
    if run.get('kind')=='retained-native-range':assert blob(directory,run['backingAfterRefresh'])==backing,'GPU-only source update leaves all CPU backing bytes unchanged'
    if run.get('kind')=='read-budget':
        short=run['boundary'].endswith('short');synchronous=run['boundary'].startswith('conversion');assert run['start']['ok']==(not short)
        assert run['foreignLease']['error']['code']=='invalid-lease';assert run['queued']['owner']['budgets']['scratchBytes']==(0 if short or synchronous else 60);assert run['queued']['async']['stagingBytes']==(0 if short or synchronous else 120)
        if short:assert run['start']['error']['code']=='limit-exceeded'
        else:
            raw=blob(directory,run['read']['nativeBytes']);assert raw==scalar.canonical_bytes(originals[0]);totals['publicBytes']+=len(raw);assert run['read']['fence']['actual'] in (37146,37148) and run['read']['fence']['delivered'] in (37146,37148)
    if run.get('kind')=='private-budget':
        short=run['boundary'].endswith('short');assert run['capture']['ok']==(not short)
        assert run['queued']['state']['budgets']['gpuBytes']==run['baseBytes']+(0 if short else run['nativeBytes']+run['helperBytes'])
        if short:assert run['capture']['error']['code']=='limit-exceeded'
        else:
            assert run['ambient']['before']==run['ambient']['after'] and all(run['ambient']['before']['caps']) and run['ambient']['before']['active']==33987 and run['ambient']['before']['base']==1 and run['ambient']['before']['maximum']==3;assert run['view']['metadata']['sharedCopyScratchBytes']==run['helperBytes'];copies=[r for r in run['readbacks'] if r['label'].startswith('bounded-shared-private-budget-refresh-')];assert len(copies)==9 and all(r['name']=='readPixels' and r['type']=='PBO' for r in copies)
            assert len([r for r in run['nativeEvents'] if r['name']=='bufferData' and r.get('buffer')==run['copyScratch']['buffer']])==1
    if run.get('kind') in ('hostile-original-authority','foreign-same-id'):assert all(not row['result']['ok'] for row in run['refusals'])
    if run.get('kind')=='native-failure':assert not run['result']['ok'] and len(run['faultEvents'])==1 and run['afterFailure']['budgets']['scratchBytes']==0 and run['afterFailure']['budgets']['tickets']==0
    if 'partialReads' in run:
        partial=run['partialReads'];patch=run['patch'];original=blob(directory,patch['input']);totals['publicBytes']+=public(directory,run,'bounded-packed-patch-sync',original,partial['sync'])
        for read in partial['reads']:totals['publicBytes']+=public(directory,run,'bounded-packed-patch-staged-'+str(read['opcode']),original,read['nativeBytes']);assert read['fence']['actual'] in (37146,37148) and read['fence']['delivered'] in (37146,37148)
    for name,fill in [('finalBacking',0xa7),('finalStagingBacking',0x2e)]:
        if name not in run:continue
        final=blob(directory,run[name]);assert len(final)==len(backing);occupied=set()
        for plane in ([] if 'patch' in run and name=='finalStagingBacking' else run['planes']):
            # Partial tests leave original base backing in place until explicit patch reads.
            wanted=originals[plane['level']] if 'patch' in run else scalar.canonical_bytes(originals[plane['level']]);assert dense(final,plane)==wanted
            for y in range(plane['height']):occupied.update(range(plane['offset']+y*plane['stride'],plane['offset']+y*plane['stride']+plane['width']*4))
        if 'patch' in run:
            plane=run['patch'];assert dense(final,plane)==scalar.canonical_bytes(blob(directory,plane['input']))
            for y in range(plane['height']):occupied.update(range(plane['offset']+y*plane['stride'],plane['offset']+y*plane['stride']+plane['width']*4))
        for at,value in enumerate(final):
            if at not in occupied:assert value==fill;totals['paddingBytes']+=1
    replacement=run.get('replacement');new={}
    if replacement:
        new={p['level']:blob(directory,p['input']) for p in replacement['planes']};assert new==generated_words({**replacement,'seed':run['seed']^0x52af93d1,'fields':False})
    for upload in run['uploads']:
        if upload['type']=='PBO':assert upload['unpackBuffer']>0 and upload['bytes'] is None;totals['gpuCopies']+=1;continue
        if upload['label']=='independent-shared-diagnostic':continue
        assert upload['type']=='Uint32Array' and upload['args'][6:8]==[6407,35902]
        level=upload['args'][1];wanted=new[level] if upload['label'].startswith('bounded-float-unequal-replacement') else blob(directory,run['patch']['input']) if upload['label']=='bounded-packed-patch-upload' else originals[level]
        if '-row' in upload['label']:
            plane=next(p for p in run['planes'] if p['level']==level);start=upload['args'][3]*plane['width']*4;wanted=wanted[start:start+plane['width']*4]
        assert blob(directory,upload['bytes'])==wanted,'original little-endian upload words in actual Uint32 input';totals['nativeUploadBytes']+=len(wanted)
    assert all(value==0 for value in run['final']['budgets'].values()) and all(o['deleted']==1 for o in run['nativeObjects'])
def main(directory):
    root=Path(directory);totals=dict(runs=0,nativeComponents=0,originalInputBytes=0,publicBytes=0,nativeUploadBytes=0,paddingBytes=0,footprintChecks=0,gpuCopies=0)
    folders=[root] if (root/'report.json').exists() else sorted(p.parent for p in root.glob('hardware*/report.json'))
    for folder in folders:
        envelope=json.loads((folder/'report.json').read_text());assert envelope['status']=='passed';report=envelope['browserResult']['result'];assert report['status']=='passed' and not report['guestExecution'] and not report['productionNegotiation']
        for run in report['runs']:totals['runs']+=1;audit(folder,run,totals)
    faults=[]
    for folder in sorted(p.parent for p in root.glob('fault-*/report.json')):
        envelope=json.loads((folder/'report.json').read_text());assert envelope['status']=='failed';report=envelope['partial'];sabotage=report['sabotage'];assert sabotage['fenceCompleted'] and not sabotage['held'];assert sabotage['fence']['actual'] in (37146,37148) and sabotage['fence']['delivered'] in (37146,37148)
        run=report['runs'][0];obs=sabotage['observation'];plane=next(p for p in run['planes'] if p['level']==obs.get('original',obs.get('level')));original=blob(folder,plane['input']);observed=blob(folder,obs['native']);assert any(e.get('fault')==envelope['fault'] for e in run['faultEvents'])
        try:scalar.compare(original,observed,'unchanged-original-negative-control')
        except AssertionError as error:faults.append(dict(record=folder.name,status='refuted',fenceCompleted=True,prediction=str(error)))
        else:raise AssertionError('actual GPU packing/level corruption escaped original rational inverse')
    result=dict(schema='original-rgb9e5-complete-native-inverse-v1',status='passed',faults=faults,**totals);(root/'independent-values.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main(sys.argv[1])
