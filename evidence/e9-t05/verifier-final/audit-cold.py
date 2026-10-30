import ast,gzip,hashlib,json,re,struct,subprocess
from pathlib import Path
root=Path.cwd(); final=root/'target/evidence/e9-t05-final-review'; out=root/'target/evidence/e9-t05-cold-final'; accept=out/'acceptance'; compact=root/'evidence/e9-t05/cold'
freeze='7ac83e660cc316440a9e42cf961224f0c24a314a'; runtime='4ce36a932feaf171c09cd8b25e90d3fc9ff376ac'
sha=lambda b:hashlib.sha256(b).hexdigest()
def file_sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def git(*args,cwd=root):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=cwd)
def checkfile(p,e):
 assert p.is_file(),str(p)
 assert p.stat().st_size==e['bytes'],('size',str(p))
 assert file_sha(p)==e['sha256'],('sha',str(p))
def manifest(base,items):
 assert len({e['path'] for e in items})==len(items),'duplicate paths'
 for e in items:checkfile(base/e['path'],e)
 return {'count':len(items),'bytes':sum(e['bytes'] for e in items)}
receipt=json.loads((out/'receipt.json').read_text()); a=json.loads((accept/'report.json').read_text()); p=json.loads((compact/'provenance.json').read_text()); prior=json.loads((root/'evidence/e9-t05/verifier/repair-final-receipt.json').read_text())
assert file_sha(out/'receipt.json')=='6d4f5d414489eff824e17da6a74b1a0dd03b9ac66525d542be4fb50592d7316d'
assert file_sha(accept/'report.json')=='0241e2c0d9704ec478594e61e324dfa2f3df845b20ff8c267b721e9173d106f2'
assert receipt['head']==a['head']==p['head']==freeze
assert receipt['status']==a['status']=='passed'
r={'scope':'Read-only evidence interrogation; no program tests executed','predictions_sha256':file_sha(final/'receipt-predictions.md'),'receipt_sha256':file_sha(out/'receipt.json'),'acceptance_sha256':file_sha(accept/'report.json'),'originals':{'acceptance':manifest(accept,a['files']),'outer':manifest(out,receipt['files'])},'source':{},'prior':{},'compact':{}}
for name,digest in prior['files'].items():assert file_sha(root/'evidence/e9-t05/verifier'/name)==digest,name
for name,digest in prior['external_proofs'].items():assert file_sha(root/name)==digest,name
for name,digest in prior['source_sha256'].items():assert file_sha(root/name)==digest,name
r['prior']={'authenticated_files':len(prior['files']),'authenticated_external_proofs':len(prior['external_proofs']),'source_count':len(prior['source_sha256']),'verdict_carried':prior['verdict'],'audit_sha256':file_sha(root/'evidence/e9-t05/verifier/audit.md')}
for e in p['files']:
 checkfile(compact/e['path'],e); source=accept/e['source']; assert source.stat().st_size==e['source_bytes'];assert file_sha(source)==e['source_sha256']
 decoded=(gzip.decompress if e['encoding']=='gzip' else lambda x:x)((compact/e['path']).read_bytes()); assert len(decoded)==e['source_bytes'] and sha(decoded)==e['source_sha256'],e['path']
for e in p['aliases']:
 assert file_sha(accept/e['source'])==e['source_sha256']; assert sha(gzip.decompress((compact/e['packet']).read_bytes()))==e['source_sha256']
for e in p['outer_files']:checkfile(compact/e['path'],e); checkfile(Path(e['source']),e)
assert p['original_file_count']==len(a['files'])+1==541
assert p['original_report_sha256']==file_sha(accept/'report.json')
assert receipt['wrapper_sha256']==file_sha(root/'target/e9-t05-cold-wrapper.py')==file_sha(compact/'wrapper.source.py')
r['compact']={'copies':len(p['files']),'aliases':len(p['aliases']),'outer_copies':len(p['outer_files']),'acceptance_originals':p['original_file_count'],'provenance_sha256':file_sha(compact/'provenance.json')}
clone=Path(receipt['clone']); assert git('rev-parse','HEAD',cwd=clone).decode().strip()==freeze
assert not git('status','--porcelain','--untracked-files=all',cwd=clone)
assert not (clone/'.git/objects/info/alternates').exists()
assert receipt['source_sha256']==a['source_sha256']
for name,digest in a['source_sha256'].items():
 assert file_sha(clone/name)==digest and file_sha(root/name)==digest,name
 assert sha(git('show',freeze+':'+name))==digest,name
r['source']={'count':len(a['source_sha256']),'frozen_head':freeze,'runtime_head':runtime,'current_head':git('rev-parse','HEAD').decode().strip(),'clone_clean':True,'alternates':False}
between=git('diff','--name-only',runtime,freeze).decode().splitlines(); current=git('diff','--name-only',freeze,'HEAD').decode().splitlines()
assert [x for x in between if not x.startswith(('evidence/','tasks/'))]==['tools/verify/e9-software-checkpoints-critic.mjs']
allowed={'web/tasks.json','web/dist/tasks.json','web/dist/sw.js'}
assert not [x for x in current if not x.startswith(('evidence/','tasks/')) and x not in allowed]
r['source']['runtime_to_tests_nonmetadata']=[x for x in between if not x.startswith(('evidence/','tasks/'))];r['source']['post_freeze_nonmetadata']=[x for x in current if not x.startswith(('evidence/','tasks/'))]
commands=a['commands']; assert len(commands)==20 and all(e['exit_code']==0 for e in commands)
tree=ast.parse((clone/'tools/verify/e9-software-checkpoints.py').read_text()); calls=sorted([n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='run'],key=lambda n:n.lineno)
assert [ast.literal_eval(n.args[0]) for n in calls]==[e['name'] for e in commands]
for call,e in zip(calls,commands):
 if e['name']!='browser':assert ast.literal_eval(call.args[1])==e['command'],e['name']
 else:assert e['command']==['node','tools/verify/e9-software-checkpoints-browser.mjs','--output',str(accept/'browser')]
assert len(receipt['commands'])==5 and all(e['exit_code']==0 for e in receipt['commands'])
assert receipt['commands'][-1]['command']==['make','verify-E9-T05'] and receipt['commands'][-1]['cwd']==str(clone)
r['commands']={'names':[e['name'] for e in commands],'count':len(commands),'all_exit_zero':True,'frozen_harness_matches':True,'wrapper_command_count':len(receipt['commands'])}
for name in ['core-native','checkpoint-native','frame-native','storage-native','boundary-native','adapter-native','shared-node-wasm','worker-protocol']:
 log=(accept/(name+'.log')).read_text(); assert not re.search(r'test result: FAILED|^not ok ',log,re.M),name
r['expected_panics']={'core-native':['hart::regs::tests::out_of_range_read_panics','hart::regs::tests::out_of_range_write_panics'],'citation':'core-native.log:410-418, both should panic ... ok; 399/0 at :559'}
r['native_recorded_results']={name:re.findall(r'test result: [^\n]+', (accept/(name+'.log')).read_text()) for name in ['core-native','checkpoint-native','frame-native','storage-native','boundary-native','adapter-native','shared-node-wasm']}
imports=re.compile(r"""(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]""")
def identity(web):
 web=web.resolve();names=set()
 def include(path):
  path=path.resolve()
  if path==web/'gpu-checkpoint-build.js' or path in names:return
  assert path.is_relative_to(web) and path.is_file(),str(path); names.add(path)
  if path.suffix in ('.js','.mjs'):
   for m in imports.finditer(path.read_text()):include(path.parent/m.group(1))
 for name in ['linux-worker.js','linux-worker-protocol.js','loader.js','gpu-checkpoint.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session_bg.wasm']:include(web/name)
 for path in (web/'renderer').rglob('*'):
  if path.is_file() and path.suffix in ('.mjs','.wasm'):include(path)
 d=hashlib.sha256(b'wasm-vm-production-gpu-worker-v1\0')
 for path in sorted(names):
  body=path.read_bytes();d.update(str(path.relative_to(web)).encode()+b'\0'+len(body).to_bytes(8,'little')+body)
 return {'runtime':d.hexdigest(),'files':len(names),'wasm_sha256':file_sha(web/'pkg/wasm_vm_wasm_bg.wasm'),'wasm_bytes':(web/'pkg/wasm_vm_wasm_bg.wasm').stat().st_size}
expected={'runtime':'c404e41c43d7912f5ae2886848724d018b515cc5d1a668a15105ba3f54b232bc','wasm_sha256':'71ab136a773611c06e409a7b998c65a477af64b5a42cb056f7b60bd2c165d027','wasm_bytes':1864397}
r['builds']={}
for name,web in [('current',root/'web'),('dist',root/'web/dist'),('cold',clone/'web')]:
 got=identity(web); assert all(got[k]==v for k,v in expected.items()),(name,got);r['builds'][name]=got
r['status']='passed';(final/'cold-authentication.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({k:v for k,v in r.items() if k in ['status','originals','prior','compact','source','commands','builds']},indent=2))
