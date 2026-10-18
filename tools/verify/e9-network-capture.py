#!/usr/bin/env python3
"""Record the qualified network transport boundary at one clean, frozen source head."""
import argparse,hashlib,json,os,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
env={k:v for k,v in os.environ.items()if k not in('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG')and not k.startswith('CARGO_')}
env.update(E9_NETWORK_EVIDENCE=str(out/'native'),CARGO_TERM_COLOR='never',GIT_OPTIONAL_LOCKS='0')
report={'task':'E9-T13','status':'running','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'started':time.time(),'commands':[],
 'scope':'Owned Ethernet intent/RX/outcome/pending broker, real RV64 virtio-net HTTP bridge, original counter server removed, zero replay provider construction and exact guest trace/frame comparison. Full Linux assembly remains T14.'}
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
 clean();run('policy',['python3','tools/check_task_policy.py']);run('format',['cargo','fmt','--all','--check']);run('guest-fixture',['python3','tools/verify/build-e9-network-guest.py'])
 run('native-clippy',['cargo','clippy','-p','wasm-vm-core','-p','wasm-vm-wasm','-p','wasm-vm-jit-runtime','--all-targets','--features','trace,virgl-renderer','--','-D','warnings'])
 run('core-native',['cargo','test','-p','wasm-vm-core','--lib','--features','trace,virgl-renderer','--','--nocapture'])
 run('network-and-session-native',['cargo','test','-p','wasm-vm-core','--features','trace,virgl-renderer','--test','e9_network_capture','--test','e9_network_components','--test','virtio_net','--test','virtio_net_machine','--test','virtio_net_critic','--test','virtio_net_wiring_probes','--test','e9_device_completions','--test','snapshot_coherence','--test','cpu_resume','--test','e9_event_clock','--test','e9_input_boundary','--test','e9_time_entropy','--','--nocapture'])
 run('jit-native',['cargo','test','-p','wasm-vm-jit-runtime','--test','e9_network_capture','--test','e9_event_clock','--test','e9_event_clock_critic','--test','timekeeping','--test','batching','--','--nocapture'])
 run('native-guest-oracle',['python3','-B','tools/verify/e9-network-capture-files.py','--directory',str(out/'native')])
 run('boundary-native',['cargo','test','-p','wasm-vm-wasm','--lib','--test','software_checkpoint','--','--nocapture'])
 run('storage-native',['cargo','test','-p','wasm-vm-storage','--','--nocapture'])
 run('core-no-std-wasm',['cargo','build','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown'])
 run('boundary-wasm-clippy',['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--features','virgl-renderer','--lib','--','-D','warnings'])
 run('browser-build',['make','web-build'])
 for name in ['main.js','network-capture-probe.js','session-network.js','session-inputs.js','roadmap.js','assets/e9-network-capture.bin','assets/e9-network-capture.elf','assets/e9-network-capture.json','pkg/wasm_vm_wasm.js','pkg/wasm_vm_wasm_bg.wasm','session-pkg/wasm_vm_session.js','session-pkg/wasm_vm_session_bg.wasm']:
  assert(ROOT/'web'/name).read_bytes()==(ROOT/'web/dist'/name).read_bytes(),'stale deploy bundle: '+name
 for name in ['web/main.js','web/network-capture-probe.js','web/session-network.js','web/session-inputs.js','tools/verify/e9-network-capture-browser.mjs','tools/verify/e9-network-component-browser.mjs']:run('syntax-'+Path(name).stem,['node','--check',name])
 run('documentation',['node','tools/check-docs.mjs']);run('contract',['python3','tools/verify/e9-session-contract.py']);run('retained-gpu-integrity',['python3','tools/verify/e9-retained-gpu-runtime.py'])
 run('browser',['node','tools/verify/e9-network-capture-browser.mjs','--output',str(out/'browser')],1800)
 run('browser-guest-and-object-oracle',['python3','-B','tools/verify/e9-network-capture-files.py','--directory',str(out/'browser'),'--browser'])
 run('retained-gpu-browser',['node','tools/verify/e9-retained-gpu-browser.mjs','--output',str(out/'retained-gpu-browser')],1200)
 for directory in ['browser','retained-gpu-browser']:
  r=json.loads((out/directory/'report.json').read_text());assert r['status']=='passed'and r['head']==report['head']and not r['development']and not r['errors']
 clean();report['status']='passed'
except BaseException as error:report['status']='failed';report['failure']=str(error);raise
finally:
 paths=[ROOT/'Cargo.lock',ROOT/'Makefile',ROOT/'crates/wasm/Cargo.toml',ROOT/'web/index.html',ROOT/'web/main.js',ROOT/'web/roadmap.js',ROOT/'web/session-inputs.js',ROOT/'web/session-devices.js',ROOT/'web/device-completions-probe.js',ROOT/'web/session-network.js',ROOT/'web/network-capture-probe.js',ROOT/'web/network-probe-response.json',ROOT/'docs/design/session-replay.md',ROOT/'docs/design/session-replay-contract.json']
 paths += [ROOT/'.gitignore',ROOT/'Cargo.toml',ROOT/'web/gpu-checkpoint-build.js',ROOT/'web/assets/e9-network-capture.bin',ROOT/'web/assets/e9-network-capture.elf',ROOT/'web/assets/e9-network-capture.json']
 paths+=list((ROOT/'crates/core/src/session_network').glob('*.rs'))
 for name in ['crates/core/src/session_network.rs','crates/core/src/lib.rs','crates/core/src/resume.rs','crates/core/src/session_clock.rs','crates/core/src/dev/virtio/net.rs','crates/core/tests/e9_network_capture.rs','crates/core/tests/e9_network_components.rs','crates/jit-runtime/tests/e9_network_capture.rs','crates/wasm/src/lib.rs','crates/wasm/src/session_network.rs','tools/verify/build-e9-network-guest.py','tools/verify/e9-network-guest.listing','tools/verify/e9-network-capture.py','tools/verify/e9-network-capture-browser.mjs','tools/verify/e9-network-component-browser.mjs','tools/verify/e9-network-capture-files.py']:paths.append(ROOT/name)
 report['source_sha256']={str(path.relative_to(ROOT)):sha(path)for path in sorted(set(paths))}
 report['files']=[{'path':str(path.relative_to(out)),'bytes':path.stat().st_size,'sha256':sha(path)}for path in sorted(out.rglob('*'))if path.is_file()and path!=out/'report.json'];report['finished']=time.time();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
