#!/usr/bin/env python3
"""Independent portable replay of the incremental E6-T11d evidence closure.

No ignored target input is read: inherited raw records are resolved from the
committed D72 capsule or the cap-negative archive embedded in the parent capsule.
This authenticates recorded results; it does not run a new guest or browser.
"""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo = args.repo.resolve()
sha = lambda data: hashlib.sha256(data).hexdigest()
read_json = lambda data: json.loads(data.decode())
held_parent = '9b92e4b8a7d1471f92ec575654835e647a499a72111df36bf672db624d6591df'
held_map = '0b8c766bb4755c0e7a70d549e8b04a49b079d0b680a6da527972d608dae00045'
held_index = '8f7ae10758c136ff60e1d61a3931fbd4802816ea30a35213e5c82146418fe6a1'
held_cap = 'ff5bc0b9f9f4bd0d68f96dd2e4bb860d446dca863b462fe3bcb4ea78dd9893e4'
held_d72 = '01f6feaca7b0079b0a4dfa83fc4bdfeb757ca8b258af26c9bd8882273374a37d'
held_d74d = 'f8b2fd2f41903497bf3a6a39313cde23a2661df1b44c932ef17042a450dc6eab'
held_d74d_verifier = '8bd65228d807d1b616b00e9e0fbcda94f8f94ffdeef7e4e55a6c908fd17f8ffb'


class Capsule:
    def __init__(self, data):
        self.tar = tarfile.open(fileobj=io.BytesIO(data), mode='r:gz')
        self.members = self.tar.getmembers()
        names = [member.name for member in self.members]
        assert len(set(names)) == len(names), 'duplicate archive member'
        self.names = set(names)
        for member in self.members:
            assert not member.name.startswith('/') and '..' not in Path(member.name).parts
            assert member.isfile() or member.islnk(), member.name
            if member.islnk():
                assert member.linkname in self.names and '..' not in Path(member.linkname).parts

    def get(self, name):
        assert name in self.names, name
        return self.tar.extractfile(name).read()


def check(data, row):
    assert sha(data) == row['sha256'], row['path']
    if 'bytes' in row:
        assert len(data) == row['bytes'], row['path']


def collect(obj):
    rows = []
    if isinstance(obj, dict):
        if isinstance(obj.get('path'), str) and 'sha256' in obj:
            rows.append(obj)
        for value in obj.values():
            rows.extend(collect(value))
    elif isinstance(obj, list):
        for value in obj:
            rows.extend(collect(value))
    return rows


def exact_refs(original, actual):
    assert len(actual) == len({row['path'] for row in actual}), 'duplicate inherited reference'
    assert Counter((row['path'], row['sha256']) for row in original) == Counter(
        (row['path'], row['sha256']) for row in actual), 'changed or omitted inherited reference'
    expected = {row['path']: row for row in original}
    for row in actual:
        if 'bytes' in expected[row['path']]:
            assert row['bytes'] == expected[row['path']]['bytes']


worker = repo / 'evidence/virgl-production-final-closure/worker'
archive = (worker / 'closure.tar.gz').read_bytes()
index_bytes = (worker / 'records.json').read_bytes()
manifest = read_json((worker / 'manifest.json').read_bytes())
assert sha(archive) == held_parent == manifest['archiveSha256']
assert sha(index_bytes) == held_index == manifest['recordIndexSha256']
assert len(archive) == 2313686 == manifest['archiveBytes']
capsule = Capsule(archive)
rows = read_json(index_bytes)['records']
assert len(rows) == 25 == len(capsule.names) == len({row['path'] for row in rows})
assert set(capsule.names) == {row['path'] for row in rows}
bodies = {}
for row in rows:
    data = capsule.get(row['path'])
    check(data, row)
    bodies[row['path']] = data
assert sha(bodies['prepared-proof-map.json']) == held_map
prepared = read_json(bodies['prepared-proof-map.json'])
refs = read_json(bodies['reference-authentication.json'])['authenticatedReferences']
original = collect(prepared)
exact_refs(original, refs)
assert len(refs) == 38

cap_bytes = bodies['independent-capability-negative/independent-capability-abi-negative-control.tar.gz']
assert sha(cap_bytes) == held_cap
cap = Capsule(cap_bytes)
d72_bytes = (repo / prepared['verifiedSuccessors']['D72']['worker']['path']).read_bytes()
assert sha(d72_bytes) == held_d72
d72 = Capsule(d72_bytes)
resolved = []
for row in refs:
    name = row['path']
    if name.startswith('target/evidence/production-paced-policy-private-window04/'):
        member = name[len('target/evidence/'):]
        data, authority = d72.get(member), 'committed D72 capsule/' + member
    elif name.startswith('target/evidence/critic-production-parent-cap-serialization-negative01/'):
        data, authority = cap.get(name), 'embedded cap-negative capsule/' + name
    elif name.endswith('critic-production-parent-cap-serialization-negative-seal01/receipt.json'):
        data = bodies['independent-capability-negative/receipt.json']
        authority = 'parent capsule/independent-capability-negative/receipt.json'
    elif name.endswith('critic-production-parent-cap-serialization-negative-seal01/independent-capability-abi-negative-control.tar.gz'):
        data, authority = cap_bytes, 'parent capsule/independent-capability-negative/archive'
    else:
        assert not name.startswith('target/'), 'unresolved ignored scratch input'
        data, authority = (repo / name).read_bytes(), 'repository/' + name
    check(data, row)
    resolved.append(dict(path=name, bytes=len(data), sha256=sha(data), authority=authority))

# An equal-count omission must not be accepted by the independent reference oracle.
changed_refs = [dict(row) for row in refs]
changed_refs[0] = dict(changed_refs[1])
try:
    exact_refs(original, changed_refs)
except AssertionError as error:
    reference_negative = dict(oracleRejected=True, sameCount=len(refs), error=str(error))
else:
    raise AssertionError('reference omission negative was not detected')

source_checks = []
for name, body in bodies.items():
    if name.startswith('source/'):
        current = (repo / name[len('source/'):]).read_bytes()
        assert current == body, name
        source_checks.append(dict(path=name[len('source/'):], sha256=sha(current)))
for row in prepared['heldExactSource']:
    old = subprocess.check_output(['git', 'show', 'e17f8caf47712cbbc9ab863f2c161c56432118ad:' + row['path']], cwd=repo)
    assert old == (repo / row['path']).read_bytes()

private = 'production-paced-policy-private-window04/'
acceptance = read_json(d72.get(private + 'browser/acceptance.json'))
cube = read_json(d72.get(private + 'browser/cube-state.json'))
final = read_json(d72.get(private + 'browser/final-state.json'))
probe = d72.get(private + 'browser/probe.txt').decode()
handshake = read_json(d72.get(private + 'original-handshake.json'))
assert acceptance['status'] == 'passed' and acceptance['probe']['pixels'] == 768
assert acceptance['cube']['frames'] == 1000 and acceptance['hyprland'] is True
assert acceptance['guestDigest'] == prepared['heldPrivateComponent']['observation']['guestDigest']
assert probe.count('SOFTWARE_DRI_ABSENT') >= 2
assert 'GL_RENDERER=virgl (wasm-vm WebGL2 VirGL)' in probe
assert 'GL_VERSION=OpenGL ES 3.0 Mesa 26.2.2' in probe
assert 'GL_CORE_NUMERIC_PASS' in probe and 'GL_REQUIRED_MULTISAMPLE_PASS' in probe
assert len(re.findall(r'^GL_CORE_LIMIT name=', probe, re.M)) == 29
assert len(re.findall(r'^GL_REQUIRED_MS_FORMAT name=', probe, re.M)) == 15
assert 'EGL_PUBLIC_GLES_ONLY_PASS' in probe and 'EGL_INDEX_PASS count=83 forbidden=0 gl_error=0x0' in probe
assert 'GL_MESA_ORIGINAL_RESOLVE_PASS' in probe
assert cube['after']['gpu']['counters']['draws'] == 6009
assert cube['after']['gpu']['counters']['draws'] - cube['before']['gpu']['counters']['draws'] == 6006
assert final['gpu']['counters']['draws'] == 31192 and final['gpu']['pending']['status'] == 'ready'
assert final['gpu']['counters']['begun'] - final['gpu']['counters']['completed'] == 1
assert final['errors'] == [] and final['gpu']['counters']['failed'] == 0
assert handshake['status'] == 'passed' and len(handshake['coverage']) == 13
assert handshake['guestOpcodes']['8'] == 31516 and handshake['guestFencedSubmissions'] == 1347

audit = read_json(cap.get('target/evidence/critic-production-parent-cap-serialization-negative01/audit.json'))
assert [row['exitCode'] for row in audit['commands']] == [0, 101]
assert audit['exactDifferentBytes'] == [dict(offset=284, actual=3, oracle=4)]
assert audit['oracleHeaderAndTestUnchanged'] and audit['rootRuntimeUnchanged']

warm_worker = repo / 'evidence/virgl-production-gpu-warm-default/worker'
warm_manifest = read_json((warm_worker / 'manifest.json').read_bytes())
warm_bytes = (warm_worker / 'submission.tar.gz').read_bytes()
assert sha(warm_bytes) == held_d74d == warm_manifest['archiveSha256']
warm_index = read_json((warm_worker / 'records.json').read_bytes())
assert sha((warm_worker / 'records.json').read_bytes()) == warm_manifest['recordIndexSha256']
warm = Capsule(warm_bytes)
warm_rows = {row['path']: row for row in warm_index['records']}


def warm_data(name):
    data = warm.get(name)
    check(data, warm_rows[name])
    return data


def warm_json(name):
    return read_json(warm_data(name))


verifier_path = repo / 'evidence/virgl-production-gpu-warm-default/verifier'
verifier_receipt = read_json((verifier_path / 'review.tar.gz.json').read_bytes())
verifier_bytes = (verifier_path / 'review.tar.gz').read_bytes()
assert sha(verifier_bytes) == held_d74d_verifier == verifier_receipt['sha256']
assert len(verifier_bytes) == verifier_receipt['bytes'] == 3997729
assert (verifier_path / 'VERDICT.md').read_text().startswith('VERDICT: verified')
for key in ['manifest.json', 'records.json']:
    assert bodies['successor/evidence/virgl-production-gpu-warm-default/worker/' + key] == (warm_worker / key).read_bytes()
for key in ['VERDICT.md', 'review.tar.gz.json']:
    assert bodies['successor/evidence/virgl-production-gpu-warm-default/verifier/' + key] == (verifier_path / key).read_bytes()

runtime = '847f51927637c9ff8226068986a771c9e2a5bedc'
runtime_sources = []
for path in ['web/main.js', 'web/loader.js', 'web/gpu-checkpoint-build.js', 'web/dist/pkg/wasm_vm_wasm_bg.wasm']:
    old = subprocess.check_output(['git', 'show', runtime + ':' + path], cwd=repo)
    now = (repo / path).read_bytes()
    assert old == now == warm_data('source/' + path), path
    runtime_sources.append(dict(path=path, bytes=len(now), sha256=sha(now)))

pristine = warm_json('runs/pristine11/report.json')
gauntlet = warm_json('runs/pristine11/acceptance/report.json')
incremental = warm_json('runs/pristine11/incremental923/report.json')
assert pristine['status'] == gauntlet['status'] == incremental['status'] == 'passed'
assert pristine['head'] == gauntlet['head'] == runtime
assert len(gauntlet['commands']) == 16 and all(row['exitCode'] == 0 for row in gauntlet['commands'])
assert incremental['basePristineReportSha256'] == sha(warm_data('runs/pristine11/report.json'))
assert all(row['exitCode'] == 0 for row in incremental['commands'])
outer = warm_json('runs/https12/report.json')
assert outer['status'] == 'failed' and [(row['name'], row['exitCode']) for row in outer['commands']] == [
    ('default-gpu-warm', 0), ('software-fast-boots', 0), ('default-browser', 0), ('unified-site', 1)]
public = warm_json('runs/https12/default-gpu-warm/report.json')
assert public['status'] == 'passed' and public['errors'] == [] and len(public['phases']) == 2
assert public['remoteUrl'] == 'https://wasm-vm.pages.dev/'
assert public['expectedGpuPair']['pin']['sha256'] == '2aa73b5d39fa6702cecc5c57193896b8798271a3075e1b0294bed3db864deb4f'
assert public['expectedGpuPair']['pin']['size'] == 173104561
public_points = []
for phase in public['phases']:
    query = phase['url'].split('?', 1)[-1].split('#', 1)[0]
    assert not any(re.search(r'(^|&)' + key + '=', query) for key in ['gpu', 'noSnapshot', 'persist', 'workerBootTimeoutMs'])
    for state in [phase['state'], phase['publicDesktopFinal']]:
        assert state['restored'] is True and state['ready'] is True and state['workerErrors'] == []
        assert state['gpu']['qualified'] and not state['gpu']['lost'] and state['gpu']['counters']['failed'] == 0
    assert phase['publicDesktopFinal']['pageErrors'] == []
    assert phase['publicDesktopInput']['status'] == phase['postWorkloadInput']['status'] == 'passed'
    assert phase['publicDesktopInput']['markerAbsent']['exit'] == 0
    assert phase['publicDesktopInput']['marker']['exit'] == 0 and 'TRUSTED_TOUCH_42' in phase['publicDesktopInput']['marker']['stdout']
    assert phase['postWorkloadInput']['marker']['exit'] == 0 and 'TRUSTED_TOUCH_84' in phase['postWorkloadInput']['marker']['stdout']
    assert phase['publicDesktopInput']['barActions']['status'] == 'passed'
    assert phase['warmPixels']['status'] == 'passed' and phase['warmPixels']['errors'] == []
    assert [row['seed'] for row in phase['warmPixels']['runs']] == [5, 2]
    for row in phase['warmPixels']['runs']:
        assert row['result']['exit'] == 0 and 'WARM_PIXELS_PASS failures=0' in row['result']['stdout']
        assert row['pixels']['pixels'] == 64 and row['pixels']['bytes'] == 256
        assert row['gpuDelta'] == dict(begun=5, completed=5, draws=4, outputBytes=256)
    public_points.append(dict(phase=phase['phase'], restoredMs=phase['restoredMs'], url=phase['url'],
                              warmTiming=phase['warmTiming'], literalSeeds=[5, 2]))
software = warm_json('runs/https12/software-fast-boots/report.json')
default = warm_json('runs/https12/default-browser/report.json')
assert software['status'] == default['status'] == 'passed' and software['errors'] == default['errors'] == []
assert len(software['phases']) == 10 and default['passed'] == 127 and default['failed'] == 0
assert default['proofExportAbsent'] is True
for scope in ['local', 'https']:
    site = warm_json('runs/site14/' + scope + '/report.json')
    assert site['status'] == 'passed' and site['errors'] == [] and len(site['steps']) == 8

parent_text = (repo / 'tasks/epic-6-transcendence/E6-T11d-truthful-guest-virgl-bringup.md').read_text()
dependency_ids = [name.strip() for name in re.search(r'^depends_on:\s*\[(.*?)\]', parent_text, re.M).group(1).split(',')]
for identifier in dependency_ids:
    matches = list((repo / 'tasks').rglob(identifier + '-*.md'))
    assert len(matches) == 1
    assert re.search(r'^status:\s*verified\s*$', matches[0].read_text(), re.M), identifier
for task in prepared['verifiedSuccessors'].values():
    subprocess.run(['git', 'merge-base', '--is-ancestor', task['verifiedCommit'], 'HEAD'], cwd=repo, check=True)

report = dict(status='passed', scope='Incremental parent custody and exact-source/successor replay; not a new browser or architectural test',
              submissionHead='9077193b', ignoredScratchInputsRead=0, inheritedReferences=resolved,
              closureMembers=len(rows), closureSha256=held_parent, recordIndexSha256=held_index,
              referenceOmissionNegative=reference_negative, sourceChecks=source_checks, runtime847=runtime_sources,
              privateD72=dict(probePixels=768, cubeFrames=1000, cubeAfterDraws=6009, cubeDrawDelta=6006,
                              finalSnapshotDraws=31192, finalSnapshotPending=1, fullTraceDraws=31516,
                              fencedSubmissions=1347, handshakeFamilies=13),
              abiNegative=dict(healthyExit=0, changedExit=101, offset=284, actual=3, oracle=4),
              public74d=dict(workerSha256=held_d74d, verifierSha256=held_d74d_verifier,
                             pristineGateCount=16, originalHttpsOuterStatus='failed', phases=public_points,
                             softwarePhases=10, defaultPassed=127, defaultFailed=0, siteStepsPerScope=8),
              verifiedParentDependencies=len(dependency_ids),
              exclusions=['E6-T11e context-loss/recovery', 'arbitrary Omarchy apps/Chromium/LibreOffice', '300MIPS/full-offload claim'])
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(dict(status=report['status'], output=str(args.output), sha256=sha(args.output.read_bytes()),
                      closureMembers=len(rows), inheritedReferences=len(refs), ignoredScratchInputsRead=0,
                      parentDependencies=len(dependency_ids), pristineGates=16, actualPublicPhases=2)))
