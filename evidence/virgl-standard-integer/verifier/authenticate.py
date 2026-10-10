#!/usr/bin/env python3
import gzip,hashlib,json,subprocess,tarfile
from pathlib import Path,PurePosixPath
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
WORKER=OUT.parent/'worker'
UNPACK=OUT/'unpacked'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
read=lambda name:json.loads((UNPACK/name).read_text())
manifest=json.loads((WORKER/'manifest.json').read_text());index=json.loads((WORKER/'records.json').read_text())
assert sha((WORKER/'recording.tar.gz').read_bytes())==manifest['archiveSha256']=='a4f79256677d3f5ef6e2de5f1b2c15ca6b85b6b9c7f7ba5ccbb222424459b93a'
assert sha((WORKER/'records.json').read_bytes())==manifest['recordIndexSha256']=='506e7ff96e26d0a7098c5cd2b6d30c43aa79d9a67b468b3e30b5a8e86ce44df9'
head=index['sourceHead'];assert head==manifest['sourceHead']=='12bb78e1b7f4b9d636f8d46091b9a1a1766fbe4b'
expected={row['path']:row for row in index['records']};assert len(expected)==len(index['records'])==14584
observed={}
with tarfile.open(WORKER/'recording.tar.gz','r:gz') as archive:
 for member in archive:
  name=member.name;parts=PurePosixPath(name)
  assert member.isfile() and not parts.is_absolute() and '..' not in parts.parts and name not in observed
  raw=archive.extractfile(member).read();digest=sha(raw);row=expected[name]
  assert len(raw)==row['bytes']==member.size and digest==row['sha256'],name
  dest=UNPACK/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw);observed[name]=digest
assert observed.keys()==expected.keys()
assert sha((UNPACK/'hot/receipt.json').read_bytes())==manifest['hotReceiptSha256']
assert sha((UNPACK/'cold/receipt.json').read_bytes())==manifest['coldReceiptSha256']
assert sha((UNPACK/'cold/report.json').read_bytes())==manifest['coldReportSha256']
source_cache={};audit=[];carried={}
for prefix in ['hot','cold']:
 receipt=read(prefix+'/receipt.json');assert receipt['gitHead']==head and receipt['status']=='passed'
 for name,digest in receipt['files'].items():assert observed[prefix+'/'+name]==digest,name
 for name,digest in receipt['generated'].items():assert observed[prefix+'-generated/'+name]==digest,name
 for name,digest in receipt['sources'].items():
  if name not in source_cache:source_cache[name]=subprocess.check_output(['git','show',head+':'+name],cwd=ROOT)
  assert sha(source_cache[name])==digest and sha((ROOT/name).read_bytes())==digest,name
 for name,digest in receipt['carriedVerifiedEvidence'].items():
  old=subprocess.check_output(['git','show',receipt['historicalEvidenceHead']+':'+name],cwd=ROOT)
  assert sha(old)==digest==sha(source_cache[name]);carried[name]=digest
 reports=[];blobs=0;cov=0;inventory_only=[]
 for name in receipt['files']:
  if not name.endswith('/report.json'):continue
  report=read(prefix+'/'+name)
  if 'sources' not in report:continue
  assert report['gitHead']==head and report['browserErrors']=={'console':[],'page':[],'requests':[]},name
  mutation=report.get('mutation');served={'/'+r['path'].lstrip('/'):r for r in report['servedFiles']}
  for row in report['sources']:
   path=row['path'];digest=receipt['generated'].get(path) or receipt['sources'].get(path)
   if digest is None and path.startswith('target/evidence/'):
    matches=[(n,d) for n,d in receipt['files'].items() if path.endswith('/'+n)]
    if matches:
     matches.sort(key=lambda row:len(row[0]),reverse=True)
     digest=matches[0][1]
   if digest is None:
    assert '/'+path not in served,path
    inventory_only.append({'report':name,'path':path,'reason':'broad ignored build inventory; never loaded/served in this recording'})
    continue
   assert row['sha256']==digest,path
   if '/'+path in served:
    expected_sha=mutation['servedSha256'] if mutation and path==mutation['path'] else digest
    assert served['/'+path]['sha256']==expected_sha,path
  if 'browserCoverage' not in report:reports.append({'path':name,'wire':True});continue
  browser=report['browser'];assert not browser.get('headless',browser.get('launch',{}).get('headless',True)) and browser['gpu']['featureStatus'].get('webgl2',browser['gpu']['featureStatus'].get('webgl'))=='enabled'
  assert not any(w in ' '.join(browser.get('commandLine',browser.get('actualCommandLine',[]))).lower() for w in ['swiftshader','llvmpipe','softpipe','lavapipe','--disable-gpu'])
  coverage=read(prefix+'/'+str(Path(name).parent/report['browserCoverage']['path']))
  for script in coverage['scripts']:
   assert script['sha256']==served['/'+script['source']]['sha256'],script['source'];cov+=1
  if mutation:
   path=mutation['path'];original=source_cache[path];raw=(UNPACK/prefix/Path(name).parent/'mutation-source.mjs').read_bytes()
   assert original.count(mutation['needle'].encode())==1
   assert raw==original.replace(mutation['needle'].encode(),mutation['replacement'].encode()) and sha(raw)==mutation['servedSha256']
  result=report.get('partial') or report.get('browserResult',{}).get('result') or report.get('acceptance')
  if result:
   for blob in result.get('blobs',[]):
    raw=gzip.decompress((UNPACK/prefix/Path(name).parent/blob['path']).read_bytes())
    assert len(raw)==blob['bytes'] and sha(raw)==blob['sha256'];blobs+=1
  reports.append({'path':name,'status':report['status'],'frames':len(result.get('frames',[])) if result else 0,'gpu':browser['gpu']['devices']})
 audit.append({'prefix':prefix,'receipt':observed[prefix+'/receipt.json'],'files':len(receipt['files']),'sources':len(receipt['sources']),'generated':len(receipt['generated']),'blobs':blobs,'authenticatedV8Scripts':cov,'reports':reports,'unservedIgnoredInventory':inventory_only})
cold=read('cold/report.json');assert cold['status']=='passed' and cold['cloneHead']==cold['gitHead']==head and cold['command']==['make','verify-E6-T11d14'] and cold['statusBefore']==cold['statusAfter']==''
assert sha((UNPACK/'cold/receipt.json').read_bytes())==cold['receiptSha256']
assert sha((UNPACK/'cold/cold.log').read_bytes())==cold['logSha256']
for prefix in ['hot','cold']:
 log=(UNPACK/prefix/'acceptance.log').read_text();assert '\nSTANDARD_INTEGER_RECORDING_COMPLETE\n' in log
 assert not any(marker in log for marker in ['ERROR: AddressSanitizer','runtime error:','panicked at'])
result={'schema':'standard-integer-verifier-authentication-v1','status':'HELD','predictions':['P1'],'sourceHead':head,'archiveSha256':manifest['archiveSha256'],'recordIndexSha256':manifest['recordIndexSha256'],'records':len(observed),'audit':audit,'cold':cold,'carriedVerifiedEvidence':carried}
(OUT/'authentication.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':result['status'],'records':len(observed),'sourceBlobs':len(source_cache),'carried':len(carried),'audit':[ {k:v for k,v in row.items() if k not in ['reports','unservedIgnoredInventory']} for row in audit]}))
