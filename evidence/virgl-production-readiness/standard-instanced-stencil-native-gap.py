#!/usr/bin/env python3
"""Seal the exact predecessor's actual ordered-consumer instancing refusals."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
FROZEN = 'a19b49441e932e64446f756cefe0c18e6b5b71b3'
directory = Path(sys.argv[1]).resolve()
output = ROOT / 'evidence/virgl-production-readiness'
stem = 'standard-instanced-stencil-native-gap'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == FROZEN
report = json.loads((directory/'report.json').read_text())
assert report['gitHead'] == FROZEN and report['status'] == 'passed'
assert report['browserErrors'] == dict(console=[], page=[], requests=[])
for name in ['original-values.json', 'physical-audit.json']:
    if not (directory/name).is_file():
        # The direct checker result names are explicit in their own source.
        alternatives = [p for p in directory.glob('*.json') if p.name != 'report.json' and
                        json.loads(p.read_text()).get('schema') == ('original-ordered-stencil-inverse-v1' if name.startswith('original') else 'original-ordered-stencil-physical-v1')]
        assert len(alternatives) == 1
        name = alternatives[0].name
    audit = json.loads((directory/name).read_text())
    assert audit['status'] == 'passed' and audit['reportSha256'] == sha((directory/'report.json').read_bytes())
negative = []
for entry in report['browserResult']['result']['runs']:
    row = json.loads((directory/entry['path']).read_text())
    if row.get('failurePhase') != 'instances':
        continue
    request = row['execution']
    result = request['result']
    assert result['ok'] is False and result['error']['code'] == 'unsupported-stencil'
    assert result['error']['opcode'] == 8 and result['error']['byteOffset'] == 0
    assert result['appliedCommands'] == 0 and result['draws'] == [] and result['gpuComplete'] is True
    assert row['afterFailure']['renderer']['work']['drawCalls'] == 0
    assert not any(e['label'] == request['label'] and e['name'] in
                   ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'blitFramebuffer'] for e in row['events'])
    negative.append(dict(name=row['name'], format=row['format'], packetHex=request['hex'],
                         result=result, completeRun=entry, nativeEvents=len(row['events']), nativeDrawExecuted=False))
assert {row['format'] for row in negative} == {20, 126} and len(negative) == 2
members = {p.relative_to(directory).as_posix(): p.read_bytes() for p in sorted(directory.rglob('*')) if p.is_file()}
members['recorder/'+Path(__file__).name] = Path(__file__).read_bytes()
index = dict(schema='original-instanced-stencil-native-gap-records-v1', sourceHead=FROZEN,
             records=[dict(path=name, bytes=len(raw), sha256=sha(raw)) for name, raw in members.items()])
index_bytes = (json.dumps(index, indent=2)+'\n').encode()
(output/(stem+'-records.json')).write_bytes(index_bytes)
stream = io.BytesIO()
with gzip.GzipFile(fileobj=stream, mode='wb', mtime=0) as compressed:
    with tarfile.open(fileobj=compressed, mode='w') as tar:
        for name, raw in members.items():
            info = tarfile.TarInfo(name)
            info.size, info.mtime, info.mode = len(raw), 0, 0o644
            tar.addfile(info, io.BytesIO(raw))
archive = stream.getvalue()
(output/(stem+'.tar.gz')).write_bytes(archive)
seen = set()
with tarfile.open(output/(stem+'.tar.gz'), 'r|gz') as tar:
    for member in tar:
        assert member.name not in seen and member.name in members and member.isfile()
        assert tar.extractfile(member).read() == members[member.name]
        seen.add(member.name)
assert seen == set(members)
result = dict(schema='original-instanced-stencil-native-gap-v1', sourceHead=FROZEN,
              status='passed', originalNativeRefusals=negative, runtimeSources=report['sources'],
              browser=report['browser'], browserErrors=report['browserErrors'],
              completeMembers=len(members), reopenedMembers=len(seen),
              archive=dict(path=stem+'.tar.gz', bytes=len(archive), sha256=sha(archive)),
              index=dict(path=stem+'-records.json', sha256=sha(index_bytes)),
              guestExecution=False, productionNegotiation=False, productionDrawAuthority=False,
              reproduction=['node tools/verify-virgl-ordered-stencil.mjs --output target/evidence/virgl-instanced-stencil-gap-a19 --mode failures --smoke true',
                            'node tools/virgl-ordered-stencil/values.mjs target/evidence/virgl-instanced-stencil-gap-a19',
                            'python3 tools/virgl-ordered-stencil/physical.py target/evidence/virgl-instanced-stencil-gap-a19',
                            'python3 evidence/virgl-production-readiness/standard-instanced-stencil-native-gap.py target/evidence/virgl-instanced-stencil-gap-a19'])
(output/(stem+'.json')).write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(dict(status='passed', sourceHead=FROZEN, originalNativeRefusals=len(negative),
                     completeMembers=len(members), archiveBytes=len(archive), archiveSha256=sha(archive))))
