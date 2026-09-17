from pathlib import Path
import subprocess, tempfile, os, json, hashlib
out=Path(__file__).resolve().parent
repo=out.parents[2]
head='d35217b4655d77fe762dd5ca98b98313e928c3c1'
work=Path(tempfile.mkdtemp(prefix='wasm-vm-bb-sabotage-',dir='/private/tmp'))/'repo'
env=dict(os.environ)
for key in list(env):
    if key.startswith(('CARGO_','OMARCHY_')) or key in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG','NODE_ENV','NODE_PATH'):
        del env[key]
env['DEVELOPER_DIR']='/Library/Developer/CommandLineTools'
env['CARGO_TARGET_DIR']=json.loads((out/'cold.json').read_text())['clone']+'/target'
with (out/'sabotage-setup.log').open('x') as log:
    subprocess.run(['git','clone','--shared','--no-checkout',str(repo),str(work)],env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
    subprocess.run(['git','checkout','--detach',head],cwd=work,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
file=work/'crates/core/src/lib.rs'
s=file.read_text()
guard='                            && self.executor.as_ref().is_some_and(|e| e.dynamic_chaining())\n'
assert s.count(guard)==1
file.write_text(s.replace(guard,''))
(out/'sabotage.diff').write_bytes(subprocess.check_output(['git','diff','--','crates/core/src/lib.rs'],cwd=work,env=env))
args=['cargo','test','--locked','--offline','-p','wasm-vm-core','--test','dynamic_link_publication','--','--nocapture']
with (out/'sabotage.log').open('x') as log:
    r=subprocess.run(args,cwd=work,env=env,stdout=log,stderr=subprocess.STDOUT)
receipt={'head':head,'clone':str(work),'command':args,'exit':r.returncode,'expectedFailure':r.returncode==101,'mutation':'Remove only outer dynamic_chaining guard','logSha256':hashlib.sha256((out/'sabotage.log').read_bytes()).hexdigest()}
(out/'sabotage.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
assert receipt['expectedFailure']
assert 'disabled path published' in (out/'sabotage.log').read_text()
