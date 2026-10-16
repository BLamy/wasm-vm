#!/usr/bin/env python3
"""Independently reopen every sealed worker and actual predecessor logical body."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '41c1aa490d19d8c307ea7bdbb5647acf346681f4'
FREEZE = 'f57db8c880684eb73cdc29c166568185fdde0a46'
SUBMISSION = 'b0bc023d80c06cf0a449eb7648632b3a9a0af137'
WORKER_MANIFEST = '6e3dac963bac00e954134e0f9ffe3f9f86b595b183b42f823beaa11aacf7b77a'
WORKER_INDEX = '29ca252c9abaf1c2d29fd0f39d53ff4dc73a416a2f3fa13d5bb6d1b95807733f'
WORKER_ARCHIVE = '49c9951e44f0aac20e4d709034e606803698ca7465d7f110078acccd29534c8a'
PREDECESSOR_PINS = {
    ('virgl-instanced-stencil', 'worker'): ('2387876828e65c6b958b5c0d9898a3face77af6fc26ffa5bbc114b0890da33a3', 'e43fb84a4a36adb043968185259061fe2a8af6b44edcb334cbe63c7975d73857', 'af534b07ebb9a8422adebdf9cd66286f8b2c3472faff8ee38b0a5433ac320b99', 41944),
    ('virgl-instanced-stencil', 'verifier'): ('6e723b988592814e41b90c702cc5ee6b814d2eb9aaa618e6b61ed1d7d6c76059', '3870203396e52053f7a6de5e5cb286bc8b335d24968643d7b29b27069acdaac8', 'cd4f43ae3dad8c1e7631214b0d12f10334a67d72db8a116fcfafbe1f9f8caa8b', 74380),
    ('virgl-ordered-stencil', 'worker'): ('6e1ab959e3e04a2998eabf4b60233419f3b0934ee33ccf2d36b09e441c28886c', 'bfee67b4e66aa3645f1f05a7847ef0e8f6ee5f092904a60ff56ab28c22aae8eb', '5d40d9cf0650b561637863b24cd52984cf1fbaf08ebf988e8a57940add1f13ed', 83324),
    ('virgl-ordered-stencil', 'verifier'): ('4b0b3b14105b4005e68bf52dde8666e0b85fd80731ad988e39f1759b4a3d66a9', '8ed963dbb701cf544a1c6c1adfe409e5164d8f664b7737fde65924588a2bcd6e', 'd76c57d568deff90f0578b45afde5405804981b4d5c6e33f192f1ab979b27a1b', 8065),
    ('virgl-instance-base', 'worker'): ('649def87b9a04660ba795de462f7ff1773bf0d9db9b89c501b6a417accddf5ce', 'e9ff82d91a2f6d8e6310e971ef87357a5aa22237f5eaf25facad465351ee29b9', 'f746e58d61505392aa5b7f23fe919e2585187be0925e86f3158282052076df0e', 2584),
    ('virgl-instance-base', 'verifier'): ('8fc075d8d6e85a4078ddf507cb349282b5579093f5c047a3a14c2929d17f13b4', '2298b9fbb3e68cbe4d2996d92d335efeb891c552de5eb41f8d9ed531adc3dc58', 'cf4cf5b9ced80cc4f379748bd199f9228d1cb4f6de8810adbef2f209aed70563', 3206),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def archive_bytes(folder, manifest):
    bodies = []
    for part in manifest.get('archiveParts') or [{'path':'recording.tar.gz'}]:
        raw = (folder/part['path']).read_bytes()
        if 'sha256' in part:
            assert len(raw) == part['bytes'] and sha(raw) == part['sha256'], part['path']
        bodies.append(raw)
    raw = b''.join(bodies)
    digest = manifest.get('archiveSha256') or manifest.get('archive',{}).get('sha256')
    assert digest and sha(raw) == digest
    if 'archiveBytes' in manifest:
        assert len(raw) == manifest['archiveBytes']
    return raw


def reopen(raw, index, destination=None, retain=()):
    wanted = {row['path']:row for row in index}
    assert len(wanted) == len(index)
    seen, physical, retained = set(), {}, {}
    logical_bytes = physical_bytes = 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r|gz') as archive:
        for member in archive:
            name = member.name
            assert name in wanted and name not in seen, name
            path = PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts, name
            assert member.isfile() or member.islnk(), name
            if member.islnk():
                assert member.linkname in physical, (name, member.linkname)
                original = physical[member.linkname]
                body = original.read_bytes() if isinstance(original, Path) else bytes(original)
            else:
                body = archive.extractfile(member).read()
                assert len(body) == member.size
                physical_bytes += len(body)
            expected = wanted[name]
            assert len(body) == expected['bytes'] and sha(body) == expected['sha256'], name
            if destination:
                target = destination/name
                target.parent.mkdir(parents=True, exist_ok=True)
                if target.exists():
                    assert target.read_bytes() == body, 'existing extraction drift '+name
                elif member.islnk():
                    os.link(physical[member.linkname], target)
                else:
                    target.write_bytes(body)
                if member.isfile():
                    physical[name] = target
            elif member.isfile():
                physical[name] = body
            if name in retain:
                retained[name] = body
            seen.add(name)
            logical_bytes += len(body)
    assert seen == set(wanted)
    return dict(records=len(seen), physicalBodies=len(physical), logicalBytes=logical_bytes,
                physicalBytes=physical_bytes, allLogicalBodiesReopened=True), retained


def main(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    folder = ROOT/'evidence/virgl-shadow-shaders/worker'
    mraw, iraw = (folder/'manifest.json').read_bytes(), (folder/'records.json').read_bytes()
    assert sha(mraw) == WORKER_MANIFEST and sha(iraw) == WORKER_INDEX
    manifest, index = json.loads(mraw), json.loads(iraw)
    assert manifest['sourceHead'] == index['sourceHead'] == FREEZE
    assert manifest['records'] == len(index['records']) == 52584
    raw = archive_bytes(folder, manifest)
    assert len(raw) == 525639457 and sha(raw) == WORKER_ARCHIVE
    unpacked = output/'unpacked'
    worker, _ = reopen(raw, index['records'], unpacked)
    del raw
    for pin, name in [('hotReceiptSha256','hot/receipt.json'),('coldReceiptSha256','cold/receipt.json'),('coldReportSha256','cold/report.json')]:
        assert sha((unpacked/name).read_bytes()) == manifest[pin]
    # Sources must be actual original commit bodies, not a text reconstruction.
    source_rows = []
    for file in sorted((unpacked/'source').rglob('*')):
        if file.is_file():
            name = file.relative_to(unpacked/'source').as_posix()
            body = file.read_bytes()
            assert body == git('show', FREEZE+':'+name), name
            # Submission records only evidence, task log and queue after source freeze.
            if not name.startswith('tasks/'):
                assert body == git('show', SUBMISSION+':'+name), 'submitted source drift '+name
            source_rows.append(dict(path=name, bytes=len(body), sha256=sha(body)))
    primary = json.loads((unpacked/'source/tools/virgl-shadow-shaders/primary.json').read_bytes())
    for row in primary['sources']:
        body = (unpacked/'source'/row['path']).read_bytes()
        assert len(body) == row['bytes'] and sha(body) == row['sha256'], row['path']
    predecessor = []
    pred_dir = output/'actual-predecessor'
    pred_dir.mkdir(exist_ok=True)
    for (family,role),(mpin,ipin,apin,count) in PREDECESSOR_PINS.items():
        nested = unpacked/'predecessor-seals/evidence'/family/role
        nmraw,niraw = (nested/'manifest.json').read_bytes(),(nested/'records.json').read_bytes()
        assert sha(nmraw) == mpin and sha(niraw) == ipin
        nm, ni = json.loads(nmraw), json.loads(niraw)
        assert ni.get('records') is not None and len(ni['records']) == nm['records'] == count
        archive = archive_bytes(nested,nm)
        assert sha(archive) == apin
        for leaf in ['manifest.json','records.json']+[p['path'] for p in nm.get('archiveParts') or [{'path':'recording.tar.gz'}]]:
            name='evidence/'+family+'/'+role+'/'+leaf
            assert (nested/leaf).read_bytes() == git('show',BASE+':'+name), name
        retain=[]
        if family=='virgl-instance-base' and role=='worker':
            prefix='hot-generated/renderer/virgl-shader/build/wasm/'
            retain=[prefix+'virgl-shader.mjs',prefix+'virgl-shader.wasm']
        checked,bodies = reopen(archive,ni['records'],retain=retain)
        for name,body in bodies.items():
            (pred_dir/Path(name).name).write_bytes(body)
        predecessor.append(dict(family=family,role=role,manifestSha256=mpin,indexSha256=ipin,archiveSha256=apin,**checked))
        print('Reopened',family,role,count,'complete bodies.',flush=True)
    generated={file.name:sha(file.read_bytes()) for file in pred_dir.iterdir()}
    assert generated=={'virgl-shader.mjs':'2fe4bfc079c0149817f8842e400e4567757da05b0e4e6d73689605a42aea0e05','virgl-shader.wasm':'41afa61d8a42c547c7a8c4cc261ee4e689039d0edc62b98d3ecf448c3fca965d'}
    assert sum(row['records'] for row in predecessor)==213503
    assert not git('diff','--name-only',BASE,SUBMISSION,'--','renderer/virgl-command','crates','web','tools/guest').strip()
    result=dict(schema='independent-shadow-critic-authentication-v1',status='passed',submission=SUBMISSION,freeze=FREEZE,predecessor=BASE,
                worker=dict(manifestSha256=sha(mraw),indexSha256=sha(iraw),archiveSha256=manifest['archiveSha256'],**worker),
                carried=predecessor,actualPredecessorCompiler=generated,sourceClosure=source_rows,primary=primary,
                unchangedCommandStorageRustWebGuest=True,guestExecution=False,productionNegotiation=False)
    (output/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status='passed',workerMembers=worker['records'],predecessorMembers=213503,sourceMembers=len(source_rows))))


if __name__=='__main__':
    main(sys.argv[1])
