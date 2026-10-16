#!/usr/bin/env python3
"""Fresh critic custody audit; never accept the worker receipt as an oracle."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
FREEZE = '7e88b69a565d0042297e3001c8c4044efdf4cca9'
BASE = 'cd59854e79cedf31abe35585bbe1fe616a8fc7ae'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.check_output(['git', *a], cwd=ROOT)


def reopen(folder, extract=None):
    manifest = json.loads((folder/'manifest.json').read_bytes())
    index = (folder/'records.json').read_bytes()
    archive = folder/'recording.tar.gz'
    assert sha(archive.read_bytes()) == manifest['archiveSha256']
    assert sha(index) == manifest['recordIndexSha256']
    descriptor = json.loads(index)
    rows = descriptor['records']
    expected = {r['path']: r for r in rows}
    assert len(expected) == len(rows)
    opened = set()
    total = 0
    with tarfile.open(archive, 'r:gz') as tf:
        for member in tf:
            assert member.isfile() and not member.issym() and not member.islnk()
            p = PurePosixPath(member.name)
            assert not p.is_absolute() and '..' not in p.parts
            assert member.name not in opened and member.name in expected
            row = expected[member.name]
            raw = tf.extractfile(member).read()
            assert member.size == len(raw) == row['bytes']
            assert sha(raw) == row['sha256'], member.name
            if extract:
                target = extract/member.name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
                assert sha(target.read_bytes()) == row['sha256']
            opened.add(member.name)
            total += len(raw)
    assert opened == set(expected)
    assert manifest.get('records', manifest.get('members', len(rows))) == len(rows)
    return dict(folder=folder.relative_to(ROOT).as_posix(), members=len(rows),
                bytes=total, archiveSha256=manifest['archiveSha256'],
                indexSha256=manifest['recordIndexSha256'])


def main():
    unpack = OUT/'unpacked'
    result = dict(prediction='P1', status='HELD', worker=reopen(OUT.parent/'worker', unpack))
    manifest = json.loads((OUT.parent/'worker/manifest.json').read_bytes())
    assert manifest['sourceHead'] == FREEZE
    assert manifest['records'] == 11096
    assert result['worker']['archiveSha256'] == '5867b3470f9efc59feb41276c38aefad463197cf1f8a705c0bb03d0478a537ae'
    assert result['worker']['indexSha256'] == '8451bac5629992d907a3d14de3eaae5eff4ac3b38b1c62a3f639b40b3fab3412'
    assert not git('diff', '--name-only', FREEZE, 'HEAD', '--', 'renderer', 'tools', 'Makefile', 'web', 'crates').strip()
    receipts = {}
    for prefix in ('hot', 'cold'):
        raw = (unpack/prefix/'receipt.json').read_bytes()
        assert sha(raw) == manifest[prefix+'ReceiptSha256']
        receipt = json.loads(raw)
        assert receipt['status'] == 'passed' and receipt['gitHead'] == FREEZE
        for name, digest in receipt['files'].items():
            assert sha((unpack/prefix/name).read_bytes()) == digest, (prefix, name)
        for name, digest in receipt['sources'].items():
            assert sha(git('show', FREEZE+':'+name)) == digest, (prefix, name)
            if not name.startswith('tasks/'):
                assert sha((ROOT/name).read_bytes()) == digest, ('current', name)
        for name, digest in receipt['generated'].items():
            assert sha((unpack/(prefix+'-generated')/name).read_bytes()) == digest
        count = 0
        for file in (unpack/prefix).rglob('report.json'):
            e = json.loads(file.read_bytes())
            if 'sources' not in e:
                continue
            pinned = {r['path']: r['sha256'] for r in e['sources']}
            assert e['gitHead'] == FREEZE
            for r in e.get('servedFiles', []):
                name = r['path'].lstrip('/')
                if name in pinned:
                    assert r['sha256'] == pinned[name]
                    count += 1
            for key in ('browserCoverage', 'screenshot'):
                if key in e:
                    assert sha((file.parent/e[key]['path']).read_bytes()) == e[key]['sha256']
            coverage = file.parent/'browser-coverage.json'
            if coverage.exists():
                for row in json.loads(coverage.read_bytes())['scripts']:
                    assert row['sha256'] == pinned[row['source']]
        receipts[prefix] = dict(receiptSha256=sha(raw), files=len(receipt['files']),
                               sources=len(receipt['sources']), generated=receipt['generated'],
                               servedBindings=count)
    cold = json.loads((unpack/'cold/report.json').read_bytes())
    assert sha((unpack/'cold/report.json').read_bytes()) == manifest['coldReportSha256']
    assert cold['gitHead'] == cold['cloneHead'] == FREEZE
    assert cold['status'] == 'passed' and cold['exitCode'] == 0
    assert cold['statusBefore'] == cold['statusAfter'] == ''
    assert cold['receiptSha256'] == receipts['cold']['receiptSha256']
    assert sha((unpack/'cold/cold.log').read_bytes()) == cold['logSha256']
    clone = Path(cold['clone'])
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip() == FREEZE
    assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone,text=True).strip()
    for n, h in json.loads((unpack/'cold/receipt.json').read_bytes())['generated'].items():
        assert sha((clone/n).read_bytes()) == h
    result.update(receipts=receipts, cold=cold)
    carried = json.loads((unpack/'hot/receipt.json').read_bytes())['carriedVerifiedEvidence']
    for name, digest in carried.items():
        assert sha((ROOT/name).read_bytes()) == digest
        assert sha(git('show', BASE+':'+name)) == digest
    result['carried'] = []
    for base in ('virgl-standard-float-consumer','virgl-standard-packed-float-images','virgl-standard-packed-float-consumer'):
        for role in ('worker','verifier'):
            result['carried'].append(reopen(ROOT/'evidence'/base/role))
    result['carriedExactFiles'] = len(carried)
    (OUT/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(status=result['status'], worker=result['worker'],
                         exactSources=[r['sources'] for r in receipts.values()],
                         carriedSeals=len(result['carried']),carriedFiles=len(carried))))


if __name__ == '__main__':
    main()
