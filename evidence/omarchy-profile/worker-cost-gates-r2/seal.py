"""Seal the corrected diagnostic, preserving both actual desktop failures."""
from pathlib import Path
import hashlib, json, os, subprocess

gates = Path(__file__).resolve().parent
base, repo = gates.parent, gates.parents[2]
run = base/'worker-cost-r2'
def read(p): return json.loads(p.read_text())
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
frozen, checks, parent, report, symbols, visual = map(read, [gates/'frozen.json', gates/'commands.json',
    run/'run.json', run/'desktop/report.json', run/'symbolized/cpu-summary.json', gates/'visual-inspection.json'])
assert checks['allPassed'] and all(c['code'] == 0 for c in checks['commands'])
assert frozen['head'] == checks['head'] == parent['head'] == report['trial']['head']
assert report['result'] == 'failed' and not report['keyboard']['verified']
assert parent['inputAudit']['noPostVerdictIngress']
assert report['workerCost']['status'] == 'captured' and report['cleanup']['closed'] and not report['errors']
assert parent['exit']['code'] == 1 and parent['exit']['closed'] and parent['exit']['watchdog'] is None
assert sha(run/'desktop/worker-cpu.json') == report['workerCost']['sha256'] == symbols['profiles']['worker-cpu.json']['sha256']
assert parent['wasmSha256'] == frozen['wasmSha256'] == symbols['releaseSha256']
for row in frozen['files']: assert sha(repo/row['path']) == row['sha256']
preserved = read(gates/'r1-preserved.json')
for row in preserved['files']: assert sha(base/row['path']) == row['sha256']
assert visual['personallyViewed'] and not visual['genuineTypedResponse']
for name, digest in visual['images'].items(): assert sha(run/'desktop'/name) == digest
receipt = dict(recordingHead=frozen['head'], runtimeParent=frozen['verifiedParent'],
    wasmSha256=frozen['wasmSha256'], reportSha256=sha(run/'desktop/report.json'),
    profileSha256=report['workerCost']['sha256'], namedSha256=symbols['namedSha256'],
    noPostVerdictIngress=True, desktopResponsive=False, r1Protocol='refuted',
    preservedR1Files=len(preserved['files']), narrowChecksPassed=True,
    claim='Exact post-verdict host cost captured; desktop still fails physical input.')
(gates/'submission.json').write_text(json.dumps(receipt,indent=2)+'\n')
files = sorted(p for d in [gates,run] for p in d.rglob('*') if p.is_file() and p != gates/'sha256.txt')
(gates/'sha256.txt').write_text(''.join(sha(p)+'  '+str(p.relative_to(base))+'\n' for p in files))
print(json.dumps(dict(files=len(files),indexSha256=sha(gates/'sha256.txt'),submission=receipt),indent=2))
