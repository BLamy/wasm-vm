from pathlib import Path
import hashlib, json, subprocess, tarfile
ROOT=Path(__file__).resolve().parents[3]
V=Path(__file__).resolve().parent
W=V.parent/'worker'
HEAD='365b3cf3d076637c347c7e9802420f847d09fbed'
sha=lambda b:hashlib.sha256(b).hexdigest()
git=lambda *a:subprocess.check_output(['git',*a],cwd=ROOT)
def need(v,msg):
    if not v: raise AssertionError(msg)
manifest=json.loads((W/'manifest.json').read_bytes())
indexraw=(W/'records.json').read_bytes(); index=json.loads(indexraw)
archive=(W/'recording.tar.gz').read_bytes()
need(manifest['sourceHead']==HEAD==index['sourceHead'],'head')
need(sha(archive)==manifest['archiveSha256'],'archive sha')
need(len(archive)==manifest['archiveBytes'],'archive extent')
need(sha(indexraw)==manifest['recordIndexSha256'],'index sha')
records={r['path']:r for r in index['records']}
need(len(records)==len(index['records'])==manifest['records'],'duplicate indexed names')
U=V/'unpacked'; U.mkdir(exist_ok=True)
with tarfile.open(W/'recording.tar.gz') as t:
    members=t.getmembers(); need(len(members)==len(records),'tar count')
    seen=set()
    for m in members:
        need(m.isfile() and m.name in records and m.name not in seen,'member type/name/duplicate')
        need(not Path(m.name).is_absolute() and '..' not in Path(m.name).parts,'tar traversal')
        seen.add(m.name); r=records[m.name]; data=t.extractfile(m).read()
        need(m.size==len(data)==r['bytes'] and sha(data)==r['sha256'],'member digest '+m.name)
        target=U/m.name; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(data)
need(seen==set(records),'indexed coverage')
for name,key in [('hot/receipt.json','hotReceiptSha256'),('cold/report.json','coldReportSha256'),('cold/receipt.json','coldReceiptSha256')]:
    need(records[name]['sha256']==manifest[key],'receipt manifest '+name)
sourcecount=0; filecount=0; generatedcount=0
for prefix in ['hot','cold']:
    receipt=json.loads((U/prefix/'receipt.json').read_bytes())
    need(receipt['gitHead']==HEAD and receipt['status']=='passed','receipt status/head')
    for name,digest in receipt['sources'].items():
        data=git('show',HEAD+':'+name); need(sha(data)==digest,'git source '+prefix+'/'+name); sourcecount+=1
    for name,digest in receipt['files'].items():
        need(sha((U/prefix/name).read_bytes())==digest,'receipt file '+prefix+'/'+name); filecount+=1
    for name,digest in receipt['generated'].items():
        need(sha((U/(prefix+'-generated')/name).read_bytes())==digest,'generated '+prefix+'/'+name); generatedcount+=1
    for sub in ['wire','hardware','fault-suffix']:
        report=json.loads((U/prefix/sub/'report.json').read_bytes())
        need(report['gitHead']==HEAD,'report head')
        need(report['status']==('failed' if sub=='fault-suffix' else 'passed'),'report status')
        need(report['browserErrors']=={'console':[],'page':[],'requests':[]},'browser errors')
        for s in report['sources']:
            digests=receipt['generated'] if '/build/' in s['path'] else receipt['sources']
            need(digests[s['path']]==s['sha256'],'report source sha '+s['path'])
        if sub=='wire': continue
        served={s['path']:s['sha256'] for s in report['servedFiles']}
        for s in report['sources']:
            if '/'+s['path'] not in served: continue
            wanted=report['mutation']['servedSha256'] if sub=='fault-suffix' and s['path']==report['mutation']['path'] else s['sha256']
            need(served['/'+s['path']]==wanted,'served '+s['path'])
        coverage=json.loads((U/prefix/sub/'browser-coverage.json').read_bytes())
        for s in coverage['scripts']:
            need(s['sha256']==served['/'+s['source']],'coverage custody')
        if sub=='hardware':
            for s in report['inputs']:
                b=(U/prefix/s['path']).read_bytes() if s['path'] in ['geometry.bin','c580.bin'] else git('show',HEAD+':'+s['path'])
                need(len(b)==s['bytes'] and sha(b)==s['sha256'],'input custody')
        else:
            m=report['mutation']; original=git('show',HEAD+':'+m['path']); changed=(U/prefix/sub/'mutation-source.mjs').read_bytes()
            need(original.count(m['needle'].encode())==1,'single mutation')
            need(original.replace(m['needle'].encode(),m['replacement'].encode())==changed,'mutation is only designated upload corruption')
            need(sha(changed)==m['servedSha256'],'mutation sha')
            need(report['partial']['frames'][-1]['label']=='short-bank-0' and 'short-bank-0 independent physical pixel oracle' in report['browserResult']['error']['message'],'sabotage named oracle')
cold=json.loads((U/'cold/report.json').read_bytes())
need(cold['gitHead']==cold['cloneHead']==HEAD and cold['status']=='passed' and cold['exitCode']==0,'cold exact head')
need(cold['statusBefore']==cold['statusAfter']=='','cold pristine')
need(cold['receiptSha256']==records['cold/receipt.json']['sha256'],'cold receipt')
pre='9323b44519710dfb2c8a324fe115872b79d274f0'
need(not git('diff','--name-only',pre,HEAD,'--','renderer/virgl-shader','crates').strip(),'carried compiler/device source delta')
old=git('show',pre+':renderer/virgl-command/constant-domain.mjs')
current=git('show',HEAD+':renderer/virgl-command/constant-domain.mjs')
need(current.startswith(old),'legacy metadata prefix')
report={'schema':1,'status':'passed','head':HEAD,'archiveSha256':sha(archive),'indexSha256':sha(indexraw),'records':len(records),'sourceChecks':sourcecount,'fileChecks':filecount,'generatedChecks':generatedcount,'coldPristine':True,'legacyPrefixSha256':sha(old),'compilerDeviceCarryHead':pre,'manifest':manifest}
(V/'authentication.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
