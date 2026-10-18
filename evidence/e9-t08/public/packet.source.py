"""Compact, digest-linked copies; preserve every original trace/profile/image in place."""
import argparse,gzip,hashlib,json,shutil,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('destination',type=Path);p.add_argument('--public',action='store_true');p.add_argument('--deployment');a=p.parse_args()
root=Path.cwd();source=a.source.resolve();dest=a.destination
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
r=json.loads((source/'report.json').read_text());assert r['status']=='passed' and r['head']==head
browser=source if a.public else source/'browser';br=json.loads((browser/'report.json').read_text());assert br['status']=='passed' and not br['development'] and br['errors']==[]
assert br['checks']['suite']=={'passed':127,'failed':0}
assert br['checks']['alpha']['id']!=br['checks']['beta']['id']
assert br['checks']['beta']['manifest']==br['checks']['betaPrefix']['manifest']==br['checks']['betaAfterDelete']['manifest']
assert br['checks']['betaRestored']['state']['hash']==br['checks']['beta']['frameHash']==br['checks']['betaReopened']['state']['hash']
assert br['checks']['alphaRestored']['state']['hash']==br['checks']['alpha']['frameHash']
assert json.loads((browser/'milestone-oracle.json').read_text())['status']=='passed'
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
for entry in r['files']:
 file=source/entry['path'];assert file.stat().st_size==entry['bytes'] and sha(file)==entry['sha256'],entry['path']
dest.mkdir(parents=True,exist_ok=False);copies=[];aliases=[];seen={}
def copy(file,name,compress=False):
 target=dest/name
 if compress:
  with file.open('rb') as f,target.open('wb') as out:
   with gzip.GzipFile(fileobj=out,mode='wb',mtime=0) as z:shutil.copyfileobj(f,z)
 else:shutil.copyfile(file,target)
 copies.append({'source':str(file),'path':name,'source_bytes':file.stat().st_size,'source_sha256':sha(file),'bytes':target.stat().st_size,'sha256':sha(target),'encoding':'gzip' if compress else 'identity'})
if not a.public:
 copy(source/'report.json','acceptance.json')
 for file in sorted(source.glob('*.log')):copy(file,file.name)
for file in sorted(browser.iterdir()):
 if file.is_file() and file.suffix in ('.png','.json','.log','.file') and not file.name.startswith('javascript-coverage'):copy(file,file.name)
copy(browser/'javascript-coverage.json','javascript-coverage.json.gz',True)
for file in sorted(browser.glob('*.checkpoint.gz')):
 digest=sha(file)
 if digest in seen:aliases.append({'source':str(file),'packet':seen[digest],'source_sha256':digest})
 else:copy(file,file.name);seen[digest]=file.name
copy(Path(__file__),'packet.source.py')
if a.deployment:
 copy(Path('/tmp/e9-t08-deploy.log'),'deploy.log')
 for failed in sorted(Path('/tmp').glob('e9-t08-deploy-attempt-*.log')):copy(failed,failed.name)
provenance={'task':'E9-T08','status':'passed','head':head,'original':str(source),'report_sha256':sha(source/'report.json'),
 'deployment':a.deployment,'production':'https://wasm-vm.pages.dev/' if a.public else None,'source_sha256':r['source_sha256'],
 'originals':r['files'],'packet':copies,'aliases':aliases,'retained':'Original browser trace/profile, raw machine frames, reconstructed images and full logs remain at original paths; this compact packet does not replace them.'}
(dest/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps({'report_sha256':provenance['report_sha256'],'copies':len(copies),'aliases':len(aliases),'originals':len(r['files'])}))
