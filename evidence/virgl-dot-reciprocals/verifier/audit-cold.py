"""Read-only final clone/source/recording audit; never reruns or rewrites acceptance."""
import hashlib
import importlib.util
import json
import pathlib
import subprocess

V = pathlib.Path(__file__).resolve().parent
ROOT = V.parents[2]
COLD = ROOT / 'evidence/virgl-dot-reciprocals/cold-clone'
WARM = ROOT / 'evidence/virgl-dot-reciprocals/worker'
HEAD = 'cb6726dc68eebecdaf9b848ea846e525003e86c9'
CLAIM = '433e7f71dc8aee0dfd71bba15be14e9e25609387'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd)


cold = read(COLD / 'report.json')
assert sha(COLD / 'report.json') == 'dcf7972d3ffabd2c448017d3c1304da081a9af980665ae9c13411daf960e099b'
CLONE = pathlib.Path(cold['clone']).resolve()
E = CLONE / 'target/evidence/virgl-dot-reciprocals-cold'
receipt = read(E / 'receipt.json')
assert cold['status'] == receipt['status'] == 'passed'
assert cold['gitHead'] == cold['cloneHead'] == cold['cloneHeadAfter'] == receipt['gitHead'] == HEAD
assert cold['statusBefore'] == cold['statusAfter'] == '' and cold['exitCode'] == 0
assert cold['command'] == ['make', 'verify-E6-T12e6']
assert git('rev-parse', 'HEAD', cwd=CLONE).decode().strip() == HEAD
assert git('status', '--porcelain', '--untracked-files=all', cwd=CLONE) == b''
assert sha(E / 'receipt.json') == cold['receiptSha256'] == '42532735ad1bb140a4b0a5df551d4b9b6c0f4f0f67484d25446f7273c2d108f5'
assert sha(COLD / 'cold.log') == cold['logSha256']
assert sha(CLONE / 'tools/virgl-dot-reciprocals/cold.py') == cold['harnessSha256']

# Check complete copies against the retained checkout, with no missing/extra files.
paths = [entry['path'] for entry in cold['acceptanceFiles']]
assert len(paths) == len(set(paths)) == 205
assert set(paths) == {str(p.relative_to(COLD)) for p in (COLD / 'acceptance').rglob('*') if p.is_file()}
assert {str(p.relative_to(E)) for p in E.rglob('*') if p.is_file()} == {p.removeprefix('acceptance/') for p in paths}
for entry in cold['acceptanceFiles']:
    copy = COLD / entry['path']
    original = E / entry['path'].removeprefix('acceptance/')
    assert copy.read_bytes() == original.read_bytes()
    assert copy.stat().st_size == entry['bytes'] and sha(copy) == entry['sha256']

# Bind the final receipt independently to committed Git blobs and both checkouts.
sources = {entry['path']: entry for entry in receipt['sources']}
assert len(sources) == len(receipt['sources']) == 268
query = ''.join(HEAD + ':' + path + '\n' for path in sources).encode()
blobs = subprocess.run(['git', 'cat-file', '--batch'], cwd=ROOT, input=query,
                       stdout=subprocess.PIPE, check=True).stdout
cursor = 0
for path, entry in sources.items():
    end = blobs.index(b'\n', cursor)
    header = blobs[cursor:end].split()
    assert header[1] == b'blob'
    size = int(header[2])
    raw = blobs[end + 1:end + 1 + size]
    cursor = end + size + 2
    assert size == entry['bytes'] and hashlib.sha256(raw).hexdigest() == entry['sha256']
    assert raw == (CLONE / path).read_bytes() == (ROOT / path).read_bytes()
assert cursor == len(blobs)
assert len(receipt['records']) == len({r['path'] for r in receipt['records']}) == 195
for entry in receipt['records']:
    p = E / entry['path']
    assert p.stat().st_size == entry['bytes'] and sha(p) == entry['sha256']
for path in git('diff', '--name-only', HEAD, CLAIM).decode().splitlines():
    assert path.startswith('evidence/virgl-dot-reciprocals/') or path in {
        'tasks/QUEUE.md', 'tasks/epic-6-transcendence/E6-T12e6-dot-reciprocal.md'}
for path, digest in read(V / 'initial-runtime-digests.json').items():
    assert sha(CLONE / path) == digest
print('Clone clean; all 205 copies, 195 records and 268 source bindings verified.', flush=True)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, CLONE / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


main = module('fresh_cold_scalar_receipt', 'tools/virgl-dot-reciprocals/receipt.py')
native_gate = module('fresh_cold_native_receipt', 'tools/virgl-dot-reciprocals/native_receipt.py')
recip = module('fresh_cold_reciprocal_receipt', 'tools/virgl-dot-reciprocals/reciprocal_receipt.py')
extra = module('fresh_cold_browser_receipt', 'tools/virgl-dot-reciprocals/browser_receipt.py')
h = vars(main)
native, fixtures, hardware, cases, pairs, originals = native_gate.verify_native(E, HEAD)
warm = read(WARM / 'native/native-report.json')
stable = ['originals', 'cases', 'pairs', 'rawCases', 'rawPairs', 'integerCases', 'integerPairs',
          'floatCases', 'floatPairs', 'numericCases', 'numericPairs', 'componentCases', 'componentPairs',
          'migrations', 'stats', 'recordedMaxima', 'layout', 'recoverySingles', 'recoveryPairs',
          'streamSha256', 'logSha256', 'seeds', 'mutationsPerSeed', 'sanitizers']
assert all(native[key] == warm[key] for key in stable)
assert (E / 'native/native.log').read_bytes() == (WARM / 'native/native.log').read_bytes()
assert (E / 'native/native-input.bin').read_bytes() == (WARM / 'native/native-input.bin').read_bytes()
old_cov = read(WARM / 'native/coverage.json')['data'][0]['files']
new_cov = read(E / 'native/coverage.json')['data'][0]['files']
def normalize_coverage(value, root):
    if isinstance(value, dict):
        return {k: normalize_coverage(v, root) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize_coverage(v, root) for v in value]
    if isinstance(value, str) and value.startswith(str(root) + '/'):
        return value.removeprefix(str(root) + '/')
    return value


assert normalize_coverage(old_cov, ROOT) == normalize_coverage(new_cov, CLONE)
print('Final native outcomes, complete transcript, stream and source counter data equal HELD recording.', flush=True)

contract = read(CLONE / 'docs/gpu-3d-contract.json')
labels = ['hardware', 'sabotage-dp3-lane', 'sabotage-rcp-source', 'sabotage-rsq-operation', 'sabotage-numeric-negate']
reports = {}
hits = {}
for label in labels:
    r = main.base.verify_browser(E / label, HEAD, contract, passed=label == 'hardware', task='E6-T12e6')
    reports[label] = r
    p = r['acceptance']
    main.translations(p, fixtures, hardware, cases, pairs, originals)
    assert p['operationDefinitions'] == hardware['operationDefinitions']
    assert [e['name'] for e in p['cases']] == [e['name'] for e in fixtures]
    assert [e['name'] for e in p['anchors']] == [e['name'] for e in hardware['shaders']]
    assert [e['name'] for e in p['pairs']] == [e['name'] for e in hardware['pairs']]
    assert [e['sha256'] for e in p['corpus']] == list(originals)
    assert [e['name'] for e in p['rejectionPairs']] == [f'rejected-{stage}-{code}-pair'
        for stage in ('vertex', 'fragment') for code in ('parse-error', 'unsupported-feature')]
    assert p['caseFixture'] == main.binding(CLONE / 'renderer/virgl-shader/tests/dot-reciprocal-cases.json')
    assert p['hardwareFixture'] == main.binding(CLONE / 'renderer/virgl-shader/tests/dot-reciprocal-hardware.json')
    first = hardware['numericVectors'][0]
    assert p['literalWitnesses'] == {'input': first, 'expected': {
        name: [main.oracle.word(v) for v in main.oracle.numeric(name, first)]
        for name in ('dp3', 'dp3-swizzle', 'dp3-safe')}}
    extra.verify_orientation(p, cases, helpers=h)
    for script in read(E / label / r['browserCoverage']['path'])['scripts']:
        if script['source'] == 'renderer/virgl-shader/tests/dot-reciprocals.mjs':
            assert script['sha256'] == sha(CLONE / script['source'])
            for f in script['coverage']['functions']:
                z = f['ranges'][0]
                key = (f['functionName'], z['startOffset'], z['endOffset'])
                hits[key] = hits.get(key, 0) + z['count']
p = reports['hardware']['acceptance']
main.verify_sequences(p, hardware)
main.verify_source_contracts(p, hardware, cases)
values = {'numeric': main.verify_numeric(p, hardware, cases),
          'textures': main.verify_textures(p, hardware, cases),
          'reciprocals': recip.verify_reciprocals(p, hardware, cases, helpers=h),
          'observations': recip.verify_observations(p, hardware, cases, helpers=h),
          'pixels': main.verify_pairs(p, hardware, pairs)}
assert values['numeric'] == (receipt['numericWords'], 30)
for key, recorded in [('textures', 'textures'), ('reciprocals', 'reciprocals'),
                      ('observations', 'specialObservations'), ('pixels', 'interpolationPixels')]:
    assert values[key] == receipt[recorded]
assert p['checkedWords'] == 488 and p['exactWords'] == 310 and p['boundedReciprocalWords'] == 178
assert p['observedSpecialWords'] == 72 and p['status'] == 'passed' and p['sabotage'] is None and p['omissions'] == []
assert p['objects']['live'] == 0 and p['objects']['created'] == p['objects']['deleted']
assert p['memory']['initialBytes'] == p['memory']['finalBytes'] == 16777216 and p['memory']['bufferIdentityStable']
assert len(hits) == 151 and all(hits.values())
faults = [extra.verify_sabotage(E / ('sabotage-' + mode), mode, reports['hardware'], cases, hardware, helpers=h)
          for mode in ['dp3-lane', 'rcp-source', 'rsq-operation', 'numeric-negate']]
assert receipt['compilerSha256'] == {'nativeSanitizer': native['binarySha256'],
    'wasm': sha(CLONE / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm')}
assert receipt['migrations'] == native['migrations'] and receipt['migrationSource'] == native['migrationsSource']
assert receipt['production'] == contract['production'] and receipt['profiles'] == main.PROFILES
print('Final scalar GPU values, four faults, fixed memory, object release and all 151 harness functions verified.', flush=True)

# Recheck the actual new predecessor records without writing or pretending to run acceptance.
regressions = module('fresh_cold_regressions', 'tools/virgl-dot-reciprocals/regressions.py').verify(E, HEAD, contract)
assert {k: v for k, v in regressions.items() if k != 'sources'} == receipt['regressions']
assert git('rev-parse', 'HEAD', cwd=CLONE).decode().strip() == HEAD
assert git('status', '--porcelain', '--untracked-files=all', cwd=CLONE) == b''
assert sha(E / 'receipt.json') == cold['receiptSha256']
result = {'status': 'passed', 'head': HEAD, 'workerClaimCommit': CLAIM, 'clone': str(CLONE),
          'cleanBeforeAndAfterAudit': True, 'coldReportSha256': sha(COLD / 'report.json'),
          'coldLogSha256': sha(COLD / 'cold.log'), 'receiptSha256': sha(E / 'receipt.json'),
          'acceptanceFilesVerified': len(paths), 'sourcesVerified': len(sources), 'recordsVerified': len(receipt['records']),
          'removedEnvironmentNames': cold['removedEnvironmentNames'],
          'nativeReportSha256': sha(E / 'native/native-report.json'), 'nativeStats': native['stats'],
          'nativeHeldComparison': stable, 'entireNativeStreamAndTranscriptEqualHeld': True,
          'allSourceCoverageFileCountersEqualHeld': True, 'scalarValues': values,
          'scalarReports': {label: sha(E / label / 'report.json') for label in labels},
          'scalarFaults': faults, 'harnessFunctionsEntered': len(hits),
          'memory': p['memory'], 'objects': p['objects'], 'screenshot': reports['hardware']['screenshot'],
          'fullPredecessorReceiptRevalidated': True, 'compilerSha256': receipt['compilerSha256']}
(V / 'cold-audit.json').write_text(json.dumps(result, indent=2) + '\n')
print('PASS: pristine final-head full proof revalidated read-only; native/runtime HELD evidence preserved.', flush=True)
