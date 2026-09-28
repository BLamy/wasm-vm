from pathlib import Path
import hashlib, json, os, subprocess, time

gates = Path(__file__).resolve().parent
base = gates.parent
run = base/'admission-after-fp-r1'
repo = base.parents[1]
env = dict(os.environ, DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def read(path): return json.loads(path.read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
frozen, commands, pair, audit = map(read, [gates/'frozen.json', gates/'commands.json', run/'ab.json', run/'audit.json'])
assert commands['allPassed'] and all(row['code'] == 0 for row in commands['commands'])
assert pair['head'] == audit['head'] == frozen['head']
assert pair['wasmSha256'] == audit['wasmSha256'] == frozen['wasmSha256']
assert len(pair['arms']) == len(audit['arms']) == 2 and pair['finishedAt']
for row in frozen['files']:
    assert sha(repo/row['path']) == row['sha256']
for arm in audit['arms']:
    assert sha(run/arm['arm']/'report.json') == arm['reportSha256']
    assert arm['machineAcceptance'] is False and arm['nonceReplies'] == 0
    assert arm['framesBefore'] == arm['framesAfter'] == 2
    assert arm['screenshots']['desktop.png'] == arm['screenshots']['failure.png']
receipt = {'head': subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip(),
           'recordingHead': frozen['head'], 'verifiedRuntimeParent': frozen['verifiedParent'],
           'wasmSha256': frozen['wasmSha256'], 'narrowChecksPassed': True,
           'controlResponsive': False, 'candidateResponsive': False,
           'allFourImagesViewed': True, 'runtimeOrRecorderChanges': False,
           'sealedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
(gates/'submission.json').write_text(json.dumps(receipt,indent=2)+'\n')
files = sorted(path for folder in [gates,run] for path in folder.rglob('*')
               if path.is_file() and path != gates/'sha256.txt')
entries = [(sha(path), str(path.relative_to(base))) for path in files]
(gates/'sha256.txt').write_text(''.join(digest+'  '+name+'\n' for digest,name in entries))
assert all(sha(base/name) == digest for digest,name in entries)
print(json.dumps({'files':len(entries),'indexSha256':sha(gates/'sha256.txt'),'submission':receipt},indent=2))
