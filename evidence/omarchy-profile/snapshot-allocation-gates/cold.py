"""One final pristine source build and full-size acceptance, with explicit pinned R3 fixtures."""
from pathlib import Path
import os,json,hashlib,subprocess,time,tempfile,shutil
repo=Path(__file__).resolve().parents[3];out=Path(__file__).resolve().parent/'cold';out.mkdir()
env=dict(os.environ);scrubbed=[]
for key in list(env):
 if key.startswith(('CARGO_','OMARCHY_')) or key in ('RUSTFLAGS','RUSTDOCFLAGS','RUST_LOG'):
  scrubbed.append(key);del env[key]
env['DEVELOPER_DIR']='/Library/Developer/CommandLineTools'
env['PATH']=str(Path.home()/'.cargo/bin')+':/usr/bin:/bin:/usr/sbin:/sbin:'+env['PATH']
node='/Users/blamy/.nvm/versions/node/v24.20.0/bin/node'
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,env=env,text=True).strip()
root=Path(tempfile.mkdtemp(prefix='wasm-vm-snapshot-cold-',dir='/private/tmp'));clone=root/'repo'
report={'head':head,'clone':str(clone),'scrubbedNames':scrubbed,'commands':[],'fixtures':[],'passed':False}
def save():(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
def run(args,cwd,label):
 row={'label':label,'args':args,'cwd':str(cwd),'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())};report['commands'].append(row);save();print(label,flush=True)
 with (out/(label+'.log')).open('x') as log:p=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 row.update(code=p.returncode,finishedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()));save()
 if p.returncode:raise RuntimeError(label+' failed')
try:
 run(['git','clone','--quiet','--shared',str(repo),str(clone)],root,'clone')
 run(['git','checkout','--quiet',head],clone,'checkout')
 assert subprocess.check_output(['git','status','--porcelain'],cwd=clone,env=env,text=True)==''
 report['pristineBeforeBuild']=True;report['committedWasm']=hashlib.sha256((clone/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest();save()
 for rel in ['target/omarchy-sdr-r3-snapshot/omarchy-ready.snap.gz','target/omarchy-sdr-r3-snapshot/omarchy-overlay-delta.bin.gz','target/omarchy-profile-chunks-sdr-r3-256k/manifest.json']:
  dest=clone/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(repo/rel,dest)
  report['fixtures'].append({'path':rel,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()});save()
 run(['make','web-dist'],clone,'build')
 report['rebuiltWasm']=hashlib.sha256((clone/'web/dist/pkg/wasm_vm_wasm_bg.wasm').read_bytes()).hexdigest();assert report['rebuiltWasm']==report['committedWasm'];save()
 run(['cargo','test','-p','wasm-vm-core','--lib','resume::'],clone,'native')
 run([node,'tools/verify/omarchy-snapshot-allocation.mjs',str(out/'browser')],clone,'browser')
 report['passed']=True
finally:save()
