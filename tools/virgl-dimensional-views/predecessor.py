#!/usr/bin/env python3
"""Authenticate complete predecessor evidence and restore only exact proven bytes."""
import hashlib,json,subprocess,sys,tarfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2];out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
base='deb7b3113f9adeb2e6e80449a6710dd3295093ea';sha=lambda b:hashlib.sha256(b).hexdigest()
pins={
 'virgl-production-readiness/dimensional-sampler-view-gap':'b76764f40ad62136a835869e1adb88650ae58f8b6a56ce0284c42b8ff9f8c530',
 'virgl-dimensional-shaders/worker':'0c698861a17b341265e35b6c6d223ea0390ea495cb942c0e469d4ecb1201602f',
 'virgl-dimensional-shaders/verifier':'acd8e069a0145f98a800aa6f496beba2f0d5b1ba3f29dc42e674ce556b4c0843',
 'virgl-native-dimensional/worker':'7c8fb3ab46b3659ce855e77a80afc161a14f808b491a6753caa6c53231b0d0e6',
 'virgl-native-dimensional/verifier':'d290f464b5be7dbd39e01cc588aa9d4ed580bb4d7e688c345443e86e87ec2dc5'}
dependencies=[];generated={};receipts={};old_sources={}
for family,digest in pins.items():
    directory=repo/'evidence'/family;manifest_raw=(directory/'manifest.json').read_bytes()
    seal_head='aa2190f01f15c1458f4f595de03747fcf5ac4cf4' if family.endswith('dimensional-sampler-view-gap') else base
    assert manifest_raw==subprocess.check_output(['git','show',seal_head+':evidence/'+family+'/manifest.json'],cwd=repo)
    # Pin both the recorded content and the independently verified Git ancestor.
    assert sha(manifest_raw)==digest,(family,sha(manifest_raw),digest)
    manifest=json.loads(manifest_raw);index_raw=(directory/'records.json').read_bytes();index=json.loads(index_raw);rows=index['records'] if isinstance(index,dict) else index
    assert sha(index_raw)==manifest['recordIndexSha256'];archive_raw=(directory/'recording.tar.gz').read_bytes();assert sha(archive_raw)==manifest['archiveSha256']
    with tarfile.open(directory/'recording.tar.gz','r:gz') as archive:
        assert archive.getnames()==[r['path'] for r in rows]
        for pin in rows:
            raw=archive.extractfile(pin['path']).read();assert len(raw)==pin['bytes'] and sha(raw)==pin['sha256'],pin['path']
            name=pin['path']
            if family.endswith('dimensional-sampler-view-gap'):
                if name=='report.json':(out/'baseline.json').write_bytes(raw)
                if name.startswith('source/') and name.endswith('.mjs'):old_sources[name.removeprefix('source/')]=raw
                if name.startswith('source/renderer/virgl-shader/build/wasm/'):
                    generated[name.removeprefix('source/')]=raw
            if family.endswith('/worker') and name=='cold/recording/receipt.json':receipts[family]=json.loads(raw);(out/(family.split('/')[0]+'-receipt.json')).write_bytes(raw)
            if family=='virgl-native-dimensional/worker' and name.endswith('browser-coverage.json'):
                file=out/'held-coverage'/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
            if family=='virgl-native-dimensional/worker' and name.startswith('cold/recording/hardware/source/target/virgl-desktop-submit/pkg/'):
                generated[name.removeprefix('cold/recording/hardware/source/')]=raw
    for name,raw in [('manifest.json',manifest_raw),('records.json',index_raw)]:
        file=out/family/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
    dependencies.append(dict(family=family,manifestSha256=sha(manifest_raw),indexSha256=sha(index_raw),archiveSha256=sha(archive_raw),reopenedBodies=len(rows)))
    print(f'authenticated {family}: {len(rows)} complete bodies',flush=True)
assert not subprocess.check_output(['git','diff','--name-only','48b2ba0c7ee90d13093f7782e5a2502e44095753','--','crates','Cargo.toml','Cargo.lock'],cwd=repo),'unchanged native transport dependency'
assert not subprocess.check_output(['git','diff','--name-only',base,'--','renderer/virgl-shader'],cwd=repo),'unchanged compiler dependency'
held={}
for family,receipt in receipts.items():
    prefix='renderer/virgl-shader/' if family.startswith('virgl-dimensional-shaders/') else 'crates/'
    for relative,pin in receipt['sources'].items():
        if not relative.startswith(prefix):continue
        raw=(repo/relative).read_bytes()
        if sha(raw)!=pin['sha256']:
            assert family=='virgl-native-dimensional/worker' and ('/tests/' in relative or relative.endswith('_tests.rs')),relative
            assert raw==subprocess.check_output(['git','show','48b2ba0c7ee90d13093f7782e5a2502e44095753:'+relative],cwd=repo)
            held[relative]=dict(bytes=len(raw),sha256=sha(raw),reason='Test-only D56 fresh verifier promotion at the verified dependency head; absent from the generated production Wasm module.')
        else:held[relative]=pin
assert len(generated)==6
generated_pins={}
for relative,raw in generated.items():
    file=repo/relative
    if file.exists():assert file.read_bytes()==raw,relative
    else:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
    generated_pins[relative]=dict(bytes=len(raw),sha256=sha(raw))
for relative,raw in old_sources.items():
    file=out/'historical'/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
assert (out/'baseline.json').is_file()
result=dict(schema='dimensional-view-held-dependencies-v1',base=base,productionAuthority=False,dependencies=dependencies,heldSourcePins=held,generated=generated_pins,
    heldCompilerRuntime='D57 verified C/Wasm translation, ABI, fixed memory and native dimensional signatures',heldTransportRuntime='D56 verified native layered DMA, original VirtIO admission, actual Wasm queue and fence ownership')
(out/'authentication.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(status='passed',completeBodies=sum(d['reopenedBodies'] for d in dependencies),heldSources=len(held),generatedBytes=len(generated))))
