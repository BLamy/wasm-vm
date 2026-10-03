"""Independent exact-source/fixture/oracle/cold-clone and changed-range audit."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
ROOT=Path.cwd(); OUT=Path(__file__).resolve().parent; BASE=OUT.parent
FROZEN='5dc0c408b105b432b9558b8dbaa7928998378123'; PRIOR='5ec8846b'
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_text())
checks=[]
def require(v,label):
    if not v:raise AssertionError(label)
    checks.append(label)
def source(e,label,committed=True):
    b=(ROOT/e['path']).read_bytes();require(sha(b)==e['sha256'],label+' source '+e['path'])
    if committed and '/build/wasm/' not in e['path']:require(subprocess.check_output(['git','show',FROZEN+':'+e['path']],cwd=ROOT)==b,label+' committed '+e['path'])
    if 'decodedSha256' in e:
        raw=gzip.decompress(b) if e['path'].endswith('.gz') else b
        require(sha(raw)==e['decodedSha256'] and len(raw)==e['decodedBytes'],label+' original decoded '+e['path'])
def receipt(directory,label):
    r=load(directory/'receipt.json');require(r['status']=='passed' and r['gitHead']==FROZEN,label+' receipt exact frozen head')
    for e in r['sources']+r['inputs']:source(e,label)
    for e in r['records']:require(sha((directory/e['path']).read_bytes())==e['sha256'],label+' record '+e['path'])
    return r
expected_receipts=['a2da723555c9de7ad5efcf96721095d9a2c3159b3c5626c0ebd6c32c73e9f049','d45407818f2514ee7d8e5c3fc15202bef13377d8ad285ec182d0e67b6f4cffcb']
expected_hashes=['f244dc2a7a61960cbad1f603961e4f324ec4f444367ca589744b3e60531f22e9','1d754556e8e0abc93bf12d0c6a44ffdbb6fe925dc7c96dbb8c30474d372d16ae','62f04d5e21e789af6ef74af17498e36c8bbb45788f296124fd64c80832751061']
expected_colors=[[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]],[[255,0,0,255],[0,128,0,255],[0,0,0,255],[255,128,0,255]],[[64,0,191,255],[0,64,191,255],[0,0,255,255],[64,64,191,255]]]
events=[json.loads(s)for s in (ROOT/'evidence/virgl-corpus/captures/textured-scene/events.jsonl').read_text().splitlines()];by_seq={e['seq']:e for e in events}
receipts={}
for dirname,expected in zip(['worker','cold-clone/acceptance'],expected_receipts):
    directory=BASE/dirname;require(sha((directory/'receipt.json').read_bytes())==expected,dirname+' handed-off receipt');r=receipt(directory,dirname)
    g=load(directory/'hardware/report.json');require(g['status']=='passed' and g['gitHead']==FROZEN and g['trackedChanges']==[],dirname+' clean hardware sources')
    require(g['browserErrors']=={'console':[],'page':[],'requests':[]},dirname+' zero browser errors')
    require(g['browser']['gpu']['featureStatus'][g['browser']['webglFeature']]=='enabled',dirname+' hardware GPU')
    v=g['browserResult']['result'];p=v['original'];require(v['assertions']>=470000 and len(v['attacks'])==93 and v['primaryAsyncReplay'] and not v['guestExecution'],dirname+' scoped outcome')
    require([p['packetCount'],p['gpuDraws'],p['checkedPixels']]==[210,3,768],dirname+' original counts')
    require([s['event']for s in p['submissions']]==[161,173,185,197,209,221,233,249],dirname+' original chronological submissions')
    for s in p['submissions']:
        blob=by_seq[s['event']]['blobs'][0];require(s['sourceSha256']==blob['sha256'] and s['byteLength']==blob['bytes'],dirname+' raw capture '+str(s['event']))
        file=ROOT/'evidence/virgl-corpus/captures/textured-scene/blobs'/(blob['sha256']+'.bin.gz');data=gzip.decompress(file.read_bytes());headers=[];offset=0
        while offset<len(data):
            word=int.from_bytes(data[offset:offset+4],'little');size=4+4*(word>>16);headers.append({'byteOffset':offset,'opcode':word&255,'objectType':(word>>8)&255,'payloadDwords':word>>16,'byteLength':size});offset+=size
        require(s['commands']==headers,dirname+' independently parsed headers '+str(s['event']));require(s['result']['gpuComplete'] is True and s['result']['appliedCommands']==len(headers),dirname+' final GPU completion '+str(s['event']))
    for phase,f in enumerate(p['frames']):
        require(f['readback']['rgbaSha256']==expected_hashes[phase] and f['readback']['offset']==[64,4160,8256][phase],dirname+' original result bytes '+str(phase))
        require([c['expected']for c in f['pixels']['checks']]==expected_colors[phase],dirname+' literal texels '+str(phase))
    require(p['initialization']['written']==92 and p['initialization']['privateBackingCopiesRemainZero'],dirname+' fresh inputs differ from private backing')
    require(v['outputReferencePoison']['bytes']==12288 and v['outputReferencePoison']['hashes']==expected_hashes,dirname+' poisoned outputs irrelevant')
    require(all(x==0 for owner in ['state','resources']for x in p['cleanup'][owner].values()),dirname+' allocation accounting zero')
    require(all(p['cleanup']['async'][k]==0 for k in ['reads','transfers','stagingBytes']),dirname+' async ownership zero')
    require(p['heartbeatTicks']>0,dirname+' host heartbeat progressed')
    trace=p['glTrace']; require(len(trace)>0,dirname+' concrete GL event trace')
    for name in ['hardware','sabotage-early-collect','sabotage-index-class','regression/decoder','regression/resources','regression/state','regression/draw']:
        report=load(directory/name/'report.json');require(report['gitHead']==FROZEN,dirname+' report exact head '+name)
        if name.startswith('regression/'):require(report['status']=='passed',dirname+' synchronous regression '+name)
        if name=='regression/decoder':continue
        served={item['path']:item for item in report['servedFiles']};mutation=report.get('sabotage',{})
        for item in report['sources']:
            observed=served.get('/'+item['path'])
            if observed:require(observed['sha256']==(mutation['servedSha256']if mutation.get('path')==item['path'] else item['sha256']),dirname+' served '+name+' '+item['path'])
        require(served['/fixtures.json']['sha256']==report['fixtureTransport']['sha256'],dirname+' fixture transport '+name)
        if name.startswith('sabotage-'):
            expected_label='async CPU collection requires a signaled fence' if name.endswith('early-collect')else 'async index staging uses element-array class'
            require(report['status']=='failed' and expected_label in report['browserResult']['error']['message'],dirname+' intended sequencing control '+name)
    receipts[dirname]={'sha256':expected,'assertions':v['assertions'],'attacks':len(v['attacks']),'frames':expected_hashes}
cold=load(BASE/'cold-clone/report.json');require(cold['gitHead']==cold['cloneHead']==FROZEN and cold['status']=='passed' and cold['exitCode']==0 and cold['statusBefore']==cold['statusAfter']=='','cold exact clean acceptance')
for path,key in [('acceptance/receipt.json','receiptSha256'),('cold.log','logSha256')]:require(sha((BASE/'cold-clone'/path).read_bytes())==cold[key],'cold bound '+path)
require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=cold['clone'],text=True).strip()==FROZEN,'retained clone exact head')
require(subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=cold['clone'],text=True).strip()=='','retained clone remains clean')
require(sha((OUT/'predictions.md').read_bytes())=='677ada291f5788b987dfe01f2d2b34fa14c16fc50fe123ddc062158b8d72b111','immutable original predictions')
attacks=load(OUT/'attacks.json');require(attacks['status']=='passed','independent hardware attacks pass')
for item in attacks['sources']+attacks['inputs']:source(item,'independent',not item['path'].startswith('evidence/virgl-async/verifier/'))
require(subprocess.run(['git','diff','--quiet',FROZEN,attacks['gitHead'],'--',*[e['path']for e in r['sources']]],cwd=ROOT).returncode==0,'independent report head preserves frozen sources')
b=attacks['variants'][0];require(b['errors']=={'console':[],'page':[],'request':[]},'independent browser zero errors')
for path,key in [('attack-coverage.json','coverageSha256'),('attack.png','screenshotSha256')]:require(sha((OUT/path).read_bytes())==b[key],'independent bound '+path)
require(b['servedRuntimeSha256']==sha((ROOT/'renderer/virgl-command/resources.mjs').read_bytes()),'independent original resources served')
for variant in attacks['variants'][1:]:
    require(variant['result']['status']=='failed' and 'CPU collection preceded matching staging fence signal' in variant['result']['error']['message'],'independent fence omission detected')
    m=next(x for x in attacks['sabotages']if x['name']==variant['variant']);modified=(ROOT/'renderer/virgl-command/resources.mjs').read_text().replace(m['before'],m['after']);require(sha(modified.encode())==variant['servedRuntimeSha256']==m['sourceSha256'],'independent exact served sabotage')
require(b['result']['pixels']==2304 and b['result']['heartbeats']>0,'independent three schedules and literal pixels')
coverage=[]
coverage_paths=[BASE/'worker/hardware/browser-coverage.json',OUT/'attack-coverage.json']
for sub in ['resources','state','draw']:
    d=BASE/'worker/regression'/sub;rep=load(d/'report.json');coverage_paths.append(d/rep['browserCoverage']['path'])
for filename in ['renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs']:
    text=(ROOT/filename).read_text();require(text.isascii(),'V8 offsets are source offsets '+filename);runs=[];bound=[]
    for path in coverage_paths:
        parsed=load(path);scripts=parsed.get('scripts',[parsed]);found=[s for s in scripts if s.get('source','').endswith(filename) or s.get('url','').endswith('/'+filename)]
        for entry in found:
            if 'sha256'in entry:require(entry['sha256']==sha(text.encode()),'coverage source binding '+str(path.relative_to(BASE))+' '+filename)
            script=entry.get('coverage',entry);counts=[0]*len(text)
            for span in sorted([span for f in script['functions']for span in f['ranges']],key=lambda x:x['endOffset']-x['startOffset'],reverse=True):counts[span['startOffset']:span['endOffset']]=[span['count']]*(span['endOffset']-span['startOffset'])
            runs.append(counts);bound.append({'path':str(path.relative_to(BASE)),'sha256':sha(path.read_bytes())})
    require(bool(runs),'runtime has exact-source coverage '+filename)
    diff=subprocess.check_output(['git','diff','--unified=0',PRIOR,FROZEN,'--',filename],text=True);changed=set();hunks=[]
    for start,length in re.findall(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@',diff):
        start=int(start);length=int(length or '1');changed.update(range(start,start+length));hunks.append({'startLine':start,'lineCount':length})
    missing=[];offset=0
    for number,line in enumerate(text.splitlines(keepends=True),1):
        if number in changed:
            uncovered=''.join(c for i,c in enumerate(line)if not any(run[offset+i]for run in runs))
            if uncovered.strip():missing.append({'line':number,'text':uncovered.strip()})
        offset+=len(line)
    require(not missing,'all changed executable ranges exercised '+filename)
    coverage.append({'path':filename,'sha256':sha(text.encode()),'changedLines':len(changed),'hunks':hunks,'evidence':bound,'uncoveredChangedRanges':missing})
require(subprocess.run(['git','diff','--quiet',PRIOR,FROZEN,'--','crates','web'],cwd=ROOT).returncode==0,'production core/Wasm/demo sources unchanged; prior no-VIRGL proof carried')
report={'status':'passed','frozenHead':FROZEN,'base':PRIOR,'checks':checks,'receipts':receipts,'cold':cold,'attacksSha256':sha((OUT/'attacks.json').read_bytes()),'coverage':coverage}
(OUT/'audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','checks':len(checks),'coverage':coverage},indent=2))
