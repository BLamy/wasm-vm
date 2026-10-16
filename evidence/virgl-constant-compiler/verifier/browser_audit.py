#!/usr/bin/env python3
import sys,json,copy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/virgl-constant-compiler'))
import browser_receipt,faults
out=ROOT/'evidence/virgl-constant-compiler/worker';head='f81c83b7444e3e5d8d7e52d9daa04adf1a209fc2';native=json.loads((out/'native/native-report.json').read_bytes());manifest=json.loads((out/'fault-artifacts/manifest.json').read_bytes())
audit=browser_receipt.verify(out,head,native,manifest);fault=faults.verify(out/'fault-artifacts',head,{e['inputSha256']:e['result'] for e in native['cases']})
fixture=json.loads((ROOT/browser_receipt.FIXTURE).read_text());cases={e['name']:e['result'] for e in native['cases']};pairs={e['name']:e['result'] for e in native['pairs']};originals={e['sha256']:e['result'] for e in native['originals']};proof=json.loads((out/'hardware/report.json').read_bytes())['acceptance']
attacks=[]
def attack(name,fn):
 clone=copy.deepcopy(proof);fn(clone);assert clone!=proof,'attack must actually alter proof'
 try:browser_receipt.verify_proof(clone,fixture,cases,pairs,originals)
 except Exception as e:attacks.append({'name':name,'caught':True,'diagnostic':str(e)})
 else:attacks.append({'name':name,'caught':False})
attack('raw-plane-one-bit',lambda p:p['rigs'][0]['atlases'][0]['rgbaBytes'].__setitem__(0,255-p['rigs'][0]['atlases'][0]['rgbaBytes'][0]))
attack('strip-actual-compiler-obligation',lambda p:next(e for e in p['shaderFixtures'] if 'constantDomains' in e['result']['metadata'])['result']['metadata'].pop('constantDomains'))
attack('forge-current-bank',lambda p:p['rigs'][0]['atlases'][0]['bindings']['constants'][0].__setitem__(0,0x7f800000))
attack('remove-observed-native-draw',lambda p:p['rigs'][0]['glEvents'].pop(next(i for i,e in enumerate(p['rigs'][0]['glEvents']) if e['call']=='drawElements')))
attack('inject-renderer-shader',lambda p:next(e for e in p['rigs'][0]['glEvents'] if e['call']=='shaderSource').__setitem__('source','void main(){}'))
attack('change-geometry-index',lambda p:p['rigs'][0]['geometry']['indexWords'].__setitem__(0,1))
attack('forge-native-uniform-readback',lambda p:next(e for e in p['rigs'][0]['glEvents'] if e['call']=='uniform4uiv')['observed'].__setitem__(0,0))
attack('omit-async-schedule',lambda p:p['rigs'][-1].pop('schedule'))
assert all(a['caught'] for a in attacks),attacks
summary={'sourceHead':head,'browser':audit,'faults':fault,'recordTamperAttacks':attacks}
Path(__file__).with_name('browser-audit.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'modes':audit['modes'],'tamperAttacks':attacks},indent=2))
