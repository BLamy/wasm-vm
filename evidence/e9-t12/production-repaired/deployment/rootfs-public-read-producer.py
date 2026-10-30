from pathlib import Path
import concurrent.futures,hashlib,json,os,re,subprocess,time
root=Path('/Volumes/e9-t11-cold-scratch/e9-t12-rootfs-ranges');root.mkdir(exist_ok=True)
url='https://pub-c7188e40d3a0463183db72f9dd03cae2.r2.dev/sha256/ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8/releases/rootfs/alpine-rootfs.ext4'
total=536870912;partsize=16777216;expected='ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return h.hexdigest()
def fetch(i):
 start=i*partsize;end=min(total,start+partsize)-1;p=root/f'{i:02}.bin';hdr=root/f'{i:02}.headers';log=root/f'{i:02}.curl.log'
 command=['/usr/bin/curl','--fail','--silent','--show-error','--location','--range',f'{start}-{end}','--connect-timeout','10','--max-time','120','--speed-time','20','--speed-limit','1024','--retry','2','--retry-all-errors','--retry-delay','1','--dump-header',str(hdr),'--output',str(p),url]
 if i==0 and not p.exists():
  import shutil
  shutil.copy2('/Volumes/e9-t11-cold-scratch/e9-t12-rootfs-range-0.bin',p);shutil.copy2('/Volumes/e9-t11-cold-scratch/e9-t12-rootfs-range-0.headers',hdr)
 else:
  with log.open('wb')as f:r=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT)
  assert r.returncode==0,(i,r.returncode)
 headers=hdr.read_text().lower();assert re.search(r'http/[12.]+\s+206',headers),headers
 assert f'content-range: bytes {start}-{end}/{total}'in headers,(i,headers)
 assert p.stat().st_size==end-start+1
 etags=re.findall(r'^etag:\s*(.+?)\s*$',headers,re.M);assert len(etags)==1
 item={'part':i,'url':url,'start':start,'end':end,'bytes':p.stat().st_size,'sha256':sha(p),'etag':etags[0],'headers':str(hdr),'headers_sha256':sha(hdr),'command':command}
 (root/f'{i:02}.json').write_text(json.dumps(item,indent=2)+'\n');print('range complete',i,flush=True);return item
started=time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:parts=list(pool.map(fetch,range(32)))
assert len({x['etag']for x in parts})==1
joined=root/'alpine-rootfs.ext4'
with joined.open('wb')as out:
 for i in range(32):
  with(root/f'{i:02}.bin').open('rb')as src:
   import shutil
   shutil.copyfileobj(src,out,1<<20)
assert joined.stat().st_size==total and sha(joined)==expected
report={'status':'passed','url':url,'bytes':total,'sha256':expected,'object':str(joined),'parts':parts,'started':started,'finished':time.time(),'scope':'Entire public immutable object fetched through 32 exact validated HTTP206 ranges, reassembled and independently SHA256 checked. No object upload and no expected-byte substitution.'}
(root/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('PUBLIC OBJECT EXACT',expected,flush=True)
