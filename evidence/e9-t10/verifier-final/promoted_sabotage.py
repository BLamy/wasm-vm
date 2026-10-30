from pathlib import Path
import json,os,shutil,subprocess,tempfile,hashlib
root=Path.cwd();out=root/'target/evidence/e9-t10-verifier';env=dict(os.environ,GIT_OPTIONAL_LOCKS='0')
with tempfile.TemporaryDirectory(prefix='pointer-order-sabotage-',dir=out)as tmp:
 tmp=Path(tmp)
 for name in ['web/tests/pointer.test.mjs','web/src/input/pointer.js','web/src/input/pointer.ts']:
  dest=tmp/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/name,dest)
 for name in ['pointer.js','pointer.ts']:
  p=tmp/'web/src/input'/name;s=p.read_text();assert s.count('pointerLockRequested = requestLock;\n    releaseAll(reason);')==1
  s=s.replace('pointerLockRequested = requestLock;\n    releaseAll(reason);','pointerLockRequested = requestLock;').replace('      publishMode(true);\n      notify(reason);','      publishMode(true);\n      releaseAll(reason);\n      notify(reason);');p.write_text(s)
 # Name filter proves the newly promoted order oracle detects the changed release boundary.
 cmd=['node','--test','--test-name-pattern=capture records releases before',str(tmp/'web/tests/pointer.test.mjs')]
 r=subprocess.run(cmd,cwd=root,env=env,text=True,capture_output=True,timeout=30)
 assert r.returncode!=0 and 'ℹ tests 4'in r.stdout and 'ℹ fail 4'in r.stdout,(r.stdout,r.stderr)
 (out/'promoted-pointer-sabotage.log').write_text(r.stdout+r.stderr)
 report={'status':'HELD','attack':'Move relative-mode publication before releasing the held tablet button in an isolated copy; keep JS/TS byte-identical','command':cmd,'exit_code':r.returncode,'new_tests_failed':4,'test_sha256':hashlib.sha256((root/'web/tests/pointer.test.mjs').read_bytes()).hexdigest(),'log_sha256':hashlib.sha256((out/'promoted-pointer-sabotage.log').read_bytes()).hexdigest()};(out/'promoted-sabotage.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
