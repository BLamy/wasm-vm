#!/usr/bin/env python3
"""Independently validate actual GPU proof, then falsify scalar observation types."""
import copy,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'tools/virgl-indirect-constants'))
import browser_receipt as verifier
source=pathlib.Path(sys.argv[1]).resolve()
def read(p):return json.loads(p.read_bytes())
native=read(source/'native/native-report.json');report=read(source/'hardware/report.json');fixture=read(ROOT/verifier.FIXTURE)
cases={e['name']:e['result'] for e in native['cases']};pairs={e['name']:e['result'] for e in native['pairs']};originals={e.get('sha256',e.get('inputSha256')):e['result'] for e in native['originals']}
verifier.verify_proof(report['acceptance'],fixture,cases,pairs,originals)
results=[]
for name,mutate in [('draws-float',lambda p:p.update(drawCount=float(p['drawCount']))),('source-access-slot-bool',lambda p:next(x for x in p['shaderFixtures'] if x['name']=='raw-vertex')['result']['metadata']['constantAccesses'][0].update(slot=False)),('word-bool',lambda p:p['rigs'][0]['atlases'][0]['pages'][0]['observedWords'].__setitem__(0,True))]:
 proof=copy.deepcopy(report['acceptance']);mutate(proof)
 try:verifier.verify_proof(proof,fixture,cases,pairs,originals)
 except ValueError as error:results.append({'name':name,'status':'HELD','rejection':str(error)})
 else:results.append({'name':name,'status':'FAILED'})
(OUT/'browser-receipt-attacks.json').write_text(json.dumps({'schema':1,'head':report['gitHead'],'control':'passed','results':results},indent=2)+'\n')
assert all(x['status']=='HELD' for x in results)
print('Browser clean control and all three deliberate observation-type corruptions held.')
