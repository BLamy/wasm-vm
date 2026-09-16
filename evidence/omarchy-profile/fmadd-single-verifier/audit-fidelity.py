#!/usr/bin/env python3
"""Bind actual AN protocol and sources to AM; no new guest execution."""
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import hashlib
import json
import subprocess

repo=Path(__file__).resolve().parents[3];out=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
read=lambda p:json.loads((repo/p).read_text())
am_path='evidence/omarchy-profile/prepared-recycling-input-r1/desktop/report.json'
an_path='evidence/omarchy-profile/fmadd-single-r1/physical-input/desktop/report.json'
am,an=read(am_path),read(an_path)
assert sha((repo/am_path).read_bytes())=='bbf79415de6f4d93e38e74d510cd209ca934cbe6167d84edcfacd317abcf6dc4'
assert sha((repo/an_path).read_bytes())=='31b9e015b5f16c70cff14342357c77704e371294bec9a050c52f2e2139ae8fea'
fields=['arm','recycling','experiment','jitResidencyPolicy','jitResidencyCap',
        'startupMs','typingMs','readbackMs','captureMs','cleanupMs',
        'profilingRequested','admissionProbeRequested']
for key in fields:assert am['trial'][key]==an['trial'][key],key
roles=['kernel','bootSnapshot','overlayDelta','chunkManifest','image']
for role in roles:assert am['candidate']['source'][role]==an['candidate']['source'][role],role
aq,bq=[parse_qs(urlsplit(r['url']).query) for r in [am,an]]
aq.pop('omarchyAssetBase');bq.pop('omarchyAssetBase');assert aq==bq
before=(repo/'tools/verify/omarchy-prepared-recycling-input.mjs').read_text()
after=(repo/'tools/verify/omarchy-fmadd-input.mjs').read_text()
replacements={
 'PREPARED_DIRECT_IDENTITIES, PREPARED_DIRECT_WASM,':'PREPARED_DIRECT_IDENTITIES,',
 'const repo =':'const FMADD_WASM = "0f9b1213fa160f31d4f35503f6b35b4caf7193668eac3c369ac4a75611b6fced";\nconst repo =',
 'usage: omarchy-prepared-recycling-input.mjs':'usage: omarchy-fmadd-input.mjs',
 'PREPARED_DIRECT_WASM, "trial requires verified AL runtime"':'FMADD_WASM, "trial requires frozen FMADD runtime"',
 'prepared-pair-existing-recycling-candidate':'prepared-pair-fmadd-single-runtime'}
for old,new in replacements.items():
    assert before.count(old)==1,old
    before=before.replace(old,new)
assert before==after,'Unaccounted physical wrapper behavior changed'
head=an['trial']['head']
for name,pin in an['trial']['helpers'].items():
    data=subprocess.check_output(['git','show',head+':'+name],cwd=repo)
    assert len(data)==pin['size'] and sha(data)==pin['sha256'],name
served=[]
for row in an['resourceIdentities']:
    path=row.get('repoPath')
    if path and path.startswith('web/'):
        data=subprocess.check_output(['git','show',head+':'+path],cwd=repo)
        assert sha(data)==row['sha256'],path
        served.append(path)
rts=[r['runtime'] for r in an['observations'] if 'runtime' in r]
first,last=rts[0],rts[-1]
for rt in rts:
    assert all(rt['inputDevice'][key]==0 for key in ['pendingEvents','pendingFrames','droppedFrames','droppedEvents','rejectedEvents'])
retired=last['jit']['guestRetired']-first['jit']['guestRetired']
jit=last['jit']['retiredViaJit']-first['jit']['retiredViaJit']
images=[repo/'evidence/omarchy-profile/fmadd-single-r1/physical-input/desktop'/name
        for name in ['desktop.png','prepared-direct.png','failure.png']]
assert len({sha(p.read_bytes()) for p in images})==1
receipt={'passed':True,'head':head,'sameTrialFields':fields,'sameSourceRoles':roles,
         'sameQueriesExceptOwnedOrigin':aq,'wrapperOnlyChanges':replacements,
         'helpersBoundToCommittedHead':len(an['trial']['helpers']),
         'servedWebFilesBoundToCommittedHead':served,
         'inputQueuesEmptyWithoutDrops':True,'frames':[first['presentation']['framesReceived'],last['presentation']['framesReceived']],
         'intervalRetired':retired,'intervalJitRetired':jit,'intervalJitShare':jit/retired,
         'guestClockTicksAdvanced':int(last['clock']['mtime'])-int(first['clock']['mtime']),
         'clockTimebaseHz':last['clock']['timebaseHz'],
         'identicalImageSha256':sha(images[0].read_bytes()),
         'desktopResponsive':False,'performanceClaim':'No speedup inference from one negative trial.'}
(out/'physical-fidelity.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
