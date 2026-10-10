"""Fresh critic custody audit. Does not execute worker receipt code."""
from pathlib import Path, PurePosixPath
import hashlib, json, subprocess, tarfile, gzip

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
FROZEN = 'dff28ee8cb1c494a52a6fbb5af872ed377605f66'
PREDECESSOR = '64b246220bbf3ed5e1a6f1ed7371535ed5ec5c56'
def sha(b): return hashlib.sha256(b).hexdigest()
def gitbytes(head, name): return subprocess.check_output(['git', 'show', head + ':' + name], cwd=ROOT)
def need(x, reason):
    if not x: raise AssertionError(reason)
def seal(directory, destination=None):
    m=json.loads((directory/'manifest.json').read_bytes())
    index=(directory/'records.json').read_bytes()
    records=json.loads(index)
    packed=(directory/'recording.tar.gz').read_bytes()
    need(sha(index)==m.get('recordIndexSha256',m.get('recordIndexDigest')), 'index digest '+str(directory))
    need(sha(packed)==m.get('archiveSha256',m.get('archiveDigest')), 'archive digest '+str(directory))
    if 'archiveBytes' in m: need(len(packed)==m['archiveBytes'], 'archive size')
    rows={r['path']:r for r in records['records']}
    need(len(rows)==len(records['records'])==m['records'],'record uniqueness/count')
    data={}
    with tarfile.open(directory/'recording.tar.gz','r:gz') as archive:
        for member in archive:
            p=PurePosixPath(member.name)
            need(not p.is_absolute() and '..' not in p.parts and member.isfile(), 'unsafe member')
            need(member.name in rows and member.name not in data,'unexpected/repeated member')
            raw=archive.extractfile(member).read(); row=rows[member.name]
            need(len(raw)==row['bytes']==member.size and sha(raw)==row['sha256'],'record mismatch '+member.name)
            data[member.name]=raw
            if destination:
                target=destination/member.name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
    need(set(data)==set(rows),'missing records')
    return m,records,data

m,index,data=seal(ROOT/'evidence/virgl-standard-topology/worker',HERE/'unpacked')
need(m['archiveSha256']=='c192468202cec8d341e6074cc241d19d699cde78d58e7361b2e09d58da1ba8cf','claim archive')
need(m['recordIndexSha256']=='387bbf495d4e22e397636147874974a08c01f7ffe0dee6828be8ddd1e637c8af','claim index')
need(m['records']==2716 and m['archiveBytes']==7148693 and m['sourceHead']==index['sourceHead']==FROZEN,'claim count/head')
generated={}; source_bindings={}; reports=[]; checked_blobs=0; current_harness_extensions={}
for prefix,claimed in [('hot','be4ec4d73db916f827c3df748e2790f2efb6dd7742814b0ba7418f7c8e27fb32'),('cold','f7a52a5e7c72b9ae3653b5d7dd45d6344144269797da1ec83afca65d36a6e8f7')]:
    receipt=json.loads(data[prefix+'/receipt.json'])
    need(sha(data[prefix+'/receipt.json'])==claimed,'receipt claim '+prefix)
    need(receipt['gitHead']==FROZEN and receipt['status']=='passed','receipt head/status')
    for name,digest in receipt['files'].items():need(sha(data[prefix+'/'+name])==digest,'receipt file '+name)
    for name,digest in receipt['sources'].items():
        raw=gitbytes(FROZEN,name)
        need(sha(raw)==digest,'receipt frozen source '+name)
        current=(ROOT/name).read_bytes()
        if current!=raw:
            extension=b'\n.PHONY: verify-E6-T11d8-adversarial\nverify-E6-T11d8-adversarial:\n\tbash tools/verify-virgl-standard-topology-adversarial.sh\n'
            need(name=='Makefile' and current==raw+extension,'unauthorized current runtime/harness source drift '+name)
            current_harness_extensions[name]={'sha256':sha(current),'waiver':'Only a declarative recurring verifier target is appended; worker source custody stays pinned to frozen git blob.'}
        source_bindings[name]=digest
    for name,digest in receipt['generated'].items():
        need(sha(data[prefix+'-generated/'+name])==digest,'generated '+name)
        if prefix=='hot':need(sha((ROOT/name).read_bytes())==digest,'current generated artifact '+name)
        generated[prefix+'/'+name]=digest
    for name,raw in data.items():
        if not name.startswith(prefix+'/') or not name.endswith('/report.json'):continue
        report=json.loads(raw)
        if 'sources' not in report:continue
        need(report['gitHead']==FROZEN,'report head '+name)
        served={r['path']:r['sha256'] for r in report.get('servedFiles',[])}
        mutation=report.get('mutation')
        for row in report['sources']:
            file=row['path']; payload=data[prefix+'-generated/'+file] if '/build/' in file else gitbytes(FROZEN,file)
            need(len(payload)==row['bytes'] and sha(payload)==row['sha256'],'report source '+name+' '+file)
            if '/'+file in served:
                expected=mutation['servedSha256'] if mutation and file==mutation['path'] else row['sha256']
                need(served['/'+file]==expected,'served source '+name+' '+file)
        if 'browserCoverage' in report:
            c=report['browserCoverage']; coverage_raw=data[str(PurePosixPath(name).parent/c['path'])]
            need(sha(coverage_raw)==c['sha256'],'coverage report binding')
            for row in json.loads(coverage_raw)['scripts']:need(row['sha256']==served['/'+row['source']],'coverage source')
            need(report['browserErrors']=={'console':[],'page':[],'requests':[]},'browser errors '+name)
            need(report['browser']['headless'] is False,'headed '+name)
            need(report['browser']['gpu']['featureStatus'].get('webgl2',report['browser']['gpu']['featureStatus'].get('webgl'))=='enabled','native gpu '+name)
            need(not any(any(w in v.lower() for w in ['swiftshader','llvmpipe','softpipe','lavapipe','--disable-gpu']) for v in report['browser']['commandLine']),'software gpu '+name)
            screenshot=report['screenshot'];need(sha(data[str(PurePosixPath(name).parent/screenshot['path'])])==screenshot['sha256'],'screenshot')
            result=report.get('partial') or report['browserResult']['result']
            for b in result.get('blobs',[]):
                packed=data[str(PurePosixPath(name).parent/b['path'])];original=gzip.decompress(packed)
                need(sha(packed)==b['gzipSha256'] and sha(original)==b['sha256'] and len(original)==b['bytes'],'physical blob '+name+' '+b['key'])
                checked_blobs+=1
        reports.append({'path':name,'sha256':sha(raw),'status':report['status']})
cold=json.loads(data['cold/report.json'])
need(sha(data['cold/report.json'])=='688211b47d03b0d6e1076655fdeb2efd92455697de4942a4cc0d2749bf43abff','cold report claim')
need(cold['gitHead']==cold['cloneHead']==FROZEN and cold['status']=='passed' and not cold['statusBefore'] and not cold['statusAfter'] and cold['exitCode']==0,'cold pristine')
need(cold['command']==['make','verify-E6-T11d8'] and sha(data['cold/cold.log'])==cold['logSha256'],'cold log/command')
need(cold['receiptSha256']==sha(data['cold/receipt.json']),'cold receipt')
carried=[]
for sub in ['worker','verifier']:
    d=ROOT/'evidence/virgl-standard-constant'/sub
    cm,ci,cd=seal(d)
    for name in ['manifest.json','records.json','recording.tar.gz']:
        need((d/name).read_bytes()==gitbytes(PREDECESSOR,str((d/name).relative_to(ROOT))),'historical carry altered')
    carried.append({'role':sub,'manifest':cm,'records':len(cd)})
need((ROOT/'evidence/virgl-standard-constant/verifier/verdict.json').read_bytes()==gitbytes(PREDECESSOR,'evidence/virgl-standard-constant/verifier/verdict.json'),'historical verdict altered')
need(json.loads((ROOT/'evidence/virgl-standard-constant/verifier/verdict.json').read_text())['verdict']=='verified','historical verifier authority')
runtime_unchanged=[]
paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/resources.mjs','renderer/virgl-command/cache.mjs'],cwd=ROOT,text=True).splitlines()
for name in paths:
    need(gitbytes(FROZEN,name)==gitbytes(PREDECESSOR,name),'unchanged boundary drift '+name)
    runtime_unchanged.append(name)
out={'schema':'standard-topology-authentication-v1','status':'passed','archiveSha256':m['archiveSha256'],'indexSha256':m['recordIndexSha256'],'records':len(data),'runtimeHead':FROZEN,'checkedReports':reports,'checkedPhysicalBlobs':checked_blobs,'sourceBindings':source_bindings,'generatedBindings':generated,'cold':cold,'carriedD7':carried,'unchangedBoundarySources':runtime_unchanged,'currentHarnessExtensions':current_harness_extensions}
(HERE/'authentication.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'status':out['status'],'records':len(data),'reports':len(reports),'physicalBlobs':checked_blobs,'sourceBindings':len(source_bindings),'carriedD7':[r['records'] for r in carried]}))
