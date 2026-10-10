#!/usr/bin/env python3
"""Authenticate recordings; independent high precision intervals and independent TGSI execution."""
import hashlib,json,struct,subprocess,sys
from fractions import Fraction
from pathlib import Path
from reference import predict,accepts
ROOT=Path(__file__).resolve().parents[2]
TASK='E6-T12g6i'
SEEDS=[0x283b71c9,0x71ac40e3,0xd609827b]
def sha(raw):return hashlib.sha256(raw).hexdigest()
def require(v,label):
 if not v:raise ValueError(label)
def main():
    directory = Path(sys.argv[1]).resolve()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    require(not subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT), 'freeze tracked sources')
    sources, records, recording_heads = {}, {}, set()
    # Evidence-only repairs carry immutable runtime recordings forward. An old
    # head is acceptable only when the entire commit range changes this
    # harness file; every recorded served source is still digest-checked below.
    harness_repairs = {'tools/virgl-exponent-logarithm/receipt.py','tools/virgl-exponent-logarithm/cases.mjs','tools/virgl-exponent-logarithm/README.md','tools/virgl-exponent-logarithm/precision-source.json'}

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
        require(acceptance['referenceFile']['sha256']==reference_sha,'pre-observation reference binding')
        return acceptance

    from source_oracle import result_rows,allowed
    native=report('native/report.json')
    expected=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {getCases} from './tools/virgl-exponent-logarithm/cases.mjs';import {getCombinedCases} from './tools/virgl-exponent-logarithm/combined.mjs';import {getCapturedCases} from './tools/virgl-exponent-logarithm/captures.mjs';console.log(JSON.stringify([...getCases(),...getCombinedCases(),...getCapturedCases()]));"],cwd=ROOT))
    require(len(expected)==len(native['cases']) and native['primaryComparisons']==sum(c['primary'] for c in expected) and native['seeds']==SEEDS,'complete predetermined native table')
    for wanted,c in zip(expected,native['cases']):
        require(all(c[k]==v for k,v in wanted.items()) and sha(c['text'].encode())==c['textSha256'] and c['result']['ok'] is c['ok'],'source/admission')
        if c['ok']:require(c['consumerDomain']['ok'] and 'exponent' in c['consumerDomain'],'owned exponent policy')
        else:require(not any(k in c['result'] for k in ['metadata','glsl']),'closed rejection')
        if c.get('capture'):
            ref=c['capture'];source(ref['path'],ref['sha256']);line=(ROOT/ref['path']).read_text().splitlines()[ref['line']-1]
            require(line.split(':',1)[1].strip()==ref['statement'] and ref['statement'] in c['text'],'literal original use site')
        if c['primary']:
            require('#version 300 es' in c['primaryResult']['glsl'],'actual pinned converter')
            require(all(op['opcode'] in ['EX2','LG2'] and op['sourceType']==op['destinationType']==4 and op['outputMode']==2 for op in c['primaryResult']['exponentInstructions']),'actual typed primary tokens and scalar replication')
    artifact('native/cases.bin',native['fixtureSha256']);artifact('native/native.log',native['logSha256']);require(not artifact('native/native.stderr',native['stderrSha256']),'no sanitizer diagnostics')
    coverage=json.loads(artifact('native/coverage.json',native['coverageSha256']))
    for name in ['exponent_domain_proved','exponent_contract','raw_record','raw_emit','float_snapshot']:
        require(any((f['name']==name or f['name'].endswith(':'+name)) and f['count']>0 for data in coverage['data'] for f in data['functions']),'covered runtime '+name)
    source(native['binary']['path'],native['binary']['sha256'],native['binary']['bytes']);source(native['primaryFile']['path'],native['primaryFile']['sha256'],native['primaryFile']['bytes'])
    primary=json.loads((ROOT/native['primaryFile']['path']).read_bytes());primary_by_text={c['text']:c['primary'] for c in primary}
    require(primary==[dict(name=c['name'],stage=c['stage'],text=c['text'],primary=c['primaryResult']) for c in native['cases'] if c['primary']],'entire primary source table')
    reference_path='renderer/virgl-shader/build/exponent-logarithm-reference.json';reference_raw=(ROOT/reference_path).read_bytes();reference_sha=sha(reference_raw);reference=json.loads(reference_raw);source(reference_path,reference_sha)
    require(reference['precision']==[160,220] and reference['primaryFileSha256']==native['primaryFile']['sha256'],'pre-observation primary interval inputs')
    source('tools/virgl-exponent-logarithm/reference.py',reference['referenceSourceSha256'])
    require(all(predict(r['op'],r['word'])==r for r in reference['rows']),'correctly rounded outward primary predictions')
    wasm=report('wasm/report.json');require(wasm['nativeSha256']==records['native/report.json']['sha256'] and len(wasm['cases'])==len(wasm['pairs'])==len(expected),'all singles/pairs')
    for c,w,p in zip(native['cases'],wasm['cases'],wasm['pairs']):
        require(c['index']==w['index']==p['index'] and w['result']==c['result'] and p['result']['ok'] is c['ok'],'public wasm parity')
        if not c['ok']:require(not any(k in p['result'] for k in ['vertex','fragment','metadata']),'closed pair')
    retained=report('retained/report.json',task='E6-T12g6b');require(len(retained['originals'])==25 and sum(c['native']['ok'] for c in retained['originals'])==23 and len(retained['historical'])==112 and sum(c['native']['ok'] for c in retained['historical'])==5,'original full bodies remain gated')
    for filename,count in [('joins',402),('hex',49),('signed',108),('conversion',1575),('scalar',1427),('minimum',4524),('fraction',4469),('saturation',1160)]:
        guard=json.loads(artifact('independent-'+filename+'-guards.json'));require(guard['status']=='passed' and guard['cases']==len(guard['native'])==len(guard['wasm'])==count,'promoted '+filename)
        for a,b in zip(guard['native'],guard['wasm']):require(a['result']==b['result'] or a['result'].get('error',{}).get('code')==b['result'].get('error',{}).get('code')=='invalid-input','promoted parity')
    held=json.loads(artifact('held-saturation/report.json'));require(held['status']=='passed' and held['physicalWords']==39576 and held['faultExit']!=0,'unchanged physical SAT oracle')
    for binding in [held['capture'],held['fault']]:
        for key in ['sealPath','indexPath']:source(binding[key])
        source(binding['archive'],binding['archiveSha256'])
    artifact('held-saturation/guards.json',held['guardSha256']);artifact('held-saturation/fault-guards.json',held['faultGuardSha256'])
    legacy=report('legacy.json');require(len(legacy['cases'])==4246,'all predecessor fixtures')
    for fixture in legacy['fixtures']:source(fixture['path'],fixture['sha256'],fixture['bytes'])
    for key in ['sealPath','indexPath']:source(legacy['parent'][key])
    source(legacy['parent']['archive'],legacy['parent']['archiveSha256'])
    for c in legacy['cases']:
        require(c['old']==c['parent'] and c['old']['ok'] is c['ok'] is c['added']['ok'],'complete predecessor response')
        if c['ok']:
            m=dict(c['added']['metadata']);m['profile']=m.pop('exponentBaseProfile');m.pop('exponentContract');b=dict(c['old']['metadata'])
            if c['baseTransition']:b['profile']='virgl-webgl2-raw-bits-v1'
            require(m==b,'whole inherited obligations')
    consumer=report('consumer.json');require(consumer['nativeSha256']==records['native/report.json']['sha256'] and len(consumer['contracts'])==sum(c['ok'] for c in expected) and len(consumer['forgeries'])>=782 and len(consumer['banks'])>=14 and consumer['accessorInvocations']==0,'complete owned policies/attacks')
    require(len(consumer['combined'])==4 and all(c['base']==c['restored'] for c in consumer['combined']),'all previous simultaneous policies')
    require(all(c['result']['ok'] is False for c in consumer['forgeries']),'closed forgeries')
    for bank in consumer['banks']:require(all(c['result']['ok'] is c['wanted'] for c in bank['checks']),'inherited bank restriction')
    plans=json.loads(subprocess.check_output(['node','tools/virgl-exponent-logarithm/plan.mjs',native['primaryFile']['path']],cwd=ROOT))
    words=pixels=primary_words=primary_pixels=canonical_words=0;deviations=[]
    for seed,plan in zip(SEEDS,plans):
        gpu=browser('gpu-'+str(seed));require(gpu['seed']==seed and gpu['fault'] is None,'varied seed')
        planned_bytes=subprocess.check_output(['node','--input-type=module','-e',"import fs from 'node:fs';import {physicalPlan} from './tools/virgl-exponent-logarithm/plan.mjs';process.stdout.write(JSON.stringify(physicalPlan("+str(seed)+",JSON.parse(fs.readFileSync('renderer/virgl-shader/build/exponent-logarithm-primary.json')))));"],cwd=ROOT)
        require(sha(planned_bytes)==gpu['planSha256'] and len(plan['vertices'])==len(gpu['vertices']) and len(plan['fragments'])==len(gpu['fragments']),'whole physical schedule')
        for index,(v,p) in enumerate(zip(gpu['vertices'],plan['vertices'])):
            require(all(v[k]==p[k] for k in ['op','input','variant','modifier','text','backend','capture']) and sha(v['text'].encode())==v['textSha256'] and len(v['vectors'])==len(p['vectors']),'source/mask/version schedule')
            if v['backend']=='mesa':require(v['primary']==primary_by_text[v['text']],'unaltered pinned GLSL')
            require([r['name'] for r in v['reflection']]==['gl_Position','vso_g0','vso_g1'],'physical reflection')
            for x,px in zip(v['vectors'],p['vectors']):
                require(x['condition']==px['condition'] and x['position']==plan['positions'][px['position']],'predetermined condition/position')
                truth=result_rows(v['text'],x['condition'],v['input']['a'],v['input']['b'],v['backend']);require(truth==x['oracles'],'independent TGSI source equations')
                raw=bytes(x['bytes']);require(len(raw)==48 and sha(raw)==x['sha256'],'feedback capture');observed=list(struct.unpack('<12I',raw));require(observed==x['observed'] and observed[:4]==[struct.unpack('<I',struct.pack('<f',t))[0] for t in x['position']],'positions and full words')
                reconstructed=[((observed[8+i]&511)<<23)|(observed[4+i]&0x7fffff) for i in range(4)]
                require(reconstructed==x['reconstructed'] and all(allowed(r,w) for r,w in zip(truth,reconstructed)),'independent real-value bound')
                for i,w in enumerate(reconstructed):require(observed[4+i]==(w&0x7fffff)|0x3f000000 and observed[8+i]==(w>>23)|0x3f000000,'complete finite carriers')
                require(x['checkedWords']==12,'word count');words+=12
                if v['backend']=='mesa':
                    primary_words+=12;specified=result_rows(v['text'],x['condition'],v['input']['a'],v['input']['b'],'owned')
                    if specified==truth:canonical_words+=12
                    elif not all(allowed(r,w) for r,w in zip(specified,reconstructed)):deviations.append(dict(seed=seed,vertex=index,condition=x['condition'],observed=reconstructed,source=v['textSha256']))
                upload=x['bankUpload']
                if upload:require(upload['words'][:4]==upload['observedA']==v['input']['a'] and upload['words'][172]==x['condition'] and all(w==0xdeadbeef for w in upload['callerAfter']),'owned physical bank snapshot')
        require(sum(v['capture'] is not None for v in gpu['vertices'])==36,'18 original literal uses on both backends')
        for f,p in zip(gpu['fragments'],plan['fragments']):
            require(all(f[k]==p[k] for k in ['op','input','lane','variant','modifier','text','backend']) and sha(f['text'].encode())==f['textSha256'],'fragment source schedule')
            if f['backend']=='mesa':require(f['primary']==primary_by_text[f['text']],'unaltered primary fragment')
            truth=result_rows(f['text'],0,f['input']['a'],f['input']['b'],f['backend'])[f['lane']];require(truth==f['oracle'],'source-derived fragment equation')
            raw=bytes(f['rgbaBytes']);require(len(raw)==64 and sha(raw)==f['sha256'] and f['checkedPixels']==16,'physical byte capture');reconstructed=list(struct.unpack('<16I',raw))
            require(reconstructed==f['reconstructed'] and all(allowed(truth,w) for w in reconstructed),'one whole result word per actual RGBA8 pixel');pixels+=16
            upload=f['bankUpload']
            if upload:require(upload['words'][:4]==upload['observedA']==f['input']['a'] and all(w==0xdeadbeef for w in upload['callerAfter']),'owned reflected fragment bank')
            if f['backend']=='mesa':primary_pixels+=16
        require(gpu['checkedWords']==sum(len(v['vectors'])*12 for v in gpu['vertices']) and gpu['checkedPixels']==len(gpu['fragments'])*16,'GPU count completeness')
        require(len(gpu['consumers'])==4,'sync/async EX2/LG2 consumers')
        for c in gpu['consumers']:
            require(len(c['captures'])==6 and all(v==0 for v in c['finalBudgets'].values()) and all(v==0 for v in c['finalResourceBudgets'].values()),'consumer lifetime')
            for s in c['submissions']:require(all(b==255 for b in s['after']),'caller poisoned after snapshot')
            for capture in c['captures']:
                banks=capture['snapshot']['contexts'][0]['subContexts'][0]['bindings']['constants'];require(banks[0]==banks[1] and len(banks[0])==184,'owned full banks')
                for u in capture['native']:require(u['words']==banks[0][4*u['index']:4*u['index']+4],'actual reflected words')
            r=c['rejection'];require(r['before']==r['after'] and r['result']['ok'] is False and r['result']['appliedCommands']==0,'atomic inherited rejection')
    faults=[]
    for fault in ['ex2','lg2','broadcast']:
        gpu=browser('fault-'+fault,passed=False);require(gpu['fault']==fault and 'independent exponent word mismatch' in gpu['failure']['message'],'actual emitted source fault caught')
        changed=[v for v in gpu['vertices'] if v['mutation']];require(len(changed)==1,'one physical fault');v=changed[0];m=v['mutation']
        require(m['original']==v['pair']['vertex']['glsl'] and m['served']==m['original'].replace(m['needle'],m['replacement'],1),'exact source fault binding')
        point=next(x['failure'] for x in v['vectors'] if 'failure' in x);require(not allowed(point['oracle'],point['actual']),'independent fault contradiction');faults.append(dict(mode=fault,failure=point))
    require(deviations and canonical_words>0,'pinned converter discrepancy recorded alongside canonical agreement')
    paths=subprocess.check_output(['git','ls-files','renderer/virgl-shader','renderer/virgl-command','tools/virgl-exponent-logarithm','tools/virgl-saturation','tools/virgl-precise-fraction','tools/virgl-signed-conversions/cases.mjs','tools/virgl-precise-arithmetic/oracle.mjs','tools/virgl-compiler-bounds/retained.mjs','tools/lib/virgl-browser-runner.mjs','tools/setup-virgl-emsdk.sh','tools/verify-virgl-exponent-logarithm.sh','Makefile','web/package-lock.json'],cwd=ROOT,text=True).splitlines()
    for name in paths:source(name)
    for name in ['native/virgl-shader','wasm/virgl-shader.mjs','wasm/virgl-shader.wasm']:source('renderer/virgl-shader/build/'+name)
    for f in sorted(directory.rglob('*')):
        if f.is_file() and f.name not in ['receipt.json','acceptance.log']:artifact(str(f.relative_to(directory)))
    result=dict(schema='virgl-exponent-logarithm-receipt-v1',task=TASK,status='passed',gitHead=head,guestExecution=False,productionNegotiation=False,nativeCases=len(expected),wasmCases=len(expected),wasmPairs=len(expected),primaryComparisons=native['primaryComparisons'],legacyCases=4246,metadataAttacks=len(consumer['forgeries']),ownedBanks=len(consumer['banks']),combinedBases=4,heldSaturationWords=39576,referencePredictions=len(reference['rows']),checkedWords=words,checkedPixels=pixels,primaryWords=primary_words,primaryPixels=primary_pixels,canonicalPrimaryWords=canonical_words,pinnedConverterDeviations=deviations,physicalOutputFaults=faults,recordingHeads=sorted(recording_heads),sources=list(sources.values()),records=list(records.values()))
    (directory/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print(f'{TASK} receipt passed: {words} physical words / {pixels} pixels')
if __name__=='__main__':main()
