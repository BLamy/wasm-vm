#!/usr/bin/env python3
import hashlib,json,pathlib,subprocess,tarfile
repo=pathlib.Path(__file__).resolve().parents[3]
out=pathlib.Path(__file__).resolve().parent
reopen=repo/'target/evidence/virgl-desktop-control-verifier/reopened'
reopen.mkdir(parents=True,exist_ok=True)
frozen='e13dddfbb0d955abb268e4b4ac07828cbea35956'
submission='0186b314c591d066227541ce5d3965eb9edad723'
def digest(b): return hashlib.sha256(b).hexdigest()
def reopen_seal(directory,label,manifest_digest=None,extract=False):
    mr=(directory/'manifest.json').read_bytes(); ir=(directory/'records.json').read_bytes(); ar=(directory/'recording.tar.gz').read_bytes()
    m=json.loads(mr); index=json.loads(ir); rows=index['records'] if isinstance(index,dict) else index
    if manifest_digest: assert digest(mr)==manifest_digest
    assert digest(ir)==m['recordIndexSha256'] and digest(ar)==m['archiveSha256']
    assert len(ar)==m['archiveBytes'] and len(rows)==m['records']
    expected={r['path']:r for r in rows}; assert len(expected)==len(rows)
    bodies={}; pins=[]
    with tarfile.open(directory/'recording.tar.gz','r:gz') as archive:
        members=archive.getmembers(); assert len(members)==len(rows) and {x.name for x in members}==set(expected)
        for member in members:
            assert (member.isfile() or member.islnk()) and not pathlib.PurePosixPath(member.name).is_absolute() and '..' not in pathlib.PurePosixPath(member.name).parts
            if member.islnk(): assert member.linkname in expected and not pathlib.PurePosixPath(member.linkname).is_absolute() and '..' not in pathlib.PurePosixPath(member.linkname).parts
            raw=archive.extractfile(member).read(); r=expected[member.name]
            assert len(raw)==r['bytes'] and digest(raw)==r['sha256'],member.name
            bodies[member.name]=raw
            pins.append(r)
            if extract:
                p=reopen/label/member.name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
    return m,bodies,{'label':label,'manifestSha256':digest(mr),'indexSha256':digest(ir),'archiveSha256':digest(ar),'archiveBytes':len(ar),'reopenedBodies':len(rows),'bodies':pins}
m,bodies,seal=reopen_seal(repo/'evidence/virgl-desktop-control/worker','worker','39c771aa285e5b215c26e92099f77fb63b5695d9a2ba62fe25001e47ec1da680',True)
assert m['head']==frozen and len(bodies)==665
hot=json.loads(bodies['hot/receipt.json']); cold=json.loads(bodies['cold/recording/receipt.json']); cr=json.loads(bodies['cold/report.json'])
assert hot['head']==cold['head']==cr['head']==frozen
assert hot['sources']==cold['sources'] and hot['carriedHostSources']==cold['carriedHostSources']
assert not cr['cleanBefore'] and not cr['cleanAfter'] and cr['exitCode']==0
assert digest(bodies['cold/recording/receipt.json'])=='ed668a0b73c3c97100dd6be9684743705ae5b6c446ad5a27f52a2af2d3ec43c7'
for prefix,receipt in [('hot',hot),('cold/recording',cold)]:
    assert len(receipt['commands'])==20
    for c in receipt['commands']:
        assert c['exitCode']==c['expected'],c['name']
        for stream in ['stdout','stderr']:
            assert digest(bodies[f"{prefix}/{c['name']}.{stream}"])==c[f'{stream}Sha256']
    for name,pin in receipt['sources'].items():
        raw=bodies[f'{prefix}/sources/{name}']; assert len(raw)==pin['bytes'] and digest(raw)==pin['sha256']
        assert raw==(repo/name).read_bytes()==subprocess.check_output(['git','show',f'{frozen}:{name}'],cwd=repo),name
    for name,pin in receipt['unchangedDefaultWebGuestSources'].items():
        assert digest((repo/name).read_bytes())==pin==digest(subprocess.check_output(['git','show',f'cf184d42823dd4d0d3640482d9b1379181d364fe:{name}'],cwd=repo)),name
    for name,pin in receipt['carriedHostSources'].items(): assert digest((repo/name).read_bytes())==pin,name
assert len(hot['carriedHostSources'])==303
held=[]
for pin in m['dependencySeals']:
    dm,db,ds=reopen_seal(repo/'evidence/virgl-resource-capacity'/pin['role'],'D50-'+pin['role'],pin['manifestSha256'])
    assert ds['indexSha256']==pin['indexSha256'] and ds['archiveSha256']==pin['archiveSha256'] and ds['reopenedBodies']==pin['reopenedBodies']
    if pin['role']=='worker':
        d50=json.loads(db['hot/receipt.json'])
        carried={k:v for k,v in {**d50['sources'],**d50['carriedSources']}.items() if k.startswith('renderer/')}
        assert carried==hot['carriedHostSources']
    held.append(ds)
assert sum(d['reopenedBodies'] for d in held)==1007
assert digest((repo/'renderer/virgl-command/resources.mjs').read_bytes())=='23dcd1d6260e4d439d851432e21c56edd0194bff1cf086ddb5f2da0a616db4f0'
depdir=repo/'evidence/virgl-desktop-control/deployment'; draw=(depdir/'manifest.json').read_bytes(); dep=json.loads(draw)
assert digest(draw)=='074646eae55cfe26cbfe0d2543cc13c9e08cb854bf2a55da793ab1a0a6b7f6e9'
assert dep['head']==frozen
for pin in dep['files']:
    raw=(depdir/pin['path']).read_bytes();assert len(raw)==pin['bytes'] and digest(raw)==pin['sha256'],pin['path']
wasm=(repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes();assert len(wasm)==1634057 and digest(wasm)=='5ecbc124be68e42a708d18f6aaf49c94793a7d9b1c757f9922dab78c7951c4d8'
assert wasm==subprocess.check_output(['git','show',f'{frozen}:web/dist/pkg/wasm_vm_wasm_bg.wasm'],cwd=repo)
report={'schema':'desktop-control-critic-authentication-v1','submissionHead':submission,'frozenHead':frozen,'worker':seal,'heldD50':held,'carriedHostSources':hot['carriedHostSources'],'sourceBodies':len(hot['sources']),'coldReceiptSha256':digest(bodies['cold/recording/receipt.json']),'coldReport':cr,'deployment':dep,'deploymentManifestSha256':digest(draw),'wasmSha256':digest(wasm),'guestExecution':False,'productionAuthority':False}
(out/'authentication.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'reopenedWorkerBodies':len(bodies),'heldD50Bodies':sum(x['reopenedBodies'] for x in held),'sourceBodies':len(hot['sources']),'carriedSources':len(carried),'coldHead':cold['head'],'reopenDirectory':str(reopen)}))
