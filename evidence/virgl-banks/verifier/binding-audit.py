#!/usr/bin/env python3
"""Independent E3 evidence audit. No imports from acceptance/receipt helpers."""
from pathlib import Path
import hashlib, json, math, re, struct, subprocess
from collections import Counter
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).parent
HEAD='f88d7bb0c52cb4ac1189f7a05fb1dfdf77b03b91'
checks=Counter(); findings=[]; evidence=[]; cache={}
def ck(value,label):
    checks[label.split(':')[0]]+=1
    if not value: raise AssertionError(label)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def js(path): return json.loads(path.read_text())
def git(*args,cwd=ROOT): return subprocess.check_output(['git',*args],cwd=cwd)
def frozen(path):
    if path not in cache: cache[path]=git('show',f'{HEAD}:{path}')
    return cache[path]
def bind(desc,base,frozen_tree=False):
    p=base/desc['path'];raw=p.read_bytes(); size=desc.get('bytes',desc.get('size'))
    ck(sha(raw)==desc['sha256'],f'hash: {p}')
    if size is not None:ck(len(raw)==size,f'size: {p}')
    if frozen_tree:ck(raw==frozen(desc['path']),f'frozen source: {p}')
    return raw

def inventory(base):
    r=js(base/'inventory.json'); actual={};files=('IN','OUT','TEMP','CONST','IMM','SAMP','SVIEW','ADDR','GENERIC')
    for p in sorted((ROOT/'evidence/virgl-corpus/captures').glob('*/shaders/*.tgsi')):
        raw=p.read_bytes();h=sha(raw);ck(h==p.stem,'original: hash identity');ck(raw==frozen(str(p.relative_to(ROOT))),'original: frozen bytes')
        if h not in actual:
            ls=[l for l in raw.decode().splitlines() if l.strip()];d={f:None for f in files};u=d.copy();ops=[]
            for l in ls[1:]:
                m=re.match(r'\s*(\d+):\s*(\w+)',l)
                dest=d
                if m: ck(int(m[1])==len(ops),'inventory: labels');ops.append(m[2]);dest=u
                for bank,first,last in re.findall(r'\b(IN|OUT|TEMP|CONST|IMM|SAMP|SVIEW|ADDR|GENERIC)\[(\d+)(?:\.\.(\d+))?\]',l):
                    v=int(last or first);dest[bank]=max(dest[bank] if dest[bank] is not None else -1,v)
            actual[h]={'sha256':h,'paths':[],'bytes':len(raw),'stage':'vertex' if ls[0]=='VERT' else 'fragment','nonemptyLines':len(ls),'maximumLineBytes':max(map(len,ls)),
                'instructionsIncludingEnd':len(ops),'nonEndInstructions':len(ops)-1,'declaredMaxima':d,'directMaxima':u,
                'preciseInstructions':[{'label':i,'opcode':op} for i,op in enumerate(ops) if op.endswith('_PRECISE')]}
            ck(ops.count('END')==1 and ops[-1]=='END','inventory: terminal')
        actual[h]['paths'].append(str(p.relative_to(ROOT)))
    ck(len(actual)==19,'inventory: distinct identities')
    for x in r['originals']:
        a=actual[x['sha256']].copy();a['paths']=sorted(a['paths']);b=x.copy();b['paths']=sorted(b['paths']);ck(a==b,'inventory: complete per original record')
    for key,expected in [('bytes',8800),('nonemptyLines',191),('maximumLineBytes',80),('instructionsIncludingEnd',179),('nonEndInstructions',178)]:
        mx=max(x[key] for x in actual.values());ck(mx==expected,'inventory: literal maximum');ck(r['maxima'][key]=={'value':mx,'witnesses':sorted(h for h,x in actual.items() if x[key]==mx)},'inventory: maximum witnesses')
    for section in ('declaredMaxima','directMaxima'):
        for bank in files:
            mx=max((x[section][bank] for x in actual.values() if x[section][bank] is not None),default=None)
            ck(r['maxima'][section][bank]=={'value':mx,'witnesses':sorted(h for h,x in actual.items() if mx is not None and x[section][bank]==mx)},'inventory: bank maxima and witnesses')
    ck(sum(bool(x['preciseInstructions']) for x in actual.values())==7,'inventory: precise original count')
    return actual

fixture=js(ROOT/'renderer/virgl-shader/tests/bank-cases.json');fm={x['name']:x for x in fixture};ck(len(fm)==len(fixture)==404,'fixture: unique404')
PAIR=[('hardware-low-pair','hardware-low-vertex','hardware-low-fragment'),('hardware-high-pair','hardware-high-vertex','hardware-high-fragment'),('hardware-order-pair','hardware-high-vertex','hardware-order-fragment'),('hardware-maximal-pair','hardware-maximal-vertex','hardware-maximal-fragment')]
def native(base,source_root):
    n=js(base/'native/native-report.json'); ck(n['status']=='passed','native: status'); log=(base/'native/native.log').read_bytes();ck(sha(log)==n['logSha256'],'native: log hash')
    ck(not any(s in log for s in [b'ERROR: AddressSanitizer',b'runtime error:',b'FAIL case=',b'SUMMARY: UndefinedBehaviorSanitizer']),'native: no sanitizer failures')
    seen={kind:{} for kind in ('ORIGINAL','CASE','PAIR')};raw_lengths={kind:[] for kind in seen}
    for l in log.decode().splitlines():
        m=re.fullmatch(r'(ORIGINAL|CASE|PAIR) (\d+) (.*)',l)
        if m:
            i=int(m[2]);ck(i not in seen[m[1]],'native: unique raw index');seen[m[1]][i]=json.loads(m[3]);raw_lengths[m[1]].append(len(m[3]));ck(len(m[3])==n[{'ORIGINAL':'originals','CASE':'cases','PAIR':'pairs'}[m[1]]][i]['resultBytes'],'native: resultBytes')
    for kind,key in [('ORIGINAL','originals'),('CASE','cases'),('PAIR','pairs')]:
        ck(len(seen[kind])==len(n[key]),'native: complete raw records')
        for i,x in enumerate(n[key]):ck(seen[kind][i]==x['result'],'native: full raw output equality')
    originals={}
    for workload in ('textured-scene','kmscube','glmark2-es2','compositor'):
        for p in sorted((ROOT/'evidence/virgl-corpus/captures'/workload/'shaders').glob('*.tgsi')):originals.setdefault(p.stem,p)
    stream=bytearray(b'VGB1'+struct.pack('<I',19))
    for x,(h,p) in zip(n['originals'],sorted(originals.items())):
        raw=p.read_bytes();stage=int(raw.startswith(b'FRAG\n'));accepted=b'PRECISE' not in raw
        ck(x['sha256']==h and x['path']==str(p.relative_to(ROOT)) and x['bytes']==len(raw),'native: original identity')
        ck(x['ok']==x['result']['ok']==accepted,'native: original outcome')
        if not accepted:ck(x['result']['error']['code']=='unsupported-feature','native: excluded original classification')
        stream+=struct.pack('<III',stage,accepted,len(raw))+raw
    stream+=struct.pack('<I',404)
    for x,f in zip(n['cases'],fixture):
        raw=f['text'].encode();name=f['name'].encode();ck(x['name']==f['name'] and x['stage']==f['stage'] and x['ok']==f['ok']==x['result']['ok'] and x['inputSha256']==sha(raw),'native: fixture identity/outcome')
        ck(x.get('expected')==f.get('expected'),'native: fixture declared expectation')
        stream+=struct.pack('<IIII',int(f['stage']=='fragment'),f['ok'],len(name),len(raw))+name+raw
    stream+=struct.pack('<I',4);names=[f['name'] for f in fixture]
    for x,(name,v,f) in zip(n['pairs'],PAIR):
        vi,fi=names.index(v),names.index(f);ck(x['name']==name and x['vertexCaseName']==v and x['fragmentCaseName']==f,'native: pair identity');stream+=struct.pack('<III',vi,fi,len(name))+name.encode()
        for st,k in [('vertex',v),('fragment',f)]:
            ck(x[st+'Sha256']==sha(fm[k]['text'].encode()),'native: exact pair text')
            ck(x['result'][st]=={k2:n['cases'][names.index(k)]['result'][k2] for k2 in ('glsl','metadata')},'native: pair full standalone stage')
    ck(sha(stream)==n['streamSha256'],'native: reconstructed input stream')
    ck(sha(Path(n['command'][0]).read_bytes())==n['binarySha256'],'native: binary present and hash bound')
    for d in n['sources']:bind(d,source_root,True)
    bind(n['fixture'],source_root,True)
    s=n['stats'];ck(s=={'originals':19,'acceptedOriginals':12,'cases':404,'pairs':4,'calls':39647,'standaloneRecoveries':22640,'pairRecoveries':11320,'truncations':840,'hostileCases':320,'mutations':4096,'maxSingleResultBytes':14229,'maxPairResultBytes':27791},'native: claimed statistics')
    attacks=404+sum(len(fm[k]['text']) for k in names[:4])+4+2*sum(c not in (9,10,13) and (c<32 or c>126) for c in range(256))+4096
    ck(s['calls']==19+4+4+7*attacks and s['standaloneRecoveries']==4*attacks and s['pairRecoveries']==2*attacks,'native: independent recovery arithmetic')
    for seed in ('7c1209ad','491be583','ea016f35','265d8cb7'):ck(log.count(f'SEED {seed} mutations=1024 standalone_recoveries=4096 pair_recoveries=2048 passed'.encode())==1,'native: complete seed')
    stages=[x['result'] for x in n['originals']+n['cases'] if x['result']['ok']]+[x['result'][st] for x in n['pairs'] for st in ('vertex','fragment')]
    ck(n['recordedMaxima']=={'singleResultBytes':max(raw_lengths['ORIGINAL']+raw_lengths['CASE']),'pairResultBytes':max(raw_lengths['PAIR']),'stageGlslBytes':max(len(x['glsl'].encode()) for x in stages)},'native: observed maxima')
    return n

def f32(v):return struct.unpack('<f',struct.pack('<f',v))[0]
def u32(v):return struct.unpack('<I',struct.pack('<f',v))[0]
def constants(stage,stress=False):
    c=[[0.,0.,0.,1. if stress else 0.] for _ in range(46)]
    if not stress:
        if stage=='vertex':vals={0:[.125,-.125,-.25,0],5:[.75]*4,7:[1,.5,.5,1],45:[.5,.25,1,1]}
        else:vals={0:[.125,.25,.25,.25],5:[.75,.125,.5,1],7:[.375,.125,0,.5],45:[.125,.5,.25,.5]}
        for k,v in vals.items():c[k]=v
    return c
# Tiny independently authored interpreter for the MOV/MUL/ADD-only anchors.
def execute(text,inputs,const):
    regs={('IN',i):list(v) for i,v in enumerate(inputs)}|{('CONST',i):list(v) for i,v in enumerate(const)}
    def operand(s):
        m=re.fullmatch(r'(\w+)\[(\d+)\](?:\.([xyzw]+))?',s.strip());ck(bool(m),'oracle: recognized operand')
        return (m[1],int(m[2])),m[3]
    def read(s):
        key,sw=operand(s);v=regs[key];return [v['xyzw'.index(c)] for c in (sw or 'xyzw')]
    count=0
    for l in text.splitlines():
        l=re.sub(r'^\d+:\s*','',l.strip());m=re.match(r'^(MOV|MUL|ADD)\s+(.+)',l)
        if not m:continue
        count+=1;parts=m[2].split(',');key,mask=operand(parts[0]);src=[read(x) for x in parts[1:]];dst=regs.setdefault(key,[None]*4)
        for ch in (mask or 'xyzw'):
            lane='xyzw'.index(ch);dst[lane]=f32(src[0][lane] if m[1]=='MOV' else src[0][lane]*src[1][lane] if m[1]=='MUL' else src[0][lane]+src[1][lane])
    return regs,count

def uniforms(records,stress=False):
    for u in records:
        own=constants(u['stage'],stress);ck(u['values']==own[:u['uploadedCount']],'uniform: independently chosen values')
        ck(u['bits']==[u32(x) for row in own[:u['uploadedCount']] for x in row],'uniform: binary32 encoding')
        ck(u['uploadedCount']==min(46,u['activeCount']) and u['requiredCount']<=u['activeCount']<=u['declaredCount'],'uniform: finite actual reflection')
        if u['declaredCount']==47:
            ck(u['activeCount']==47 and u['uploadedCount']==46,'uniform: retained47 padding')
            ck(u['paddingUpload']=={'name':u['name'].replace('[0]','[46]'),'index':46,'values':[16,-8,4,-2],'bits':[u32(v) for v in [16,-8,4,-2]]},'uniform: exact poison')
        else:ck(u['paddingUpload'] is None,'uniform: no phantom padding')

def hardware(base,n,source_root,sabotage=False):
    folder='sabotage' if sabotage else 'hardware';h=js(base/folder/'report.json');a=h['acceptance'];ck(h['gitHead']==HEAD and h['trackedChanges']==[],'browser: frozen clean head')
    ck(h['browserErrors']=={'console':[],'page':[],'requests':[]},'browser: zero errors')
    ck(h['status']==('failed' if sabotage else 'passed') and a['status']==h['status'],'browser: expected status')
    ck(not any(a[k] for k in ('guestExecution','productionVirgl','commandRendererWidened')),'browser: bounded claim')
    for d in h['sources']+h['servedFiles']:bind(d,source_root,'/build/' not in d['path'])
    ck(h['browser']['launch']['headless'] is False and 'Apple M4 Max' in a['renderer']['renderer'],'browser: actual hardware identity')
    img=h['failureScreenshot'] if sabotage else h['screenshot'];ck(sha((base/folder/img['path']).read_bytes())==img['sha256'],'browser: screenshot hash')
    for group,browsergroup,key in [('originals','corpus','sha256'),('cases','cases','name'),('pairs','pairs','name')]:
        expected={v[key]:v for v in n[group]};ck(len(a[browsergroup])==len(expected),'parity: complete collection')
        for entry in a[browsergroup]:
            native_entry=expected[entry[key]]
            for k,v in entry.items():
                if k=='path':ck(frozen(native_entry[k])==frozen(v),'parity: duplicated original path exact bytes')
                else:ck(native_entry[k]==v,f'parity: full {group} {k}')
    ck(a['fixtureSha256']==sha((ROOT/'renderer/virgl-shader/tests/bank-cases.json').read_bytes()),'parity: fixture hash')
    nm={x['name']:x['result'] for x in n['cases']};ck(len(a['anchors'])==9,'anchors: count')
    for e in a['anchors']:
        for k in ('name','stage','text','ok'):ck(e[k]==fm[e['name']][k],'anchors: independent source literal')
        ck(e['inputSha256']==sha(e['text'].encode()) and e['result']==nm[e['name']],'anchors: full native identity')
    ck(a['memory']=={'initialBytes':16777216,'observations':19+404+4+2*404*7+32,'bufferIdentityStable':True,'finalBytes':16777216},'stress: exact memory and call accounting')
    ck(a['recovery']=={'rounds':2,'singleConversions':404*8,'pairConversions':404*4},'stress: recovery totals')
    for stage in ('vertex','fragment'):
        text=fm['hardware-maximal-'+stage]['text'];_,count=execute(text,[[.5,.25,0,1]],constants(stage,True));ck(count==179,'stress: actual instruction budget')
        pad=text+'\n'*(16384-len(text));ck(len(pad)==a['stress'][stage+'Bytes']==16384 and sha(pad.encode())==a['stress'][stage+'Sha256'],'stress: exact maximal padded input')
    ck(a['stress']['result']==n['pairs'][3]['result'] and a['stress']['iterations']==32,'stress: maximum pair native parity')
    ck(a['stress']['temporaryIndices']==118 and a['stress']['constantIndices']==46,'stress: all bank indices')
    maxsingle=max((len(json.dumps(x['result'],separators=(',',':')).encode()),x['name']) for x in n['cases'])
    maxpair=max((len(json.dumps(x['result'],separators=(',',':')).encode()),x['name']) for x in n['pairs'])
    ck(a['measuredOutputMaxima']['singleJSON']=={'bytes':maxsingle[0],'name':maxsingle[1]} and a['measuredOutputMaxima']['pairJSON']=={'bytes':maxpair[0],'name':maxpair[1]},'stress: JS compact serialization maxima')
    tfinputs=[[-.5,-.25,.25,1],[.75,.5,-.25,1],[-.125,.875,.5,1]]
    ck([x['mode'] for x in a['transformFeedback']]==['low','high','low','maximal'],'TF: low high low maximal sequence')
    for t in a['transformFeedback']:
        mode=t['mode'];vname='hardware-'+mode+'-vertex';fname='hardware-maximal-fragment' if mode=='maximal' else 'hardware-simple-fragment'
        ck(t['vertexGlslSha256']==sha(nm[vname]['glsl'].encode()) and t['fragmentGlslSha256']==sha(nm[fname]['glsl'].encode()),'TF: stage binding')
        ck(t['inputs']==tfinputs and t['attribute']['values']==tfinputs,'TF: independent inputs');uniforms(t['uniforms'],mode=='maximal')
        expect=[]
        for inp in tfinputs:
            regs,_=execute(fm[vname]['text'],[inp],constants('vertex',mode=='maximal'));expect+=regs[('OUT',0)]+regs[('OUT',1)]
        bits=[u32(v) for v in expect]
        ck(t['expectedFloats']==expect and t['observedFloats']==expect,'TF: independent arithmetic floats')
        for got,want in zip(t['observedBits'],bits):ck(got==want,'TF bits: independent arithmetic')
        ck(t['expectedBits']==bits and t['bytesSha256']==sha(struct.pack('<24I',*bits)),'TF: exact raw bytes digest')
        ck(t['reflection']==[{'name':'gl_Position','size':1,'type':35666},{'name':'vso_g0','size':1,'type':35666}],'TF: actual exact reflection')
        ck(not any(t['programLogs'].values()),'TF: clean compilation and link')
    expected_modes=['low','high'] if sabotage else ['low','high','low','order','maximal'];ck([d['mode'] for d in a['draws']]==expected_modes,'pixels: draw sequence')
    for d in a['draws']:
        mode=d['mode'];name='hardware-'+mode+'-fragment';vs='hardware-maximal-vertex' if mode=='maximal' else 'hardware-simple-vertex';source=fm[name]['text'];fragglsl=nm[name]['glsl'];alias=sabotage and mode=='high'
        ck(d['vertexGlslSha256']==sha(nm[vs]['glsl'].encode()),'pixels: vertex binding')
        if alias:fragglsl=fragglsl.replace('fsconst0[45]','fsconst0[5]');source=source.replace('CONST[45]','CONST[5]')
        ck(d['fragmentGlslSha256']==sha(fragglsl.encode()),'pixels: fragment binding')
        r,_=execute(source,[],constants('fragment',mode=='maximal'));values=r[('OUT',0)];expected=[math.floor(min(1,max(0,x))*255+.5) for x in values]
        pristine,_=execute(fm[name]['text'],[],constants('fragment',mode=='maximal'));oracle=[math.floor(min(1,max(0,x))*255+.5) for x in pristine[('OUT',0)]]
        ck(d['expected']==oracle,'pixels: oracle byte rounding');uniforms(d['uniforms'],mode=='maximal')
        ck(d['width']==d['height']==32 and d['rgbaSha256']==sha(bytes(expected)*1024),'pixels: independent full framebuffer digest')
        coords=[(x,y) for y in range(8,24) for x in range(8,24)];ck([tuple(c['pixel']) for c in d['checks']]==(coords[:1] if alias else coords),'pixels: exact sample grid')
        for c in d['checks']:ck(c['expected']==oracle and c['observed']==expected,'pixel values: independent arithmetic')
        ck(not any(d['programLogs'].values()),'pixels: clean compilation and link')
        ck(d['checkedPixels']==(0 if alias else 256),'pixels: checked count')
        if alias:ck(d['failure']=={'pixel':[8,8],'expected':[64,191,128,191],'observed':[223,96,191,191]},'sabotage: intended first pixel failure')
    if sabotage:
        ck(len(a['omissions'])==1,'sabotage: exactly one mutation');o=a['omissions'][0];original=nm['hardware-high-fragment']['glsl'];ck(original.count('fsconst0[45]')==1,'sabotage: one precise operand')
        ck(o['originalGlslSha256']==sha(original.encode()) and o['servedGlslSha256']==sha(original.replace('fsconst0[45]','fsconst0[5]').encode()),'sabotage: exact generated mutation')
        ck('pixel (8,8): expected [64,191,128,191], observed [223,96,191,191]' in h['failure']['message'],'sabotage: bounded failure text')
    else:ck(a['checkedPixels']==1280 and a['omissions']==[],'pixels: all1280 without mutation')
    return a

try:
    cold=js(ROOT/'evidence/virgl-banks/cold-clone/report.json');clone=Path(cold['clone'])
    ck(cold['gitHead']==cold['cloneHead']==cold['cloneHeadAfter']==HEAD,'cold: exact head')
    ck(cold['status']=='passed' and cold['exitCode']==0 and cold['statusBefore']==cold['statusAfter']=='','cold: clean recorded success')
    ck(git('rev-parse','HEAD',cwd=clone).decode().strip()==HEAD and git('status','--porcelain','--untracked-files=all',cwd=clone)==b'','cold: retained clean clone')
    ck(cold['command']==['make','verify-E6-T12e3'] and cold['harnessSha256']==sha(frozen('tools/virgl-banks/cold.py')),'cold: exact frozen command/harness')
    ck(sha((ROOT/'evidence/virgl-banks/cold-clone/cold.log').read_bytes())==cold['logSha256'],'cold: log hash')
    ck(sha((ROOT/'evidence/virgl-banks/cold-clone/acceptance/receipt.json').read_bytes())==cold['receiptSha256'],'cold: receipt hash')
    for d in cold['acceptanceFiles']:
        raw=bind(d,ROOT/'evidence/virgl-banks/cold-clone');ck(raw==(clone/'target/evidence/virgl-banks-cold'/Path(d['path']).relative_to('acceptance')).read_bytes(),'cold: copied artifact versus retained original')
    outcomes=[]
    for label,base,source_root in [('worker',ROOT/'evidence/virgl-banks/worker',ROOT),('cold',ROOT/'evidence/virgl-banks/cold-clone/acceptance',clone)]:
        receipt=js(base/'receipt.json');ck(receipt['gitHead']==HEAD and receipt['status']=='passed' and receipt['task']=='E6-T12e3','receipt: frozen task identity')
        for d in receipt['sources']:bind(d,source_root,True)
        for d in receipt['records']:bind(d,base)
        for path,h in receipt['compilerSha256'].items():ck(sha(Path(path).read_bytes())==h,'compiler: recorded executable bytes')
        inventory(base);n=native(base,source_root);a=hardware(base,n,source_root);s=hardware(base,n,source_root,True)
        outcomes.append((n,a,s));evidence.append({'run':label,'receiptSha256':sha((base/'receipt.json').read_bytes()),'nativeSha256':sha((base/'native/native-report.json').read_bytes()),'hardwareSha256':sha((base/'hardware/report.json').read_bytes()),'sabotageSha256':sha((base/'sabotage/report.json').read_bytes()),'sources':len(receipt['sources']),'records':len(receipt['records'])})
    for collection in ('originals','cases','pairs','stats','recordedMaxima','streamSha256'):ck(outcomes[0][0][collection]==outcomes[1][0][collection],'cold parity: complete native values')
    ck(outcomes[0][1]==outcomes[1][1],'cold parity: complete deterministic hardware report')
    ck(outcomes[0][2]['draws']==outcomes[1][2]['draws'] and outcomes[0][2]['transformFeedback']==outcomes[1][2]['transformFeedback'],'cold parity: sabotage same exact outputs')
    build=frozen('renderer/virgl-shader/build.sh').decode();ck('-sINITIAL_MEMORY=16777216' in build and '-sALLOW_MEMORY_GROWTH=0' in build and '-sSTACK_SIZE=262144' in build,'limits: unchanged fixed Wasm capacity')
    status='held'
except Exception as e:
    findings.append({'type':type(e).__name__,'message':str(e)});status='failed'
report={'task':'E6-T12e3','scope':'Independent binding/oracle audit; parent handles execution attacks and coverage','status':status,'runtimeHead':HEAD,'predictionsSha256':sha((OUT/'binding-predictions.md').read_bytes()),'scriptSha256':sha(Path(__file__).read_bytes()),'checks':dict(checks),'totalChecks':sum(checks.values()),'evidence':evidence,'findings':findings}
(OUT/'binding-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));raise SystemExit(status!='held')
