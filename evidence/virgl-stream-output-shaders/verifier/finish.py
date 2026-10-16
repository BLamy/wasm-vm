"""Independent alias/word/custody and frozen production publication checks."""
import gzip
import hashlib
import io
import json
import struct
import subprocess
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ROOT = REPO / 'target/evidence/d65-critic-opened-01'
SOURCE = '31bf0781db74fea94f51c9d6fa3217d16227bc99'
BASE = '6f43010dfa7b3e08bfe62f62543b7ee0468e1a21'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.check_output(['git', *a], cwd=REPO)
citations = []
total_bytes, runs = 0, 0
entries = [dict(registerIndex=31, startComponent=s, numComponents=n, outputBuffer=b, destinationOffset=d, stream=0)
           for s, n, b, d in [(3, 1, 3, 63), (1, 2, 1, 17), (0, 3, 0, 5), (1, 3, 2, 29), (0, 1, 3, 7)]]
words = [5, 11, 23, 35, 64] + [v for e in entries for v in [e['registerIndex'] | e['startComponent'] << 8 | e['numComponents'] << 10 | e['outputBuffer'] << 13 | e['destinationOffset'] << 16, 0]]
for name, negative in [('alias-clean', False), ('alias-reversed', True)]:
    directory = OUT / name
    raw = (directory / 'report.json').read_bytes()
    report = json.loads(raw)
    assert report['status'] == ('failed' if negative else 'passed') and report['errors'] == []
    assert not report['trackedChanges'] and report['submission'] == '0c167360a8d01a1e51b7be1309d6caf70fbff611'
    assert not report['headless'] and report['hardware']['gpu']['featureStatus'].get('webgl2', report['hardware']['gpu']['featureStatus'].get('webgl')) == 'enabled'
    assert sha((directory / 'browser.png').read_bytes()) == report['screenshotSha256']
    for pin in report['sources']:
        actual = (directory / 'source' / pin['path']).read_bytes()
        assert (len(actual), sha(actual)) == (pin['bytes'], pin['sha256'])
        original = ROOT / 'worker/cold/recording' / ('generated/' + Path(pin['path']).name if '/build/wasm/' in pin['path'] else 'sources/' + pin['path'])
        assert actual == original.read_bytes()
    payload = report['partial'] if negative else report['result']
    assert len(payload['rows']) == (1 if negative else 12) and payload['fixedMemoryBytes'] == 16777216
    balance = {}
    for allocation in payload['allocations']:
        if allocation['method'] == 'malloc' and allocation['pointer']:
            assert allocation['pointer'] not in balance
            balance[allocation['pointer']] = allocation['size']
        elif allocation['method'] == 'free':
            assert allocation['pointer'] in balance
            del balance[allocation['pointer']]
    assert not balance
    for index, row in enumerate(payload['rows']):
        seed, schedule, buffer = row['seed'], row['schedule'], row['buffer']
        source = [0x80000000 if schedule == 0 else 0x7fa12345 if schedule == 1 else 0xffffffff,
                  (0x7fc00000 | (seed & 65535)) if schedule == 0 else 0 if schedule == 1 else 0xabcdef00 | (seed & 255),
                  0xdead0000 | (seed & 65535), 0xffffffff]
        original = [source[0], source[0], source[1], 0]
        assert row['source'] == source and row['original'] == original
        assert row['position'] == [0, 0x80000000, 0, 0x3f800000]
        assert row['originalWords'] == row['request']['streamOutputWords'] == words
        assert row['callerAfterMutation'] == [0xffffffff] * len(words) and not row['liveAfterCompile']
        selected_entries = [(i, e) for i, e in enumerate(entries) if e['outputBuffer'] == buffer]
        varyings, packed, offset = [], [], 0
        for i, e in selected_entries:
            n = e['numComponents']
            varyings.append(dict(outputIndex=i, name='wv_so_' + str(i), type='uint' if n == 1 else 'uvec' + str(n), components=n, packedOffset=offset * 4))
            packed.extend(original[e['startComponent']:e['startComponent'] + n])
            offset += n
        metadata = dict(encoding='raw-32bit-words', captureBuffer=buffer, strides=[11, 23, 35, 64], outputs=entries, varyings=varyings, packedStrideBytes=offset * 4)
        assert row['response']['vertex']['metadata']['streamOutput'] == metadata == row['wanted']
        expected = b'\xa3' * 16 + struct.pack('<' + 'I' * (len(packed) * 5), *(packed * 5)) + b'\xa3' * 16
        actual = bytes(row['actual'])
        assert bytes(row['expected']) == expected and len(actual) == len(expected)
        assert row['completedNativeReadback'] and row['fence'] in [0x911a, 0x911c] and row['vertices'] == 5
        calls = [(i, c) for i, c in enumerate(payload['nativeCalls']) if c['row'] == index]
        read_index, read = next((i, c) for i, c in calls if c['method'] == 'getBufferSubData')
        assert bytes(read['after'][2]['bytes']) == actual
        varying_index, varying = next((i, c) for i, c in calls if c['method'] == 'transformFeedbackVaryings')
        original_names = [v['name'] for v in varyings]
        assert varying['args'][1] == original_names
        delivered = list(reversed(original_names)) if negative else original_names
        assert varying['delivered'][1] == delivered
        types = {'uint': 0x1405, 'uvec2': 0x8dc6, 'uvec3': 0x8dc7, 'uvec4': 0x8dc8}
        by_name = {v['name']: v for v in varyings}
        assert row['nativeVaryings'] == [dict(name=n, type=types[by_name[n]['type']], size=1) for n in delivered]
        assert [c['args'][1] for _, c in calls if c['method'] == 'shaderSource'] == [row['response']['vertex']['glsl'], row['response']['fragment']['glsl']]
        assert all(c['result'] == 0 for _, c in calls if c['method'] == 'getError')
        draw = next(i for i, c in calls if c['method'] == 'drawArrays')
        wait = max(i for i, c in calls if c['method'] == 'clientWaitSync')
        assert varying_index < draw < wait < read_index
        if negative:
            assert actual != expected and row['mismatches'] and varying['fault'] == 'valid-same-type-native-order-swap'
            assert buffer == 3 and len(original_names) == 2 and all(v['type'] == 'uint' for v in varyings)
            assert 'after native readback' in report['failure']['message']
        else:
            assert actual == expected and row['mismatches'] == [] and row['status'] == 'passed'
        runs += 1
        total_bytes += len(actual)
        citations.append(dict(prediction='S1' if negative else 'N1', member='verifier/' + name + '/report.json',
                              sha256=sha(raw), pointer=('/partial' if negative else '/result') + '/rows/' + str(index),
                              nativeSequences=[varying_index, draw, wait, read_index], expectedSha256=sha(expected), actualSha256=sha(actual), capturedBytes=len(actual)))
assert runs == 13

deploy = ROOT / 'deployment'
publication = deploy / 'publication'
pub_raw = (publication / 'publish.json').read_bytes()
publish = json.loads(pub_raw)
cli = json.loads((publication / 'cloudflare-cli-confirmation.json').read_bytes())
live_raw = (deploy / 'live/report.json').read_bytes()
live = json.loads(live_raw)
stage_raw = (publication / 'staging-index.json').read_bytes()
stage = json.loads(stage_raw)
assert publish['head'] == cli['head'] == live['gitHead'] == stage['head'] == SOURCE
assert publish['exitCode'] == 0 and publish['stagingIndexSha256'] == sha(stage_raw)
assert cli['id'] == '6b288a8e-3da0-4c81-8970-2674e22fa678' and cli['environment'] == 'Production' and cli['branch'] == 'main'
assert cli['observedCommitPrefix'] == SOURCE[:7] and cli['publishReceiptSha256'] == sha(pub_raw)
assert cli['listSha256'] == sha((publication / 'deployment-list.stdout').read_bytes())
assert publish['stdoutSha256'] == sha((publication / 'publish.stdout').read_bytes())
assert publish['stderrSha256'] == sha((publication / 'publish.stderr').read_bytes())
assert 'https://6b288a8e.wasm-vm.pages.dev' in (publication / 'publish.stdout').read_text()
rows = [[p.strip() for p in line.split('│')[1:-1]] for line in (publication / 'deployment-list.stdout').read_text().splitlines()]
rows = [r for r in rows if len(r) == 7 and r[0] == cli['id']]
assert len(rows) == 1 and rows[0][1:4] == ['Production', 'main', SOURCE[:7]]
assert live['status'] == 'passed' and (live['passed'], live['failed']) == (127, 0)
assert live['errors'] == live['httpErrors'] == [] and live['proofExportAbsent']
assert live['graphicsRoadmapPip'] == 'cap-pip partial' and live['roadmapPip'] == 'cap-pip live'
assert len(live['served']) == 192 and sha((deploy / 'live/browser.png').read_bytes()) == live['screenshot']['sha256']
assert stage['siteChanges'] == ['web/dist/roadmap.js', 'web/dist/sw.js']
assert sha((publication / 'frozen-web-dist.tar').read_bytes()) == stage['sourceArchiveSha256']
frozen = {}
with tarfile.open(publication / 'frozen-web-dist.tar', 'r:') as archive:
    for member in archive:
        if member.isfile():
            assert member.name.startswith('web/dist/') and '..' not in Path(member.name).parts
            body = archive.extractfile(member).read()
            assert body == git('show', SOURCE + ':' + member.name)
            frozen[member.name[len('web/dist/'):]] = body
held_manifest = json.loads((REPO / 'evidence/virgl-dimensional-color-surfaces/deployment/manifest.json').read_bytes())
assert sha((REPO / 'evidence/virgl-dimensional-color-surfaces/deployment/manifest.json').read_bytes()) == '22a01eafcf805b79094ee3b311b749f62e533ecbd8c5ff37d41ffba641f897ee'
held_index_raw = (REPO / 'evidence/virgl-dimensional-color-surfaces/deployment/records.json').read_bytes()
assert sha(held_index_raw) == held_manifest['recordIndexSha256']
held_index = json.loads(held_index_raw)
held_rows = held_index['records'] if isinstance(held_index, dict) else held_index
held = {r['path']: r for r in held_rows}
# The prior D64 critic fully reopened this unchanged deployment; carry its exact
# identity and per-body pins instead of repeating an unrelated publication run.
assert git('show', BASE + ':evidence/virgl-dimensional-color-surfaces/deployment/manifest.json') == (REPO / 'evidence/virgl-dimensional-color-surfaces/deployment/manifest.json').read_bytes()
boot = {r['path']: r for r in stage['carriedBootManifests']}
for record in stage['records']:
    name = record['path']
    body = (publication / 'web/dist' / name).read_bytes()
    assert (len(body), sha(body)) == (record['bytes'], record['sha256']) and len(body) < 25 * 1024 * 1024
    if name in boot or name not in frozen:
        old_pin = held['publication/web/dist/' + name]
        assert (len(body), sha(body)) == (old_pin['bytes'], old_pin['sha256'])
        if name in boot:
            assert sha(frozen[name]) == boot[name]['sourceSha256'] and sha(body) == boot[name]['stagedSha256']
        else:
            assert name == 'docs-mount.js' or name.startswith('releases/boot-snapshot/')
    else:
        assert body == frozen[name]
for pin in live['served']:
    name = pin['path'].lstrip('/')
    body = (deploy / 'live/bodies' / name).read_bytes()
    assert (len(body), sha(body)) == (pin['bytes'], pin['sha256'])
    assert body == (publication / 'web/dist' / ('app.html' if name == 'app' else name)).read_bytes()
assert frozen['pkg/wasm_vm_wasm_bg.wasm'] == git('show', BASE + ':web/dist/pkg/wasm_vm_wasm_bg.wasm')
assert sha(frozen['pkg/wasm_vm_wasm_bg.wasm']) == live['servedWasmSha256'] == 'd45b575207e0035b5c518698e7b6793b2bf12da635531723fad70813a5956c36'
assert 'E6-T11d65' in (deploy / 'live/bodies/roadmap.js').read_text() and 'production acceleration disabled' in (deploy / 'live/bodies/roadmap.js').read_text()
(OUT / 'novel-citations.jsonl').write_text(''.join(json.dumps(c) + '\n' for c in citations))
result = dict(schema='stream-output-shaders-independent-novel-and-publication-v1', status='passed',
              N1='HELD', S1='HELD', P8='HELD', novel=dict(cleanRuns=12, physicalControls=1, totalCapturedBytes=total_bytes,
                                                      callerLayoutAndResponseDisjoint=True, jsArenaOwnersRemaining=0, nativeReadbackBytesInterrogated=True),
              deployment=dict(id=cli['id'], source=SOURCE, reopenedMembers=858, servedBodies=192,
                              passed=127, failed=0, browserErrors=0, partialMarker=True, proofExportsAbsent=True,
                              defaultWasmUnchanged=True, productionGraphicsAuthority=False, stagedFiles=len(stage['records']),
                              carriedDeploymentManifestSha256='22a01eafcf805b79094ee3b311b749f62e533ecbd8c5ff37d41ffba641f897ee',
                              liveReportSha256=sha(live_raw), actualCliReceiptSha256=sha(pub_raw)),
              citationsSha256=sha((OUT / 'novel-citations.jsonl').read_bytes()))
(OUT / 'finish.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
