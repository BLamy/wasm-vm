#!/usr/bin/env python3
"""Record the qualified device-completion boundary at one clean, frozen source head."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
env={k:v for k,v in os.environ.items()if k not in('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')and not k.startswith('CARGO_')}
env.update(E9_DEVICE_EVIDENCE=str(out/'native'),CARGO_TERM_COLOR='never',GIT_OPTIONAL_LOCKS='0')
report={'task':'E9-T12','status':'running','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'started':time.time(),'commands':[],
 'scope':'Owned immutable-base/local-COW block, named-console agent receive and guest-clocked S16 microphone completions. Pending requests, descriptor queues and cursor restore revoke old leases. Unqualified backends are refused; full Linux replay remains T14.'}
def sha(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for part in iter(lambda:f.read(1<<20),b''):h.update(part)
 return h.hexdigest()
def clean():assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=ROOT,env=env),'source must be clean'
def run(name,command,timeout=3600):
 print(name,flush=True);start=time.time()
 with(out/(name+'.log')).open('wb')as log:r=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 report['commands'].append({'name':name,'command':command,'seconds':time.time()-start,'exit_code':r.returncode});(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');assert r.returncode==0,name+' failed; see recorded log'
try:
 clean();run('policy',['python3','tools/check_task_policy.py']);run('format',['cargo','fmt','--all','--check']);run('guest-fixture',['python3','tools/verify/build-e9-device-guest.py'])
 run('native-clippy',['cargo','clippy','-p','wasm-vm-core','-p','wasm-vm-wasm','-p','wasm-vm-jit-runtime','--all-targets','--features','trace,virgl-renderer','--','-D','warnings'])
 run('core-native',['cargo','test','-p','wasm-vm-core','--lib','--features','trace,virgl-renderer','--','--nocapture'])
 run('device-and-session-native',['cargo','test','-p','wasm-vm-core','--features','trace,virgl-renderer','--test','e9_device_completions','--test','virtio_blk','--test','virtio_blk_torture','--test','virtio_blk_flush','--test','virtio_blk_quiesce','--test','virtio_snd','--test','virtio_snd_queue','--test','virtio_snd_capture','--test','virtio_snd_capture_config','--test','virtio_snd_release_capture','--test','virtio_snd_machine','--test','virtio_console','--test','snapshot_coherence','--test','cpu_resume','--test','e9_event_clock','--test','e9_input_boundary','--test','e9_time_entropy','--','--nocapture'])
 run('native-guest-oracle',['python3','-B','tools/verify/e9-device-completions-files.py','--directory',str(out/'native')])
 run('jit-native',['cargo','test','-p','wasm-vm-jit-runtime','--test','e9_event_clock','--test','e9_event_clock_critic','--test','timekeeping','--test','batching','--','--nocapture'])
 run('boundary-native',['cargo','test','-p','wasm-vm-wasm','--lib','--test','software_checkpoint','--','--nocapture'])
 run('storage-native',['cargo','test','-p','wasm-vm-storage','--','--nocapture'])
 run('core-no-std-wasm',['cargo','build','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown'])
 run('boundary-wasm-clippy',['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--features','virgl-renderer','--lib','--','-D','warnings'])
 run('browser-build',['make','web-build'])
 for name in ['main.js','device-completions-probe.js','session-devices.js','session-inputs.js','roadmap.js','assets/e9-device-completions.bin','assets/e9-device-completions.elf','assets/e9-device-completions.json','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']:
  assert(ROOT/'web'/name).read_bytes()==(ROOT/'web/dist'/name).read_bytes(),'stale deploy bundle: '+name
 for name in ['web/main.js','web/device-completions-probe.js','web/session-devices.js','web/session-inputs.js','tools/verify/e9-device-completions-browser.mjs']:run('syntax-'+Path(name).stem,['node','--check',name])
 run('documentation',['node','tools/check-docs.mjs']);run('contract',['python3','tools/verify/e9-session-contract.py']);run('retained-gpu-integrity',['python3','tools/verify/e9-retained-gpu-runtime.py'])
 run('browser',['node','tools/verify/e9-device-completions-browser.mjs','--output',str(out/'browser')],1800)
 run('browser-guest-and-object-oracle',['python3','-B','tools/verify/e9-device-completions-files.py','--directory',str(out/'browser'),'--browser'])
 run('retained-gpu-browser',['node','tools/verify/e9-retained-gpu-browser.mjs','--output',str(out/'retained-gpu-browser')],1200)
 for directory in ['browser','retained-gpu-browser']:
  r=json.loads((out/directory/'report.json').read_text());assert r['status']=='passed'and r['head']==report['head']and not r['development']and not r['errors']
 clean();report['status']='passed'
except BaseException as error:report['status']='failed';report['failure']=str(error);raise
finally:
 paths=[ROOT/'Cargo.lock',ROOT/'Makefile',ROOT/'crates/wasm/Cargo.toml',ROOT/'web/index.html',ROOT/'web/main.js',ROOT/'web/roadmap.js',ROOT/'web/session-inputs.js',ROOT/'web/session-devices.js',ROOT/'web/device-completions-probe.js']
 paths += [ROOT/'.gitignore',ROOT/'Cargo.toml',ROOT/'web/gpu-checkpoint-build.js',ROOT/'web/assets/e9-device-completions.bin',ROOT/'web/assets/e9-device-completions.elf',ROOT/'web/assets/e9-device-completions.json']
 paths+=list((ROOT/'crates/core/src/session_devices').glob('*.rs'))
 for name in ['crates/core/src/session_devices.rs','crates/core/src/lib.rs','crates/core/src/resume.rs','crates/core/src/session_clock.rs','crates/core/src/block.rs','crates/core/src/dev/virtio/blk.rs','crates/core/src/dev/virtio/snd/mod.rs','crates/core/src/dev/virtio/snd/snapshot.rs','crates/core/src/dev/virtio/snd/session_capture_snapshot.rs','crates/core/tests/e9_device_completions.rs','crates/wasm/src/lib.rs','crates/wasm/src/session_devices.rs','tools/verify/build-e9-device-guest.py','tools/verify/e9-device-guest.listing','tools/verify/e9-device-completions.py','tools/verify/e9-device-completions-browser.mjs','tools/verify/e9-device-completions-files.py']:paths.append(ROOT/name)
 report['source_sha256']={str(path.relative_to(ROOT)):sha(path)for path in sorted(set(paths))}
 report['files']=[{'path':str(path.relative_to(out)),'bytes':path.stat().st_size,'sha256':sha(path)}for path in sorted(out.rglob('*'))if path.is_file()and path!=out/'report.json'];report['finished']=time.time();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
