"""Independent digest, original-byte, cold-clone and precise-coverage audit."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path.cwd()
OUT = Path(__file__).resolve().parent
BASE = OUT.parent
FROZEN = 'fadf4ba813fa31694fb0a560f89c61c740ea3643'
digest = lambda data: hashlib.sha256(data).hexdigest()
checks = []
def require(value, name):
    if not value:
        raise AssertionError(name)
    checks.append(name)

def load(path):
    return json.loads(path.read_text())

receipts = {}
for dirname in ['worker', 'cold-clone/acceptance']:
    directory = BASE / dirname
    receipt = load(directory / 'receipt.json')
    require(receipt['gitHead'] == FROZEN and receipt['status'] == 'passed', dirname + ' exact frozen head')
    for source in receipt['sources'] + receipt['inputs']:
        data = (ROOT / source['path']).read_bytes()
        require(digest(data) == source['sha256'], dirname + ' source ' + source['path'])
        require(subprocess.check_output(['git', 'show', FROZEN + ':' + source['path']], cwd=ROOT) == data,
                dirname + ' source committed at frozen head ' + source['path'])
        if 'decodedSha256' in source:
            raw = gzip.decompress(data) if source['path'].endswith('.gz') else data
            require(digest(raw) == source['decodedSha256'] and len(raw) == source['decodedBytes'], dirname + ' decoded input ' + source['path'])
    for record in receipt['records']:
        require(digest((directory / record['path']).read_bytes()) == record['sha256'], dirname + ' record ' + record['path'])
    good = load(directory / 'hardware/report.json')
    served = {s['path']: s for s in good['servedFiles']}
    for source_entry in good['sources']:
        if source_entry['path'].startswith('renderer/') and source_entry['path'].endswith('.mjs'):
            require(served['/' + source_entry['path']]['sha256'] == source_entry['sha256'], dirname + ' exact served source ' + source_entry['path'])
    require(served['/fixtures.json']['sha256'] == good['fixtureTransport']['sha256'], dirname + ' exact served original fixtures')
    require(good['trackedChanges'] == [], dirname + ' clean proof source tree')
    require(good['browserErrors'] == {'console': [], 'page': [], 'requests': []}, dirname + ' no browser errors')
    require(good['node'] == good['browserResult']['result']['native'], dirname + ' Node/browser same native checks')
    require(good['browser']['gpu']['featureStatus'][good['browser']['webglFeature']] == 'enabled', dirname + ' hardware WebGL enabled')
    gpu = good['browserResult']['result']['gpu']
    require(gpu['originalBudgets']['gpuBytes'] == 4188 and gpu['originalBudgets']['backingBytes'] == 1064960, dirname + ' logical and physical budgets distinct')
    require(all(v == 0 for v in gpu['finalBudgets'].values()), dirname + ' all final resource budgets zero')
    require(gpu['referenceOutputBytesPoisoned'] == 12288, dirname + ' all reference output bytes poisoned')
    require(gpu['sourceOracle'] == 'direct GPU objects' and gpu['indexElementBinding'] == 'passed' and gpu['hostStatePoison'] == 'passed', dirname + ' actual GPU oracle/classification/host state')
    events = [json.loads(s) for s in (ROOT / 'evidence/virgl-corpus/captures/textured-scene/events.jsonl').read_text().splitlines()]
    selected = []
    for seq, key, size in [(156, 'vertex', 64), (157, 'index', 12), (160, 'texture', 16)]:
        event = next(e for e in events if e['seq'] == seq)
        blob = event['blobs'][0]
        filepath = ROOT / 'evidence/virgl-corpus/captures/textured-scene/blobs' / (blob['sha256'] + '.bin.gz')
        raw = gzip.decompress(filepath.read_bytes())
        require(digest(raw) == blob['sha256'], dirname + ' initial source event ' + str(seq))
        require(gpu['originalUploads'][key] == list(raw[:size]), dirname + ' GPU bytes equal raw original snapshot ' + key)
        selected.append({'event': seq, 'resourceId': event['resourceId'], 'sourceSha256': blob['sha256'], 'offset': 0, 'bytes': size})
    for variant, oracle in [('texture-texel', 'original texture GPU bytes'), ('index-byte', 'original index GPU bytes')]:
        sabotage = load(directory / ('sabotage-' + variant) / 'report.json')
        require(sabotage['node']['status'] == 'passed' and sabotage['browserResult']['status'] == 'failed' and oracle in sabotage['browserResult']['error']['message'], dirname + ' genuine input corruption caught ' + variant)
        sabotage_served = {s['path']: s for s in sabotage['servedFiles']}
        require(sabotage_served['/fixtures.json']['sha256'] == sabotage['sabotage']['servedSha256'] != sabotage['sabotage']['originalSha256'], dirname + ' exact corrupted fixture served ' + variant)
    receipts[dirname] = {'sha256': digest((directory / 'receipt.json').read_bytes()), 'nodeAssertions': good['node']['assertions'], 'gpuAssertions': gpu['assertions'], 'cases': len(good['node']['cases']), 'inputs': selected}

cold = load(BASE / 'cold-clone/report.json')
require(cold['status'] == 'passed' and cold['gitHead'] == cold['cloneHead'] == FROZEN, 'cold exact head')
require(cold['statusBefore'] == cold['statusAfter'] == '' and cold['exitCode'] == 0, 'cold clean before/after and accepted')
require(digest((BASE / 'cold-clone/acceptance/receipt.json').read_bytes()) == cold['receiptSha256'], 'cold receipt bound')
require(digest((BASE / 'cold-clone/cold.log').read_bytes()) == cold['logSha256'], 'cold command log bound')
require(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cold['clone'], text=True).strip() == FROZEN, 'independent cold checkout head')
require(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=cold['clone'], text=True).strip() == '', 'independent cold checkout remains clean')

attacks = load(OUT / 'attacks.json')
require(attacks['status'] == 'passed', 'independent attacks passed')
require(subprocess.run(['git', 'diff', '--quiet', FROZEN, attacks['gitHead'], '--', *[s['path'] for s in receipt['sources']]], cwd=ROOT).returncode == 0,
        'independent attacks preserve all frozen source bytes at evidence-only submission head')
for source in attacks['sources']:
    require(digest((ROOT / source['path']).read_bytes()) == source['sha256'], 'independent source ' + source['path'])
require(digest((OUT / 'attack-coverage.json').read_bytes()) == attacks['coverageSha256'], 'independent coverage bound')
require(digest((OUT / 'attack.png').read_bytes()) == attacks['screenshotSha256'], 'independent screenshot bound')
require(attacks['native']['mutations']['count'] == 8192 and len(attacks['attack']['records']) == 72, 'independent bounded attacks counts')
require(all(s['status'] == 'detected' for s in attacks['sabotages']), 'both independent runtime sabotages caught')

source = (ROOT / 'renderer/virgl-command/resources.mjs').read_text()
paths = [BASE / 'worker/node-coverage.json', BASE / 'worker/hardware/browser-coverage.json', OUT / 'attack-coverage.json']
coverage = []
for path in paths:
    record = load(path)
    require(record.get('sha256', record.get('sourceSha256')) == digest(source.encode()), 'coverage source ' + str(path.relative_to(BASE)))
    coverage.append(record['coverage'])

def execution_counts(script):
    # Detailed V8 ranges are nested; the innermost range is authoritative.
    counts = [0] * len(source)
    ranges = [r for f in script['functions'] for r in f['ranges']]
    for r in sorted(ranges, key=lambda r: r['endOffset'] - r['startOffset'], reverse=True):
        counts[r['startOffset']:r['endOffset']] = [r['count']] * (r['endOffset'] - r['startOffset'])
    return counts

counts = [execution_counts(s) for s in coverage]
covered = [any(c[i] for c in counts) for i in range(len(source))]
uncovered = []
start = None
for i in range(len(source) + 1):
    if i < len(source) and not covered[i]:
        if start is None: start = i
    elif start is not None:
        fragment = source[start:i]
        if fragment.strip():
            uncovered.append({'startOffset': start, 'endOffset': i, 'startLine': source.count('\n', 0, start) + 1, 'endLine': source.count('\n', 0, i) + 1, 'text': fragment})
        start = None
functions = {}
for script in coverage:
    for function in script['functions']:
        key = str(function['ranges'][0]['startOffset']) + ':' + function['functionName']
        functions[key] = max(functions.get(key, 0), function['ranges'][0]['count'])
report = {'status': 'passed', 'frozenHead': FROZEN, 'checks': checks, 'receipts': receipts, 'cold': cold,
          'attacksSha256': digest((OUT / 'attacks.json').read_bytes()), 'runtimeSha256': digest(source.encode()),
          'coverage': {'allFunctions': len(functions), 'unexecutedFunctions': {k:v for k,v in functions.items() if v == 0}, 'uncoveredSpans': uncovered}}
(OUT / 'audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'checks': len(checks), 'receipts': receipts, 'coverage': report['coverage']}, indent=2))
