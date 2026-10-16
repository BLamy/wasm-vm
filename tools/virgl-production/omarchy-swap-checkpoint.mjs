// Separate acceptance fixture: never install or run this in a factory capture.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
export const SWAP_PROBE_BYTES=4194304;

export function swapLiteral(seed) {
  assert.ok(Number.isSafeInteger(seed)&&seed>=0&&seed<=0xffffffff);
  const b=Buffer.alloc(SWAP_PROBE_BYTES),block=Buffer.from(Array.from({length:256},(_,i)=>i));
  for(let at=0;at<b.length;at+=256)b.set(block,at);
  for(let page=0;page<1024;page++){
    const a=BigInt(page)^BigInt(seed),v=BigInt.asUintN(64,BigInt(page)*0x9e3779b97f4a7c15n^BigInt(seed));
    b.writeBigUInt64LE(a,page*4096);b.writeBigUInt64LE(v,page*4096+8);
    b.writeBigUInt64LE(a^0xa5a5a5a5a5a5a5a5n,page*4096+4080);b.writeBigUInt64LE(BigInt.asUintN(64,~v),page*4096+4088);
  }
  return b;
}

export function swapProbeSource(directory,seed) {
  assert.match(directory,/^\/tmp\/wvm-[a-z0-9-]+$/);
  assert.ok(Number.isSafeInteger(seed)&&seed>=0&&seed<=0xffffffff);
  return `import os,json,mmap,ctypes,struct,hashlib,time,re,resource
from pathlib import Path
root=Path(${JSON.stringify(directory)}); size=4194304; pages=1024; seed=${seed}; mask=(1<<64)-1
assert os.getuid()==1000 and os.sysconf('SC_PAGE_SIZE')==4096
def start(): return Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19]
def swap(): return int(re.search(r'^VmSwap:\\s+(\\d+)',Path('/proc/self/status').read_text(),re.M)[1])*1024
def vmstats(): return {k:int(v) for k,v in (line.split() for line in Path('/proc/vmstat').read_text().splitlines()) if k in ['pswpin','pswpout','pgmajfault']}
def write(name,value):
 p=root/(name+'.tmp');p.write_text(json.dumps(value));p.replace(root/(name+'.json'))
data=bytearray(bytes(range(256))*(size//256))
for page in range(pages):
 a=page^seed;v=((page*0x9e3779b97f4a7c15)^seed)&mask
 data[page*4096:page*4096+16]=struct.pack('<QQ',a,v)
 data[page*4096+4080:page*4096+4096]=struct.pack('<QQ',a^0xa5a5a5a5a5a5a5a5,~v&mask)
m=mmap.mmap(-1,size,flags=mmap.MAP_PRIVATE|mmap.MAP_ANONYMOUS,prot=mmap.PROT_READ|mmap.PROT_WRITE);m[:]=data
address=ctypes.addressof(ctypes.c_char.from_buffer(m))
libc=ctypes.CDLL(None,use_errno=True);libc.mincore.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_ubyte)];libc.mincore.restype=ctypes.c_int
def mapstate():
 with open('/proc/self/pagemap','rb',buffering=0) as f:f.seek(address//4096*8);raw=f.read(pages*8)
 assert len(raw)==pages*8
 entries=struct.unpack('<1024Q',raw)
 vec=(ctypes.c_ubyte*pages)();assert libc.mincore(address,size,vec)==0,ctypes.get_errno()
 return {'present':sum(bool(v&(1<<63)) for v in entries),'swapped':sum(bool(v&(1<<62)) for v in entries),'resident':sum(bool(v&1) for v in vec),'entriesSha256':hashlib.sha256(raw).hexdigest(),'mincoreSha256':hashlib.sha256(bytes(vec)).hexdigest()}
before=mapstate();beforeSwap=swap();assert before['present']==pages and before['swapped']==0 and before['resident']==pages
pageoutSamples=[]
for attempt in range(2):
 passBefore=mapstate();m.madvise(getattr(mmap,'MADV_PAGEOUT',21));time.sleep(0.5);paged=mapstate()
 pageoutSamples.append(dict(passNumber=attempt+1,before=passBefore,after=paged))
 if paged['present']==0 and paged['swapped']==pages and paged['resident']==0:break
 # A first write can leave clean data in swap cache. Refault unchanged bytes,
 # then reclaim that clean mapping; never discard or reconstruct its contents.
 assert m[:]==data
assert paged['present']==0 and paged['swapped']==pages and paged['resident']==0,(before,paged,beforeSwap,swap())
pagedSwap=swap()
exe=Path('/proc/self/exe').resolve();elf=exe.read_bytes();assert elf[:4]==bytes([127,69,76,70]) and struct.unpack_from('<H',elf,18)[0]==243
identity={'pid':os.getpid(),'starttime':start(),'address':address,'bytes':size,'pages':pages,'seed':seed,'expectedSha256':hashlib.sha256(data).hexdigest(),'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'exe':str(exe),'exeSha256':hashlib.sha256(elf).hexdigest()}
assert mapstate()['resident']==0
write('paged',dict(identity,before=before,paged=paged,beforeSwapBytes=beforeSwap,pagedSwapBytes=pagedSwap,pageoutSamples=pageoutSamples,meminfo=Path('/proc/meminfo').read_text()))
deadline=time.monotonic()+1200;waitingChecks=0
while not (root/'refault').exists():
 assert time.monotonic()<deadline,'owned restore fixture deadline'
 state=mapstate();assert state['resident']==0 and state['present']==0 and state['swapped']==pages;waitingChecks+=1
 time.sleep(0.2)
restoredBefore=mapstate();assert restoredBefore['present']==0 and restoredBefore['swapped']==pages and restoredBefore['resident']==0
blockBefore=list(map(int,Path('/sys/block/vda/stat').read_text().split()));vmBefore=vmstats();majorBefore=resource.getrusage(resource.RUSAGE_SELF).ru_majflt
observed=m[:];assert observed==data;after=mapstate();assert after['present']==pages and after['swapped']==0 and after['resident']==pages
blockAfter=list(map(int,Path('/sys/block/vda/stat').read_text().split()));vmAfter=vmstats();majorAfter=resource.getrusage(resource.RUSAGE_SELF).ru_majflt
assert blockAfter[2]-blockBefore[2]>=size//512 and vmAfter['pswpin']-vmBefore['pswpin']>=pages and vmAfter['pgmajfault']>vmBefore['pgmajfault'],(blockBefore,blockAfter,vmBefore,vmAfter,majorBefore,majorAfter)
# Retain per-process rusage too. On the original RISC-V6.6.63 kernel the
# VMA-lock retry path can count a swap-in globally and as a minor task fault.
write('result',dict(identity,restoredBefore=restoredBefore,after=after,observedSha256=hashlib.sha256(observed).hexdigest(),afterSwapBytes=swap(),blockBefore=blockBefore,blockAfter=blockAfter,vmBefore=vmBefore,vmAfter=vmAfter,majorBefore=majorBefore,majorAfter=majorAfter,waitingChecks=waitingChecks))
m.close()
`;
}

async function run(command,page,text,timeout=300000) {
  const result=await command(page,text,timeout);assert.equal(result.exit,0,result.stdout+'\n'+text);return result;
}
async function waitJson(page,command,filename,output,label) {
  const deadline=Date.now()+600000,probes=[];
  do{
    const code=`from pathlib import Path;import json;p=Path(${JSON.stringify(filename)});r=p.parent;pid=json.loads((r/'launch.json').read_text())['pid'];s=Path('/proc')/str(pid)/'stat';alive=s.exists() and s.read_text().rsplit(')',1)[1].split()[0]!='Z';print(json.dumps({'value':json.loads(p.read_text()) if p.exists() else None,'alive':alive,'stderr':(r/'probe.log').read_text()[-8192:]}))`;
    const value=await run(command,page,'python3 -c '+quote(code));probes.push(value);
    await fs.writeFile(path.join(output,label+'-polls.json'),JSON.stringify(probes,null,2)+'\n');
    const parsed=JSON.parse(value.stdout.trim());assert.equal(parsed.stderr,'','actual swap probe stderr');
    if(parsed.value)return parsed.value;
    assert.equal(parsed.alive,true,'actual swap probe remains alive while waiting');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }while(Date.now()<deadline);
  throw Error('Owned swapped-page fixture did not reach '+filename);
}

export async function prepareSwapFixture(page,command,output,{name='swap-checkpoint',seed=42}={}) {
  assert.match(name,/^[a-z0-9-]+$/);const directory='/tmp/wvm-'+name;
  const literal=swapLiteral(seed),script=swapProbeSource(directory,seed),scriptBytes=Buffer.from(script);
  await fs.writeFile(path.join(output,name+'-literal.bin'),literal);await fs.writeFile(path.join(output,name+'-probe.py'),scriptBytes);
  // Keep every fenced serial command below the terminal's canonical line cap.
  // The child authenticates the complete script; truncation cannot pass as setup.
  const transfer=[];
  async function send(code){const text='python3 -c '+quote(code);assert.ok(Buffer.byteLength(text)<2500);const result=await run(command,page,text);transfer.push({command:text,result});await fs.writeFile(path.join(output,name+'-transfer.json'),JSON.stringify(transfer,null,2)+'\n');return result;}
  await send(`from pathlib import Path;import os;assert os.getuid()==1000;p=Path(${JSON.stringify(directory)});p.mkdir(mode=0o700);(p/'probe.py').touch(mode=0o600,exist_ok=False);print('owned fixture created')`);
  for(let at=0;at<scriptBytes.length;at+=1024){
    const body=scriptBytes.subarray(at,Math.min(scriptBytes.length,at+1024));
    await send(`from pathlib import Path;import os,stat,base64;p=Path(${JSON.stringify(directory+'/probe.py')});s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid()==1000 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size==${at};b=base64.b64decode(${JSON.stringify(body.toString('base64'))});f=p.open('ab');assert f.write(b)==len(b);f.close();print(p.stat().st_size)`);
  }
  const code=`from pathlib import Path;import os,subprocess,json,hashlib;assert os.getuid()==1000;p=Path(${JSON.stringify(directory)});s=p/'probe.py';assert hashlib.sha256(s.read_bytes()).hexdigest()==${JSON.stringify(hash(scriptBytes))};log=(p/'probe.log').open('wb');child=subprocess.Popen(['python3','-u',str(s)],stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);v={'pid':child.pid,'directory':str(p)};(p/'launch.json').write_text(json.dumps(v));print(json.dumps(v))`;
  const launch=await send(code);
  const paged=await waitJson(page,command,directory+'/paged.json',output,name+'-paged');
  assert.equal(paged.pid,JSON.parse(launch.stdout).pid);assert.equal(paged.scriptSha256,hash(scriptBytes));assert.equal(paged.expectedSha256,hash(literal));
  assert.equal(paged.paged.present,0);assert.equal(paged.paged.swapped,1024);assert.equal(paged.paged.resident,0);
  const prepared={name,directory,seed,launch,paged,literalBytes:literal.length,literalSha256:hash(literal),scriptSha256:hash(scriptBytes),scope:'Separate owned anonymous swap fixture; clean factory has already been captured and contains none of these files/processes'};
  await fs.writeFile(path.join(output,name+'-prepared.json'),JSON.stringify(prepared,null,2)+'\n');return prepared;
}

export async function refaultSwapFixture(page,command,output,prepared) {
  const {name,directory,paged}=prepared;assert.match(directory,/^\/tmp\/wvm-[a-z0-9-]+$/);
  const code=`from pathlib import Path;import json;p=Path(${JSON.stringify(directory)});q=json.loads((p/'paged.json').read_text());assert q['pid']==${paged.pid} and q['starttime']==${JSON.stringify(paged.starttime)};s=Path('/proc')/str(q['pid']);assert s.stat().st_uid==1000;assert s.joinpath('stat').read_text().rsplit(')',1)[1].split()[19]==q['starttime'];assert not (p/'result.json').exists() and not (p/'refault').exists();(p/'refault').write_text('after-real-restore');print(json.dumps(q))`;
  const trigger=await run(command,page,'python3 -c '+quote(code));
  assert.deepEqual(JSON.parse(trigger.stdout),paged,'same original paged fixture identity after restore');
  const result=await waitJson(page,command,directory+'/result.json',output,name+'-refault');
  for(const field of ['pid','starttime','address','seed','expectedSha256','scriptSha256','exe','exeSha256'])assert.equal(result[field],paged[field]);
  assert.equal(result.restoredBefore.present,0);assert.equal(result.restoredBefore.swapped,1024);assert.equal(result.restoredBefore.resident,0);
  assert.equal(result.after.present,1024);assert.equal(result.after.swapped,0);assert.equal(result.after.resident,1024);assert.equal(result.observedSha256,prepared.literalSha256);
  assert.ok(result.blockAfter[2]-result.blockBefore[2]>=SWAP_PROBE_BYTES/512);
  assert.ok(result.vmAfter.pswpin-result.vmBefore.pswpin>=1024);assert.ok(result.vmAfter.pgmajfault>result.vmBefore.pgmajfault);
  const receipt={status:'passed',scope:'All4MiB page-unique literal bytes refault after real paired restore; mincore excludes resident swap-cache satisfaction before capture/refault, with actual vda reads, swap-ins and global major faults. Original per-process rusage is retained without asserting it counts this kernel retry path.',prepared,trigger,result};
  await fs.writeFile(path.join(output,name+'-refault-result.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
