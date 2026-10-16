"""Fresh finest-counter audit including explicit native predicate outcomes."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ROOT = REPO / 'target/evidence/d65-critic-opened-01/worker/cold/recording'
BASE = '6f43010dfa7b3e08bfe62f62543b7ee0468e1a21'
SOURCE = '31bf0781db74fea94f51c9d6fa3217d16227bc99'
sha = lambda b: hashlib.sha256(b).hexdigest()
git = lambda *a: subprocess.check_output(['git', *a], cwd=REPO)
audit = json.loads((ROOT / 'coverage-audit.json').read_bytes())
cold = json.loads((ROOT.parent / 'report.json').read_bytes())
assert audit['gitHead'] == SOURCE and audit['predecessor'] == BASE


def added(paths):
    result, name, line = {}, None, 0
    for row in git('diff', '--unified=0', BASE, SOURCE, '--', *paths).decode().splitlines():
        if row.startswith('+++ b/'):
            name = row[6:]
        elif row.startswith('@@'):
            line = int(re.search(r'\+(\d+)', row)[1])
        elif row.startswith('+') and name:
            result.setdefault(name, []).append(line)
            line += 1
        elif row.startswith(' '):
            line += 1
    return result


assert audit['addedLines'] == added(['renderer/virgl-shader/standard.mjs'])
assert audit['nativeAddedLines'] == added(list(audit['nativeAddedLines']))
assert not audit['zero'] and not audit['nativeZero']
scripts = []
for script in audit['scripts']:
    record = ROOT / script['record']
    body = git('show', SOURCE + ':' + script['source'])
    assert sha(body) == script['sha256']
    raw = json.loads(record.read_bytes())
    if record.name == 'browser-coverage.json':
        matches = [s for s in raw['scripts'] if s['source'] == script['source']]
        report = json.loads(record.with_name('report.json').read_bytes())
        assert sha(record.read_bytes()) == report['browserCoverage']['sha256']
        assert script['sourceBody'].encode() == body
        assert matches[0]['sourceBody'].encode() == body
    else:
        matches = [s for s in raw['result'] if s['url'] == Path(cold['clone']).as_uri() + '/' + script['source']]
    assert len(matches) == 1 and matches[0].get('coverage', matches[0]) == script['coverage']
    scripts.append(script)
js_citations = []
for partition in audit['partitions']:
    name, a, b = partition['source'], partition['startOffset'], partition['endOffset']
    counters = []
    for script in scripts:
        if script['source'] != name:
            continue
        candidates = [r for f in script['coverage']['functions'] for r in f['ranges'] if r['startOffset'] <= a and b <= r['endOffset']]
        if candidates:
            counters.append(dict(record=script['record'], **min(candidates, key=lambda r: (r['endOffset'] - r['startOffset'], r['count']))))
    assert counters == partition['counters']
    assert max(c['count'] for c in counters) == partition['maxCount'] > 0
    js_citations.append(dict(source=name, line=partition['line'], startOffset=a, endOffset=b,
                             narrowestPositive=min((c for c in counters if c['count']), key=lambda r: r['endOffset'] - r['startOffset'])))
assert len(js_citations) == 247

full_llvm = json.loads((ROOT / 'coverage/native.json').read_bytes())['data'][0]['functions']
for fn in audit['llvm']:
    matches = [f for f in full_llvm if f['name'] == fn['name'] and f['filenames'] == fn['filenames'] and f['regions'] == fn['regions']]
    assert matches
native_citations = []
for partition in audit['nativePartitions']:
    name, a, b = partition['source'], partition['start'], partition['end']
    body = git('show', SOURCE + ':' + name).decode()
    assert body[a:b] == partition['text']
    starts = [0]
    for line in body.splitlines(keepends=True):
        starts.append(starts[-1] + len(line))
    counters = []
    for fn in audit['llvm']:
        candidates = []
        for r in fn['regions']:
            if r[7] != 0 or not fn['filenames'][r[5]].endswith('/' + name):
                continue
            lo, hi = starts[r[0] - 1] + r[1] - 1, starts[r[2] - 1] + r[3] - 1
            if lo <= a and b <= hi and lo < hi:
                candidates.append(dict(start=lo, end=hi, count=r[4], original=r))
        if candidates:
            chosen = min(candidates, key=lambda r: (r['end'] - r['start'], r['count']))
            counters.append(dict(record=fn['record'], function=fn['name'], **chosen))
    assert counters == partition['counters']
    assert max(c['count'] for c in counters) == partition['maxCount'] > 0
    native_citations.append(dict(source=name, line=partition['line'], start=a, end=b,
                                 narrowestPositive=min((c for c in counters if c['count']), key=lambda r: r['end'] - r['start'])))
assert len(native_citations) == 357
for waiver in audit['nativeDeclarationWaivers']:
    body = git('show', SOURCE + ':' + waiver['source']).decode()
    text = body[waiver['start']:waiver['end']]
    assert text == waiver['text']
    assert (waiver['source'].endswith('.h') or text.lstrip().startswith(('/*', '#include', 'static ', 'const char *', 'bool ', 'unsigned ', 'uint32_t ', 'const uint32_t *'))), (waiver['source'], waiver['line'], text)
for name, lines in audit['nativeAddedLines'].items():
    body = git('show', SOURCE + ':' + name).decode()
    starts = [0]
    for row in body.splitlines(keepends=True):
        starts.append(starts[-1] + len(row))
    all_regions = audit['nativePartitions'] + audit['nativeDeclarationWaivers']
    for line in lines:
        intervals = sorted((r['start'], r['end']) for r in all_regions if r['source'] == name and r['line'] == line)
        covered = set(i for a, b in intervals for i in range(a, b))
        assert all(i in covered or body[i].isspace() for i in range(starts[line - 1], starts[line]))

supplement = json.loads((OUT / 'native-components/coverage.json').read_bytes())['data'][0]['functions']
old_fn = next(f for f in full_llvm if f['name'] == 'standard_stream_output_validate')
new_fn = next(f for f in supplement if f['name'] == 'standard_stream_output_validate')
branches = []
for original in old_fn['branches']:
    extra = next((b for b in new_fn['branches'] if b[:4] == original[:4]), None)
    true_count = original[4] + (extra[4] if extra else 0)
    false_count = original[5] + (extra[5] if extra else 0)
    assert true_count and false_count, original
    branches.append(dict(source='renderer/virgl-shader/standard_stream_output.c', line=original[0], column=original[1],
                         original=original, independentSupplement=extra, trueCount=true_count, falseCount=false_count))
frames = {}
for file in (ROOT / 'stack').glob('*.su'):
    for row in file.read_text().splitlines():
        fields = row.split('\t')
        assert fields[2] == 'static'
        frames[fields[0].rsplit(':', 1)[-1]] = int(fields[1])
receipt = json.loads((ROOT / 'receipt.json').read_bytes())
for mode in ['stage', 'pair']:
    entry = 'bridge_translate_standard_stream_output' + ('_pair' if mode == 'pair' else '')
    names = [entry, 'standard_' + mode + '_layout', 'standard_convert', 'vrend_convert_shader', 'standard_emit', 'standard_stream_output_validate']
    sizes = {n: frames[n] for n in names}
    total = sum(sizes.values())
    assert total == receipt['stack'][mode]['selectedFrameSumBytes'] < 262144
    assert receipt['stack'][mode]['frames'] == sizes
wasm = (ROOT / 'generated/virgl-shader.wasm').read_bytes()


def varint(data, at):
    n, shift = 0, 0
    while True:
        byte = data[at]
        at += 1
        n |= (byte & 127) << shift
        if not byte & 128:
            return n, at
        shift += 7


assert wasm[:8] == b'\0asm\x01\0\0\0'
at, limits = 8, None
while at < len(wasm):
    kind = wasm[at]
    length, start = varint(wasm, at + 1)
    if kind == 5:
        count, p = varint(wasm, start)
        flag, p = varint(wasm, p)
        initial, p = varint(wasm, p)
        maximum, p = varint(wasm, p)
        assert (count, flag, initial, maximum) == (1, 1, 256, 256)
        limits = dict(initialBytes=initial * 65536, maximumBytes=maximum * 65536, growable=False)
    at = start + length
assert limits and at == len(wasm)
result = dict(schema='stream-output-shaders-independent-finest-coverage-v1', status='passed', P7='HELD',
              javascriptRegions=len(js_citations), nativeRegions=len(native_citations), staticNativeWaivers=len(audit['nativeDeclarationWaivers']),
              missingRegions=0, jsCitations=js_citations, nativeCitations=native_citations,
              nativePredicateOutcomes=branches, originalWaivers=audit['nativeDeclarationWaivers'],
              measuredSelectedFrameSums={m: receipt['stack'][m]['selectedFrameSumBytes'] for m in ['stage', 'pair']},
              unchangedNestedCompilerBoundary=BASE, wasmMemory=limits)
(OUT / 'coverage.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(status='passed', javascript=247, native=357, staticWaivers=len(audit['nativeDeclarationWaivers']),
                      nativePredicateBranches=len(branches), missing=0, wasmMemory=limits)))
