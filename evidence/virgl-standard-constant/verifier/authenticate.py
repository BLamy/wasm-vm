"""Recheck worker seals, original/final source equivalence and immutable cold custody."""
import gzip,hashlib,json,subprocess,tarfile
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[2];WORKER=BASE.parent/'worker'
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((WORKER/'manifest.json').read_text());index=(WORKER/'records.json').read_bytes();records=json.loads(index)
assert sha((WORKER/'recording.tar.gz').read_bytes())==manifest['archiveSha256']=='598acb64caacea419f099a5fc1bb25fe763c4ce8dfb3eb8c0a76126acea28aca'
assert sha(index)==manifest['recordIndexSha256']=='36217166ebf678e6dd701ec7ec66f042891963be7638dc2c77a920903694d65a'
rows={r['path']:r for r in records['records']};assert len(rows)==1123
contents={}
with tarfile.open(WORKER/'recording.tar.gz') as archive:
    assert len(archive.getmembers())==1123
    for member in archive.getmembers():
        assert member.isfile() and member.name in rows and '..' not in Path(member.name).parts
        raw=archive.extractfile(member).read();assert len(raw)==rows[member.name]['bytes'] and sha(raw)==rows[member.name]['sha256'];contents[member.name]=raw
final='39a9d14b7052c60ca11416bdba4e6eb78a38b1dd';assert manifest['sourceHead']==records['sourceHead']==final
assert sha(contents['hot/receipt.json'])==manifest['hotReceiptSha256']
assert sha(contents['cold/receipt.json'])==manifest['coldReceiptSha256']
assert sha(contents['cold/report.json'])==manifest['coldReportSha256']
sourceCache={}
def source(head,path):
    key=head+':'+path
    if key not in sourceCache:sourceCache[key]=subprocess.check_output(['git','show',key],cwd=ROOT)
    return sourceCache[key]
for side in ['hot','cold']:
    receipt=json.loads(contents[side+'/receipt.json']);assert receipt['status']=='passed' and receipt['gitHead']==final
    for p,d in receipt['files'].items():assert sha(contents[side+'/'+p])==d
    for p,d in receipt['sources'].items():assert sha(source(final,p))==d
    for p,d in receipt['generated'].items():assert sha(contents[side+'-generated/'+p])==d
    for name in ['hardware','fault-generic']:
        report=json.loads(contents[side+'/'+name+'/report.json']);served={r['path']:r['sha256'] for r in report['servedFiles']}
        for r in report['sources']:
            p=r['path'];raw=contents[side+'-generated/'+p] if '/build/' in p else source(report['gitHead'],p)
            assert sha(raw)==r['sha256']
            if '/build/' not in p:assert source(report['gitHead'],p)==source(final,p)
            if '/'+p in served:assert served['/'+p]==(report['mutation']['servedSha256'] if report.get('mutation') and report['mutation']['path']==p else r['sha256'])
        result=report.get('partial') or report['browserResult']['result']
        for b in result['blobs']:
            zipped=contents[side+'/'+name+'/'+b['path']];raw=gzip.decompress(zipped);assert sha(zipped)==b['gzipSha256'] and len(raw)==b['bytes'] and sha(raw)==b['sha256']
    retained=json.loads(contents[side+'/retained-standard-draw/receipt.json']);assert retained['status']=='passed'
    for p,d in retained['files'].items():assert sha(contents[side+'/retained-standard-draw/'+p])==d
cold=json.loads(contents['cold/report.json']);assert cold['status']=='passed' and cold['gitHead']==cold['cloneHead']==final and not cold['statusBefore'] and not cold['statusAfter'] and cold['exitCode']==0
assert sha(contents['cold/cold.log'])==cold['logSha256']
repair=json.loads(contents['hot/harness-only-repair.json']);assert repair['changedFiles']==['tools/virgl-command/standard-constant-receipt.py']
assert b'\nSTANDARD_CONSTANT_RECORDING_COMPLETE\nTraceback' in contents['hot/acceptance.log']
assert b'ValueError: all sixteen generic attributes/native disabled arrays' in contents['hot/acceptance.log']
assert (ROOT/'renderer/virgl-command/state.mjs').read_bytes()==source(final,'renderer/virgl-command/state.mjs')
auth=json.loads((BASE/'authentication.json').read_text())
for r in auth['heldUnchangedCarry']:
    p=r['path']
    if '#link' in p:
        p=p.split('#')[0];a=source('67220bb5ed0dfab2e06563b6353fd6975f9696b9',p);b=source(final,p);start=b'    function link(';end=b'    const selectedProgram =';a=a[a.index(start):a.index(end)];b=b[b.index(start):b.index(end)]
    else:a=source('67220bb5ed0dfab2e06563b6353fd6975f9696b9',p);b=source(final,p)
    assert a==b and sha(b)==r['sha256']
print('HELD:1123 worker records, both immutable physical closures, repaired custody, final pristine cold source and268 carried boundaries')
