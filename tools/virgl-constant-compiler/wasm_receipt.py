"""Independent recorded-data Wasm parity, ownership and fixed-heap audit."""
from pathlib import Path
import json
from compat_common import ROOT, require, sha, read, binding, source

LABELS = ['raw','integer','float','numeric','component','dot']
SOURCES = ['renderer/virgl-shader/index.mjs','renderer/virgl-shader/bridge.h','renderer/virgl-shader/build.sh',
 'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
 'tools/virgl-constant-compiler/wasm.mjs','tools/virgl-constant-compiler/wasm_receipt.py']
LIMITS = {'textBytes':16384,'tokens':8192,'glslBytes':65536,'instructions':179,'registerIndex':7,'temporaryRegisterIndex':117,'constantRegisterIndex':45}


def encoded(value): return json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()


def verify(directory,head,native):
    require(isinstance(head,str) and len(head)==40,'exact frozen Wasm source head')
    return _verify(directory,head,native)


def verify_recording(directory,native):
    """Inner-loop audit of current source bindings; no exact-head submission claim."""
    return _verify(directory,None,native)


def _verify(directory,head,native):
    directory=Path(directory);report=read(directory/'report.json')
    require(set(report)=={'schema','status','node','nativeReport','sources','limits','counts','ownership','stress','allocationPressure','maxima','memory','records'},'complete Wasm report shape')
    require(report['schema']=='wasm-vm-constant-compiler-wasm-v1' and report['status']=='passed','completed Wasm recording')
    require(set(report['node'])=={'version','platform','arch'} and all(isinstance(v,str) and v for v in report['node'].values()),'recorded Node environment')
    require(report['limits']==LIMITS and report['sources']==[binding(ROOT/p) for p in SOURCES],'exact Wasm runtime/harness identities and bounds')
    if head is not None:
        for entry in report['sources']: source(entry,head)
    native_source=report['nativeReport'];raw=(directory/native_source['path']).read_bytes()
    require(native_source=={'path':'../native/native-report.json','bytes':len(raw),'sha256':sha(raw)} and json.loads(raw)==native,'actual independently checked native baseline')
    cases={};pairs={}
    for label in LABELS:
        for e in native[label+'Cases']:cases[label+'::'+e['name']]=e
        for e in native[label+'Pairs']:pairs[label+'::'+e['name']]=dict(e,vertexCaseName=label+'::'+e['vertexCaseName'],fragmentCaseName=label+'::'+e['fragmentCaseName'])
    cases.update({e['name']:e for e in native['cases']});pairs.update({e['name']:e for e in native['pairs']})
    require(len(cases)==2699+len(native['cases']) and len(pairs)==203+len(native['pairs']),'full retained/new unique matrix')
    log=(directory/'calls.jsonl').read_bytes()
    require(report['records']==[{'path':'calls.jsonl','bytes':len(log),'sha256':sha(log)}],'complete raw call log binding')
    lines=iter(log.splitlines());index=0;maxima={'singleJSBytes':0,'pairJSBytes':0,'glslBytes':0};recoveries=0
    def consume(kind,name,result,full):
        nonlocal index
        raw=next(lines,None);require(raw is not None,'no omitted actual Wasm call');actual=json.loads(raw)
        serialized=encoded(result);expected={'index':index,'kind':kind,'name':name,'resultBytes':len(serialized),'resultSha256':sha(serialized)}
        if full:expected['result']=result
        require(actual==expected,f'exact recorded call {index}: {kind}/{name}')
        paired=result['ok'] and 'vertex' in result;key='pairJSBytes' if paired else 'singleJSBytes'
        require(len(serialized)<(295936 if paired else 147456),'actual bounded result')
        maxima[key]=max(maxima[key],len(serialized))
        if result['ok']:
            for stage in [result['vertex'],result['fragment']] if paired else [result]:
                size=len(stage['glsl'].encode());require(size<=65536,'actual bounded ESSL');maxima['glslBytes']=max(maxima['glslBytes'],size)
        index+=1
    def recover():
        nonlocal recoveries
        for name in native['recoverySingles']:consume('recovery-single',name,cases[name]['result'],False)
        for name in native['recoveryPairs']:consume('recovery-pair',name,pairs[name]['result'],False)
        recoveries+=1
    for entry in native['originals']:consume('original',entry['sha256'],entry['result'],True)
    for name,entry in cases.items():
        consume('single',name,entry['result'],True)
        if '::' not in name:recover()
    for name,entry in pairs.items():
        consume('pair',name,entry['result'],True)
        if '::' not in name:recover()
    ownership=[]
    for name in ['coupled-vertex','coupled-fragment']:
        consume('ownership-single',name,cases[name]['result'],True)
        oldname=native['recoverySingles'][0];consume('ownership-overwrite',oldname,cases[oldname]['result'],False)
        ownership.append({'kind':'single','name':name,'requestAfter':{'stage':'invalid','text':'invalid'},'result':cases[name]['result']})
    consume('ownership-pair','coupled-pair',pairs['coupled-pair']['result'],True)
    oldname=native['recoveryPairs'][0];consume('ownership-overwrite-pair',oldname,pairs[oldname]['result'],False)
    ownership.append({'kind':'pair','name':'coupled-pair','requestAfter':{'vertexText':'invalid','fragmentText':'invalid'},'result':pairs['coupled-pair']['result']})
    require(report['ownership']==ownership,'complete owned request/result observations')
    stress=[]
    for stage in ('vertex','fragment'):
        name='instruction-count-179-'+stage;entry=cases[name];text=entry['text']+'\n'*(16384-len(entry['text']))
        stress.append({'name':name,'iterations':32,'textBytes':16384,'textSha256':sha(text.encode()),'result':entry['result']})
        for _ in range(32):consume('stress',name,entry['result'],False)
        recover()
    require(report['stress']==stress,'exact maximal text/instruction ownership stress')
    pressure=report['allocationPressure'];schedule=[0,1,4,8,12,16,24,32,40,48,64]
    require(set(pressure)=={'chunkBytes','releaseSchedule','targets'} and pressure['chunkBytes']==4096 and pressure['releaseSchedule']==schedule and len(pressure['targets'])==3,'bounded real allocator pressure matrix')
    pressure_calls=0;error_codes=set()
    def capacity(value):
        require(set(value)=={'chunkBytes','availableChunks','availableRequestedBytes'} and value['chunkBytes']==4096 and type(value['availableChunks']) is int and 0<=value['availableChunks']<4096 and value['availableRequestedBytes']==value['availableChunks']*4096,'real bounded malloc capacity record')
    for record,(kind,name) in zip(pressure['targets'],[('single','coupled-vertex'),('single','coupled-fragment'),('pair','coupled-pair')]):
        entry=(cases if kind=='single' else pairs)[name]
        require(set(record)=={'kind','name','capacityBefore','reservedChunks','releasedChunks','attempts','capacityAfter','recoveredResult'} and record['kind']==kind and record['name']==name,'exact pressure target')
        capacity(record['capacityBefore']);capacity(record['capacityAfter'])
        require(record['capacityBefore']==record['capacityAfter'] and record['reservedChunks']==record['capacityBefore']['availableChunks']==record['releasedChunks']>64,'whole requested capacity reserved and released')
        attempts=record['attempts'];require(2<=len(attempts)<=len(schedule),'pressure observes failure then bounded success')
        for attempt,release in zip(attempts,schedule):
            require(set(attempt)=={'releasedChunks','heldChunks','capacityBefore','capacityAfter','result'} and attempt['releasedChunks']==release and attempt['heldChunks']==record['reservedChunks']-release,'literal sequential release schedule')
            capacity(attempt['capacityBefore']);capacity(attempt['capacityAfter'])
            require(attempt['capacityBefore']==attempt['capacityAfter'],'each call restores malloc capacity')
            result=attempt['result'];consume('pressure',name,result,True);pressure_calls+=1
            if attempt is attempts[-1]:require(result==entry['result'],'last pressure attempt full native success')
            else:
                allowed=[{'ok':False,'error':{'code':'allocation-failed','message':'Wasm input allocation failed.'}},
                         {'ok':False,'error':{'code':'translation-error','message':'Raw IR allocation failed.'}},
                         {'ok':False,'error':{'code':'unsupported-feature','message':'TGSI is malformed or outside the documented straight-line profile.'}}]
                require(result in allowed,'only complete original/OOM failure before success');error_codes.add(result['error']['code'])
        require(record['recoveredResult']==entry['result'],'full exact post-release recovery')
        consume('pressure-recovered',name,entry['result'],True);recover()
    require({'translation-error','unsupported-feature'}<=error_codes,'real first-IR and conditional emitter pressure failures exercised')
    require(next(lines,None) is None,'no omitted or extra call records')
    expected_counts={'calls':index,'originals':19,'singles':len(cases),'pairs':len(pairs),
      'recoverySingles':recoveries*16,'recoveryPairs':recoveries*14,'stress':64,'pressure':pressure_calls}
    require(report['counts']==expected_counts and report['maxima']==maxima,'independent exact call/recovery/output accounting')
    require(report['memory']=={'initialBytes':16777216,'finalBytes':16777216,'bufferIdentityStable':True},'same fixed Wasm memory throughout every recorded call')
    return {'schema':report['schema'],'status':'passed','counts':expected_counts,'memory':report['memory'],'maxima':maxima,
            'allocationPressure':{'targets':3,'calls':pressure_calls,'errorCodes':sorted(error_codes)},'sources':report['sources']}
