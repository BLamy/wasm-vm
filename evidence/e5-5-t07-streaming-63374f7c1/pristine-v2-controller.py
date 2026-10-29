from pathlib import Path
import hashlib,json,os,shutil,subprocess,time,sys
root=Path('/private/tmp/e5-5-t07-pristine-pinned-0144c662b');out=Path('/private/tmp/e5-5-t07-pristine-proof-v2')
assert not (out/'receipt.json').exists()
env={k:v for k,v in os.environ.items() if not k.startswith('CARGO_') and k not in ['RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG','RUSTC_WRAPPER','RUSTC_WORKSPACE_WRAPPER','RUSTC_BOOTSTRAP','NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONOPTIMIZE']}
env.update(CARGO_BUILD_JOBS='4',CARGO_INCREMENTAL='0',CARGO_TERM_COLOR='never')
report={'priorFailedReceiptSha256':hashlib.sha256(Path('/private/tmp/e5-5-t07-pristine-proof-v1/receipt.json').read_bytes()).hexdigest(),'setupCorrection':'v1 sparse checkout omitted tracked rust-toolchain.toml and built with default1.98.0; v2 is a NEW independent clone with the tracked1.96.0pin and absenttarget, not a relabelled failure','status':'running','scope':'shallow filtered independent pristine source clone; rebuilt Wasm browser artifact; bounded warm acceptance only','started':time.time(),'clone':str(root),'commands':[]}
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=root,env=env,text=True).strip()
def run(label,cmd,timeout=600,input=None):
 log=out/(label+'.log'); start=time.time()
 with log.open('wb') as f:p=subprocess.run(cmd,cwd=root,env=env,input=input,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
 report['commands'].append({'label':label,'command':cmd,'exitCode':p.returncode,'seconds':time.time()-start,'logSha256':sha(log)})
 print(json.dumps(report['commands'][-1]),flush=True)
 assert p.returncode==0,label
try:
 patterns=['/rust-toolchain.toml','/AGENTS.md','/Cargo.toml','/Cargo.lock','/Makefile','/.gitignore','/.cargo/','/crates/','/configs/','/guest/','/tests/','/renderer/','/third_party/','/tools/','/web/','/tasks/','/releases/kernel/6.6.63/Image','/releases/kernel/6.6.63-omarchy-evdev1024/Image','/releases/initramfs/initramfs.cpio.gz','/releases/chunked-omarchy/manifest.json','/releases/boot-snapshot/omarchy-apps-ready-98235fbe8cc4.snap.gz','/releases/boot-snapshot/omarchy-apps-overlay-delta-bc36948ac61a.bin.gz','/releases/boot-snapshot/busybox-ready.snap.gz']
 run('sparse',['git','sparse-checkout','set','--no-cone','--stdin'],input=('\n'.join(patterns)+'\n').encode())
 run('checkout',['git','checkout','codex/omarchy-streamed-software-restore'])
 report['compiler']=subprocess.check_output(['rustc','--version','--verbose'],cwd=root,env=env,text=True)
 assert report['compiler'].startswith('rustc 1.96.0'),report['compiler']
 assert (root/'rust-toolchain.toml').read_bytes()==subprocess.check_output(['git','show','HEAD:rust-toolchain.toml'],cwd=root,env=env)
 report.update(head=git('rev-parse','HEAD'),initialStatus=git('status','--porcelain'),initialTargetAbsent=not(root/'target').exists(),alternatesAbsent=not(root/'.git/objects/info/alternates').exists(),shallow=git('rev-parse','--is-shallow-repository'))
 assert report['head']=='0144c662b0ffc53e0aec1efdbabc4edcac73b27d' and not report['initialStatus'] and report['initialTargetAbsent'] and report['alternatesAbsent']
 (out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
 run('renderer-build',['bash','tools/build-virgl-runtime.sh'])
 run('wasm-build',['wasm-pack','build','crates/wasm-web','--target','web','--profile','wasm-release','--out-name','wasm_vm_wasm'])
 report['built']={}
 for name in ['wasm_vm_wasm_bg.wasm','wasm_vm_wasm.js']:
  built=root/'crates/wasm-web/pkg'/name; shipped=root/'web/dist/pkg'/name
  report['built'][name]={'sha256':sha(built),'shippedSha256':sha(shipped),'bytes':built.stat().st_size,'identical':built.read_bytes()==shipped.read_bytes()}
  assert report['built'][name]['identical'],name+' cold output differs'
 # Exercise this clone's own newly compiled module, never a sibling target or its checked-in binary.
 for name in ['web/pkg','web/dist/pkg']:
  shutil.copytree(root/'crates/wasm-web/pkg',root/name,dirs_exist_ok=True)
  p=root/name/'.gitignore'
  if p.exists():p.unlink()
 run('npm',['npm','ci','--no-audit','--no-fund'],timeout=600) if False else None
 run('npm',['npm','--prefix','web','ci','--no-audit','--no-fund'])
 env['E5_STREAM_OUT']=str(out/'gate')
 run('acceptance',['make','verify-E5.5-T07'])
 report['finalStatus']=git('status','--porcelain');report['status']='passed'
except BaseException as e:
 report['status']='failed';report['failure']=repr(e)
finally:
 report['finished']=time.time();(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'status':report['status'],'failure':report.get('failure'),'receipt':str(out/'receipt.json')}),flush=True)
sys.exit(0 if report['status']=='passed' else 1)
