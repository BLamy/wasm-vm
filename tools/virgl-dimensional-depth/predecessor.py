#!/usr/bin/env python3
"""Reopen authenticated D58, D56 and D54 bodies; restore only the proven compiler."""
import hashlib,io,json,subprocess,sys,tarfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2];out=Path(sys.argv[1]).resolve();out.mkdir(parents=True)
base='fa4692ab33c0bd91e4d2cedddc8003df29354108';sha=lambda b:hashlib.sha256(b).hexdigest()
pins={
 'virgl-dimensional-views/worker':'0d33df88ff4eab46b34d7c376fda9f4d69ae1120c6bba9e82a3fd468e8afd135',
 'virgl-dimensional-views/verifier':'bf8aaeb347ad4aead9304fbfc4759fe74f1e622328f0399fc13c3b412318d590',
 'virgl-dimensional-views/archive-transport-verifier':'b2b93f53f8fe0029e20cb506b33aac01406f2a5151d36601804cf334c5f88591',
 'virgl-native-dimensional/worker':'7c8fb3ab46b3659ce855e77a80afc161a14f808b491a6753caa6c53231b0d0e6',
 'virgl-native-dimensional/verifier':'d290f464b5be7dbd39e01cc588aa9d4ed580bb4d7e688c345443e86e87ec2dc5',
 'virgl-native-image/worker':'760e7cec92d98d9cf2104e534f296429d6f8305e0d24e013a62c4eff91dfd624',
 'virgl-native-image/verifier':'08394b2a36a9f01e375584e12afbc5b42c46aad7da5709be107dd2a09789ecac'}
dependencies=[];generated={};held={}
for family,digest in pins.items():
    directory=repo/'evidence'/family
    if not directory.exists() and family.endswith('/archive-transport-verifier'):
        directory=repo/'evidence/virgl-dimensional-views/transport-verifier'
    relative=directory.relative_to(repo).as_posix();manifest_raw=(directory/'manifest.json').read_bytes()
    assert manifest_raw==subprocess.check_output(['git','show',base+':'+relative+'/manifest.json'],cwd=repo)
    assert sha(manifest_raw)==digest,(family,sha(manifest_raw))
    manifest=json.loads(manifest_raw);index_raw=(directory/'records.json').read_bytes();index=json.loads(index_raw);rows=index['records'] if isinstance(index,dict) else index
    assert sha(index_raw)==manifest['recordIndexSha256']
    if 'archiveParts' in manifest:
        chunks=[]
        for part in manifest['archiveParts']:
            chunk=(directory/part['path']).read_bytes();assert len(chunk)==part['bytes'] and sha(chunk)==part['sha256'];chunks.append(chunk)
        archive_raw=b''.join(chunks);del chunks
    else:archive_raw=(directory/'recording.tar.gz').read_bytes()
    assert len(archive_raw)==manifest['archiveBytes'] and sha(archive_raw)==manifest['archiveSha256']
    with tarfile.open(fileobj=io.BytesIO(archive_raw),mode='r:gz') as archive:
        assert archive.getnames()==[r['path'] for r in rows]
        for pin in rows:
            raw=archive.extractfile(pin['path']).read();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256'],pin['path']
            name=pin['path']
            if family=='virgl-dimensional-views/worker':
                if name.startswith('cold/recording/hardware-27449/source/renderer/virgl-shader/build/wasm/'):
                    generated[name.split('/source/',1)[1]]=raw
                if name.startswith('cold/recording/') and name.endswith('/browser-coverage.json') and '/fault-' not in name and len(Path(name).parts)==4:
                    file=out/'held-coverage'/family/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
                if name=='cold/recording/receipt.json':
                    receipt=json.loads(raw);held=receipt['sources'];(out/'held-receipt.json').write_bytes(raw)
    for name,raw in [('manifest.json',manifest_raw),('records.json',index_raw)]:
        file=out/family/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
    dependencies.append(dict(family=family,manifestSha256=sha(manifest_raw),indexSha256=sha(index_raw),archiveSha256=sha(archive_raw),reopenedBodies=len(rows)))
    print('authenticated '+family+': '+str(len(rows))+' complete bodies',flush=True)
assert set(generated)=={'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
for relative,raw in generated.items():
    file=repo/relative
    if file.exists():assert file.read_bytes()==raw,relative
    else:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
assert not subprocess.check_output(['git','diff','--name-only',base,'--','renderer/virgl-shader','Cargo.toml','Cargo.lock'],cwd=repo)
result=dict(schema='dimensional-depth-held-v1',base=base,dependencies=dependencies,generated={p:dict(bytes=len(v),sha256=sha(v)) for p,v in generated.items()},heldSourcePins=held,productionAuthority=False)
(out/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(status='passed',reopenedBodies=sum(v['reopenedBodies'] for v in dependencies))))
