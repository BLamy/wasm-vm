from pathlib import Path
import ast,copy,hashlib,json,os,shutil,subprocess,tempfile
root=Path.cwd();out=root/'target/evidence/e9-t10-verifier';env=dict(os.environ,GIT_OPTIONAL_LOCKS='0');old=root/'target/evidence/e9-t10-worker-final-2';original=json.loads((old/'report.json').read_bytes());freeze='fafa1d63b5fa584df445e0c967ea52af966de5f8';scratch=Path(tempfile.mkdtemp(prefix='proof-attack-',dir=out));repo=scratch/'repo';runs=[]
def run(cmd,cwd,**kw):return subprocess.run(cmd,cwd=cwd,env=env,capture_output=True,text=True,timeout=60,**kw)
r=run(['git','clone','--local','--no-checkout','--single-branch',str(root),str(repo)],root);assert r.returncode==0,r.stderr
paths={'.gitignore'}|set(json.loads((root/'evidence/e9-t10/worker-final/report.json').read_bytes())['source_sha256'])
r=run(['git','sparse-checkout','set','--no-cone','--stdin'],repo,input='\n'.join('/'+p for p in sorted(paths))+'\n');assert r.returncode==0,r.stderr
r=run(['git','checkout','--detach',freeze],repo);assert r.returncode==0,r.stderr
(repo/'target').mkdir()
assert run(['git','status','--porcelain','--untracked-files=all'],repo).stdout==''
r=run(['python3','-B','tools/verify/tests/test_e9_input_recording_resume.py','--recorded',str(old),'--output',str(out/'proof-reuse-safety-independent.json')],repo)
assert r.returncode==0,(r.stdout,r.stderr);runs.append({'name':'four-frozen-harness-attack-cases','exit':r.returncode,'stdout':r.stdout})
base=scratch/'symlink-recording';base.mkdir();value=copy.deepcopy(original);name='outside-artifact';(base/name).symlink_to(old/'format.log');value['files'].insert(0,{'path':name,'bytes':0,'sha256':hashlib.sha256(b'').hexdigest()});(base/'report.json').write_text(json.dumps(value));result=scratch/'must-not-exist'
r=run(['python3','-B','tools/verify/e9-input-recording-resume.py','--recorded',str(base),'--output',str(result)],repo)
assert r.returncode!=0 and 'artifact escapes recording'in r.stderr and not result.exists(),r.stderr
runs.append({'name':'novel-external-symlink','prediction':'artifact escapes recording before creating output','status':'HELD','exit':r.returncode,'stderr':r.stderr})
# Sabotage original native-oracle evidence only in a private test copy.
native=scratch/'native';shutil.copytree(root/'target/evidence/e9-t10-worker-final-incremental/native',native)
cmd=['python3','-B',str(root/'tools/verify/e9-input-recording-files.py'),'--directory',str(native)]
r=run(cmd,root);assert r.returncode==0,r.stderr;runs.append({'name':'native-oracle-baseline','exit':r.returncode,'stdout':r.stdout})
p=native/'keyboard-focus-release.bin';b=bytearray(p.read_bytes());assert b[36]==0;b[36]=1;p.write_bytes(b)
r=run(cmd,root);assert r.returncode!=0 and 'AssertionError'in r.stderr,r.stderr;runs.append({'name':'key-release-sabotage','prediction':'an A release value changed from 0 to 1 at byte 36 fails the independent guest oracle','status':'HELD','exit':r.returncode,'stderr':r.stderr})
report={'status':'HELD','freeze':freeze,'source_report_sha256':hashlib.sha256((old/'report.json').read_bytes()).hexdigest(),'runs':runs,'scratch':str(scratch),'native_sabotage_byte':36}
(out/'proof-attacks.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));shutil.rmtree(scratch)
