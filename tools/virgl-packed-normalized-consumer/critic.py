#!/usr/bin/env python3
"""Independent full original-wire regression plus native alpha and boxed transfers."""
import gzip,hashlib,json,sys
from pathlib import Path
from pixels import main as full_inverse,NORMALIZED,descriptor,decoded_native,original_packed,half_float,packed_float,packets

def main(directory,control=False):
    directory=Path(directory);full_inverse(directory,control)
    report=json.loads((directory/'report.json').read_text());e=report.get('partial') or report['browserResult']['result']
    blobs={b['key']:b for b in e['blobs']}
    def load(ref):
        b=blobs[ref['key']];assert b['sha256']==ref['sha256']
        compressed=(directory/b['path']).read_bytes();assert hashlib.sha256(compressed).hexdigest()==b['gzipSha256']
        raw=gzip.decompress(compressed);assert len(raw)==b['bytes'] and hashlib.sha256(raw).hexdigest()==b['sha256'];return raw
    alpha=0;boxed=0;keys=[]
    for ri,run in enumerate(e['runs']):
        for fi in run['frames']:
            for target in e['frames'][fi]['targets']:
                fmt=target['metadata']['format'];d=NORMALIZED.get(fmt)
                for ref in [target['native']]+[p['native'] for p in target['planes']]:
                    raw=load(ref)
                    if d and d['implicitAlpha']:
                        if d['guestPixelBytes']==4:
                            field=d['rgbaFields'][3];maximum=2**field['bits']-1
                            assert all((int.from_bytes(raw[at:at+4],'little')>>d['nativeOffsets'][3])&maximum==maximum for at in range(0,len(raw),4)),'physical packed X bits must be canonical one'
                        else:assert all(raw[at]==255 for at in range(3,len(raw),4)),'physical packed opaque alpha must read one'
                        alpha+=len(raw)//4
        first,last=run['refusalEventRange'];assert all(event['name'] in ['fenceSync','clientWaitSync','deleteSync'] for event in run['events'][first:last])
        assert run['refusalBefore']['nativeObjects']==run['refusalAfter']['nativeObjects'] and run['refusalBefore']['resourceBudgets']==run['refusalAfter']['resourceBudgets']
        assert all(run['refusalBefore']['rendererBudgets'][key]==run['refusalAfter']['rendererBudgets'][key] for key in ['objects','leases','programs','shaders','samplers'])
        assert all(r['result']['error']['code']=='incompatible-resource' and r['result']['appliedCommands']==0 for r in run['identityRefusals'])
        kinds=set()
        for row in run['profileKeys']:
            key=json.loads(row['key']);assert key[1] in ['stage','pair'] and key[-1]=='virgl-standard-packed-normalized-image-async-jobs-v1'
            assert '/renderer/virgl-command/state.mjs:' in row['stack'];kinds.add(key[1]);keys.append(dict(run=ri,**row))
        assert kinds=={'stage','pair'}
        for row in run['partialReads']:
            command=list(packets(run['history'][row['historyIndex']]['hex']));assert len(command)==1
            op,kind,w,raw=command[0];assert op==43 and w[1]==1 and w[5:11]==[2,1,0,3,2,1] and w[11]==7 and w[12]==2
            target=next(t for t in e['frames'][row['frame']]['targets'] if t['slot']==row['slot']);m=target['metadata'];fmt=m['format'];d=descriptor(fmt)
            assert w[0]==m['id'];width=max(1,m['width']>>1);values=decoded_native(fmt,load(target['native']));pixel=d['guestPixelBytes'] if d.get('normalized') else d['components']*(d['bits']//8)
            expected=bytearray(load(row['before']));after=load(row['after']);assert len(expected)==len(after)==20000
            for y in range(w[9]):
                for x in range(w[8]):
                    at=((w[6]+y)*width+w[5]+x)*4;v=values[at:at+4]
                    if d.get('normalized'):encoded=original_packed(fmt,v)
                    else:
                        parts=[]
                        for lane in range(d['components']):
                            value=half_float(v[lane]) if not d['integer'] and d['bits']==16 else v[lane]
                            parts.append((value&((1<<d['bits'])-1)).to_bytes(d['bits']//8,'little'))
                        encoded=b''.join(parts)
                    offset=w[11]+y*w[3]+x*pixel;expected[offset:offset+pixel]=encoded
            assert after==expected,'entire odd-offset/stride boxed backing derives from original transfer and native plane'
            assert row['completion']['actual'] in [37146,37148] and row['completion']['sequence']>e['frames'][row['frame']]['completion']['sequence'];boxed+=len(after)
    result=dict(status='refuted' if control else 'passed',physicalCanonicalAlphaPixels=alpha,boxedBackingBytes=boxed,cacheKeyCustody=keys,independentOriginalWire=True,productExpectedValuesUsed=False)
    (directory/'critic-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='cacheKeyCustody'}))
if __name__=='__main__':main(sys.argv[1],len(sys.argv)>2 and sys.argv[2]=='--control')
