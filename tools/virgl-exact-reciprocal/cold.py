#!/usr/bin/env python3
"""Run one final acceptance from a scrubbed, pristine exact-head clone."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', required=True, type=Path)
    output = p.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    head = git('rev-parse', 'HEAD')
    if git('diff', '--name-only', 'HEAD'):
        raise ValueError('freeze tracked sources before pristine clone')
    clone = Path(tempfile.mkdtemp(prefix='wasm-vm-virgl-exact-reciprocal-cold-')) / 'wasm-vm'
    env = dict(os.environ)
    removed = sorted(key for key in env if key.startswith(('CARGO_', 'RUST', 'VIRGL_', 'npm_config_', 'NPM_CONFIG_'))
                     or key in {'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME', 'CHROME',
                                'CC', 'CXX', 'CFLAGS', 'CPPFLAGS', 'LDFLAGS', 'EMCC', 'EM_CONFIG',
                                'EMSDK', 'EMSDK_NODE', 'EMSDK_PYTHON', 'NODE_V8_COVERAGE'})
    for key in removed:
        del env[key]
    report = {'schema': 1, 'task': 'E6-T12g6m4a', 'gitHead': head,
              'clone': str(clone), 'removedEnvironmentNames': removed,
              'command': ['make', 'verify-E6-T12g6m4a'], 'status': 'running'}
    try:
        with (output / 'cold.log').open('w') as log:
            subprocess.run(['git', 'clone', '--shared', '--no-checkout', str(ROOT), str(clone)],
                           stdout=log, stderr=subprocess.STDOUT, env=env, check=True)
            subprocess.run(['git', 'checkout', '--detach', head], cwd=clone,
                           stdout=log, stderr=subprocess.STDOUT, env=env, check=True)
            report['cloneHead'] = git('rev-parse', 'HEAD', cwd=clone)
            report['statusBefore'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone)
            if report['cloneHead'] != head or report['statusBefore']:
                raise ValueError('clone not pristine at exact head')
            acceptance = clone / 'target/evidence/virgl-exact-reciprocal-cold'
            env['VIRGL_EXACT_RECIPROCAL_EVIDENCE_DIR'] = str(acceptance)
            report['evidenceDirectory'] = str(acceptance)
            report['environmentOverride'] = 'VIRGL_EXACT_RECIPROCAL_EVIDENCE_DIR'
            result = subprocess.run(report['command'], cwd=clone, env=env,
                                    stdout=log, stderr=subprocess.STDOUT, timeout=1200)
            report['exitCode'] = result.returncode
            report['statusAfter'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone)
            if acceptance.exists():
                shutil.copytree(acceptance, output / 'acceptance', dirs_exist_ok=True)
            if result.returncode or report['statusAfter']:
                raise ValueError('cold acceptance failed or changed checkout')
            receipt = (output / 'acceptance/receipt.json').read_bytes()
            if json.loads(receipt)['gitHead'] != head:
                raise ValueError('cold receipt head mismatch')
            report['receiptSha256'] = hashlib.sha256(receipt).hexdigest()
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        report['logSha256'] = hashlib.sha256((output / 'cold.log').read_bytes()).hexdigest()
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Pristine exact-reciprocal clone passed at {head}: {clone}')


if __name__ == '__main__':
    main()
