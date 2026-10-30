import argparse,gzip,hashlib,json,shutil,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('destination',type=Path);p.add_argument('--public',action='store_true');p.add_argument('--deployment');a=p.parse_args()
root=Path.cwd();source=a.source.resolve();dest=a.destination
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'])
report=json.loads((source/'report.json').read_text());assert report['status']=='passed'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();assert report['head']==head
browser=source if a.public else source/'browser';br=json.loads((browser/'report.json').read_text());assert br['status']=='passed' and br['errors']==[]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
dest.mkdir(parents=True,exist_ok=False);copies=[];aliases=[]
def copy(p,name,compress=False):
 q=dest/name
 if compress:
  with p.open('rb') as f,q.open('wb') as out:
   with gzip.GzipFile(fileobj=out,mode='wb',mtime=0) as z:shutil.copyfileobj(f,z)
 else:shutil.copyfile(p,q)
 copies.append({'source':str(p),'path':name,'source_bytes':p.stat().st_size,'source_sha256':sha(p),'bytes':q.stat().st_size,'sha256':sha(q),'encoding':'gzip' if compress else 'identity'})
if not a.public:
 for path in sorted(source.glob('*.log')):copy(path,path.name)
 copy(source/'report.json','acceptance.json')
for path in sorted(browser.iterdir()):
 if path.is_file() and path.suffix in ('.png','.json') and path.name!='javascript-coverage.json':copy(path,path.name)
copy(browser/'javascript-coverage.json','javascript-coverage.json.gz',True)
# Keep full chosen machine tuples once; byte-identical restored/interference witnesses are aliases.
seen={}
for name in [br['checks']['alpha']['evidence'],br['checks']['beta']['evidence'],'alpha-restored.checkpoint.gz','after-preview.checkpoint.gz','after-incompatible.checkpoint.gz','after-errors.checkpoint.gz','beta-restored.checkpoint.gz']:
 path=browser/name;digest=sha(path)
 if digest in seen:aliases.append({'source':str(path),'packet':seen[digest],'source_sha256':digest})
 else:copy(path,name);seen[digest]=name
copy(Path(__file__),'packet.source.py')
if a.public and a.deployment:copy(Path('/tmp/e9-t06-deploy.log'),'deploy.log')
provenance={'task':'E9-T06','status':'passed','head':head,'deployment':a.deployment,'production':'https://wasm-vm.pages.dev/' if a.public else None,
 'command':['node','tools/verify/e9-session-library-browser.mjs','--url','https://wasm-vm.pages.dev/','--output',str(source)] if a.public else ['make','verify-E9-T06'],
 'original':str(source),'report_sha256':sha(source/'report.json'),'source_sha256':report.get('source_sha256',{}),
 'files':[{'path':str(p.relative_to(source)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(source.rglob('*')) if p.is_file()],
 'packet':copies,'aliases':aliases}
(dest/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps({'report_sha256':provenance['report_sha256'],'copies':len(copies),'aliases':len(aliases),'originals':len(provenance['files'])}))
