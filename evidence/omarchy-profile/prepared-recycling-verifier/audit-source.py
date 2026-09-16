"""Read-only AM source/gate audit; no compiler, browser or guest."""
from pathlib import Path
import hashlib,json,os,re,subprocess

ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
HEAD='e7e378288581069ae0471e3ca141507e1f5faf30'
ENV={**os.environ,'DEVELOPER_DIR':'/Library/Developer/CommandLineTools'}
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,env=ENV)
def read(p):return (ROOT/p).read_bytes()
gates='evidence/omarchy-profile/prepared-recycling-gates/'
freeze=json.loads(read(gates+'frozen.json'))
assert freeze['head']==HEAD
for base in ['27eab37c','88212705']:
    assert not git('diff','--name-only',base,HEAD,'--','crates','web','Cargo.toml','Cargo.lock').strip()
assert not git('diff','--name-only',HEAD,'--','crates','web','Cargo.toml','Cargo.lock').strip()
seen=set();dynamic=[]
def visit(name):
    if name in seen:return
    seen.add(name);data=read(name)
    assert data==git('show',HEAD+':'+name),name
    specs=re.findall(r'(?:from\s*|import\s*)[\'\"]([^\'\"]+)[\'\"]',data.decode())
    for spec in re.findall(r'import\(\s*[\'\"]([^\'\"]+)[\'\"]',data.decode()):
        dynamic.append({'file':name,'specifier':spec})
        if name=='tools/verify/omarchy-failure-checkpoint.mjs' and spec=='./pkg/wasm_vm_wasm.js':
            continue # CDP page-relative string in disabled failure-checkpoint route.
        specs.append(spec)
    for spec in specs:
        if not spec.startswith('.') or 'node_modules' in spec:continue
        visit(str(((ROOT/name).parent/spec).resolve().relative_to(ROOT)))
for entry in ['tools/verify/omarchy-prepared-recycling-input.mjs','tools/verify/omarchy-desktop-live.mjs']:visit(entry)
assert seen=={r['path'] for r in freeze['files']}
for row in freeze['files']:assert sha(read(row['path']))==row['sha256'],row
assert 'tools/verify/e5-t22c-guest-mode.mjs' not in seen
carried=[]
for name in ['omarchy-prepared-direct-state.mjs','omarchy-latency-receipt.mjs','omarchy-worker-cost-capture.mjs',
             'omarchy-owned-trial.mjs','omarchy-browser-session.mjs','omarchy-live-recording.mjs',
             'e5-t22c-cpu-profile.mjs','e5-t22c-symbolize-cpu.mjs']:
    p='tools/verify/'+name;assert read(p)==git('show','88212705:'+p),p
    carried.append({'path':p,'sha256':sha(read(p))})
commands=json.loads(read(gates+'commands.json'))
assert commands['head']==HEAD and commands['allPassed'] is True
assert all(row['code']==0 for row in commands['commands'])
for row in commands['commands']:
    assert row['finishedAt']<=freeze['frozenAt']
for text in ['tests 89','pass 89','fail 0','skipped 0']:assert text in read(gates+'affected-harness.log').decode()
for name in ['record.py','freeze.py','symbols.py','bind-names.mjs']:
    assert read(gates+name)==git('show',HEAD+':'+gates+name)
run=json.loads(read('evidence/omarchy-profile/prepared-recycling-input-r1/run.json'))
assert freeze['frozenAt']<run['startedAt'] and run['head']==HEAD
report=json.loads(read('evidence/omarchy-profile/prepared-recycling-input-r1/desktop/report.json'))
for rel,pin in report['trial']['helpers'].items():
    data=git('show',HEAD+':'+rel)
    assert (len(data),sha(data))==(pin['size'],pin['sha256'])
for row in report['resourceIdentities']:
    if (row.get('repoPath') or '').startswith('web/'):
        assert sha(git('show',HEAD+':'+row['repoPath']))==row['sha256']
control=json.loads(read('evidence/omarchy-profile/prepared-direct-input-r1/desktop/report.json'))
assert sha(read('evidence/omarchy-profile/prepared-direct-input-r1/desktop/report.json'))=='0d4f8f50d2d9e940ce098f744202bcff49ae3c1048b39d692231d1d2c7fa38ea'
keys=['arm','jitResidencyPolicy','jitResidencyCap','startupMs','typingMs','readbackMs','captureMs','cleanupMs','profilingRequested','admissionProbeRequested']
for k in keys:assert report['trial'][k]==control['trial'][k],k
assert report['trial']['recycling'] is True and control['trial']['recycling'] is False
for role in ['kernel','bootSnapshot','overlayDelta','chunkManifest','image']:
    assert report['candidate']['source'][role]==control['candidate']['source'][role],role
from urllib.parse import urlsplit,parse_qs
aq=parse_qs(urlsplit(report['url']).query);bq=parse_qs(urlsplit(control['url']).query)
assert aq.pop('jitColdCounterRecycling')==['1'] and bq.pop('jitColdCounterRecycling')==['0']
aq.pop('omarchyAssetBase');bq.pop('omarchyAssetBase');assert aq==bq
diff=git('diff','88212705',HEAD,'--','tools/verify',gates)
(OUT/'implementation.diff').write_bytes(diff)
result={'head':HEAD,'sourceFiles':len(seen),'files':freeze['files'],'dynamicImportsInspected':dynamic,
        'runtimeUnchangedFromAKAndAL':True,'unchangedAKHelpers':carried,
        'workerGates':{'tests':89,'syntaxChecks':2,'commandsSha256':sha(read(gates+'commands.json'))},
        'frozenAt':freeze['frozenAt'],'actualStartedAt':run['startedAt'],'beforeLaunch':True,
        'actualReportHelpersBoundToFrozenGit':len(report['trial']['helpers']),
        'scopedStatus':report['trial']['scopedStatus'],'unrelatedGuestModeEditOutsideClosure':True,
        'exactOptionDifference':{'sameFields':keys,'sameArtifactRoles':['kernel','bootSnapshot','overlayDelta','chunkManifest','image'],
           'onlyRuntimeChange':'jitColdCounterRecycling 0 -> 1','harnessChange':'prepared-recycling label and optional post-verdict host sample'},
        'sourceEnvironment':'Owned ephemeral browser/context; no saved storage state; local pinned artifacts; no runtime/default mutation.',
        'diffSha256':sha(diff)}
(OUT/'source-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['head','sourceFiles','runtimeUnchangedFromAKAndAL','workerGates','beforeLaunch','actualReportHelpersBoundToFrozenGit','scopedStatus','exactOptionDifference']},indent=2))
