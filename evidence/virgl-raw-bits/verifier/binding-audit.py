#!/usr/bin/env python3
"""Independent E4a recorded-data audit. No worker receipt functions are imported."""
from pathlib import Path
import ast, collections, functools, hashlib, json, re, struct, subprocess
ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'evidence/virgl-raw-bits/worker'
OUT=Path(__file__).with_suffix('.json')
FROZEN='347dc59d60fa7e77cec58b14a36bcc8adb88db8d'
HEAD='2484d01736e15b6aee05cef12a3215f283705762'
HELD='f643c50d3379e4e27a1daf1784f67287fe36d562'
counts=collections.Counter(); findings=[]; citations=[]
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_bytes())
def check(ok,where,what):
 counts[what.split(':',1)[0]]+=1
 if not ok:findings.append({'citation':where,'prediction':what})
def eq(a,b,where,what):
 check(type(a)==type(b),where,what+': type')
 if isinstance(a,dict) and isinstance(b,dict):
  check(set(a)==set(b),where,what+': keys')
  for k in set(a)&set(b):eq(a[k],b[k],where+'/'+str(k),what)
 elif isinstance(a,list) and isinstance(b,list):
  check(len(a)==len(b),where,what+': length')
  for i,(x,y) in enumerate(zip(a,b)):eq(x,y,where+'/'+str(i),what)
 else:check(a==b,where,what+': value')
@functools.lru_cache(maxsize=None)
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def binding(item,base,where,head=None):
 p=base/item['path'];raw=p.read_bytes()
 check(sha(raw)==item['sha256'],where,'file digest')
 size=item.get('bytes',item.get('size'))
 if size is not None:check(len(raw)==size,where,'file size')
 if head is not None and '/build/' not in item['path']:
  check(raw==git('show',head+':'+item['path']),where,'git source identity')
 return raw

def report_bindings(p,head=None):
 d=read(p);where=str(p.relative_to(ROOT))
 for k in ('sources','inputs'):
  for i,item in enumerate(d.get(k,[])):binding(item,ROOT,where+f'#/{k}/{i}',head)
 for i,item in enumerate(d.get('records',[])):binding(item,p.parent,where+f'#/records/{i}')
 sources={i['path']:i for i in d.get('sources',[])+d.get('inputs',[])}
 for i,item in enumerate(d.get('servedFiles',[])):
  name=item['path'].lstrip('/')
  if name in ('','fixtures.json'):continue
  binding(dict(item,path=name),ROOT,where+f'#/servedFiles/{i}')
  if name in sources:check(item['sha256']==sources[name]['sha256'],where+f'#/servedFiles/{i}','served-source equality')
 for k in ('screenshot','failureScreenshot','browserCoverage'):
  if k in d:binding(d[k],p.parent,where+'#/'+k)
 return d

r=report_bindings(BASE/'receipt.json',HEAD)
fixed={'receipt.json':'b9f7b38a5c4f3d372ba260a1ba762e31096f36540d2181bb6ccb5b50533f0414','native/native-report.json':'cb39748e8786140e0fd5b0439c1407a302d9df353e5e0ecb9dec48dbd8ca2b7d','hardware/report.json':'088fe0f80137bfe5ff47ce3b419265b6a14e958b201bd050146ea872f5ef2527','sabotage/report.json':'27d4b5f6db245812d911f1c28b8962e6bb92cea77bf77aa0adbb09c47385720a'}
for path,digest in fixed.items():check(sha((BASE/path).read_bytes())==digest,path,'announced digest')
check(r['gitHead']==HEAD and r['heldLegacyHead']==HELD,'receipt.json','head identity')
eq(r['production'],{'capsets':[],'guestRendererImplemented':False,'numCapsets':0,'virglFeature':False},'receipt.json#/production','production disabled')
changed=git('diff','--name-only',FROZEN,HEAD).decode().splitlines()
eq(changed,['tools/verify-virgl-raw-bits.mjs','tools/virgl-raw-bits/regressions.py'],'git diff '+FROZEN+'..'+HEAD,'carryforward boundary')
check(subprocess.run(['git','merge-base','--is-ancestor',FROZEN,HEAD],cwd=ROOT).returncode==0,'git ancestry','carryforward ancestor')
coverage_line="  coveragePaths:['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/raw-bits.mjs'],\n"
new=git('show',HEAD+':tools/verify-virgl-raw-bits.mjs').decode();old=git('show',FROZEN+':tools/verify-virgl-raw-bits.mjs').decode()
check(new.replace(coverage_line,'')==old,'tools/verify-virgl-raw-bits.mjs:11','exact coverage-only repair')
delta=git('diff',FROZEN,HEAD).decode()
check('changed <=' in delta and "'tools/verify-virgl-raw-bits.mjs', 'tools/virgl-raw-bits/regressions.py'" in delta,'tools/virgl-raw-bits/regressions.py:62','regression restricted file allowlist')
up=read(ROOT/'renderer/virgl-shader/UPSTREAM.json')
check(up['revision']=='ca50e008863837e094747a69974dde3ae148aeaa','UPSTREAM.json#/revision','pinned upstream')
for path,digest in up['sha256'].items():
 p=ROOT/'renderer/virgl-shader'/path
 check(sha(p.read_bytes())==digest,str(p.relative_to(ROOT)),'pinned vendor digest')
 check(p.read_bytes()==git('show',HELD+':'+str(p.relative_to(ROOT))),str(p.relative_to(ROOT)),'vendor unchanged')

n=report_bindings(BASE/'native/native-report.json',HEAD)
for item in n['fixtures']:binding(item,ROOT,'native#/fixtures',HEAD)
binding(n['legacyBaseline'],ROOT,'native#/legacyBaseline',HELD)
for item in n['coverage']['sources']:binding(item,ROOT,'native#/coverage/sources',HEAD)
for item in n['coverage']['records']:binding(item,BASE/'native','native#/coverage/records')
for item in n['coverage']['tools']:binding(item,Path('/'),'native#/coverage/tools')
check(sha((BASE/'native/native.log').read_bytes())==n['logSha256'],'native/native.log','native log digest')
check(sha(Path(n['command'][0]).read_bytes())==n['binarySha256'],'native#/command/0','native binary digest')
check(n['binarySha256']==r['compilerSha256']['nativeSanitizer'],'receipt#/compilerSha256','native receipt binding')
check(sha((ROOT/'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())==r['compilerSha256']['wasm'],'receipt#/compilerSha256/wasm','wasm receipt binding')
shared=read(ROOT/'renderer/virgl-shader/tests/raw-bit-cases.json');hw=read(ROOT/'renderer/virgl-shader/tests/raw-bit-hardware.json')
fixture=shared+[{**v,'ok':True} for v in hw['shaders']]
eq([x['name'] for x in fixture],[x['name'] for x in n['cases']],'native#/cases','fixture order')
held=read(ROOT/n['legacyBaseline']['path']);held_o={x['sha256']:x for x in held['originals']}
stream=bytearray(b'VGR1'+struct.pack('<I',19))
check(len(n['originals'])==len(held_o)==19,'native#/originals','original cardinality')
for i,x in enumerate(n['originals']):
 raw=binding(x,ROOT,f'native#/originals/{i}',HELD)
 check(sha(raw)==Path(x['path']).stem,f'native#/originals/{i}','original named content')
 check(x['stage']==('vertex' if raw.startswith(b'VERT\n') else 'fragment'),f'native#/originals/{i}','original stage')
 check(x['ok']==(b'PRECISE' not in raw),f'native#/originals/{i}','unchanged PRECISE refusal')
 eq(x['result'],held_o[x['sha256']]['result'],f'native#/originals/{i}/result','legacy full original result')
 stream+=struct.pack('<III',int(x['stage']=='fragment'),int(x['ok']),len(raw))+raw
stream+=struct.pack('<I',len(fixture))
for i,(f,x) in enumerate(zip(fixture,n['cases'])):
 text=f['text'].encode();name=f['name'].encode();where=f'native#/cases/{i}'
 check(sha(text)==x['inputSha256'] and len(text)==x['bytes'],where,'fixture text identity')
 check(f['stage']==x['stage'] and f['ok']==x['ok'],where,'fixture stage/outcome')
 check(x['result']['ok']==f['ok'],where,'result outcome')
 profile=f.get('profile',f.get('expected',{}).get('profile'))
 if f['ok']:check(x['result']['metadata']['profile']==profile,where,'private backend profile')
 else:check(x['result']['error']['code']==f['expected']['errorCode'],where,'rejection code')
 stream+=struct.pack('<IIIII',int(f['stage']=='fragment'),int(f['ok']),int(profile=='virgl-webgl2-raw-bits-v1'),len(name),len(text))+name+text
names={x['name']:i for i,x in enumerate(fixture)}
stream+=struct.pack('<I',len(n['pairs']))
for i,p in enumerate(n['pairs']):
 vi,fi=names[p['vertexCaseName']],names[p['fragmentCaseName']];name=p['name'].encode();where=f'native#/pairs/{i}'
 check(fixture[vi]['stage']=='vertex' and fixture[fi]['stage']=='fragment',where,'pair stage identity')
 check(sha(fixture[vi]['text'].encode())==p['vertexSha256'] and sha(fixture[fi]['text'].encode())==p['fragmentSha256'],where,'pair input identity')
 check(p['result']['ok']==p['ok'],where,'pair outcome')
 stream+=struct.pack('<IIII',vi,fi,int(p['ok']),len(name))+name
pairnames={x['name']:i for i,x in enumerate(n['pairs'])}
stream+=struct.pack('<IIII',*[names[x] for x in hw['recoverySingles']])+struct.pack('<II',*[pairnames[x] for x in hw['recoveryPairs']])
check(stream==(BASE/'native/native-input.bin').read_bytes(),'native/native-input.bin','complete reconstructed stream')
check(sha(stream)==n['streamSha256'],'native#/streamSha256','stream digest')
seen=collections.Counter();seeds=[]
for line_no,line in enumerate((BASE/'native/native.log').read_text().splitlines(),1):
 m=re.fullmatch(r'(ORIGINAL|CASE|PAIR) ([0-9]+) (.+)',line)
 if m:
  kind,num,raw=m.groups();arr=n[{'ORIGINAL':'originals','CASE':'cases','PAIR':'pairs'}[kind]];x=arr[int(num)];seen[kind]+=1
  eq(json.loads(raw),x['result'],f'native/native.log:{line_no}','native exact logged result')
  check(len(raw.encode())==x['resultBytes'] and sha(raw.encode())==x['resultSha256'],f'native/native.log:{line_no}','native raw result digest')
 elif line.startswith('LAYOUT '):eq(json.loads(line[7:]),n['layout'],f'native/native.log:{line_no}','layout log binding')
 elif line.startswith('STATS '):eq(json.loads(line[6:]),n['stats'],f'native/native.log:{line_no}','stats log binding')
 elif line.startswith('SEED '):seeds.append(line.split()[1])
 else:check(False,f'native/native.log:{line_no}','unexpected native log output')
eq(dict(seen),{'ORIGINAL':19,'CASE':279,'PAIR':22},'native/native.log','complete log cardinality')
eq(seeds,n['seeds'],'native/native.log','seed identity')

h=report_bindings(BASE/'hardware/report.json',HEAD);s=report_bindings(BASE/'sabotage/report.json',HEAD)
cases={x['name']:x for x in n['cases']};pairs={x['name']:x for x in n['pairs']};originals={x['sha256']:x for x in n['originals']}
for label,report in [('hardware',h),('sabotage',s)]:
 a=report['acceptance'];where=label+'/report.json'
 check(report['gitHead']==HEAD and report['trackedChanges']==[],where,'frozen browser head')
 eq(report['browserErrors'],{'console':[],'page':[],'requests':[]},where+'#/browserErrors','clean browser')
 check(report['browser']['launch']['headless'] is False and report['browser']['gpu']['featureStatus'][report['browser']['webglFeature']]=='enabled',where+'#/browser','hardware GPU identity')
 for k in ['guestExecution','productionVirgl']:check(a[k] is False,where+'#/acceptance/'+k,'isolated hardware boundary')
 for k in ['guestConstantTransportUnchanged','hostUniformInjectionOnly']:check(a[k] is True,where+'#/acceptance/'+k,'finite wire boundary')
 for section in ['cases','anchors']:
  for i,x in enumerate(a[section]):
   eq(x['result'],cases[x['name']]['result'],where+f'#/acceptance/{section}/{i}/result','native-Wasm full single parity')
   check(x['inputSha256']==cases[x['name']]['inputSha256'],where+f'#/acceptance/{section}/{i}','native-Wasm single input')
 for section in ['pairs','rejectionPairs']:
  for i,x in enumerate(a[section]):
   eq(x['result'],pairs[x['name']]['result'],where+f'#/acceptance/{section}/{i}/result','native-Wasm full pair parity')
   check(x['vertexSha256']==pairs[x['name']]['vertexSha256'] and x['fragmentSha256']==pairs[x['name']]['fragmentSha256'],where+f'#/acceptance/{section}/{i}','native-Wasm pair input')
 for i,x in enumerate(a['corpus']):eq(x['result'],originals[x['sha256']]['result'],where+f'#/acceptance/corpus/{i}','native-Wasm original parity')
 for item in [a['caseFixture'],a['hardwareFixture']]:binding(item,ROOT,where+'#/acceptance/fixture',HEAD)
 cov=read(BASE/label/report['browserCoverage']['path'])
 eq([x['source'] for x in cov['scripts']],['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/raw-bits.mjs'],label+'/browser-coverage.json','coverage source set')
 for c in cov['scripts']:check(c['sha256']==sha((ROOT/c['source']).read_bytes()),label+'/browser-coverage.json','coverage source binding')

# This independent integer oracle is authored from the task operations and fixture TGSI.
M=0xffffffff
def oracle(op,a,b):
 if op=='mov':return a[:]
 if op in ('or','maximal'):return [x|y for x,y in zip(a,b)]
 if op=='and':return [x&y for x,y in zip(a,b)]
 if op=='not':return [x^M for x in a]
 if op=='shl':return [(x<<(y%32))&M for x,y in zip(a,b)]
 if op=='ushr':return [x>>(y%32) for x,y in zip(a,b)]
 if op=='alias':return [((a[0]^M)<<(b[1]%32))&M,((a[1]^M)<<(b[0]%32))&M,a[2]|b[3],a[3]^M]
 if op=='immediate':return [x|y for x,y in zip(a,[0xffffffff,0x7fc00001,0x7f800000,1])]
 raise ValueError(op)
a=h['acceptance'];fixture_vectors={x['name']:x for x in hw['vectors']}
for stage,key in [('vertex','vertexProbes'),('fragment','fragmentProbes')]:
 for pi,p in enumerate(a[key]):
  for st in ['vertex','fragment']:
   check(p[st+'GlslSha256']==sha(cases[p[st]]['result']['glsl'].encode()),f'hardware#/acceptance/{key}/{pi}','executed GLSL identity')
  for vi,v in enumerate(p['vectors']):
   where=f'hardware#/acceptance/{key}/{pi}/vectors/{vi}';f=fixture_vectors[v['name']]
   eq(v['a'],f['a'],where+'/a','dynamic operand identity');eq(v['b'],f['b'],where+'/b','dynamic operand identity')
   want=oracle(p['oracle'],f['a'],f['b'])
   eq(v['expectedWords'],want,where+'/expectedWords','independent raw oracle');eq(v['observedWords'],want,where+'/observedWords','independent raw oracle')
   upload=v['upload'];check(upload['wordCount']==184 and len(upload['words'])==184,where+'/upload','host upload extent')
   eq(upload['words'][:4],f['a'],where+'/upload/words/0','actual host upload');eq(upload['words'][180:184],f['b'],where+'/upload/words/180','actual host upload')
   eq(upload['observedA'],f['a'],where+'/upload/observedA','observed host upload');eq(upload['observedB'],f['b'],where+'/upload/observedB','observed host upload')
   if stage=='vertex':
    eq([c['selector'] for c in v['captures']],[0,8,16,24],where+'/captures','four-byte coverage')
    for ci,c in enumerate(v['captures']):
     w=where+'/captures/'+str(ci);byte=[(x>>c['selector'])&255 for x in want];bits=[0,0,0,0x3f800000]+[0x3f000000|(x<<15) for x in byte]
     eq(c['expectedBytes'],byte,w+'/expectedBytes','independent carrier oracle');eq(c['decodedBytes'],byte,w+'/decodedBytes','independent carrier oracle')
     eq(c['observedBits'],bits,w+'/observedBits','independent carrier bits')
     raw=struct.pack('<8I',*bits);check(bytes(c['rawBytes'])==raw,w+'/rawBytes','actual TF byte identity');check(sha(raw)==c['bytesSha256'],w+'/bytesSha256','TF capture digest')
   else:
    eq([d['selector'] for d in v['draws']],list(range(32)),where+'/draws','all bitplanes coverage')
    raw=bytearray()
    for di,d in enumerate(v['draws']):
     want_bytes=[255*((x>>di)&1) for x in want];eq(d['expectedBytes'],want_bytes,where+f'/draws/{di}/expectedBytes','independent bitplane oracle');eq(d['observedBytes'],want_bytes,where+f'/draws/{di}/observedBytes','independent bitplane oracle');raw+=bytes(d['observedBytes'])
    check(sha(raw)==v['bitPlaneBytesSha256'],where+'/bitPlaneBytesSha256','bitplane digest')
for i,d in enumerate(a['pairDraws']):
 raw=bytes(d['rawBytes']);where=f'hardware#/acceptance/pairDraws/{i}'
 check(sha(raw)==d['bytesSha256'],where+'/bytesSha256','pair full framebuffer digest')
 for c in d['checks']:
  x,y=c['pixel'];eq(list(raw[(y*32+x)*4:(y*32+x)*4+4]),c['observed'],where+f'/pixel/{x}/{y}','pair actual pixel binding');eq(c['observed'],c['expected'],where+f'/pixel/{x}/{y}','pair pixel assertion')
 for st in ['vertex','fragment']:check(d[st+'GlslSha256']==sha(pairs[d['name']]['result'][st]['glsl'].encode()),where,'linked pair GLSL identity')
eq(a['objects']['created'],a['objects']['deleted'],'hardware#/acceptance/objects','actual object cleanup')
check(a['objects']['live']==0,'hardware#/acceptance/objects/live','actual object cleanup')
check(a['checkedWords']==r['rawWords']==480,'hardware#/acceptance/checkedWords','raw oracle cardinality')
# Sabotage must change the actual compiled shift GLSL, not the recorded original translator result.
om=s['acceptance']['omissions'][0];original=cases['raw-shl-vertex']['result']['glsl']
mutated=re.sub(r'(vsconst0\[45\]\.[xyzw] & )31u',r'\g<1>30u',original)
check(sha(original.encode())==om['originalGlslSha256'] and sha(mutated.encode())==om['servedGlslSha256'],'sabotage#/acceptance/omissions/0','exact served sabotage binding')
check('independent vertex byte0' in s['failure']['message'],'sabotage#/failure/message','actual sabotage falsification')

# Historical legacy results and all freshly recorded regressions retain full identities.
reg=report_bindings(BASE/'regression/receipt.json',HEAD)
con=report_bindings(BASE/'constant-regression/hardware/report.json',HEAD)
asy=report_bindings(BASE/'async-regression/report.json',HEAD)
for name,d in [('banks',reg),('constants',con),('async',asy)]:check(d['gitHead']==FROZEN==r['regressions']['recordedHeads'][name],name+'#/gitHead','exact carried regression head')
for label,d in [('constants',con),('async',asy)]:
 for item in d['sources']:
  if item['path'].startswith(('renderer/virgl-command/','tools/virgl-command/','tools/virgl-constants/')) or item['path'] in ('tools/verify-virgl-constants.mjs','tools/verify-virgl-async-jobs.mjs'):
   check((ROOT/item['path']).read_bytes()==git('show',HELD+':'+item['path']),label+'#/sources/'+item['path'],'legacy runtime-oracle unchanged')
held_cases={x['name']:x for x in held['cases']}
for i,x in enumerate(con['acceptance']['shaderFixtures']):eq(x['result'],held_cases[x['name']]['result'],f'constant-regression#/acceptance/shaderFixtures/{i}','legacy full constant parity')
for i,x in enumerate(con['acceptance']['corpus']):eq(x['result'],held_o[x['sha256']]['result'],f'constant-regression#/acceptance/corpus/{i}','legacy constant corpus parity')
for i,t in enumerate(asy['browserResult']['result']['original']['translations']):eq({'ok':True,'glsl':t['glsl'],'metadata':t['metadata']},held_o[sha(t['text'].encode())]['result'],f'async-regression#/translations/{i}','legacy async translation parity')
held_asy=read(ROOT/'evidence/virgl-constants/worker/regression/hardware/report.json')
for field in ['inputs','fixtureTransport']:eq(asy[field],held_asy[field],'async-regression#/'+field,'unchanged captured command fixture')
for i,frame in enumerate(asy['browserResult']['result']['original']['frames']):check(frame['readback']['rgbaSha256']==held_asy['browserResult']['result']['original']['frames'][i]['readback']['rgbaSha256'],f'async-regression#/frames/{i}','legacy complete async pixels')
bn=report_bindings(BASE/'regression/native/native-report.json',HEAD);bh=report_bindings(BASE/'regression/hardware/report.json',HEAD)
bcases={x['name']:x for x in bn['cases']};bpairs={x['name']:x for x in bn['pairs']}
for i,x in enumerate(bh['acceptance']['cases']):eq(x['result'],bcases[x['name']]['result'],f'regression/hardware#/cases/{i}','bank native-Wasm complete parity')
for i,x in enumerate(bh['acceptance']['pairs']):eq(x['result'],bpairs[x['name']]['result'],f'regression/hardware#/pairs/{i}','bank native-Wasm complete pair parity')
for i,x in enumerate(bn['originals']):eq(x['result'],held_o[x['sha256']]['result'],f'regression/native#/originals/{i}','legacy bank corpus parity')
for p in BASE.rglob('receipt.json'):
 if p==BASE/'receipt.json' or p==BASE/'regression/receipt.json':continue
 d=read(p)
 for i,item in enumerate(d.get('records',[])):binding(item,p.parent,str(p.relative_to(BASE))+f'#/records/{i}')
# Verify the completed clean-clone proof and every copied artifact independently.
COLD=ROOT/'evidence/virgl-raw-bits/cold-clone';cr=read(COLD/'report.json');clone=Path(cr['clone'])
check(sha((COLD/'report.json').read_bytes())=='3b904909a23f599385cc5596163eea65878942af757c31a5b669068eaf54f0c4','cold-clone/report.json','announced cold digest')
check(cr['receiptSha256']=='96fae8d6ea6011d7490eb59cae60c1f68c724e832aac9dfcf1c7481dd9c8f915'==sha((COLD/'acceptance/receipt.json').read_bytes()),'cold-clone#/receiptSha256','cold receipt digest')
check(cr['gitHead']==cr['cloneHead']==cr['cloneHeadAfter']==HEAD,'cold-clone#/cloneHead','cold exact head')
check(cr['status']=='passed' and cr['exitCode']==0 and cr['statusBefore']==cr['statusAfter']=='','cold-clone#/statusAfter','cold clean success')
check(subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone).decode().strip()==HEAD,'retained clone HEAD','retained cold head')
check(subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)==b'','retained clone status','retained cold clean')
check(sha((COLD/'cold.log').read_bytes())==cr['logSha256'],'cold-clone/cold.log','cold log digest')
check(sha((ROOT/'tools/virgl-raw-bits/cold.py').read_bytes())==cr['harnessSha256'],'cold-clone#/harnessSha256','cold harness identity')
check((ROOT/'tools/virgl-raw-bits/cold.py').read_bytes()==git('show',HEAD+':tools/virgl-raw-bits/cold.py'),'tools/virgl-raw-bits/cold.py','cold harness Git identity')
actual_files=sorted(str(p.relative_to(COLD)) for p in (COLD/'acceptance').rglob('*') if p.is_file())
eq([v['path'] for v in cr['acceptanceFiles']],actual_files,'cold-clone#/acceptanceFiles','complete copied file set')
for i,item in enumerate(cr['acceptanceFiles']):
 raw=binding(item,COLD,f'cold-clone#/acceptanceFiles/{i}')
 relative=Path(item['path']).relative_to('acceptance')
 check(raw==(clone/'target/evidence/virgl-raw-bits-cold'/relative).read_bytes(),f'cold-clone#/acceptanceFiles/{i}','exact copied clone artifact')
# Inspect and exercise only the scrub block with synthetic poison names, never executing the harness.
tree=ast.parse((ROOT/'tools/virgl-raw-bits/cold.py').read_text());main=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='main')
first=next(i for i,x in enumerate(main.body) if isinstance(x,ast.Assign) and any(isinstance(y,ast.Name) and y.id=='prefixes' for y in x.targets))
last=next(i for i,x in enumerate(main.body) if isinstance(x,ast.For) and isinstance(x.target,ast.Name) and x.target.id=='key')
block=ast.Module(body=main.body[first:last+1],type_ignores=[])
poisons=['CARGO_TARGET_DIR','CARGO_HOME','RUSTFLAGS','RUST_LOG','RUSTDOCFLAGS','VIRGL_RAW_BITS_EVIDENCE_DIR','npm_config_prefix','NPM_CONFIG_CACHE','GIT_DIR','EMCC_DEBUG','NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','CHROME','CC','CXX','CFLAGS','CXXFLAGS','CPPFLAGS','LDFLAGS','AR','RANLIB','EMCC','EMSDK','EMSDK_NODE','EMSDK_PYTHON','EM_CONFIG','EM_CACHE','MAKEFLAGS','MFLAGS','MAKEOVERRIDES','BASH_ENV','ENV']
sandbox={'env':{**{k:'poison' for k in poisons},'PATH':'retained','HOME':'retained'}}
sandbox['__builtins__']={'sorted':sorted}
exec(compile(block,'cold-scrub-block','exec'),sandbox,sandbox)
for key in poisons:check(key not in sandbox['env'],'tools/virgl-raw-bits/cold.py:'+str(main.body[first].lineno)+'/'+key,'cold environment scrub')
eq(sandbox['env'],{'PATH':'retained','HOME':'retained'},'cold scrub result','cold essential environment retained')
for node in ast.walk(main):
 if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='Popen':
  check(any(k.arg=='env' and isinstance(k.value,ast.Name) and k.value.id=='env' for k in node.keywords),'tools/virgl-raw-bits/cold.py:'+str(node.lineno),'scrubbed env reaches acceptance')

ca=COLD/'acceptance';coldreceipt=report_bindings(ca/'receipt.json',HEAD)
check(coldreceipt['compilerSha256']['wasm']==r['compilerSha256']['wasm'],'cold receipt#/compilerSha256/wasm','deterministic Wasm identity')
cn=report_bindings(ca/'native/native-report.json',HEAD);ch=report_bindings(ca/'hardware/report.json',HEAD);cs=report_bindings(ca/'sabotage/report.json',HEAD)
for section in ['originals','cases','pairs']:
 eq(cn[section],n[section],'cold/native#/'+section,'cold-worker complete native equality')
for section in ['cases','anchors','pairs','rejectionPairs','corpus','vertexProbes','fragmentProbes','pairDraws','orientation','literalWitnesses','stress','objects','limits']:
 eq(ch['acceptance'][section],h['acceptance'][section],'cold/hardware#/acceptance/'+section,'cold-worker full hardware equality')
for section in ['corpus','cases','anchors','pairs','rejectionPairs','vertexProbes','fragmentProbes','omissions']:
 eq(cs['acceptance'][section],s['acceptance'][section],'cold/sabotage#/acceptance/'+section,'cold-worker full sabotage equality')
check(sha(Path(cn['command'][0]).read_bytes())==cn['binarySha256']==coldreceipt['compilerSha256']['nativeSanitizer'],'cold/native#/command/0','cold native binary identity')
for reportpath in ca.rglob('report.json'):
 d=report_bindings(reportpath,HEAD)
 if 'gitHead' in d:check(d['gitHead']==HEAD,str(reportpath.relative_to(COLD))+'#/gitHead','cold all recordings exact head')
for receiptpath in ca.rglob('receipt.json'):
 if receiptpath==ca/'receipt.json':continue
 d=report_bindings(receiptpath,HEAD)
 if 'gitHead' in d:check(d['gitHead']==HEAD,str(receiptpath.relative_to(COLD))+'#/gitHead','cold all receipts exact head')
report={'schema':'wasm-vm-raw-bits-independent-binding-audit-v1','status':'passed' if not findings else 'failed','task':'E6-T12e4a','workerReceipt':{'path':str((BASE/'receipt.json').relative_to(ROOT)),'sha256':sha((BASE/'receipt.json').read_bytes())},'frozenRuntime':FROZEN,'finalHarness':HEAD,'heldLegacy':HELD,'checks':sum(counts.values()),'checkDefinition':'Each scalar type/value, collection shape, byte comparison, digest or explicit invariant counts as one assertion; this is not a count of independent test cases.','coldClone':{'path':str((COLD/'report.json').relative_to(ROOT)),'sha256':sha((COLD/'report.json').read_bytes()),'receiptSha256':cr['receiptSha256'],'copiedArtifacts':len(cr['acceptanceFiles']),'retainedCheckout':str(clone)},'checksByCategory':dict(sorted(counts.items())),'findings':findings,'scope':['Worker plus finalized cold-clone proof; mutable cold files were not opened before parent confirmation.','Every comparison recursively checks complete GLSL, metadata and structured errors; no worker verification function imported.','Raw integer oracle, TF byte carriers, bitplane bytes and framebuffer hashes independently recomputed.','No runtime, harness, task or status changes and no commits.'],'carryforward':{'files':changed,'patchSha256':sha(delta.encode()),'assessment':'The two-file patch adds JS coverage and permits earlier regression heads only across the named two harness files. Source and artifact identities above are checked independently against the final harness.'},'auditorSourceSha256':sha(Path(__file__).read_bytes())}
OUT.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'checks':report['checks'],'findings':findings[:10],'path':str(OUT),'sha256':sha(OUT.read_bytes())},indent=2))
