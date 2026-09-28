from pathlib import Path
import hashlib, json, os, re, subprocess, time

root = Path(__file__).resolve().parent
repo = root.parents[2]
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
runtime = json.loads((root / 'frozen.json').read_text())['head']
expected = json.loads((root / 'frozen.json').read_text())['wasmSha256']
paths = ['crates/core/src/jit.rs', 'crates/jit-translate/src/lib.rs',
         'crates/jit-runtime/src/lib.rs', 'crates/wasm/src/jit_browser.rs']
def read(name): return json.loads((root / name).read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def git(*args): return subprocess.check_output(['git', *args], cwd=repo, env=env)
head = git('rev-parse', 'HEAD').decode().strip()
assert git('diff', runtime, 'HEAD', '--', *paths) == b''
assert git('diff', 'HEAD', '--', *paths) == b''
affected, ci, cold = [read(name) for name in
                      ['affected-commands.json', 'ci-commands.json', 'cold/report.json']]
assert affected['head'] == runtime and affected['allPassed']
assert all(row['code'] == 0 for row in affected['commands'])
assert cold['passed'] and cold['pristineBeforeBuild']
assert all(row['code'] == 0 for row in cold['commands'])
assert expected == sha(repo / 'web/dist/pkg/wasm_vm_wasm_bg.wasm')
assert cold['committedWasmSha256'] == cold['rebuiltWasmSha256'] == expected
for path in ['browser/report.json', 'cold/browser/report.json']:
    report = read(path)
    assert report['passed'] and not report['errors']
    assert report['wasmSha256'] == expected
    assert report['suite'] == {'metric-pass': '127', 'metric-fail': '0', 'metric-done': '127'}
public = read('cloudflare-public.json')
assert len(public) == 8 and all(row['status'] == 200 and row['sha256'] == row['expectedSha256'] for row in public)
physical = read('physical-summary.json')
assert physical['wasmSha256'] == expected
assert physical['keyboard']['readbackTimeoutMs'] == 120000
assert all(row['identical'] for row in read('unchanged-boundaries.json'))
counts = {}
for label in ['core-handoff', 'fp-regression', 'native-fp-isa', 'wasm-native-lib', 'acceptance']:
    results = re.findall(r'test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored',
                         (root / (label + '.log')).read_text())
    assert results and all(row[0] == 'ok' and int(row[2]) == 0 for row in results)
    counts[label] = {'targets': len(results), 'passed': sum(int(row[1]) for row in results),
                     'failed': sum(int(row[2]) for row in results), 'ignored': sum(int(row[3]) for row in results)}
receipt = {'submissionSourceHead': head, 'runtimeSourceHead': runtime,
           'artifactHead': runtime, 'coldHead': cold['head'], 'runtimeWasmSha256': expected,
           'runtimeFiles': {path: sha(repo / path) for path in paths},
           'focusedAcceptancePassed': True, 'coldClonePassed': True,
           'publicBytesMatched': True, 'broadCiPassed': ci['allPassed'],
           'desktopResponsive': physical['responsive'], 'completedTests': counts,
           'sealedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
           'notes': ['Full make ci outcomes remain recorded without relabeling failures.',
                     'Physical desktop acceptance is separate from instruction correctness.']}
(root / 'submission.json').write_text(json.dumps(receipt, indent=2) + '\n')
entries = [(sha(path), str(path.relative_to(root))) for path in sorted(root.rglob('*'))
           if path.is_file() and path.name != 'sha256.txt']
(root / 'sha256.txt').write_text(''.join(digest + '  ' + name + '\n' for digest, name in entries))
assert all(sha(root / name) == digest for digest, name in entries)
print(json.dumps({'files': len(entries), 'indexSha256': sha(root / 'sha256.txt'), 'submission': receipt}, indent=2))
