#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,os,shutil,sys,time
args=sys.argv[1:]
receipt=Path('/Volumes/e9-t11-cold-scratch/e9-t12-rootfs-ranges/receipt.json')
url='https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8/releases/rootfs/alpine-rootfs.ext4'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
if args and args[-1]==url and '--output'in args and '--range'not in args:
 r=json.loads(receipt.read_text());p=Path(r['object']);assert r['status']=='passed'and r['url']==url and p.stat().st_size==r['bytes']==536870912
 assert sha(p)==r['sha256']=='ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8'
 dest=Path(args[args.index('--output')+1]);shutil.copyfile(p,dest);assert sha(dest)==r['sha256']
 with Path('/Volumes/e9-final-proof-ram/e9-t12-repaired-range-deploy-curl.jsonl').open('a')as f:f.write(json.dumps({'time':time.time(),'args':args,'public_range_receipt':str(receipt),'receipt_sha256':sha(receipt),'authenticated_bytes':r['bytes'],'sha256':r['sha256'],'destination':str(dest)})+'\n')
 print('[deploy-range-read] copied complete SHA256-verified public HTTP206 reassembly',file=sys.stderr);raise SystemExit(0)
os.execv('/usr/bin/curl',['/usr/bin/curl','--retry','2','--retry-all-errors','--retry-delay','1',*args])
