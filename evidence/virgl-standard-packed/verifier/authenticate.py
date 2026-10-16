#!/usr/bin/env python3
"""Fresh critic authentication; no worker receipt/validator code is imported."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
WORKER = HERE.parent / 'worker'
FREEZE = 'e7a85906622794c60872876f9d3e80da83df9ccd'
PREDECESSOR = '23bf410f9e152d53e83e674717c647a4164dcde7'
SUBMISSION = '520dbc10ad15f3ae328de577db724b1ff99cb32a'
sha = lambda b: hashlib.sha256(b).hexdigest()
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

manifest = json.loads((WORKER / 'manifest.json').read_bytes())
index_bytes = (WORKER / 'records.json').read_bytes()
archive = WORKER / 'recording.tar.gz'
index = json.loads(index_bytes)
assert sha(archive.read_bytes()) == manifest['archiveSha256'] == '724887df2941202113d22fd297f8e3a5633ab0ddb409fd8ffa5ef260d4cc0113'
assert sha(index_bytes) == manifest['recordIndexSha256'] == '1c46154671bdbf7a2e743fbff97db333fee4ad28ac96aca5dcc22d9e1c9e6f85'
assert archive.stat().st_size == manifest['archiveBytes']
assert index['sourceHead'] == manifest['sourceHead'] == FREEZE
assert index['task'] == manifest['task'] == 'E6-T11d15'
records = {r['path']: r for r in index['records']}
assert len(records) == len(index['records']) == manifest['records'] == 17844
unpacked = HERE / 'unpacked'
seen = set()
with tarfile.open(archive, 'r:gz') as tar:
    for member in tar:
        p = PurePosixPath(member.name)
        assert member.isfile() and not p.is_absolute() and '..' not in p.parts
        assert member.name in records and member.name not in seen
        raw = tar.extractfile(member).read()
        row = records[member.name]
        assert len(raw) == row['bytes'] == member.size and sha(raw) == row['sha256'], member.name
        target = unpacked / member.name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        seen.add(member.name)
assert seen == set(records)

receipts = {}
source_count = 0
for family, key, expected in [('hot','hotReceiptSha256','f25e1da2e1570ff7e48d11c10ecd9fe6422a25010e897a27339cb6812f5a2941'),
                               ('cold','coldReceiptSha256','ca81c3ebbe088cce3e376c4c3762637ceb23bbbde6bce22e71ebb94c228ac7be')]:
    raw = (unpacked / family / 'receipt.json').read_bytes()
    assert sha(raw) == manifest[key] == expected
    receipt = json.loads(raw)
    assert receipt['gitHead'] == FREEZE and receipt['status'] == 'passed'
    assert not receipt['productionDrawAuthority'] and not receipt['guestExecution'] and not receipt['productionNegotiation']
    for name, digest in receipt['files'].items():
        assert records[family + '/' + name]['sha256'] == digest, name
    for name, digest in receipt['generated'].items():
        assert records[family + '-generated/' + name]['sha256'] == digest, name
    for name, digest in receipt['sources'].items():
        assert sha(git('show', FREEZE + ':' + name)) == digest, name
        source_count += 1
    for name, digest in receipt['carriedVerifiedEvidence'].items():
        assert sha(git('show', PREDECESSOR + ':' + name)) == digest, name
        assert sha(git('show', SUBMISSION + ':' + name)) == digest, name
    receipts[family] = {'sha256': sha(raw), 'files': len(receipt['files']), 'sources': len(receipt['sources']),
                       'generated': len(receipt['generated']), 'carriedEvidence': len(receipt['carriedVerifiedEvidence'])}
cold_raw = (unpacked/'cold/report.json').read_bytes()
cold = json.loads(cold_raw)
assert sha(cold_raw) == manifest['coldReportSha256'] == '8dbe00ca06db09938229d07fd2e8e0d7a6cfef63410600be66046ed6e90f7ae1'
assert cold['status'] == 'passed' and cold['exitCode'] == 0
assert cold['gitHead'] == cold['cloneHead'] == FREEZE
assert cold['statusBefore'] == cold['statusAfter'] == ''
assert cold['command'] == ['make','verify-E6-T11d15']
assert sha((unpacked/'cold/cold.log').read_bytes()) == cold['logSha256']
assert cold['receiptSha256'] == manifest['coldReceiptSha256']
changed = git('diff','--name-only',FREEZE,SUBMISSION).decode().splitlines()
assert set(changed) == {'evidence/virgl-standard-packed/worker/manifest.json',
                       'evidence/virgl-standard-packed/worker/records.json',
                       'evidence/virgl-standard-packed/worker/recording.tar.gz',
                       'tasks/QUEUE.md', 'tasks/epic-6-transcendence/E6-T11d15-standard-packed-vertex-fetch.md'}
assert not git('diff','--name-only',PREDECESSOR,SUBMISSION,'--','crates','web','tools/guest').strip()
result = {'schema':'standard-packed-critic-authentication-v1','status':'passed','sourceFreeze':FREEZE,
          'submission':SUBMISSION,'predecessor':PREDECESSOR,'archiveSha256':manifest['archiveSha256'],
          'indexSha256':sha(index_bytes),'records':len(seen),'sourcePinsIndependentlyAuthenticated':source_count,
          'receipts':receipts,'freezeToSubmissionChanged':changed,'cold':cold}
(HERE/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':'passed','records':len(seen),'sourcePins':source_count,'receipts':receipts}))
