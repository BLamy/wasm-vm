#!/usr/bin/env python3
"""Independent artifact/fixture binding checks; no implementation imports or writes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import struct
from functools import lru_cache

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
BASE = '7be4e09748bc4acfcdf167bd66cd6f3d890132d5'
PROFILE = 'virgl-webgl2-raw-bits-v3'
BASE_REPORT = 'evidence/virgl-integer-masks/worker/native/native-report.json'
BASE_SHA = 'a61a45c7f3a4eadb09d535acca247edc515d3bdb644ab37ff8bf5919e48ca0b4'
LEGACY_REPORT = 'evidence/virgl-constants/worker/native/native-report.json'
LEGACY_SHA = '1ecee077496f3eea591ff4ac3a14afef91a33700d69d92b174d82bad3881ffef'
checks = 0


def need(value, message):
    global checks
    checks += 1
    if not value:
        raise AssertionError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(Path(path).read_bytes())


@lru_cache(maxsize=None)
def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd)


def old(path):
    return git('show', f'{BASE}:{path}')


def bound(path, base=ROOT):
    data = path.read_bytes()
    return {'path': str(path.relative_to(base)), 'bytes': len(data), 'sha256': digest(data)}


def cite(path, phrase):
    lines = path.read_text().splitlines()
    hits = [i for i, line in enumerate(lines, 1) if phrase in line]
    need(bool(hits), f'citation missing: {path}: {phrase}')
    return {**bound(path), 'line': hits[0]}


def verify_record(base, item):
    need(not Path(item['path']).is_absolute() and '..' not in Path(item['path']).parts,
         f'bounded record path: {item["path"]}')
    path = base / item['path']
    need(path.is_file(), f'missing record: {path}')
    data = path.read_bytes()
    need(digest(data) == item['sha256'], f'record SHA: {path}')
    need(len(data) == item.get('bytes', item.get('size', len(data))), f'record size: {path}')


def verify_source(item, frozen, checkout):
    return verified_source(item['path'], item['sha256'], item.get('bytes', item.get('size')), frozen, checkout)


@lru_cache(maxsize=None)
def verified_source(path, sha, size, frozen, checkout):
    item = {'path': path, 'sha256': sha}
    if size is not None:
        item['bytes'] = size
    verify_record(checkout, item)
    if '/build/' not in item['path']:
        need(git('show', f'{frozen}:{item["path"]}') == (checkout / item['path']).read_bytes(),
             f'unfrozen source: {item["path"]}')


def static():
    for path, sha in ((BASE_REPORT, BASE_SHA), (LEGACY_REPORT, LEGACY_SHA)):
        need(digest((ROOT / path).read_bytes()) == sha, 'held report SHA: ' + path)
        need(old(path) == (ROOT / path).read_bytes(), 'held baseline exact Git identity')
    fixtures = read(ROOT / 'renderer/virgl-shader/tests/float-mask-cases.json')
    promotions = []
    groups = [('raw', 'raw-bit-cases.json', ['reject-mixed-FSLT-vertex', 'reject-mixed-FSLT-fragment']),
              ('integer', 'integer-mask-cases.json', [f'still-unsupported-{op}-{stage}'
               for stage in ('vertex', 'fragment') for op in ('FSLT', 'FSGE')])]
    for group, file, names in groups:
        path = 'renderer/virgl-shader/tests/' + file
        before, after = json.loads(old(path)), read(ROOT / path)
        need(len(before) == len(after), 'historical fixture count preserved')
        need({e['name'] for e in before} >= set(names), 'literal six prior identities present')
        for previous, actual in zip(before, after):
            replacement = dict(previous)
            if previous['name'] in names:
                op = 'FSGE' if 'FSGE' in previous['name'] else 'FSLT'
                new = {'FSLT': 'FSEQ', 'FSGE': 'FSNE'}[op]
                need(previous['text'].count(op + ' ') == 1, 'exactly one old operation')
                replacement['name'] = previous['name'].replace(op, new)
                replacement['text'] = previous['text'].replace(op + ' ', new + ' ')
                matches = [f for f in fixtures if f['text'] == previous['text'] and f['stage'] == previous['stage']]
                need(len(matches) == 1, 'historical text promoted exactly once')
                promoted = matches[0]
                need(promoted['ok'] is True and promoted['expected'] == {'profile': PROFILE}, 'literal promoted outcome')
                need(previous['ok'] is False and actual['ok'] is False and actual['expected'] == previous['expected'],
                     'replacement preserves rejection expectation')
                promotions.append({'group': group, 'source': path, 'oldName': previous['name'],
                    'replacementName': replacement['name'], 'oldInputSha256': digest(previous['text'].encode()),
                    'replacementInputSha256': digest(replacement['text'].encode()), 'promotedCase': promoted['name'],
                    'expected': {'profile': PROFILE},
                    'replacementCitation': cite(ROOT / path, '"name": "' + replacement['name'] + '"'),
                    'promotionCitation': cite(ROOT / 'renderer/virgl-shader/tests/float-mask-cases.json',
                                              '"name": "' + promoted['name'] + '"')})
            need(actual == replacement, f'exact retained/replaced fixture: {previous["name"]}')
    need(len(promotions) == 6, 'exactly six promotions')
    unchanged = ['tools/virgl-raw-bits/receipt.py', 'tools/virgl-integer-masks/receipt.py',
                 'tools/virgl-raw-bits/regressions.py', 'tools/virgl-integer-masks/regressions.py',
                 'tools/virgl-constants/receipt.py', 'tools/virgl-banks/receipt.py',
                 'tools/verify-virgl-raw-bits.mjs', 'tools/verify-virgl-integer-masks.mjs',
                 'renderer/virgl-shader/tests/raw-bits.mjs', 'renderer/virgl-shader/tests/integer-masks.mjs',
                 'renderer/virgl-shader/tests/raw-bit-hardware.json', 'renderer/virgl-shader/tests/integer-mask-hardware.json',
                 'renderer/virgl-shader/tests/captured-invalid.json', 'renderer/virgl-shader/tests/component-cases.json',
                 'renderer/virgl-shader/tests/bank-cases.json']
    for path in unchanged:
        need(old(path) == (ROOT / path).read_bytes(), 'unchanged proof/input: ' + path)
    return {'promotions': promotions, 'unchanged': [bound(ROOT / p) for p in unchanged],
            'heldBaselines': [bound(ROOT / p) for p in (BASE_REPORT, LEGACY_REPORT)]}


def report_native(directory, frozen, checkout, promotions):
    path = directory / 'native/native-report.json'
    native = read(path)
    held, legacy = read(ROOT / BASE_REPORT), read(ROOT / LEGACY_REPORT)
    need(native['status'] == 'passed' and native['sanitizers'] == ['address', 'undefined'], 'native sanitizer success')
    need(native['migrations'] == [{k: v for k, v in p.items() if k not in ('group', 'replacementCitation', 'promotionCitation')}
                                 for p in promotions], 'six exact migration records')
    for key in ('sources', 'fixtures', 'rawFixtures', 'integerFixtures', 'originals'):
        for source in native[key]:
            verify_source(source, frozen, checkout)
    comparisons = []
    for group, key, previous_key in [('raw', 'rawCases', 'rawCases'), ('integer', 'integerCases', 'cases')]:
        need(len(native[key]) == len(held[previous_key]), 'retained workload size')
        migrated = {p['oldName']: p for p in promotions if p['group'] == group}
        for current, previous in zip(native[key], held[previous_key]):
            expected = dict(previous)
            if previous['name'] in migrated:
                p = migrated[previous['name']]
                op = 'FSGE' if 'FSGE' in previous['name'] else 'FSLT'
                expected.update(name=p['replacementName'], text=previous['text'].replace(op + ' ', {'FSLT': 'FSEQ', 'FSGE': 'FSNE'}[op] + ' '))
                expected.update(inputSha256=digest(expected['text'].encode()), bytes=len(expected['text'].encode()))
            need(current == expected, f'retained complete result: {previous["name"]}')
        comparisons.append({'group': group, 'cases': len(native[key])})
    for current, prior in [('rawPairs', 'rawPairs'), ('integerPairs', 'pairs')]:
        need(native[current] == held[prior], 'all retained pair objects exact')
    originals = {e['sha256']: e for e in legacy['originals']}
    need(len(native['originals']) == len(originals) == 19, 'complete originals')
    for entry in native['originals']:
        need(all(entry[k] == originals[entry['sha256']][k] for k in ('stage', 'ok', 'result', 'resultBytes')), 'original full result unchanged')
    cases = {e['name']: e for e in native['cases']}
    fixture_cases = read(checkout / 'renderer/virgl-shader/tests/float-mask-cases.json')
    hardware = read(checkout / 'renderer/virgl-shader/tests/float-mask-hardware.json')
    expected_cases = fixture_cases + hardware['shaders']
    need(len(expected_cases) == len(native['cases']), 'complete new shared/hardware input list')
    for expected, actual in zip(expected_cases, native['cases']):
        need(all(expected[k] == actual[k] for k in ('name', 'stage', 'text')) and
             actual['ok'] is expected.get('ok', True), 'current fixture input/outcome exact')
    for p in promotions:
        e = cases[p['promotedCase']]
        need(e['inputSha256'] == p['oldInputSha256'] and e['result']['ok'] is True and
             e['result']['metadata']['profile'] == PROFILE, 'exact newly accepted promoted result')
    log = (directory / 'native/native.log').read_bytes()
    need(digest(log) == native['logSha256'], 'native transcript SHA')
    groups = {'ORIGINAL': native['originals'], 'CASE': native['rawCases'] + native['integerCases'] + native['cases'],
              'PAIR': native['rawPairs'] + native['integerPairs'] + native['pairs']}
    seen = {k: set() for k in groups}
    for line in log.decode().splitlines():
        match = re.fullmatch(r'(ORIGINAL|CASE|PAIR) (\d+) (.+)', line)
        if not match:
            continue
        kind, index, raw = match[1], int(match[2]), match[3].encode()
        need(index not in seen[kind], 'unique result transcript index')
        seen[kind].add(index)
        expected = groups[kind][index]
        need(json.loads(raw) == expected['result'] and digest(raw) == expected['resultSha256'] and
             len(raw) == expected['resultBytes'], 'full serialized transcript result')
    need(all(len(seen[k]) == len(v) for k, v in groups.items()), 'complete transcript coverage')
    stream = (directory / 'native/native-input.bin').read_bytes()
    need(digest(stream) == native['streamSha256'], 'native input stream SHA')
    offset = 0
    def take(size):
        nonlocal offset
        need(offset + size <= len(stream), 'bounded input-stream read')
        value = stream[offset:offset + size]
        offset += size
        return value
    def word():
        return struct.unpack('<I', take(4))[0]
    need(take(4) == b'VGF3' and word() == len(native['originals']), 'literal native stream header')
    for entry in native['originals']:
        stage, ok, size = word(), word(), word()
        need(stage == int(entry['stage'] == 'fragment') and ok == int(entry['ok']) and
             take(size) == (checkout / entry['path']).read_bytes(), 'consumed original bytes and outcome')
    combined = [(prefix + e['name'], prefix, e) for prefix, key in
                [('raw::', 'rawCases'), ('integer::', 'integerCases'), ('', 'cases')] for e in native[key]]
    need(word() == len(combined), 'consumed standalone count')
    for name, _, e in combined:
        stage, ok, profile, namesize, size = [word() for _ in range(5)]
        expected_profile = {None: 0, 'virgl-webgl2-straight-line-v5': 0,
                            'virgl-webgl2-raw-bits-v1': 1, 'virgl-webgl2-raw-bits-v2': 2, PROFILE: 3}[e.get('profile')]
        need((stage, ok, profile) == (int(e['stage'] == 'fragment'), int(e['ok']), expected_profile) and
             take(namesize).decode() == name and take(size).decode() == e['text'], 'literal consumed case fields')
    pairs = [(prefix + e['name'], prefix, e) for prefix, key in
             [('raw::', 'rawPairs'), ('integer::', 'integerPairs'), ('', 'pairs')] for e in native[key]]
    need(word() == len(pairs), 'consumed pair count')
    for name, prefix, e in pairs:
        vertex, fragment, ok, namesize = [word() for _ in range(4)]
        need(combined[vertex][0] == prefix + e['vertexCaseName'] and
             combined[fragment][0] == prefix + e['fragmentCaseName'] and
             ok == int(e['ok']) and take(namesize).decode() == name, 'literal consumed pair indices and name')
    need([combined[word()][0] for _ in range(8)] == native['recoverySingles'], 'consumed standalone recovery indices')
    need([pairs[word()][0] for _ in range(6)] == native['recoveryPairs'], 'consumed pair recovery indices')
    need(offset == len(stream), 'no unexamined input-stream bytes')
    named = {name: entry for name, _, entry in combined}
    truncations = sum(len(named[name]['text'].encode()) for name in native['recoverySingles'])
    attempts = len(combined) + truncations + 324 + 4096
    derived_stats = {'originals': 19, 'acceptedOriginals': 12, 'cases': len(combined), 'pairs': len(pairs),
                     'calls': 19 + len(pairs) + 8 + 15 * attempts, 'standaloneRecoveries': 8 * attempts,
                     'pairRecoveries': 6 * attempts, 'truncations': truncations, 'hostileCases': 324, 'mutations': 4096}
    need(all(native['stats'][k] == value for k, value in derived_stats.items()), 'derived native call/recovery accounting')
    binary = checkout / 'renderer/virgl-shader/build/float-mask-sanitize/float-mask-test'
    need(digest(binary.read_bytes()) == native['binarySha256'], 'native executable identity')
    coverage = native['coverage']
    for item in coverage['records']:
        verify_record(directory / 'native', item)
    for item in coverage['sources']:
        verify_source(item, frozen, checkout)
    exported = read(directory / 'native/coverage.json')
    files = exported['data'][0]['files']
    sources = {e['path']: e for e in coverage['sources']}
    need(len(files) == len(sources) == 2, 'both native implementation coverage files')
    for f in files:
        rel = str(Path(f['filename']).resolve().relative_to(checkout.resolve()))
        need(f['summary'] == sources[rel]['summary'] and f['segments'], 'coverage summary matches counters and bound source')
    return {'report': bound(path), 'retained': comparisons, 'retainedPairs': len(native['rawPairs']) + len(native['integerPairs']),
            'newCases': len(native['cases']), 'newPairs': len(native['pairs']), 'stats': native['stats'],
            'transcriptResults': {k: len(v) for k, v in seen.items()}, 'binarySha256': native['binarySha256'],
            'coverage': coverage['sources']}


def acceptance(directory, frozen, checkout, promotions):
    receipt = read(directory / 'receipt.json')
    need(receipt['gitHead'] == frozen and receipt['task'] == 'E6-T12e4c1' and receipt['status'] == 'passed', 'exact frozen receipt')
    need(receipt['production'] == json.loads(old('docs/gpu-3d-contract.json'))['production'], 'production disabled and unchanged')
    for item in receipt['sources']:
        verify_source(item, frozen, checkout)
    for item in receipt['records']:
        verify_record(directory, item)
    actual = {str(p.relative_to(directory)) for p in directory.rglob('*') if p.is_file() and p != directory / 'receipt.json' and p.name != 'acceptance.log'}
    need({i['path'] for i in receipt['records']} == actual and len(receipt['records']) == len(actual), 'complete unique record manifest')
    nested_sources = 0
    for document in sorted(directory.rglob('*.json')):
        if not (document.name.endswith('report.json') or document.name == 'receipt.json'):
            continue
        parsed = read(document)
        if not isinstance(parsed, dict):
            continue
        for source in parsed.get('sources', []):
            if isinstance(source, dict) and {'path', 'sha256'} <= source.keys():
                verify_source(source, frozen, checkout)
                nested_sources += 1
    native = report_native(directory, frozen, checkout, promotions)
    browsers = []
    for path in sorted(directory.rglob('report.json')):
        r = read(path)
        if 'servedFiles' not in r:
            continue
        need(r['gitHead'] == frozen and r['trackedChanges'] == [], 'exact frozen browser run')
        need(r['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'clean browser errors')
        sources = {s['path']: s for s in r['sources']}
        served = {s['path'].lstrip('/'): s for s in r['servedFiles']}
        mutation = r.get('sabotage', {})
        for source in sources.values():
            verify_source(source, frozen, checkout)
        for name, source in served.items():
            if name == '':
                # The older draw/async harness generates its static HTML in the
                # already bound and unchanged wrapper; it is not compiler code.
                need(source['bytes'] > 0 and len(source['sha256']) == 64, 'recorded generated HTML identity')
                continue
            if name == 'fixtures.json':
                expected = mutation.get('servedSha256', r['fixtureTransport']['sha256'])
                need(source['sha256'] == expected, 'legacy fixture transport identity')
                continue
            need(name in sources and source['sha256'] == (mutation['servedSha256'] if name == mutation.get('source') else sources[name]['sha256']), f'actual served source binding: {path}: {name}')
        if 'browserCoverage' in r:
            coverage = r['browserCoverage']
            verify_record(path.parent, coverage)
            for script in read(path.parent / coverage['path'])['scripts']:
                source = script['source'].lstrip('/')
                need(source in served and script['sha256'] == served[source]['sha256'], 'browser coverage bound to served source')
        photo = r.get('screenshot') if r['status'] == 'passed' else r.get('failureScreenshot')
        if photo:
            verify_record(path.parent, photo)
        browsers.append({'path': str(path.relative_to(directory)), 'task': r['task'], 'status': r['status'],
                         'sha256': digest(path.read_bytes()), 'sourceCount': len(sources)})
    wasm = checkout / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'
    need(receipt['compilerSha256']['wasm'] == digest(wasm.read_bytes()), 'actual Wasm compiler identity')
    need(receipt['compilerSha256']['nativeSanitizer'] == native['binarySha256'], 'native receipt compiler identity')
    proof = read(directory / 'hardware/report.json')['acceptance']
    word_count = sum(len(vector['observedWords']) for stage in ('vertexProbes', 'fragmentProbes')
                     for probe in proof[stage] for vector in probe['vectors'])
    captures = sum(len(v['captures']) for p in proof['vertexProbes'] for v in p['vectors'])
    bitplanes = sum(len(v['draws']) for p in proof['fragmentProbes'] for v in p['vectors'])
    finite = len(proof['finiteSelections']['vertex']['captures']) + len(proof['finiteSelections']['fragment']['draws'])
    need(word_count == receipt['orderedWords'] == 768 and captures == 384 and bitplanes == 3072 and
         finite == receipt['finiteSelections'] == 24, 'actual recorded GPU result counts')
    need(len(proof['pairDraws']) == 38 and all(len(p['rawBytes']) == 4096 for p in proof['pairDraws']) and
         receipt['interpolationPixels'] == 38 * (32 * 32 - 32), 'complete raster recordings and nonedge sample count')
    need(proof['objects']['created'] == proof['objects']['deleted'] and proof['objects']['live'] == 0 and
         sum(proof['objects']['created'].values()) == 494, 'all actual GL object releases')
    return {'receipt': bound(directory / 'receipt.json'), 'records': len(receipt['records']), 'sources': len(receipt['sources']),
            'nestedSourceBindings': nested_sources,
            'native': native, 'browsers': browsers, 'wasmSha256': digest(wasm.read_bytes()),
            'production': receipt['production'], 'orderedWords': receipt['orderedWords'],
            'finiteSelections': receipt['finiteSelections'], 'interpolationPixels': receipt['interpolationPixels']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--frozen')
    parser.add_argument('--worker-only', action='store_true')
    args = parser.parse_args()
    results = {'schema': 1, 'task': 'E6-T12e4c1', 'status': 'static-held-awaiting-frozen-evidence',
               'predictions': bound(OUT / 'binding-predictions.md'), 'baselineHead': BASE}
    results['static'] = static()
    if args.frozen:
        frozen = args.frozen
        results['frozenHead'] = frozen
        worker = ROOT / 'evidence/virgl-float-masks/worker'
        cold = ROOT / 'evidence/virgl-float-masks/cold-clone'
        results['worker'] = acceptance(worker, frozen, ROOT, results['static']['promotions'])
        if args.worker_only:
            results['status'] = 'worker-held-awaiting-cold-evidence'
            results['assertions'] = checks
            (OUT / 'binding-audit.json').write_text(json.dumps(results, indent=2) + '\n')
            print(json.dumps({'status': results['status'], 'assertions': checks}))
            return
        cold_report = read(cold / 'report.json')
        need(cold_report['gitHead'] == cold_report['cloneHead'] == cold_report['cloneHeadAfter'] == frozen, 'frozen clone identity')
        need(cold_report['status'] == 'passed' and cold_report['exitCode'] == 0 and
             cold_report['statusBefore'] == cold_report['statusAfter'] == '', 'clean completed cold acceptance')
        need(cold_report['command'] == ['make', 'verify-E6-T12e4c1'], 'full exact cold acceptance command')
        need(digest((cold / 'cold.log').read_bytes()) == cold_report['logSha256'], 'cold command log SHA')
        need(digest((ROOT / 'tools/virgl-float-masks/cold.py').read_bytes()) == cold_report['harnessSha256'], 'cold harness SHA')
        need(digest((cold / 'acceptance/receipt.json').read_bytes()) == cold_report['receiptSha256'], 'cold receipt SHA')
        for item in cold_report['acceptanceFiles']:
            verify_record(cold, item)
        copied = {str(p.relative_to(cold)) for p in (cold / 'acceptance').rglob('*') if p.is_file()}
        need(copied == {i['path'] for i in cold_report['acceptanceFiles']}, 'complete copied cold manifest')
        clone = Path(cold_report['clone'])
        need(git('rev-parse', 'HEAD', cwd=clone).decode().strip() == frozen, 'retained clone still at frozen head')
        need(git('status', '--porcelain', '--untracked-files=all', cwd=clone) == b'', 'retained clone still clean')
        results['cold'] = acceptance(cold / 'acceptance', frozen, clone, results['static']['promotions'])
        need(results['cold']['wasmSha256'] == results['worker']['wasmSha256'], 'reproducible cold/worker Wasm')
        need((worker / 'hardware/browser.png').read_bytes() == (cold / 'acceptance/hardware/browser.png').read_bytes(),
             'reproducible worker/cold hardware screenshot')
        results['hardwareScreenshotSha256'] = digest((worker / 'hardware/browser.png').read_bytes())
        results['coldReport'] = bound(cold / 'report.json')
        results['coldFileCount'] = len(cold_report['acceptanceFiles'])
        results['removedEnvironmentNames'] = cold_report['removedEnvironmentNames']
        claim_path = 'tasks/epic-6-transcendence/E6-T12e4c1-ordered-float-masks.md'
        claim_head = git('rev-parse', 'd21fc8a4').decode().strip()
        claim = git('show', f'{claim_head}:{claim_path}')
        claim_digests = re.findall(r'- `([^`]+)`: `([a-f0-9]{64})`', claim.decode())
        need(len(claim_digests) == 12, 'complete worker claim evidence list')
        for name, sha in claim_digests:
            need(digest((ROOT / 'evidence/virgl-float-masks' / name).read_bytes()) == sha,
                 'exact worker claim evidence digest: ' + name)
        first_line = next(i for i, line in enumerate(claim.decode().splitlines(), 1) if line.startswith('### 2026-10-03 — worker'))
        results['workerClaim'] = {'commit': claim_head, 'path': claim_path, 'sha256': digest(claim),
                                  'evidenceDigests': len(claim_digests), 'firstLine': first_line}
        results['status'] = 'passed'
    results['assertions'] = checks
    (OUT / 'binding-audit.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps({'status': results['status'], 'assertions': checks}))


if __name__ == '__main__':
    main()
