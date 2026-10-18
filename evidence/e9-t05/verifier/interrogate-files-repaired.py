#!/usr/bin/env python3
"""Rebuild each recorded historical disk independently and read it with e2fsprogs."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[3]
ORIGINAL = ROOT / 'target/evidence/e9-t05-worker-repaired/browser'
OUT = ROOT / 'target/evidence/e9-t05-independent-ext4-repaired'
OUT.mkdir(exist_ok=True)


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for data in iter(lambda: source.read(1 << 20), b''):
            h.update(data)
    return h.hexdigest()


base = json.loads((ORIGINAL / 'base.json').read_text())
source = Path(base['source'])
assert source.is_relative_to(ROOT) if hasattr(source, 'is_relative_to') else str(source).startswith(str(ROOT) + '/')
assert sha(source) == base['sha256']
image = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}',
                                 'wasm-vm-rootfs-build:local'], text=True).strip()
report = {'status': 'running', 'docker_image': image, 'base_sha256': base['sha256'], 'images': {}}
for name, expected in [('before', b'e9:before\n'), ('after', b'e9:after\n'), ('restored', b'e9:before\n')]:
    delta = (ORIGINAL / (name + '.disk.wvod')).read_bytes()
    assert delta[:9] == b'WVOD1' + struct.pack('<I', 4096)
    assert struct.unpack_from('<Q', delta, 9)[0] == source.stat().st_size
    assert delta[17:49].hex() == base['manifest_sha256']
    count = struct.unpack_from('<I', delta, 57)[0]
    assert len(delta) == 61 + count * 4104
    target = OUT / (name + '.ext4')
    if target.exists():
        target.unlink()
    cloned = subprocess.run(['cp', '-c', str(source), str(target)], capture_output=True)
    if cloned.returncode:
        shutil.copyfile(source, target)
    block_hashes = {}
    with target.open('r+b') as disk:
        last = -1
        for at in range(61, len(delta), 4104):
            block = struct.unpack_from('<Q', delta, at)[0]
            assert last < block < source.stat().st_size // 4096
            last = block
            data = delta[at + 8:at + 4104]
            disk.seek(block * 4096)
            disk.write(data)
            block_hashes[str(block)] = hashlib.sha256(data).hexdigest()
    recover = ['docker', 'run', '--rm', '--network', 'none', '-v', str(OUT) + ':/proof:rw',
               '--entrypoint', '/sbin/e2fsck', image, '-fy', '/proof/' + target.name]
    with (OUT / (name + '.fsck.log')).open('wb') as log:
        result = subprocess.run(recover, stdout=log, stderr=subprocess.STDOUT)
    assert result.returncode in (0, 1)
    queries = {}
    for command in ['cat /root/e9-session/state', 'stat /root/e9-session/state']:
        arguments = ['docker', 'run', '--rm', '--network', 'none', '-v', str(OUT) + ':/proof:ro',
                     '--entrypoint', '/usr/sbin/debugfs', image, '-R', command, '/proof/' + target.name]
        result = subprocess.run(arguments, capture_output=True)
        assert result.returncode == 0
        if command.startswith('cat'):
            assert result.stdout == expected
        queries[command] = {'command': arguments, 'stdout': result.stdout.decode(),
                            'stderr': result.stderr.decode()}
    report['images'][name] = {'blocks': block_hashes, 'file_hex': expected.hex(), 'queries': queries,
                              'reconstructed_sha256': sha(target), 'recovery': recover}
assert sha(source) == base['sha256']
report['status'] = 'passed'
(ROOT / 'evidence/e9-t05/verifier/files-repaired-interrogation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'files': {key: value['file_hex'] for key, value in report['images'].items()}}))
