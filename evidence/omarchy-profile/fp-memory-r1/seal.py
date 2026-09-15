from pathlib import Path
import hashlib,json,re,subprocess,time,os
root=Path(__file__).resolve().parent
repo=root.parents[2]
env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def read(name):return json.loads((root/name).read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip()
runtime='7048847fb542d66618b836b965b94c8c9db771d5'
paths=['crates/jit-translate/src/lib.rs','crates/core/src/hart/mod.rs','crates/wasm/src/jit_browser.rs']
assert subprocess.check_output(['git','diff',runtime,'HEAD','--']+paths,cwd=repo,env=env)==b''
ci=read('ci-commands.json');affected=read('affected-commands.json');cold=read('cold/report.json');public=read('cloudflare-public.json');physical=read('physical-summary.json')
assert cold.get('passed') is True and cold['pristineBeforeBuild'] is True
assert all(x.get('code')==0 for x in cold['commands'])
assert all(x.get('code')==0 for x in affected['commands'] if x['label']!='hazards')
assert len(public)==8 and all(x['status']==200 and x['sha256']==x['expectedSha256'] for x in public)
assert physical['responsive'] is False and physical['completedReadbackCommands']==13 and physical['pendingReadbackCommands']==1
expected='1f989758c67c9dfdf514d2e03c0e4fa2cadb15a2dc0a465f5cb538661446473b'
assert expected==sha(repo/'web/dist/pkg/wasm_vm_wasm_bg.wasm')==cold['committedWasmSha256']==cold['rebuiltWasmSha256']
for run in ['browser/report.json','acceptance-browser/report.json','cold/browser/report.json']:
 r=read(run)
 assert r['passed'] and r['wasmSha256']==expected and not r['errors']
 assert r['suite']=={'metric-pass':'127','metric-fail':'0','metric-done':'127'}
completed={}
for name in ['translator','core-memory','runtime-memory','native-fp-isa','wasm-native-lib','acceptance']:
 rows=re.findall(r'test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored',(root/(name+'.log')).read_text())
 completed[name+'.log']={'targets':len(rows),'passed':sum(int(x[1]) for x in rows),'failed':sum(int(x[2]) for x in rows),'ignored':sum(int(x[3]) for x in rows)}
receipt={'submissionSourceHead':head,'runtimeHead':runtime,'acceptanceHead':affected['head'],'coldHead':cold['head'],'runtimeWasmSha256':expected,'runtimeFiles':{p:sha(repo/p) for p in paths},'broadCiPassed':ci['allPassed'],'affectedCommandsPassed':affected['allPassed'],'focusedAcceptancePassed':True,'coldClonePassed':True,'publicBytesMatched':True,'desktopResponsive':False,'completedTests':completed,'sealedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'notes':['The only affected-command failure is the unchanged lexical determinism-hazard scan; the full make ci is not green.','The physical trial is a failed desktop acceptance, not a latency or usability pass.','All post-runtime changes are tests, metadata, evidence or content-addressed deployment manifests.']}
(root/'submission.json').write_text(json.dumps(receipt,indent=2)+'\n')
entries=[(sha(p),str(p.relative_to(root))) for p in sorted(root.rglob('*')) if p.is_file() and p.name!='sha256.txt']
(root/'sha256.txt').write_text(''.join(digest+'  '+name+'\n' for digest,name in entries))
assert all(sha(root/name)==digest for digest,name in entries)
print(json.dumps({'files':len(entries),'indexSha256':sha(root/'sha256.txt'),'submission':receipt},indent=2))
