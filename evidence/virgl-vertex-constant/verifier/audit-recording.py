from pathlib import Path
import hashlib,json,struct,subprocess
from fractions import Fraction
ROOT=Path.cwd(); V=ROOT/'evidence/virgl-vertex-constant/verifier'; U=V/'unpacked'
sha=lambda b:hashlib.sha256(b).hexdigest()
head='92c98c7361cad2518200bfa99765ed5895ef4f95'
def load(p):return json.loads(p.read_bytes())
def word(f):return struct.unpack('<I',struct.pack('<f',float(f)))[0]
banks=[{120:[Fraction(1,4),0,Fraction(1,2),Fraction(1,2)],124:[Fraction(1,2)]*4,127:[Fraction(1,4),Fraction(1,2),Fraction(1,4),Fraction(1,2)]},
       {120:[Fraction(1,2),Fraction(1,4),0,Fraction(1,2)],124:[Fraction(1,2),Fraction(1,4),1,Fraction(1,2)],127:[0,Fraction(1,2),Fraction(1,4),Fraction(1,4)]}]
def color(op,phase):
    a=banks[phase]; values=a[127] if op=='MOV' else [a[120][i]+a[127][i] if op=='ADD' else a[124][i]*a[127][i] if op=='MUL' else a[120][i]*a[124][i]+a[127][i] for i in range(4)]
    return [round(min(Fraction(1),max(Fraction(0),v))*255) for v in values]
reports=[]
for prefix in ['hot','cold']:
    d=U/prefix; compiler=load(d/'native/report.json');cases=load(d/'native/cases.json')
    assert len(cases)==29
    for run in compiler['native']:
        rows=[json.loads(line)for line in(d/('native/'+run['mode']+'.jsonl')).read_text().splitlines()]
        assert rows==run['results']
        for i,(test,row)in enumerate(zip(cases,rows)):
            result=row['result'];assert row['case']==i and result['ok']==(test['ok'] and run['mode']!='scratch-sanitize')
            if run['mode']=='scratch-sanitize' and test['ok']:assert result['error']['code']=='translation-error'
            elif test['kind']!=3:assert result==compiler['wasm']['results'][i]['result']
            if result['ok']:
                s=result['vertex'] if test['kind']==2 else result
                assert s['metadata']['profile']==test['profile'] and s['metadata']['uniforms'][0]['count']==test['count']
                assert not any(k.startswith('constantExact') for k in s['metadata'])
                assert ('vsconst0[128]' in s['glsl']) if test['count']==128 else True
            else:assert isinstance(result['error']['code'],str) and not any(k in result for k in ['glsl','vertex','fragment'])
    memory=compiler['memory'];assert memory['bytes']==16777216 and memory['recovered'] and memory['exhausted']=={'ok':False,'error':{'code':'translation-error','message':'Upstream TGSI scratch allocation failed or exceeded its bound.'}}
    r=load(d/'hardware/report.json');assert r['gitHead']==head and r['status']=='passed'
    b=r['browserResult']['result'];raw=(d/'hardware/constants.rgba').read_bytes();assert len(raw)==15*1024
    assert all(a['held'] and a['expected']==a['observed'] for a in b['assertions'])
    frame_results=[]
    for i,frame in enumerate(b['records']):
        op,phase=('MAD',1)if frame['name'].startswith('async')else(frame['name'].split('-')[0],int(frame['name'].split('-')[1]))
        expected=color(op,phase);block=raw[i*1024:(i+1)*1024];assert frame['expected']==expected and block==bytes(expected)*256
        words=[0]*512
        for slot,lanes in banks[phase].items():words[slot*4:slot*4+4]=map(word,lanes)
        assert frame['words']==words
        wire=bytes.fromhex(frame['packetHex']);assert len(wire)==2112 and struct.unpack('<I',wire[:4])[0]==(514<<16)|12
        assert struct.unpack('<II',wire[4:12])==(0,0) and list(struct.unpack('<512I',wire[12:2060]))==words
        assert struct.unpack('<I',wire[2060:2064])[0]==(12<<16)|8
        frame_results.append({'name':frame['name'],'color':expected,'pixelSha256':sha(block),'allPixels':256})
    labels=[a['prediction']for a in b['assertions']]
    for label in ['short highest active vec4 zero native draws','high infinity zero native draws','high NaN zero native draws','unread hole NaN zero native draws','packet beyond vertex128 zero native draws','fragment packet beyond46 zero native draws','incomplete final vector zero native draws','reduced native host limit zero native draws','oversized metadata zero native draws','old profile high extent zero native draws','raw profile high extent zero native draws','wide fragment metadata zero native draws']:
        assert label in labels,label
    assert b['suffixReflection']['count']==b['suffixReflection']['activeCount']==129 and b['suffixReflection']['uploadCount']==128
    assert [j['delay']for j in b['jobs']]==[0,1,3] and all(j['gpuComplete']for j in b['jobs'])
    assert r['browser']['headless'] is False and 'Apple M4 Max' in b['gpu']['renderer']
    assert r['browserErrors']=={'console':[],'page':[],'requests':[]}
    fault=load(d/'fault-upload-limit/report.json');assert fault['status']=='failed' and 'MOV bank 0 literal physical pixels' in fault['browserResult']['error']['message']
    assert fault['browserErrors']==r['browserErrors']
    original=(ROOT/fault['mutation']['path']).read_bytes();assert (d/'fault-upload-limit/mutation-source.mjs').read_bytes()==original.replace(fault['mutation']['needle'].encode(),fault['mutation']['replacement'].encode())
    native=load(d/'compiler-native/report.json');wasm=load(d/'compiler-wasm/report.json')
    assert len(native['cases'])==len(wasm['cases'])==603 and len(native['pairs'])==len(wasm['pairs'])==23 and len(native['allocationFaults'])==752
    assert all(not f['result']['ok'] and not any(k in f['result']for k in ['glsl','vertex','fragment']) for f in native['allocationFaults'])
    for a,z in zip(native['cases'],wasm['cases']):assert a['result']==z['result'] and a['result']['ok']==a['ok']
    retained=load(d/'compiler-retained/report.json');assert len(retained['originals'])==25 and sum(x['native']['ok']for x in retained['originals'])==23
    assert all(x['native']==x['wasm'] for x in retained['originals'])
    reports.append({'prefix':prefix,'nativeCases':29,'frames':frame_results,'physicalAssertions':len(b['assertions']),'jobs':b['jobs'],'memory':memory,'retainedCases':603,'pairs':23,'allocationFaults':752,'originals':25,'status':'HELD'})
assert subprocess.check_output(['git','diff','cbb640fc..92c98c73','--','renderer/virgl-shader/raw_bits.h','renderer/virgl-shader/raw_bits.c'])==b''
(V/'recording-audit.json').write_text(json.dumps({'task':'E6-T11d1','status':'HELD','sourceHead':head,'reports':reports,'independentOracle':'rational arithmetic, separate binary32 packing, RGBA8 integer quantization; all raw bytes and original packet fields'},indent=2)+'\n')
print('HELD: 30 raw frames, full compiler response parity, typed boundaries, faults, recovery and unchanged raw arenas')
