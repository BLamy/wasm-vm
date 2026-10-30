import gzip,hashlib,json,shutil,subprocess
from pathlib import Path
root=Path.cwd();out=root/'evidence/e9-t07/public';out.mkdir(parents=True,exist_ok=False)
base=root/'target/evidence/e9-t07-public-final';gpu=root/'target/evidence/e9-t07-public-gpu-retry';oracle=root/'target/evidence/e9-t07-public-storage-oracle'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
a=json.loads((base/'report.json').read_text());b=json.loads((gpu/'report.json').read_text());c=json.loads((oracle/'retention-oracle.json').read_text())
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert head==a['head']==b['head'] and a['status']=='failed' and b['status']==c['status']=='passed'
assert a['errors']==b['errors']==[] and a['checks']['suite']=={'passed':127,'failed':0}
assert a['checks']['prefix']['manifest']==a['checks']['prefixAfterQuota']['manifest']
assert a['checks']['siblingRestored']['hash']==a['checks']['siblingOriginal']['frameHash']
assert len(b['assets'])==57 and b['boot']['ok'] and b['gpu']['qualified'] and not b['gpu']['lost'] and not b['gpu']['poisoned'] and b['gpu']['retired']>0 and b['gpu']['drawn']
originals=[]
for scope,folder,r in [('public-storage',base,a),('public-gpu-retry',gpu,b)]:
 for x in r['files']:
  p=folder/x['path'];assert p.stat().st_size==x['bytes'] and sha(p)==x['sha256'],str(p)
  originals.append(dict(x,scope=scope,original=str(p)))
for p in sorted(oracle.iterdir()):
 if p.is_file():originals.append({'scope':'public-oracle','original':str(p),'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p)})
packet=[];seen={};aliases=[]
def copy(p,name,compress=False):
 dest=out/name;dest.parent.mkdir(parents=True,exist_ok=True)
 if compress:
  with p.open('rb') as f,dest.open('wb') as to:
   with gzip.GzipFile(fileobj=to,mode='wb',mtime=0) as z:shutil.copyfileobj(f,z)
 else:shutil.copyfile(p,dest)
 packet.append({'original':str(p),'path':name,'source_sha256':sha(p),'source_bytes':p.stat().st_size,'sha256':sha(dest),'bytes':dest.stat().st_size,'encoding':'gzip' if compress else 'identity'})
for scope,folder in [('public-storage',base),('public-gpu-retry',gpu),('public-oracle',oracle)]:
 for p in sorted(folder.iterdir()):
  if p.is_file() and p.suffix in ('.json','.png','.file','.log'):
   copy(p,scope+'/'+p.name+('.gz' if p.name.startswith('javascript-coverage') else ''),p.name.startswith('javascript-coverage'))
 for p in sorted(folder.glob('*.checkpoint.gz')):
  h=sha(p)
  if h in seen:aliases.append({'original':str(p),'packet':seen[h],'sha256':h})
  else:seen[h]=scope+'/'+p.name;copy(p,seen[h])
copy(root/'target/e9-t07-public-gpu-retry.mjs','public-gpu-retry/driver.source.mjs')
assert sha(root/'target/e9-t07-public-gpu-retry.mjs')==b['driver_sha256']
copy(Path('/tmp/e9-t07-deploy.log'),'deploy.log')
copy(Path('/tmp/e9-t07-deploy-attempt-1.log'),'deploy-attempt-1.log')
copy(Path(__file__),'packet.source.py')
r={'task':'E9-T07','status':'passed','scope':'Composite completion of public storage, independent filesystem oracle and actual retained GPU boot at unchanged frozen head. Original full run remains failed on a recorded R2 connection reset.','head':head,'production':'https://wasm-vm.pages.dev/','deployment':'https://50fb93f5.wasm-vm.pages.dev','original_failed_report':{'path':str(base/'report.json'),'sha256':sha(base/'report.json'),'status':a['status'],'failure':a['failure']},'network_failure':{'trace':str(base/'browser-trace.zip'),'entry':'trace.network line 879','url':'R2 pinned 3583ea9927d142e33c9b1de5963d89bd1f0b1022df7047c8a8b02d7f734a01bd pair','failure':'net::ERR_CONNECTION_RESET; boot call@655 returned TypeError: network error'},'completed_storage_checks':a['checks'],'independent_oracle':{'path':str(oracle/'retention-oracle.json'),'sha256':sha(oracle/'retention-oracle.json'),'status':c['status']},'gpu_supplement':{'path':str(gpu/'report.json'),'sha256':sha(gpu/'report.json'),'status':b['status'],'gpu':b['gpu'],'assets':b['assets']},'originals':originals,'packet':packet,'aliases':aliases,'retained':'All original recordings/profiles/frames/filesystem images remain in target/evidence. This digest-linked compact packet does not replace or relabel them.'}
(out/'provenance.json').write_text(json.dumps(r,indent=2)+'\n');print('Composite passed; originals',len(originals),'copies',len(packet),'aliases',len(aliases),'sha256',sha(out/'provenance.json'))
