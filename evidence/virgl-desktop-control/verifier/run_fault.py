#!/usr/bin/env python3
import hashlib,json,os,pathlib,subprocess,tempfile,time
repo=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent/'fault';out.mkdir()
hot=repo/'target/evidence/virgl-desktop-control-verifier/reopened/worker/hot';r=json.loads((hot/'receipt.json').read_bytes());detached=pathlib.Path(next(c for c in r['commands'] if c['name']=='fault-count')['cwd'])
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=detached,text=True).strip()=='e13dddfbb0d955abb268e4b4ac07828cbea35956'
changed=subprocess.check_output(['git','diff','--name-only'],cwd=detached,text=True).splitlines();assert changed==['crates/core/src/dev/virtio/gpu/control3d.rs']
original=(hot/'fault-source-original.rs').read_bytes();served=(detached/changed[0]).read_bytes();assert original.replace(b'self.resources.len() >= max_resources',b'self.resources.len() > max_resources')==served==(hot/'fault-source-served.rs').read_bytes()
(out/'source-original.rs').write_bytes(original);(out/'source-served.rs').write_bytes(served)
(out/'source-diff.patch').write_bytes(subprocess.check_output(['git','diff'],cwd=detached))
# Authenticate every other recorded native source in the existing detached fault copy.
for path,pin in r['sources'].items():
 actual=(detached/path).read_bytes()
 assert actual==served if path==changed[0] else hashlib.sha256(actual).hexdigest()==pin['sha256'],path
scratch=pathlib.Path(tempfile.mkdtemp(prefix='wasmvm-desktop-critic-fault-'));(scratch/'tests').mkdir()
novel=out.parent/'novel';source=(novel/'critic.rs').read_bytes();manifest=(novel/'Cargo.toml').read_text().replace(str(repo/'crates/core'),str(detached/'crates/core')).replace('name="desktop-control-critic"','name="desktop-control-critic-fault"')
(scratch/'Cargo.toml').write_text(manifest);(scratch/'tests/critic.rs').write_bytes(source);(out/'Cargo.toml').write_text(manifest);(out/'critic.rs').write_bytes(source)
cmd=['cargo','test','--offline','--manifest-path',str(scratch/'Cargo.toml'),'--target-dir',str(repo/'target/virgl-desktop-control-critic-fault'),'--test','critic','desktop_critic_three_fresh_ownership_schedules','--','--nocapture','--test-threads=1']
env={k:v for k,v in os.environ.items() if not k.startswith(('RUST','CARGO_','LLVM_PROFILE'))};began=time.monotonic();p=subprocess.run(cmd,cwd=repo,env=env,capture_output=True,timeout=300)
(out/'stdout.log').write_bytes(p.stdout);(out/'stderr.log').write_bytes(p.stderr)
report={'schema':'desktop-control-critic-fault-v1','frozenHead':r['head'],'detached':str(detached),'scratch':str(scratch),'command':cmd,'originalSha256':hashlib.sha256(original).hexdigest(),'servedSha256':hashlib.sha256(served).hexdigest(),'oracleSourceSha256':hashlib.sha256(source).hexdigest(),'exitCode':p.returncode,'elapsedSeconds':time.monotonic()-began,'stdoutSha256':hashlib.sha256(p.stdout).hexdigest(),'stderrSha256':hashlib.sha256(p.stderr).hexdigest()}
(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));assert p.returncode==101 and b'critic-independent65-refusal' in p.stderr and b'entire independent response' in p.stderr,p.stderr[-3000:]
