#!/usr/bin/env python3
"""Run original image subresource state acceptance in one pristine scrubbed exact-head clone."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    git = lambda *args, cwd=ROOT: subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()
    head = git('rev-parse', 'HEAD')
    if git('diff', '--name-only', 'HEAD'):
        raise ValueError('freeze tracked source before final pristine clone')
    clone = Path(tempfile.mkdtemp(prefix='wasm-vm-byte-color-cold-'))/'wasm-vm'
    env = dict(os.environ)
    removed = sorted(k for k in env if k.startswith(('CARGO_', 'RUST', 'VIRGL_', 'npm_config_', 'NPM_CONFIG_'))
                     or k in {'NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'PYTHONPATH', 'PYTHONHOME',
                              'CHROME', 'CC', 'CXX', 'CFLAGS', 'CPPFLAGS', 'LDFLAGS', 'EMCC', 'EM_CONFIG',
                              'EMSDK', 'EMSDK_NODE', 'EMSDK_PYTHON'})
    for key in removed:
        del env[key]
    report = dict(schema=1, task='E6-T11d22', gitHead=head, clone=str(clone),
                  removedEnvironmentNames=removed, command=['make', 'verify-E6-T11d22'], status='running')
    try:
        with (output/'cold.log').open('w') as log:
            subprocess.run(['git', 'clone', '--shared', '--no-checkout', str(ROOT), str(clone)], env=env,
                           stdout=log, stderr=subprocess.STDOUT, check=True)
            subprocess.run(['git', 'checkout', '--detach', head], cwd=clone, env=env,
                           stdout=log, stderr=subprocess.STDOUT, check=True)
            report['cloneHead'], report['statusBefore'] = git('rev-parse', 'HEAD', cwd=clone), git('status', '--porcelain', '--untracked-files=all', cwd=clone)
            if report['cloneHead'] != head or report['statusBefore']:
                raise ValueError('clone is not pristine at exact head')
            run_output = clone/'target/evidence/virgl-byte-colors-cold'
            env['VIRGL_BYTE_COLOR_EVIDENCE_DIR'] = str(run_output)
            result = subprocess.run(report['command'], cwd=clone, env=env, stdout=log,
                                    stderr=subprocess.STDOUT, timeout=1800)
            report['exitCode'] = result.returncode
            report['statusAfter'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone)
            if run_output.exists():
                shutil.copytree(run_output, output/'acceptance', dirs_exist_ok=True)
            if result.returncode or report['statusAfter']:
                raise ValueError('cold acceptance failed or modified checkout')
            receipt = (output/'acceptance/receipt.json').read_bytes()
            if json.loads(receipt)['gitHead'] != head:
                raise ValueError('cold receipt head mismatch')
            report['receiptSha256'] = hashlib.sha256(receipt).hexdigest()
            report['status'] = 'passed'
    except Exception as error:
        report['status'], report['error'] = 'failed', str(error)
        raise
    finally:
        report['logSha256'] = hashlib.sha256((output/'cold.log').read_bytes()).hexdigest()
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(f'Pristine original image subresource states passed at {head}: {clone}')


if __name__ == '__main__':
    main()
