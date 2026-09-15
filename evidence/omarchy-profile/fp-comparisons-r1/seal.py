from pathlib import Path
import hashlib,json,re,subprocess,time,os
root=Path(__file__).resolve().parent
repo=root.parents[2]
env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def read(name):return json.loads((root/name).read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip()
runtime='2e7cd66994e63c1ca39f492d49c5764a31c87739'
paths=['crates/jit-translate/src/lib.rs','crates/core/src/jit.rs']
assert subprocess.check_output(['git','diff',runtime,'HEAD','--']+paths,cwd=repo,env=env)==b''
ci=read('ci-commands.json');affected=read('affected-commands.json');cold=read('cold/report.json');public=read('cloudflare-public.json');physical=read('physical-summary.json')
assert cold.get('passed') is True and cold['pristineBeforeBuild'] is True
assert all(x.get('code')==0 for x in cold['commands'])
assert all(x.get('code')==0 for x in affected['commands'])
assert len(public)==8 and all(x['status']==200 and x['sha256']==x['expectedSha256'] for x in public)
expected='4e1dae976924fb1857a70fc1a8ec357e18475e15f4a8f74ef2980838d0a089dd'
assert expected==sha(repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm')==cold['committedWasmSha256']==cold['rebuiltWasmSha256']
for run in ['acceptance-browser/report.json','cold/browser/report.json']:
 r=read(run)
 assert r['passed'] and r['wasmSha256']==expected and not r['errors']
 assert r['suite']=={'metric-pass':'127','metric-fail':'0','metric-done':'127'}
completed={}
for name in ['core-handoff','fp-regression','native-fp-isa','wasm-native-lib','acceptance']:
 rows=re.findall(r'test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored',(root/(name+'.log')).read_text())
 completed[name+'.log']={'targets':len(rows),'passed':sum(int(x[1]) for x in rows),'failed':sum(int(x[2]) for x in rows),'ignored':sum(int(x[3]) for x in rows)}
receipt={'submissionSourceHead':head,'runtimeHead':runtime,'acceptanceHead':affected['head'],'coldHead':cold['head'],'runtimeWasmSha256':expected,'runtimeFiles':{p:sha(repo/p) for p in paths},'broadCiPassed':ci['allPassed'],'affectedCommandsPassed':affected['allPassed'],'focusedAcceptancePassed':True,'coldClonePassed':True,'publicBytesMatched':True,'desktopResponsive':physical['responsive'],'completedTests':completed,'sealedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'notes':['Prescribed broad make ci outcomes are retained in full; no failing gate is relabeled green.','Physical trial outcome is separate from instruction correctness.','All post-runtime changes are tests, metadata, evidence or content-addressed deployment manifests.']}
(root/'submission.json').write_text(json.dumps(receipt,indent=2)+'\n')
entries=[(sha(p),str(p.relative_to(root))) for p in sorted(root.rglob('*')) if p.is_file() and p.name!='sha256.txt']
(root/'sha256.txt').write_text(''.join(digest+'  '+name+'\n' for digest,name in entries))
assert all(sha(root/name)==digest for digest,name in entries)
print(json.dumps({'files':len(entries),'indexSha256':sha(root/'sha256.txt'),'submission':receipt},indent=2))
