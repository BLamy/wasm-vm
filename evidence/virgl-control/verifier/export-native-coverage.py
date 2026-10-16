import hashlib,json,os,subprocess
from pathlib import Path
root=Path.cwd(); out=root/'evidence/virgl-control/verifier'
sysroot=Path(subprocess.check_output(['rustc','--print','sysroot'],text=True).strip())
tools=sysroot/'lib/rustlib/aarch64-apple-darwin/bin'
raw=list((out/'coverage/raw').glob('*.profraw')); assert raw
subprocess.run([str(tools/'llvm-profdata'),'merge','-sparse',*[str(p) for p in raw],'-o',str(out/'coverage/merged.profdata')],check=True)
binaries=[p for p in (out/'native/target-coverage/debug/deps').iterdir() if p.is_file() and os.access(p,os.X_OK) and p.name.startswith(('virgl_control_independent_verifier-','virtio_gpu_control3d-','virtio_gpu_machine-','wasm_vm_core-')) and '.' not in p.name]
assert len(binaries)==4,[p.name for p in binaries]
cmd=[str(tools/'llvm-cov'),'export',str(binaries[0]),'-instr-profile='+str(out/'coverage/merged.profdata')]
for p in binaries[1:]:cmd.extend(['-object',str(p)])
complete=json.loads(subprocess.check_output(cmd))
changed=['crates/core/src/dev/virtio/gpu/control3d.rs','crates/core/src/dev/virtio/gpu/mod.rs','crates/core/src/dev/virtio/gpu/snapshot.rs','crates/core/src/lib.rs','crates/core/src/desktop_restore.rs']
kept=[]
for block in complete['data']:
    kept.extend(f for f in block['files'] if any(f['filename'].endswith('/'+s) for s in changed))
report={'schema':1,'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'compiler':subprocess.check_output(['rustc','--version','--verbose'],text=True),'sources':[{'path':p,'sha256':hashlib.sha256((root/p).read_bytes()).hexdigest()}for p in changed], 'binaries':[{'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in binaries],'profiles':[{'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in raw],'files':kept}
(out/'native-coverage.json').write_text(json.dumps(report,indent=2)+'\n')
print('Exported native source-bound coverage for',len(kept),'changed files')
