#!/usr/bin/env python3
"""Bind one frozen exact-head worker run to native, Wasm and physical evidence."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6m4a'
SEEDS = [1, 2, 3]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(yes, reason):
    if not yes:
        raise AssertionError(reason)


def read(path):
    return json.loads(path.read_bytes())


def main():
    out = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT),
            'freeze all tracked acceptance sources')
    source_names = ['Makefile', 'renderer/virgl-shader/raw_bits.c',
                    'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/build.sh',
                    'renderer/virgl-shader/native_tests/exact_reciprocal.c',
                    'renderer/virgl-shader/tests/exact-reciprocal.mjs',
                    'renderer/virgl-command/constant-domain.mjs',
                    'tools/verify-virgl-exact-reciprocal.sh',
                    'tools/lib/virgl-browser-runner.mjs',
                    'tasks/epic-6-transcendence/E6-T12g6m4a-exact-reciprocal.md',
                    'evidence/virgl-workload-inventory/captures/es2gears/shaders/c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f.tgsi']
    source_names += sorted(str(p.relative_to(ROOT)) for p in
                           (ROOT / 'tools/virgl-exact-reciprocal').glob('*')
                           if p.is_file() and p.suffix in ('.mjs', '.py'))
    sources = []
    for name in source_names:
        raw = (ROOT / name).read_bytes()
        require(raw == subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT),
                'exact-head source ' + name)
        sources.append({'path': name, 'bytes': len(raw), 'sha256': sha(raw)})
    native = read(out / 'native-wasm.json')
    require(native['status'] == 'passed' and native['gitHead'] == head and len(native['cases']) == 39,
            'complete native/Wasm parity and original source identities')
    require(len(native['bankAttacks']) == 24 and len(native['metadataAttacks']) == 96,
            'exact bank and strict metadata attacks')
    require(all(not c['exact']['ok'] for c in native['cases'] if c['mode'] == 'original'),
            'both full originals remain gated')
    require(native['originalProvenance']['capturedConst30Word'] == 0x40000000,
            'authored captured divisor')
    require(sha((out / 'inputs.bin').read_bytes()) == native['fixtureSha256'], 'native fixture')
    require(sha((ROOT / 'renderer/virgl-shader/build/exact-reciprocal-sanitize/exact-reciprocal-test').read_bytes())
            == native['binarySha256'], 'actual sanitized native binary')
    require(sha((ROOT / 'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())
            == native['wasmSha256'], 'actual built Wasm compiler')
    require(not (out / 'native.stderr').read_bytes(), 'no native sanitizer diagnostics')
    provenance = read(out / 'provenance.json')
    require(provenance['originalTextSha256'] == native['originalProvenance']['sourceSha256'] and
            provenance['draws'] == 2271 and provenance['uniqueConst30x'] == [0x40000000],
            'every captured draw independently binds the same exact divisor')
    prior = read(out / 'prior-exact-pair/receipt.json')
    require(prior['status'] == 'passed' and prior['gitHead'] == head and
            prior['nativeCases'] == 118 and prior['checkedFrames'] == 843 and
            prior['checkedPixels'] == 53952 and prior['checkedAttacks'] == 798,
            'unchanged complete paired compiler/renderer suite')
    captures = []
    for seed in SEEDS:
        browser = read(out / f'gpu-{seed}/report.json')
        check = read(out / f'capture-{seed}.json')
        require(browser['status'] == 'passed' and browser['gitHead'] == head and
                browser['acceptance']['seed'] == seed and not browser['trackedChanges'],
                f'frozen headed browser schedule {seed}')
        require(check['status'] == 'passed' and check['frames'] == 6 and
                check['checkedChannels'] == 384, f'independent pixels {seed}')
        image = browser['screenshot']
        require(sha((out / f'gpu-{seed}' / image['path']).read_bytes()) == image['sha256'],
                f'physical screenshot {seed}')
        captures.append({'seed': seed, 'frames': 6, 'channels': 384,
                         'reportSha256': sha((out / f'gpu-{seed}/report.json').read_bytes()),
                         'screenshotSha256': image['sha256']})
    fault = read(out / 'fault-shadow/report.json')
    fault_check = read(out / 'capture-fault.json')
    require(fault['status'] == 'failed' and fault['gitHead'] == head and not fault['trackedChanges'] and
            fault['acceptance']['frames'][1]['failure'] ==
            {'pixel': 0, 'lane': 0, 'actual': 64, 'wanted': 128},
            'altered compiler source contradicts actual Metal pixel')
    require(fault_check['status'] == 'passed' and fault_check['fault'] is True and
            fault_check['frames'] == 2, 'independent source fault custody')
    require('physical pixel' in (out / 'sabotage.log').read_text(), 'sabotaged pixel rejected')
    coverage = read(out / 'native-coverage.json')
    covered = {Path(f['filename']).name: f['summary']['lines']
               for f in coverage['data'][0]['files'] if Path(f['filename']).name in
               ('raw_bits.c', 'bridge.c', 'exact_reciprocal.c')}
    require(covered['exact_reciprocal.c']['percent'] == 100 and
            covered['raw_bits.c']['covered'] > 500 and covered['bridge.c']['covered'] > 900,
            'retained unfiltered native coverage')
    records = []
    for name in ['inputs.bin', 'native.stdout', 'native.profraw', 'native.profdata',
                 'native-coverage.json', 'native-wasm.json', 'provenance.json',
                 'prior-exact-pair/receipt.json', 'prior-exact-pair.log',
                 'capture-fault.json', 'fault-shadow/report.json',
                 'fault-shadow/failure.png', 'sabotaged.json', 'sabotage.log'] + [
                 f'gpu-{seed}/{leaf}' for seed in SEEDS for leaf in
                 ('report.json', 'browser.png', 'browser-coverage.json')] + [
                 f'capture-{seed}.json' for seed in SEEDS]:
        path = out / name
        raw = path.read_bytes()
        records.append({'path': name, 'bytes': len(raw), 'sha256': sha(raw)})
    result = {'schema': 'virgl-exact-reciprocal-worker-receipt-v1', 'task': TASK,
              'status': 'passed', 'gitHead': head, 'sources': sources, 'records': records,
              'nativeCases': 39, 'bankAttacks': 24, 'metadataAttacks': 96,
              'originalDraws': provenance['draws'], 'priorPairedFrames': prior['checkedFrames'],
              'priorPairedPixels': prior['checkedPixels'], 'captures': captures,
              'physicalFrames': 18, 'checkedChannels': 1152,
              'faultPixel': fault['acceptance']['frames'][1]['failure'],
              'coverageLines': covered, 'guestExecution': False,
              'productionNegotiation': False}
    (out / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'{TASK} exact-head receipt passed: 39 cases, 2271 capture draws, '
          '18 Metal frames, 1152 independent channels')


if __name__ == '__main__':
    main()
