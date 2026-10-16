"""Independent finest-counter and publication review of authenticated bodies."""
import difflib
import hashlib
import json
import re
import struct
import subprocess
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ROOT = REPO / 'target/evidence/d64-final-reopened'
DEPLOY = REPO / 'target/evidence/d64-final-deployment-reopened'
BASE = '2aca65e9328aa1433fb516511ca554fdd96b422d'
HEAD = '2f1e09f52ef3529b591887a08721fb234e77e500'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.check_output(['git', *a], cwd=REPO)
units = lambda s: list(struct.unpack('<' + 'H' * (len(s.encode('utf-16-le')) // 2), s.encode('utf-16-le')))
paths = ['renderer/virgl-command/' + p + '.mjs' for p in ['control-bridge', 'decoder', 'resources', 'state']]
audit = json.loads((ROOT / 'coverage-audit.json').read_bytes())
assert audit['head'] == HEAD and audit['base'] == BASE and not audit['needsEvidence'] and not audit['held']


def starts(body):
    values = [0]
    for line in body.splitlines(keepends=True):
        values.append(values[-1] + len(units(line)))
    return values


changed, immutable_maps = {}, []
source, before_lines, after_lines, old_line, new_line = None, [], [], 0, 0


def flush():
    if not before_lines and not after_lines:
        return
    old_start = starts(git('show', BASE + ':' + source).decode())[old_line - 1]
    new_start = starts((REPO / source).read_text())[new_line - 1]
    for match in difflib.SequenceMatcher(None, units(''.join(before_lines)), units(''.join(after_lines)), autojunk=False).get_matching_blocks():
        if match.size:
            immutable_maps.append((source, new_start + match.b, new_start + match.b + match.size, old_start + match.a))
    before_lines.clear()
    after_lines.clear()


for line in git('diff', '--unified=0', BASE, HEAD, '--', *paths).decode().splitlines(keepends=True):
    if line.startswith('+++ b/'):
        flush()
        source = line[6:].strip()
    elif line.startswith('@@'):
        flush()
        m = re.search(r'-(\d+)(?:,\d+)? \+(\d+)', line)
        old_line, new_line = int(m[1]), int(m[2])
    elif line.startswith('-') and not line.startswith('---'):
        before_lines.append(line[1:])
    elif line.startswith('+') and not line.startswith('+++'):
        changed.setdefault(source, []).append(new_line + len(after_lines))
        after_lines.append(line[1:])
flush()
assert changed == audit['changedLines']

scripts = {}
for item in audit['scripts']:
    record, source = item['record'], item['source']
    body = git('show', HEAD + ':' + source)
    assert sha(body) == item['sha256']
    assert item['sourceBody'].encode() == body
    actual = json.loads((ROOT / record).read_bytes())
    matches = [s for s in actual['scripts'] if s['source'] == source]
    assert len(matches) == 1 and matches[0]['coverage'] == item['coverage']
    assert matches[0]['sha256'] == sha(body) and matches[0]['sourceBody'].encode() == body
    report = json.loads((ROOT / record).with_name('report.json').read_bytes())
    assert sha((ROOT / record).read_bytes()) == report['browserCoverage']['sha256']
    assert report['status'] == ('failed' if record.startswith('fault-') else 'passed')
    scripts[(record, source)] = item['coverage']

citations, waivers = [], []
for category in ['executed', 'waived']:
    for region in audit[category]:
        source, a, b = region['source'], region['startOffset'], region['endOffset']
        body = git('show', HEAD + ':' + source).decode()
        text = body.encode('utf-16-le')[2 * a:2 * b].decode('utf-16-le')
        assert text == region['text'] and sha(text.encode()) == region['sha256']
        counters = []
        for (record, name), coverage in scripts.items():
            if name != source:
                continue
            candidates = [r for f in coverage['functions'] for r in f['ranges'] if r['startOffset'] <= a and b <= r['endOffset']]
            if candidates:
                narrowest = min(candidates, key=lambda r: (r['endOffset'] - r['startOffset'], r['count']))
                # A zero finest branch can never be hidden by an enclosing positive function.
                counters.append(dict(record=record, **narrowest))
        assert counters == region['counters']
        maximum = max((c['count'] for c in counters), default=0)
        assert maximum == region['maxCount']
        row = dict(source=source, line=region['line'], startOffset=a, endOffset=b, sha256=region['sha256'])
        if category == 'executed':
            assert maximum > 0
            positive = min((c for c in counters if c['count'] > 0), key=lambda c: c['endOffset'] - c['startOffset'])
            citations.append(dict(**row, status='HELD', finestCounter=positive))
        else:
            assert maximum == 0
            if not text.strip() or re.fullmatch(r'[\s{}(),;:?]+', text) or body.splitlines()[region['line'] - 1].lstrip().startswith(('//', '/*', '*')):
                reason = 'Non-executable syntax or comment.'
            else:
                maps = [m for m in immutable_maps if m[0] == source and m[1] <= a and b <= m[2]]
                assert maps, (source, region['line'], text)
                m = maps[0]
                old_a = m[3] + a - m[1]
                assert git('show', BASE + ':' + source).decode().encode('utf-16-le')[old_a * 2:(old_a + b - a) * 2].decode('utf-16-le') == text
                line = body.splitlines()[region['line'] - 1].strip()
                if source.endswith('control-bridge.mjs'):
                    assert region['line'] in [185, 187]
                    reason = 'Unchanged historical factory or optional resource-limit selection; the new closed selected factory executes its own new branch.'
                elif source.endswith('decoder.mjs'):
                    assert region['line'] in [365, 748]
                    reason = 'Unchanged historical format renderability, diagnostic or profile label; all newly admitted depth/layer operands execute separately.'
                else:
                    assert source.endswith('state.mjs') and region['line'] in [396, 397, 599]
                    reason = 'Unchanged historical profile/decoder/kind selection; no added operation or format admission is contained here.'
                row['baseStartOffset'] = old_a
            waivers.append(dict(**row, status='waived', text=text, reason=reason))

for source, lines in changed.items():
    offsets = starts((REPO / source).read_text())
    for line in lines:
        partitions = sorted((p['startOffset'], p['endOffset']) for cat in ['executed', 'waived'] for p in audit[cat] if p['source'] == source and p['line'] == line)
        assert partitions[0][0] == offsets[line - 1] and partitions[-1][1] == offsets[line]
        assert all(x[1] == y[0] for x, y in zip(partitions, partitions[1:]))
assert len(citations) == 345 and len(waivers) == 78

publication = DEPLOY / 'publication'
publish_raw = (publication / 'publish.json').read_bytes()
publish = json.loads(publish_raw)
confirmation = json.loads((publication / 'cloudflare-cli-confirmation.json').read_bytes())
live = json.loads((DEPLOY / 'live/report.json').read_bytes())
assert publish['head'] == confirmation['head'] == live['gitHead'] == HEAD
assert publish['exitCode'] == 0 and confirmation['environment'] == 'Production' and confirmation['branch'] == 'main'
assert confirmation['id'] == '9724effa-3c8e-42ba-996a-1edf07049acb' and confirmation['observedCommitPrefix'] == HEAD[:7]
assert confirmation['publishReceiptSha256'] == sha(publish_raw)
assert confirmation['listSha256'] == sha((publication / 'deployment-list.stdout').read_bytes())
assert publish['stdoutSha256'] == sha((publication / 'publish.stdout').read_bytes())
assert publish['stderrSha256'] == sha((publication / 'publish.stderr').read_bytes())
assert 'https://9724effa.wasm-vm.pages.dev' in (publication / 'publish.stdout').read_text()
actual_rows = []
for line in (publication / 'deployment-list.stdout').read_text().splitlines():
    cols = [p.strip() for p in line.split('│')[1:-1]]
    if len(cols) == 7 and cols[0] == confirmation['id']:
        actual_rows.append(cols)
assert len(actual_rows) == 1 and actual_rows[0][1:4] == ['Production', 'main', HEAD[:7]]
assert live['status'] == 'passed' and (live['passed'], live['failed']) == (127, 0)
assert live['errors'] == live['httpErrors'] == [] and live['proofExportAbsent']
assert live['url'].startswith('https://wasm-vm.pages.dev/app.html?')
assert live['graphicsRoadmapPip'] == 'cap-pip partial' and live['roadmapPip'] == 'cap-pip live'
assert len(live['served']) == 192
stage_raw = (publication / 'staging-index.json').read_bytes()
stage = json.loads(stage_raw)
assert sha(stage_raw) == publish['stagingIndexSha256']
assert stage['head'] == HEAD and stage['fileCount'] == len(stage['records']) == 639
assert stage['siteChanges'] == ['web/dist/roadmap.js', 'web/dist/sw.js']
held_directory = REPO / 'target/evidence/d64-final-held-deployment-reopened/publication'
held_raw = (held_directory / 'staging-index.json').read_bytes()
assert held_raw == (publication / 'held-staging-index.json').read_bytes()
held = json.loads(held_raw)
assert stage['carriedBootManifests'] == held['carriedBootManifests']
boot_manifests = {pin['path']: pin for pin in stage['carriedBootManifests']}
assert set(boot_manifests) == {'artifacts.json', 'artifacts-alpine.json', 'artifacts-node-alpine.json', 'artifacts-omarchy.json'}
assert sha((publication / 'frozen-web-dist.tar').read_bytes()) == stage['sourceArchiveSha256']
frozen_source = {}
with tarfile.open(publication / 'frozen-web-dist.tar', mode='r:') as archive:
    for member in archive:
        if not member.isfile():
            continue
        assert member.name.startswith('web/dist/') and '..' not in Path(member.name).parts
        name = member.name[len('web/dist/'):]
        body = archive.extractfile(member).read()
        assert body == git('show', HEAD + ':' + member.name)
        frozen_source[name] = body
for pin in stage['records']:
    path = pin['path']
    actual = (publication / 'web/dist' / path).read_bytes()
    assert (len(actual), sha(actual)) == (pin['bytes'], pin['sha256'])
    assert len(actual) < 25 * 1024 * 1024
    if path in boot_manifests:
        assert sha(frozen_source[path]) == boot_manifests[path]['sourceSha256']
        assert sha(actual) == boot_manifests[path]['stagedSha256']
        assert actual == (held_directory / 'web/dist' / path).read_bytes()
    elif path in frozen_source:
        assert actual == frozen_source[path]
    else:
        assert path.startswith('releases/boot-snapshot/') or path == 'docs-mount.js'
        assert actual == (held_directory / 'web/dist' / path).read_bytes()
for served in live['served']:
    path = served['path'].lstrip('/')
    actual = (DEPLOY / 'live/bodies' / path).read_bytes()
    assert (len(actual), sha(actual)) == (served['bytes'], served['sha256'])
    deployed_path = 'app.html' if path == 'app' else path
    assert actual == (publication / 'web/dist' / deployed_path).read_bytes(), path
    if deployed_path in boot_manifests:
        assert sha(actual) == boot_manifests[deployed_path]['stagedSha256']
    else:
        assert actual == frozen_source[deployed_path], path
wasm_path = 'web/dist/pkg/wasm_vm_wasm_bg.wasm'
default_wasm = git('show', HEAD + ':' + wasm_path)
assert default_wasm == git('show', BASE + ':' + wasm_path)
assert sha(default_wasm) == live['servedWasmSha256'] == 'd45b575207e0035b5c518698e7b6793b2bf12da635531723fad70813a5956c36'
roadmap = (DEPLOY / 'live/bodies/roadmap.js').read_text()
assert 'depth surfaces under verification (E6-T11d64); production acceleration disabled' in roadmap
assert sha((DEPLOY / 'live' / live['screenshot']['path']).read_bytes()) == live['screenshot']['sha256']

result = dict(schema='dimensional-depth-surfaces-final-coverage-deployment-v1', status='passed',
              P7='HELD', P8='HELD', changedLines=changed, executedRegions=len(citations), waivedRegions=len(waivers),
              needsEvidence=0, citations=citations, waivers=waivers,
              deployment=dict(id=confirmation['id'], sourceHead=HEAD, servedBodies=192, passed=127, failed=0,
                              browserErrors=0, partialMarker=True, proofExportsAbsent=True, defaultWasmUnchanged=True,
                              defaultWasmSha256=sha(default_wasm), productionGraphicsAuthority=False,
                              reportSha256=sha((DEPLOY / 'live/report.json').read_bytes()),
                              cliReceiptSha256=sha(publish_raw), screenshotSha256=live['screenshot']['sha256']))
result['deployment']['carriedBootManifests'] = stage['carriedBootManifests']
result['deployment']['stagedFiles'] = len(stage['records'])
result['deployment']['legacyAssetWaiver'] = 'docs-mount.js is an unchanged, authenticated prior deployment asset, absent from the new frozen source and unserved in the canonical run. No executable D64 change is carried in it.'
(OUT / 'final-coverage-deployment.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(status='passed', executed=len(citations), waived=len(waivers), missing=0,
                      deployment=confirmation['id'], servedBodies=192, passed=127, failed=0)))
