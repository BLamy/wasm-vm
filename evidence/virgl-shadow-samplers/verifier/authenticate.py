#!/usr/bin/env python3
"""Fresh critic: reopen all logical records, including earlier-body hardlinks."""
import hashlib, io, json, os, subprocess, tarfile
from pathlib import Path, PurePosixPath
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
BASE='4e924b694715ec40e653e2e0c87ecc49c929d040'
FREEZE='17b9d9334dfa1b2b209df36e0105e2ec96549fa7'
PINS={
 'current':('f6060a1d127854fa230b3f9ba0f50e83941ded19c4e516f5f5e0908a8f901f8f','7bf6f4ea3b5aaf6b53a0199dc8a3dfa6824cf2c512f5f8a7a48067aad3370192','efde5ede4f9528859ea0f762b34ac906e2e5765724efe87bd563e9615673c5cb',44665),
 'worker':('6e3dac963bac00e954134e0f9ffe3f9f86b595b183b42f823beaa11aacf7b77a','29ca252c9abaf1c2d29fd0f39d53ff4dc73a416a2f3fa13d5bb6d1b95807733f','49c9951e44f0aac20e4d709034e606803698ca7465d7f110078acccd29534c8a',52584),
 'verifier':('9079ba5b7457d02cdf180075f049e26c542484db1c794a56c7bba676461fb7c6','67c1175debe54024f70c35eadbe08733ae08930008a1928dc78af4232ce0349e','642815d0c63aee4e79645203f0cb3437582c46a899eb36dcf159150899d7a05c',626)
}
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *args:subprocess.check_output(['git',*args],cwd=ROOT)

def authenticate(role):
 folder=ROOT/('evidence/virgl-shadow-samplers/worker' if role=='current' else 'evidence/virgl-shadow-shaders/'+role)
 mr,ir=(folder/'manifest.json').read_bytes(),(folder/'records.json').read_bytes()
 mp,ip,ap,count=PINS[role];assert sha(mr)==mp and sha(ir)==ip
 m,index=json.loads(mr),json.loads(ir);rows=index['records'];assert len(rows)==count==m['records']
 pub=FREEZE if role=='current' else BASE
 if role!='current':
  for name,raw in [('manifest.json',mr),('records.json',ir)]:assert raw==git('show',pub+':'+(folder/name).relative_to(ROOT).as_posix())
 archive=b''
 for part in m['archiveParts']:
  raw=(folder/part['path']).read_bytes();assert len(raw)==part['bytes'] and sha(raw)==part['sha256']
  if role!='current':assert raw==git('show',BASE+':'+(folder/part['path']).relative_to(ROOT).as_posix())
  archive+=raw
 assert sha(archive)==ap==m['archiveSha256']
 if role=='current':assert len(archive)==28031341 and index['sourceHead']==m['sourceHead']==FREEZE
 target=OUT/'unpacked'/role;target.mkdir(parents=True,exist_ok=True)
 expected={r['path']:r for r in rows};assert len(expected)==count
 seen=set();physical={};logical_bytes=0;links=0
 with tarfile.open(fileobj=io.BytesIO(archive),mode='r|gz') as tar:
  for entry in tar:
   name=entry.name;path=PurePosixPath(name)
   assert name in expected and name not in seen and not path.is_absolute() and '..' not in path.parts
   assert entry.isfile() or entry.islnk();dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True)
   if entry.islnk():
    assert entry.linkname in physical;raw=(target/entry.linkname).read_bytes();links+=1
   else:raw=tar.extractfile(entry).read();physical[name]=entry.offset
   row=expected[name];assert len(raw)==row['bytes'] and sha(raw)==row['sha256'],name
   if dest.exists():assert dest.read_bytes()==raw,'existing unpacked drift '+name
   elif entry.islnk():os.link(target/entry.linkname,dest)
   else:dest.write_bytes(raw)
   logical_bytes+=len(raw);seen.add(name)
 assert seen==set(expected)
 result=dict(role=role,records=count,physicalBodies=len(physical),hardlinks=links,logicalBytes=logical_bytes,manifestSha256=mp,recordsSha256=ip,archiveSha256=ap,sourceHead=m['sourceHead'])
 print(json.dumps(result),flush=True)
 return result

def main():
 results=[authenticate(role) for role in PINS]
 current=OUT/'unpacked/current'
 hot=json.loads((current/'hot/receipt.json').read_text());cold=json.loads((current/'cold/receipt.json').read_text());report=json.loads((current/'cold/report.json').read_text())
 assert hot['gitHead']==cold['gitHead']==report['gitHead']==report['cloneHead']==FREEZE
 assert report['status']=='passed' and report['statusBefore']==report['statusAfter']==''
 assert sha((current/'cold/receipt.json').read_bytes())==report['receiptSha256']
 sources={}
 for name,digest in hot['sources'].items():
  raw=(current/'source'/name).read_bytes();assert sha(raw)==digest and raw==git('show',FREEZE+':'+name)
  if not name.startswith('tasks/'):assert (ROOT/name).read_bytes()==raw
  sources[name]=digest
 for side,r in [('hot',hot),('cold',cold)]:
  assert r['sources']==hot['sources'] and r['generated']==hot['generated']
  for name,digest in r['files'].items():assert sha((current/side/name).read_bytes())==digest,(side,name)
  for name,digest in r['generated'].items():
   assert sha((current/(side+'-generated')/name).read_bytes())==digest
   assert sha((ROOT/name).read_bytes())==digest
 clone=Path(report['clone']);assert clone.exists()
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==FREEZE
 assert subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone,text=True)==''
 result=dict(status='passed',prediction='P01/P12',seals=results,sources=sources,generated=hot['generated'],hotReceiptSha256=sha((current/'hot/receipt.json').read_bytes()),coldReceiptSha256=sha((current/'cold/receipt.json').read_bytes()),coldReportSha256=sha((current/'cold/report.json').read_bytes()),coldClone=report,completeLogicalBodiesReopened=True)
 (OUT/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps(dict(status='passed',sourceFiles=len(sources),generated=r['generated'],clonePristine=True)))

if __name__=='__main__':main()
