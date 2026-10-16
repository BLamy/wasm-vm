from pathlib import Path
import hashlib,json,struct,subprocess
from fractions import Fraction
ROOT=Path.cwd(); V=ROOT/'evidence/virgl-vertex-constant/verifier'
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_bytes())
assert load(V/'authentication.json')['status']=='passed'
assert load(V/'recording-audit.json')['status']==load(V/'join-audit.json')['status']==load(V/'carry-forward.json')['status']=='HELD'
cov=load(V/'coverage-audit.json');assert cov['status']=='HELD' and cov['gaps']==[]
physical=load(V/'physical-final/report.json');assert physical['status']=='passed' and physical['result']['status']=='passed'
assert physical['errors']=={'console':[],'page':[],'requests':[]}
assert all(a['held']for a in physical['result']['assertions'])
assert len(physical['result']['frames'])==6
colors=[[159,8,255,72],[64,16,255,12]]
inputs=[{61:[0,Fraction(1,4),Fraction(1,2),Fraction(3,4)],93:[Fraction(1,8),Fraction(1,4),Fraction(3,8),Fraction(1,2)]},
        {61:[Fraction(1,2),Fraction(1,8),Fraction(1,4),Fraction(3,8)],93:[Fraction(1,2),Fraction(7,8),Fraction(1,8),Fraction(3,4)]}]
for frame in physical['result']['frames']:
    a=inputs[frame['phase']];value=[a[93][2]+a[61][1],a[93][0]*a[61][1],a[93][3]+a[61][3],a[93][2]*a[61][3]]
    expected=[round(min(Fraction(1),max(Fraction(0),n))*255)for n in value]
    assert expected==colors[frame['phase']]==frame['expected'] and bytes(frame['raw'])==bytes(expected)*256
    words=[0]*512
    for slot,lanes in a.items():words[slot*4:slot*4+4]=[struct.unpack('<I',struct.pack('<f',float(n)))[0]for n in lanes]
    assert words==frame['words'] and frame['reflection']['activeCount']==129 and frame['reflection']['uploadCount']==128
    packet=bytes.fromhex(frame['packetHex']);assert struct.unpack('<512I',packet[12:2060])==tuple(words)
for item in physical['sources']:
    assert sha((ROOT/item['path']).read_bytes())==item['sha256']
sabotage=load(V/'sabotage-physical/report.json');assert sabotage['status']=='passed' and sabotage['result']['status']=='failed'
assert 'high swizzle phase0 literal pixels' in sabotage['result']['failure']['message'] and '[64,0,191,0]' in sabotage['result']['failure']['message']
assert sabotage['errors']==physical['errors']
binding=sabotage['mutationBinding'];assert sha((V/'sabotage-physical/mutated-state.mjs').read_bytes())==binding['servedSha256']
assert (ROOT/binding['path']).read_bytes().replace(binding['needle'].encode(),binding['replacement'].encode())==(V/'sabotage-physical/mutated-state.mjs').read_bytes()
scratch=load(V/'scratch-boundaries.json');assert scratch=={'status':'passed','initialArenaFailures':12,'byteIdenticalRecoveries':12,'outsideHashSchedules':3}
pressure=load(V/'wasm-pressure.json');assert pressure['status']=='passed' and len(pressure['records'])==3 and len(pressure['pressure'])==9 and pressure['memoryBytes']==16777216
assert all(r['instructions']==768 and r['temporaries']==512 and r['constants']==128 and r['native']==r['wasm']for r in pressure['records'])
attacks=load(V/'boundary-attacks.json');assert attacks['status']=='passed' and len(attacks['records'])==7 and len(attacks['forged'])==4
assert all(r['native']==r['wasm']and not r['native']['ok']for r in attacks['records'])
assert all(not r['result']['ok']for r in attacks['forged'])
stack=(V/'unpacked/hot/stack/checked_tgsi_sanity.su').read_text();assert 'tgsi_sanity_check\t16\tstatic' in stack
promoted=['renderer/virgl-command/tests/vertex-constant-boundaries.mjs','renderer/virgl-shader/native_tests/tgsi_scratch_boundaries.c']
bindings=[{'path':p,'sha256':sha((ROOT/p).read_bytes())}for p in promoted]
report={'task':'E6-T11d1','verdict':'verified','sourceHead':'92c98c7361cad2518200bfa99765ed5895ef4f95',
 'workerSealAuthenticated':True,'physicalFramesAudited':30,'freshFrames':6,'freshPixelAssertions':len(physical['result']['assertions']),
 'changedFilesAudited':len(cov['files']),'changedLinesAudited':sum(len(f['rows'])for f in cov['files']),
 'runtimeGaps':0,'nativeArenaFailures':12,'exactNativeRecoveries':12,'wasmPressureSchedules':9,'maximalSeedCases':3,
 'sabotageOracleHeld':True,'boundaryAttacks':7,'forgedContracts':4,'promotedTests':bindings,
 'predictionResults':{p:'HELD'for p in ['P1','P2','P3','P4','P5','P6','P7','P8-revised','P9','P10']},
 'initialP8':'FAILED driver-active-prefix inference only; original source and failure preserved, then corrected before full-bank rerun. Complete actual native prefix remains the task oracle.',
 'limits':{'memoryBytes':16777216,'stackBytes':262144,'tgsiScratchBytes':262144,'textBytes':49152,'tokens':8192,'glslBytes':262144,'rawRegisters':46,'exactWords':184},
 'authority':'isolated ordinary vertex128 capacity, private/raw/fragment46 retained; no production capsets or live guest/FPS/MIPS/API-conformance claim'}
(V/'final-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items()if k not in ['promotedTests','predictionResults','limits']},indent=2))
