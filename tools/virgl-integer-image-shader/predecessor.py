#!/usr/bin/env python3
"""Authenticate the unchanged D31 dependency and extract its actual compiler."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
PREDECESSOR = 'd8d510a689cfb5440cc8b3b65fd94adb9baee109'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    carried = []
    for role in ['worker', 'verifier']:
        base = ROOT / 'evidence/virgl-standard-integer-images' / role
        manifest_raw = (base / 'manifest.json').read_bytes()
        index_raw = (base / 'records.json').read_bytes()
        archive = base / 'recording.tar.gz'
        manifest = json.loads(manifest_raw)
        assert sha(index_raw) == manifest['recordIndexSha256']
        assert sha(archive.read_bytes()) == manifest['archiveSha256']
        records = json.loads(index_raw)['records']
        expected = {item['path']: item for item in records}
        assert len(expected) == len(records) == manifest['records']
        seen = set()
        with tarfile.open(archive, 'r:gz') as tar:
            for member in tar:
                assert member.isfile() and member.name in expected and member.name not in seen
                raw = tar.extractfile(member).read()
                wanted = expected[member.name]
                assert len(raw) == wanted['bytes'] and sha(raw) == wanted['sha256']
                seen.add(member.name)
                prefix = 'hot-generated/renderer/virgl-shader/build/wasm/'
                if role == 'worker' and member.name in [prefix + 'virgl-shader.mjs', prefix + 'virgl-shader.wasm']:
                    (output / Path(member.name).name).write_bytes(raw)
        assert seen == set(expected)
        for name in ['manifest.json', 'records.json', 'recording.tar.gz']:
            relative = (base / name).relative_to(ROOT).as_posix()
            raw = (base / name).read_bytes()
            assert raw == subprocess.check_output(['git', 'show', PREDECESSOR + ':' + relative], cwd=ROOT)
        carried.append(dict(role=role, records=len(records), archiveSha256=manifest['archiveSha256'],
                            recordIndexSha256=manifest['recordIndexSha256'], manifestSha256=sha(manifest_raw)))
    assert sha((output / 'virgl-shader.wasm').read_bytes()) == '41d5c79624d7799cb9339b3fb754bfb4b744ee959b70d8cc2daedfb0a1fb4ac8'
    assert sha((output / 'virgl-shader.mjs').read_bytes()) == '509aaeb879c95b90acd26de08a310b23991779cf3564f174bbc1702c9b68a021'
    assert not subprocess.check_output(['git', 'diff', '--name-only', PREDECESSOR, '--',
                                      'renderer/virgl-command', 'crates', 'web', 'tools/guest'], cwd=ROOT).strip()
    result = dict(status='passed', predecessor=PREDECESSOR, carried=carried,
                  unchangedResourceTransportGuest=True, originalCompilerExtracted=True,
                  wasmSha256=sha((output / 'virgl-shader.wasm').read_bytes()),
                  moduleSha256=sha((output / 'virgl-shader.mjs').read_bytes()))
    (output / 'authentication.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main(sys.argv[1])
