import hashlib,json,os,pathlib,shutil,subprocess,tempfile,time
repo=pathlib.Path('/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm')
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
base=pathlib.Path(tempfile.mkdtemp(prefix='wasm-vm-captured-shaders-cold-')); clone=base/'wasm-vm'
pathlib.Path('/tmp/wasm-vm-virgl-captured-cold-path.txt').write_text(str(clone)+'\n')
out=repo/'evidence/virgl-captured-shaders/cold-clone';out.mkdir(parents=True,exist_ok=False)
shutil.copyfile(__file__,out/'cold-proof.py')
env=dict(os.environ); removed=[]
for key in list(env):
 if key.startswith('CARGO_') or key in ('RUSTFLAGS','RUST_LOG','PYTHONPATH','PYTHONHOME','CC','CFLAGS','CPPFLAGS','LDFLAGS','CHROME'):
  removed.append(key);env.pop(key)
env['EMCC']='/tmp/wasm-vm-emsdk/wasm-vm-emcc';env['VIRGL_CAPTURED_SHADER_EVIDENCE_DIR']='target/evidence/virgl-captured-shaders-cold'
commands=[['git','clone','--shared','--branch','codex/virgl-captured-shaders',str(repo),str(clone)],['make','verify-E6-T10d']]
report={'head':head,'clone':str(clone),'commands':commands,'scrubbedNames':sorted(removed),'status':'running'}
try:
 with (out/'cold.log').open('w') as log:
  subprocess.run(commands[0],env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
  actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip();assert actual==head
  report['statusBefore']=subprocess.check_output(['git','status','--porcelain'],cwd=clone,text=True);assert report['statusBefore']==''
  subprocess.run(commands[1],cwd=clone,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=600)
  report['statusAfter']=subprocess.check_output(['git','status','--porcelain'],cwd=clone,text=True);assert report['statusAfter']==''
 shutil.copytree(clone/env['VIRGL_CAPTURED_SHADER_EVIDENCE_DIR'],out/'acceptance')
 receipt=json.loads((out/'acceptance/receipt.json').read_text());assert receipt['status']=='passed' and receipt['head']==head
 report['acceptanceReceiptSha256']=hashlib.sha256((out/'acceptance/receipt.json').read_bytes()).hexdigest();report['status']='passed'
except Exception as error:
 report['status']='failed';report['error']=str(error);raise
finally:
 report['logSha256']=hashlib.sha256((out/'cold.log').read_bytes()).hexdigest()
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
