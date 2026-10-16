from pathlib import Path
import hashlib,json,subprocess,tarfile
ROOT=Path.cwd(); V=ROOT/'evidence/virgl-vertex-constant/verifier'; U=V/'unpacked'; old=ROOT/'evidence/virgl-render-cache/verifier'
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((old/'manifest.json').read_bytes());index_bytes=(old/'records.json').read_bytes();index=json.loads(index_bytes)
assert manifest['verdict']=='verified' and manifest['archiveSha256']==sha((old/'recording.tar.gz').read_bytes())=='c6932986a04f4382148547ee5f06720fc496f0dce932eedb6f9b7c4e8a35105c'
assert manifest['recordIndexSha256']==sha(index_bytes)=='55037f473afd9ac72ec791625dd100067ebb20e57f8e07af9543f1429aed2f1f'
rows={r['path']:r for r in index['records']}
with tarfile.open(old/'recording.tar.gz')as tar:
    assert len(tar.getmembers())==len(rows)==55
    for m in tar.getmembers():
        b=tar.extractfile(m).read();assert m.name in rows and len(b)==rows[m.name]['bytes'] and sha(b)==rows[m.name]['sha256']
names=['renderer/virgl-command/cache.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/tests/cache-boundaries.mjs',
       'renderer/virgl-command/tests/render-cache.mjs','renderer/virgl-command/tests/raster-depth.mjs','renderer/virgl-command/tests/state-acceptance.mjs',
       'renderer/virgl-command/tests/inline-uploads.mjs','renderer/virgl-command/tests/async-acceptance.mjs','renderer/virgl-command/tests/draw-acceptance.mjs',
       'renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_bits.h','renderer/virgl-shader/checked_upstream.c']
boundaries=[]
for name in names:
    a=subprocess.check_output(['git','show','fcb908e7:'+name]);b=subprocess.check_output(['git','show','92c98c73:'+name]);assert a==b
    boundaries.append({'source':name,'sha256':sha(a),'unchangedFromVerifiedParent':True})
retained=[]
for prefix in ['hot','cold']:
    d=U/prefix;receipt=json.loads((d/'regression/receipt.json').read_bytes());promoted=json.loads((d/'promoted-cache/report.json').read_bytes())
    assert receipt['status']=='passed' and receipt['originalToggleDraws']==10000 and receipt['hashCollisionSurvived']
    assert promoted['status']=='passed' and promoted['result']['status']=='passed' and len(promoted['result']['schedules'])==3
    assert all(a['held']for a in promoted['result']['assertions'])
    held=receipt['files'];reports=[]
    for name,digest in held.items():
        raw=(d/'regression'/name).read_bytes();assert sha(raw)==digest
        if name.endswith('report.json'):reports.append({'path':name,'sha256':digest})
    retained.append({'prefix':prefix,'receiptSha256':sha((d/'regression/receipt.json').read_bytes()),'currentExactSourceHead':receipt['gitHead'],
      'originalToggleDraws':receipt['originalToggleDraws'],'physicalPixels':receipt['physicalPixels'],'nativeAssertions':receipt['nativeAssertions'],
      'hardwareAssertions':receipt['hardwareAssertions'],'hashCollisionSurvived':True,'threePromotedSchedules':promoted['result']['schedules'],
      'promotedAssertions':len(promoted['result']['assertions']),'reports':reports})
layout=json.loads((U/'hot/compiler-native/report.json').read_bytes())['layout']
assert layout['ir']==111752 and layout['profile']==32448 and layout['conversion']==33592 and layout['pairConversions']==67184
report={'task':'E6-T11d1','status':'HELD','verifiedParent':'fcb908e756a5e2fe7eb6f29864e23b0e46652b37','priorVerifiedCriticArchiveSha256':manifest['archiveSha256'],
 'priorVerifiedCriticIndexSha256':sha(index_bytes),'boundaries':boundaries,'retained':retained,'layout':layout,
 'scope':'Carry I/H/G5/resource/transfer/state/cache proof leaves; only changed constant decoding/reflection/compiler profile and TGSI allocation boundary are re-audited. The profile/raw header is byte-identical to the verified exact-bank pointer layout. Current hot/cold regression receipts re-bind affected outputs to the new source.'}
(V/'carry-forward.json').write_text(json.dumps(report,indent=2)+'\n')
print('HELD: authenticated previous55-record critic seal,12 unchanged boundaries, current I/H/G5 leaves and3 cache schedules')
