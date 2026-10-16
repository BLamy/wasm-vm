#!/usr/bin/env python3
"""Fresh critic: reopen every logical sealed member against the recorded custody pins."""
import hashlib,io,json,os,pathlib,subprocess,tarfile,time
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(__file__).resolve().parent
BASE='a19b49441e932e64446f756cefe0c18e6b5b71b3'
FROZEN='3cbb041b43928701026b5ca2ddfb3dcf9a799c2b'
SUBMISSION='d88235ea7d16b2475ff9d6c7d96cc361d5589c3e'
sha=lambda b:hashlib.sha256(b).hexdigest()
PINS=[
('virgl-instanced-stencil','worker','2387876828e65c6b958b5c0d9898a3face77af6fc26ffa5bbc114b0890da33a3','e43fb84a4a36adb043968185259061fe2a8af6b44edcb334cbe63c7975d73857','af534b07ebb9a8422adebdf9cd66286f8b2c3472faff8ee38b0a5433ac320b99',41944,SUBMISSION),
('virgl-ordered-stencil','worker','6e1ab959e3e04a2998eabf4b60233419f3b0934ee33ccf2d36b09e441c28886c','bfee67b4e66aa3645f1f05a7847ef0e8f6ee5f092904a60ff56ab28c22aae8eb','5d40d9cf0650b561637863b24cd52984cf1fbaf08ebf988e8a57940add1f13ed',83324,BASE),
('virgl-ordered-stencil','verifier','4b0b3b14105b4005e68bf52dde8666e0b85fd80731ad988e39f1759b4a3d66a9','8ed963dbb701cf544a1c6c1adfe409e5164d8f664b7737fde65924588a2bcd6e','d76c57d568deff90f0578b45afde5405804981b4d5c6e33f192f1ab979b27a1b',8065,BASE),
('virgl-instance-base','worker','649def87b9a04660ba795de462f7ff1773bf0d9db9b89c501b6a417accddf5ce','e9ff82d91a2f6d8e6310e971ef87357a5aa22237f5eaf25facad465351ee29b9','f746e58d61505392aa5b7f23fe919e2585187be0925e86f3158282052076df0e',2584,BASE),
('virgl-instance-base','verifier','8fc075d8d6e85a4078ddf507cb349282b5579093f5c047a3a14c2929d17f13b4','2298b9fbb3e68cbe4d2996d92d335efeb891c552de5eb41f8d9ed531adc3dc58','cf4cf5b9ced80cc4f379748bd199f9228d1cb4f6de8810adbef2f209aed70563',3206,BASE)]

def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def safe(name):
 p=pathlib.PurePosixPath(name)
 assert not p.is_absolute() and '..' not in p.parts and str(p)==name
 return p

def reopen(family,role,mpin,ipin,apin,count,head):
 folder=ROOT/'evidence'/family/role
 mraw=(folder/'manifest.json').read_bytes();iraw=(folder/'records.json').read_bytes()
 assert sha(mraw)==mpin and sha(iraw)==ipin
 manifest=json.loads(mraw);entries=json.loads(iraw)['records']
 expected={r['path']:r for r in entries};assert len(expected)==len(entries)==count==manifest['records']
 for name in ('manifest.json','records.json'):
  assert (folder/name).read_bytes()==git('show',head+':'+(folder/name).relative_to(ROOT).as_posix())
 parts=manifest.get('archiveParts') or [{'path':'recording.tar.gz'}]
 archive=OUT/(family+'-'+role+'.tar.gz')
 h=hashlib.sha256();total=0
 with archive.open('wb') as dest:
  for part in parts:
   raw=(folder/part['path']).read_bytes()
   if 'sha256' in part:assert sha(raw)==part['sha256'] and len(raw)==part['bytes']
   assert raw==git('show',head+':'+(folder/part['path']).relative_to(ROOT).as_posix())
   dest.write(raw);h.update(raw);total+=len(raw)
 assert h.hexdigest()==apin
 if 'archiveBytes' in manifest:assert total==manifest['archiveBytes']
 dest=OUT/('unpacked' if family=='virgl-instanced-stencil' else 'predecessor/'+family+'/'+role)
 dest.mkdir(parents=True,exist_ok=True)
 seen=set();physical={};logical=0
 with tarfile.open(archive,'r|gz') as tar:
  for member in tar:
   safe(member.name);assert member.name not in seen and member.name in expected
   target=dest/member.name;target.parent.mkdir(parents=True,exist_ok=True)
   assert not target.exists(),'refuse an existing extraction '+str(target)
   if member.islnk():
    safe(member.linkname);assert member.linkname in physical
    original=physical[member.linkname];raw=original.read_bytes();os.link(original,target)
   else:
    assert member.isfile();raw=tar.extractfile(member).read();target.write_bytes(raw);physical[member.name]=target
   wanted=expected[member.name];assert len(raw)==wanted['bytes'] and sha(raw)==wanted['sha256'],member.name
   seen.add(member.name);logical+=len(raw)
 assert seen==set(expected)
 result=dict(family=family,role=role,manifestSha256=mpin,indexSha256=ipin,archiveSha256=apin,archiveBytes=total,logicalMembers=len(seen),physicalMembers=len(physical),logicalBytes=logical,allBodiesReopened=True,extracted=str(dest))
 print(json.dumps(result),flush=True)
 return result

result={'schema':'fresh-instanced-stencil-full-custody-v1','sourceHead':FROZEN,'submissionHead':SUBMISSION,'seals':[]}
for pin in PINS:result['seals'].append(reopen(*pin))
u=OUT/'unpacked'
for name,pin in [('hot/receipt.json','bdc6f224e844d2c0df98f02eba8341ef91f91c45237093bd90983835db3eb11b'),('cold/report.json','2611b10d826aab641d8acb157e1450a1562ad4023bcd90609b290c6032d3770b'),('cold/receipt.json','60747e2056d6443ff543428a8df92860a0bfda593b854d46168cfabc67eaf99d')]:
 raw=(u/name).read_bytes();assert sha(raw)==pin;record=json.loads(raw);assert record['gitHead']==FROZEN and record['status']=='passed'
result['sources']=[]
for source in sorted((u/'source').rglob('*')):
 if source.is_file():
  name=source.relative_to(u/'source').as_posix();raw=source.read_bytes()
  assert raw==git('show',FROZEN+':'+name),(name,'frozen source mismatch')
  if name not in ['tasks/epic-6-transcendence/E6-T11d47-instanced-stencil-consumer.md']:assert raw==(ROOT/name).read_bytes(),(name,'working source mismatch')
  result['sources'].append({'path':name,'bytes':len(raw),'sha256':sha(raw)})
changes=git('diff','--name-only',FROZEN,SUBMISSION).decode().splitlines()
assert all(n.startswith('evidence/virgl-instanced-stencil/worker/') or n in ['tasks/QUEUE.md','tasks/epic-6-transcendence/E6-T11d47-instanced-stencil-consumer.md'] for n in changes)
result['postFreezeChanges']=changes
for role in ['worker','verifier']:
 for archived in (u/'predecessor-seals/evidence/virgl-instance-base'/role).iterdir():
  assert archived.read_bytes()==(ROOT/'evidence/virgl-instance-base'/role/archived.name).read_bytes()
result['status']='passed';result['completedAt']=time.time()
(OUT/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':'passed','sourceMembers':len(result['sources']),'reopenedMembers':sum(r['logicalMembers'] for r in result['seals'])}),flush=True)
