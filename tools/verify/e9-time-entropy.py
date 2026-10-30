#!/usr/bin/env python3
"""Record the high-risk time/entropy observation boundary at one frozen, clean source head."""
import argparse, hashlib, json, os, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not k.startswith('CARGO_')}
env.update(E9_SOURCE_EVIDENCE=str(out/'native'),CARGO_TERM_COLOR='never',GIT_OPTIONAL_LOCKS='0')
report={'task':'E9-T11','status':'running','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'started':time.time(),'commands':[],
 'scope':'Exact RTC intents and entropy bytes, frozen ICount/WFI policy, saved source cursor and durable input/source prefixes. Full completion/network/Linux replay remains gated in T12-T14.'}
sources=['crates/jit-runtime/tests/e9_event_clock_critic.rs','crates/core/src/session_clock/sources.rs','crates/core/tests/e9_time_entropy.rs','crates/core/src/dev/rtc.rs','crates/core/src/dev/virtio/rng.rs','crates/core/src/lib.rs','crates/core/src/resume.rs','crates/wasm/src/session_sources.rs','crates/wasm/src/crypto_entropy.rs','web/time-entropy-probe.js','web/assets/e9-time-entropy.bin','web/assets/e9-time-entropy.json','tools/verify/build-e9-source-guest.py','tools/verify/e9-source-guest.listing','tools/verify/e9-time-entropy.py','tools/verify/e9-time-entropy-browser.mjs','tools/verify/e9-time-entropy-persistence.mjs','tools/verify/e9-time-entropy-files.py','Cargo.lock','crates/core/src/session_clock.rs','crates/core/src/dev/virtio/input/mod.rs','crates/core/tests/e9_input_boundary.rs',
 'crates/wasm/src/lib.rs','crates/wasm/src/event_clock.rs','crates/wasm/src/session_checkpoint.rs','crates/wasm/src/session_input.rs','crates/wasm/src/session_input/browser.rs','crates/wasm/src/session_input/tests.rs','crates/wasm/src/browser_file_transfer.rs',
 'crates/storage/src/session.rs','crates/storage/tests/session_manifest.rs','crates/session-web/Cargo.toml','crates/session-web/src/lib.rs',
 'web/index.html','web/main.js','web/loader.js','web/linux-worker-protocol.js','web/session-inputs.js','web/input-recording-probe.js','web/session-checkpoints.js','web/session-library.js','web/src/input/pointer.js','web/src/input/pointer.ts','web/tests/e4-t32-worker-protocol.test.mjs','web/roadmap.js','web/gpu-checkpoint-build.js',
 'web/docs-source/guides/storage.md','docs/design/session-replay.md','docs/design/session-replay-contract.json','tools/verify/e9-input-recording.py','tools/verify/e9-time-entropy-browser.mjs','tools/verify/e9-time-entropy-files.py','tools/verify/e9-time-entropy-files.py','Makefile']
def sha(file):
 h=hashlib.sha256()
 with file.open('rb')as stream:
  for part in iter(lambda:stream.read(1<<20),b''):h.update(part)
 return h.hexdigest()
def clean():assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=ROOT,env=env),'source must be clean'
def run(name,command,timeout=3600):
 print(name,flush=True);start=time.time()
 with(out/(name+'.log')).open('wb')as log:r=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 report['commands'].append({'name':name,'command':command,'seconds':time.time()-start,'exit_code':r.returncode});(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');assert r.returncode==0,name+' failed; see its recorded log'
try:
 clean()
 for name in ['main.js','loader.js','linux-worker-protocol.js','session-inputs.js','input-recording-probe.js','time-entropy-probe.js','session-library.js','session-checkpoints.js','roadmap.js','gpu-checkpoint-build.js','src/input/pointer.js','src/input/pointer.ts']:
  assert(ROOT/'web'/name).read_bytes()==(ROOT/'web/dist'/name).read_bytes(),'stale dist: '+name
 run('policy',['python3','tools/check_task_policy.py'])
 run('format',['cargo','fmt','--all','--check'])
 run('guest-fixture',['python3','tools/verify/build-e9-source-guest.py'])
 run('native-clippy',['cargo','clippy','-p','wasm-vm-core','-p','wasm-vm-wasm','-p','wasm-vm-storage','-p','wasm-vm-session-web','-p','wasm-vm-jit-runtime','-p','wasm-vm-cli','--all-targets','--features','trace,virgl-renderer','--','-D','warnings'])
 run('core-native',['cargo','test','-p','wasm-vm-core','--lib','--features','trace,virgl-renderer','--','--nocapture'])
 run('execution-and-device-native',['cargo','test','-p','wasm-vm-core','--features','trace,virgl-renderer','--test','e9_event_clock','--test','e9_input_boundary','--test','e9_time_entropy','--test','virtio_keyboard','--test','virtio_keyboard_guest_stream','--test','virtio_pointer','--test','virtio_console','--test','production_keyboard_wfi_critic','--test','production_keyboard_host_wait','--test','snapshot_coherence','--test','cpu_resume','--test','predecode_batching','--test','wfi_fast_forward_critic','--','--nocapture'])
 run('jit-native',['cargo','test','-p','wasm-vm-jit-runtime','--test','e9_event_clock','--test','e9_event_clock_critic','--test','jit_execution','--test','timekeeping','--test','batching','--test','chaining','--test','precise_traps','--test','partial_blocks','--','--nocapture'])
 run('boundary-native',['cargo','test','-p','wasm-vm-wasm','--lib','--test','software_checkpoint','--','--nocapture'])
 run('storage-native',['cargo','test','-p','wasm-vm-storage','--','--nocapture'])
 run('native-guest-oracle',['python3','-B','tools/verify/e9-time-entropy-files.py','--directory',str(out/'native')])
 run('core-no-std-wasm',['cargo','build','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown'])
 run('boundary-default-wasm',['cargo','check','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--lib'])
 run('boundary-wasm-clippy',['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--features','virgl-renderer','--lib','--','-D','warnings'])
 run('browser-build',['make','web-build'])
 for folder,names in [('pkg',['wasm_vm_wasm.js','wasm_vm_wasm_bg.wasm']),('session-pkg',['wasm_vm_session.js','wasm_vm_session_bg.wasm'])]:
  for name in names:assert(ROOT/'web'/folder/name).read_bytes()==(ROOT/'web/dist'/folder/name).read_bytes(),'stale compiled browser '+name
 assert(ROOT/'web/docs-content/storage.md').read_bytes()==(ROOT/'web/dist/docs-content/storage.md').read_bytes(),'stale built documentation'
 for name in ['web/loader.js','web/session-inputs.js','web/input-recording-probe.js','web/time-entropy-probe.js','web/session-library.js','tools/verify/e9-time-entropy-browser.mjs','tools/verify/e9-time-entropy-persistence.mjs']:
  run('syntax-'+Path(name).stem,['node','--check',name])
 run('input-and-worker-protocol',['node','--test','web/tests/e4-t32-worker-protocol.test.mjs','web/tests/pointer.test.mjs','web/tests/keyboard-bridge.test.mjs','web/tests/held-keys.test.mjs','web/tests/capture-policy.test.mjs','web/tests/modifier-lock-reconciliation.test.mjs'])
 run('documentation',['node','tools/check-docs.mjs'])
 run('contract',['python3','tools/verify/e9-session-contract.py'])
 run('retained-gpu-integrity',['python3','tools/verify/e9-retained-gpu-runtime.py'])
 run('browser',['node','tools/verify/e9-time-entropy-browser.mjs','--output',str(out/'browser')],2400)
 run('browser-object-oracle',['python3','-B','tools/verify/e9-time-entropy-files.py','--directory',str(out/'browser'),'--browser'])
 run('browser-clock-oracle',['python3','-B','tools/verify/e9-event-clock-files.py','--directory',str(out/'browser/event-clock-regression')])
 run('retained-gpu-browser',['node','tools/verify/e9-retained-gpu-browser.mjs','--output',str(out/'retained-gpu-browser')],1200)
 for folder in ['browser','retained-gpu-browser']:
  r=json.loads((out/folder/'report.json').read_text());assert r['status']=='passed'and r['head']==report['head']and not r['development']and r['errors']==[],folder
 assert json.loads((out/'browser/report.json').read_text())['checks']['suite']=={'passed':127,'failed':0}
 clean();report['status']='passed'
except BaseException as error:report['status']='failed';report['failure']=str(error);raise
finally:
 report['source_sha256']={name:sha(ROOT/name)for name in sources}
 report['files']=[{'path':str(file.relative_to(out)),'bytes':file.stat().st_size,'sha256':sha(file)}for file in sorted(out.rglob('*'))if file.is_file()and file!=out/'report.json']
 report['finished']=time.time();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
