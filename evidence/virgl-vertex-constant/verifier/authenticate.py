from pathlib import Path
import hashlib,json,subprocess,tarfile
ROOT=Path.cwd(); D=ROOT/'evidence/virgl-vertex-constant'; V=D/'verifier'; W=D/'worker'
sha=lambda b:hashlib.sha256(b).hexdigest()
source='92c98c7361cad2518200bfa99765ed5895ef4f95'
manifest=json.loads((W/'manifest.json').read_bytes()); index_bytes=(W/'records.json').read_bytes(); index=json.loads(index_bytes)
assert manifest['archiveSha256']==sha((W/'recording.tar.gz').read_bytes())=='0438914308a3ccd17516af6a696ad65cfe9afbb5af589afd882ee7cc919c2d3c'
assert manifest['recordIndexSha256']==sha(index_bytes)=='90489cd5702fa32ccc6bfc5ac97cd1d67febb731a6be8b410f5ffa82b5da6f34'
assert manifest['sourceHead']==index['sourceHead']==source
rows={r['path']:r for r in index['records']};assert len(rows)==len(index['records'])==254
with tarfile.open(W/'recording.tar.gz') as tar:
    assert len(tar.getmembers())==len(rows)
    content={}
    for m in tar.getmembers():
        assert m.isfile() and m.name in rows and not Path(m.name).is_absolute() and '..' not in Path(m.name).parts
        b=tar.extractfile(m).read();r=rows[m.name];assert len(b)==r['bytes'] and sha(b)==r['sha256'];content[m.name]=b
    tar.extractall(V/'unpacked')
receipts=[]
for prefix in ['hot','cold']:
    receipt=json.loads(content[prefix+'/receipt.json']);assert receipt['gitHead']==source and receipt['status']=='passed'
    assert len(receipt['sources'])==393
    for name,digest in receipt['sources'].items():
        b=subprocess.check_output(['git','show',source+':'+name]);assert sha(b)==digest
        assert (ROOT/name).read_bytes()==b, 'current source drift '+name
    for name,digest in receipt['generated'].items():
        assert sha(content[prefix+'-generated/'+name])==digest
    for name,digest in receipt['files'].items():assert sha(content[prefix+'/'+name])==digest
    assert receipt['guestExecution'] is False and receipt['productionNegotiation'] is False
    receipts.append({'prefix':prefix,'receiptSha256':sha(content[prefix+'/receipt.json']),'sources':len(receipt['sources']),'records':len(receipt['files']),'binaries':len(receipt['generated'])})
cold=json.loads(content['cold/report.json']);assert cold['cloneHead']==cold['gitHead']==source and cold['status']=='passed'
assert cold['statusBefore']==cold['statusAfter']=='' and cold['exitCode']==0
assert sha(content['cold/cold.log'])==cold['logSha256'] and sha(content['cold/receipt.json'])==cold['receiptSha256']
report={'task':'E6-T11d1','status':'passed','sourceHead':source,'archiveSha256':manifest['archiveSha256'],'indexSha256':sha(index_bytes),'records':len(rows),'receipts':receipts,'cold':cold,'trackedClean':not subprocess.check_output(['git','diff','--name-only']).strip()}
(V/'authentication.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='cold'}))
