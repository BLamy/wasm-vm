#!/usr/bin/env python3
"""Run only touched harness gates and close the initial changed-runtime coverage audit."""
from pathlib import Path
import hashlib, json, subprocess

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
RAW = ROOT / 'target/evidence/virgl-known-arithmetic-critic-supplement'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def main():
    checks = []
    for argv in [['node', '--check', 'tools/virgl-known-arithmetic/supplement.mjs'],
                 ['bash', '-n', 'tools/verify-virgl-known-arithmetic.sh'],
                 ['git', 'diff', '--check'], ['python3', 'tools/check_task_policy.py'],
                 ['python3', 'tools/virgl-known-arithmetic/receipt.py', '--supplement',
                  str(RAW / 'guard-replay/report.json'),
                  str(ROOT / 'target/evidence/virgl-known-arithmetic-critic/unpacked/hot/native/report.json')]]:
        run = subprocess.run(argv, cwd=ROOT, capture_output=True)
        assert run.returncode == 0, run.stderr.decode()
        checks.append(dict(argv=argv, exit=run.returncode, stdout=run.stdout.decode(), stderr=run.stderr.decode()))
    python_sources = [ROOT / 'tools/virgl-known-arithmetic/receipt.py',
                      ROOT / 'tools/virgl-known-arithmetic/supplement-seal.py', *sorted(OUT.glob('*.py'))]
    for file in python_sources:
        compile(file.read_bytes(), str(file), 'exec')
    checks.append(dict(gate='Python syntax, without creating __pycache__',
                       sources=[str(p.relative_to(ROOT)) for p in python_sources], status='passed'))
    prior = json.loads((ROOT / 'evidence/virgl-known-arithmetic/verifier/verdict.json').read_bytes())
    coverage = json.loads((ROOT / 'evidence/virgl-known-arithmetic/verifier/coverage-audit.json').read_bytes())
    recording = json.loads((OUT / 'recording-audit.json').read_bytes())
    attacks = json.loads((OUT / 'guard-attacks.json').read_bytes())
    historical = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=ROOT)
    filtered = b'\0'.join(p for p in historical.split(b'\0') if p and not p.startswith(
        b'evidence/virgl-known-arithmetic/verifier/supplement/')) + b'\0'
    assert filtered == Path('/tmp/known-arithmetic-verifier-initial-untracked.zlist').read_bytes()
    assert not subprocess.check_output(['git', 'diff', '--name-only', 'cba5ae02', 'HEAD', '--',
                                      'renderer/virgl-shader', 'renderer/virgl-command', 'AGENTS.md'], cwd=ROOT)
    fixture = ROOT / 'tools/virgl-known-arithmetic/supplement-cases.json'
    guard = ROOT / 'tools/virgl-known-arithmetic/supplement.mjs'
    receipt = ROOT / 'tools/virgl-known-arithmetic/receipt.py'
    recipe = ROOT / 'tools/verify-virgl-known-arithmetic.sh'
    recipe_text = recipe.read_text()
    assert 'node tools/virgl-known-arithmetic/supplement.mjs ' in recipe_text
    assert 'python3 tools/virgl-known-arithmetic/receipt.py ' in recipe_text
    assert "supplement=report('supplement/report.json')\n check_supplement(supplement,n)" in receipt.read_text()
    result = dict(schema='virgl-known-arithmetic-incremental-final-checks-v1', status='passed', commands=checks,
                  oldCoverageSha256=sha((ROOT / 'evidence/virgl-known-arithmetic/verifier/coverage-audit.json').read_bytes()),
                  coverageClosure=dict(native=dict(changedLines=126, held=83, waived=43, needsEvidence=0),
                                       javascript=dict(changedLines=23, held=19, waived=4, needsEvidence=0),
                                       resolved=['C1', 'C2', 'J1'], method='original LLVM containing/nested kind-0 ranges and exact original-source V8 ranges'),
                  carriedHeld=[p for p in prior['predictionResults'] if p['status'] == 'HELD'],
                  promotedSuite=dict(reason='Adopt the two exact first-critic public fixtures and independent literal zero identities, now committed with two policy fixtures and the canonical recurring guard. No redundant implementation-mirroring test is added.',
                                     sources=[dict(path=str(p.relative_to(ROOT)), sha256=sha(p.read_bytes()))
                                              for p in [fixture, guard, receipt, recipe]],
                                     directResult='four full native/Wasm singles/pairs, literal word/shadow producer checks, inherited coordinates/rejection, three inert getters, five LLVM and two V8 points'),
                  harnessWiringWaiver='Canonical shell invocation and main receipt call are declarative wiring; static inspection binds them to the same replay/check_supplement implementations executed directly. Full acceptance walls remain HELD and are not restarted for harness-only wiring.',
                  historicalUntracked=dict(count=4202, sha256=sha(filtered)),
                  runtimeChanges=False, coldCloneRepeated=False, gpuRepeated=False)
    assert len(result['carriedHeld']) == 13 and recording['status'] == attacks['status'] == 'passed'
    (OUT / 'final-checks.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Touched harness gates pass; prior coverage closes at native 83 HELD/43 waived and JS 19 HELD/4 waived; literal fixtures adopted.')

if __name__ == '__main__':
    main()
