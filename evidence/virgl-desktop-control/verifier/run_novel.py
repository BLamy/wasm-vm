#!/usr/bin/env python3
import hashlib,json,os,pathlib,re,subprocess,tempfile,time
repo=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent/'novel';out.mkdir()
scratch=pathlib.Path(tempfile.mkdtemp(prefix='wasmvm-desktop-critic-'));(scratch/'tests').mkdir()
helper=(repo/'crates/core/tests/virtio_gpu_control3d.rs').read_text().split('#[test]',1)[0]
helper=re.sub(r'#\[path = "virtio_gpu_control3d/desktop_resources.rs"\]\nmod desktop_resources;\n','',helper)
body=(out.parent/'critic-body.rs').read_text().replace('use super::*;\n','',1)
source=helper+'\n'+body
manifest='[package]\nname="desktop-control-critic"\nversion="0.0.0"\nedition="2024"\n[features]\ndefault=["virgl-control-proof","gpu-trace","trace"]\nvirgl-control-proof=[]\ngpu-trace=[]\ntrace=[]\nzicsr-stub=[]\n[dependencies]\nwasm-vm-core={path='+json.dumps(str(repo/'crates/core'))+',features=["virgl-control-proof","gpu-trace","trace"]}\n'
(scratch/'Cargo.toml').write_text(manifest);(scratch/'tests/critic.rs').write_text(source)
(out/'Cargo.toml').write_text(manifest);(out/'critic.rs').write_text(source)
cmd=['cargo','test','--offline','--manifest-path',str(scratch/'Cargo.toml'),'--target-dir',str(repo/'target/virgl-desktop-control-critic'),'--test','critic','--','--nocapture','--test-threads=1']
env={k:v for k,v in os.environ.items() if not k.startswith(('RUST','CARGO_','LLVM_PROFILE'))};began=time.monotonic();p=subprocess.run(cmd,cwd=repo,env=env,capture_output=True,timeout=900)
(out/'stdout.log').write_bytes(p.stdout);(out/'stderr.log').write_bytes(p.stderr)
report={'schema':'desktop-control-critic-novel-v1','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'command':cmd,'scratch':str(scratch),'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'exitCode':p.returncode,'elapsedSeconds':time.monotonic()-began,'stdoutSha256':hashlib.sha256(p.stdout).hexdigest(),'stderrSha256':hashlib.sha256(p.stderr).hexdigest(),'seeds':[0x31c7,0xb92d,0xe563],'guestExecution':False,'productionAuthority':False}
(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));assert p.returncode==0,p.stderr[-3000:].decode()
