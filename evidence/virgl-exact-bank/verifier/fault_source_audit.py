#!/usr/bin/env python3
"""Interrogate the actual retained served fault bytes, not a reconstructed receipt."""
from pathlib import Path
import hashlib
import json

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
UNPACKED=OUT/'unpacked'
directory='target/virgl-exact-bank-fault'
needle='checked.words[entry.register * 4 + entry.component] !== entry.word'
original=(ROOT/'renderer/virgl-command/constant-domain.mjs').read_bytes()
assert original.count(needle.encode())==1
expected_domain=original.replace(needle.encode(),(needle+' && false').encode())
state=(ROOT/'renderer/virgl-command/state.mjs').read_text()
expected_state=state.replace('"./decoder.mjs"','"/renderer/virgl-command/decoder.mjs"').replace('"../virgl-shader/index.mjs"','"/renderer/virgl-shader/index.mjs"').replace('"./constant-domain.mjs"',f'"/{directory}/constant-domain.mjs"').encode()
sha=lambda raw:hashlib.sha256(raw).hexdigest()
points=[]
for prefix,actual_prefix in [('hot','fault-source'),('cold/acceptance','cold-fault-source')]:
    report=json.loads((UNPACKED/prefix/'fault/report.json').read_bytes())
    actual_domain=(UNPACKED/actual_prefix/'constant-domain.mjs').read_bytes()
    actual_state=(UNPACKED/actual_prefix/'state.mjs').read_bytes()
    assert actual_domain==expected_domain and actual_state==expected_state
    f=report['faultSources']
    assert f['needle']==needle and f['originalSha256']==sha(original) and f['alteredSha256']==sha(actual_domain)
    assert f['stateSha256']==sha(actual_state)
    for name,raw in [('constant-domain.mjs',actual_domain),('state.mjs',actual_state)]:
        served=next(e for e in report['servedFiles'] if e['path']==directory+'/'+name)
        assert served['sha256']==sha(raw) and served['size']==len(raw)
    envelope=json.loads((UNPACKED/prefix/'fault/browser-coverage.json').read_bytes())
    entry=next(s for s in envelope['scripts'] if s['source']==directory+'/constant-domain.mjs')
    assert entry['sha256']==sha(actual_domain)
    fun=next(f for f in entry['coverage']['functions'] if f['functionName']=='checkExactBank')
    assert fun['ranges'][0]['count']>0
    attack=report['acceptance']['rigs'][0]['attacks'][0]
    assert attack['result']['ok'] and len(attack['result']['draws'])==1
    points.append({'prefix':prefix,'domainSha256':sha(actual_domain),'stateSha256':sha(actual_state),
                   'actualGuardFunctionCount':fun['ranges'][0]['count'],
                   'capturePoint':'acceptance.rigs[0].attacks[0]','onlySemanticMutation':'exact inequality disabled',
                   'stateChanges':'only import URLs needed to select the actual scratch guard'})
result={'task':'E6-T12g6m3a','prediction':'P5','status':'HELD','actualServedFaultBytesAuthenticated':True,'points':points}
(OUT/'fault-source-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
