#!/usr/bin/env python3
"""Fresh critic: authenticate every sealed member and exact frozen source."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
WORKER = HERE.parent / 'worker'
FROZEN = 'c9963d71add68b550d9f26a2b9e9d417f3daa437'
DEPENDENCY = '761a912a88823954e3424f7b003c15887e7c9034'
SHA_ARCHIVE = '4a6c5816f8979dbf7e6ed75abd05bedf53073becae307e6a0d970d9c0382270b'
SHA_INDEX = '6613d8d1075325f89a0cca63c78b0a65b73c138f629780b786d21dcad03d77dd'
PROMOTED_HARNESS = {'Makefile', 'renderer/virgl-command/tests/standard-instanced-draws.mjs',
                    'tools/verify-virgl-standard-draw.mjs'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def main():
    manifest = json.loads((WORKER / 'manifest.json').read_bytes())
    archive = (WORKER / 'recording.tar.gz').read_bytes()
    raw_index = (WORKER / 'records.json').read_bytes()
    assert sha(archive) == SHA_ARCHIVE == manifest['archiveSha256']
    assert sha(raw_index) == SHA_INDEX == manifest['recordIndexSha256']
    index = json.loads(raw_index)
    assert manifest['sourceHead'] == index['sourceHead'] == FROZEN
    assert manifest['archiveBytes'] == len(archive)
    assert len(index['records']) == manifest['records'] == 752
    records = {row['path']: row for row in index['records']}
    assert len(records) == len(index['records'])
    members = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
        for member in tar:
            assert member.isfile() and member.name in records and member.name not in members
            assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
            raw = tar.extractfile(member).read()
            assert len(raw) == records[member.name]['bytes'] == member.size
            assert sha(raw) == records[member.name]['sha256']
            members[member.name] = raw
    assert set(members) == set(records)
    for name, raw in members.items():
        destination = HERE / 'unpacked' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
    source_matches = []
    for side in ['hot', 'cold']:
        receipt_raw = members[side + '/receipt.json']
        receipt = json.loads(receipt_raw)
        assert receipt['status'] == 'passed' and receipt['gitHead'] == FROZEN
        assert receipt['carriedCompilerAndOwnershipHead'] == DEPENDENCY
        assert sha(receipt_raw) == manifest[side + 'ReceiptSha256']
        for name, digest in receipt['files'].items():
            assert sha(members[side + '/' + name]) == digest
        for name, digest in receipt['sources'].items():
            assert sha(git('show', FROZEN + ':' + name)) == digest
            current_matches = sha((ROOT / name).read_bytes()) == digest
            assert current_matches or name in PROMOTED_HARNESS, 'current runtime source drift: '+name
            source_matches.append({'side': side, 'path': name, 'sha256': digest,
                                   'frozenSourceMatches': True, 'currentMatches': current_matches,
                                   'currentException': None if current_matches else 'verifier-only promoted harness; frozen worker bytes still authenticated'})
        for name, digest in receipt['generated'].items():
            assert sha(members[side + '-generated/' + name]) == digest
        for gate in ['wire', 'hardware', 'fault-divisor', 'retained-command-decoder',
                     'retained-draw-replay', 'retained-async-jobs', 'retained-float-vertex-fetch']:
            report = json.loads(members[side + '/' + gate + '/report.json'])
            assert report['gitHead'] == FROZEN
            assert report['status'] == ('failed' if gate == 'fault-divisor' else 'passed')
            if gate != 'wire':
                assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
        assert members[side + '/acceptance.log'].find(b'STANDARD_DRAW_RECORDING_COMPLETE\n') >= 0
    cold = json.loads(members['cold/report.json'])
    assert sha(members['cold/report.json']) == manifest['coldReportSha256']
    assert cold['status'] == 'passed' and cold['gitHead'] == cold['cloneHead'] == FROZEN
    assert cold['exitCode'] == 0 and cold['statusBefore'] == cold['statusAfter'] == ''
    assert cold['receiptSha256'] == sha(members['cold/receipt.json'])
    assert cold['logSha256'] == sha(members['cold/cold.log'])
    assert cold['command'] == ['make', 'verify-E6-T11d6']
    clone = Path(cold['clone'])
    assert clone.is_dir()
    assert subprocess.call(['git', 'merge-base', '--is-ancestor', 'f7801621', 'HEAD'], cwd=ROOT) == 0
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=clone).decode().strip() == FROZEN
    assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=clone)
    carried = []
    for name in git('ls-files', 'renderer/virgl-shader', 'renderer/virgl-command/constant-domain.mjs',
                    'renderer/virgl-command/cache.mjs', 'renderer/virgl-command/resources.mjs').decode().splitlines():
        raw = (ROOT / name).read_bytes()
        assert raw == git('show', DEPENDENCY + ':' + name) == git('show', FROZEN + ':' + name)
        carried.append({'path': name, 'sha256': sha(raw)})
    output = {'schema': 'standard-draw-critic-authentication-v1', 'status': 'passed',
              'prediction': 'P1-auth/P10-carry', 'archiveSha256': sha(archive), 'indexSha256': sha(raw_index),
              'records': len(members), 'frozenHead': FROZEN, 'clone': str(clone),
              'clonePristine': True, 'sourceMatches': source_matches, 'carried': carried,
              'coldEnvironmentRemovedNames': cold['removedEnvironmentNames']}
    (HERE / 'authentication.json').write_text(json.dumps(output, indent=2) + '\n')
    print(f'Authenticated {len(members)} records; exact-head hot/cold sources, clean clone and {len(carried)} unchanged D5 files.')


if __name__ == '__main__':
    main()
