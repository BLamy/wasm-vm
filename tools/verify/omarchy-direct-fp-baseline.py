"""Materialize the exact verified AN package; reject stale or modified baseline files."""
from pathlib import Path
import hashlib, json, os, subprocess, sys

repo=Path(__file__).resolve().parents[2]
dest=Path(sys.argv[1] if len(sys.argv)>1 else repo/'target/omarchy-direct-fp-baseline').resolve()
rev='c531ceffb9b7adc8de9f5ebc927d00076a26f1dd'
env=dict(os.environ,DEVELOPER_DIR='/Library/Developer/CommandLineTools')
def git(*args):return subprocess.check_output(['git',*args],cwd=repo,env=env)
files=git('ls-tree','-r','--name-only',rev,'--','web/dist/pkg').decode().splitlines()
assert files
records=[]
for name in files:
 data=git('show',rev+':'+name); target=dest/Path(name).relative_to('web/dist')
 if target.exists(): assert target.read_bytes()==data, str(target)+' differs from frozen baseline'
 else: target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 records.append(dict(source=name,relativePath=str(target.relative_to(dest)),bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
assert hashlib.sha256((dest/'pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest()=='0f9b1213fa160f31d4f35503f6b35b4caf7193668eac3c369ac4a75611b6fced'
print(json.dumps(dict(head=rev,directory=str(dest),files=records),indent=2))
