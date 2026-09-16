from pathlib import Path
import hashlib, json, os, subprocess, time

gates = Path(__file__).resolve().parent
base = gates.parent
run = base/'residency-after-fp-r1'
repo = base.parents[1]
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def read(path): return json.loads(path.read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
frozen, commands, pair, audit, visual = map(read, [gates/'frozen.json', gates/'commands.json',
    run/'ab.json', run/'audit.json', gates/'visual-inspection.json'])
assert commands['allPassed'] and all(row['code'] == 0 for row in commands['commands'])
assert commands['head'] == pair['head'] == audit['head'] == frozen['head']
assert pair['wasmSha256'] == audit['wasmSha256'] == frozen['wasmSha256']
assert len(pair['arms']) == len(audit['arms']) == len(visual['arms']) == 2 and pair['finishedAt']
for row in frozen['files']:
    assert sha(repo/row['path']) == row['sha256']
outcomes = {}
for arm, view in zip(audit['arms'], visual['arms']):
    assert arm['arm'] == view['arm']
    assert sha(run/arm['arm']/'report.json') == arm['reportSha256']
    assert view['personallyViewed'] is True
    for name, digest in view['images'].items():
        assert arm['screenshots'][name] == sha(run/arm['arm']/name) == digest
    assert 'desktop.png' in view['images']
    assert 'failure.png' in view['images'] or 'desktop-keyboard.png' in view['images']
    outcomes[arm['arm']] = arm['machineAcceptance'] and view['genuineTypedResponse']
receipt = {'head': subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip(),
           'recordingHead': frozen['head'], 'verifiedRuntimeParent': frozen['verifiedParent'],
           'wasmSha256': frozen['wasmSha256'], 'narrowChecksPassed': True,
           'responsive': outcomes, 'allFourImagesViewed': True,
           'runtimeChanges': False, 'harnessChanges': True,
           'sealedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
(gates/'submission.json').write_text(json.dumps(receipt,indent=2)+'\n')
files = sorted(path for folder in [gates,run] for path in folder.rglob('*')
               if path.is_file() and path != gates/'sha256.txt')
entries = [(sha(path), str(path.relative_to(base))) for path in files]
(gates/'sha256.txt').write_text(''.join(digest+'  '+name+'\n' for digest,name in entries))
assert all(sha(base/name) == digest for digest,name in entries)
print(json.dumps({'files':len(entries),'indexSha256':sha(gates/'sha256.txt'),'submission':receipt},indent=2))
