#!/usr/bin/env python3
"""Build actual isolated compiler faults; retain source bytes and Wasm artifacts."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'renderer/virgl-shader'


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    for name in ['interface', 'metadata']:
        out = ROOT / 'target/virgl-exact-pair-fault' / name
        out.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='wasm-vm-exact-pair-fault-') as scratch:
            stage = Path(scratch) / 'shader'
            shutil.copytree(SOURCE, stage, ignore=shutil.ignore_patterns('build', '__pycache__'))
            file = stage / 'bridge.c'
            original = file.read_text()
            needle = '   if (!failed) failed = convert(vertex, inputs[0].text, lengths[0], &fragment->variable.fs_info);'
            if name == 'interface':
                fault = '   if (!failed && vertex->owned_shader) for (char *p = vertex->owned_shader; (p = strstr(p, "vso_g0")); ++p) p[5] = \'1\';'
            else:
                fault = '   if (!failed && vertex->profile.raw) vertex->profile.raw->exact = NULL;'
            replacement = needle + '\n' + fault
            assert original.count(needle) == 1
            altered = original.replace(needle, replacement)
            file.write_text(altered)
            with (out / 'build.log').open('w') as log:
                subprocess.run(['bash', 'build.sh', 'wasm'], cwd=stage, stdout=log, stderr=subprocess.STDOUT, check=True)
            for path in ['raw_bits.c', 'bridge.c', 'build/wasm/virgl-shader.mjs', 'build/wasm/virgl-shader.wasm']:
                shutil.copyfile(stage / path, out / Path(path).name)
            manifest = dict(task='E6-T12g6m3c', fault=name, file=file.name, needle=needle,
                replacement=replacement, originalSha256=sha(original.encode()), alteredSha256=sha(altered.encode()),
                artifacts=[dict(path=p.name, bytes=p.stat().st_size, sha256=sha(p.read_bytes()))
                    for p in sorted(out.iterdir()) if p.name != 'manifest.json'])
            (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            print(name + ': actual compiler Wasm fault built')


if __name__ == '__main__':
    main()
