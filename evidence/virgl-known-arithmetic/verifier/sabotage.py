#!/usr/bin/env python3
"""Mutate only a scratch source copy and make the independent tests refute it."""
from pathlib import Path
import subprocess,shutil,json,hashlib,os
ROOT=Path(__file__).resolve().parents[3];E=Path(__file__).parent;O=ROOT/'target/evidence/virgl-known-arithmetic-critic';S=O/'sabotage-source';S.mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
shutil.copytree(ROOT/'renderer/virgl-shader',S,dirs_exist_ok=True,ignore=shutil.ignore_patterns('build','__pycache__'))
p=S/'raw_known_arithmetic.h';before=p.read_bytes();needle=b'tail == 4 && (rounded & 1)';replacement=b'tail == 4';assert before.count(needle)==1
p.write_bytes(before.replace(needle,replacement));(O/'sabotage.diff').write_text(subprocess.run(['diff','-u',str(ROOT/'renderer/virgl-shader/raw_known_arithmetic.h'),str(p)],stdout=subprocess.PIPE,text=True).stdout)
prediction={'schema':'virgl-known-arithmetic-critic-sabotage-prediction-v1','beforeExecution':True,'originalSourceSha256':sha(before),'mutatedSourceSha256':sha(p.read_bytes()),'mutation':'Round every binary32 tie upward in magnitude, discarding RN-even parity.','prediction':'Independent rational WORD 4 (+1 + 2^-24) expects 0x3f800000. The actual mutated native test must exit nonzero before public fixtures and report 3f800001 != 3f800000. Runtime worktree and original worker seals remain untouched.'}
(E/'sabotage-prediction.json').write_text(json.dumps(prediction,indent=2)+'\n')
with(O/'sabotage-build.log').open('w')as log:subprocess.run(['bash','build.sh','known-arithmetic-sanitize'],cwd=S,stdout=log,stderr=subprocess.STDOUT,check=True)
binary=S/'build/known-arithmetic-sanitize/known-test';env=dict(os.environ,LLVM_PROFILE_FILE=str(O/'sabotage.profraw'),ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1')
p=subprocess.run([str(binary)],input=(O/'independent-cases.bin').read_bytes(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
(O/'sabotage.log').write_bytes(p.stdout);(O/'sabotage.stderr').write_bytes(p.stderr)
assert p.returncode!=0 and b'3f800001 != 3f800000'in p.stderr,p.stderr.decode()
# The submitted new worker fixtures must fail under exactly the same real source fault.
q=subprocess.run([str(binary)],input=(O/'unpacked/hot/native/cases.bin').read_bytes(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**env,'LLVM_PROFILE_FILE':str(O/'sabotage-worker.profraw')})
(O/'sabotage-worker.log').write_bytes(q.stdout);(O/'sabotage-worker.stderr').write_bytes(q.stderr)
assert q.returncode!=0 and b'independent rational prediction'in q.stderr,q.stderr.decode()
report={'schema':'virgl-known-arithmetic-critic-sabotage-v1','task':'E6-T12g6m1','status':'HELD','predictionSha256':sha((E/'sabotage-prediction.json').read_bytes()),'binarySha256':sha(binary.read_bytes()),'mutatedSourceSha256':prediction['mutatedSourceSha256'],'criticFixtureSha256':sha((O/'independent-cases.bin').read_bytes()),'criticExitCode':p.returncode,'criticStderr':p.stderr.decode(),'criticStderrSha256':sha(p.stderr),'workerExitCode':q.returncode,'workerStderr':q.stderr.decode(),'workerStderrSha256':sha(q.stderr),'originalWorktreeSourceUntouched':(ROOT/'renderer/virgl-shader/raw_known_arithmetic.h').read_bytes()==before}
(E/'sabotage.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
