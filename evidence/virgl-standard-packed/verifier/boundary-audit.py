#!/usr/bin/env python3
"""Independent retained-state, limits, compiler and carry point checks."""
from pathlib import Path
import hashlib,json
HERE=Path(__file__).resolve().parent
sha=lambda raw:hashlib.sha256(raw).hexdigest()
rows=[]
for family,name in [('hot','unpacked/hot/hardware/report.json'),('cold','unpacked/cold/hardware/report.json'),('promoted','promoted/hardware/report.json')]:
 raw=(HERE/name).read_bytes();r=json.loads(raw)['browserResult']['result'];pin=sha(raw)
 for ordinal,x in enumerate(r['suspensions']):
  p=x['point']['inspection'];res=x['record']['result'];assert p['jobs']['status']==x['phase'] and p['jobs']['active']==1
  assert p['jobs']['normalizedBuffers']==p['jobs']['normalizedBytes']==p['jobs']['normalizationScratchBytes']==0
  if family=='promoted':assert p['jobs']['reads']==3 and p['jobs']['stagingBytes']==26
  else:assert (p['jobs']['reads'],p['jobs']['stagingBytes'])==((1,6) if x['phase']=='waiting-index' else (2,10))
  assert res['gpuComplete'] is True
  if x['action']=='reuse':
   assert res['ok'] is True and len(res['draws'])==1
   # Original literal setup order gives shared3/gen4 or separate4/gen5.
   # Public name replacement must not select its newly allocated generation.
   draw=res['draws'][0]
   for f in draw['vertexFetches']:
    if f['sourceFormat'] in [8,123,172,173]:assert (f['resourceId'],f['resourceGeneration'])==((3,4) if family=='promoted' else (4,5))
  else:
   assert res['ok'] is False and not res['draws'];assert res['error']['code']==('cancelled' if x['action']=='cancel' else 'stale-storage')
  rows.append(dict(family=family,kind='pending',ordinal=ordinal,reportSha256=pin,phase=x['phase'],action=x['action'],reads=p['jobs']['reads'],stagingBytes=p['jobs']['stagingBytes'],outcome=res.get('error',{}).get('code','passed'),completedFence=True,draws=len(res['draws'])))
 for ordinal,x in enumerate(r['rejections']):
  rec=x['record'];res=rec['result'];assert res['ok'] is False and not res['draws'] and res['gpuComplete'] is True
  if rec['label'] in ['short-compact-staging','packed-short-work']:assert res['error']['code']=='limit-exceeded'
  if rec['label']=='short-compact-staging':assert not any(e['name']=='copyBufferSubData' for e in x['events'])
  rows.append(dict(family=family,kind='pre-draw-rejection',ordinal=ordinal,label=rec['label'],reportSha256=pin,error=res['error']['code'],draws=0))
 for ordinal,x in enumerate(r['ownership']):
  if x['phase']=='waiting-attributes':
   assert x['before']['jobs']['status']=='waiting-attributes' and x['before']['jobs']['reads']>0
   assert x['after']['reads']==x['after']['transfers']==x['after']['stagingBytes']==0
   rows.append(dict(family=family,kind='disposal',ordinal=ordinal,reportSha256=pin,after=x['after']))
  else:
   expected=([dict(zip(['signedMask','unsignedMask','packedSignedMask','packedNormalizedMask'],v)) for v in
    ([[0,0,32770,32768],[0,0,32770,2],[0,0,32768,0],[0,0,0,0]] if family=='promoted' else [[0,0,2,0],[0,0,2,2],[0,0,0,0]])])
   if x['evict']:expected.append(expected[0])
   assert x['requests']==expected;assert (x['programs'][0]==x['programs'][-1]) is (not x['evict'])
   rows.append(dict(family=family,kind='cache-variants',ordinal=ordinal,reportSha256=pin,evict=x['evict'],requests=x['requests'],programs=x['programs']))
 for x in r['runs']:
  jobs=x['inspection']['jobs'];assert jobs['active']==jobs['reads']==jobs['stagingBytes']==jobs['normalizedBuffers']==jobs['normalizedBytes']==jobs['normalizationScratchBytes']==0
  fence=[e['sync'] for e in x['events'] if e['name']=='fenceSync'];deleted=[e['sync'] for e in x['events'] if e['name']=='deleteSync']
  assert sorted(fence)==sorted(deleted),'all actual native fences retired'
 rows.append(dict(family=family,kind='retained-jobs-drained',reportSha256=pin,runs=len(r['runs']),normalizedBuffers=0,reads=0,stagingBytes=0,allNativeFencesRetired=True))
for family in ['hot','cold']:
 base=HERE/'unpacked'/family
 for directory,count in [('native',59),('typed-retained',48)]:
  raw=(base/directory/'node.json').read_bytes();r=json.loads(raw)
  assert r['status']=='passed' and r['cases']==count and r['exactNativeWasm'] and r['peerIsolation'] and r['getters']==0
  assert r['pressure']['bytes']==16777216 and r['pressure']['recovered']
  allocations=(base/directory/'allocations.jsonl').read_bytes();a=[json.loads(s) for s in allocations.splitlines()];s=a[-1]
  assert s['faults']==s['recoveries']==40 and s['callerMutation'] and not s['partialResults']
  for mode in [0,1]:
   for kind,limit in [('upstream-fault',15),('calloc-fault',5)]:assert [r['site'] for r in a if r['kind']==kind and r['mode']==mode]==list(range(1,limit+1))
  assert (base/directory/'native.jsonl').read_bytes()==(base/directory/'sanitize.jsonl').read_bytes()
  rows.append(dict(family=family,kind='compiler-and-allocations',directory=directory,nodeSha256=sha(raw),allocationSha256=sha(allocations),cases=count,faults=40,recoveries=40,callerMutation=True,getters=0,fixedMemoryBytes=16777216,peerIsolation=True))
 receipt=json.loads((base/'receipt.json').read_text());compiler=json.loads((base/'compiler-retained/receipt.json').read_text())
 assert compiler['cases']==669 and compiler['frames']==129 and compiler['legacyBoundary']['unchanged']
 assert receipt['packedCompilerStack']['conservativeBytes']==191856<262144
 assert len(receipt['carriedVerifiedEvidence'])==199
 rows.append(dict(family=family,kind='retained-compiler-and-stack',standardCases=669,standardHardwareFrames=129,stackBytes=191856,stackLimit=262144,carriedVerifiedRecords=199,sourceHead=receipt['gitHead']))
(HERE/'boundary-audit.jsonl').write_text('\n'.join(json.dumps(r) for r in rows)+'\n')
print(json.dumps(dict(status='passed',points=len(rows))))
