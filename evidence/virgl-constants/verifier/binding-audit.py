#!/usr/bin/env python3
"""Independent frozen-source/recording audit; does not import the worker receipt."""
import hashlib, json, math, re, struct, subprocess, sys
from pathlib import Path
ROOT=Path('/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm')
HEAD='81cd3a4c403176be4b0191fa00ed37f4fd1e1e35'
BASE='5af5600c33c69e926c96a3dc82369c31da391565'
EVIDENCE=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'evidence/virgl-constants/worker'
OUTPUT=Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/'evidence/virgl-constants/verifier/binding-worker-audit.json'
checks=[]
def sha(b): return hashlib.sha256(b).hexdigest()
def read(p): return json.loads(p.read_bytes())
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT)
def must(v,msg):
 if not v: raise AssertionError(msg)
def held(name,detail): checks.append(dict(prediction=name,status='HELD',detail=detail))
def float32(word): return struct.unpack('<f',struct.pack('<I',word))[0]
def bind(item,base,commit=False):
 p=base/item['path']; b=p.read_bytes()
 must(sha(b)==item['sha256'] and len(b)==item.get('bytes',item.get('size')),f'digest/size {p}')
 if commit and '/build/' not in item['path']: must(b==git('show',HEAD+':'+item['path']),f'Git source {item["path"]}')
 return b
receipt=read(EVIDENCE/'receipt.json'); native=read(EVIDENCE/'native/native-report.json'); hardware=read(EVIDENCE/'hardware/report.json'); sabotage=read(EVIDENCE/'sabotage/report.json'); decoder=read(EVIDENCE/'decoder/decoder-report.json')
must(receipt['gitHead']==HEAD and receipt['status']=='passed','receipt head/status')
for item in receipt['records']: bind(item,EVIDENCE)
source_count=0
for doc in (receipt,native,hardware,sabotage):
 for item in doc['sources']: bind(item,ROOT,True);source_count+=1
for compiler,digest in receipt['compilerSha256'].items():must(sha((ROOT/compiler).read_bytes())==digest,'compiler binary digest')
for doc,folder in ((hardware,'hardware'),(sabotage,'sabotage')):
 must(doc['gitHead']==HEAD and doc['trackedChanges']==[],'browser exact head/clean')
 must(doc['guestExecution'] is False and doc['currentGuest3dAdvertisement'] is False,'isolated proof')
 must(doc['browserErrors']=={'console':[],'page':[],'requests':[]},'browser errors')
 sources={v['path']:v for v in doc['sources']}
 for item in doc['servedFiles']:
  b=(ROOT/item['path']).read_bytes()
  if folder=='sabotage' and item['path']=='renderer/virgl-command/state.mjs':
   original=b; before=b'gl.uniform4uiv(uniform.location, words);';after=b'gl.uniform4uiv(uniform.location, words.subarray(0, Math.min(words.length, 180)));'
   must(b.count(before)==1,'single sabotage point');b=b.replace(before,after)
   must(doc['sabotage']['originalSha256']==sha(original) and doc['sabotage']['servedSha256']==sha(b),'sabotage source identity')
  else: must(item['sha256']==sources[item['path']]['sha256'],'served/source binding')
  must(item['sha256']==sha(b) and item['size']==len(b),'served exact bytes')
 for key in ('screenshot','failureScreenshot','browserCoverage'):
  if key in doc: must(sha((EVIDENCE/folder/doc[key]['path']).read_bytes())==doc[key]['sha256'],'capture digest')
 coverage=read(EVIDENCE/folder/'browser-coverage.json')
 served={v['path']:v for v in doc['servedFiles']}
 for script in coverage['scripts']:
  must(script['sha256']==served[script['source']]['sha256'] and script['originalSha256']==sources[script['source']]['sha256'],'coverage served/original binding')
held('B1',{'sourceBindingsChecked':source_count,'recordBindingsChecked':len(receipt['records']),'servedFiles':len(hardware['servedFiles']),'receiptSha256':sha((EVIDENCE/'receipt.json').read_bytes()),'hardwareSha256':sha((EVIDENCE/'hardware/report.json').read_bytes())})

fixtures=read(ROOT/'renderer/virgl-command/tests/constant-shaders.json'); fixture_by_text={x['text']:x for x in fixtures}
held_native=json.loads(git('show',BASE+':evidence/virgl-banks/worker/native/native-report.json'))
old={x['sha256']:x['result'] for x in held_native['originals']}
new={x['sha256']:x['result'] for x in native['originals']}
must(new==old and len(new)==19 and sum(r['ok'] for r in new.values())==12,'original unchanged full results')
for x in native['originals']:bind(x,ROOT,True)
cases={x['name']:x for x in native['cases']}
transcript=(EVIDENCE/'native/native.log').read_bytes();must(sha(transcript)==native['logSha256'],'native transcript hash')
logs=[json.loads(x) for x in transcript.splitlines()];must(len(logs)==27,'27 transcript calls')
for log,item in zip(logs,native['originals']+native['cases']):
 b=log['stdout'].encode('ascii');must(sha(b)==item['stdoutSha256'] and json.loads(b)==item['result'] and len(b)==item['resultBytes']+1 and log['returnCode']==0 and not log['stderr'],'native full serialization')
 must(log['inputSha256']==item.get('inputSha256',item.get('sha256')),'native input hash')
for proof in (hardware['acceptance'],sabotage['acceptance']):
 must(proof['decoder']==decoder,'Node/browser decoder parity')
 must({x['sha256']:x['result'] for x in proof['corpus']}==new,'native/Wasm original full parity')
 must(len(proof['shaderFixtures'])==len(fixtures)==8,'fixture count')
 for fixture in proof['shaderFixtures']:
  expected=fixture_by_text[fixture['text']];case=cases[fixture['name']]
  must(all(fixture[k]==v for k,v in expected.items()),'exact fixture input')
  must(sha(fixture['text'].encode())==fixture['inputSha256']==case['inputSha256'],'fixture input SHA')
  must(fixture['result']==case['result'],'native/Wasm full text + metadata')
 for rig in proof['rigs']+proof['validationRigs']:
  for tr in rig.get('translations',[]):must(tr['result']==cases[fixture_by_text[tr['request']['text']]['name']]['result'],'renderer translator consumption')
  for ev in rig.get('glEvents',[]):
   if ev['call']=='shaderSource':must(ev['source'] in [c['result']['glsl'] for c in cases.values()],'GL receives exact translated text')
held('B2',{'originalBodies':19,'originalAccepted':12,'exactFixtureResults':8,'nativeSha256':sha((EVIDENCE/'native/native-report.json').read_bytes()),'nativeTranscriptSha256':sha(transcript),'inheritedOutOfRangeFrontendBoundary':BASE})

# Decode the wire independently from little-endian bytes, then apply stated constraints.
def packets(raw,allow_truncated=False):
 raw=bytes(raw);must(len(raw)%4==0,'word aligned');offset=0;out=[]
 while offset<len(raw):
  h=int.from_bytes(raw[offset:offset+4],'little');length=h>>16;end=offset+4+length*4
  if end>len(raw):
   if allow_truncated:return out,('truncated-payload',offset)
   raise AssertionError('truncated raw packet')
  words=[int.from_bytes(raw[i:i+4],'little') for i in range(offset+4,end,4)]
  out.append((h&255,(h>>8)&255,words,offset));offset=end
 return out,None
raw_summary={}
for case in decoder['cases']:
 p,error=packets(bytes.fromhex(case['requestHex']),True)
 for op,obj,words,offset in p:
  if error:break
  if op!=12:must(op==44 and not words,'only noop prefix');continue
  count=len(words)-2;stage,slot=words[:2]
  code='invalid-object-type' if obj else 'limit-exceeded' if count>184 else 'invalid-enum' if stage>5 else 'limit-exceeded' if slot>=15 else 'payload-length' if count%4 else 'unsupported-feature' if count and (stage>1 or slot!=0) else 'invalid-value' if not all(math.isfinite(float32(w)) for w in words[2:]) else None
  if code:error=(code,offset)
  else:
   cmd=case['result']['commands'][0];must(cmd['fields']['words']==words[2:] and cmd['fields']['stage']==stage and cmd['fields']['index']==slot,'decoded exact words')
 if error:must(case['result']['ok'] is False and 'commands' not in case['result'] and (case['result']['error']['code'],case['result']['error']['byteOffset'])==error,'independent rejection')
 else:must(case['result']['ok'] is True,'independent acceptance')
 raw_summary[case['name']]=dict(bytes=len(bytes.fromhex(case['requestHex'])),result=error or 'accepted')
held('B3',{'decoderSha256':sha((EVIDENCE/'decoder/decoder-report.json').read_bytes()),'cases':raw_summary})

# Tiny TGSI interpreter reads the original fixture text, not emitted GLSL, expectedMode,
# claimed colors, rectangles, or the worker pixel function. Only fixture ops are allowed.
components='xyzw'
def tgsi(text,bank,inputs):
 regs={('IN',i):list(x) for i,x in enumerate(inputs)}
 regs.update({('CONST',i):[float32(x) for x in bank[i*4:i*4+4]] for i in range(len(bank)//4)})
 def operand(token):
  m=re.fullmatch(r'(\w+)\[(\d+)\](?:\.([xyzw]+))?',token);must(m is not None,'bounded fixture operand')
  key=(m[1],int(m[2]));must(key in regs and len(regs[key])==4,'defined source register '+token)
  value=regs[key];return [value[components.index(c)] for c in m[3]] if m[3] else list(value)
 for line in text.splitlines():
  if not line or line in ('VERT','FRAG','END') or line.startswith('DCL '):continue
  if line.startswith('IMM'):
   m=re.fullmatch(r'IMM\[(\d+)\] FLT32 \{(.*)\}',line);must(m is not None,'float immediate');regs['IMM',int(m[1])]=[float(x) for x in m[2].split(',')];continue
  op,tail=line.split(' ',1);terms=tail.split(', ');dest=terms[0];args=[operand(t) for t in terms[1:]]
  must(op in ('MOV','MUL','ADD'),'bounded fixture instruction')
  value=args[0] if op=='MOV' else [a*b if op=='MUL' else a+b for a,b in zip(*args)]
  m=re.fullmatch(r'(\w+)\[(\d+)\](?:\.([xyzw]+))?',dest);key=(m[1],int(m[2]));out=regs.setdefault(key,[0]*4)
  for c in m[3] or components:out[components.index(c)]=value[components.index(c)]
 return regs

def frame(draw,rig):
 shaders={x['stage']:x['text'] for x in draw['selectedShaders']};banks=draw['bindings']['constants'];geometry=rig['geometry']
 must(geometry['components']==2 and geometry['width']==geometry['height']==32,'frame geometry')
 vertices=[]
 for i in range(0,len(geometry['positions']),2):
  p=tgsi(shaders[0],banks[0],[geometry['positions'][i:i+2]+[0,1]])['OUT',0]
  must(p[3]!=0,'finite projected vertex');vertices.append([(p[0]/p[3]+1)*16,(p[1]/p[3]+1)*16])
 color=tgsi(shaders[1],banks[1],[])['OUT',0]
 color=[min(255,max(0,math.floor(x*255+.5))) for x in color]
 def edge(a,b,p):return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
 def inside(p):
  for i in range(0,len(geometry['indices']),3):
   a,b,c=[vertices[j] for j in geometry['indices'][i:i+3]];signs=[edge(a,b,p),edge(b,c,p),edge(c,a,p)]
   if all(s>=0 for s in signs) or all(s<=0 for s in signs):return True
  return False
 return bytes(v for y in range(32) for x in range(32) for v in (color if inside((x+.5,y+.5)) else [0,0,255,255])),vertices,color

draw_summary=[];packet_counts={};raw_uploads=0
for rig in hardware['acceptance']['rigs']+hardware['acceptance']['validationRigs']:
 current={};banks={};draws={d['submissionIndex']:d for d in rig.get('draws',[])}
 for si,sub in enumerate(rig.get('submissions',[])):
  context=sub['contextId'];current.setdefault(context,0);pp,_=packets(sub['bytes']);applied=sub['result'].get('appliedCommands',0)
  for op,obj,w,off in pp:
   if op==12:packet_counts[len(w)-2]=packet_counts.get(len(w)-2,0)+1
  for op,obj,w,off in pp[:applied]:
   if op in (28,29):
    current[context]=w[0]
    if op==29:banks[context,w[0]]=[[],[]]
   if op==30:banks.pop((context,w[0]),None);current[context]=0
   if op==12:banks.setdefault((context,current[context]),[[],[]])[w[0]]=w[2:];raw_uploads+=1
  if si not in draws:continue
  d=draws[si];must(any(op==8 for op,_,_,_ in pp[:applied]),'actual applied draw packet')
  recorded=banks.get((context,current[context]),[[],[]]);must(d['bindings']['constants']==recorded,'raw latest per-context/subcontext upload -> draw banks')
  for uniform in d['uniforms']:
   st=0 if uniform['stage']=='vertex' else 1;n=uniform['uploadCount']*4
   must(uniform['words'][:n]==recorded[st][:n],'actual uniform words -> raw upload')
  expect,vertices,color=frame(d,rig);actual=bytes(d['rgbaBytes']);must(sha(actual)==d['rgbaSha256'],'frame raw hash');must(actual==expect,'TGSI/raw-data-derived framebuffer '+rig['name']+'/'+d['name'])
  draw_summary.append(dict(rig=rig['name'],draw=d['name'],submissionIndex=si,vertices=vertices,color=color,pixels=len(actual)//4,rgbaSha256=sha(actual)))
must(len(draw_summary)==44 and sum(x['pixels'] for x in draw_summary)==45056,'44 complete framebuffers')
control=sabotage['acceptance']['rigs'][0];bad=control['draws'][0];good=hardware['acceptance']['rigs'][0]['draws'][0]
must(bad['selectedShaders']==good['selectedShaders'] and bad['bindings']['constants']==good['bindings']['constants'],'sabotage same guest input')
must(control['submissions']==hardware['acceptance']['rigs'][0]['submissions'][:len(control['submissions'])],'sabotage same raw packets/results before output failure')
expect,_,_=frame(bad,control);must(bytes(bad['rgbaBytes'])!=expect and bytes(bad['rgbaBytes'])==bytes([0,0,255,255])*1024,'sabotage independent framebuffer failure')
must(all(len(e['words'])<=180 for e in control['glEvents'] if e['call']=='uniform4uiv'),'sabotage truncation actual GL calls')
held('B4',{'rawAppliedUploads':raw_uploads,'rawConstantWordCounts':packet_counts,'frames':draw_summary,'sabotageFirstMismatch':next(i for i,(a,b) in enumerate(zip(bytes(bad['rgbaBytes']),expect)) if a!=b),'sabotageSha256':sha((EVIDENCE/'sabotage/report.json').read_bytes())})

contract=read(ROOT/'docs/gpu-3d-contract.json');old_contract=json.loads(git('show',BASE+':docs/gpu-3d-contract.json'))
must(contract['production']==old_contract['production']=={'capsets':[],'guestRendererImplemented':False,'numCapsets':0,'virglFeature':False},'unchanged disabled production contract')
must(not git('diff','--name-only',BASE,HEAD,'--','web','crates','.github').strip(),'no production boot/feature/web modification')
held('B6',{'production':contract['production'],'unchangedProductionTrees':['web','crates','.github'],'changedRuntimePaths':['renderer/virgl-command/decoder.mjs','renderer/virgl-command/state.mjs']})
OUTPUT.write_text(json.dumps(dict(status='passed',frozenHead=HEAD,base=BASE,evidence=str(EVIDENCE),auditSha256=sha(Path(__file__).read_bytes()),checks=checks),indent=2)+'\n')
print(json.dumps({'status':'passed','checks':[c['prediction'] for c in checks],'draws':len(draw_summary),'output':str(OUTPUT),'sha256':sha(OUTPUT.read_bytes())}))
