#!/usr/bin/env python3
"""Run final standard native point acceptance once in a pristine exact-head clone with scrubbed env."""
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    head = git('rev-parse', 'HEAD')
    require_clean = git('diff', '--name-only', 'HEAD')
    if require_clean:
        raise ValueError('freeze tracked changes before final clean clone')
    clone = Path(tempfile.mkdtemp(prefix='wasm-vm-virgl-standard-points-cold-')) / 'wasm-vm'
    env = dict(os.environ)
    removed = sorted(key for key in env if key.startswith(('CARGO_', 'RUST', 'VIRGL_', 'npm_config_', 'NPM_CONFIG_'))
                     or key in {'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME', 'CHROME',
                                'CC', 'CXX', 'CFLAGS', 'CPPFLAGS', 'LDFLAGS', 'EMCC', 'EM_CONFIG', 'EMSDK',
                                'EMSDK_NODE', 'EMSDK_PYTHON', 'NODE_V8_COVERAGE'})
    for key in removed:
        del env[key]
    report = {'schema': 1, 'task': 'E6-T11d11', 'gitHead': head, 'clone': str(clone),
              'removedEnvironmentNames': removed, 'command': ['make', 'verify-E6-T11d11'], 'status': 'running'}
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
            source_output = clone / 'target/evidence/virgl-standard-points-cold'
            env['VIRGL_STANDARD_POINTS_EVIDENCE_DIR'] = str(source_output)
            result = subprocess.run(report['command'], cwd=clone, env=env,
                                    stdout=log, stderr=subprocess.STDOUT, timeout=1800)
            report['exitCode'] = result.returncode
            report['statusAfter'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone)
            if source_output.exists():
                shutil.copytree(source_output, output / 'acceptance', dirs_exist_ok=True)
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
    print(f'Clean standard native point clone passed at {head}: {clone}')


if __name__ == '__main__':
    main()
