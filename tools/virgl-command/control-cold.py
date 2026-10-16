#!/usr/bin/env python3
"""Run the synchronous control gate from a clean exact-head clone and scrubbed environment."""
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
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    head = git('rev-parse', 'HEAD')
    clone = Path(tempfile.mkdtemp(prefix='wasm-vm-virgl-control-cold-')) / 'wasm-vm'
    env = dict(os.environ)
    remove = sorted(key for key in env if key.startswith(('CARGO_', 'RUST', 'npm_config_', 'NPM_CONFIG_'))
                    or key in {'NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME', 'CHROME',
                               'CC', 'CXX', 'CFLAGS', 'CPPFLAGS', 'LDFLAGS', 'EMCC', 'NODE_V8_COVERAGE',
                               'VIRGL_CONTROL_EVIDENCE_DIR'})
    for key in remove:
        del env[key]
    report = {'schema': 1, 'task': 'E6-T11a', 'gitHead': head, 'clone': str(clone),
              'removedEnvironmentNames': remove, 'command': ['make', 'verify-E6-T11a'],
              'timeoutSeconds': 1200, 'status': 'running'}
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
                raise ValueError('cold clone did not start clean at exact head')
            env['VIRGL_CONTROL_EVIDENCE_DIR'] = str(clone / 'target/evidence/virgl-control-cold')
            try:
                result = subprocess.run(report['command'], cwd=clone, env=env,
                                        stdout=log, stderr=subprocess.STDOUT, timeout=1200)
                report['exitCode'] = result.returncode
            finally:
                report['statusAfter'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone)
                evidence = clone / 'target/evidence/virgl-control-cold'
                if evidence.exists():
                    shutil.copytree(evidence, output / 'acceptance', dirs_exist_ok=True)
            if result.returncode or report['statusAfter']:
                raise ValueError('cold acceptance failed or modified the checkout')
            receipt = (output / 'acceptance/receipt.json').read_bytes()
            parsed = json.loads(receipt)
            if parsed['gitHead'] != head or parsed['status'] != 'passed':
                raise ValueError('cold receipt head/status mismatch')
            report['receiptSha256'] = hashlib.sha256(receipt).hexdigest()
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        report['logSha256'] = hashlib.sha256(log_path.read_bytes()).hexdigest()
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Clean control clone passed at {head}: {clone}')


if __name__ == '__main__':
    main()
