#!/usr/bin/env python3
"""A separate checkout restricts native hints; the literal queue oracle must fail."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1]).resolve()
assert not output.exists()
output.mkdir(parents=True)
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
clone = Path(tempfile.mkdtemp(prefix='wasm-vm-native-buffer-fault-')) / 'repo'
subprocess.run(['git', 'clone', '--quiet', '--shared', '--no-checkout', str(repo), str(clone)], check=True)
subprocess.run(['git', 'checkout', '--quiet', '--detach', head], cwd=clone, check=True)
path = 'crates/core/src/dev/virtio/gpu/control3d.rs'
source = (clone / path).read_bytes()
anchor = b'desktop_resources && self.height == 1 && bind & !112 == 0'
assert source.count(anchor) == 1
mutant = source.replace(anchor, anchor.replace(b'!112', b'!48'))
(clone / path).write_bytes(mutant)
(output / 'original.rs').write_bytes(source)
(output / 'mutant.rs').write_bytes(mutant)
env = {k: v for k, v in os.environ.items() if not k.startswith(('CARGO_', 'RUST', 'LLVM_PROFILE'))}
env['CARGO_TARGET_DIR'] = str(repo / 'target/virgl-native-buffer-fault')
command = ['cargo', 'test', '--offline', '-p', 'wasm-vm-core', '--features', 'virgl-control-proof,gpu-trace,trace',
           '--test', 'virtio_gpu_submit3d', 'selected_desktop_buffer_hints_live_dma_and_atomic_refusals',
           '--', '--nocapture', '--test-threads=1']
result = subprocess.run(command, cwd=clone, env=env, capture_output=True, timeout=600)
(output / 'stdout').write_bytes(result.stdout)
(output / 'stderr').write_bytes(result.stderr)
assert result.returncode == 101, result.stderr[-2000:]
text = result.stderr.decode()
predictions = [v for v in text.splitlines() if v.startswith('NATIVE_BUFFER_PREDICTION ')]
assert predictions[-1] == 'NATIVE_BUFFER_PREDICTION hint=64 response=0x1100'
records = [json.loads(v.removeprefix('SUBMIT3D_PORTABLE_RECORD ')) for v in text.splitlines()
           if v.startswith('SUBMIT3D_PORTABLE_RECORD ')]
point = records[-1]
assert point['case'] == 'desktop-buffer-create'
request = bytes.fromhex(point['request'])
assert int.from_bytes(request[36:40], 'little') == 64
assert int.from_bytes(bytes.fromhex(point['response'])[:4], 'little') == 0x1205
for key in ['transport', 'submit']:
    assert hashlib.sha256(bytes.fromhex(point[key + 'Canonical'])).hexdigest() == point[key + 'Digest']
guards = [json.loads(v.removeprefix('DESKTOP_SUBMIT_POINT ')) for v in text.splitlines()
          if v.startswith('DESKTOP_SUBMIT_POINT ')]
assert guards[-1]['case'] == point['case'] and guards[-1]['guard'] == 'a5' * 40
report = {'schema': 'native-buffer-sabotage-v1', 'head': head, 'clone': str(clone), 'command': command,
          'originalSha256': hashlib.sha256(source).hexdigest(), 'mutantSha256': hashlib.sha256(mutant).hexdigest(),
          'exitCode': result.returncode, 'prediction': predictions[-1], 'point': point, 'guard': guards[-1],
          'finding': 'Native uniform hint64 refused0x1205; the independent literal0x1100 oracle failed.'}
(output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(report['finding'])
