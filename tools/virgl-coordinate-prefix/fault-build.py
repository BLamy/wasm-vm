#!/usr/bin/env python3
"""Build an isolated real C fault that must destroy the finite certificate."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'renderer/virgl-shader'
NEEDLE = 'if (exponent <= 100u)\n      result->origin ='
REPLACEMENT = 'if (exponent <= 10u)\n      result->origin ='


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    bank = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='wasm-vm-coordinate-prefix-fault-') as scratch:
        stage = Path(scratch) / 'shader'
        shutil.copytree(SOURCE, stage, ignore=shutil.ignore_patterns('build', '__pycache__'))
        source = stage / 'raw_bits.c'
        original = source.read_text()
        assert original.count(NEEDLE) == 1
        altered = original.replace(NEEDLE, REPLACEMENT)
        source.write_text(altered)
        with (output / 'build.log').open('w') as log:
            subprocess.run(['bash', 'build.sh', 'coordinate-prefix-sanitize'], cwd=stage,
                           stdout=log, stderr=subprocess.STDOUT, check=True)
        binary = stage / 'build/coordinate-prefix-sanitize/coordinate-prefix-test'
        env = os.environ.copy()
        env['LLVM_PROFILE_FILE'] = str(output / 'fault.profraw')
        run = subprocess.run([str(binary), str(bank)], cwd=stage,
                             capture_output=True, text=True, env=env)
        assert run.returncode != 0 and 'finite pc27 dependencies' in run.stderr, \
            'faulted real bound producer must contradict the original-bank replay'
        shutil.copyfile(source, output / 'raw_bits.c')
        shutil.copyfile(binary, output / 'coordinate-prefix-fault-test')
        (output / 'run.stdout').write_text(run.stdout)
        (output / 'run.stderr').write_text(run.stderr)
        manifest = {'schema': 'virgl-coordinate-prefix-source-fault-v1',
                    'source': 'renderer/virgl-shader/raw_bits.c', 'needle': NEEDLE,
                    'replacement': REPLACEMENT, 'originalSha256': sha(original.encode()),
                    'alteredSha256': sha(altered.encode()), 'exitCode': run.returncode,
                    'binarySha256': sha(binary.read_bytes()), 'bankSha256': sha(bank.read_bytes())}
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('isolated real C finite-bound fault contradicted original replay')


if __name__ == '__main__':
    main()
