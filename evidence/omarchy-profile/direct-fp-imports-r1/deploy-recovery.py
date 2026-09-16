"""Resume publication only after independently downloading every snapshot byte."""
from pathlib import Path
import concurrent.futures, hashlib, json, subprocess, tempfile, time
out = Path(__file__).resolve().parent
repo = out.parents[2]
digest = '2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5'
url = 'https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/'+digest+'/releases/boot-snapshot/omarchy-ready.snap.gz'
size, chunk = 205050833, 4*1024*1024
receipt = {'url': url, 'bytes': size, 'expectedSha256': digest, 'ranges': [], 'passed': False}
def save(): (out/'deploy-recovery.json').write_text(json.dumps(receipt,indent=2)+'\n')
with tempfile.TemporaryDirectory(prefix='direct-fp-r2-',dir='/private/tmp') as tmp:
 def fetch(start):
  end=min(size,start+chunk)-1
  target=Path(tmp)/str(start); headers=Path(tmp)/(str(start)+'.headers')
  args=['curl','--fail','--silent','--show-error','--location','--retry','2',
        '--max-time','60','--range',str(start)+'-'+str(end),'-D',str(headers),'-o',str(target),url]
  subprocess.run(args,check=True)
  data=target.read_bytes()
  assert len(data)==end-start+1
  assert ('content-range: bytes '+str(start)+'-'+str(end)+'/'+str(size)) in headers.read_text().lower()
  return {'start':start,'end':end,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for row in pool.map(fetch,range(0,size,chunk)):
   receipt['ranges'].append(row);save();print('verified range',row['start'],row['end'],flush=True)
 h=hashlib.sha256()
 for row in receipt['ranges']: h.update((Path(tmp)/str(row['start'])).read_bytes())
 receipt['sha256']=h.hexdigest()
 assert receipt['sha256']==digest
 receipt['passed']=True;save()
# The original deployment already staged and validated all manifests and the
# other R2 objects. Recheck Pages file-size bounds, then perform its final command.
assert all(p.stat().st_size<=25*1024*1024 for p in (repo/'web/dist').rglob('*') if p.is_file())
command=['npx','--yes','wrangler','pages','deploy','web/dist','--project-name','wasm-vm','--branch','main','--commit-dirty=true']
receipt['command']=command;save()
result=subprocess.run(command,cwd=repo)
receipt['publicationExit']=result.returncode;save()
assert result.returncode==0
