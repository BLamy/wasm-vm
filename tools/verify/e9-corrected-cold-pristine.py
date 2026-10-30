#!/usr/bin/env python3
"""Run T22u once from a pristine clone with explicit, hash-receipted boot inputs."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time


def digest(file):
    value = hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(part)
    return value.hexdigest()


def inventory(directory):
    rows = []
    for file in sorted(directory.rglob('*')):
        if file.is_symlink():
            raise RuntimeError('external cache must contain owned regular files: ' + str(file))
        if file.is_file():
            rows.append({'path': str(file.relative_to(directory)),
                         'bytes': file.stat().st_size, 'sha256': digest(file)})
    return rows


def scrub_environment(environment):
    return {key: value for key, value in environment.items()
            if not key.startswith('CARGO_') and key not in {
                'RUSTFLAGS', 'RUST_LOG', 'RUSTDOCFLAGS', 'RUSTC_WRAPPER',
                'RUSTC_WORKSPACE_WRAPPER', 'RUSTC', 'RUSTDOC', 'RUSTC_BOOTSTRAP'}}


def owned_root(path):
    absolute = path.absolute()
    canonical = path.resolve(strict=True)
    if absolute != canonical or not canonical.is_dir():
        raise RuntimeError('input root must be a canonical owned directory: ' + str(path))
    return canonical


def cargo_boundary(root, environment):
    # Only this read-only Cargo configuration query enables the unstable getter;
    # the build environment remains scrubbed and does not receive this override.
    config = json.loads(subprocess.check_output(
        ['cargo', '-Z', 'unstable-options', 'config', 'get', '--format', 'json'],
        cwd=root, env={**environment, 'RUSTC_BOOTSTRAP': '1'}, text=True))
    build = config.get('build', {})
    for key in ['rustc-wrapper', 'rustc-workspace-wrapper', 'rustc', 'rustdoc']:
        if build.get(key):
            raise RuntimeError('custom Cargo compiler or wrapper is not pristine: ' + key)
    metadata = json.loads(subprocess.check_output(
        ['cargo', 'metadata', '--format-version', '1', '--no-deps', '--offline'],
        cwd=root, env=environment, text=True))
    expected = root / 'target'
    for key in ['target_directory', 'build_directory']:
        if Path(metadata[key]).resolve() != expected or expected.is_symlink():
            raise RuntimeError('Cargo artifact directory escapes the fresh clone: ' + key)
    if Path(metadata['workspace_root']).resolve() != root:
        raise RuntimeError('Cargo workspace is not the fresh clone')
    return {'targetDirectory': metadata['target_directory'],
            'buildDirectory': metadata['build_directory'], 'configuredCompilerWrappers': False,
            'configProbeOnly': 'RUSTC_BOOTSTRAP=1; absent from the gate environment'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['source', 'destination', 'calibration-root', 'base-cache']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.head):
        parser.error('--head must be a complete commit hash')
    if sys.platform != 'darwin':
        parser.error('this local proving wrapper requires macOS and APFS clone support')
    source = owned_root(args.source)
    destination = args.destination.absolute()
    calibration = owned_root(args.calibration_root)
    cache = owned_root(args.base_cache)
    if destination.exists() or destination.is_symlink():
        parser.error('--destination must not exist')
    if destination.parent.resolve(strict=True) / destination.name != destination:
        parser.error('--destination must have a canonical existing parent')
    for root in [source, calibration, cache]:
        if destination.is_relative_to(root) or root.is_relative_to(destination):
            parser.error('clone destination must be disjoint from every input root')
    if calibration.is_relative_to(cache) or cache.is_relative_to(calibration):
        parser.error('calibration and cache roots must be disjoint')
    environment = scrub_environment(os.environ)

    def git(root, *arguments):
        return subprocess.check_output(['git', '-C', str(root), *arguments],
                                       env=environment, text=True).strip()

    if git(source, 'rev-parse', 'HEAD') != args.head or git(source, 'status', '--porcelain'):
        raise RuntimeError('source must be the clean frozen head')
    subprocess.run(['git', 'clone', '--local', '--no-hardlinks', '--dissociate', '--single-branch',
                    str(source), str(destination)], env=environment, check=True)
    if (git(destination, 'rev-parse', 'HEAD') != args.head
            or git(destination, 'status', '--porcelain')
            or (destination / '.git/objects/info/alternates').exists()):
        raise RuntimeError('clone is not pristine and independent')
    if (destination / 'target').exists() or (destination / 'target').is_symlink():
        raise RuntimeError('fresh clone unexpectedly contains an artifact directory')
    out = destination / 'target/evidence' / ('e9-t22u-pristine-' + args.head[:12])
    out.mkdir(parents=True, exist_ok=False)
    receipt = {'status': 'staging', 'head': args.head, 'source': str(source),
               'destination': str(destination), 'started': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'wrapperSha256': digest(Path(__file__)), 'artifactDirectoryAbsentBeforeProbes': True,
               'scrubbedEnvironmentKeys': sorted(set(os.environ) - set(environment)), 'inputs': []}

    def save():
        (out / 'pristine.json').write_text(json.dumps(receipt, indent=2) + '\n')

    def copy(file, target, declared_root):
        resolved = file.resolve(strict=True)
        if not resolved.is_relative_to(declared_root) or not resolved.is_file():
            raise RuntimeError('external input escapes its declared root: ' + str(file))
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if digest(target) != digest(resolved):
                raise RuntimeError('tracked boot input differs: ' + str(target))
        else:
            shutil.copy2(resolved, target)
        checksum = digest(resolved)
        if digest(target) != checksum:
            raise RuntimeError('staged input changed: ' + str(target))
        receipt['inputs'].append({'source': str(resolved), 'staged': str(target),
                                  'bytes': target.stat().st_size, 'sha256': checksum})

    process = assertion = None
    try:
        receipt['cargoBoundary'] = cargo_boundary(destination, environment)
        receipt['compiledCacheBorrowed'] = False
        staged_calibration = destination / 'target/e9-cold-calibration'
        for name in [
            'e9-t22c-submission-19bd97e6e/desktop/report.json',
            'e9-t22c-submission-19bd97e6e/desktop/saved/storage.json',
            'e9-t22r-720f53afe/desktop/report.json',
            'e9-t22o-839481890-fullbase/desktop/report.json',
        ]:
            copy(calibration / name, staged_calibration / name, calibration)
        for name in ['releases/kernel/6.6.63-omarchy-evdev1024/Image',
                     'releases/initramfs/busybox']:
            copy(source / name, destination / name, source)
        before = inventory(cache)
        staged_cache = destination / 'target/e9-workload-base-cache'
        # APFS clone-on-write copies keep the files independent without storing
        # a second physical copy of this immutable multi-GiB public base cache.
        subprocess.run(['cp', '-cR', str(cache), str(staged_cache)], check=True, env=environment)
        after = inventory(staged_cache)
        if not before or before != after:
            raise RuntimeError('materialized cache differs after staging')
        cache_bytes = (json.dumps(after, separators=(',', ':')) + '\n').encode()
        (out / 'base-cache.json').write_bytes(cache_bytes)
        receipt['cache'] = {'source': str(cache), 'staged': str(staged_cache),
                            'files': len(after), 'bytes': sum(row['bytes'] for row in after),
                            'inventorySha256': hashlib.sha256(cache_bytes).hexdigest()}
        if git(destination, 'status', '--porcelain'):
            raise RuntimeError('external staging modified tracked source')
        environment.update(E9_CALIBRATION_ROOT=str(staged_calibration),
                           E9_BASE_CACHE=str(staged_cache), E9_OUT=str(out / 'run'))
        receipt.update(status='running', command=['make', 'verify-E9-T22u'],
                       externalInputArguments={key: environment[key] for key in
                                               ['E9_CALIBRATION_ROOT', 'E9_BASE_CACHE', 'E9_OUT']})
        save()
        with (out / 'gate.log').open('wb') as log:
            process = subprocess.Popen(receipt['command'], cwd=destination, env=environment,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            assertion = subprocess.Popen(['caffeinate', '-i', '-w', str(process.pid)], env=environment)
            receipt.update(gatePid=process.pid, sleepAssertionPid=assertion.pid)
            save()
            while process.poll() is None:
                if assertion.poll() is not None:
                    raise RuntimeError('sleep assertion exited while the gate was still running')
                time.sleep(1)
            code = process.returncode
            if assertion.wait(timeout=30) != 0:
                raise RuntimeError('sleep assertion did not finish successfully')
            receipt['sleepAssertionExitCode'] = assertion.returncode
        receipt.update(exitCode=code, dirtyAfter=git(destination, 'status', '--porcelain'))
        receipt['status'] = 'pristine-gate-passed' if code == 0 and not receipt['dirtyAfter'] else 'failed'
        return 0 if receipt['status'] == 'pristine-gate-passed' else 1
    except BaseException as error:
        receipt.update(status='failed', failure=str(error))
        raise
    finally:
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        if assertion is not None and assertion.poll() is None:
            assertion.terminate()
            assertion.wait(timeout=30)
        receipt['finished'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        save()
        print(json.dumps({'status': receipt['status'], 'receipt': str(out / 'pristine.json')}), flush=True)


if __name__ == '__main__':
    sys.exit(main())
