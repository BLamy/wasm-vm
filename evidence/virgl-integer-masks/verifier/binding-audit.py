"""Independent evidence binding; no worker receipt functions are imported."""
from pathlib import Path
import ast,collections,copy,functools,hashlib,json,re,struct,subprocess,sys
R=Path(__file__).resolve().parents[3];O=Path(__file__).resolve().parent;W=R/'evidence/virgl-integer-masks/worker'
HEAD='1e8f2586a125efd91460db3a7e11049855acb495';HELD='98314e2ddb082cf372a46ab90871b7cfdb77d587'
checks=collections.Counter();records=0

def sha(x):return hashlib.sha256(x).hexdigest()
def read(p):return json.loads(p.read_bytes())
def check(x,citation,category):
 checks[category]+=1
 if not x:raise AssertionError((citation,category))
@functools.lru_cache(None)
def git(*args):return subprocess.check_output(['git',*args],cwd=R)
def bind(e,base,citation,frozen=False):
 global records
 p=base/e['path'];b=p.read_bytes();check(sha(b)==e['sha256'],citation,'file digest');size=e.get('bytes',e.get('size'))
 if size is not None:check(len(b)==size,citation,'file size')
 if frozen and not Path(e['path']).is_absolute() and '/build/' not in e['path']:check(b==git('show',HEAD+':'+e['path']),citation,'frozen source bytes')
 records+=1;return b
def report(p):
 d=read(p);c=str(p.relative_to(R))
 if not isinstance(d,dict):return d
 for key in ['sources','inputs']:
  for i,e in enumerate(d.get(key,[])):
   if isinstance(e,dict) and 'path' in e and 'sha256' in e:bind(e,R,c+f'#/{key}/{i}',True)
 for i,e in enumerate(d.get('records',[])):bind(e,p.parent,c+f'#/records/{i}')
 for key in ['screenshot','failureScreenshot','browserCoverage']:
  if key in d:bind(d[key],p.parent,c+'#/'+key)
 for i,e in enumerate(d.get('servedFiles',[])):
  path=e['path'].lstrip('/')
  if path and path!='fixtures.json':bind(dict(e,path=path),R,c+f'#/servedFiles/{i}')
 if 'gitHead' in d:check(d['gitHead']==HEAD,c+'#/gitHead','exact recording head')
 return d
receipt=report(W/'receipt.json');check(sha((W/'receipt.json').read_bytes())=='e4cf1d4710acb1c954be20182b6fd9e74db15aca318b01b50eafb59f612b2320','worker/receipt.json','announced receipt')
check(receipt['status']=='passed' and receipt['heldRawHead']==HELD,'worker/receipt.json','receipt identity')
check(receipt['production']=={'capsets':[],'guestRendererImplemented':False,'numCapsets':0,'virglFeature':False},'worker/receipt.json#/production','production disabled')
check(read(R/'docs/gpu-3d-contract.json')['production']==receipt['production'],'contract#/production','production disabled')
for p in W.rglob('report.json'):report(p)
for p in W.rglob('receipt.json'):
 if p!=W/'receipt.json':report(p)
n=read(W/'native/native-report.json');held=read(R/n['rawBaseline']['path']);bind(n['rawBaseline'],R,'native#/rawBaseline');bind(n['legacyBaseline'],R,'native#/legacyBaseline')
for key in ['sources','fixtures','rawFixtures']:
 for e in n[key]:bind(e,R,'native#/'+key,True)
for e in n['coverage']['sources']:bind(e,R,'native#/coverage/sources',True)
for e in n['coverage']['records']:bind(e,W/'native','native#/coverage/records')
for e in n['coverage']['tools']:bind(e,Path('/'),'native#/coverage/tools')
check(sha(Path(n['command'][0]).read_bytes())==n['binarySha256']==receipt['compilerSha256']['nativeSanitizer'],'native compiler','native binary digest')
check(sha((R/'renderer/virgl-shader/build/wasm/virgl-shader.wasm').read_bytes())==receipt['compilerSha256']['wasm'],'Wasm compiler','Wasm binary digest')
for section,prior in [('rawCases','cases'),('rawPairs','pairs'),('originals','originals')]:
 check(len(n[section])==len(held[prior]),'native#/'+section,'held cardinality')
 for i,(x,y) in enumerate(zip(n[section],held[prior])):check(x['result']==y['result'],f'native#/{section}/{i}','full held result')
# Decode recorded binary stream independently and bind every index/text/expectation.
entries=copy.deepcopy(n['rawCases'])+copy.deepcopy(n['cases']);pairs=copy.deepcopy(n['rawPairs'])+copy.deepcopy(n['pairs'])
for x in entries[:len(n['rawCases'])]:x['name']='held::'+x['name']
for p in pairs[:len(n['rawPairs'])]:
 for k in ['name','vertexCaseName','fragmentCaseName']:p[k]='held::'+p[k]
data=(W/'native/native-input.bin').read_bytes();check(sha(data)==n['streamSha256'],'native/native-input.bin','native stream digest');offset=0

def take(count):
 global offset
 b=data[offset:offset+count];offset+=count;check(len(b)==count,f'native stream:{offset}','bounded stream read');return b
def u32():return struct.unpack('<I',take(4))[0]
check(take(4)==b'VGI2' and u32()==19,'native stream header','stream identity')
for i,x in enumerate(n['originals']):
 stage,ok,length=u32(),u32(),u32();b=take(length);check(stage==int(x['stage']=='fragment') and ok==int(x['ok']) and b==(R/x['path']).read_bytes(),f'native stream original{i}','original stream binding')
check(u32()==len(entries)==705,'native case count','stream cardinality')
profiles={None:0,'virgl-webgl2-straight-line-v5':0,'virgl-webgl2-raw-bits-v1':1,'virgl-webgl2-raw-bits-v2':2}
for i,x in enumerate(entries):
 stage,ok,profile,nl,length=[u32() for _ in range(5)];name,text=take(nl).decode(),take(length)
 check(name==x['name'] and text==x['text'].encode() and sha(text)==x['inputSha256'] and length==x['bytes'],f'native stream case{i}','case stream binding')
 check(stage==int(x['stage']=='fragment') and ok==int(x['ok']) and profile==profiles[x.get('profile')],f'native stream case{i}','case outcome binding')
check(u32()==len(pairs)==47,'native pair count','stream cardinality')
for i,p in enumerate(pairs):
 vi,fi,ok,nl=[u32() for _ in range(4)];name=take(nl).decode();check(name==p['name'] and entries[vi]['name']==p['vertexCaseName'] and entries[fi]['name']==p['fragmentCaseName'] and ok==int(p['ok']),f'native stream pair{i}','pair stream binding')
anchors=[u32() for _ in range(6)];pair_anchors=[u32() for _ in range(4)]
check([entries[i]['name'] for i in anchors]==n['recoverySingles'] and [pairs[i]['name'] for i in pair_anchors]==n['recoveryPairs'],'native anchors','recovery identity');check(offset==len(data),'native end','no trailing stream')
seen=collections.Counter();seeds=[]
check(sha((W/'native/native.log').read_bytes())==n['logSha256'],'native/native.log','native log digest')
for line_number,line in enumerate((W/'native/native.log').read_text().splitlines(),1):
 m=re.fullmatch(r'(ORIGINAL|CASE|PAIR) (\d+) (.+)',line)
 if m:
  kind,index,raw=m.groups();x={'ORIGINAL':n['originals'],'CASE':entries,'PAIR':pairs}[kind][int(index)];seen[kind]+=1
  check(json.loads(raw)==x['result'] and sha(raw.encode())==x['resultSha256'] and len(raw.encode())==x['resultBytes'],f'native/native.log:{line_number}','complete logged result')
 elif line.startswith('LAYOUT '):check(json.loads(line[7:])==n['layout'],f'native/native.log:{line_number}','layout log')
 elif line.startswith('STATS '):check(json.loads(line[6:])==n['stats'],f'native/native.log:{line_number}','stats log')
 elif line.startswith('SEED '):seeds.append(line.split()[1])
 else:check(False,f'native/native.log:{line_number}','unexpected log output')
check(seen=={'ORIGINAL':19,'CASE':705,'PAIR':47} and seeds==n['seeds'],'native/native.log','complete transcript')
# Fixture expectations come from text/digest-bound source, never translated GLSL.
fixture=read(R/'renderer/virgl-shader/tests/integer-mask-cases.json');hardware=read(R/'renderer/virgl-shader/tests/integer-mask-hardware.json')
for i,(x,f) in enumerate(zip(n['cases'],fixture+[dict(x,ok=True) for x in hardware['shaders']])):
 check(x['name']==f['name'] and x['text']==f['text'] and x['ok']==f['ok']==x['result']['ok'],f'native#/cases/{i}','literal fixture outcome')
 if x['ok']:check(x['result']['metadata']['profile']==f.get('profile',f.get('expected',{}).get('profile')),f'native#/cases/{i}','literal profile')
 else:check(x['result']['error']['code']==f['expected']['errorCode'],f'native#/cases/{i}','literal rejection')
cases={x['name']:x for x in n['cases']};pairs_by_name={x['name']:x for x in n['pairs']};originals={x['sha256']:x for x in n['originals']}
for dirname in ['hardware','sabotage-signed-compare','sabotage-all-ones-mask','sabotage-ucmp-selection']:
 b=read(W/dirname/'report.json');a=b['acceptance'];check(b['trackedChanges']==[],dirname,'frozen browser sources');check(b['browserErrors']=={'console':[],'page':[],'requests':[]},dirname,'zero browser errors')
 check(b['browser']['launch']['headless'] is False and b['browser']['gpu']['featureStatus'][b['browser']['webglFeature']]=='enabled',dirname,'actual GPU browser')
 for key in ['cases','anchors']:
  for x in a[key]:check(x['result']==cases[x['name']]['result'] and x['inputSha256']==cases[x['name']]['inputSha256'],dirname+'#/'+key+'/'+x['name'],'complete native-Wasm parity')
 for key in ['pairs','rejectionPairs']:
  for x in a[key]:check(x['result']==pairs_by_name[x['name']]['result'],dirname+'#/'+key+'/'+x['name'],'complete pair parity')
 for x in a['corpus']:check(x['result']==originals[x['sha256']]['result'],dirname+'#/corpus/'+x['sha256'],'complete original parity')
 for k,v in [('guestExecution',False),('productionVirgl',False),('guestConstantTransportUnchanged',True),('hostUniformInjectionOnly',True)]:check(a[k] is v,dirname+'#/'+k,'scope limits')
 cov=read(W/dirname/b['browserCoverage']['path']);check([c['source'] for c in cov['scripts']]==['renderer/virgl-shader/index.mjs','renderer/virgl-shader/tests/integer-masks.mjs'],dirname+'#/coverage','browser coverage source set')
 for c in cov['scripts']:check(c['sha256']==sha((R/c['source']).read_bytes()),dirname+'#/coverage','browser coverage identity')
# Exact migration is limited to the three named inputs; each old byte string is promoted.
for migration in receipt['regressions']['migrations']:
 old=next(x for x in json.loads(git('show',HELD+':'+migration['source'])) if x['name']==migration['oldName']);new=next(x for x in read(R/migration['source']) if x['name']==migration['replacementName']);promoted=cases[migration['promotedCase']]
 check(old['text'].replace('UADD','UMUL')==new['text'] and old['text']==promoted['text'],migration['source'],'explicit migration preserves exact old input')
 check(sha(old['text'].encode())==migration['oldInputSha256'] and sha(new['text'].encode())==migration['replacementInputSha256'],migration['source'],'migration digest')
raw=read(W/'raw-regression/native/native-report.json')
for section in ['cases','pairs','originals']:
 for x,y in zip(raw[section],held[section]):check(x['result']==y['result'],'raw-regression/native#/'+section,'complete E4a regression result')
up=read(R/'renderer/virgl-shader/UPSTREAM.json')
for path,digest in up['sha256'].items():
 p=R/'renderer/virgl-shader'/path;check(sha(p.read_bytes())==digest and p.read_bytes()==git('show',HELD+':'+str(p.relative_to(R))),str(p.relative_to(R)),'pinned vendor unchanged')
result=dict(status='passed',head=HEAD,held=HELD,workerReceiptSha256=sha((W/'receipt.json').read_bytes()),recordBindings=records,checks=sum(checks.values()),checksByCategory=dict(checks),nativeCases=len(entries),nativePairs=len(pairs),nativeLogLines=sum(seen.values()),noWorkerVerifierImported=True)
if '--cold' in sys.argv:
 C=R/'evidence/virgl-integer-masks/cold-clone';cr=read(C/'report.json');clone=Path(cr['clone'])
 check(cr['gitHead']==cr['cloneHead']==cr['cloneHeadAfter']==HEAD and cr['status']=='passed' and cr['exitCode']==0 and cr['statusBefore']==cr['statusAfter']=='','cold/report.json','pristine exact head')
 check(subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone).decode().strip()==HEAD and subprocess.check_output(['git','status','--porcelain','--untracked-files=all'],cwd=clone)==b'','retained cold clone','retained pristine clone')
 check(sha((C/'cold.log').read_bytes())==cr['logSha256'],'cold/cold.log','cold log digest')
 check(sha((C/'acceptance/receipt.json').read_bytes())==cr['receiptSha256'],'cold/acceptance/receipt.json','cold receipt digest')
 check(sha((R/'tools/virgl-integer-masks/cold.py').read_bytes())==cr['harnessSha256'],'cold harness','cold harness digest')
 actual=sorted(str(p.relative_to(C)) for p in (C/'acceptance').rglob('*') if p.is_file());check([e['path'] for e in cr['acceptanceFiles']]==actual,'cold copied list','complete copied file set')
 for e in cr['acceptanceFiles']:
  b=bind(e,C,'cold copied '+e['path']);relative=Path(e['path']).relative_to('acceptance');check(b==(clone/'target/evidence/virgl-integer-masks-cold'/relative).read_bytes(),e['path'],'copied clone bytes')
 for p in (C/'acceptance').rglob('report.json'):report(p)
 for p in (C/'acceptance').rglob('receipt.json'):report(p)
 cn=read(C/'acceptance/native/native-report.json');ch=read(C/'acceptance/hardware/report.json');wh=read(W/'hardware/report.json')
 for key in ['cases','pairs','rawCases','rawPairs','originals','stats','recordedMaxima','layout']:check(cn[key]==n[key],'cold native#/'+key,'full cold native equality')
 for key in ['cases','anchors','pairs','rejectionPairs','corpus','vertexProbes','fragmentProbes','pairDraws','orientation','finiteSelections','literalWitnesses','stress','allocationPressure','objects','limits']:check(ch['acceptance'][key]==wh['acceptance'][key],'cold hardware#/'+key,'full cold hardware equality')
 check(read(C/'acceptance/receipt.json')['compilerSha256']['wasm']==receipt['compilerSha256']['wasm'],'cold Wasm','deterministic Wasm hash')
 check(sha(Path(cn['command'][0]).read_bytes())==cn['binarySha256'],'cold native binary','native binary digest')
 # Execute only parsed environment scrub statements with synthetic poison names.
 tree=ast.parse((R/'tools/virgl-integer-masks/cold.py').read_text());main=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='main')
 start=next(i for i,x in enumerate(main.body) if isinstance(x,ast.Assign) and any(isinstance(y,ast.Name) and y.id=='prefixes' for y in x.targets));end=next(i for i,x in enumerate(main.body) if isinstance(x,ast.For) and isinstance(x.target,ast.Name) and x.target.id=='key')
 poisons=['CARGO_HOME','CARGO_TARGET_DIR','RUSTFLAGS','RUST_LOG','RUSTDOCFLAGS','VIRGL_INTEGER_MASKS_EVIDENCE_DIR','npm_config_prefix','NPM_CONFIG_CACHE','GIT_DIR','EMCC_DEBUG','NODE_OPTIONS','NODE_PATH','NODE_V8_COVERAGE','PYTHONPATH','PYTHONHOME','CHROME','CC','CXX','CFLAGS','CXXFLAGS','CPPFLAGS','LDFLAGS','AR','RANLIB','EMCC','EMSDK','EMSDK_NODE','EMSDK_PYTHON','EM_CONFIG','EM_CACHE','MAKEFLAGS','MFLAGS','MAKEOVERRIDES','BASH_ENV','ENV']
 scope={'env':{**{k:'poison' for k in poisons},'PATH':'kept','HOME':'kept'},'__builtins__':{'sorted':sorted}};exec(compile(ast.Module(body=main.body[start:end+1],type_ignores=[]),'cold-scrub','exec'),scope,scope)
 check(scope['env']=={'PATH':'kept','HOME':'kept'},'cold scrub block','environment scrub attack')
 for node in ast.walk(main):
  if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='Popen':check(any(k.arg=='env' and isinstance(k.value,ast.Name) and k.value.id=='env' for k in node.keywords),'cold Popen','scrubbed env reaches child')
 result.update(coldClone={'reportSha256':sha((C/'report.json').read_bytes()),'receiptSha256':cr['receiptSha256'],'copiedFiles':len(cr['acceptanceFiles']),'clone':str(clone)},recordBindings=records,checks=sum(checks.values()),checksByCategory=dict(checks))
result['auditorSourceSha256']=sha(Path(__file__).read_bytes());(O/'binding-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['status','checks','recordBindings']},indent=2))
