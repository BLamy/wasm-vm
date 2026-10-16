#!/usr/bin/env python3
"""Fresh critic: reopen every logical D46/D45 body without receipt summaries."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BASE = '2a55ba679abda640781b854d83726d35fca1d98d'
FREEZE = '28e5e7ab42ae52c75713b96ffad37727cceb05d6'
WORKER = '6ba58093a47843a4b17cfbd4929f496b1a859f36'
PINS = {
    'worker': ('6e1ab959e3e04a2998eabf4b60233419f3b0934ee33ccf2d36b09e441c28886c',
               'bfee67b4e66aa3645f1f05a7847ef0e8f6ee5f092904a60ff56ab28c22aae8eb',
               '5d40d9cf0650b561637863b24cd52984cf1fbaf08ebf988e8a57940add1f13ed', 83324),
    'verifier': ('4b0b3b14105b4005e68bf52dde8666e0b85fd80731ad988e39f1759b4a3d66a9',
                 '8ed963dbb701cf544a1c6c1adfe409e5164d8f664b7737fde65924588a2bcd6e',
                 'd76c57d568deff90f0578b45afde5405804981b4d5c6e33f192f1ab979b27a1b', 8065),
}
sha = lambda b: hashlib.sha256(b).hexdigest()


def git_bodies(head, names):
    names = list(names)
    query = ''.join(head + ':' + n + '\n' for n in names).encode()
    raw = subprocess.check_output(['git', 'cat-file', '--batch'], input=query, cwd=ROOT)
    result, at = {}, 0
    for name in names:
        end = raw.index(b'\n', at)
        fields = raw[at:end].split()
        assert len(fields) == 3 and fields[1] == b'blob', (head, name, fields)
        size = int(fields[2]); at = end + 1
        result[name] = raw[at:at+size]
        at += size
        assert raw[at:at+1] == b'\n'; at += 1
    assert at == len(raw)
    return result


def reopen(archive, index_raw, destination=None):
    indexed = json.loads(index_raw)['records']
    wanted = {r['path']: r for r in indexed}
    assert len(wanted) == len(indexed)
    bodies, regular, seen, rows = {}, {}, set(), []
    # Sequential gzip traversal; only actual earlier physical bodies are cached.
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r|gz') as tar:
        for m in tar:
            assert m.name in wanted and m.name not in seen, m.name
            assert m.isfile() or m.islnk(), m.name
            assert not Path(m.name).is_absolute() and '..' not in Path(m.name).parts
            if m.islnk():
                assert m.linkname in regular, (m.name, m.linkname)
                raw, physical_at = regular[m.linkname]
                assert physical_at < m.offset
            else:
                raw = tar.extractfile(m).read()
                regular[m.name] = (raw, m.offset)
            r = wanted[m.name]
            digest = sha(raw)
            assert len(raw) == r['bytes'] and digest == r['sha256'], m.name
            seen.add(m.name); bodies[m.name] = raw
            rows.append(dict(path=m.name, bytes=len(raw), sha256=digest,
                             offset=m.offset, physical=m.linkname if m.islnk() else m.name))
            if destination is not None:
                p = destination/m.name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(raw)
    assert seen == set(wanted)
    return bodies, dict(members=len(rows), physicalBodies=len(regular),
                       logicalBytes=sum(r['bytes'] for r in rows),
                       physicalBytes=sum(len(r[0]) for r in regular.values()), rows=rows)


def main(output):
    out = Path(output).resolve(); out.mkdir(parents=True, exist_ok=True)
    folder = ROOT/'evidence/virgl-instance-base/worker'
    mraw = (folder/'manifest.json').read_bytes(); iraw = (folder/'records.json').read_bytes()
    assert sha(mraw) == '649def87b9a04660ba795de462f7ff1773bf0d9db9b89c501b6a417accddf5ce'
    assert sha(iraw) == 'e9ff82d91a2f6d8e6310e971ef87357a5aa22237f5eaf25facad465351ee29b9'
    m = json.loads(mraw)
    assert m['sourceHead'] == FREEZE
    parts = []
    published_names = ['manifest.json', 'records.json']
    for part in m['archiveParts']:
        raw = (folder/part['path']).read_bytes()
        assert len(raw) == part['bytes'] and sha(raw) == part['sha256']
        parts.append(raw); published_names.append(part['path'])
    archive = b''.join(parts)
    assert len(archive) == 97678160 and sha(archive) == 'f746e58d61505392aa5b7f23fe919e2585187be0925e86f3158282052076df0e'
    names = ['evidence/virgl-instance-base/worker/'+n for n in published_names]
    published = git_bodies(WORKER, names)
    assert all((ROOT/n).read_bytes() == published[n] for n in names)
    bodies, audit = reopen(archive, iraw, out/'worker-reopened')
    assert audit['members'] == 2584
    source_names = [n.removeprefix('source/') for n in bodies if n.startswith('source/')]
    frozen_sources = git_bodies(FREEZE, source_names)
    source_rows = []
    for n in source_names:
        assert bodies['source/'+n] == frozen_sources[n], n
        source_rows.append(dict(path=n, bytes=len(frozen_sources[n]), sha256=sha(frozen_sources[n])))
        if n not in ['Makefile', 'tasks/epic-6-transcendence/E6-T11d46-instance-base-compiler.md']:
            assert (ROOT/n).read_bytes() == frozen_sources[n], ('current dependency drift', n)
    receipts = []
    for prefix, pin in [('hot', '64d0d99ac40db4cfec61f68a6b7002557be9c1fcfcc85b063b8c38b94fb521ea'),
                        ('cold', '49d938be6065ddff1c54edb0faa6155ba1a81511266219b738cfa890d791b4ea')]:
        raw = bodies[prefix+'/receipt.json']; assert sha(raw) == pin
        receipt = json.loads(raw)
        assert receipt['gitHead'] == FREEZE and receipt['predecessor'] == BASE
        for name, pin in receipt['files'].items():
            assert sha(bodies[prefix+'/'+name]) == pin, (prefix, name)
        for name, pin in receipt['sources'].items():
            assert sha(bodies['source/'+name]) == pin, (prefix, name)
        for name, pin in receipt['generated'].items():
            assert sha(bodies[prefix+'-generated/'+name]) == pin, (prefix, name)
        receipts.append(dict(prefix=prefix, receiptSha256=sha(raw), files=len(receipt['files']),
                             sources=len(receipt['sources']), generated=len(receipt['generated'])))
    used_generated = {}
    for name, pin in json.loads(bodies['hot/receipt.json'])['generated'].items():
        if name.startswith('renderer/virgl-shader/build/standard-instance-base-') or name.startswith('renderer/virgl-shader/build/wasm/'):
            raw = (ROOT/name).read_bytes()
            assert sha(raw) == pin and raw == bodies['hot-generated/'+name], ('actual compiler drift', name)
            used_generated[name] = dict(bytes=len(raw), sha256=pin)
    craw = bodies['cold/report.json']
    assert sha(craw) == 'c0a9217a198080474b3beb9a6f024c139684c29026e4905036a525148ef9236e'
    cold = json.loads(craw)
    assert cold['gitHead'] == cold['cloneHead'] == FREEZE and cold['status'] == 'passed'
    assert cold['exitCode'] == 0 and not cold['statusBefore'] and not cold['statusAfter']
    assert cold['command'] == ['make', 'verify-E6-T11d46']
    assert sha(bodies['cold/cold.log']) == cold['logSha256']
    predecessor, old = [], {}
    for role, (mp, ip, ap, count) in PINS.items():
        p = 'evidence/virgl-ordered-stencil/'+role+'/'
        names = [p+n for n in ['manifest.json', 'records.json', 'recording.tar.gz']]
        prior_git = git_bodies(BASE, names)
        raw = [bodies['predecessor-seals/'+n] for n in names]
        assert all(b == prior_git[n] for n, b in zip(names, raw))
        assert [sha(b) for b in raw] == [mp, ip, ap]
        prior_bodies, prior_audit = reopen(raw[2], raw[1])
        assert prior_audit['members'] == count
        predecessor.append(dict(role=role, manifestSha256=mp, indexSha256=ip,
                                archiveSha256=ap, **prior_audit))
        if role == 'worker':
            for leaf, pin in [('virgl-shader.mjs', '6bb07a0b2a056d21ae52b22d7700ce10577854c1cdcf0877dd80be938e30e0fa'),
                              ('virgl-shader.wasm', 'acbe036afcdc4f1d8aa8cfb0fb107f48ba27759a6af4a7b9d6c83e3aa679d6cc')]:
                b = prior_bodies['hot-generated/renderer/virgl-shader/build/wasm/'+leaf]
                assert sha(b) == pin
                p = out/'actual-old'/leaf; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b)
                old[leaf] = pin
        del prior_bodies
    unchanged = ['renderer/virgl-command', 'crates', 'web', 'tools/guest']
    assert not subprocess.check_output(['git', 'diff', '--name-only', BASE, FREEZE, '--', *unchanged], cwd=ROOT).strip()
    result = dict(schema='fresh-instance-base-complete-custody-v1', status='passed',
                  worker=WORKER, sourceHead=FREEZE, predecessor=BASE, **audit,
                  sourceIdentities=source_rows, receipts=receipts, cold=cold,
                  predecessorSeals=predecessor, actualOld=old, unchangedBoundaries=unchanged,
                  actualCurrentCompilers=used_generated,
                  totalReopenedMembers=audit['members']+sum(p['members'] for p in predecessor))
    (out/'custody-audit.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: result[k] for k in ['status', 'members', 'physicalBodies', 'logicalBytes', 'totalReopenedMembers']}), flush=True)


if __name__ == '__main__':
    main(sys.argv[1])
