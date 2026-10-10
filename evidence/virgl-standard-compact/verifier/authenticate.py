import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
FREEZE = 'ac77cdd095de121d71628308d920bfdcdbc454c3'
PARENT = '1fbdfa7e53ebe6e8ed4a80935687d8b71a797f42'
WORKER = HERE.parent / 'worker'
sha = lambda b: hashlib.sha256(b).hexdigest()
read = lambda p: json.loads(p.read_text())
git = lambda *args: subprocess.check_output(['git', *args], cwd=ROOT)
manifest = read(WORKER / 'manifest.json')
assert sha((WORKER / 'recording.tar.gz').read_bytes()) == manifest['archiveSha256'] == 'fcf9e7c4490eda1974668d22a8d1f1f2d28fbea28a8d157b31675d56fba860c4'
assert sha((WORKER / 'records.json').read_bytes()) == manifest['recordIndexSha256'] == '0b90efc9b0106526f4e54294377d4e01c7a1e464ee1daa4c24038385d8f2f480'
index = read(WORKER / 'records.json')
assert index['sourceHead'] == manifest['sourceHead'] == FREEZE
records = {r['path']: r for r in index['records']}
assert len(records) == len(index['records']) == manifest['records'] == 16252
unpacked = HERE / 'unpacked'
unpacked.mkdir(exist_ok=True)
with tarfile.open(WORKER / 'recording.tar.gz', 'r:gz') as archive:
    entries = archive.getmembers()
    assert len(entries) == len(records)
    for member in entries:
        assert member.isfile() and not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
        row = records[member.name]
        data = archive.extractfile(member).read()
        assert len(data) == row['bytes'] and sha(data) == row['sha256'], member.name
        dest = unpacked / member.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

out = {'schema': 'standard-compact-critic-authentication-v1', 'sourceHead': FREEZE, 'records': len(records),
       'archiveSha256': manifest['archiveSha256'], 'indexSha256': manifest['recordIndexSha256'], 'runs': [], 'historical': {}, 'status': 'running'}
assert set(git('diff', '--name-only', FREEZE, '8ad1959d3eb00335b49d1786c5dc0fb5701de76c').decode().splitlines()) <= {
    'tasks/QUEUE.md', 'tasks/epic-6-transcendence/E6-T11d12-standard-compact-vertex-fetch.md',
    'evidence/virgl-standard-compact/worker/manifest.json', 'evidence/virgl-standard-compact/worker/records.json',
    'evidence/virgl-standard-compact/worker/recording.tar.gz'}
pins = read(ROOT / 'evidence/virgl-standard-points/verifier/manifest.json')['sources']
for prefix in ['hot', 'cold']:
    base = unpacked / prefix
    receipt = read(base / 'receipt.json')
    assert receipt['gitHead'] == FREEZE and receipt['status'] == 'passed'
    for path, digest in receipt['files'].items():
        assert sha((base / path).read_bytes()) == digest, (prefix, path)
    for path, digest in receipt['sources'].items():
        data = git('show', FREEZE + ':' + path)
        assert sha(data) == digest == sha((ROOT / path).read_bytes()), (prefix, path)
    for path, digest in receipt['generated'].items():
        assert sha((unpacked / (prefix + '-generated') / path).read_bytes()) == digest == pins[path], path
    for path, digest in receipt['carriedVerifiedEvidence'].items():
        assert sha(git('show', PARENT + ':' + path)) == digest == sha((ROOT / path).read_bytes()), path
        out['historical'][path] = digest
    physical = []
    for report_path in sorted(base.rglob('report.json')):
        report = read(report_path)
        if 'sources' not in report:
            continue
        assert report['gitHead'] == FREEZE
        served = {v['path']: v for v in report['servedFiles']}
        for row in report['sources']:
            data = (unpacked / (prefix + '-generated') / row['path']).read_bytes() if row['path'] in receipt['generated'] else git('show', FREEZE + ':' + row['path'])
            assert len(data) == row['bytes'] and sha(data) == row['sha256']
            if '/' + row['path'] in served:
                expected = row['sha256']
                if report.get('mutation', {}).get('path') == row['path']:
                    mutation = report['mutation']
                    changed = data.replace(mutation['needle'].encode(), mutation['replacement'].encode())
                    assert data.count(mutation['needle'].encode()) == 1
                    assert changed == (report_path.parent / 'mutation-source.mjs').read_bytes()
                    expected = sha(changed)
                    assert expected == mutation['servedSha256']
                assert served['/' + row['path']]['sha256'] == expected
        assert report['fixedMemory'] == {'bytes': 16777216, 'stageExport': 'function', 'pairExport': 'function'}
        if 'browser' not in report:
            assert report['status'] == 'passed' and len(report['wire']['records']) == 301
            continue
        assert report['browserErrors'] == {'console': [], 'page': [], 'requests': []}
        assert not report['browser']['headless']
        assert report['browser']['gpu']['featureStatus'].get('webgl2', report['browser']['gpu']['featureStatus'].get('webgl')) == 'enabled'
        assert not any(any(x in a.lower() for x in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe', '--disable-gpu']) for a in report['browser']['commandLine'])
        assert sha(Path(report['browser']['executable']).read_bytes()) == report['browser']['sha256']
        cov = read(report_path.parent / report['browserCoverage']['path'])
        assert sha((report_path.parent / report['browserCoverage']['path']).read_bytes()) == report['browserCoverage']['sha256']
        for script in cov['scripts']:
            assert script['sha256'] == served['/' + script['source']]['sha256']
        result = report.get('partial') or report['browserResult']['result']
        for blob in result['blobs']:
            packed = (report_path.parent / blob['path']).read_bytes()
            data = gzip.decompress(packed)
            assert sha(packed) == blob['gzipSha256'] and sha(data) == blob['sha256'] and len(data) == blob['bytes']
        assert sha((report_path.parent / report['screenshot']['path']).read_bytes()) == report['screenshot']['sha256']
        physical.append({'path': str(report_path.relative_to(unpacked)), 'status': report['status'], 'frames': len(result['frames']),
                         'sha256': sha(report_path.read_bytes()), 'served': len(served), 'blobs': len(result['blobs'])})
    expected = [base + n for base in [28, 48, 56, 64, 74, 91] for n in range(4)]
    native = (base / 'abi/compact-native.json').read_bytes()
    assert native == (base / 'abi/compact-sanitize.json').read_bytes()
    assert json.loads(native) == {'status': 'pinned-header', 'formats': expected}
    out['runs'].append({'prefix': prefix, 'sources': len(receipt['sources']), 'generated': receipt['generated'], 'files': len(receipt['files']), 'physical': physical})

cold = read(unpacked / 'cold/report.json')
assert cold['gitHead'] == cold['cloneHead'] == FREEZE and cold['status'] == 'passed' and cold['exitCode'] == 0
assert cold['statusBefore'] == cold['statusAfter'] == '' and cold['command'] == ['make', 'verify-E6-T11d12']
assert sha((unpacked / 'cold/cold.log').read_bytes()) == cold['logSha256']
assert sha((unpacked / 'cold/receipt.json').read_bytes()) == cold['receiptSha256']
assert sha((unpacked / 'hot/receipt.json').read_bytes()) == manifest['hotReceiptSha256']
assert sha((unpacked / 'cold/receipt.json').read_bytes()) == manifest['coldReceiptSha256']
assert sha((unpacked / 'cold/report.json').read_bytes()) == manifest['coldReportSha256']
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=cold['clone'],text=True).strip() == FREEZE
assert subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=cold['clone'],text=True) == ''
out['cold'] = cold
out['status'] = 'passed'
(HERE / 'authentication.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps({'status': out['status'], 'records': len(records), 'historical': len(out['historical']), 'runs': [{k:r[k] for k in ['prefix','sources','files']} for r in out['runs']]}))
