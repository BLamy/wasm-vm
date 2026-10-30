#!/usr/bin/env python3
"""Record the authorized main publication and preserve/undo only its staging transforms."""
import argparse,hashlib,json,os,signal,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args()
root=Path('/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905');out=a.output.resolve();out.mkdir(parents=True,exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=root,text=True).strip()
assert not git('status','--porcelain'),'clean publication source required'
names=['artifacts.json','artifacts-alpine.json','artifacts-node-alpine.json','artifacts-omarchy.json','artifacts-omarchy-virgl.json']
original={name:(root/'web/dist'/name).read_bytes() if (root/'web/dist'/name).is_file() else None for name in names}
script=(root/'tools/deploy-cloudflare.sh').read_bytes();assert b'--branch main' in script and b'PROJECT=wasm-vm' in script
report=dict(deployerSha256=sha(script),task='E9-T24',head=git('rev-parse','HEAD'),status='running',url='https://wasm-vm.pages.dev/',started=time.time(),command=['bash','tools/deploy-cloudflare.sh'],before={n:sha(b) if b is not None else None for n,b in original.items()})
try:
 with (out/'deploy.log').open('wb') as log:
  child=subprocess.Popen(report['command'],cwd=root,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=child.wait(timeout=1800)
  except BaseException:
   if child.poll() is None:
    os.killpg(child.pid,signal.SIGTERM)
    try:child.wait(timeout=10)
    except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   raise
 report['exitCode']=code
 assert code==0,'deployment failed; inspect preserved deploy.log'
 text=(out/'deploy.log').read_text()
 assert 'live at https://wasm-vm.pages.dev/' in text,'main production completion missing'
 report['status']='published'
except BaseException as error:
 report.update(status='failed',failure=repr(error))
finally:
 staged=out/'staged-manifests';staged.mkdir()
 report['staged']={}
 for name,old in original.items():
  file=root/'web/dist'/name
  if file.is_file():
   data=file.read_bytes();(staged/name).write_bytes(data);report['staged'][name]=dict(bytes=len(data),sha256=sha(data))
  if old is None:
   if file.exists():file.unlink()
  else:file.write_bytes(old)
 report['checkoutStatus']=git('status','--porcelain');report['headAfter']=git('rev-parse','HEAD')
 if report['checkoutStatus'] or report['headAfter']!=report['head']:
  report.update(status='failed',cleanupFailure='unexpected checkout mutation after restoring known staging inputs')
 report['finished']=time.time();report['logSha256']=sha((out/'deploy.log').read_bytes());(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
raise SystemExit(0 if report['status']=='published' else 1)
