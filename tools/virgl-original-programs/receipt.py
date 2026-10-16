"""Bind exact-head full-body acceptance, source mutations and held regressions."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TASK = 'E6-T12g6m'
FAULTS = ['source', 'bank', 'negative', 'nonfinite', 'geometry', 'zero-crossing',
          'post-source', 'post-bank', 'post-geometry', 'post-parsed-bank',
          'post-parsed-quad', 'post-sample', 'viewport', 'post-bound-exponent',
          'post-bound-vertex', 'post-bound-attribute', 'post-bound-color',
          'post-buffer-exponent', 'post-clear-exponent', 'output', 'discard',
          'power-value', 'power-negative', 'power-subnormal', 'power-nan',
          'power-zero', 'power-envelope']
SOURCES = ['Makefile', 'renderer/virgl-shader/bridge.c', 'renderer/virgl-shader/bridge.h',
           'renderer/virgl-shader/raw_bits.c', 'renderer/virgl-shader/raw_bits.h',
           'renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build.sh',
           'renderer/virgl-shader/private_92cb_inputs.h',
           'renderer/virgl-shader/native_tests/original_92cb_complete.c',
           'renderer/virgl-shader/tests/original-programs.mjs',
           'renderer/virgl-shader/tests/original-programs-worker.mjs',
           'tools/verify-virgl-original-programs.sh',
           'tasks/epic-6-transcendence/E6-T12g6m-larger-original-programs.md']
GENERATED = ['renderer/virgl-shader/build/original-92cb-complete-sanitize/original-92cb-complete-test',
             'renderer/virgl-shader/build/original-92cb-complete-wasm/original-92cb-complete.js',
             'renderer/virgl-shader/build/original-92cb-complete-wasm/original-92cb-complete.wasm',
             'renderer/virgl-shader/build/wasm/virgl-shader.mjs',
             'renderer/virgl-shader/build/wasm/virgl-shader.wasm',
             'renderer/virgl-shader/build/native/virgl-shader',
             'renderer/virgl-shader/build/original-corpus-sanitize/original-corpus-test',
             'renderer/virgl-shader/build/original-c580-sanitize/original-c580-test',
             'renderer/virgl-shader/build/original-c580-wasm/original-c580.js',
             'renderer/virgl-shader/build/original-c580-wasm/original-c580.wasm']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main(directory):
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT, text=True).strip()
    report = json.loads((directory / 'browser/report.json').read_text())
    assert report['gitHead'] == head and report['trackedChanges'] == []
    assert report['status'] == 'passed' and report['task'] == TASK
    audit = json.loads((directory / 'physical-audit.json').read_text())
    assert audit['gitHead'] == head and audit['status'] == 'passed'
    assert audit['pixels'] == 1612644 and audit['powerSites'] == 29 and audit['guardCases'] == 22
    interfaces = json.loads((directory / 'interfaces.json').read_text())
    assert interfaces['status'] == 'passed' and len(interfaces['seeds']) == 3
    assert len(interfaces['allocations']) == 4 and all(row['remaining'] == 0 for row in interfaces['allocations'])
    for fault in FAULTS:
        failed = json.loads((directory / f'fault-{fault}/report.json').read_text())
        assert failed['status'] == 'failed' and failed['gitHead'] == head
        assert failed['trackedChanges'] == [] and failed['browserErrors'] == {'console': [], 'page': [], 'requests': []}
        message = failed['failure']['message']
        if fault in ['power-negative', 'power-subnormal', 'power-nan', 'power-zero', 'power-envelope']:
            assert f'checked invocation domain rejected {fault}' in message
        else:
            assert 'Error:' in message and 'timeout' not in message.lower()
    for seed in [1648868771, 254715103, 3281536249]:
        held = json.loads((directory / f'retained-gears/gpu-{seed}/report.json').read_text())
        assert held['gitHead'] == head and held['status'] == 'passed'
        assert held['browserErrors'] == {'console': [], 'page': [], 'requests': []}
    for fault in ['lighting', 'auxiliary', 'forced-alpha']:
        held = json.loads((directory / f'retained-gears/fault-{fault}/report.json').read_text())
        assert held['gitHead'] == head and held['status'] == 'failed'
        assert 'independent' in held['failure']['message'] and 'timeout' not in held['failure']['message'].lower()
    for name in ['retained-gears/retained-f6/report.json', 'c580/receipt.json']:
        held = json.loads((directory / name).read_text())
        assert held['gitHead'] == head and held['status'] == 'passed'
    assert sha((directory / 'browser/browser.png').read_bytes()) == report['screenshot']['sha256']
    for item in report['servedFiles']:
        assert sha((ROOT / item['path']).read_bytes()) == item['sha256']
    sources = SOURCES + [p.relative_to(ROOT).as_posix() for p in (ROOT / 'tools/virgl-original-programs').glob('*')
                         if p.suffix in ['.py', '.mjs', '.md']]
    originals = ROOT / 'evidence/virgl-workload-inventory/captures/es2gears/shaders'
    sources += [p.relative_to(ROOT).as_posix() for p in originals.glob('*.tgsi')
                if p.stem.startswith(('7bf4d0d0', '92cb866a', '403b0529', 'c5806d5f'))]
    files = {p.relative_to(directory).as_posix(): sha(p.read_bytes()) for p in directory.rglob('*')
             if p.is_file() and p.name != 'receipt.json'}
    # Include nested original receipts, which are records, not this receipt itself.
    for name in ['c580/receipt.json']:
        files[name] = sha((directory / name).read_bytes())
    result = {'schema': 'virgl-original-programs-receipt-v1', 'task': TASK,
              'status': 'passed', 'gitHead': head, 'pixels': 1612644, 'powerSites': 29,
              'guardCases': 22, 'faults': len(FAULTS), 'guestExecution': False,
              'productionDrawAuthority': False, 'files': files,
              'sources': {name: sha((ROOT / name).read_bytes()) for name in sources},
              'generated': {name: sha((ROOT / name).read_bytes()) for name in GENERATED}}
    (directory / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Exact-head full original bodies, all live power sites, held originals and 27 faults bound.')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
