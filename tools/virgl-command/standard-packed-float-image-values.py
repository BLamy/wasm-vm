#!/usr/bin/env python3
"""Reconstruct native/public float planes from complete original input bits."""
import gzip,hashlib,json,math,struct,sys
from pathlib import Path

FORMATS={124:(11,3)}
def sha(raw): return hashlib.sha256(raw).hexdigest()
def blob(directory,entry):
    packed=(directory/entry.get('path',entry['key']+'.bin.gz')).read_bytes()
    assert sha(packed)==entry['gzipSha256']
    raw=gzip.decompress(packed)
    assert len(raw)==entry['bytes'] and sha(raw)==entry['sha256']
    return raw
def unsigned_field(word,mantissa):
    exponent,fraction=divmod(word,2**mantissa)
    if exponent==31:return math.nan if fraction else math.inf
    return (1+fraction/2**mantissa)*2.0**(exponent-15) if exponent else fraction*2.0**(-14-mantissa)
def values(format,raw):
    assert format==124 and len(raw)%4==0
    result=[]
    for word, in struct.iter_unpack('<I',raw):
        result.extend([unsigned_field(word&2047,6),unsigned_field(word>>11&2047,6),unsigned_field(word>>22,5),1])
    return result
def compare(format,original,actual,label):
    expected=values(format,original)
    assert len(actual)==len(expected),(label,len(actual),len(expected))
    minimum=2**-14
    checked=0
    for index,(wanted,observed) in enumerate(zip(expected,actual)):
        if not math.isfinite(wanted):continue
        assert wanted==observed or wanted!=0 and abs(wanted)<minimum and observed==0,(label,index,wanted,observed)
        checked+=1
    return checked
def dense_from_backing(profile,backing,plane):
    assert profile==124
    rowbytes=plane['width']*4
    return b''.join(backing[plane['offset']+row*plane['stride']:plane['offset']+row*plane['stride']+rowbytes] for row in range(plane['height']))
def native_upload(format,original):
    assert format==124
    return original
def footprints(run):
    checks=0
    for allocation in run['allocations']:
        meta=allocation['metadata']
        if meta['format'] not in FORMATS:continue
        assert meta['format']==124 and meta['packedFloat'] is True
        size,components=4,1
        pixels=[max(1,meta['width']>>level)*max(1,meta['height']>>level) for level in range(meta['lastLevel']+1)]
        assert meta['byteLength']==sum(pixels)*size*components
        native=1
        assert meta['gpuByteLength']==sum(pixels)*size*native
        for level,plane in enumerate(meta.get('levels',[])):
            assert plane==dict(level=level,width=max(1,meta['width']>>level),height=max(1,meta['height']>>level),byteLength=pixels[level]*size*components,gpuByteLength=pixels[level]*size*native)
        checks+=2+len(pixels)
    for operation in run['operations']:
        raw=bytes.fromhex(operation['wire']);words=struct.unpack('<'+'I'*(len(raw)//4),raw)
        assert words[0]&255==43 and len(words)==14 and words[0]>>16==13
        assert run['metadata']['format']==124
        size,components=4,1
        rowbytes=words[9]*components*size;rows=words[10];footprint=(rows-1)*words[4]+rowbytes
        layout=operation['layout']
        assert layout['offset']==words[12] and layout['rowBytes']==rowbytes and layout['rowCount']==rows
        assert layout['rowStride']==words[4] and layout['footprintBytes']==footprint and layout['requiredEnd']==words[12]+footprint
        assert layout['tightBytes']==rowbytes*rows and layout['scratchBytes']==words[9]*rows*max(components,4 if components==3 else components)*size
        assert layout['stagingBytes']==0 and layout['direction']=='upload'
        checks+=9
    for event in run['nativeEvents']:
        if event['name']=='texStorage2D':
            wrong=run.get('kind')=='native-failure' and run.get('nativeFault')=='storage'
            assert event['args'][2]==35898,'actual original R11F_G11F_B10F storage'
            if wrong:assert event['args'][1]==0 and any(row['name']=='texStorage2D' and row['delivered']==0 for row in run['faultEvents'])
            if not wrong:
                allocation=next(row for row in run['allocations'] if row['texture']==event['texture'])
                meta=allocation['metadata'];assert event['args'][1:]==[meta['lastLevel']+1,35898,meta['width'],meta['height']]
            checks+=3
        if event['name']=='blitFramebuffer':
            wrong=run.get('kind')=='native-failure' and run.get('nativeFault')=='copy'
            assert event['args'][8:]==([0x40000000,9728] if wrong else [16384,9728])
            checks+=2
    for read in run['readbacks']:
        if read['name']=='readPixels':
            wrong=run.get('kind')=='native-failure' and run.get('nativeFault')=='read'
            assert read['args'][4:6]==([36249,5126] if wrong else [6408,5126])
            if wrong:assert any(row['name']=='readPixels' and row['original']==6408 and row['delivered']==36249 for row in run['faultEvents'])
            assert read['type'] in ('Float32Array','PBO')
            if read['bytes']:assert read['bytes']['bytes']==read['args'][2]*read['args'][3]*16
            checks+=3
    return checks
def public_inverse(directory,run,label,public):
    from standard_packed_float_scalar import packed_from_native
    raw=next(blob(directory,row['bytes']) for row in run['readbacks'] if row['label']==label and row['bytes'] and row['name'] in ('readPixels','getBufferSubData'))
    expected=packed_from_native(raw)
    assert public==expected,(label,'actual native/public packed inverse differs')
    return len(public)
def main():
    root=Path(sys.argv[1]);totals=dict(nativeComponents=0,publicComponents=0,publicInverseBytes=0,nativeUploadBytes=0,paddingBytes=0,runs=0,footprintChecks=0)
    directories=[root] if(root/'report.json').is_file() else sorted(p.parent for p in root.glob('hardware*/report.json'))
    for directory in directories:
        envelope=json.loads((directory/'report.json').read_text())
        assert envelope['status']=='passed',str(directory)
        report=envelope['browserResult']['result']
        assert report['guestExecution'] is False and report['productionNegotiation'] is False
        for index,run in enumerate(report['runs']):
            totals['runs']+=1;format=run['metadata']['format'];precision,components=FORMATS[format];original={p['level']:blob(directory,p['input']) for p in run['planes']}
            totals['footprintChecks']+=footprints(run)
            if run.get('kind')=='native-failure':
                assert run['nativeFault'] in ('texture','storage','upload','framebuffer','copy','read','buffer','fence')
                assert not run['result']['ok'] and len(run['faultEvents'])==1
                assert run['afterFailure']['budgets']['scratchBytes']==0 and run['afterFailure']['budgets']['tickets']==0
            backing=blob(directory,run['backing'])
            for p in run['planes']:assert dense_from_backing(format,backing,p)==original[p['level']]
            replacement={p['level']:blob(directory,p['input']) for p in run.get('replacement',{}).get('planes',[])}
            for upload in run.get('uploads',[]):
                level=upload['args'][1]
                inputs=replacement if upload['label'].startswith('bounded-float-unequal-replacement') else original
                selected=blob(directory,run['patch']['input']) if upload['label']=='bounded-packed-patch-upload' else inputs[level]
                raw=blob(directory,upload['bytes']);assert raw==native_upload(format,selected),(directory.name,index,'actual native upload bit custody')
                assert upload['type']=='Uint32Array'
                assert upload['args'][6:8]==[6407,35899]
                totals['nativeUploadBytes']+=len(raw)
            for p in run['planes']:
                if'observed'in p:
                    raw=blob(directory,p['observed']['native']);actual=struct.unpack('<'+'f'*(len(raw)//4),raw)
                    totals['nativeComponents']+=compare(format,original[p['level']],actual,f'{directory.name}/run{index}/native{p["level"]}')
            for view in run.get('views',[]):
                assert view['metadata']['lastLevel']==view['lastLevel']-view['firstLevel']
                for p in view['planes']:
                    raw=blob(directory,p['native']);actual=struct.unpack('<'+'f'*(len(raw)//4),raw)
                    totals['nativeComponents']+=compare(format,original[p['original']],actual,f'{directory.name}/run{index}/view{p["original"]}')
            for transfer in run.get('transfers',[]):
                output=blob(directory,transfer['sync']);totals['publicInverseBytes']+=public_inverse(directory,run,'original-float-sync-read-'+str(transfer['level']),output);totals['publicComponents']+=compare(format,original[transfer['level']],values(format,output),'public-sync')
                for read in transfer['reads']:
                    output=blob(directory,read['nativeBytes']);totals['publicInverseBytes']+=public_inverse(directory,run,'original-float-staged-'+str(read['opcode'])+'-'+str(transfer['level']),output);totals['publicComponents']+=compare(format,original[transfer['level']],values(format,output),'public-staged')
                    assert read['fence']['actual'] in(37146,37148) and read['fence']['delivered'] in(37146,37148)
            if run.get('kind')=='read-budget':
                short=run['boundary'].endswith('short');assert run['start']['ok']==(not short)
                assert run['foreignLease']['error']['code']=='invalid-lease'
                queued=run['queued'];assert queued['owner']['budgets']['scratchBytes']==(0 if short else 240)
                assert queued['async']['stagingBytes']==(0 if short else 240)
                if short:assert run['start']['error']['code']=='limit-exceeded'
                else:
                    output=blob(directory,run['read']['nativeBytes']);totals['publicInverseBytes']+=public_inverse(directory,run,'bounded-packed-read-budget',output);totals['publicComponents']+=compare(format,original[0],values(format,output),'exact-read-budget-public')
                    assert run['read']['fence']['actual'] in (37146,37148) and run['read']['fence']['delivered'] in (37146,37148)
                totals['footprintChecks']+=5
            if 'partialReads' in run:
                partial=run['partialReads'];patch=run['patch'];input=blob(directory,patch['input'])
                output=blob(directory,partial['sync']);totals['publicInverseBytes']+=public_inverse(directory,run,'bounded-packed-patch-sync',output);totals['publicComponents']+=compare(format,input,values(format,output),'partial-sync')
                for read in partial['reads']:
                    output=blob(directory,read['nativeBytes']);totals['publicInverseBytes']+=public_inverse(directory,run,'bounded-packed-patch-staged-'+str(read['opcode']),output);totals['publicComponents']+=compare(format,input,values(format,output),'partial-staged')
                    assert read['fence']['actual'] in (37146,37148) and read['fence']['delivered'] in (37146,37148)
                    layout=read['layout'];assert layout['box']==dict(x=patch['x'],y=patch['y'],z=0,width=patch['width'],height=patch['height'],depth=1)
                    assert layout['rowBytes']==patch['width']*4 and layout['rowStride']==patch['stride'] and layout['offset']==patch['offset']
                    assert layout['scratchBytes']==patch['width']*patch['height']*16 and layout['stagingBytes']==layout['scratchBytes']
                    totals['footprintChecks']+=6
            for observation in run.get('observations',[]):
                raw=blob(directory,observation['native'])
                if observation['kind']=='retained-old-read':
                    totals['publicComponents']+=compare(format,original[0],values(format,raw),'retained-old-public-read')
                else:
                    wanted=blob(directory,observation['clearInput']) if'clearInput'in observation else original[observation['original']]
                    if observation['kind'].startswith('partial-') and observation['original']==run['patch']['level']:
                        patch=run['patch'];input=blob(directory,patch['input']);plane=next(p for p in run['planes'] if p['level']==patch['level']);wanted=bytearray(wanted)
                        for y in range(patch['height']):
                            at=((patch['y']+y)*plane['width']+patch['x'])*4;count=patch['width']*4;wanted[at:at+count]=input[y*count:(y+1)*count]
                    totals['nativeComponents']+=compare(format,wanted,struct.unpack('<'+'f'*(len(raw)//4),raw),'native-retained-copy-refresh')
                assert observation['fence']['actual'] in(37146,37148) and observation['fence']['delivered'] in(37146,37148)
            assert all(v==0 for v in run['final']['budgets'].values())
            assert all(p['deleted']==1 for p in run['nativeObjects'])
            for final_name,fill in [('finalBacking',0xa7),('finalStagingBacking',0x2e)]:
                if final_name not in run:continue
                output=blob(directory,run[final_name]);assert len(output)==len(backing)
                occupied=set()
                for p in ([] if 'patch' in run and final_name=='finalStagingBacking' else run['planes']):
                    dense=dense_from_backing(format,output,p);totals['publicComponents']+=compare(format,original[p['level']],values(format,dense),final_name)
                    rowbytes=p['width']*4
                    for row in range(p['height']):occupied.update(range(p['offset']+row*p['stride'],p['offset']+row*p['stride']+rowbytes))
                if 'patch' in run:
                    patch=run['patch'];input=blob(directory,patch['input']);dense=dense_from_backing(format,output,patch);totals['publicComponents']+=compare(format,input,values(format,dense),'complete-partial-public-backing')
                    for y in range(patch['height']):occupied.update(range(patch['offset']+y*patch['stride'],patch['offset']+y*patch['stride']+patch['width']*4))
                for at,value in enumerate(output):
                    if at not in occupied:assert value==fill;totals['paddingBytes']+=1
        assert report['status']=='passed'
    faults=[]
    for directory in sorted(p.parent for p in root.glob('fault-*/report.json')):
        envelope=json.loads((directory/'report.json').read_text());assert envelope['status']=='failed'
        report=envelope['partial'];run=report['runs'][0];sabotage=report['sabotage'];observation=sabotage['observation']
        assert sabotage['fenceCompleted'] and not sabotage['held']
        assert sabotage['fence']['actual'] in (37146,37148) and sabotage['fence']['delivered'] in (37146,37148)
        assert any(row['fault']==envelope['fault'] for row in run['faultEvents'])
        level=observation.get('original',observation.get('level'));plane=next(p for p in run['planes'] if p['level']==level)
        original=blob(directory,plane['input']);native=blob(directory,observation['native'])
        # Same unmodified original-value oracle as healthy observations.
        try:compare(run['metadata']['format'],original,struct.unpack('<'+'f'*(len(native)//4),native),directory.name)
        except AssertionError as error:
            faults.append(dict(record=directory.name,status='refuted',fenceCompleted=True,prediction=str(error)))
        else:raise AssertionError('actual wrong native selection escaped independent oracle')
    result=dict(schema='independent-original-r11g11b10-values-v1',status='passed',faults=faults,**totals)
    (root/'independent-values.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
