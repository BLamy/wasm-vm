#!/usr/bin/env python3
"""Record the high-risk common event-clock acceptance at one frozen, clean source head."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
env={k:v for k,v in os.environ.items() if k not in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG') and not k.startswith('CARGO_')}
env['E9_CLOCK_EVIDENCE']=str(out/'native');env['CARGO_TERM_COLOR']='never'
report={'task':'E9-T09','status':'running','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'started':time.time(),'commands':[],
        'scope':'Single-hart ICount common clock/mailbox, exact real interpreter/JIT boundaries and native snapshot state. Linux provider recording/replay remains gated in T10-T14.'}
sources=['crates/core/src/lib.rs','crates/core/src/session_clock.rs','crates/core/src/resume.rs','crates/core/tests/e9_event_clock.rs',
 'crates/core/tests/predecode_batching.rs','crates/core/tests/riscv_tests_suite.rs','crates/core/examples/retirement_capture_baseline.rs',
 'crates/jit-runtime/tests/e9_event_clock.rs','crates/jit-runtime/tests/e9_event_clock_critic.rs','crates/jit-runtime/tests/jit_execution.rs','crates/wasm/src/lib.rs','crates/wasm/src/event_clock.rs',
 'crates/wasm/src/software_checkpoint.rs','crates/wasm/tests/software_checkpoint.rs','crates/cli/src/main.rs','crates/cli/src/boot.rs','crates/cli/src/boot/agent_proof.rs',
 'web/index.html','web/main.js','web/event-clock-probe.js','web/roadmap.js','web/session-checkpoints.js','web/loader.js','web/gpu-checkpoint-build.js',
 'web/docs-source/guides/storage.md','docs/design/session-replay.md','docs/design/session-replay-contract.json','web/package.json','web/package-lock.json',
 'tools/verify/e9-event-clock.py','tools/verify/e9-event-clock-browser.mjs','tools/verify/e9-event-clock-files.py','tools/verify/e9-retained-gpu-browser.mjs','Makefile']

def sha(file):
    h=hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda:stream.read(1<<20),b''):h.update(part)
    return h.hexdigest()

def clean():
    assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=ROOT),'source must be clean'

def run(name,command,timeout=3600):
    print(name,flush=True);started=time.time()
    with (out/(name+'.log')).open('wb') as log:r=subprocess.run(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
    report['commands'].append({'name':name,'command':command,'seconds':time.time()-started,'exit_code':r.returncode})
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');assert r.returncode==0,name+' failed; see its recorded log'

try:
    clean()
    for name in ['main.js','event-clock-probe.js','roadmap.js','gpu-checkpoint-build.js','docs-content/storage.md']:
        assert (ROOT/'web'/name).read_bytes()==(ROOT/'web/dist'/name).read_bytes(),'stale dist: '+name
    run('policy',['python3','tools/check_task_policy.py'])
    run('format',['cargo','fmt','--all','--check'])
    run('native-clippy',['cargo','clippy','-p','wasm-vm-core','-p','wasm-vm-wasm','-p','wasm-vm-jit-runtime','-p','wasm-vm-cli','--all-targets','--features','trace,virgl-renderer','--','-D','warnings'])
    run('core-native',['cargo','test','-p','wasm-vm-core','--lib','--features','trace,virgl-renderer','--','--nocapture'])
    run('execution-native',['cargo','test','-p','wasm-vm-core','--features','trace,virgl-renderer','--test','e9_event_clock','--test','cpu_resume','--test','snapshot_coherence','--test','predecode_batching','--test','predecode_entry_safety','--test','interrupts','--test','wfi_fast_forward_critic','--test','production_keyboard_wfi_critic','--test','sbi_timer','--','--nocapture'])
    run('jit-native',['cargo','test','-p','wasm-vm-jit-runtime','--test','e9_event_clock','--test','e9_event_clock_critic','--test','jit_execution','--test','timekeeping','--test','batching','--test','chaining','--test','precise_traps','--test','partial_blocks','--','--nocapture'])
    run('native-oracle',['python3','-B','tools/verify/e9-event-clock-files.py','--directory',str(out/'native')])
    run('boundary-native',['cargo','test','-p','wasm-vm-wasm','--lib','--test','software_checkpoint','--','--nocapture'])
    run('core-no-std-wasm',['cargo','build','-p','wasm-vm-core','--no-default-features','--target','wasm32-unknown-unknown'])
    run('boundary-wasm-clippy',['cargo','clippy','-p','wasm-vm-wasm','--target','wasm32-unknown-unknown','--features','virgl-renderer','--lib','--','-D','warnings'])
    run('browser-build',['make','web-build'])
    for folder,names in [('pkg',['wasm_vm_wasm.js','wasm_vm_wasm_bg.wasm']),('session-pkg',['wasm_vm_session.js','wasm_vm_session_bg.wasm'])]:
        for name in names:assert (ROOT/'web'/folder/name).read_bytes()==(ROOT/'web/dist'/folder/name).read_bytes(),'stale compiled browser: '+name
    run('browser-syntax',['node','--check','web/event-clock-probe.js'])
    run('driver-syntax',['node','--check','tools/verify/e9-event-clock-browser.mjs'])
    run('gpu-driver-syntax',['node','--check','tools/verify/e9-retained-gpu-browser.mjs'])
    run('worker-protocol',['node','--test','web/tests/e4-t32-worker-protocol.test.mjs'])
    run('documentation',['node','tools/check-docs.mjs'])
    run('contract',['python3','tools/verify/e9-session-contract.py'])
    run('retained-gpu-integrity',['python3','tools/verify/e9-retained-gpu-runtime.py'])
    run('browser',['node','tools/verify/e9-event-clock-browser.mjs','--output',str(out/'browser')])
    run('checkpoint-regression',['node','tools/verify/e9-checkpoint-milestone-browser.mjs','--output',str(out/'checkpoint-regression')],2400)
    run('retained-gpu-browser',['node','tools/verify/e9-retained-gpu-browser.mjs','--output',str(out/'retained-gpu-browser')],1200)
    for folder in ['browser','checkpoint-regression','retained-gpu-browser']:
        r=json.loads((out/folder/'report.json').read_text());assert r['status']=='passed' and r['head']==report['head'] and not r['development'] and r['errors']==[],folder
    assert json.loads((out/'browser/report.json').read_text())['checks']['suite']=={'passed':127,'failed':0}
    clean();report['status']='passed'
except BaseException as error:
    report['status']='failed';report['failure']=str(error);raise
finally:
    report['source_sha256']={name:sha(ROOT/name) for name in sources}
    report['files']=[{'path':str(file.relative_to(out)),'bytes':file.stat().st_size,'sha256':sha(file)} for file in sorted(out.rglob('*')) if file.is_file() and file!=out/'report.json']
    report['finished']=time.time();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
