from pathlib import Path
import hashlib,json,os,subprocess,time
root=Path.cwd();prior=root/'target/evidence/e9-t10-cold-final-2';old=json.loads((prior/'receipt.json').read_text());clone=Path(old['clone']);head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();out=root/'target/evidence/e9-t10-cold-final-incremental';out.mkdir(exist_ok=False)
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')and not k.startswith(('CARGO_','GIT_'))};env.update(GIT_OPTIONAL_LOCKS='0',E9_INPUT_REUSE=str(prior/'acceptance'),E9_INPUT_EVIDENCE_DIR=str(out/'acceptance'))
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=clone,env=env)
metadata=Path(git('rev-parse','--absolute-git-dir').decode().strip());assert not(metadata/'objects/info/alternates').exists()
assert old['compiler_storage']['initial_entries']==[]and git('rev-parse','HEAD').decode().strip()==old['head']and not git('status','--porcelain','--untracked-files=all')
report={'task':'E9-T10','status':'running','head':head,'runtime_head':old['head'],'clone':str(clone),'started':time.time(),'commands':[],
 'pristine_origin':{'receipt':str(prior/'receipt.json'),'sha256':sha(prior/'receipt.json'),'original_compiler_storage':old['compiler_storage'],'source_relocation':str(prior/'source-relocation.json'),'source_relocation_sha256':sha(prior/'source-relocation.json')},
 'scope':'Continue the same pristine-origin proof after an oracle-only correction. Runtime/native/wasm/browser recordings are unchanged and authenticated by the reuse target. Only policy, reuse safety, independent native/browser oracles and the previously unrun retained GPU regression execute again. No external target or node_modules state is imported.'}
def run(command):
 with(out/'commands.log').open('ab')as log:r=subprocess.run(command,cwd=clone,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=1800)
 report['commands'].append({'command':command,'exit_code':r.returncode});assert r.returncode==0,command
try:
 run(['git','fetch','--no-tags',str(root),head]);run(['git','checkout','--detach',head]);assert not git('status','--porcelain','--untracked-files=all')
 run(['make','verify-E9-T10']);result=json.loads((out/'acceptance/report.json').read_text());assert result['status']=='passed'and result['head']==head and result['runtime_head']==old['head']
 assert not git('status','--porcelain','--untracked-files=all')and not(metadata/'objects/info/alternates').exists()
 report['source_sha256']={name:sha(clone/name)for name in result['source_sha256']};assert report['source_sha256']==result['source_sha256'];report['status']='passed'
except BaseException as error:report['status']='failed';report['failure']=str(error);raise
finally:
 report['wrapper_sha256']=sha(Path(__file__));report['finished']=time.time();report['files']=[{'path':str(f.relative_to(out)),'bytes':f.stat().st_size,'sha256':sha(f)}for f in sorted(out.rglob('*'))if f.is_file()and f!=out/'receipt.json'];(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],out,flush=True)
