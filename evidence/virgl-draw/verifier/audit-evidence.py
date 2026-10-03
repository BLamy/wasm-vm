"""Independent exact-source/fixture/oracle/cold-clone and changed-range audit."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
ROOT=Path.cwd(); OUT=Path(__file__).resolve().parent; BASE=OUT.parent
FROZEN='ab60a54e6b3c8bd1020065b7e78b847e3d91c65f'; PRIOR='a768b341'
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
expected_receipts=['09bd16273acbb6cb1efa8ab27c271b2b069f297afa3b00cc48eb60bd7771318e','f0a1e3ce227a4cb1702fa1e58c1d6123240f27104db31df7824e88f92128b5e1']
expected_hashes=['f244dc2a7a61960cbad1f603961e4f324ec4f444367ca589744b3e60531f22e9','1d754556e8e0abc93bf12d0c6a44ffdbb6fe925dc7c96dbb8c30474d372d16ae','62f04d5e21e789af6ef74af17498e36c8bbb45788f296124fd64c80832751061']
expected_colors=[[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,0,255]],[[255,0,0,255],[0,128,0,255],[0,0,0,255],[255,128,0,255]],[[64,0,191,255],[0,64,191,255],[0,0,255,255],[64,64,191,255]]]
events=[json.loads(s)for s in (ROOT/'evidence/virgl-corpus/captures/textured-scene/events.jsonl').read_text().splitlines()]
by_seq={e['seq']:e for e in events}; receipts={}
for dirname,expected_digest in zip(['worker','cold-clone/acceptance'],expected_receipts):
    directory=BASE/dirname;require(sha((directory/'receipt.json').read_bytes())==expected_digest,dirname+' handed-off receipt')
    r=receipt(directory,dirname);state=receipt(directory/'state',dirname+' state regression')
    g=load(directory/'hardware/report.json');require(g['status']=='passed' and g['gitHead']==FROZEN and g['trackedChanges']==[],dirname+' clean hardware source')
    require(g['browserErrors']=={'console':[],'page':[],'requests':[]},dirname+' zero browser errors')
    require(g['browser']['gpu']['featureStatus'][g['browser']['webglFeature']]=='enabled',dirname+' actual hardware GPU')
    v=g['browserResult']['result'];p=v['original']
    require(v['assertions']==11982 and len(v['attacks'])==37 and v['primaryDrawReplay'] and not v['guestExecution'],dirname+' exact scoped outcome')
    require([p['packetCount'],p['gpuDraws'],p['checkedPixels']]==[210,3,768],dirname+' full primary replay counts')
    require([s['event']for s in p['submissions']]==[161,173,185,197,209,221,233,249],dirname+' original chronological submissions')
    require([s['appliedCommands']for s in p['submissions']]==[39,3,6,3,8,3,6,142],dirname+' exact full packet counts')
    for s in p['submissions']:
        blob=by_seq[s['event']]['blobs'][0];require(s['sourceSha256']==blob['sha256'] and s['byteLength']==blob['bytes'],dirname+' original packet provenance '+str(s['event']))
        data=gzip.decompress((ROOT/'evidence/virgl-corpus/captures/textured-scene/blobs'/(blob['sha256']+'.bin.gz')).read_bytes());headers=[];offset=0
        while offset<len(data):
            word=int.from_bytes(data[offset:offset+4],'little');size=4+4*(word>>16);headers.append({'byteOffset':offset,'opcode':word&255,'objectType':(word>>8)&255,'payloadDwords':word>>16,'byteLength':size});offset+=size
        require(s['commands']==headers,dirname+' independently parsed every original header '+str(s['event']))
    for a in p['initialization']['actions']:
        e=by_seq[a['event']];require(e['phase']=='enter' and e['parentCallSeq']==0 and e['type']==a['type'],dirname+' top-level initialization '+str(a['event']))
        if 'metadata' in a:require(all(e[k]==val for k,val in a['metadata'].items() if k!='id'),dirname+' exact resource metadata '+str(a['event']))
    require(p['initialization']['written']==92 and [a['event']for a in p['initialization']['actions']]==[96,100,104,107,111,115,118,122,126,129,133,137,140,144,148,151],dirname+' exact initialization once')
    for phase,f in enumerate(p['frames']):
        d=f['draw'];require([d['actualMinIndex'],d['actualMaxIndex'],d['indexByteLength']]==[0,3,12],dirname+' actual index scan '+str(phase))
        require([a['requiredEnd']for a in d['vertexFetches']]==[56,64],dirname+' per-attribute complete fetch bounds '+str(phase))
        call=f['actualGlCall'];require([call['mode'],call['count'],call['indexType'],call['indexOffset']]==[4,6,5123,0],dirname+' actual GPU command '+str(phase))
        require(f['readback']['offset']==[64,4160,8256][phase] and f['readback']['rgbaSha256']==expected_hashes[phase],dirname+' actual staging output '+str(phase))
        require([c['expected']for c in f['pixels']['checks']]==expected_colors[phase],dirname+' literal workload oracle '+str(phase))
        require([c['rectangle']for c in f['pixels']['checks']]==[[4,4,8,8],[20,4,8,8],[4,20,8,8],[20,20,8,8]],dirname+' lower-left oriented interior ranges '+str(phase))
    require([sha(t['text'].encode())for t in p['translations']]==['e96102a3202dde8b0b05ffa142eb6064c5fe916b673bbf1d31464bcbac56fb33','80d6db6a6f10b93770698cfdd47232fed0fca94f4cb07ba7381bb38563de9808'],dirname+' exact original shader texts')
    require(all(t['glsl'].startswith('#version 300 es')for t in p['translations']),dirname+' actual emitted GLSL')
    require(v['outputReferencePoison']['bytes']==12288 and v['outputReferencePoison']['hashes']==expected_hashes,dirname+' output snapshots irrelevant')
    require([a['event']for a in p['lifecycle']]==[238,240,242,251,253,255,257,259,261,263,265,267,269,271,273,275],dirname+' chronological public teardown')
    require(all(x==0 for owner in ['state','resources']for x in p['cleanup'][owner].values()) and p['cleanup']['liveGpuAllocations']==0,dirname+' final allocations zero')
    require(state['gitHead']==FROZEN and next(s['sha256']for s in state['sources']if s['path'].endswith('/state.mjs'))==next(s['sha256']for s in r['sources']if s['path'].endswith('/state.mjs')),dirname+' old C regression uses changed shared source')
    for name in ['hardware','sabotage-vertex','sabotage-index','sabotage-texel','sabotage-constant','sabotage-blend','sabotage-readback-offset']:
        report=load(directory/name/'report.json');served={s['path']:s for s in report['servedFiles']}
        for e in report['sources']:
            if e['path'].startswith('renderer/')and e['path'].endswith(('.mjs','.wasm')):require(served['/'+e['path']]['sha256']==e['sha256'],dirname+' served '+name+' '+e['path'])
        if name!='hardware':
            require(report['status']=='failed' and report['browserResult']['status']=='failed',dirname+' sabotage fails '+name)
            message=report['browserResult']['error']['message'];require(('out-of-bounds' in message)if name=='sabotage-index'else('interior pixel' in message),dirname+' intended sabotage oracle '+name)
            require(served['/fixtures.json']['sha256']==report['sabotage']['servedSha256']!=report['sabotage']['originalSha256'],dirname+' exact mutated input served '+name)
        else:require(served['/fixtures.json']['sha256']==report['fixtureTransport']['sha256'],dirname+' original fixtures served')
    receipts[dirname]={'sha256':expected_digest,'assertions':v['assertions'],'attacks':len(v['attacks']),'imageHashes':expected_hashes}

cold=load(BASE/'cold-clone/report.json');require(cold['gitHead']==cold['cloneHead']==FROZEN and cold['status']=='passed' and cold['exitCode']==0 and cold['statusBefore']==cold['statusAfter']=='','cold exact clean accepted')
for path,key in [('acceptance/receipt.json','receiptSha256'),('cold.log','logSha256')]:require(sha((BASE/'cold-clone'/path).read_bytes())==cold[key],'cold bound '+path)
require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=cold['clone'],text=True).strip()==FROZEN,'independent retained clone exact HEAD')
require(subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=cold['clone'],text=True).strip()=='','independent retained clone remains clean')

attacks=load(OUT/'attacks.json');require(attacks['status']=='passed','independent attacks pass')
require(attacks['fixtureSha256']==g['fixtureTransport']['sha256'],'independent exact original fixture transport matches worker and cold')
for e in attacks['sources']+attacks['inputs']:source(e,'independent',not e['path'].startswith('evidence/virgl-draw/verifier/'))
require(subprocess.run(['git','diff','--quiet',FROZEN,attacks['gitHead'],'--',*[e['path']for e in r['sources']]],cwd=ROOT).returncode==0,'independent evidence-only head preserves all frozen sources')
b=attacks['variants'][0];v=b['result'];require(b['errors']=={'console':[],'page':[],'request':[]} and b['servedRuntimeSha256']==sha((ROOT/'renderer/virgl-command/state.mjs').read_bytes()),'independent original source hardware errors empty')
require(v['assertions']==28760 and v['inputMutations']==18 and v['novelRounds']==36 and v['pixels']==26432,'independent attack counts')
require(v['primary']['frames']==expected_hashes and v['primary']['packets']==210 and v['primary']['draws']==3,'independent complete original actual outputs')
require(v['primary']['finalEvents']==[251,253,255,257,259,261,263,265,267,269,271,273,275],'independent chronological final teardown')
for p,k in [('attack-coverage.json','coverageSha256'),('attack.png','screenshotSha256')]:require(sha((OUT/p).read_bytes())==b[k],'independent bound '+p)
for variant,oracle in zip(attacks['variants'][1:],['literal pixel','index fails appropriate bounds/pixel oracle']):
    require(variant['result']['status']=='failed'and oracle in variant['result']['error']['message'],'independent source sabotage '+variant['variant'])
    m=next(m for m in attacks['sabotages']if m['name']==variant['variant']);changed=(ROOT/'renderer/virgl-command/state.mjs').read_text().replace(m['before'],m['after']);require(sha(changed.encode())==variant['servedRuntimeSha256']==m['sourceSha256'],'exact independent mutated runtime '+variant['variant'])

runtime=(ROOT/'renderer/virgl-command/state.mjs').read_text();require(runtime.isascii(),'V8 UTF16 offsets equal source character offsets')
covered_runs=[]
for path in [BASE/'worker/hardware/browser-coverage.json',BASE/'worker/state/hardware/browser-coverage.json',OUT/'attack-coverage.json']:
    scripts=load(path)['scripts'];entry=next(s for s in scripts if s.get('source','').endswith('/state.mjs') or s.get('url','').endswith('/state.mjs'))
    if 'sha256'in entry:require(entry['sha256']==sha(runtime.encode()),'precise coverage frozen source '+str(path.relative_to(BASE)))
    script=entry.get('coverage',entry);counts=[0]*len(runtime)
    for span in sorted([r for f in script['functions']for r in f['ranges']],key=lambda x:x['endOffset']-x['startOffset'],reverse=True):counts[span['startOffset']:span['endOffset']]=[span['count']]*(span['endOffset']-span['startOffset'])
    covered_runs.append(counts)
diff=subprocess.check_output(['git','diff','--unified=0',PRIOR,FROZEN,'--','renderer/virgl-command/state.mjs'],text=True);changed=set();hunks=[]
for start,length in re.findall(r'@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@',diff):
    start=int(start);length=int(length or '1');changed.update(range(start,start+length));hunks.append({'startLine':start,'lineCount':length})
missing=[];offset=0
for number,line in enumerate(runtime.splitlines(keepends=True),1):
    if number in changed:
        text=''.join(c for i,c in enumerate(line)if not any(run[offset+i]for run in covered_runs))
        if text.strip():missing.append({'line':number,'text':text.strip()})
    offset+=len(line)
require(missing==[],'every added runtime range executes; no D runtime waivers')
report={'status':'passed','frozenHead':FROZEN,'priorVerifiedHead':PRIOR,'checks':checks,'receipts':receipts,'cold':cold,'attacksSha256':sha((OUT/'attacks.json').read_bytes()),'coverage':{'runtimeSha256':sha(runtime.encode()),'changedLines':len(changed),'hunks':hunks,'uncoveredChangedRanges':missing,'classification':'All changed executable ranges hit in worker D, same-source C regression, or independent hardware run; unchanged C proofs carry forward.'}}
(OUT/'audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','checks':len(checks),'coverage':report['coverage']},indent=2))
