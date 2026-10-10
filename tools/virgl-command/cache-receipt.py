#!/usr/bin/env python3
"""Authenticate frozen cache gates and independently check every physical toggle pixel."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
GENERATED = {'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
             'renderer/virgl-shader/build/wasm/virgl-shader.wasm'}
FAULTS = {'blend-key': 'blend toggle 1 literal physical pixels',
          'translation-text': 'pressure shader 0 literal physical pixels'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def need(condition, reason):
    if not condition:
        raise ValueError(reason)


def main(directory):
    directory = Path(directory).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    files, sources, generated = {}, {}, {}

    def record(path, expected=None):
        raw = path.read_bytes()
        digest = sha(raw)
        need(expected is None or expected == digest, 'record drift: ' + str(path))
        files[path.relative_to(directory).as_posix()] = digest
        return raw

    def source(name, expected):
        raw = (ROOT / name).read_bytes()
        need(sha(raw) == expected, 'source drift: ' + name)
        selected = generated if name in GENERATED else sources
        need(name not in selected or selected[name] == expected, 'inconsistent source: ' + name)
        selected[name] = expected
        if name not in GENERATED:
            need(subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT) == raw,
                 'source not frozen at HEAD: ' + name)

    def physical(name, mode=None, passed=True):
        at = directory / name
        report = json.loads(record(at / 'report.json'))
        need(report['gitHead'] == head and report['task'] == 'E6-T12i', 'wrong cache head/task')
        need(report['status'] == ('passed' if passed else 'failed'), 'wrong cache status: ' + name)
        for item in report['sources']:
            source(item['path'], item['sha256'])
            need((ROOT / item['path']).stat().st_size == item['bytes'], 'source extent changed')
        need(report['native']['status'] == 'passed' and len(report['native']['assertions']) == 33
             and all(x['held'] for x in report['native']['assertions']), 'native exact-key guards failed')
        need(report['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'browser errors')
        browser = report['browser']
        need(browser['headless'] is False, 'headless physical cache proof')
        status = browser['gpu']['featureStatus']
        need(status.get('webgl2', status.get('webgl')) == 'enabled', 'physical WebGL disabled')
        need(not any(any(word in arg.lower() for word in ['swiftshader', 'llvmpipe', 'softpipe', 'lavapipe'])
                     or arg.startswith('--disable-gpu') for arg in browser['commandLine']), 'software GPU flags')
        record(at / report['screenshot']['path'], report['screenshot']['sha256'])
        coverage = json.loads(record(at / report['browserCoverage']['path'], report['browserCoverage']['sha256']))
        mutation = report.get('mutation', {})
        need(mutation.get('mode') == mode, 'wrong source mutation')
        if mode:
            original = (ROOT / mutation['path']).read_bytes()
            changed = record(at / 'mutation-source.mjs', mutation['servedSha256'])
            need(sha(original) == mutation['originalSha256'] and sha(original) != sha(changed), 'mutation has no changed source')
            needle, replacement = mutation['needle'].encode(), mutation['replacement'].encode()
            need(original.count(needle) == 1 and original.replace(needle, replacement) == changed, 'wrong mutation bytes')
        served = {item['path']: item for item in report['servedFiles']}
        for item in report['sources']:
            key = '/' + item['path']
            if key in served:
                expected = mutation['servedSha256'] if item['path'] == mutation.get('path') else item['sha256']
                need(served[key]['sha256'] == expected, 'served source mismatch')
        need({s['source'] for s in coverage['scripts']} ==
             {f'renderer/virgl-command/{name}.mjs' for name in ['resources', 'decoder', 'state', 'cache']}, 'missing runtime coverage')
        for item in coverage['scripts']:
            expected = mutation['servedSha256'] if item['source'] == mutation.get('path') else sources[item['source']]
            need(item['sha256'] == expected and served['/' + item['source']]['sha256'] == expected, 'coverage source mismatch')
        need(report['browserResult']['status'] == ('passed' if passed else 'failed'), 'wrong physical status')
        if not passed:
            need(FAULTS[mode] in report['browserResult']['error']['message'], 'unrelated failure counted as sensitivity')
            return report
        result = report['browserResult']['result']
        need(result['status'] == 'passed' and result['guestExecution'] is False and result['productionNegotiation'] is False, 'wrong authority')
        need(all(x['held'] for x in result['assertions']) and len(result['assertions']) > 21000, 'physical predicates failed')
        need(report['native']['assertions'] == report['browserResult']['native']['assertions'], 'native/browser predicates disagree')
        pixels = record(at / report['physicalPixels']['path'], report['physicalPixels']['sha256'])
        need(len(pixels) == report['physicalPixels']['bytes'] == 10000 * 1024, 'wrong physical pixel extent')
        patterns = [bytes([255, 0, 0, 64]) * 256, bytes([64, 0, 191, 255]) * 256]
        for draw in range(10000):
            need(pixels[draw * 1024:(draw + 1) * 1024] == patterns[draw % 2], f'independent physical mismatch at draw {draw}')
        toggles = result['toggles']
        need(toggles['draws'] == 10000 and toggles['checkedPixels'] == 2560000 and len(toggles['calls']) == 10000, 'missing actual draws')
        need(all(call['op'] == 'drawArrays' and call['args'] == [5, 0, 4]
                 and call['blend'] == bool(i % 2) for i, call in enumerate(toggles['calls'])), 'native draws/state do not match pixel stream')
        need(toggles['rawSha256'] == sha(pixels), 'browser and receipt pixel custody differ')
        need(toggles['baseline']['work']['programLinks'] == toggles['final']['work']['programLinks'], 'unexpected warm relink')
        pressure = result['pressure']
        need(pressure['final']['caches']['program']['evictions'] > 8 and pressure['final']['caches']['state']['evictions'] > 0
             and pressure['final']['caches']['translation']['evictions'] > 0, 'pressure eviction missing')
        need([f['number'] for f in pressure['frames']] == [42, 43] and all(f['complete'] for f in pressure['frames']), 'complete owned captures missing')
        need(result['diagnostics']['dump']['complete'] is False and result['diagnostics']['dump']['end']['work']['draws']
             - result['diagnostics']['dump']['start']['work']['draws'] == 100, 'overflow hides actual draws')
        need(len(result['ownership']['cycles']) == 20, 'context lifecycle pressure missing')
        need([j['delay'] for j in result['jobs']] == [0, 1, 3] and all(j['dump']['outcomes'][0]['gpuComplete'] for j in result['jobs']), 'owned job completion missing')
        for snapshot in [toggles['baseline'], toggles['final'], pressure['final'], result['ownership']['final'],
                         result['diagnostics']['final'], *pressure['observations'], *result['ownership']['cycles'],
                         *[j['final'] for j in result['jobs']]]:
            for cache in snapshot['caches'].values():
                need(cache['requests'] == cache['hits'] + cache['misses'] and cache['entries'] <= cache['limits']['entries']
                     and cache['bytes'] <= cache['limits']['bytes'], 'denominator or residency violated')
        if mode == 'hash-collision':
            need(pressure['final']['caches']['program']['collisions'] > 0, 'forced hash collision did not execute')
        return report

    good = physical('hardware')
    collision = physical('hash-collision', 'hash-collision')
    need(good['physicalPixels']['sha256'] == collision['physicalPixels']['sha256'], 'collisions changed physical pixels')
    for mode in FAULTS:
        physical('fault-' + mode, mode, False)
    held = json.loads(record(directory / 'regression/receipt.json'))
    need(held['task'] == 'E6-T12h' and held['status'] == 'passed' and held['gitHead'] == head, 'affected H gates failed')
    for name, digest in held['sources'].items():
        source(name, digest)
    for name, digest in held['generated'].items():
        source(name, digest)
    for name, digest in held['files'].items():
        record(directory / 'regression' / name, digest)
    promoted = json.loads(record(directory / 'promoted-rgb/report.json'))
    need(promoted['status'] == 'passed' and promoted['gitHead'] == head and promoted['result']['status'] == 'passed'
         and all(x['held'] for x in promoted['result']['assertions']) and len(promoted['result']['assertions']) >= 346,
         'promoted H RGB/schedule boundary failed')
    need(promoted['browserErrors'] == {'console': [], 'page': [], 'requests': []}, 'promoted browser errors')
    for item in promoted['sources']:
        source(item['path'], item['sha256'])
    record(directory / 'promoted-rgb/browser-coverage.json', promoted['coverageSha256'])
    record(directory / 'promoted-rgb/browser.png', promoted['screenshotSha256'])
    for name in ['tools/verify-virgl-render-cache.sh', 'tools/virgl-command/cache-receipt.py',
                 'tools/virgl-command/cache-cold.py', 'tools/virgl-command/cache-seal.py',
                 'tools/virgl-command/cache-README.md', 'renderer/virgl-command/cache-README.md',
                 'tasks/epic-6-transcendence/E6-T12i-bounded-render-cache.md']:
        source(name, sha((ROOT / name).read_bytes()))
    receipt = {'schema': 'virgl-render-cache-receipt-v1', 'task': 'E6-T12i', 'status': 'passed', 'gitHead': head,
               'guestExecution': False, 'productionNegotiation': False, 'authority': 'isolated-bounded-render-caches',
               'nativeAssertions': 33, 'hardwareAssertions': len(good['browserResult']['result']['assertions']),
               'originalToggleDraws': 10000, 'physicalPixels': 2560000, 'hashCollisionSurvived': True,
               'sourceFaultsRejected': list(FAULTS), 'sources': sources, 'generated': generated, 'files': files}
    (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print('E6-T12i receipt passed: all10000 recorded draws have exact independent pixels; pressure, owners, dumps and jobs hold')


if __name__ == '__main__':
    main(sys.argv[1])
