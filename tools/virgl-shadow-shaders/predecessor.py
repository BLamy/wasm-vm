#!/usr/bin/env python3
"""Reopen complete published compiler and consumer custody; carry only unchanged facts."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '41c1aa490d19d8c307ea7bdbb5647acf346681f4'
PINS = {
    ('virgl-instanced-stencil', 'worker'): ('2387876828e65c6b958b5c0d9898a3face77af6fc26ffa5bbc114b0890da33a3', 'e43fb84a4a36adb043968185259061fe2a8af6b44edcb334cbe63c7975d73857', 'af534b07ebb9a8422adebdf9cd66286f8b2c3472faff8ee38b0a5433ac320b99', 41944),
    ('virgl-instanced-stencil', 'verifier'): ('6e723b988592814e41b90c702cc5ee6b814d2eb9aaa618e6b61ed1d7d6c76059', '3870203396e52053f7a6de5e5cb286bc8b335d24968643d7b29b27069acdaac8', 'cd4f43ae3dad8c1e7631214b0d12f10334a67d72db8a116fcfafbe1f9f8caa8b', 74380),
    ('virgl-ordered-stencil', 'worker'): ('6e1ab959e3e04a2998eabf4b60233419f3b0934ee33ccf2d36b09e441c28886c', 'bfee67b4e66aa3645f1f05a7847ef0e8f6ee5f092904a60ff56ab28c22aae8eb', '5d40d9cf0650b561637863b24cd52984cf1fbaf08ebf988e8a57940add1f13ed', 83324),
    ('virgl-ordered-stencil', 'verifier'): ('4b0b3b14105b4005e68bf52dde8666e0b85fd80731ad988e39f1759b4a3d66a9', '8ed963dbb701cf544a1c6c1adfe409e5164d8f664b7737fde65924588a2bcd6e', 'd76c57d568deff90f0578b45afde5405804981b4d5c6e33f192f1ab979b27a1b', 8065),
    ('virgl-instance-base', 'worker'): ('649def87b9a04660ba795de462f7ff1773bf0d9db9b89c501b6a417accddf5ce', 'e9ff82d91a2f6d8e6310e971ef87357a5aa22237f5eaf25facad465351ee29b9', 'f746e58d61505392aa5b7f23fe919e2585187be0925e86f3158282052076df0e', 2584),
    ('virgl-instance-base', 'verifier'): ('8fc075d8d6e85a4078ddf507cb349282b5579093f5c047a3a14c2929d17f13b4', '2298b9fbb3e68cbe4d2996d92d335efeb891c552de5eb41f8d9ed531adc3dc58', 'cf4cf5b9ced80cc4f379748bd199f9228d1cb4f6de8810adbef2f209aed70563', 3206),
}
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def main(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    carried, generated = [], {}
    for (family, role), (mpin, ipin, apin, count) in PINS.items():
        folder = ROOT/'evidence'/family/role
        mraw, iraw = (folder/'manifest.json').read_bytes(), (folder/'records.json').read_bytes()
        assert sha(mraw) == mpin and sha(iraw) == ipin
        manifest, index = json.loads(mraw), json.loads(iraw)['records']
        assert len(index) == count == manifest['records']
        parts = manifest.get('archiveParts') or [dict(path='recording.tar.gz')]
        archive = b''
        for part in parts:
            raw = (folder/part['path']).read_bytes()
            if 'sha256' in part: assert len(raw) == part['bytes'] and sha(raw) == part['sha256']
            archive += raw
        assert sha(archive) == apin
        for name in ['manifest.json', 'records.json'] + [p['path'] for p in parts]:
            assert (folder/name).read_bytes() == subprocess.check_output(['git', 'show', BASE + ':' + (folder/name).relative_to(ROOT).as_posix()], cwd=ROOT)
        expected, seen, physical, logical = {r['path']: r for r in index}, set(), {}, 0
        assert len(expected) == count
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r|gz') as tar:
            for member in tar:
                assert member.name in expected and member.name not in seen
                assert member.isfile() or member.islnk()
                if member.islnk(): assert member.linkname in physical; raw = physical[member.linkname]
                else: raw = tar.extractfile(member).read(); physical[member.name] = raw
                wanted = expected[member.name]
                assert len(raw) == wanted['bytes'] and sha(raw) == wanted['sha256']
                seen.add(member.name); logical += len(raw)
                prefix = 'hot-generated/renderer/virgl-shader/build/wasm/'
                if family == 'virgl-instance-base' and role == 'worker' and member.name in [prefix + 'virgl-shader.mjs', prefix + 'virgl-shader.wasm']:
                    generated[member.name[len('hot-generated/'):]] = sha(raw)
                    target = output/Path(member.name).name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if target.exists(): assert sha(target.read_bytes()) == sha(raw), 'generated verified compiler drift'
                    else: target.write_bytes(raw)
        assert seen == set(expected)
        carried.append(dict(family=family, role=role, records=count, physicalBodies=len(physical), logicalBytes=logical,
                            manifestSha256=mpin, recordIndexSha256=ipin, archiveSha256=apin))
    changed = subprocess.check_output(['git', 'diff', '--name-only', BASE, '--', 'renderer/virgl-command'], cwd=ROOT, text=True).splitlines()
    assert not changed, 'verified consumer boundary drift'
    assert not subprocess.check_output(['git', 'diff', '--name-only', BASE, '--', 'crates', 'web', 'tools/guest'], cwd=ROOT).strip()
    assert len(generated) == 2
    assert generated == {'renderer/virgl-shader/build/wasm/virgl-shader.mjs':'2fe4bfc079c0149817f8842e400e4567757da05b0e4e6d73689605a42aea0e05','renderer/virgl-shader/build/wasm/virgl-shader.wasm':'41afa61d8a42c547c7a8c4cc261ee4e689039d0edc62b98d3ecf448c3fca965d'}
    primary = json.loads((ROOT/'tools/virgl-shadow-shaders/primary.json').read_text())
    for row in primary['sources']:
        raw = (ROOT/row['path']).read_bytes(); assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
    result = dict(status='passed', predecessor=BASE, carried=carried, generated=generated,
                  reopenedMembers=sum(r['records'] for r in carried), unchangedConsumerAndStorage=True, actualHistoricalCompilerExtracted=True, primary=primary,
                  guestExecution=False, productionNegotiation=False)
    (output/'authentication.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(dict(status='passed', reopenedMembers=result['reopenedMembers'], generated=generated)))


if __name__ == '__main__': main(sys.argv[1])
