#!/usr/bin/env python3
import hashlib,json,os,pathlib,subprocess,time
repo=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent/'fresh';out.mkdir(exist_ok=True)
env={k:v for k,v in os.environ.items() if not k.startswith(('RUST','CARGO_','LLVM_PROFILE'))}
steps=[]
commands=[('format',['cargo','fmt','--check','-p','wasm-vm-core']),('clippy-selected',['cargo','clippy','--offline','-p','wasm-vm-core','--lib','--test','virtio_gpu_control3d','--features','virgl-control-proof,gpu-trace,trace','--','-D','warnings']),('native-control',['cargo','test','--offline','-p','wasm-vm-core','--features','virgl-control-proof,gpu-trace,trace','--test','virtio_gpu_control3d','--','--nocapture','--test-threads=1']),('native-gpu-default',['cargo','test','--offline','-p','wasm-vm-core','--lib','dev::virtio::gpu::','--','--test-threads=1']),('native-machine-selected',['cargo','test','--offline','-p','wasm-vm-core','--features','virgl-control-proof,gpu-trace,trace','--test','virtio_gpu_machine','--','--test-threads=1'])]
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();assert head=='0186b314c591d066227541ce5d3965eb9edad723'
for name,cmd in commands:
 print(name,flush=True);began=time.monotonic();p=subprocess.run(cmd,cwd=repo,env=env,capture_output=True,timeout=600)
 for ext,b in [('stdout',p.stdout),('stderr',p.stderr)]: (out/(name+'.'+ext)).write_bytes(b)
 steps.append({'name':name,'command':cmd,'exitCode':p.returncode,'elapsedSeconds':time.monotonic()-began,'stdoutSha256':hashlib.sha256(p.stdout).hexdigest(),'stderrSha256':hashlib.sha256(p.stderr).hexdigest()})
 assert p.returncode==0,(name,p.stderr[-2000:])
report={'schema':'desktop-control-critic-fresh-v1','head':head,'removedEnvironmentPrefixes':['RUST','CARGO_','LLVM_PROFILE'],'commands':steps}
(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
