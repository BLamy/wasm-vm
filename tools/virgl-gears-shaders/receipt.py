#!/usr/bin/env python3
"""Bind exact-head original shader hardware proof and unchanged leaf evidence."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASE = 'ee0277231f1903633881d803ba6153b58d31fd1c'
GENERATED = 'renderer/virgl-shader/build/'
SEEDS = [1648868771, 254715103, 3281536249]
LEAVES = [('E6-T12g1', 'guest-format-inventory', 'virgl-workload-inventory'),
          ('E6-T12g2', 'color-format-storage', 'virgl-color-formats'),
          ('E6-T12g3', 'depth-format-storage', 'virgl-depth-formats'),
          ('E6-T12g4', 'texture-view-specialization', 'virgl-texture-views'),
          ('E6-T12g5', 'inline-texture-uploads', 'virgl-inline-uploads')]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, label):
    if not value:
        raise ValueError(label)


def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    records, sources, inputs = {}, {}, {}

    def artifact(file, digest=None):
        raw = file.read_bytes()
        require(digest is None or sha(raw) == digest, f'artifact mismatch: {file}')
        name = str(file.relative_to(directory))
        records[name] = {'path': name, 'bytes': len(raw), 'sha256': sha(raw)}
        return raw

    def source(item):
        if item['path'] in sources:
            require(sources[item['path']]['sha256'] == item['sha256'] and
                    sources[item['path']]['bytes'] == item.get('size', item.get('bytes')), 'source table inconsistency')
            return
        file = ROOT / item['path']
        raw = file.read_bytes()
        require(sha(raw) == item['sha256'] and len(raw) == item.get('size', item.get('bytes')), f'source drift: {file}')
        if not item['path'].startswith(GENERATED):
            require(raw == subprocess.check_output(['git', 'show', f'{head}:{item["path"]}'], cwd=ROOT), f'unfrozen source: {file}')
        binding = {'path': item['path'], 'bytes': len(raw), 'sha256': sha(raw)}
        sources[item['path']] = binding

    def report(name, task='E6-T12g6a', passed=True):
        file = directory / name / 'report.json'
        value = json.loads(artifact(file))
        require(value['task'] == task and value['gitHead'] == head, 'report task or head')
        require(value['status'] == ('passed' if passed else 'failed'), 'report status')
        for item in value['sources']:
            source(item)
        require(value['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser emitted errors')
        browser = value['browser']
        require(browser['launch']['headless'] is False, 'physical browser required')
        require(browser['gpu']['featureStatus'][browser['webglFeature']] == 'enabled', 'hardware WebGL required')
        screen = value.get('screenshot') or value.get('failureScreenshot')
        require(screen, 'browser capture missing')
        artifact(file.parent / screen['path'], screen['sha256'])
        coverage = value['browserCoverage']
        counters = json.loads(artifact(file.parent / coverage['path'], coverage['sha256']))
        for script in counters['scripts']:
            require(script['sha256'] == sources[script['source']]['sha256'], 'coverage source hash')
        served = {e['path']: e for e in value['servedFiles']}
        for item in served.values():
            require(item['path'] in sources and sources[item['path']]['sha256'] == item['sha256'], 'served source binding')
        return value

    provenance = json.loads(artifact(directory / 'provenance.json'))
    require(provenance['gitHead'] == head and provenance['status'] == 'passed', 'authenticated G1 provenance head')
    for item in provenance['inputs']:
        source(item); inputs[item['path']] = item
    require(len(provenance['originals']) == 6 and len(provenance['retainedPartners']) == 1, 'six new sources plus retained partner')
    require([(e['sha256'][:8], e['citations'][0]['event'], e['citations'][0]['byteOffset']) for e in provenance['originals']] ==
            [('80a42bf3',5115,4136), ('86d0ee79',5115,5348), ('7bf4d0d0',5328,5608),
             ('92cb866a',5328,6224), ('c2474531',5328,47556), ('c5806d5f',5328,48868)], 'literal original packet citations')
    compiler = json.loads(artifact(directory / 'compiler.json'))
    require(compiler['gitHead'] == head and compiler['status'] == 'passed', 'native/wasm compiler proof head')
    require([e['result']['ok'] for e in compiler['originals']] == [True,True,True,False,True,False,True], 'original admission partition')
    require([e['result']['ok'] for e in compiler['pairs']] == [True,True,True,False,False], 'original program rejection partition')
    total_words, total_pixels = 0, 0
    for seed in SEEDS:
        recorded = report('gpu-' + str(seed))
        require(recorded['provenance']['sha256'] == records['provenance.json']['sha256'], 'same source packet provenance')
        result = recorded['acceptance']
        require(result['seed'] == seed and result['productionNegotiation'] is False, 'isolated seed boundary')
        require(result['checkedVertexWords'] == 864 and result['checkedPixels'] == 9216, 'all physical comparisons present')
        require([e['pairKind'] for e in result['vertices']] == ['captured-program','compatible-isolation'], 'vertex probe scopes')
        require([e['pairKind'] for e in result['fragments']] == ['captured-program','captured-program'], 'actual original fragment programs')
        require(result['originalPrograms'] == provenance['pairs'], 'actual original bindings retained')
        require(len(result['rejectedPrograms']) == 2 and all(not e['result']['ok'] for e in result['rejectedPrograms']), 'unsupported complete programs rejected')
        require(result['objects']['live'] == 0 and result['objects']['actualDeleted'] == result['objects']['created'], 'physical object disposal')
        for vertex in result['vertices']:
            require(len(vertex['vectors']) == 48, 'varied original vertex inputs')
            for vector in vertex['vectors']:
                raw = bytes(vector['bytes']); require(sha(raw) == vector['sha256'], 'physical feedback digest')
                require(vector['observed'] == [int.from_bytes(raw[i:i+4], 'little') for i in range(0,len(raw),4)], 'physical feedback words')
                for check in vector['checks']:
                    require(check['actual'] == vector['observed'][check['lane']], 'comparison names physical lane')
                    require((check['actual'] == check['expected']) if check['budget'] == 0 else check['ulp'] <= check['budget'], 'written output comparison failed')
        for fragment in result['fragments']:
            for draw in fragment['draws']:
                raw = bytes(draw['rgbaBytes']); require(sha(raw) == draw['rgbaSha256'] and len(raw) == 1024, 'raw physical fragment digest')
                require(draw['checkedPixels'] == 256, 'every actual pixel compared')
                require(all(abs(value-draw['expected'][i%4]) <= draw['pixelBudget'] for i,value in enumerate(raw)), 'physical fragment comparison failed')
        total_words += result['checkedVertexWords']; total_pixels += result['checkedPixels']
    faults = {'lighting':'vertex mismatch 80a42bf3', 'auxiliary':'vertex mismatch 7bf4d0d0', 'forced-alpha':'fragment mismatch c2474531'}
    for mode, message in faults.items():
        bad = report('fault-' + mode, passed=False)['acceptance']
        require(bad['status'] == 'failed' and message in bad['failure']['message'], 'fault must reach independent physical oracle')
        require(len(bad['mutations']) == 1, 'one numerical output fault')
        mutation = bad['mutations'][0]
        require(sha(mutation['source'].encode()) == mutation['sourceSha256'] and
                sha(mutation['served'].encode()) == mutation['servedSha256'] and
                mutation['sourceSha256'] != mutation['servedSha256'], 'actual emitted source mutation')
    old = report('retained-f6', 'E6-T12f6')['acceptance']
    require(len(old['originals']) == 19 and len(old['pairs']) == 88 and sum(e['ok'] for e in old['pairs']) == 57,
            'unchanged F6 original numerical suite')
    carried = []
    for task, suffix, evidence in LEAVES:
        file = ROOT / f'tasks/epic-6-transcendence/{task}-{suffix}.md'
        source({'path': str(file.relative_to(ROOT)), 'bytes': file.stat().st_size, 'sha256': sha(file.read_bytes())})
        require('\nstatus: verified\n' in file.read_text(), 'leaf must remain independently verified')
        manifest_file = ROOT / f'evidence/{evidence}/worker/manifest.json'
        manifest = json.loads(manifest_file.read_bytes())
        for file in [manifest_file, manifest_file.parent / 'records.json', manifest_file.parent / manifest['archive']['path']]:
            source({'path': str(file.relative_to(ROOT)), 'bytes': file.stat().st_size, 'sha256': sha(file.read_bytes())})
        require(sha((manifest_file.parent / manifest['archive']['path']).read_bytes()) == manifest['archive']['sha256'], 'unchanged leaf archive')
        carried.append({'task': task, 'manifestSha256': sha(manifest_file.read_bytes()), 'archiveSha256': manifest['archive']['sha256']})
    # Runtime files at the last verified leaf are unchanged. This task adds
    # harnesses only; preserve their prior HELD results instead of rerunning walls.
    runtime = subprocess.check_output(['git','ls-tree','-r','--name-only',BASE,'renderer/virgl-shader','renderer/virgl-command'], cwd=ROOT, text=True).splitlines()
    unchanged = []
    for file in runtime:
        if '/tests/' in file or '/native_tests/' in file or not file.endswith(('.c','.h','.mjs')):
            continue
        raw = (ROOT / file).read_bytes()
        require(raw == subprocess.check_output(['git','show',f'{BASE}:{file}'], cwd=ROOT), f'carried runtime changed: {file}')
        unchanged.append({'path':file,'bytes':len(raw),'sha256':sha(raw)})
    receipt = {'schema':1,'task':'E6-T12g6a','status':'passed','gitHead':head,'guestExecution':False,'productionNegotiation':False,
               'seeds':SEEDS,'checkedVertexWords':total_words,'checkedPixels':total_pixels,'physicalOutputFaults':list(faults),
               'originalPrograms':provenance['pairs'],'carriedLeaves':carried,'unchangedRuntimeBase':BASE,'unchangedRuntime':unchanged,
               'sources':list(sources.values()),'inputs':list(inputs.values()),'records':list(records.values())}
    (directory / 'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(f'E6-T12g6a receipt passed: {total_words} written words and {total_pixels} raw physical pixels')


if __name__ == '__main__':
    main()
