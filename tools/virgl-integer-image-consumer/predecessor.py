#!/usr/bin/env python3
"""Reopen verified shader evidence and extract its actual compiler/input state."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = 'c64c3325c15d8978f455d57fc103559eec1b9d20'
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def main(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    extracted, seals = [], []
    inputs = {'hot/native/cases.json': 'cases.json', 'hot/native/native.jsonl': 'native.jsonl',
              'hot/native/historical-abi.jsonl': 'historical-abi.jsonl'}
    prefix = 'hot-generated/renderer/virgl-shader/build/wasm/'
    for role in ['worker', 'verifier']:
        base = ROOT / 'evidence/virgl-integer-image-shader' / role
        manifest = json.loads((base / 'manifest.json').read_bytes())
        index = (base / 'records.json').read_bytes()
        assert sha(index) == manifest['recordIndexSha256']
        assert sha((base / 'recording.tar.gz').read_bytes()) == manifest['archiveSha256']
        records = json.loads(index)['records']
        wanted = {row['path']: row for row in records}
        assert len(wanted) == len(records) == manifest['records']
        seen = set()
        with tarfile.open(base / 'recording.tar.gz', 'r:gz') as tar:
            for member in tar:
                assert member.isfile() and member.name in wanted and member.name not in seen
                raw = tar.extractfile(member).read()
                row = wanted[member.name]
                assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
                seen.add(member.name)
                if role == 'worker':
                    destination = None
                    if member.name in inputs:
                        destination = output / inputs[member.name]
                    elif member.name in [prefix + 'virgl-shader.mjs', prefix + 'virgl-shader.wasm']:
                        destination = ROOT / 'renderer/virgl-shader/build/wasm' / Path(member.name).name
                    if destination:
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        destination.write_bytes(raw)
                        extracted.append(dict(path=member.name, destination=str(destination.relative_to(ROOT)),
                                              bytes=len(raw), sha256=sha(raw)))
        assert seen == set(wanted)
        for name in ['manifest.json', 'records.json', 'recording.tar.gz']:
            relative = (base / name).relative_to(ROOT).as_posix()
            raw = (base / name).read_bytes()
            assert raw == subprocess.check_output(['git', 'show', BASE + ':' + relative], cwd=ROOT)
        seals.append(dict(role=role, members=len(seen), archiveSha256=manifest['archiveSha256'],
                          recordIndexSha256=manifest['recordIndexSha256'],
                          manifestSha256=sha((base / 'manifest.json').read_bytes())))
    assert len(extracted) == 5
    unchanged = []
    for name in subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', BASE, '--',
                                         'renderer/virgl-shader'], cwd=ROOT, text=True).splitlines():
        raw = (ROOT / name).read_bytes()
        assert raw == subprocess.check_output(['git', 'show', BASE + ':' + name], cwd=ROOT)
        unchanged.append(dict(path=name, bytes=len(raw), sha256=sha(raw)))
    for name in ['resources.mjs', 'integer-images.mjs', 'shared-exponent-gpu.mjs',
                 'color-images.mjs', 'float-images.mjs', 'packed-float-images.mjs',
                 'shared-exponent-images.mjs']:
        relative = 'renderer/virgl-command/' + name
        raw = (ROOT / relative).read_bytes()
        assert raw == subprocess.check_output(['git', 'show', BASE + ':' + relative], cwd=ROOT)
        unchanged.append(dict(path=relative, bytes=len(raw), sha256=sha(raw)))
    old = subprocess.check_output(['git', 'show', BASE + ':renderer/virgl-command/constant-domain.mjs'], cwd=ROOT)
    assert (ROOT / 'renderer/virgl-command/constant-domain.mjs').read_bytes().startswith(old)
    (output / 'old-contract.mjs').write_bytes(old)
    result = dict(status='passed', predecessor=BASE, seals=seals, extracted=extracted,
                  unchanged=unchanged, historicalContractPrefixSha256=sha(old),
                  compilerStorageFactsCarried=True, guestExecution=False, productionNegotiation=False)
    (output / 'authentication.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(status='passed',members=sum(row['members'] for row in seals),extracted=len(extracted))))


if __name__ == '__main__':
    main(sys.argv[1])
