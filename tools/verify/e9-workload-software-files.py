#!/usr/bin/env python3
"""Independently inspect literal files in full-workload native COW captures.

This parser does not import emulator codecs. Its result proves the named files,
not desktop qualification, replay, timing, or a task verification verdict.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--directory', type=Path, required=True)
a = parser.parse_args()
root = Path(__file__).resolve().parents[2]
out = a.directory.resolve()
proof = out / 'literal-files-oracle'
proof.mkdir(exist_ok=False)
sha = lambda b: hashlib.sha256(b).hexdigest()
u32 = lambda b, at: struct.unpack_from('<I', b, at)[0]
u64 = lambda b, at: struct.unpack_from('<Q', b, at)[0]
contract_bytes = (root / 'docs/design/session-replay-contract.json').read_bytes()
contract = json.loads(contract_bytes)
fixture = next(f for f in contract['fixtures'] if f['id'] == 'software-alpine-v1')
source = root / fixture['artifacts']['rootfs']['url']
report_bytes = (out / 'report.json').read_bytes()
browser = json.loads(report_bytes)
builder = 'sha256:0d1ead8c1106a838e478676dff113f21cdd91eb9456232ff9f6c24679a87d0eb'
report = {'status': 'running', 'scope': 'Independent literal software files only; no overall qualification or timing verdict',
          'browserSha256': sha(report_bytes), 'contractSha256': sha(contract_bytes), 'builder': builder, 'points': {}}


def hash_file(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda: stream.read(1048576), b''):
            h.update(part)
    return h.hexdigest()


def native_sections(raw):
    assert raw[:12] == b'WVMRESU1\1\0\0\0'
    at, result = 84, {}
    while at < len(raw):
        tag, size = struct.unpack_from('<II', raw, at)
        at += 8
        assert tag not in result and size <= len(raw) - at
        result[tag] = raw[at:at + size]
        at += size
    assert at == len(raw)
    return result


def cow_sectors(device, identity):
    size = u32(device, 0)
    assert size <= len(device) - 4
    hub = device[4:4 + size]
    assert hub[:8] == b'WVDEVST1'
    config_size = u32(hub, 8)
    config = hub[12:12 + config_size]
    assert config[2] == 1 and config[3:35] == identity
    assert u64(config, 35) * 512 == source.stat().st_size
    at = 12 + config_size + 32
    assert u32(hub, at) == 0, 'unsettled original block requests'
    at += 4
    count = u32(hub, at)
    at += 4
    for _ in range(count):
        at += 12
        size = u32(hub, at)
        at += 4 + size
        assert at <= len(hub)
    failed = u32(hub, at)
    at += 4 + failed * 5
    reads = u32(hub, at)
    at += 4
    for _ in range(reads):
        at += 12
        count = u32(hub, at)
        at += 4 + count * 4
        assert at <= len(hub)
    count = u32(hub, at)
    at += 4
    sectors = {}
    for _ in range(count):
        index = u64(hub, at)
        at += 8
        assert index < source.stat().st_size // 512 and index not in sectors
        sectors[index] = hub[at:at + 512]
        assert len(sectors[index]) == 512
        at += 512
    assert at + 9 == len(hub) and u64(hub, at) == 0 and hub[at + 8] == 0
    return sectors



def inspect_point(label, work, entropy_hash):
    file = out / (label + '.resume')
    assert 0 < file.stat().st_size <= 320 * 1048576
    raw = file.read_bytes()
    ref = next(row for row in browser['raw'] if row['file'] == file.name)
    assert ref['bytes'] == len(raw) and ref['sha256'] == sha(raw)
    parts = native_sections(raw)
    sectors = cow_sectors(parts[20], raw[44:76])
    target = proof / (label + '.ext4')
    clone = subprocess.run(['cp', '-c', str(source), str(target)], capture_output=True)
    if clone.returncode:
        shutil.copyfile(source, target)
    with target.open('r+b') as disk:
        for index, value in sectors.items():
            disk.seek(index * 512)
            disk.write(value)
    before = hash_file(target)
    command = ['docker', 'run', '--rm', '--network', 'none', '-v', str(proof) + ':/proof:rw', '--entrypoint', '/sbin/e2fsck', builder,
               '-E', 'journal_only', '-fy', '/proof/' + target.name]
    recovery = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (proof / (label + '.journal.log')).write_bytes(recovery.stdout)
    assert recovery.returncode in (0, 1), recovery.stdout
    files, failures = {}, []
    for name in ['state'] + ([] if label == 'before' else ['entropy']) + (['http'] if label in ['final', 'replay'] else []):
        read_command = ['docker', 'run', '--rm', '--network', 'none', '-v', str(proof) + ':/proof:ro', '--entrypoint', '/usr/sbin/debugfs', builder,
                        '-R', 'cat /root/e9-session/' + name, '/proof/' + target.name]
        result = subprocess.run(read_command, capture_output=True)
        (proof / (label + '.' + name)).write_bytes(result.stdout)
        (proof / (label + '.' + name + '.debugfs.log')).write_bytes(result.stderr)
        value = {'bytes': len(result.stdout), 'hex': result.stdout.hex(), 'sha256': sha(result.stdout), 'command': read_command}
        files[name] = value
        try:
            assert result.returncode == 0
            if name == 'state':
                expected = bytes.fromhex(contract['workload'][('before' if label == 'before' else 'after') + '_hex'])
                assert result.stdout == expected, 'literal state file'
            elif name == 'http':
                assert result.stdout == bytes([27]) * 1024, 'literal tenth HTTP body'
            else:
                assert len(result.stdout) == 32 and sha(result.stdout) == entropy_hash, 'complete setup entropy'
            value['status'] = 'passed'
        except Exception as error:
            value.update(status='failed', error=repr(error))
            failures.append(name + ': ' + repr(error))
    point = work['replay'] if label == 'replay' else work[label]
    position = point.get('position', point)
    assert str(u64(parts[18], 12)) == position['transition'] and str(u64(parts[18], 36)) == position['sequence']
    return {'status': 'failed' if failures else 'passed', 'failures': failures, 'nativeSha256': sha(raw),
            'transition': position['transition'], 'sequence': position['sequence'], 'cowSectors': len(sectors),
            'beforeRecoverySha256': before, 'afterRecoverySha256': hash_file(target), 'recoveryCommand': command, 'files': files}


oracle_source = Path(__file__).read_bytes()
(proof / 'executed-oracle.py').write_bytes(oracle_source)
report['oracleSourceSha256'] = sha(oracle_source)
report['failures'] = []
try:
    assert source.stat().st_size == fixture['artifacts']['rootfs']['size']
    assert hash_file(source) == fixture['artifacts']['rootfs']['sha256']
    report['baseSha256'] = fixture['artifacts']['rootfs']['sha256']
    assert browser['phase'] == 'software' and browser['task'] == 'E9-T22c'
    work = browser['result']
    entropy_hashes = re.findall(r'(?m)^([a-f0-9]{64})  /root/e9-session/entropy$', work['setup']['stdout'])
    assert len(entropy_hashes) == 1
    for label in ['before', 'origin', 'final', 'replay']:
        try:
            point = inspect_point(label, work, entropy_hashes[0])
            report['points'][label] = point
            report['failures'].extend(label + ': ' + failure for failure in point['failures'])
        except Exception as error:
            report['points'][label] = {'status': 'failed', 'error': repr(error)}
            report['failures'].append(label + ': ' + repr(error))
    # These checks run even if a point/file was missing or invalid.
    report['baseUnchanged'] = hash_file(source) == report['baseSha256']
    report['oracleSourceUnchanged'] = Path(__file__).read_bytes() == oracle_source
    assert report['baseUnchanged'], 'original base changed'
    assert report['oracleSourceUnchanged'], 'oracle source changed during execution'
    assert not report['failures'], report['failures']
    final, replay = (report['points'][label] for label in ['final', 'replay'])
    assert final['beforeRecoverySha256'] == replay['beforeRecoverySha256'], 'native COW media differ'
    assert all(final['files'][name]['hex'] == replay['files'][name]['hex'] for name in ['state', 'entropy', 'http'])
    report['status'] = 'literal-software-files-passed'
except Exception as error:
    report['status'] = 'failed'
    report['error'] = repr(error)
    raise
finally:
    (proof / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'points': list(report['points'])}))
