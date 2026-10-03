#!/usr/bin/env python3
"""Run the retained-scanout gate in a pristine clone with explicitly bound desktop inputs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
IMAGE_BYTES = 1_073_741_824
IMAGE_SHA256 = '467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e'
MANIFEST_SHA256 = '1be3c29945747184c3ed868f51add1829e97bfd3945f456d4676d5f035fb4827'
KERNEL_PATH = Path('releases/kernel/6.6.63/Image')
KERNEL_BYTES = 24_208_896
KERNEL_SHA256 = 'af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce'
TIMEOUT_SECONDS = 1800


def now():
    return datetime.now(timezone.utc).isoformat()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def binding(file):
    require(file.is_file(), f'immutable input is not a file: {file}')
    digest = hashlib.sha256()
    size = 0
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            size += len(block)
            digest.update(block)
    require(file.stat().st_size == size, f'input size changed while hashing: {file}')
    return {'path': str(file), 'bytes': size, 'sha256': digest.hexdigest()}


def scrub_environment():
    env = dict(os.environ)
    prefixes = ('CARGO_', 'RUST', 'VIRGL_', 'npm_config_', 'NPM_CONFIG_', 'GIT_', 'EMCC_')
    names = {
        'NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'PYTHONPATH', 'PYTHONHOME', 'CHROME',
        'CC', 'CXX', 'CFLAGS', 'CXXFLAGS', 'CPPFLAGS', 'LDFLAGS', 'AR', 'RANLIB',
        'EMCC', 'EMSDK', 'EMSDK_NODE', 'EMSDK_PYTHON', 'EM_CONFIG', 'EM_CACHE',
        'MAKEFLAGS', 'MFLAGS', 'MAKEOVERRIDES', 'BASH_ENV', 'ENV',
    }
    removed = sorted(key for key in env if key.startswith(prefixes) or key in names)
    for key in removed:
        del env[key]
    return env, removed


def git(*args, cwd=ROOT, env=None, raw=False):
    output = subprocess.check_output(['git', *args], cwd=cwd, env=env, stderr=subprocess.PIPE)
    return output if raw else output.decode().strip()


def authenticate_inputs(image, assets):
    require(assets.is_dir(), f'desktop asset directory is missing: {assets}')
    image_binding = binding(image)
    require(image_binding['bytes'] == IMAGE_BYTES and image_binding['sha256'] == IMAGE_SHA256,
            'desktop source image does not match the fixed Epic5 fixture')
    manifest_file = assets / 'manifest.json'
    manifest_binding = binding(manifest_file)
    require(manifest_binding['sha256'] == MANIFEST_SHA256, 'desktop manifest digest mismatch')
    manifest = json.loads(manifest_file.read_bytes())
    require(manifest['version'] == 1 and manifest['layout'] == 'split'
            and manifest['image_len'] == IMAGE_BYTES and manifest['chunk_size'] == 131072
            and len(manifest['chunks']) == 8192, 'desktop manifest layout mismatch')
    require(all(isinstance(item, str) and re.fullmatch(r'[0-9a-f]{64}', item)
                for item in manifest['chunks']), 'desktop manifest contains an invalid chunk digest')
    require((assets / 'chunks').is_dir(), 'desktop publication has no chunk directory')
    kernel_binding = binding(ROOT / KERNEL_PATH)
    require(kernel_binding['bytes'] == KERNEL_BYTES and kernel_binding['sha256'] == KERNEL_SHA256,
            'tracked desktop kernel does not match the fixed fixture')
    return {
        'image': image_binding, 'manifest': manifest_binding, 'kernel': kernel_binding,
        'assets': str(assets),
        'publication': {'version': 1, 'layout': 'split', 'chunkSize': 131072,
                        'chunkCount': 8192, 'uniqueChunks': len(set(manifest['chunks']))},
    }


def run_gate(command, clone, env, log):
    # Timeout must stop the complete gate (including its browser), not merely the make parent.
    process = subprocess.Popen(command, cwd=clone, env=env, stdout=log,
                               stderr=subprocess.STDOUT, start_new_session=True)
    try:
        return process.wait(timeout=TIMEOUT_SECONDS)
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
            # The make parent can exit before one of its children handles SIGTERM.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=10)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--desktop-image', required=True, type=Path)
    parser.add_argument('--desktop-assets', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    image = args.desktop_image.resolve()
    assets = args.desktop_assets.resolve()
    # A reused output must not let stale acceptance files masquerade as this clone's run.
    for name in ('report.json', 'cold.log', 'acceptance'):
        require(not (output / name).exists(), f'choose a fresh output directory: {output / name} exists')
    output.mkdir(parents=True, exist_ok=True)
    env, removed = scrub_environment()
    head = git('rev-parse', 'HEAD', env=env)
    clone = Path(tempfile.mkdtemp(prefix='wasm-vm-virgl-scanout-cold-')) / 'wasm-vm'
    evidence = clone / 'target/evidence/virgl-scanout-cold'
    report = {
        'schema': 1, 'task': 'E6-T11c', 'gitHead': head, 'clone': str(clone), 'retainedClone': True,
        'invocation': [sys.executable, *sys.argv], 'command': ['make', 'verify-E6-T11c'],
        'removedEnvironmentNames': removed, 'timeoutSeconds': TIMEOUT_SECONDS,
        'desktopImage': str(image), 'desktopAssets': str(assets), 'status': 'running', 'startedAt': now(),
    }
    log_path = output / 'cold.log'
    try:
        with log_path.open('w') as log:
            report['inputsBefore'] = authenticate_inputs(image, assets)
            harness = Path(__file__).resolve()
            harness_head = git('show', f'{head}:{harness.relative_to(ROOT)}', env=env, raw=True)
            report['harness'] = binding(harness)
            report['harness']['headSha256'] = sha(harness_head)
            require(report['harness']['sha256'] == report['harness']['headSha256'],
                    'executed cold harness differs from frozen Git head')
            require(sha(git('show', f'{head}:{KERNEL_PATH}', env=env, raw=True)) == KERNEL_SHA256,
                    'frozen kernel Git object differs from the authenticated input')
            subprocess.run(['git', 'clone', '--shared', '--no-checkout', str(ROOT), str(clone)],
                           stdout=log, stderr=subprocess.STDOUT, env=env, check=True, timeout=120)
            subprocess.run(['git', 'checkout', '--detach', head], cwd=clone,
                           stdout=log, stderr=subprocess.STDOUT, env=env, check=True, timeout=120)
            report['cloneHead'] = git('rev-parse', 'HEAD', cwd=clone, env=env)
            report['statusBefore'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone, env=env)
            require(report['cloneHead'] == head and not report['statusBefore'],
                    'cold clone did not start clean at the exact frozen head')
            report['cloneKernelBefore'] = binding(clone / KERNEL_PATH)
            require(report['cloneKernelBefore']['sha256'] == KERNEL_SHA256
                    and report['cloneKernelBefore']['bytes'] == KERNEL_BYTES,
                    'pristine clone kernel differs from the bound input')
            env['VIRGL_SCANOUT_DESKTOP_IMAGE'] = str(image)
            env['VIRGL_SCANOUT_DESKTOP_ASSETS'] = str(assets)
            env['VIRGL_SCANOUT_EVIDENCE_DIR'] = str(evidence)
            report['explicitGateEnvironment'] = {name: env[name] for name in (
                'VIRGL_SCANOUT_DESKTOP_IMAGE', 'VIRGL_SCANOUT_DESKTOP_ASSETS', 'VIRGL_SCANOUT_EVIDENCE_DIR')}
            try:
                report['exitCode'] = run_gate(report['command'], clone, env, log)
            except subprocess.TimeoutExpired:
                report['timedOut'] = True
                raise
            finally:
                report['cloneHeadAfter'] = git('rev-parse', 'HEAD', cwd=clone, env=env)
                report['statusAfter'] = git('status', '--porcelain', '--untracked-files=all', cwd=clone, env=env)
                report['cloneKernelAfter'] = binding(clone / KERNEL_PATH)
                if evidence.exists():
                    shutil.copytree(evidence, output / 'acceptance')
            require(report['exitCode'] == 0, 'cold scanout acceptance failed')
            require(report['cloneHeadAfter'] == head and not report['statusAfter'],
                    'cold acceptance changed the clone head or checkout')
            require(report['cloneKernelAfter'] == report['cloneKernelBefore'],
                    'cold acceptance modified its kernel input')
            receipt = (output / 'acceptance/receipt.json').read_bytes()
            parsed = json.loads(receipt)
            require(parsed['gitHead'] == head and parsed['status'] == 'passed'
                    and parsed['task'] == 'E6-T11c', 'cold receipt task/head/status mismatch')
            report['receiptSha256'] = sha(receipt)
            report['acceptanceFiles'] = []
            for file in sorted((output / 'acceptance').rglob('*')):
                if file.is_file():
                    item = binding(file)
                    item['path'] = str(file.relative_to(output))
                    report['acceptanceFiles'].append(item)
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
    finally:
        try:
            if 'inputsBefore' in report:
                report['inputsAfter'] = authenticate_inputs(image, assets)
                report['inputsUnchanged'] = report['inputsAfter'] == report['inputsBefore']
                require(report['inputsUnchanged'], 'cold acceptance changed the external desktop inputs')
            if 'harness' in report:
                report['harness']['unchanged'] = binding(Path(__file__).resolve())['sha256'] == report['harness']['sha256']
                require(report['harness']['unchanged'], 'executed cold harness changed during acceptance')
        except Exception as error:
            report['status'] = 'failed'
            report['postRunError'] = str(error)
        report['logSha256'] = sha(log_path.read_bytes()) if log_path.exists() else None
        report['finishedAt'] = now()
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    require(report['status'] == 'passed', report.get('error') or report.get('postRunError') or 'cold acceptance failed')
    print(f'Clean retained-scanout clone passed at {head}: {clone}')


if __name__ == '__main__':
    main()
