"""Replay only repaired proof gates while preserving the original cold source authority."""
import json
import subprocess
import time
from pathlib import Path
from custody import reopen, sha

ORIGINAL_HEAD = 'cb04190a0fd8d989fb54fb7b2caf39cc86a8a0e7'
CARRY_PIN = '1222b4323df91f51bc2e4b1375fdde9cd2d1131b909edbad7492dacee1a5e683'
FAMILY = 'virgl-dimensional-depth-surfaces/carried-cb04190a'


def verify(repo, root, head, env):
    allowed = {'Makefile', *['tools/virgl-dimensional-depth-surfaces/' + n for n in
               ['predecessor.py', 'verify.py', 'cold.py', 'seal.py', 'incremental.py']]}
    changed = subprocess.check_output(['git', 'diff', '--name-only', ORIGINAL_HEAD, head], cwd=repo, text=True).splitlines()
    assert all(p in allowed or p.startswith('evidence/' + FAMILY + '/') for p in changed), 'only the declared proof-only repair may carry source gates'
    authentication, bodies = reopen(repo / 'evidence' / FAMILY, CARRY_PIN, lambda name: True)
    original = json.loads(bodies['cold/report.json'])
    old_commands = json.loads(bodies['cold/recording/commands.json'])
    assert original['head'] == ORIGINAL_HEAD and original['exitCode'] == 2
    assert not original['cleanBefore'] and not original['cleanAfter']
    assert old_commands[-1]['name'] == 'coverage-audit' and old_commands[-1]['exitCode'] == 1
    assert all(c['exitCode'] == c['expected'] for c in old_commands[:-1])
    names = ['hardware-' + str(s) for s in [54831, 90107, 171281]] + [m + '-' + str(s) for m in ['boundaries', 'refresh'] for s in [54831, 90107, 171281]] + ['attacks', 'mrt', 'historical', 'fault-layer', 'fault-face', 'historical-dimensional-color-surfaces']
    for name in names:
        prefix = 'cold/recording/' + name + '/'
        selected = {p[len('cold/recording/'):]: b for p, b in bodies.items() if p.startswith(prefix)}
        assert selected
        for relative, body in selected.items():
            file = root / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(body)
        report = json.loads((root / name / 'report.json').read_bytes())
        assert report['head'] == ORIGINAL_HEAD and not report['trackedChanges']
        assert report['status'] == ('failed' if name.startswith('fault-') else 'passed')
        for pin in report['sources']:
            relative = pin['path']
            body = (root / name / 'source' / relative).read_bytes()
            assert len(body) == pin['bytes'] and sha(body) == pin['sha256']
            if not relative.startswith(('target/', 'renderer/virgl-shader/build/wasm/')):
                assert body == (repo / relative).read_bytes()
                assert body == subprocess.check_output(['git', 'show', head + ':' + relative], cwd=repo)
    carried = [c for c in old_commands[:-1] if c['name'] not in {'policy', 'diff-format', 'predecessor', 'python-syntax', 'physical-audit'}]
    for c in carried:
        for stream in ['stdout', 'stderr']:
            path = 'cold/recording/' + c['name'] + '.' + stream
            assert sha(bodies[path]) == c[stream + 'Sha256']
    identity = dict(schema='dimensional-depth-surface-incremental-source-custody-v1',
                    originalColdHead=ORIGINAL_HEAD, harnessHead=head,
                    recordingsRelabeled=False, allowedProofOnlyChanges=changed,
                    originalCold=original, originalCommands=old_commands,
                    carriedPassedCommands=carried, authentication=authentication,
                    runtimeAndBrowserFixtureBytesIdentical=True)
    (root / 'carried-source-custody.json').write_text(json.dumps(identity, indent=2) + '\n')
    steps = []

    def run(name, command, timeout=1200):
        print(name + ': running', flush=True)
        start = time.monotonic()
        result = subprocess.run(command, cwd=repo, env=env, capture_output=True, timeout=timeout)
        for stream in ['stdout', 'stderr']:
            (root / (name + '.' + stream)).write_bytes(getattr(result, stream))
        steps.append(dict(name=name, command=command, exitCode=result.returncode, expected=0,
                          seconds=time.monotonic() - start, stdoutSha256=sha(result.stdout), stderrSha256=sha(result.stderr)))
        (root / 'commands.json').write_text(json.dumps(steps, indent=2) + '\n')
        assert result.returncode == 0, (name, result.stderr[-4000:].decode(errors='replace'))
        print(name + ': expected exit0', flush=True)

    run('policy', ['python3', 'tools/check_task_policy.py'])
    run('diff-format', ['git', 'diff', '--check', 'e8eb963e821104f87aeca34dd2ac810c2d2794dd', 'HEAD'])
    run('proof-harness-syntax', ['python3', '-m', 'py_compile', *map(str, (repo / 'tools/virgl-dimensional-depth-surfaces').glob('*.py'))])
    run('predecessor', ['python3', 'tools/virgl-dimensional-depth-surfaces/predecessor.py', str(root / 'predecessor')])
    for name in names:
        report = json.loads((root / name / 'report.json').read_bytes())
        for pin in report['sources']:
            if pin['path'].startswith('renderer/virgl-shader/build/wasm/'):
                assert (root / name / 'source' / pin['path']).read_bytes() == (repo / pin['path']).read_bytes(), 'generated compiler must match the independently authenticated D61 artifact'
    run('physical-audit', ['python3', 'tools/virgl-dimensional-depth-surfaces/audit.py', str(root)])
    run('coverage-audit', ['python3', 'tools/virgl-dimensional-depth-surfaces/coverage.py', str(root)])
    run('default-dist-build', ['make', 'web-dist'])
    run('default-demo', ['node', 'tools/verify-virgl-default-demo.mjs', '--output', str(root / 'default-demo'), '--task', 'E6-T11d64'])
    assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repo)
    sources = {}
    selected_paths = ['renderer', 'crates/core', 'crates/wasm', 'crates/wasm-web', 'tools/virgl-dimensional-depth-surfaces', 'tools/verify-virgl-default-demo.mjs', 'tools/build-web-dist.sh', 'web/roadmap.js', 'web/dist', 'Makefile', 'AGENTS.md', 'Cargo.toml', 'Cargo.lock', 'tasks/epic-6-transcendence/E6-T11d64-dimensional-depth-surfaces.md']
    for relative in subprocess.check_output(['git', 'ls-files', *selected_paths], cwd=repo, text=True).splitlines():
        file = repo / relative
        if not file.is_file():
            continue
        body = file.read_bytes()
        assert body == subprocess.check_output(['git', 'show', head + ':' + relative], cwd=repo)
        sources[relative] = dict(bytes=len(body), sha256=sha(body))
        destination = root / 'sources' / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(body)
    coverage = json.loads((root / 'coverage-audit.json').read_bytes())
    physical = json.loads((root / 'physical-audit.json').read_bytes())
    assert not coverage['needsEvidence'] and physical['completedPhysicalRefutations'] == 2
    receipt = dict(schema='dimensional-depth-surface-worker-receipt-v1', task='E6-T11d64', head=head,
                   base='2aca65e9328aa1433fb516511ca554fdd96b422d', submissionBase='e8eb963e821104f87aeca34dd2ac810c2d2794dd',
                   carriedRuntimeHead=ORIGINAL_HEAD, carriedSourceCustody=identity,
                   commands=steps, sources=sources, predecessors=json.loads((root / 'predecessor/authentication.json').read_bytes()),
                   physical=physical, coverage=dict(executed=len(coverage['executed']), held=len(coverage['held']), staticWaivers=len(coverage['waived']), newExecutableGaps=0),
                   actualLinuxGuest=False, productionAuthority=False)
    (root / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(dict(status='passed', head=head, originalColdHead=ORIGINAL_HEAD,
                         carriedPassedCommands=len(carried), executedRepairCommands=len(steps), coverage=receipt['coverage'])))
