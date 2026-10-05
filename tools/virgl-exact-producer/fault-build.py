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
    for name in ['derive', 'metadata']:
        out = ROOT / 'target/virgl-exact-producer-fault' / name
        out.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='wasm-vm-exact-producer-fault-') as scratch:
            stage = Path(scratch) / 'shader'
            shutil.copytree(SOURCE, stage, ignore=shutil.ignore_patterns('build', '__pycache__'))
            file = stage / ('raw_bits.c' if name == 'derive' else 'bridge.c')
            original = file.read_text()
            if name == 'derive':
                needle = 'uint32_t value = ir->exact->words[r->index][component];'
                replacement = 'uint32_t value = ir->exact->words[r->index][component] ^ (r->index == 0 && component == 0 ? 1u : 0u);'
            else:
                needle = 'const struct raw_exact_bank *exact = profile->raw ? profile->raw->exact : NULL;'
                replacement = 'const struct raw_exact_bank *exact = NULL;'
            assert original.count(needle) == 1
            altered = original.replace(needle, replacement)
            file.write_text(altered)
            with (out / 'build.log').open('w') as log:
                subprocess.run(['bash', 'build.sh', 'wasm'], cwd=stage, stdout=log, stderr=subprocess.STDOUT, check=True)
            for path in ['raw_bits.c', 'bridge.c', 'build/wasm/virgl-shader.mjs', 'build/wasm/virgl-shader.wasm']:
                shutil.copyfile(stage / path, out / Path(path).name)
            manifest = dict(task='E6-T12g6m3b', fault=name, file=file.name, needle=needle,
                replacement=replacement, originalSha256=sha(original.encode()), alteredSha256=sha(altered.encode()),
                artifacts=[dict(path=p.name, bytes=p.stat().st_size, sha256=sha(p.read_bytes()))
                    for p in sorted(out.iterdir()) if p.name != 'manifest.json'])
            (out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            print(name + ': actual compiler Wasm fault built')


if __name__ == '__main__':
    main()
