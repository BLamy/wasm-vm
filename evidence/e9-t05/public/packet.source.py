import gzip,hashlib,json,shutil,subprocess,sys
from pathlib import Path
root=Path.cwd();out=root/'target/evidence/e9-t05-public-final';packet=root/'evidence/e9-t05/public'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=all'])
report=json.loads((out/'report.json').read_text());assert report['head']==head and report['status']=='passed' and report['errors']==[]
assert report['checks']['suite']=={'passed':127,'failed':0} and len(report['checks']['publicBytes'])==16
assert all(x['admission']=='accepted' and x['frameDiskHash']==x['rootDiskHash'] for x in report['checks']['aba'])
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
packet.mkdir(exist_ok=False);copies=[]
def copy(original,name,compress=False):
 dest=packet/name
 if compress:
  with original.open('rb') as f,dest.open('wb') as out:
   with gzip.GzipFile(fileobj=out,mode='wb',mtime=0) as z:shutil.copyfileobj(f,z)
 else:shutil.copyfile(original,dest)
 copies.append({'source':str(original),'path':name,'source_bytes':original.stat().st_size,'source_sha256':sha(original),'bytes':dest.stat().st_size,'sha256':sha(dest),'encoding':'gzip' if compress else 'identity'})
for path in sorted(out.iterdir()):
 if path.is_file() and path.suffix not in ('.ext4','.zip','.native','.checkpoint') and path.name!='javascript-coverage.json':copy(path,path.name)
for name in ['before.checkpoint','after.checkpoint','javascript-coverage.json']:copy(out/name,name+'.gz',True)
assert sha(out/'before.checkpoint')==sha(out/'restored.checkpoint')
copy(Path('/tmp/e9-t05-public-final.log'),'browser.log');copy(Path('/tmp/e9-t05-deploy.log'),'deploy.log');copy(Path(__file__),'packet.source.py')
sources=json.loads((root/'target/evidence/e9-t05-cold-final/receipt.json').read_text())['source_sha256']
provenance={'task':'E9-T05','status':'passed','head':head,'runtime_head':'4ce36a932feaf171c09cd8b25e90d3fc9ff376ac','deployment':sys.argv[1],'production':'https://wasm-vm.pages.dev/','command':['node','tools/verify/e9-software-checkpoints-browser.mjs','--url','https://wasm-vm.pages.dev/','--output','target/evidence/e9-t05-public-final'],'source_clean_before_and_after':True,'source_sha256':{n:sha(root/n) for n in sources},'original_evidence':str(out),'report_sha256':sha(out/'report.json'),'files':[{'path':str(p.relative_to(out)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.rglob('*')) if p.is_file()],'packet':copies,'aliases':[{'source':'restored.checkpoint','packet':'before.checkpoint.gz','source_sha256':sha(out/'restored.checkpoint')}]}
(packet/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps({'head':head,'packet_files':len(copies),'original_files':len(provenance['files']),'report_sha256':provenance['report_sha256']}))
