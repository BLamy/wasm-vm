#!/usr/bin/env python3
"""Run the physical first-power gate from a scrubbed pristine exact-head clone."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    head = git('rev-parse', 'HEAD')
    if git('diff', '--name-only', 'HEAD'):
        raise ValueError('commit tracked sources before exact-head cold proof')
    clone = Path(tempfile.mkdtemp(prefix='wasm-vm-92cb-power-cold-')) / 'wasm-vm'
    env = dict(os.environ)
    removed = sorted(key for key in env if key.startswith(('CARGO_', 'RUST', 'VIRGL_',
                                                            'npm_config_', 'NPM_CONFIG_'))
                     or key in {'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME',
                                'CHROME', 'CC', 'CXX', 'CFLAGS', 'CPPFLAGS', 'LDFLAGS',
                                'EMCC', 'EM_CONFIG', 'EMSDK', 'EMSDK_NODE', 'EMSDK_PYTHON',
                                'NODE_V8_COVERAGE', 'LLVM_PROFILE_FILE'})
    for key in removed:
        del env[key]
    report = {'schema': 'virgl-original-92cb-physical-power-cold-v1',
              'task': 'E6-T12g6m5b2b1', 'gitHead': head, 'clone': str(clone),
              'removedEnvironmentNames': removed,
              'command': ['make', 'verify-E6-T12g6m5b2b1'], 'status': 'running'}
    log_path = output / 'cold.log'
    try:
        with log_path.open('w') as log:
            subprocess.run(['git', 'clone', '--shared', '--no-checkout', str(ROOT), str(clone)],
                           stdout=log, stderr=subprocess.STDOUT, env=env, check=True)
            subprocess.run(['git', 'checkout', '--detach', head], cwd=clone,
                           stdout=log, stderr=subprocess.STDOUT, env=env, check=True)
            report['cloneHead'] = git('rev-parse', 'HEAD', cwd=clone)
            report['statusBefore'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone)
            if report['cloneHead'] != head or report['statusBefore']:
                raise ValueError('cold checkout is not pristine at exact head')
            result = subprocess.run(report['command'], cwd=clone, env=env,
                                    stdout=log, stderr=subprocess.STDOUT, timeout=1200)
            report['exitCode'] = result.returncode
            report['statusAfter'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone)
            acceptance = clone / 'target/evidence/virgl-92cb-power-domain'
            if acceptance.exists():
                shutil.copytree(acceptance, output / 'acceptance', dirs_exist_ok=True)
            if result.returncode or report['statusAfter']:
                raise ValueError('cold acceptance failed or changed the checkout')
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
        report['logSha256'] = hashlib.sha256(log_path.read_bytes()).hexdigest() if log_path.exists() else None
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Pristine original 92cb physical power gate passed at {head}')


if __name__ == '__main__':
    main()
