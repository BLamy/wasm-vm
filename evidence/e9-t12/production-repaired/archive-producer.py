"""Archive closed proof files losslessly; preserve original recordings and authenticate both forms."""
from pathlib import Path
import argparse,gzip,hashlib,json,os,shutil,stat,time
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--receipt',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
receipt=a.receipt.resolve();report=json.loads(receipt.read_text());assert report['status']=='passed'and report.get('finished')
out=a.output.resolve();out.mkdir(parents=True,exist_ok=False);(out/'files').mkdir()
def sha(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for part in iter(lambda:f.read(1<<20),b''):h.update(part)
 return h.hexdigest()
original_receipt_sha=sha(receipt);shutil.copy2(receipt,out/'original-receipt.json');assert sha(out/'original-receipt.json')==original_receipt_sha
entries=[]
for item in report['files']:
 relative=Path(item['path']);assert not relative.is_absolute()and '..'not in relative.parts
 source=receipt.parent/relative;before=source.stat();assert stat.S_ISREG(before.st_mode)and before.st_size==item['bytes']and sha(source)==item['sha256']
 destination=out/'files'/str(relative);destination=destination.with_name(destination.name+'.gz');destination.parent.mkdir(parents=True,exist_ok=True)
 with source.open('rb')as src,destination.open('wb')as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0,compresslevel=6)as target:
   shutil.copyfileobj(src,target,1<<20)
 h=hashlib.sha256();length=0
 with gzip.open(destination,'rb')as src:
  for part in iter(lambda:src.read(1<<20),b''):h.update(part);length+=len(part)
 assert length==item['bytes']and h.hexdigest()==item['sha256']
 assert source.stat().st_mtime_ns==before.st_mtime_ns and sha(source)==item['sha256']
 entries.append({'original_path':item['path'],'original_bytes':item['bytes'],'original_sha256':item['sha256'],'original_mode':stat.S_IMODE(before.st_mode),'original_mtime_ns':before.st_mtime_ns,'gzip':str(destination.relative_to(out)),'gzip_bytes':destination.stat().st_size,'gzip_sha256':sha(destination)})
shutil.copy2(Path(__file__),out/'archive-producer.py')
result={'task':report.get('task','E9-T12'),'status':'passed','head':report['head'],'original_receipt':str(receipt),'original_receipt_sha256':original_receipt_sha,'original_receipt_copy':'original-receipt.json','scope':__doc__,'original_recordings_preserved':True,'compression':'gzip with empty name and mtime0; every decompressed byte count/SHA independently checked after writing','files':entries,'original_bytes':sum(e['original_bytes']for e in entries),'compressed_bytes':sum(e['gzip_bytes']for e in entries),'producer_sha256':sha(out/'archive-producer.py'),'finished':time.time()}
(out/'provenance.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','files':len(entries),'original_bytes':result['original_bytes'],'compressed_bytes':result['compressed_bytes'],'manifest_sha256':sha(out/'provenance.json')}))
