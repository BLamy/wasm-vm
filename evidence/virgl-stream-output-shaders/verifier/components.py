"""Narrow native predicate supplement for original component/destination layouts."""
import hashlib
import io
import json
import os
import struct
import subprocess
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / 'native-components'
SOURCE = '31bf0781db74fea94f51c9d6fa3217d16227bc99'
BUILD = REPO / 'target/evidence/d65-critic-component-source'
sha = lambda b: hashlib.sha256(b).hexdigest()
OUT.mkdir(exist_ok=True)
archive = subprocess.check_output(['git', 'archive', SOURCE, 'renderer/virgl-shader'], cwd=REPO)
(OUT / 'source.tar').write_bytes(archive)
with tarfile.open(fileobj=io.BytesIO(archive)) as source:
    for member in source:
        assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
        target = BUILD / member.name
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            assert member.isfile()
            body = source.extractfile(member).read()
            assert body == subprocess.check_output(['git', 'show', SOURCE + ':' + member.name], cwd=REPO)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            target.chmod(member.mode & 0o777)
partial = 'VERT\nDCL CONST[0..1]\nDCL OUT[0], POSITION\nDCL OUT[31].xy, GENERIC[0]\n0: MOV OUT[0], CONST[0]\n1: MOV OUT[31].xy, CONST[1]\n2: END\n'
full = partial.replace('OUT[31].xy, GENERIC', 'OUT[31], GENERIC').replace('MOV OUT[31].xy', 'MOV OUT[31]')
entry = lambda reg, first, size, buffer, dest: [(reg | first << 8 | size << 10 | buffer << 13 | dest << 16), 0]
cases = [
    dict(name='declared-xy-capture-xy', kind=0, capture=3, words=[1, 0, 0, 0, 3, *entry(31, 0, 2, 3, 1)], a=partial, b='', expectedError=None),
    dict(name='declared-xy-capture-z-refused', kind=0, capture=3, words=[1, 0, 0, 0, 3, *entry(31, 2, 1, 3, 1)], a=partial, b='', expectedError='unsupported-feature'),
    dict(name='reversed-disjoint-destination-order', kind=0, capture=3, words=[2, 0, 0, 0, 64, *entry(31, 3, 1, 3, 63), *entry(31, 0, 1, 3, 7)], a=full, b='', expectedError=None),
]
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')
number = lambda n: struct.pack('<I', n)
text = lambda s: number(len(s.encode())) + s.encode()
wire = number(len(cases))
for case in cases:
    wire += b''.join(number(n) for n in [case['kind'], case['capture'], len(case['words']), 0, *([0] * 7)])
    wire += text(case['a']) + text(case['b']) + b''.join(number(n) for n in case['words'])
(OUT / 'cases.bin').write_bytes(wire)
env = {k: v for k, v in os.environ.items() if k not in ['CC', 'CXX', 'CFLAGS', 'CXXFLAGS', 'LDFLAGS', 'RUSTFLAGS', 'RUST_LOG', 'EMCC', 'LLVM_PROFILE_FILE'] and not k.startswith('CARGO_')}
env.update(ASAN_OPTIONS='abort_on_error=1', UBSAN_OPTIONS='halt_on_error=1', LLVM_PROFILE_FILE=str(OUT / 'native.profraw'))
commands = []


def run(name, command, cwd=BUILD):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True)
    for stream in ['stdout', 'stderr']:
        (OUT / (name + '.' + stream)).write_bytes(getattr(result, stream))
    commands.append(dict(name=name, command=command, cwd=str(cwd), exitCode=result.returncode,
                         stdoutSha256=sha(result.stdout), stderrSha256=sha(result.stderr)))
    (OUT / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
    assert result.returncode == 0, (name, result.stderr.decode(errors='replace'))
    return result.stdout


run('build', ['bash', 'renderer/virgl-shader/build.sh', 'standard-stream-output-sanitize'])
binary = BUILD / 'renderer/virgl-shader/build/standard-stream-output-sanitize/standard-stream-output-test'
native = run('native', [str(binary), str(OUT / 'cases.bin')])
(OUT / 'native.jsonl').write_bytes(native)
rows = [json.loads(line) for line in native.splitlines()]
for case, row in zip(cases, rows):
    assert row['response']['ok'] == (case['expectedError'] is None)
    if case['expectedError']:
        assert row['response']['error']['code'] == case['expectedError'] and set(row['response']) == {'ok', 'error'}
assert len(rows) == len(cases) == 3
run('profile', ['xcrun', 'llvm-profdata', 'merge', '-sparse', str(OUT / 'native.profraw'), '-o', str(OUT / 'native.profdata')])
coverage = run('coverage', ['xcrun', 'llvm-cov', 'export', str(binary), '-instr-profile=' + str(OUT / 'native.profdata')])
(OUT / 'coverage.json').write_bytes(coverage)
functions = json.loads(coverage)['data'][0]['functions']
function = next(f for f in functions if f['name'] == 'standard_stream_output_validate')
branches = {b[0]: b for b in function['branches']}
assert branches[39][4] > 0 and branches[39][5] > 0
assert branches[46][5] > 0
result = dict(schema='stream-output-shaders-independent-component-native-supplement-v1', status='passed',
              frozenSource=SOURCE, sourceArchiveSha256=sha(archive), binarySha256=sha(binary.read_bytes()),
              cases=3, requestSha256=sha(wire), responseSha256=sha(native), coverageSha256=sha(coverage),
              nativeBranches={'declaredComponentMismatch': branches[39], 'reversedDisjointIntervals': branches[46]},
              originalTokens=[row['originalTokens'] for row in rows], commands=commands, noImplementationChanges=True)
(OUT / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(dict(status='passed', cases=3, branches=result['nativeBranches'])))
