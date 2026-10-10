#!/usr/bin/env python3
"""Make the new replay guard fail on real corrupted native output; attack receipt checks."""
from pathlib import Path
import copy, hashlib, json, runpy, subprocess, sys

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
RAW = ROOT / 'target/evidence/virgl-known-arithmetic-critic-supplement'
UNPACKED = RAW / 'unpacked/hot'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def main():
    predictions = dict(schema='virgl-known-arithmetic-incremental-guard-attack-predictions-v1',
                       faults=[dict(name='word', mutation='first public raw_rhs.x literal 1069547520 -> 1069547521',
                                    expected='native executable succeeds but supplement.mjs literal word guard fails before profile export'),
                               dict(name='shadow', mutation='both duplicate first-public known:shadow uintBitsToFloat(1069547520) -> (1069547521)',
                                    expected='native executable succeeds but supplement.mjs literal shadow guard fails before profile export'),
                               dict(name='metadata', mutation='valid both-operation wrapper operations [ADD,MUL] -> [MUL,ADD]',
                                    expected='original parseConstantDomain rejects and supplement.mjs approval assertion fails')],
                       receipt='matching positive receipt passes; executable mismatch, every zero/missing native/V8 range, count/rounding cardinality and stale head/status/task fail')
    (OUT / 'guard-attack-predictions-2.json').write_text(json.dumps(predictions, indent=2) + '\n')
    faults = []
    script = ROOT / 'tools/virgl-known-arithmetic/supplement.mjs'
    original = UNPACKED / 'original/known-test'
    wasm = UNPACKED / 'original/virgl-shader.mjs'
    for kind, before, after in [
            ('word', b'/* known:word */ raw_rhs.x = 1069547520u;', b'/* known:word */ raw_rhs.x = 1069547521u;'),
            ('shadow', b'/* known:shadow */ uintBitsToFloat(1069547520u)', b'/* known:shadow */ uintBitsToFloat(1069547521u)')]:
        wrapper = RAW / ('fault-' + kind + '-native.py')
        source = ('#!/usr/bin/env python3\nimport os, subprocess, sys\n'
                  f'original = {str(original)!r}\n'
                  'run = subprocess.run([original], input=sys.stdin.buffer.read(), capture_output=True, env=os.environ)\n'
                  'assert run.returncode == 0 and not run.stderr\n'
                  f'before, after = {before!r}, {after!r}\n'
                  'assert run.stdout.count(before) > 0\n'
                  f'sys.stdout.buffer.write(run.stdout.replace(before, after, {1 if kind == "word" else 2}))\n'
                  'sys.stderr.buffer.write(run.stderr)\n').encode()
        wrapper.write_bytes(source)
        wrapper.chmod(0o755)
        directory = RAW / ('fault-' + kind + '-final')
        assert not directory.exists()
        run = subprocess.run(['node', str(script), str(wrapper), str(wasm), str(directory)],
                             cwd=ROOT, capture_output=True)
        (RAW / ('fault-' + kind + '-final-guard.stdout')).write_bytes(run.stdout)
        (RAW / ('fault-' + kind + '-final-guard.stderr')).write_bytes(run.stderr)
        assert run.returncode != 0 and b'AssertionError' in run.stderr
        expected_line = b'supplement.mjs:82:' if kind == 'word' else b'supplement.mjs:83:'
        assert expected_line in run.stderr, run.stderr.decode()
        assert (directory / 'native.log').read_text().endswith('STATUS passed\n')
        assert not (directory / 'native.stderr').read_bytes()
        assert not (directory / 'coverage.json').exists(), 'fault caught at literal assertion'
        faults.append(dict(name=kind, exit=run.returncode, originalNativeStatus='passed',
                           nativeSanitizerErrors=0, outputDirectory=str(directory.relative_to(ROOT)),
                           wrapperSourceSha256=sha(source), point='tools/virgl-known-arithmetic/supplement.mjs:' + ('82' if kind == 'word' else '83'),
                           stderrSha256=sha(run.stderr), stdoutSha256=sha(run.stdout)))
    native = json.loads((UNPACKED / 'native.json').read_bytes())
    bad = copy.deepcopy(native)
    both = next(c for c in bad['cases'] if c['name'] == 'both-operation-wrapper')
    both['result']['metadata']['knownArithmeticContract']['operations'] = ['MUL', 'ADD']
    file = RAW / 'fault-metadata.json'
    file.write_text(json.dumps(bad, indent=2) + '\n')
    run = subprocess.run(['node', str(script), '--consumer', str(file), str(RAW / 'fault-metadata-consumer.json')],
                         cwd=ROOT, capture_output=True)
    (RAW / 'fault-metadata-guard.stdout').write_bytes(run.stdout)
    (RAW / 'fault-metadata-guard.stderr').write_bytes(run.stderr)
    assert run.returncode != 0 and b'AssertionError' in run.stderr and b'both-operation-wrapper' in run.stderr
    assert not (RAW / 'fault-metadata-consumer.json').exists()
    faults.append(dict(name='metadata', exit=run.returncode, stderrSha256=sha(run.stderr),
                       inputSha256=sha(file.read_bytes()), point='tools/virgl-known-arithmetic/supplement.mjs:22'))
    receipt_path = ROOT / 'tools/virgl-known-arithmetic/receipt.py'
    executed = set()
    def trace(frame, event, arg):
        if event == 'line' and frame.f_code.co_filename == str(receipt_path):
            executed.add(frame.f_lineno)
        return trace
    sys.settrace(trace)
    module = runpy.run_path(str(receipt_path), run_name='critic_receipt_module')
    check = module['check_supplement']
    report = json.loads((RAW / 'guard-replay/report.json').read_bytes())
    matching = dict(binary=dict(sha256=report['binary']['sha256']))
    check(report, matching)
    receipt_results = [dict(name='positive', status='HELD')]
    mutations = [('binary-mismatch', lambda r: r['binary'].update(sha256='0' * 64)),
                 ('wrong-word-count', lambda r: r.update(arithmeticPredictions=1)),
                 ('wrong-rounding-count', lambda r: r.update(hostRoundingModes=3)),
                 ('wrong-public-count', lambda r: r.update(publicSinglesPairs=3)),
                 ('missing-native-region', lambda r: r['nativeRegions'].pop()),
                 ('missing-v8-range', lambda r: r['v8Regions'].pop())]
    for i in range(5):
        mutations.append((f'zero-native-{i}', lambda r, i=i: r['nativeRegions'][i]['region'].__setitem__(4, 0)))
    for i in range(2):
        mutations.append((f'zero-v8-{i}', lambda r, i=i: r['v8Regions'][i].__setitem__('count', 0)))
    for name, mutate in mutations:
        bad = copy.deepcopy(report)
        mutate(bad)
        try:
            check(bad, matching)
        except ValueError as e:
            receipt_results.append(dict(name=name, status='HELD', rejection=str(e)))
        else:
            raise AssertionError(name + ' accepted')
    sys.settrace(None)
    for name, key, value in [('stale-head', 'gitHead', 'cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee'),
                              ('failed-status', 'status', 'failed'), ('wrong-task', 'task', 'E6-T12g6l')]:
        bad = copy.deepcopy(report)
        bad[key] = value
        file = RAW / (name + '-receipt.json')
        file.write_text(json.dumps(bad, indent=2) + '\n')
        matchfile = RAW / 'matching-native.json'
        matchfile.write_text(json.dumps(matching) + '\n')
        run = subprocess.run(['python3', str(receipt_path), '--supplement', str(file), str(matchfile)],
                             cwd=ROOT, capture_output=True)
        assert run.returncode != 0 and b'exact supplemental report' in run.stderr
        (RAW / (name + '-receipt.stderr')).write_bytes(run.stderr)
        receipt_results.append(dict(name=name, status='HELD', exit=run.returncode, stderrSha256=sha(run.stderr)))
    replay = json.loads((RAW / 'guard-replay/report.json').read_bytes())
    result = dict(schema='virgl-known-arithmetic-incremental-guard-attacks-v1', status='passed',
                  predictionsSha256=sha((OUT / 'guard-attack-predictions-2.json').read_bytes()),
                  positiveReplay=dict(reportSha256=sha((RAW / 'guard-replay/report.json').read_bytes()),
                                      binarySha256=replay['binary']['sha256'],
                                      llvmCounts=[p['region'][4] for p in replay['nativeRegions']],
                                      v8Counts=[p['count'] for p in replay['v8Regions']]),
                  actualOutputFaults=faults, receiptResults=receipt_results,
                  touchedReceiptExecutedLines=sorted(executed), runtimeMutation=False)
    (OUT / 'guard-attacks.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Original-binary guard replay passes; actual native word/shadow corruption and forged consumer metadata fail; 16 negative receipts reject.')

if __name__ == '__main__':
    main()
