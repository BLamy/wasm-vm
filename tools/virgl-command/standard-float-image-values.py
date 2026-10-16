#!/usr/bin/env python3
"""Reconstruct native/public float planes from complete original input bits."""
import gzip,hashlib,json,math,struct,sys
from pathlib import Path

FORMATS={**{91+i:(16,i+1) for i in range(4)},**{28+i:(32,i+1) for i in range(4)}}
def sha(raw): return hashlib.sha256(raw).hexdigest()
def blob(directory,entry):
    packed=(directory/entry.get('path',entry['key']+'.bin.gz')).read_bytes()
    assert sha(packed)==entry['gzipSha256']
    raw=gzip.decompress(packed)
    assert len(raw)==entry['bytes'] and sha(raw)==entry['sha256']
    return raw
def values(format,raw):
    precision,components=FORMATS[format];size=precision//8
    assert len(raw)%(components*size)==0
    data=struct.unpack('<'+('e' if precision==16 else 'f')*(len(raw)//size),raw)
    result=[]
    for pixel in range(len(data)//components):
        result.extend(data[pixel*components:(pixel+1)*components])
        result.extend(([0]*(3-components)+[1]) if components<4 else [])
    return result
def compare(format,original,actual,label):
    expected=values(format,original)
    assert len(actual)==len(expected),(label,len(actual),len(expected))
    minimum=2**(-14 if FORMATS[format][0]==16 else -126)
    checked=0
    for index,(wanted,observed) in enumerate(zip(expected,actual)):
        if not math.isfinite(wanted):continue
        assert wanted==observed or wanted!=0 and abs(wanted)<minimum and observed==0,(label,index,wanted,observed)
        checked+=1
    return checked
def dense_from_backing(profile,backing,plane):
    size,components=FORMATS[profile];rowbytes=plane['width']*components*size//8
    return b''.join(backing[plane['offset']+row*plane['stride']:plane['offset']+row*plane['stride']+rowbytes] for row in range(plane['height']))
def native_upload(format,original):
    precision,components=FORMATS[format]
    if components!=3:return original
    size=precision//8;alpha=struct.pack('<H' if precision==16 else '<I',0x3c00 if precision==16 else 0x3f800000)
    return b''.join(original[at:at+components*size]+alpha for at in range(0,len(original),components*size))
def footprints(run):
    checks=0
    for allocation in run['allocations']:
        meta=allocation['metadata']
        if meta['format'] not in FORMATS:continue
        precision,components=FORMATS[meta['format']];size=precision//8
        pixels=[max(1,meta['width']>>level)*max(1,meta['height']>>level) for level in range(meta['lastLevel']+1)]
        assert meta['byteLength']==sum(pixels)*size*components
        native=4 if components==3 else components
        assert meta['gpuByteLength']==sum(pixels)*size*native
        for level,plane in enumerate(meta['levels']):
            assert plane==dict(level=level,width=max(1,meta['width']>>level),height=max(1,meta['height']>>level),byteLength=pixels[level]*size*components,gpuByteLength=pixels[level]*size*native)
        checks+=2+len(pixels)
    for operation in run['operations']:
        raw=bytes.fromhex(operation['wire']);words=struct.unpack('<'+'I'*(len(raw)//4),raw)
        assert words[0]&255==43 and len(words)==14 and words[0]>>16==13
        precision,components=FORMATS[run['metadata']['format']];size=precision//8
        rowbytes=words[9]*components*size;rows=words[10];footprint=(rows-1)*words[4]+rowbytes
        layout=operation['layout']
        assert layout['offset']==words[12] and layout['rowBytes']==rowbytes and layout['rowCount']==rows
        assert layout['rowStride']==words[4] and layout['footprintBytes']==footprint and layout['requiredEnd']==words[12]+footprint
        assert layout['tightBytes']==rowbytes*rows and layout['scratchBytes']==words[9]*rows*max(components,4 if components==3 else components)*size
        assert layout['stagingBytes']==0 and layout['direction']=='upload'
        checks+=9
    for read in run['readbacks']:
        if read['name']=='readPixels':
            wrong=run.get('kind')=='native-failure' and run.get('nativeFault')=='read'
            assert read['args'][4:6]==([36249,5126] if wrong else [6408,5126])
            if wrong:assert any(row['name']=='readPixels' and row['original']==6408 and row['delivered']==36249 for row in run['faultEvents'])
            assert read['type'] in ('Float32Array','PBO')
            if read['bytes']:assert read['bytes']['bytes']==read['args'][2]*read['args'][3]*16
            checks+=3
    return checks
def main():
    root=Path(sys.argv[1]);totals=dict(nativeComponents=0,publicComponents=0,nativeUploadBytes=0,paddingBytes=0,runs=0,footprintChecks=0)
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
                raw=blob(directory,upload['bytes']);assert raw==native_upload(format,inputs[level]),(directory.name,index,'actual native upload bit custody')
                assert upload['type']==('Uint16Array' if precision==16 else 'Float32Array')
                assert upload['args'][7]==(5131 if precision==16 else 5126)
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
                output=blob(directory,transfer['sync']);totals['publicComponents']+=compare(format,original[transfer['level']],values(format,output),'public-sync')
                for read in transfer['reads']:
                    output=blob(directory,read['nativeBytes']);totals['publicComponents']+=compare(format,original[transfer['level']],values(format,output),'public-staged')
                    assert read['fence']['actual'] in(37146,37148) and read['fence']['delivered'] in(37146,37148)
            for observation in run.get('observations',[]):
                raw=blob(directory,observation['native'])
                if observation['kind']=='retained-old-read':
                    totals['publicComponents']+=compare(format,original[0],values(format,raw),'retained-old-public-read')
                else:
                    wanted=blob(directory,observation['clearInput']) if'clearInput'in observation else original[observation['original']]
                    totals['nativeComponents']+=compare(format,wanted,struct.unpack('<'+'f'*(len(raw)//4),raw),'native-retained-copy-refresh')
                assert observation['fence']['actual'] in(37146,37148) and observation['fence']['delivered'] in(37146,37148)
            assert all(v==0 for v in run['final']['budgets'].values())
            assert all(p['deleted']==1 for p in run['nativeObjects'])
            for final_name,fill in [('finalBacking',0xa7),('finalStagingBacking',0x2e)]:
                if final_name not in run:continue
                output=blob(directory,run[final_name]);assert len(output)==len(backing)
                occupied=set()
                for p in run['planes']:
                    dense=dense_from_backing(format,output,p);totals['publicComponents']+=compare(format,original[p['level']],values(format,dense),final_name)
                    rowbytes=p['width']*components*precision//8
                    for row in range(p['height']):occupied.update(range(p['offset']+row*p['stride'],p['offset']+row*p['stride']+rowbytes))
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
    result=dict(schema='independent-original-float-values-v1',status='passed',faults=faults,**totals)
    (root/'independent-values.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
