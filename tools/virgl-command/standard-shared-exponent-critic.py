#!/usr/bin/env python3
"""Independent arithmetic and actual post-fence audit for promoted critic cases."""
import argparse
from fractions import Fraction
import gzip
import hashlib
import json
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parents[2]
sha=lambda raw:hashlib.sha256(raw).hexdigest()


def predicted(raw):
    result=bytearray();canonical=bytearray()
    for word, in struct.iter_unpack('<I',raw):
        e=word>>27;mantissas=[word>>shift&511 for shift in (0,9,18)]
        colors=[Fraction(m*(1<<e),1<<24) for m in mantissas]
        quantum=Fraction(1,1<<24);chosen=0
        while max(colors)>=512*quantum:quantum*=2;chosen+=1
        fields=[]
        for c in colors:
            rounded=c/quantum+Fraction(1,2);fields.append(rounded.numerator//rounded.denominator)
        assert all(m<512 for m in fields) and [m*quantum for m in fields]==colors
        canonical.extend(struct.pack('<I',fields[0]|fields[1]<<9|fields[2]<<18|chosen<<27))
        bits=[]
        for m in mantissas:
            n=m.bit_length();bits.append(0 if not m else (e+n+102)<<23|(m<<(24-n)&0x7fffff))
        result.extend(struct.pack('<4I',*bits,0x3f800000))
    return bytes(result),bytes(canonical)


def blob(directory,entry):
    compressed=(directory/entry.get('path',entry['key']+'.bin.gz')).read_bytes()
    assert sha(compressed)==entry['gzipSha256'];raw=gzip.decompress(compressed)
    assert sha(raw)==entry['sha256'] and len(raw)==entry['bytes'];return raw


def validate_plan():
    file=ROOT/'renderer/virgl-command/tests/standard-shared-exponent-critic.json'
    raw=file.read_bytes();plan=json.loads(raw)
    assert plan['predictedBeforeNative'] and len(plan['plans'])==3
    for p in plan['plans']:
        logical=0;private=0
        for plane in p['planes']:
            original=bytes.fromhex(plane['inputHex']);native,words=predicted(original)
            assert native.hex()==plane['floatHex'] and words.hex()==plane['canonicalHex']
            assert len(original)==plane['width']*plane['height']*4
            logical+=len(original)
            if p['firstLevel']<=plane['level']<=p['lastLevel']:private+=len(original)
        base=p['planes'][p['firstLevel']];helper=base['width']*base['height']*8
        assert logical==p['sourceBytes'] and private==p['privateBytes'] and helper==p['helperBytes']
        assert logical+private+helper==p['totalGPU']
    return dict(status='HELD',planSha256=sha(raw),plans=len(plan['plans']),predictedBeforeNative=True)


def audit(directory):
    report=json.loads((directory/'novel-native/report.json').read_bytes())
    assert report['status']=='passed' and report['browserErrors']==dict(console=[],page=[],requests=[])
    native=report['browserResult']['result'];assert native['status']=='passed' and not native['guestExecution'] and not native['productionNegotiation']
    assert 'M4' in native['gpu'] and 'Metal' in native['gpu']
    points=[]
    for i,row in enumerate(native['runs']):
        assert all(n['deleted']==1 for n in row['nativeObjects']) and all(n==0 for n in row['final']['budgets'].values())
        if row['kind']=='critic-novel-field-range-state':
            p=row['plan'];states={s['point']:s['state'] for s in row['states']}
            assert states['before']==states['after-failure']==states['after-success']
            assert states['before']['program']>0 and states['before']['pack']>0 and states['before']['unpack']>0
            assert row['drawFailure']['error']['code']=='backend-error' and len(row['faultEvents'])==1
            assert row['fence']['actual'] in (37146,37148) and row['fence']['delivered'] in (37146,37148)
            for obs in row['observations']:
                original=bytes.fromhex(p['planes'][obs['level']]['inputHex']);wanted=predicted(original)[0];actual=blob(directory/'novel-native',obs['native']);assert actual==wanted
                points.append(dict(run=i,kind=obs['kind'],level=obs['level'],bytes=len(actual),originalSha256=sha(original),nativeSha256=sha(actual)))
            copies=[r for r in row['readbacks'] if r['label']=='critic-native-retry'];assert copies and all(r['name']=='readPixels' and r['type']=='PBO' and r['bytes'] is None for r in copies)
            helpers=[a['copyScratch'] for a in row['allocations'] if a['copyScratch']]
            assert len(helpers)==1
            h=helpers[0];assert len([e for e in row['nativeEvents'] if e['name']=='bufferData' and e.get('buffer')==h['buffer']])==1
        if row['kind']=='critic-native-legacy':
            for obs in row['observations']:
                if 'expected' in obs:assert blob(directory/'novel-native',obs['native']).hex()==obs['expected']
        if row['kind']=='critic-late-helper-error':assert row['failure']['error']['code']=='backend-error' and row['injections']==1
    control=json.loads((directory/'sabotage-blue-field/report.json').read_bytes())
    assert control['status']=='failed' and control['browserErrors']==dict(console=[],page=[],requests=[])
    s=control['partial']['sabotage'];assert s['fenceCompleted'] and s['fence']['actual'] in (37146,37148) and s['fence']['delivered'] in (37146,37148)
    run=control['partial']['runs'][0];p=run['plan']['planes'][s['originalLevel']]
    wanted=predicted(bytes.fromhex(p['inputHex']))[0];actual=blob(directory/'sabotage-blue-field',s['native']);assert actual!=wanted
    assert s['expectedHex']==wanted.hex() and s['mutations']
    first=next(i for i,(a,b) in enumerate(zip(struct.iter_unpack('<I',wanted),struct.iter_unpack('<I',actual))) if a!=b)
    result=dict(schema='fresh-rgb9e5-promoted-critic-audit-v1',status='HELD',runs=len(native['runs']),points=points,
                actualBlueFieldControl=dict(status='REFUTED',point='/partial/sabotage',originalLevel=s['originalLevel'],component=first,
                                           predictedBits=hex(struct.unpack_from('<I',wanted,first*4)[0]),observedBits=hex(struct.unpack_from('<I',actual,first*4)[0]),nativeSha256=sha(actual),fence=s['fence']))
    (directory/'novel-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


def main():
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--prepare',action='store_true');args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    result=validate_plan();(args.output/'novel-plan-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    if not args.prepare:result=audit(args.output)
    print(json.dumps({k:v for k,v in result.items() if k!='points'}))


if __name__=='__main__':main()
