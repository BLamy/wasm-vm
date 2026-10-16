#!/usr/bin/env python3
import hashlib,json,os,pathlib,subprocess,time
repo=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent/'promoted';out.mkdir()
paths=['crates/core/tests/virtio_gpu_control3d.rs','crates/core/tests/virtio_gpu_control3d/desktop_critic.rs'];pins={}
for path in paths:
 raw=(repo/path).read_bytes();pins[path]=hashlib.sha256(raw).hexdigest();p=out/'sources'/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
env={k:v for k,v in os.environ.items() if not k.startswith(('RUST','CARGO_','LLVM_PROFILE'))};steps=[]
commands=[('format',['cargo','fmt','--check','-p','wasm-vm-core']),('clippy',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--test','virtio_gpu_control3d','--features','virgl-control-proof,gpu-trace,trace','--','-D','warnings']),('ownership',['cargo','test','--offline','-p','wasm-vm-core','--features','virgl-control-proof,gpu-trace,trace','--test','virtio_gpu_control3d','desktop_critic::','--','--nocapture','--test-threads=1'])]
for name,cmd in commands:
 began=time.monotonic();p=subprocess.run(cmd,cwd=repo,env=env,capture_output=True,timeout=300)
 (out/(name+'.stdout')).write_bytes(p.stdout);(out/(name+'.stderr')).write_bytes(p.stderr)
 steps.append({'name':name,'command':cmd,'exitCode':p.returncode,'elapsedSeconds':time.monotonic()-began,'stdoutSha256':hashlib.sha256(p.stdout).hexdigest(),'stderrSha256':hashlib.sha256(p.stderr).hexdigest()});assert p.returncode==0,(name,p.stderr[-4000:])
report={'schema':'desktop-control-critic-promoted-v1','submissionHead':'0186b314c591d066227541ce5d3965eb9edad723','testSources':pins,'commands':steps,'runtimeChanged':False};(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
