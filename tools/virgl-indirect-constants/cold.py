#!/usr/bin/env python3
"""Execute the indirect constant compiler acceptance from a scrubbed pristine exact-head clone."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TIMEOUT = 2400


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args, cwd=ROOT, env=None):
    return subprocess.check_output(['git', *args], cwd=cwd, env=env).decode().strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    require(not output.exists(), 'cold evidence destination must be fresh')
    output.mkdir(parents=True)
    env = dict(os.environ)
    prefixes = ('CARGO_', 'RUST', 'VIRGL_', 'npm_config_', 'NPM_CONFIG_', 'GIT_', 'EMCC_')
    names = {'NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'PYTHONPATH', 'PYTHONHOME',
             'CHROME', 'CC', 'CXX', 'CFLAGS', 'CXXFLAGS', 'CPPFLAGS', 'LDFLAGS', 'AR',
             'RANLIB', 'EMCC', 'EMSDK', 'EMSDK_NODE', 'EMSDK_PYTHON', 'EM_CONFIG', 'EM_CACHE',
             'MAKEFLAGS', 'MFLAGS', 'MAKEOVERRIDES', 'BASH_ENV', 'ENV'}
    removed = sorted(key for key in env if key.startswith(prefixes) or key in names)
    for key in removed:
        del env[key]
    head = git('rev-parse', 'HEAD', env=env)
    clone = Path(tempfile.mkdtemp(prefix='wasm-vm-indirect-constants-cold-')) / 'wasm-vm'
    report = {'schema': 1, 'task': 'E6-T12e8', 'status': 'running', 'gitHead': head,
              'clone': str(clone), 'removedEnvironmentNames': removed,
              'command': ['make', 'verify-E6-T12e8'], 'timeoutSeconds': TIMEOUT,
              'startedAt': datetime.now(timezone.utc).isoformat()}
    log_path = output / 'cold.log'
    try:
        harness = Path(__file__).resolve()
        report['harnessSha256'] = sha(harness)
        expected = subprocess.check_output(['git', 'show', f'{head}:{harness.relative_to(ROOT)}'],
                                           cwd=ROOT, env=env)
        require(hashlib.sha256(expected).hexdigest() == report['harnessSha256'],
                'cold harness differs from frozen Git head')
        with log_path.open('w') as log:
            subprocess.run(['git', 'clone', '--shared', '--no-checkout', str(ROOT), str(clone)],
                           stdout=log, stderr=subprocess.STDOUT, env=env, check=True, timeout=120)
            subprocess.run(['git', 'checkout', '--detach', head], cwd=clone, stdout=log,
                           stderr=subprocess.STDOUT, env=env, check=True, timeout=120)
            report['cloneHead'] = git('rev-parse', 'HEAD', cwd=clone, env=env)
            report['statusBefore'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone, env=env)
            require(report['cloneHead'] == head and not report['statusBefore'], 'clone must start clean')
            evidence = clone / 'target/evidence/virgl-indirect-constants-cold'
            env['VIRGL_INDIRECT_CONSTANTS_EVIDENCE_DIR'] = str(evidence)
            process = subprocess.Popen(report['command'], cwd=clone, env=env, stdout=log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                report['exitCode'] = process.wait(timeout=TIMEOUT)
            except BaseException:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
                finally:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=10)
                raise
            finally:
                report['cloneHeadAfter'] = git('rev-parse', 'HEAD', cwd=clone, env=env)
                report['statusAfter'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone, env=env)
                if evidence.exists():
                    shutil.copytree(evidence, output / 'acceptance')
            require(report['exitCode'] == 0, 'cold indirect constant compiler acceptance failed')
            require(report['cloneHeadAfter'] == head and not report['statusAfter'], 'cold checkout changed')
            receipt = output / 'acceptance/receipt.json'
            parsed = json.loads(receipt.read_text())
            require(parsed['gitHead'] == head and parsed['status'] == 'passed'
                    and parsed['task'] == 'E6-T12e8', 'cold receipt identity mismatch')
            report['receiptSha256'] = sha(receipt)
            report['acceptanceFiles'] = [{'path': str(path.relative_to(output)),
                'bytes': path.stat().st_size, 'sha256': sha(path)}
                for path in sorted((output / 'acceptance').rglob('*')) if path.is_file()]
            require(sha(harness) == report['harnessSha256'], 'cold harness changed during run')
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
    finally:
        report['logSha256'] = sha(log_path) if log_path.exists() else None
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    require(report['status'] == 'passed', report.get('error', 'cold indirect constant compiler proof failed'))
    print(f'Clean indirect constant compiler clone passed at {head}: {clone}')


if __name__ == '__main__':
    main()
