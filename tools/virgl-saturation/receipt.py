#!/usr/bin/env python3
"""Authenticate recordings; independent Fraction clamp/division equations."""
import hashlib,json,struct,subprocess,sys
from fractions import Fraction
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
TASK='E6-T12g6h'
SEEDS=[0x61c92ad7,0xb734e129,0xe2689f03]
def sha(raw):return hashlib.sha256(raw).hexdigest()
def require(v,label):
 if not v:raise ValueError(label)
def number(w):
 e=(w>>23)&255;m=w&0x7fffff
 require(e!=255,'finite independent numerical word')
 n=m if e==0 else m|0x800000;shift=-149 if e==0 else e-150
 v=Fraction(n)*(Fraction(2)**shift)
 return -v if w&0x80000000 else v
def normal(w):return (w&0x7fffffff)==0 or 0<((w>>23)&255)<255
def equation(op,v,variant='direct',condition=0,modifier=''):
 a=(v['b'] if variant=='join' and not condition else v['a'])[:]
 if variant in ['alias','swizzled']:a.reverse()
 if modifier=='neg':a=[w^0x80000000 for w in a]
 mask=5 if variant=='masked' else int(variant[5:]) if variant.startswith('mask-') else 15
 rows=[]
 for i,w in enumerate(a):
  if not mask&(1<<i):rows.append(dict(kind='copy',word=v['a'][i]));continue
  q=number(w)
  if op.startswith('DIV'):q/=number(v['d'][i])
  if not op.startswith('DIV'):
   expected=0 if op.endswith('_SAT') and q<0 else 0x3f800000 if op.endswith('_SAT') and q>1 else w
   rows.append(dict(kind='move',word=expected,zeroInterchange=op.endswith('_SAT')));continue
  if q==0:rows.append(dict(kind='zero',words=[0,0x80000000]));continue
  magnitude=abs(q);e=magnitude.numerator.bit_length()-magnitude.denominator.bit_length()
  if magnitude<Fraction(2)**e:e-=1
  radius=Fraction(5,2)*Fraction(2)**(e-23)
  lo,hi=q-radius,q+radius
  if op.endswith('_SAT'):lo,hi=max(0,min(1,lo)),max(0,min(1,hi))
  rows.append(dict(kind='division',lo=lo,hi=hi))
 return rows
def allowed(row,w,backend):
 if row['kind'] in ['copy','move']:
  return w==row['word'] or (backend=='mesa' or row.get('zeroInterchange',False)) and (row['word']&0x7fffffff)==0 and (w&0x7fffffff)==0
 if row['kind']=='zero':return w in row['words']
 return (w&0x7f800000)!=0x7f800000 and row['lo']<=number(w)<=row['hi']
def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT), 'freeze tracked sources')
    sources, records, recording_heads = {}, {}, set()
    # Evidence-only repairs carry immutable runtime recordings forward. An old
    # head is acceptable only when the entire commit range changes this
    # harness file; every recorded served source is still digest-checked below.
    harness_repairs = {'tools/virgl-saturation/receipt.py','tools/virgl-saturation/cases.mjs','tools/virgl-saturation/README.md','tools/virgl-saturation/precision-source.json'}

    def recording_head(value):
        recorded = value['gitHead']
        require(subprocess.run(['git','merge-base','--is-ancestor',recorded,head],cwd=ROOT,stdout=subprocess.DEVNULL).returncode == 0, 'recording is from an ancestor source head')
        changed = set(subprocess.check_output(['git','diff','--name-only',recorded,head],cwd=ROOT,text=True).splitlines())
        require(changed <= harness_repairs, 'recorded runtime or dependency source changed')
        recording_heads.add(recorded)

    def source(name, digest=None, size=None):
        raw = (ROOT / name).read_bytes()
        require(digest is None or sha(raw) == digest, 'source digest: ' + name)
        require(size is None or len(raw) == size, 'source size: ' + name)
        if not name.startswith('renderer/virgl-shader/build/'):
            require(raw == subprocess.check_output(['git', 'show', f'{head}:{name}'], cwd=ROOT), 'committed source: ' + name)
        row = dict(path=name, bytes=len(raw), sha256=sha(raw))
        require(name not in sources or sources[name] == row, 'consistent source: ' + name)
        sources[name] = row

    def artifact(name, digest=None):
        raw = (directory / name).read_bytes()
        require(digest is None or sha(raw) == digest, 'record digest: ' + name)
        records[name] = dict(path=name, bytes=len(raw), sha256=sha(raw))
        return raw

    def report(name, task=TASK, passed=True):
        value = json.loads(artifact(name))
        recording_head(value)
        require(value['status'] == ('passed' if passed else 'failed'), 'report outcome: ' + name)
        require(task is None or value['task'] == task, 'task: ' + name)
        for row in value.get('sources', []):
            source(row['path'], row['sha256'], row.get('size', row.get('bytes')))
        return value

    def browser(name, passed=True):
        value = report(name + '/report.json', passed=passed)
        require(not value['trackedChanges'], 'frozen browser sources')
        require(value['browserErrors'] == dict(console=[], page=[], requests=[]), 'browser errors')
        info = value['browser']
        require(info['launch']['headless'] is False and info['gpu']['featureStatus'][info['webglFeature']] == 'enabled', 'physical headed GPU')
        capture = value.get('screenshot') or value.get('failureScreenshot')
        artifact(name + '/' + capture['path'], capture['sha256'])
        coverage = value['browserCoverage']
        for row in json.loads(artifact(name + '/' + coverage['path'], coverage['sha256']))['scripts']:
            require(row['sha256'] == sources[row['source']]['sha256'], 'V8 source binding')
        for row in value['servedFiles']:
            require(sources[row['path']]['sha256'] == row['sha256'], 'served source binding')
        acceptance = value['acceptance']
        require(acceptance['guestExecution'] is False and acceptance['productionNegotiation'] is False and acceptance['objects']['live'] == 0, 'isolated disposed hardware')
        require(acceptance['primaryFile']['sha256'] == native['primaryFile']['sha256'], 'physical primary fixture binding')
        return acceptance

    native=report('native/report.json')
    expected=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {getCases} from './tools/virgl-saturation/cases.mjs';import {getCombinedCases} from './tools/virgl-saturation/combined.mjs';import {getCapturedCases} from './tools/virgl-saturation/captures.mjs';console.log(JSON.stringify([...getCases(),...getCombinedCases(),...getCapturedCases()]));"],cwd=ROOT))
    require(len(expected)==len(native['cases'])==1313 and native['primaryComparisons']==1245 and native['seeds']==SEEDS,'complete predetermined table')
    for wanted,c in zip(expected,native['cases']):
        require(all(c[k]==v for k,v in wanted.items()) and sha(c['text'].encode())==c['textSha256'] and c['result']['ok'] is c['ok'],'source/admission')
        if c['ok']:require(c['consumerDomain']['ok'] and ('saturation' in c['consumerDomain'])==(c['saturation'] is not False),'own saturation consumer policy')
        else:require(not any(k in c['result'] for k in ['metadata','glsl']),'closed rejection')
        if c.get('capture'):
            ref=c['capture'];source(ref['path'],ref['sha256']);text=(ROOT/ref['path']).read_text().splitlines()[ref['line']-1]
            require(text.split(':',1)[1].strip()==ref['statement'] and ref['statement'] in c['text'],'exact isolated captured statement')
        if c['primary']:
            require('#version 300 es' in c['primaryResult']['glsl'],'actual primary ESSL')
            for op in c['primaryResult']['saturationInstructions']:
                require(op['opcode']+' ' in c['text'] and op['sourceType']==op['destinationType']==(0 if op['opcode'].startswith('MOV') else 4),'actual TGSI typed SAT witnesses')
    artifact('native/cases.bin',native['fixtureSha256']);artifact('native/native.log',native['logSha256']);require(not artifact('native/native.stderr',native['stderrSha256']),'no sanitizer diagnostics')
    coverage=json.loads(artifact('native/coverage.json',native['coverageSha256']))
    for name in ['saturation_division_proved','saturation_contract','raw_record','raw_emit','float_snapshot']:
        require(any((f['name']==name or f['name'].endswith(':'+name)) and f['count']>0 for data in coverage['data'] for f in data['functions']),'recorded runtime path '+name)
    source(native['binary']['path'],native['binary']['sha256'],native['binary']['bytes']);source(native['primaryFile']['path'],native['primaryFile']['sha256'],native['primaryFile']['bytes'])
    primary=json.loads((ROOT/native['primaryFile']['path']).read_bytes());primary_by_text={c['text']:c['primary'] for c in primary}
    require(primary==[dict(name=c['name'],stage=c['stage'],text=c['text'],primary=c['primaryResult']) for c in native['cases'] if c['primary']],'primary source binding')
    wasm=report('wasm/report.json');require(wasm['nativeSha256']==records['native/report.json']['sha256'] and len(wasm['cases'])==len(wasm['pairs'])==1313,'complete singles/pairs')
    for c,w,p in zip(native['cases'],wasm['cases'],wasm['pairs']):
        require(c['index']==w['index']==p['index'] and w['result']==c['result'] and p['result']['ok'] is c['ok'],'complete public Wasm parity')
        if not c['ok']:require(not any(k in p['result'] for k in ['vertex','fragment','metadata']),'closed pair')
    retained=report('retained/report.json',task='E6-T12g6b');require(len(retained['originals'])==25 and sum(c['native']['ok'] for c in retained['originals'])==23 and len(retained['historical'])==112 and sum(c['native']['ok'] for c in retained['historical'])==5,'original bodies remain gated')
    for filename,count in [('joins',402),('hex',49),('signed',108),('conversion',1575),('scalar',1427),('minimum',4524),('fraction',4469)]:
        guard=json.loads(artifact('independent-'+filename+'-guards.json'));require(guard['status']=='passed' and guard['cases']==len(guard['native'])==len(guard['wasm'])==count,'complete promoted '+filename)
        for a,b in zip(guard['native'],guard['wasm']):
            require(a['result']==b['result'] or a['result'].get('error',{}).get('code')==b['result'].get('error',{}).get('code')=='invalid-input','promoted parity')
        if filename in ['conversion','scalar','minimum','fraction']:
            names={'conversion':'signed-conversion','scalar':'scalar-operation','minimum':'minimum-selection','fraction':'precise-fraction'}
            source('renderer/virgl-shader/tests/'+names[filename]+'-regressions.mjs',guard['testSha256'])
    held=json.loads(artifact('held-fraction/report.json'));require(held['status']=='passed' and held['physicalWords']==36096 and held['faultExit']!=0,'unchanged physical FRC source oracle')
    for binding in [held['capture'],held['fault']]:
        for key in ['sealPath','indexPath']:source(binding[key])
        source(binding['archive'],binding['archiveSha256'])
    source('renderer/virgl-shader/raw_fraction.h',held['helperSha256'])
    artifact('held-fraction/guards.json',held['guardSha256']);artifact('held-fraction/fault-guards.json',held['faultGuardSha256'])
    legacy=report('legacy.json');require(len(legacy['cases'])==2933,'all predecessor fixtures')
    for fixture in legacy['fixtures']:source(fixture['path'],fixture['sha256'],fixture['bytes'])
    for key in ['sealPath','indexPath']:source(legacy['parent'][key])
    source(legacy['parent']['archive'],legacy['parent']['archiveSha256'])
    for c in legacy['cases']:
        require(c['old']==c['parent'] and c['old']['ok'] is c['ok'] is c['added']['ok'],'complete predecessor response/admission')
        if c['ok']:
            m=dict(c['added']['metadata']);m['profile']=m.pop('saturationBaseProfile');m.pop('saturationContract');b=dict(c['old']['metadata'])
            if c['baseTransition']:b['profile']='virgl-webgl2-raw-bits-v1'
            require(m==b,'whole base obligations')
    consumer=report('consumer.json');require(consumer['nativeSha256']==records['native/report.json']['sha256'] and len(consumer['contracts'])==1257 and len(consumer['forgeries'])==836 and len(consumer['banks'])==18 and consumer['accessorInvocations']==0,'metadata ownership/attack completeness')
    require(len(consumer['combined'])==4 and all(c['base']==c['restored'] for c in consumer['combined']),'whole inherited policies')
    require(all(c['result']['ok'] is False for c in consumer['forgeries']),'closed forgeries')
    for bank in consumer['banks']:require(all(c['result']['ok'] is c['wanted'] for c in bank['checks']),'inherited bank guards')
    plans=json.loads(subprocess.check_output(['node','tools/virgl-saturation/plan.mjs',native['primaryFile']['path']],cwd=ROOT))
    words=pixels=primary_words=primary_pixels=0
    for seed,plan in zip(SEEDS,plans):
        gpu=browser('gpu-'+str(seed));require(gpu['seed']==seed and gpu['fault'] is None,'varied physical seed')
        planned_bytes=subprocess.check_output(['node','--input-type=module','-e',"import fs from 'node:fs';import {physicalPlan} from './tools/virgl-saturation/plan.mjs';process.stdout.write(JSON.stringify(physicalPlan("+str(seed)+",JSON.parse(fs.readFileSync('renderer/virgl-shader/build/saturation-primary.json')))));"],cwd=ROOT)
        require(sha(planned_bytes)==gpu['planSha256'] and len(plan['vertices'])==len(gpu['vertices']) and len(plan['fragments'])==len(gpu['fragments']),'complete predetermined GPU schedule')
        for vertex,prediction in zip(gpu['vertices'],plan['vertices']):
            require(all(vertex[k]==prediction[k] for k in ['op','variant','bank','backend','modifier','inputSource','text']) and len(vertex['vectors'])==len(prediction['vectors']),'physical source/mask/modifier schedule')
            require(sha(vertex['text'].encode())==vertex['textSha256'] and [r['name'] for r in vertex['reflection']]==['gl_Position','vso_g0','vso_g1'],'physical source/reflection')
            if vertex['backend']=='mesa':require(vertex['primary']==primary_by_text[vertex['text']],'actual pinned converter source')
            for v,predicted in zip(vertex['vectors'],prediction['vectors']):
                require(v['input']==predicted['input'] and v['condition']==predicted['condition'] and v['position']==plan['positions'][predicted['position']],'pre-observation inputs/positions')
                truth=equation(vertex['op'],v['input'],vertex['variant'],v['condition'],vertex['modifier'])
                raw=bytes(v['bytes']);require(len(raw)==48 and sha(raw)==v['sha256'],'actual feedback digest')
                observed=list(struct.unpack('<12I',raw));require(observed==v['observed'] and observed[:4]==[struct.unpack('<I',struct.pack('<f',x))[0] for x in v['position']],'physical position and feedback words')
                reconstructed=[((observed[8+i]&511)<<23)|(observed[4+i]&0x7fffff) for i in range(4)]
                require(reconstructed==v['reconstructed'] and all(allowed(row,w,vertex['backend']) for row,w in zip(truth,reconstructed)),'independent rational clamp/division words')
                for i,w in enumerate(reconstructed):require(observed[4+i]==(w&0x7fffff)|0x3f000000 and observed[8+i]==(w>>23)|0x3f000000,'both finite carriers encode the entire32-bit result')
                require(v['checkedWords']==12 and all(allowed(row,w,vertex['backend']) for row,choices in zip(truth,v['allowedResults']) for w in choices),'declared budget does not exceed independent equation')
                if vertex['inputSource']:require(v['inputWords']==v['input']['a'],'actual source attribute words')
                upload=v['bankUpload']
                if upload:
                    require(upload['words'][:4]==upload['observedA']==v['input']['a'] and upload['words'][180:184]==v['input']['b'] and upload['words'][172]==v['condition'] and all(w==0xdeadbeef for w in upload['callerAfter']),'owned bank words and poisoned caller')
                    if upload['observedB'] is not None:require(upload['observedB']==v['input']['b'],'actual reflected B bank')
                words+=12
                if vertex['backend']=='mesa':primary_words+=12
        require(sum(v.get('capture') is not None for v in gpu['vertices'])==8,'four exact captured instructions on both backends')
        for fragment,prediction in zip(gpu['fragments'],plan['fragments']):
            require(all(fragment[k]==prediction[k] for k in ['op','input','plane','text','backend']) and sha(fragment['text'].encode())==fragment['textSha256'],'all32 physical source planes')
            if fragment['backend']=='mesa':require(fragment['primary']==primary_by_text[fragment['text']],'unchanged primary fragment source')
            truth=equation(fragment['op'],fragment['input']);raw=bytes(fragment['rgbaBytes']);require(len(raw)==64 and sha(raw)==fragment['sha256'] and fragment['checkedPixels']==16,'actual RGBA8 capture')
            for row,values in zip(truth,fragment['allowedResults']):require(values and all(allowed(row,w,fragment['backend']) for w in values),'fragment predictions obey independent equation')
            expected=[sorted(set(((w>>fragment['plane'])&1)*255 for w in choices)) for choices in fragment['allowedResults']]
            require(expected==[sorted(values) for values in fragment['allowedBytes']] and all(b in expected[i%4] for i,b in enumerate(raw)),'independent clamp bit-plane pixels')
            pixels+=16
            if fragment['backend']=='mesa':primary_pixels+=16
        require(gpu['checkedWords']==sum(len(v['vectors'])*12 for v in gpu['vertices']) and gpu['checkedPixels']==len(gpu['fragments'])*16,'physical count completeness')
        require(len(gpu['consumers'])==4 and not gpu['bankDraws'],'sync/async MOV_SAT/DIV_SAT consumer contract')
        for c in gpu['consumers']:
            require(len(c['captures'])==6 and all(v==0 for v in c['finalBudgets'].values()) and all(v==0 for v in c['finalResourceBudgets'].values()),'consumer lifetime')
            for s in c['submissions']:require(all(b==255 for b in s['after']),'caller mutation after ownership')
            for capture in c['captures']:
                banks=capture['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'];require(banks[0]==banks[1] and len(banks[0])==184,'owned whole banks')
                for u in capture['native']:require(u['words']==banks[0][4*u['index']:4*u['index']+4],'actual reflected uniform ownership')
            r=c['rejection'];require(r['before']==r['after'] and r['result']['ok'] is False and r['result']['appliedCommands']==0,'inherited atomic nonfinite rejection')
    faults=[]
    for mode in ['lower','upper','order']:
        gpu=browser('fault-'+mode,passed=False);require(gpu['fault']==mode and 'independent saturation word mismatch' in gpu['failure']['message'],'real saturation source fault caught')
        changed=[v for v in gpu['vertices'] if v['mutation']];require(len(changed)==1,'one emitted-source fault')
        v=changed[0];m=v['mutation'];require(m['original']==v['pair']['vertex']['glsl'] and m['served']==m['original'].replace(m['needle'],m['replacement'],1),'exact physical source fault')
        point=next(x['failure'] for x in v['vectors'] if 'failure' in x);require(point['actual'] not in point['allowed'],'numerical source fault contradicts declared prediction')
        faults.append(dict(mode=mode,op=v['op'],failure=point))
    paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader','renderer/virgl-command','tools/virgl-saturation','tools/virgl-precise-fraction','tools/virgl-minimum-selection/combined.mjs','tools/virgl-scalar-operations/combined.mjs','tools/virgl-signed-conversions/cases.mjs','tools/virgl-signed-conversions/combined.mjs','tools/virgl-precise-arithmetic/oracle.mjs','tools/virgl-compiler-bounds/retained.mjs','tools/lib/virgl-browser-runner.mjs','tools/setup-virgl-emsdk.sh','tools/verify-virgl-saturation.sh','Makefile','web/package-lock.json'],cwd=ROOT,text=True).splitlines()
    for name in paths:source(name)
    for name in ['native/virgl-shader','wasm/virgl-shader.mjs','wasm/virgl-shader.wasm']:source('renderer/virgl-shader/build/'+name)
    for f in sorted(directory.rglob('*')):
        if f.is_file() and f.name not in ['receipt.json','acceptance.log']:artifact(str(f.relative_to(directory)))
    result=dict(schema='virgl-saturation-receipt-v1',task=TASK,status='passed',gitHead=head,guestExecution=False,productionNegotiation=False,nativeCases=1313,wasmCases=1313,wasmPairs=1313,primaryComparisons=1245,legacyCases=2933,metadataAttacks=836,ownedBanks=18,combinedBases=4,heldFractionWords=36096,checkedWords=words,checkedPixels=pixels,primaryWords=primary_words,primaryPixels=primary_pixels,physicalOutputFaults=faults,recordingHeads=sorted(recording_heads),sources=list(sources.values()),records=list(records.values()))
    (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(f'{TASK} receipt passed: {words} physical words / {pixels} pixels')
if __name__=='__main__':main()
