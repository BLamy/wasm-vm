// Read installed files into the guest's real page cache; never launch an app or
// accept its first-run settings in the clean factory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {verifyCleanFactory} from './omarchy-factory-guard.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export const prewarmSource=`from pathlib import Path
import os,stat,json,mmap,ctypes,hashlib,struct
assert os.getuid()==1000 and os.sysconf('SC_PAGE_SIZE')==4096
paths=sorted({p.resolve() for root in ['/usr/lib/chromium','/usr/lib/libreoffice/program'] for p in Path(root).iterdir() if p.is_file() and not p.is_symlink()})
assert Path('/usr/lib/chromium/chromium') in paths and Path('/usr/lib/libreoffice/program/soffice.bin') in paths
total=sum(p.stat().st_size for p in paths);assert 500*1024*1024<total<=640*1024*1024
libc=ctypes.CDLL(None);libc.mincore.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_ubyte)]
rows=[];mappings=[];rootdev=Path('/').stat().st_dev;completed=0
for p in paths:
 s=p.stat();assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_dev==rootdev and not stat.S_IMODE(s.st_mode)&0o022
 read=0;header=None
 with p.open('rb',buffering=0) as f:
  while True:
   b=f.read(1024*1024)
   if not b:break
   if header is None:header=b[:64]
   read+=len(b)
  after=p.stat();fields=['st_dev','st_ino','st_size','st_mode','st_uid','st_gid','st_mtime_ns','st_ctime_ns']
  assert read==s.st_size and all(getattr(after,k)==getattr(s,k) for k in fields)
  if p.name in ['chromium','soffice.bin']:assert header[:4]==bytes([127,69,76,70]) and struct.unpack_from('<H',header,18)[0]==243
  if s.st_size:mappings.append((len(rows),mmap.mmap(f.fileno(),0,flags=mmap.MAP_PRIVATE,prot=mmap.PROT_READ|mmap.PROT_WRITE)))
 rows.append(dict(path=str(p),bytes=s.st_size,readBytes=read,ino=s.st_ino,uid=s.st_uid,mode=stat.S_IMODE(s.st_mode)))
 completed+=read
 print(json.dumps(dict(phase='file-cache-progress',path=str(p),readBytes=read,completedBytes=completed,totalBytes=total)),flush=True)
for index,m in mappings:
 size=len(m);pages=(size+4095)//4096;v=(ctypes.c_ubyte*pages)();address=ctypes.addressof(ctypes.c_char.from_buffer(m))
 assert libc.mincore(address,size,v)==0
 resident=sum(x&1 for x in v);assert resident==pages,(rows[index]['path'],resident,pages)
 rows[index].update(pages=pages,resident=resident,mincoreSha256=hashlib.sha256(bytes(v)).hexdigest());m.close()
print(json.dumps(dict(scope='Native read-only installed-file cache preparation, no application launch or profile writes',uid=os.getuid(),totalBytes=total,files=rows)))
`;

export async function prewarmFactoryApplications(page,command,output){
  await fs.writeFile(path.join(output,'factory-prewarm.py'),prewarmSource);
  const compressed=deflateSync(Buffer.from(prewarmSource)).toString('base64');
  const code=`import zlib,base64,hashlib;s=zlib.decompress(base64.b64decode(${JSON.stringify(compressed)}));assert hashlib.sha256(s).hexdigest()==${JSON.stringify(hash(prewarmSource))};exec(compile(s,'<factory-prewarm>','exec'))`;
  const text='python3 -c '+quote(code);assert.ok(Buffer.byteLength(text)<2500,'bounded serial preparation command');
  // This is one-time factory preparation, not an application-startup budget.
  // Retain actual progress if the interpreted filesystem exceeds the deadline.
  const native=await command(page,text,1800000);assert.equal(native.exit,0,native.stdout);
  const lines=native.stdout.trim().split('\n').map(line=>JSON.parse(line));
  const observed=lines.pop(),progress=lines;assert.equal(observed.uid,1000);
  assert.ok(observed.files.length>200);assert.equal(observed.files.reduce((sum,row)=>sum+row.readBytes,0),observed.totalBytes);
  assert.equal(progress.length,observed.files.length);let completed=0;
  for(let n=0;n<progress.length;n++){
    const row=progress[n],file=observed.files[n];completed+=file.readBytes;
    assert.deepEqual(row,{phase:'file-cache-progress',path:file.path,readBytes:file.readBytes,completedBytes:completed,totalBytes:observed.totalBytes});
  }
  for(const row of observed.files)if(row.bytes)assert.equal(row.resident,row.pages);
  const guard=await verifyCleanFactory(page,command,output,{name:'factory-after-prewarm-guard'});
  const receipt={status:'passed',scope:'Actual native page-cache preparation before clean factory capture; application launch-time benefit must be measured after restoring the new pair',scriptSha256:hash(prewarmSource),command:text,native,progress,observed,guard};
  await fs.writeFile(path.join(output,'factory-prewarm.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
