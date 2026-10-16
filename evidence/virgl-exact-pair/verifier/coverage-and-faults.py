#!/usr/bin/env python3
"""Cross-check original conditional children and actual compiler source faults."""
from pathlib import Path
from hashlib import sha256
import json,subprocess
root=Path(__file__).resolve().parents[3]
u=root/'evidence/virgl-exact-pair/verifier/unpacked'
hot=u/'hot';out=root/'evidence/virgl-exact-pair/verifier'
sha=lambda b:sha256(b).hexdigest()
coverage=json.loads((hot/'native/coverage.json').read_bytes())
bridge=next(f for d in coverage['data'] for f in d['files'] if f['filename'].endswith('/renderer/virgl-shader/bridge.c'))
changed_start=1925
branches=[b for b in bridge['branches'] if b[0]>=changed_start]
zeros=[]
for b in branches:
 for alt,n in [('true',b[4]),('false',b[5])]:
  if n==0: zeros.append({'line':b[0],'column':b[1],'alternative':alt})
assert len(branches)==55 and len(zeros)==4
assert sorted((x['line'],x['alternative']) for x in zeros)==[(1982,'true'),(2023,'true'),(2024,'true'),(2036,'true')]
source=(root/'renderer/virgl-shader/index.mjs').read_text()
start=len(source[:source.index('function pairExactComponents')].encode('utf-16-le'))//2
stop=len(source[:source.index('    translateExact(request)')].encode('utf-16-le'))//2
regions={}
for p in [*sorted((hot/'node-v8').glob('*.json')),*[hot/f'gpu-{s}/browser-coverage.json' for s in (1779033703,3144134277,1013904242)]]:
 data=json.loads(p.read_bytes())
 scripts=data['result'] if 'result' in data else [v['coverage'] for v in data['scripts']]
 for script in scripts:
  if not script['url'].endswith('/renderer/virgl-shader/index.mjs'):continue
  for function in script['functions']:
   for r in function['ranges']:
    if start<=r['startOffset']<stop:
     key=(function['functionName'],r['startOffset'],r['endOffset'])
     regions[key]=max(regions.get(key,0),r['count'])
assert len(regions)==92 and all(n>0 for n in regions.values())
# Original source must differ by exactly the one intentional semantic fault.
base=subprocess.check_output(['git','show','1bbbe70a7bb4c9a9cdc0c3113cbb6b6a1deba733:renderer/virgl-shader/bridge.c'],cwd=root,text=True)
needle='   if (!failed) failed = convert(vertex, inputs[0].text, lengths[0], &fragment->variable.fs_info);'
assert base.count(needle)==1
faults={}
for kind,addition in [
 ('interface','   if (!failed && vertex->owned_shader) for (char *p = vertex->owned_shader; (p = strstr(p, "vso_g0")); ++p) p[5] = \'1\';'),
 ('metadata','   if (!failed && vertex->profile.raw) vertex->profile.raw->exact = NULL;')]:
 altered=(u/'fault-source'/kind/'bridge.c').read_text()
 assert altered==base.replace(needle,needle+'\n'+addition)
 manifest=json.loads((u/'fault-source'/kind/'manifest.json').read_bytes())
 assert manifest['alteredSha256']==sha(altered.encode()) and manifest['originalSha256']==sha(base.encode())
 browser=json.loads((hot/f'fault-{kind}/report.json').read_bytes())
 served={e['path']:e['sha256'] for e in browser['servedFiles']}
 wasm=u/'fault-source'/kind/'virgl-shader.wasm'
 assert served[f'target/virgl-exact-pair-fault/{kind}/virgl-shader.wasm']==sha(wasm.read_bytes())
 assert browser['acceptance']['faultWasm']['sha256']==sha(wasm.read_bytes())
 assert browser['acceptance']['status']=='failed'
 contradictions=json.loads((hot/f'capture-fault-{kind}.json').read_bytes())['contradictions']
 assert len(contradictions)==3 and any(c['kind']=='physical paired interface rejected' for c in contradictions)
 faults[kind]={'sourceSha256':sha(altered.encode()),'wasmSha256':sha(wasm.read_bytes()),'contradictionPoints':[c['point'] for c in contradictions]}
result={'task':'E6-T12g6m3c','status':'passed','nativeConditionalAlternatives':len(branches)*2,'executedNativeAlternatives':len(branches)*2-len(zeros),'waivedNativeAlternatives':zeros,'v8ConditionalRegions':len(regions),'hitV8ConditionalRegions':sum(n>0 for n in regions.values()),'faults':faults,'originalCoverageSha256':sha((hot/'native/coverage.json').read_bytes())}
(out/'coverage-and-faults.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
