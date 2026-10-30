"""Finish the unchanged-runtime cold recording after the source-boundary audit was refreshed."""
from pathlib import Path
import hashlib,json,os,subprocess,time
root=Path.cwd();head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
oldroot=root/'target/evidence/e9-t12-worker-cold-final';cold=json.loads((oldroot/'receipt.json').read_text());old=(oldroot/'acceptance').resolve();prior=json.loads((old/'report.json').read_text())
assert prior['status']=='failed'and prior['failure']=='contract failed; see recorded log'
delta=subprocess.check_output(['git','diff','--name-only',prior['head'],head],text=True).splitlines()
assert set(delta)=={'docs/design/session-replay.md','docs/design/session-replay-contract.json'},delta
source=Path(cold['clone']);outroot=root/'target/evidence/e9-t12-worker-cold-completed-v2';outroot.mkdir(exist_ok=False)
out=Path('/Volumes/e9-t11-cold-scratch')/('completed-proof-e9-t12-'+head[:12]+'-v2');assert not out.exists();out.mkdir();(outroot/'acceptance').symlink_to(out,target_is_directory=True)
(out/'held').symlink_to(old,target_is_directory=True);(out/'native').symlink_to(old/'native',target_is_directory=True)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for part in iter(lambda:f.read(1<<20),b''):h.update(part)
 return h.hexdigest()
env={k:v for k,v in os.environ.items()if not k.startswith(('CARGO_','GIT_'))and k not in('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER')}
env['GIT_OPTIONAL_LOCKS']='0'
report={'task':'E9-T12','status':'running','head':head,'runtime_head':prior['head'],'started':time.time(),'commands':[],'cold_origin':{'receipt':str(oldroot/'receipt.json'),'receipt_sha256':sha(oldroot/'receipt.json'),'original_source':str(source),'original_compiler':str(cold.get('compiler_storage',{}).get('target')),'metadata_delta':delta,'initial_compiler_empty':cold['compiler_storage']['initial_entries']==[],'no_inherited_compiler_cache':cold['compiler_storage']['no_inherited_compiler_cache']},'held_origin':{'report':str(old/'report.json'),'sha256':sha(old/'report.json'),'reason':'Only documentation and source hash/anchor inventory changed. Every recorded runtime/test/build source and dependency digest is unchanged. The contract gate demanded this re-audit; runtime semantics were not refuted.','commands':[c for c in prior['commands']if c['exit_code']==0 and c['name']!='documentation']},'scope':'Incremental high-risk submission: retain the pristine native/Wasm build recording and execute all missing proofs against the refreshed exact-head contract. Original recordings remain untouched.'}
def run(name,command,timeout=1800):
 print(name,flush=True)
 with(out/(name+'.log')).open('wb')as log:r=subprocess.run(command,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 report['commands'].append({'name':name,'command':command,'exit_code':r.returncode});(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');assert r.returncode==0,name
try:
 for item in prior['files']:
  f=old/item['path'];assert f.stat().st_size==item['bytes']and sha(f)==item['sha256']
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=source,env=env)
 run('fetch-audit',['git','fetch','--quiet','origin','codex/e9-device-completions'])
 run('checkout-audit',['git','checkout','--detach',head])
 for name,digest in prior['source_sha256'].items():assert sha(source/name)==digest,name
 report['source_sha256']=prior['source_sha256'];report['audit_sha256']={name:sha(source/name)for name in delta};report['runtime_and_dependency_digests_unchanged']=True
 run('format',['cargo','fmt','--all','--check'])
 run('documentation',['node','tools/check-docs.mjs'])
 run('contract',['python3','tools/verify/e9-session-contract.py'])
 run('native-guest-oracle',['python3','-B','tools/verify/e9-device-completions-files.py','--directory',str(out/'native')])
 run('retained-gpu-integrity',['python3','tools/verify/e9-retained-gpu-runtime.py'])
 run('browser',['node','tools/verify/e9-device-completions-browser.mjs','--output',str(out/'browser')],1800)
 run('browser-guest-and-object-oracle',['python3','-B','tools/verify/e9-device-completions-files.py','--directory',str(out/'browser'),'--browser'])
 run('retained-gpu-browser',['node','tools/verify/e9-retained-gpu-browser.mjs','--output',str(out/'retained-gpu-browser')],1200)
 for directory in ['browser','retained-gpu-browser']:
  r=json.loads((out/directory/'report.json').read_text());assert r['status']=='passed'and r['head']==head and not r['development']and not r['errors']
 assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=source,env=env)
 report['status']='passed'
except BaseException as error:report['status']='failed';report['failure']=str(error);raise
finally:
 report['wrapper_sha256']=sha(Path(__file__));report['finished']=time.time();files=[{'path':str(f.relative_to(out)),'bytes':f.stat().st_size,'sha256':sha(f)}for f in sorted(out.rglob('*'))if f.is_file()and f!=out/'report.json'];files +=[{'path':'held/'+item['path'],'bytes':item['bytes'],'sha256':item['sha256']}for item in prior['files']];files.append({'path':'held/report.json','bytes':(old/'report.json').stat().st_size,'sha256':sha(old/'report.json')});report['files']=files;(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');(outroot/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],out,flush=True)
