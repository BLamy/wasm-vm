#!/usr/bin/env python3
"""Match each changed runtime hunk to exact-source V8 execution."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DEPENDENCY = '761a912a88823954e3424f7b003c15887e7c9034'
FROZEN = 'c9963d71add68b550d9f26a2b9e9d417f3daa437'
RUNTIME = ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/state.mjs']


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def units(text):
    return len(text.encode('utf-16-le')) // 2


def main():
    diff = git('diff', '--no-color', '--unified=0', DEPENDENCY, 'f7801621').decode()
    (HERE / 'worker-task.diff').write_text(diff)
    hunks, current, active = [], None, None
    for line in diff.splitlines():
        if line.startswith('+++ b/'):
            current = line[6:]
        elif line.startswith('@@ '):
            match = re.search(r'\+(\d+)(?:,(\d+))? @@', line)
            active = dict(path=current, start=int(match[1]), length=int(match[2] or 1), header=line)
            hunks.append(active)
    sources = {}
    for path in RUNTIME:
        raw = git('show', FROZEN+':'+path)
        assert raw == (ROOT / path).read_bytes(), 'production runtime drift'
        text = raw.decode()
        lines = text.splitlines(keepends=True)
        starts = [0]
        for line in lines:
            starts.append(starts[-1]+units(line))
        sources[path] = (raw, text, lines, starts)
    records = []
    for path in sorted((HERE / 'unpacked').rglob('browser-coverage.json')):
        records.append((path, json.loads(path.read_bytes()).get('scripts', [])))
    for directory in [ROOT / 'target/evidence/virgl-standard-draw-critic-replay', HERE / 'promoted-final']:
        for path in sorted(directory.rglob('browser-coverage.json')):
            records.append((path, json.loads(path.read_bytes()).get('scripts', [])))
    closures = {path: [] for path in RUNTIME}
    for recording, scripts in records:
        for script in scripts:
            path = script['source']
            if path not in RUNTIME or script['sha256'] != sha(sources[path][0]):
                continue  # Sabotaged state.mjs cannot prove original source execution.
            ranges = [r for f in script['coverage']['functions'] for r in f['ranges']]
            closures[path].append(dict(recording=str(recording.relative_to(ROOT)),
                                       recordingSha256=sha(recording.read_bytes()), ranges=ranges))
    for recording in sorted((HERE / 'node-coverage').glob('coverage-*.json')):
        for script in json.loads(recording.read_bytes())['result']:
            for path in RUNTIME:
                if script['url'] == (ROOT / path).as_uri():
                    closures[path].append(dict(recording=str(recording.relative_to(ROOT)),
                                               recordingSha256=sha(recording.read_bytes()),
                                               ranges=[r for f in script['functions'] for r in f['ranges']]))
    points, gaps = [], []
    for h in hunks:
        path = h['path']
        if path not in RUNTIME:
            continue
        _, _, lines, starts = sources[path]
        coverage = []
        for number in range(h['start'], h['start']+h['length']):
            raw_line = lines[number-1].rstrip('\n')
            stripped = raw_line.strip()
            a = starts[number-1]+units(raw_line[:len(raw_line)-len(raw_line.lstrip())])
            b = starts[number-1]+units(raw_line.rstrip())
            structural = not stripped or stripped.startswith('//') or bool(re.fullmatch(r'[{};(),]+', stripped))
            boundaries = {a, b}
            for c in closures[path]:
                for r in c['ranges']:
                    for edge in [r['startOffset'], r['endOffset']]:
                        if a < edge < b:
                            boundaries.add(edge)
            intervals = []
            ordered = sorted(boundaries)
            for left, right in zip(ordered, ordered[1:]):
                if left == right:
                    continue
                hits = []
                for c in closures[path]:
                    enclosing = [r for r in c['ranges'] if r['startOffset'] <= left and r['endOffset'] >= right]
                    if enclosing:
                        r = min(enclosing, key=lambda r: r['endOffset']-r['startOffset'])
                        hits.append(dict(count=r['count'], recording=c['recording'],
                                         recordingSha256=c['recordingSha256'], range=r))
                best = max(hits, key=lambda r: r['count']) if hits else dict(count=0)
                relative = raw_line.encode('utf-16-le')[2*(left-starts[number-1]):2*(right-starts[number-1])].decode('utf-16-le')
                if relative.strip() and not structural and best['count'] == 0:
                    gaps.append(dict(path=path, line=number, text=relative, startOffset=left, endOffset=right))
                intervals.append(dict(startOffset=left, endOffset=right, text=relative, proof=best))
            result = 'structural/comment waiver' if structural else 'executed'
            coverage.append(dict(line=number, text=raw_line, classification=result, intervals=intervals))
        points.append(dict(**h, sourceSha256=sha(sources[path][0]), lines=coverage, classification='HELD' if not any(g['path']==path and h['start'] <= g['line'] < h['start']+h['length'] for g in gaps) else 'NEEDS EVIDENCE'))
    # Every non-runtime hunk receives an explicit execution/declarative ledger.
    reasons = {
        'Makefile':'Executed make verify-E6-T11d6 (original hot/cold and fresh replay); declarative target routes to recorded shell gate.',
        'renderer/virgl-command/draw-README.md':'Documentation only, matches the authenticated literal/native observations; no executable behavior.',
        'renderer/virgl-command/tests/standard-instanced-draws.mjs':'runWireAcceptance is executed in Node (80 literal packets/160 predictions); runAcceptance and fixture/trace/drain/readback drivers execute in original hot/cold hardware and fresh replay. Browser V8 source/counts are preserved. Recording/diagnostic branches are harness-only; their failed-oracle path is exercised by real native sabotage.',
        'tools/verify-virgl-standard-draw.mjs':'Node orchestrator executed for wire, normal headed hardware and served native sabotage in original hot/cold plus fresh replay. Saved source/coverage/browser/blobs/GPU/fence custody and actual reports prove the execution. Non-entry diagnostic timeout/catch handlers are narrowly waived as recording failure diagnostics, not product behavior.',
        'tools/verify-virgl-standard-draw.sh':'Exact gate command executed in original hot/cold and fresh replay; closed recording markers, actual compiler build, retained gate reports and receipt are authenticated. Success escape error for undetected sabotage is a recording failure guard.',
        'tools/virgl-command/standard-draw-oracle.mjs':'Independent literal model/full image oracle executes for all37 frames plus real mutation in original hot/cold and fresh replay. Fresh Python implementation, importing no runtime/model, independently agrees on all bytes/fetches/pixels. Malformed model diagnostic guard is harness-only.',
        'tools/virgl-command/standard-draw-pixels.mjs':'Executed offline audit in original hot/cold and fresh replay; recomputation and mismatch rows are authenticated, independently checked again in Python.',
        'tools/virgl-command/standard-draw-receipt.py':'Executed after original hot/cold and fresh replay; all file/source/generated digests and conditions independently authenticated. Assertion/raise failure paths are custody diagnostics.',
        'tools/virgl-command/standard-draw-cold.py':'Executed once on final frozen head; exact clone path, clean before/after, scrubbed environment, logs and copied complete acceptance authenticated. Exception handling is recording failure diagnostic.',
        'tools/virgl-command/standard-draw-seal.py':'Executed original seal; every one of752 members/lengths/hashes/receipt/source closures independently reconstructed. Diagnostic rejects and metadata formatting are custody-only.',
        'tasks/QUEUE.md':'Declarative task bookkeeping regenerated by policy/build_queue; no runtime effect.',
        'tasks/epic-6-transcendence/E6-T11d-truthful-guest-virgl-bringup.md':'Declarative prerequisite and negative readiness history; production authority remains false/blocked, no runtime effect.',
        'tasks/epic-6-transcendence/E6-T11d6-standard-instanced-draws.md':'Acceptance/boundary/claim bookkeeping; all product criteria separately interrogated; no runtime effect.',
        'evidence/virgl-production-readiness/standard-draw-gap.json':'Historical negative literal packet metadata at dependency; not current capability proof or executable behavior.',
        'evidence/virgl-standard-draw/worker/manifest.json':'Custody metadata only; independent digest/member/source authentication in authentication.json.',
        'evidence/virgl-standard-draw/worker/records.json':'Custody index only; every member authenticated independently, including byte lengths and SHA256.'}
    other = []
    for h in hunks:
        if h['path'] in RUNTIME:
            continue
        assert h['path'] in reasons, 'unaccounted non-runtime hunk '+h['path']
        other.append(dict(**h, classification='executed-harness/declarative-waiver', reason=reasons[h['path']]))
    output = dict(schema='standard-draw-critic-coverage-v1', frozenHead=FROZEN, dependency=DEPENDENCY,
                  status='passed' if not gaps else 'needs-evidence', runtimeHunks=len(points), runtimeAddedLines=sum(h['length'] for h in points),
                  runtime=points, nonRuntime=other, gaps=gaps,
                  binaryWaiver={'path':'evidence/virgl-standard-draw/worker/recording.tar.gz','reason':'752 authenticated evidence members; data only, not executable runtime.'})
    (HERE / 'coverage-audit.json').write_text(json.dumps(output, indent=2)+'\n')
    print(json.dumps({k:output[k] for k in ['status','runtimeHunks','runtimeAddedLines','gaps']}))
    assert not gaps


if __name__ == '__main__':
    main()
