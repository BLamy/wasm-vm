from pathlib import Path
import hashlib,json,subprocess,tarfile
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'target/evidence/virgl-standard-points-critic'
SEAL=ROOT/'evidence/virgl-standard-points/worker'
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
manifest=json.loads((SEAL/'manifest.json').read_bytes());index_raw=(SEAL/'records.json').read_bytes();index=json.loads(index_raw)
assert manifest['archiveSha256']=='797426c742a74686db9e4dbdf02135a58b8d30fec3433cd17a4f73e3bb78f846'
assert sha((SEAL/'recording.tar.gz').read_bytes())==manifest['archiveSha256']
assert sha(index_raw)==manifest['recordIndexSha256']
records={r['path']:r for r in index['records']};assert len(records)==len(index['records'])==manifest['records']==13269
unpack=OUT/'worker';seen=set()
with tarfile.open(SEAL/'recording.tar.gz','r:gz') as tar:
 for member in tar:
  assert member.isfile() and member.name in records and member.name not in seen
  assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
  row=records[member.name];raw=tar.extractfile(member).read()
  assert len(raw)==row['bytes']==member.size and sha(raw)==row['sha256'],member.name
  dest=unpack/member.name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw);seen.add(member.name)
assert seen==set(records)
all_sources={};all_generated={};files=0
for label in ['hot','cold']:
 receipt=json.loads((unpack/label/'receipt.json').read_bytes());assert receipt['status']=='passed'
 assert receipt['gitHead']==manifest['sourceHead']==index['sourceHead']=='8ccd2036305321645d7f8b47cf7e2c1bcdced863'
 for name,digest in receipt['files'].items():assert sha((unpack/label/name).read_bytes())==digest,(label,name);files+=1
 for name,digest in receipt['sources'].items():
  assert sha((ROOT/name).read_bytes())==digest,(label,'current',name)
  assert sha(git('show',manifest['sourceHead']+':'+name))==digest,(label,'frozen',name)
  assert name not in all_sources or all_sources[name]==digest,(label,'source disjoint',name)
  all_sources[name]=digest
 for name,digest in receipt['generated'].items():
  assert sha((unpack/(label+'-generated')/name).read_bytes())==digest,(label,name)
  all_generated[label+'/'+name]=digest
for name in ['bridge.c','standard_guard.c','standard_guard.h','standard_emit.c']:
 n='renderer/virgl-shader/'+name
 assert git('show','53e01e081ca7495960c6c51a15b585d4b66c64fe:'+n)==git('show','3d9cfcd03f2eabe900c50173242834aa6ce5f0e6:'+n)
for name in ['constant-domain.mjs','state.mjs','decoder.mjs']:
 n='renderer/virgl-command/'+name
 assert git('show','53e01e081ca7495960c6c51a15b585d4b66c64fe:'+n)==git('show','3d9cfcd03f2eabe900c50173242834aa6ce5f0e6:'+n)
cold=json.loads((unpack/'cold/report.json').read_bytes())
assert cold['status']=='passed' and cold['exitCode']==0 and not cold['statusBefore'] and not cold['statusAfter']
assert cold['gitHead']==cold['cloneHead']==manifest['sourceHead']
assert cold['command']==['make','verify-E6-T11d11']
assert sha((unpack/'cold/cold.log').read_bytes())==cold['logSha256']
assert sha((unpack/'cold/receipt.json').read_bytes())==cold['receiptSha256']==manifest['coldReceiptSha256']
assert sha((unpack/'hot/receipt.json').read_bytes())==manifest['hotReceiptSha256']
out=dict(status='passed',predictionsMadeBeforeEvidence=True,archiveSha256=manifest['archiveSha256'],records=len(records),authenticatedReceiptFiles=files,sourceClosure=len(all_sources),generated=len(all_generated),sourceHead=manifest['sourceHead'],cold=cold)
(OUT/'authentication.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k!='cold'}))
