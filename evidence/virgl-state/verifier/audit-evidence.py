"""Independent exact-byte, cold-clone, oracle and changed-runtime coverage audit."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path.cwd()
OUT = Path(__file__).resolve().parent
BASE = OUT.parent
FROZEN = 'd530c0943c9c8bdb757e0f8ee440794d1316aea9'
digest = lambda data: hashlib.sha256(data).hexdigest()
load = lambda path: json.loads(path.read_text())
checks = []
def require(value, label):
    if not value: raise AssertionError(label)
    checks.append(label)
def raw(path): return (ROOT / path).read_bytes()
def verify_source(entry, label, committed=True):
    data = raw(entry['path'])
    require(digest(data) == entry['sha256'], label + ' digest ' + entry['path'])
    if committed and '/build/wasm/' not in entry['path']:
        require(subprocess.check_output(['git', 'show', FROZEN + ':' + entry['path']], cwd=ROOT) == data, label + ' frozen source ' + entry['path'])
    if 'decodedSha256' in entry:
        decoded = gzip.decompress(data) if entry['path'].endswith('.gz') else data
        require(digest(decoded) == entry['decodedSha256'] and len(decoded) == entry['decodedBytes'], label + ' original decoded bytes ' + entry['path'])

receipts = {}
for dirname, expected in [('worker', '94d8db69ea0ee07aff2221cc4ad73aaea3589b06d3cc7ffd8456e1381683146d'), ('cold-clone/acceptance', '633abb0077a5cdd416e7f06146fc0313dc93baff2dd0759289425e8694496f90')]:
    directory = BASE / dirname
    receipt = load(directory / 'receipt.json')
    require(digest((directory / 'receipt.json').read_bytes()) == expected, dirname + ' handed-off receipt')
    require(receipt['status'] == 'passed' and receipt['gitHead'] == FROZEN, dirname + ' exact frozen head')
    for entry in receipt['sources'] + receipt['inputs']: verify_source(entry, dirname)
    for entry in receipt['records']: require(digest((directory / entry['path']).read_bytes()) == entry['sha256'], dirname + ' record ' + entry['path'])
    good = load(directory / 'hardware/report.json')
    require(good['gitHead'] == FROZEN and good['status'] == 'passed' and good['trackedChanges'] == [], dirname + ' hardware exact clean source')
    require(good['browserErrors'] == {'console': [], 'page': [], 'requests': []}, dirname + ' no browser errors')
    served = {s['path']:s for s in good['servedFiles']}
    for entry in good['sources']:
        if entry['path'].startswith('renderer/') and entry['path'].endswith(('.mjs', '.wasm')):
            require(served['/' + entry['path']]['sha256'] == entry['sha256'], dirname + ' actual served runtime ' + entry['path'])
    require(served['/fixtures.json']['sha256'] == good['fixtureTransport']['sha256'], dirname + ' actual served fixtures')
    require(good['browser']['gpu']['featureStatus'][good['browser']['webglFeature']] == 'enabled', dirname + ' hardware WebGL')
    gpu = good['browserResult']['result']
    require(gpu['status'] == 'passed' and not gpu['guestExecution'] and not gpu['drawReplay'], dirname + ' state-only claim')
    require(gpu['assertions'] == 26031 and gpu['summary']['attacks'] == 51 and gpu['summary']['clearPixelsChecked'] == 6144, dirname + ' authoritative counts')
    require(gpu['originalResults'][0]['appliedCommands'] == 38 and gpu['originalResults'][0]['stopOffset'] == 5684, dirname + ' original prefix draw stop')
    require(sum(r['appliedCommands'] for r in gpu['originalResults']) == 207 and len(gpu['originalResults']) == 8, dirname + ' original scoped commands')
    tail = gpu['originalResults'][-1]
    require(tail['splitByteOffset'] == 11384 and tail['prefixCommands'] == 131 and tail['suffixCommands'] == 11, dirname + ' original retained surface split')
    for key in ['finalStateBudgets','finalResourceBudgets']: require(all(v == 0 for v in gpu[key].values()), dirname + ' zero ' + key)
    expected_shaders = ['e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33', '80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808']
    require([digest(t['text'].encode()) for t in gpu['translations'][:2]] == expected_shaders, dirname + ' unmodified original shader texts')
    reflection = gpu['originalReflection']
    require([(a['name'],a['type']) for a in reflection['attributes']] == [('in_0',35666),('in_1',35666)], dirname + ' actual vertex reflection')
    require(reflection['uniforms'][0]['encoding'] == 'float32-bits' and reflection['samplers'][0]['unit'] == 0, dirname + ' actual constant/sampler reflection')
    require(reflection['uniformBlocks'] == [{'name':'VirglBlock','index':0,'byteLength':656,'binding':0,'members':[{'name':'winsys_adjust_y','offset':640,'type':5126,'value':1}]}], dirname + ' actual system block reflection')
    for mode, oracle in [('constant-bits','original fragment constant bits'),('color-mask','original color mask')]:
        sabotage = load(directory / ('sabotage-' + mode) / 'report.json')
        require(sabotage['browserResult']['status'] == 'failed' and oracle in sabotage['browserResult']['error']['message'], dirname + ' input sabotage detected ' + mode)
        ss = {s['path']:s for s in sabotage['servedFiles']}
        require(ss['/fixtures.json']['sha256'] == sabotage['sabotage']['servedSha256'] != sabotage['sabotage']['originalSha256'], dirname + ' actual corrupted wire served ' + mode)
    receipts[dirname] = {'sha256':expected,'hardwareAssertions':gpu['assertions'],'attackCases':gpu['summary']['attacks'],'clearPixels':gpu['summary']['clearPixelsChecked']}

cold = load(BASE / 'cold-clone/report.json')
require(cold['status'] == 'passed' and cold['gitHead'] == cold['cloneHead'] == FROZEN and cold['exitCode'] == 0 and cold['statusBefore'] == cold['statusAfter'] == '', 'cold exact clean success')
for path,key in [('acceptance/receipt.json','receiptSha256'),('cold.log','logSha256')]: require(digest((BASE/'cold-clone'/path).read_bytes()) == cold[key], 'cold bound ' + path)
require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=cold['clone'],text=True).strip() == FROZEN, 'independent cold checkout exact head')
require(subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=cold['clone'],text=True).strip() == '', 'independent cold checkout remains clean')

attacks = load(OUT / 'attacks.json')
require(attacks['status'] == 'passed', 'independent attacks passed')
require(subprocess.run(['git','diff','--quiet',FROZEN,attacks['gitHead'],'--',*[s['path'] for s in receipt['sources']]],cwd=ROOT).returncode == 0, 'independent evidence-only descendant preserves frozen sources')
for entry in attacks['sources'] + attacks['inputs']: verify_source(entry, 'independent', committed=not entry['path'].startswith('evidence/virgl-state/verifier/'))
baseline = attacks['variants'][0]
require(baseline['servedRuntimeSha256'] == digest(raw('renderer/virgl-command/state.mjs')), 'independent actual frozen runtime served')
require(baseline['errors'] == {'console':[],'page':[],'request':[]}, 'independent no browser errors')
for path,key in [('attack-coverage.json','coverageSha256'),('attack.png','screenshotSha256')]: require(digest((OUT/path).read_bytes()) == baseline[key], 'independent bound ' + path)
a = baseline['result']
require(a['assertions'] == 5342 and len(a['rounds']) == 48 and len(a['rejections']) == 528 and a['pixels'] == 50176 and a['drawCalls'] == 0, 'independent exact attack counts and zero actual draws')
require(len({r['seed'] for r in a['rounds']}) == 3 and len({r['name'] for r in a['rejections']}) == 11, 'independent seeds and rejection families')
for key in ['finalStateBudgets','finalResourceBudgets']: require(all(v == 0 for v in a[key].values()), 'independent zero ' + key)
for variant, oracle in zip(attacks['variants'][1:], ['raw constant words','system UBO contents restored']):
    require(variant['result']['status'] == 'failed' and oracle in variant['result']['error']['message'], 'independent source sabotage caught ' + variant['variant'])
    mutation = next(s for s in attacks['sabotages'] if s['name'] == variant['variant'])
    changed = raw('renderer/virgl-command/state.mjs').decode().replace(mutation['before'],mutation['after'])
    require(digest(changed.encode()) == variant['servedRuntimeSha256'] == mutation['sourceSha256'], 'independent sabotage exact served mutation ' + variant['variant'])

coverage = {}
worker_scripts = load(BASE / 'worker/hardware/browser-coverage.json')['scripts']
independent_scripts = load(OUT / 'attack-coverage.json')['scripts']
for filename in ['state.mjs','resources.mjs']:
    filepath = 'renderer/virgl-command/' + filename
    source = raw(filepath).decode()
    worker = next(s for s in worker_scripts if s['source'] == filepath)
    require(worker['sha256'] == digest(source.encode()), 'coverage binds source ' + filename)
    independent = next(s for s in independent_scripts if s['url'].endswith('/'+filepath))
    scripts = [worker['coverage'],independent]
    counts = []
    for script in scripts:
        current = [0] * len(source)
        ranges = [r for f in script['functions'] for r in f['ranges']]
        for r in sorted(ranges,key=lambda r:r['endOffset']-r['startOffset'],reverse=True):
            current[r['startOffset']:r['endOffset']] = [r['count']] * (r['endOffset']-r['startOffset'])
        counts.append(current)
    uncovered = []; start = None
    begin = 0 if filename == 'state.mjs' else source.index('  const bindings = Object.freeze({')
    end = len(source) if filename == 'state.mjs' else source.index('\n}\n',begin)+2
    for i in range(begin,end+1):
        if i<end and not any(c[i] for c in counts):
            if start is None:start=i
        elif start is not None:
            text=source[start:i]
            if text.strip(): uncovered.append({'startOffset':start,'endOffset':i,'line':source.count('\n',0,start)+1,'text':text})
            start=None
    functions = {}
    for script in scripts:
        for f in script['functions']:
            r=f['ranges'][0]
            if begin <= r['startOffset'] < end:
                key=str(r['startOffset'])+':'+f['functionName'];functions[key]=max(functions.get(key,0),r['count'])
    require(not any(v==0 for v in functions.values()), 'all scoped runtime functions executed '+filename)
    expected = ['?? "invalid-lease"','?? "Storage lease release failed."'] if filename == 'state.mjs' else []
    require([s['text'] for s in uncovered] == expected, 'only classified diagnostic fallback spans remain '+filename)
    coverage[filepath] = {'sha256':digest(source.encode()),'scopedFunctions':len(functions),'unexecutedFunctions':[],'uncoveredSpans':uncovered}
report={'status':'passed','frozenHead':FROZEN,'checks':checks,'receipts':receipts,'cold':cold,'attacksSha256':digest((OUT/'attacks.json').read_bytes()),'coverage':coverage,
 'waiver':'state.mjs:89 two fallback diagnostic strings apply only when trusted releaseStorage returns a malformed failure lacking code/message; verified store always returns both. Structured rejection and legitimate store-first disposal execute. No guest-selected state behavior waived.'}
(OUT/'audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':'passed','checks':len(checks),'coverage':coverage},indent=2))
