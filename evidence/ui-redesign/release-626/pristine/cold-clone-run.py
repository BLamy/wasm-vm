import hashlib,json,os,pathlib,shutil,socket,subprocess,sys,tempfile,time
root=pathlib.Path(sys.argv[1]).resolve()
out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
shutil.copyfile(__file__,out/'cold-clone-run.py')
def git(*args):return subprocess.check_output(['git','-C',str(root),*args],text=True).strip()
subprocess.run(['git','-C',str(root),'diff','--quiet','HEAD'],check=True)
head=git('rev-parse','HEAD');branch=git('branch','--show-current')
common=pathlib.Path(git('rev-parse','--git-common-dir'))
if not common.is_absolute():common=(root/common).resolve()
clone=pathlib.Path(tempfile.mkdtemp(prefix='wasm-vm-ui-pristine-'))/'repo'
env={k:v for k,v in os.environ.items() if not(k.startswith('CARGO_') or k in ('RUSTFLAGS','RUST_LOG','RUSTDOCFLAGS','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','RUSTC','RUSTDOC','RUSTUP_TOOLCHAIN','CMAKE_ARGS','NODE_OPTIONS'))}
scrubbed=sorted(set(os.environ)-set(env))
with socket.socket() as proof_socket:
 proof_socket.bind(('127.0.0.1',0));proof_port=proof_socket.getsockname()[1]
env['PLAYWRIGHT_PORT']=str(proof_port)
env['PLAYWRIGHT_REUSE_SERVER']='0'
report={'head':head,'branch':branch,'clone':str(clone),'scrubbed_names':scrubbed,'playwright_port':proof_port,'steps':[],'clone_mode':'local Git clone; program source checked out from Git; tracked evidence uses APFS clonefile verified against Git; no ignored build/dependency cache copied'}
start=time.time()
with (out/'cold-clone.log').open('w') as log:
 def run(label,args,cwd=None,input_bytes=None):
  print('\n'+label+'\n$ '+' '.join(args),file=log,flush=True)
  t=time.time();r=subprocess.run(args,cwd=cwd,env=env,input=input_bytes,stdout=log,stderr=subprocess.STDOUT)
  report['steps'].append({'name':label,'exit':r.returncode,'seconds':round(time.time()-t,2)})
  if r.returncode:
   (out/'cold-clone.json').write_text(json.dumps(report,indent=2)+'\n');raise SystemExit(r.returncode)
 run('fresh full Git clone (immutable objects may be hardlinked; history is an explicit corpus and roadmap input)',['git','clone','--quiet','--local','--no-checkout','--single-branch','--branch',branch,str(common),str(clone)])
 run('detach at the exact frozen head (no working tree materialization yet)',['git','update-ref','--no-deref','HEAD',head],clone)
 run('populate a fresh index from the frozen Git tree',['git','read-tree',head],clone)
 actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip();assert actual==head,(actual,head)
 # The tree contains15.4 GB of tracked historical recordings. Materialize those exact immutable
 # inputs with APFS clonefile, avoiding duplicate allocation. All program source is checked out
 # by Git. No ignored target/, node_modules/, generated pkg/ or other cache can enter this list.
 rows=[]
 for raw in subprocess.check_output(['git','ls-tree','-rlz',head],cwd=clone).split(b'\0'):
  if not raw:continue
  meta,name=raw.split(b'\t',1);mode,kind,oid,size=meta.split()
  if kind!=b'blob':raise RuntimeError('Unexpected non-blob tracked entry: '+name.decode())
  rows.append((mode.decode(),name.decode(),int(size)))
 normal=[name for mode,name,size in rows if not name.startswith('evidence/')]
 evidence=[(mode,name,size) for mode,name,size in rows if name.startswith('evidence/')]
 run('checkout every non-evidence source path directly from Git',['git','checkout-index','-u','--stdin','-z'],clone,b'\0'.join(name.encode() for name in normal)+b'\0')
 assert git('rev-parse','HEAD')==head,'Source checkout moved during materialization'
 t=time.time();groups={};symlinks=[]
 for mode,name,size in evidence:
  source=root/name;destination=clone/name
  if not source.exists() and not source.is_symlink():raise RuntimeError('Missing frozen tracked evidence '+name)
  destination.parent.mkdir(parents=True,exist_ok=True)
  if mode=='120000':symlinks.append((source,destination));continue
  groups.setdefault(destination.parent,[]).append((source,destination,mode))
 print('APFS clonefile materialization: '+str(len(evidence))+' tracked evidence files',file=log,flush=True)
 for parent,entries in groups.items():
  for offset in range(0,len(entries),64):
   batch=entries[offset:offset+64]
   subprocess.run(['cp','-c','-p',*[str(source) for source,destination,mode in batch],str(parent)],check=True,stdout=log,stderr=subprocess.STDOUT,env=env)
   for source,destination,mode in batch:destination.chmod(0o755 if mode=='100755' else 0o644)
 for source,destination in symlinks:destination.symlink_to(os.readlink(source))
 report['steps'].append({'name':'APFS clonefile materialization of tracked immutable evidence','exit':0,'seconds':round(time.time()-t,2)})
 report['tracked_evidence_materialization']={'files':len(evidence),'bytes':sum(size for mode,name,size in evidence),'method':'APFS clonefile from matching frozen tracked files; authenticated by fresh Git index and full diff','source_head':head}
 run('authenticate the complete fresh working tree against the frozen Git commit',['git','diff','--quiet','HEAD'],clone)
 report['tracked_clean_before_build']=True
 for cache in ['target','web/node_modules','web/pkg','web/session-pkg']:
  if (clone/cache).exists():raise RuntimeError('Unexpected preexisting ignored build cache: '+cache)
 report['no_ignored_build_caches_before_build']=True
 # Explicit external inputs: the committed artifact manifests identify these staged bytes.
 # No target/, node_modules/, generated pkg/ or other ignored build products are copied.
 (clone/'releases').mkdir(exist_ok=True)
 run('stage declared release artifacts',['cp','-cR',str(root/'releases')+'/.',str(clone/'releases')])
 manifests=['web/artifacts.json','web/artifacts-alpine.json','web/artifacts-node-alpine.json','web/artifacts-omarchy.json','web/artifacts-omarchy-virgl.json']
 run('validate all declared external inputs',['python3','tools/validate-deploy-artifacts.py','--root',str(clone),'--reject-remote',*[a for m in manifests for a in ['--manifest',m]]],clone)
 run('build from pristine source and scrubbed environment',['bash','tools/build-web-dist.sh'],clone)
 run('combined UI and current Docstream acceptance in the pristine clone',['bash','tools/verify-ui-docs.sh'],clone)
 report['tracked_changes']=subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=clone,text=True).splitlines()
 report['dist_diff']=[p for p in report['tracked_changes'] if p.startswith('web/dist/')]
 report['generated_source_metadata_changes']=[p for p in report['tracked_changes'] if p == 'web/tasks.json']
 report['unexpected_source_changes']=[p for p in report['tracked_changes'] if not p.startswith('web/dist/') and p != 'web/tasks.json']
 if report['generated_source_metadata_changes']:
  before=json.loads(subprocess.check_output(['git','show','HEAD:web/tasks.json'],cwd=clone,text=True))
  after=json.loads((clone/'web/tasks.json').read_text())
  # Git activity gains the frozen commit itself. Everything semantic must remain identical.
  activity_fields={'activity','firstActivity','lastActivity','commitCount'}
  def stable_tasks(value):
   return {**{k:v for k,v in value.items() if k not in ('tasks','activityRange')},'tasks':[{k:v for k,v in row.items() if k not in activity_fields} for row in value['tasks']]}
  report['generated_task_semantics_unchanged']=stable_tasks(before)==stable_tasks(after)
  (out/'cold-clone-task-metadata.diff').write_text(subprocess.check_output(['git','diff','--','web/tasks.json'],cwd=clone,text=True))
  if not report['generated_task_semantics_unchanged']:
   (out/'cold-clone.json').write_text(json.dumps(report,indent=2)+'\n');raise SystemExit('Generated task semantics differ from committed snapshot; reconcile before acceptance')
 if report['unexpected_source_changes']:
  (out/'cold-clone.json').write_text(json.dumps(report,indent=2)+'\n');raise SystemExit('Pristine acceptance changed tracked source: '+', '.join(report['unexpected_source_changes']))
 files=sorted(p for p in (clone/'web/dist').rglob('*') if p.is_file())
 report['dist_file_count']=len(files)
 hashes={str(p.relative_to(clone)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
 (out/'cold-clone-dist-sha256.json').write_text(json.dumps(hashes,indent=2)+'\n')
 report['seconds']=round(time.time()-start,2)
 (out/'cold-clone.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2),file=log)
print(json.dumps(report,indent=2))
