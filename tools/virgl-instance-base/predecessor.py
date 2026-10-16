#!/usr/bin/env python3
"""Reopen complete D45 custody and extract its actual historical compiler."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '2a55ba679abda640781b854d83726d35fca1d98d'
PINS = {
    'worker': ('6e1ab959e3e04a2998eabf4b60233419f3b0934ee33ccf2d36b09e441c28886c',
               'bfee67b4e66aa3645f1f05a7847ef0e8f6ee5f092904a60ff56ab28c22aae8eb',
               '5d40d9cf0650b561637863b24cd52984cf1fbaf08ebf988e8a57940add1f13ed', 83324),
    'verifier': ('4b0b3b14105b4005e68bf52dde8666e0b85fd80731ad988e39f1759b4a3d66a9',
                 '8ed963dbb701cf544a1c6c1adfe409e5164d8f664b7737fde65924588a2bcd6e',
                 'd76c57d568deff90f0578b45afde5405804981b4d5c6e33f192f1ab979b27a1b', 8065),
}
hash_bytes = lambda raw: hashlib.sha256(raw).hexdigest()


def main(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    for role, (mpin, ipin, apin, count) in PINS.items():
        folder = ROOT / 'evidence/virgl-ordered-stencil' / role
        mraw = (folder / 'manifest.json').read_bytes()
        iraw = (folder / 'records.json').read_bytes()
        archive = folder / 'recording.tar.gz'
        assert hash_bytes(mraw) == mpin and hash_bytes(iraw) == ipin
        assert hash_bytes(archive.read_bytes()) == apin
        manifest, index = json.loads(mraw), json.loads(iraw)['records']
        assert len(index) == count == manifest['records']
        expected = {r['path']: r for r in index}
        assert len(expected) == count
        seen, regular, logical_bytes = set(), {}, 0
        # Stream each physical body once; resolve an earlier hardlink to that
        # complete body and rehash it for every indexed logical member.
        with tarfile.open(archive, 'r|gz') as tar:
            for member in tar:
                assert member.name in expected and member.name not in seen
                assert member.isfile() or member.islnk()
                if member.islnk():
                    assert member.linkname in regular
                    raw = regular[member.linkname]
                else:
                    raw = tar.extractfile(member).read()
                    regular[member.name] = raw
                wanted = expected[member.name]
                assert len(raw) == wanted['bytes'] and hash_bytes(raw) == wanted['sha256']
                seen.add(member.name)
                logical_bytes += len(raw)
                prefix = 'hot-generated/renderer/virgl-shader/build/wasm/'
                if role == 'worker' and member.name in [prefix + 'virgl-shader.mjs', prefix + 'virgl-shader.wasm']:
                    (output / Path(member.name).name).write_bytes(raw)
        assert seen == set(expected)
        for name in ['manifest.json', 'records.json', 'recording.tar.gz']:
            path = (folder / name).relative_to(ROOT).as_posix()
            assert (folder / name).read_bytes() == subprocess.check_output(['git', 'show', BASE + ':' + path], cwd=ROOT)
        rows.append(dict(role=role, members=count, physicalBodies=len(regular), logicalBytes=logical_bytes,
                         manifestSha256=mpin, recordIndexSha256=ipin, archiveSha256=apin))
    generated = {}
    for name, pin in [('virgl-shader.mjs', '6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa'),
                      ('virgl-shader.wasm', 'acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc')]:
        assert hash_bytes((output / name).read_bytes()) == pin
        generated[name] = pin
    unchanged = ['renderer/virgl-command', 'crates', 'web', 'tools/guest']
    assert not subprocess.check_output(['git', 'diff', '--name-only', BASE, '--', *unchanged], cwd=ROOT).strip()
    primary = json.loads((ROOT / 'tools/virgl-instance-base/primary.json').read_text())
    for row in primary['sources']:
        raw = (ROOT / row['path']).read_bytes()
        assert len(raw) == row['bytes'] and hash_bytes(raw) == row['sha256']
    result = dict(status='passed', predecessor=BASE, carried=rows, generated=generated,
                  reopenedMembers=sum(r['members'] for r in rows), unchangedBoundaries=unchanged,
                  primary=primary, actualHistoricalCompilerExtracted=True)
    (output / 'authentication.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status='passed', reopenedMembers=result['reopenedMembers'])))


if __name__ == '__main__':
    main(sys.argv[1])
