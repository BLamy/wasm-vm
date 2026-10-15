#!/usr/bin/env python3
"""Record only the promoted original-MMIO capacity fixture and its own checks."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--old-production', action='store_true')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=False)
package = repo / 'tools/virgl-production/critic-desktop-capacity-native'
env = {k: v for k, v in os.environ.items() if not (k.startswith('CARGO_') or k in ('RUSTFLAGS', 'RUST_LOG', 'RUSTDOCFLAGS'))}
env['CARGO_TARGET_DIR'] = str(repo / 'target/critic-desktop-capacity-native')
features = ['--features', 'old-production'] if args.old_production else []
manifest = ['--manifest-path', str(package / 'Cargo.toml')]
commands = [
    ('fmt', ['cargo', 'fmt', *manifest, '--', '--check']),
    ('clippy', ['cargo', 'clippy', *manifest, '--all-targets', *features, '--', '-D', 'warnings']),
    ('original-wire', ['cargo', 'test', *manifest, *features, '--test', 'original', '--', '--nocapture', '--test-threads=1']),
]
source_paths = [package / 'Cargo.toml', package / 'Cargo.lock', *sorted((package / 'tests').rglob('*.rs')), Path(__file__).resolve(), repo / 'crates/core/src/dev/virtio/gpu/control3d.rs', repo / 'crates/core/src/dev/virtio/gpu/checkpoint.rs']
identities = []
for path in source_paths:
    raw = path.read_bytes()
    identities.append({'path': path.relative_to(repo).as_posix(), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
report = {'task': 'E6-T11d74d2', 'scope': 'Native original Machine/MMIO/virtqueue only; no physical GPU or publication claim',
          'mode': 'original64-baseline' if args.old_production else 'production512-context32', 'status': 'running',
          'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
          'sources': identities, 'commands': []}
(output / 'pre-data-predictions.json').write_text(json.dumps({'beforeRun': True, 'mode': report['mode'], 'sources': identities,
    'predictions': ['Literal104 popup after64 tiny resources admitted only by new production policy.', 'Production512+1 and32+1 refuse atomically; historical16/64/context8 stay unchanged.', 'Each completion echoes the original fenced-u64 and publishes exactly one24byte used response.', 'Fully present33context/513resource/513unique-membership and last-entry duplicates, with independently rehashed inner+whole envelopes, refuse detached without changing CPU/RAM/native transport or publishing host callbacks.']}, indent=2) + '\n')
try:
    for name, command in commands:
        started = time.monotonic()
        with (output / (name + '.stdout')).open('wb') as stdout, (output / (name + '.stderr')).open('wb') as stderr:
            result = subprocess.run(command, cwd=repo, env=env, stdout=stdout, stderr=stderr)
        report['commands'].append({'name': name, 'command': command, 'exitCode': result.returncode, 'seconds': time.monotonic() - started})
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        if result.returncode:
            raise RuntimeError(name + ' failed')
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'
    report['error'] = str(error)
finally:
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'mode': report['mode'], 'commands': [{'name': r['name'], 'exitCode': r['exitCode']} for r in report['commands']]}))
raise SystemExit(0 if report['status'] == 'passed' else 1)
