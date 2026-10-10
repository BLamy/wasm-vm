#!/usr/bin/env python3
"""Build one actual isolated compiler source fault and retain source/Wasm hashes."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'renderer/virgl-shader'
OUT = ROOT / 'target/virgl-exact-reciprocal-fault'
NEEDLE = 'instruction->src[2].swizzle[0]);'
REPLACEMENT = '(instruction->src[2].swizzle[0] + UINT32_C(0x00800000)));'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='wasm-vm-exact-reciprocal-fault-') as scratch:
        stage = Path(scratch) / 'shader'
        shutil.copytree(SOURCE, stage, ignore=shutil.ignore_patterns('build', '__pycache__'))
        source = stage / 'raw_bits.c'
        original = source.read_text()
        assert original.count(NEEDLE) == 1
        altered = original.replace(NEEDLE, REPLACEMENT)
        source.write_text(altered)
        with (OUT / 'build.log').open('w') as log:
            subprocess.run(['bash', 'build.sh', 'wasm'], cwd=stage, stdout=log,
                           stderr=subprocess.STDOUT, check=True)
        for path in ['raw_bits.c', 'bridge.c', 'build/wasm/virgl-shader.mjs',
                     'build/wasm/virgl-shader.wasm']:
            shutil.copyfile(stage / path, OUT / Path(path).name)
        manifest = dict(task='E6-T12g6m4a', fault='shadow-literal-plus-one-exponent-bit',
                        source='renderer/virgl-shader/raw_bits.c', needle=NEEDLE,
                        replacement=REPLACEMENT, originalSha256=sha(original.encode()),
                        alteredSha256=sha(altered.encode()),
                        artifacts=[dict(path=p.name, bytes=p.stat().st_size,
                                        sha256=sha(p.read_bytes()))
                                   for p in sorted(OUT.iterdir()) if p.name != 'manifest.json'])
        (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print('actual exact-reciprocal compiler shadow fault built')


if __name__ == '__main__':
    main()
