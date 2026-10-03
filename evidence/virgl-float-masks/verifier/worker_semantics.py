import hashlib,json,pathlib,re,struct,subprocess
R=pathlib.Path(__file__).resolve().parents[3];O=pathlib.Path(__file__).resolve().parent
HEAD='d549500106399ada00fcd48f1439bd107377ebc5';BASE='7be4e09748bc4acfcdf167bd66cd6f3d890132d5'
B=json.loads((R/'evidence/virgl-float-masks/worker/hardware/report.json').read_text())['acceptance']
anchors={x['name']:x for x in B['anchors']};checks=0;M=0xffffffff

def test(x,m):
 global checks
 checks+=1
 if not x:raise AssertionError(m)
def operand(regs,text):
 m=re.fullmatch(r'(IN|OUT|IMM|TEMP|CONST)\[(\d+)\](?:\.([xyzw]{4}))?',text);assert m,text
 f,i,s=m.groups();v=regs[f][int(i)];return[v['xyzw'.index(c)] for c in (s or 'xyzw')]
def signed(x):return x if x<2**31 else x-2**32
def ordered(a,b,ge):
 def unpack(w):
  s,e,f=w>>31,(w>>23)&255,w&0x7fffff
  if e==255:return ('nan',0) if f else ('inf',-1 if s else 1)
  value=f if e==0 else (0x800000+f)<<(e-1)
  return ('finite',-value if s else value)
 a,b=unpack(a),unpack(b)
 if a[0]=='nan' or b[0]=='nan':return 0
 if a[0]=='inf' or b[0]=='inf':cmp=0 if a==b else -1 if a==('inf',-1) or b==('inf',1) else 1
 else:cmp=(a[1]>b[1])-(a[1]<b[1])
 return M if (cmp>=0 if ge else cmp<0) else 0
def interpret(text,words,inputs):
 regs={f:{} for f in ['IN','OUT','IMM','TEMP','CONST']};regs['IN']=inputs;regs['CONST']={i:words[i*4:i*4+4] for i in range(len(words)//4)}
 for line in text.splitlines():
  if line.startswith('IMM['):
   m=re.fullmatch(r'IMM\[(\d+)\] (UINT32|FLT32) \{(.*)\}',line);assert m,line
   regs['IMM'][int(m[1])]=[int(x.strip()) if m[2]=='UINT32' else struct.unpack('<I',struct.pack('<f',float(x)))[0] for x in m[3].split(',')]
  elif line.startswith(('MOV ','AND ','OR ','NOT ','SHL ','USHR ','UADD ','ISGE ','USEQ ','USNE ','UCMP ','FSLT ','FSGE ')):
   op,tail=line.split(' ',1);args=[x.strip() for x in tail.split(',')];dst=re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?',args[0]);assert dst
   sources=[operand(regs,x) for x in args[1:]];f,i,mask=dst.groups();new={}
   for char in mask or 'xyzw':
    lane='xyzw'.index(char);a=sources[0][lane];b=sources[1][lane] if len(sources)>1 else 0;c=sources[2][lane] if len(sources)>2 else 0
    new[lane]={'MOV':lambda:a,'AND':lambda:a&b,'OR':lambda:a|b,'NOT':lambda:a^M,'SHL':lambda:(a<<b%32)&M,'USHR':lambda:a>>(b%32),'UADD':lambda:(a+b)%(2**32),'ISGE':lambda:M if signed(a)>=signed(b) else 0,'USEQ':lambda:M if a==b else 0,'USNE':lambda:M if a!=b else 0,'UCMP':lambda:b if a!=0 else c,'FSLT':lambda:ordered(a,b,False),'FSGE':lambda:ordered(a,b,True)}[op]()
   target=regs[f].setdefault(int(i),[None]*4)
   for lane,value in new.items():target[lane]=value
 return regs['OUT']
words=0;captures=0;planes=0
for p in B['vertexProbes']:
 shader=anchors[p['vertex']]['text']
 for v in p['vectors']:
  recovered=[0]*4
  for c in v['captures']:
   bit=c['selector'];uniforms=v['upload']['words'][:];uniforms[176:180]=[bit]*4
   output=interpret(shader,uniforms,{0:[0,0,0,0x3f800000]});bits=output[0]+output[1]
   test(bits==c['observedBits']==c['expectedBits'],'independent TGSI interpreter full TF bits');raw=struct.pack('<8I',*bits);test(list(raw)==c['rawBytes'],'raw TF bytes');test(hashlib.sha256(raw).hexdigest()==c['bytesSha256'],'TF digest')
   test(c['selectorUpload']['words']==[bit]*4==c['selectorUpload']['observed'],'actual selector')
   for lane,value in enumerate(output[1]):
    test((value&0xff807fff)==0x3f000000,'normal exact byte carrier');decoded=(value-0x3f000000)>>15;recovered[lane]|=decoded<<bit
   captures+=1
  test(recovered==v['expectedWords']==v['observedWords'],'all VS bytes independently interpreted');words+=4
for p in B['fragmentProbes']:
 shader=anchors[p['fragment']]['text']
 for v in p['vectors']:
  recovered=[0]*4;plane_bytes=[]
  for d in v['draws']:
   bit=d['selector'];uniforms=v['upload']['words'][:];uniforms[176:180]=[bit]*4;output=interpret(shader,uniforms,{})[0]
   test(all(x in [0,0x3f800000] for x in output),'FS exact float 0/1');values=[255 if x else 0 for x in output];test(values==d['observedBytes']==d['expectedBytes'],'independent TGSI interpreter FS pixel')
   for lane,value in enumerate(values):recovered[lane]|=(value//255)<<bit
   plane_bytes+=values;planes+=1
  test(recovered==v['expectedWords']==v['observedWords'],'all FS bits independently interpreted');test(hashlib.sha256(bytes(plane_bytes)).hexdigest()==v['bitPlaneBytesSha256'],'FS plane digest');words+=4
# Every changed executable source line: independent diff and LLVM-show mapping.
coverage={};current=None
for line in (R/'evidence/virgl-float-masks/worker/native/coverage-show.txt').read_text().splitlines():
 if line.endswith('.c:'):current='renderer/'+line[:-1].split('/renderer/')[-1];continue
 m=re.match(r'\s*(\d+)\|\s*([^|]*)\|',line)
 if m and current and m[2].strip():coverage.setdefault(current,{})[int(m[1])]=m[2].strip()
changed={};path=None;new=0
for line in subprocess.check_output(['git','diff','--unified=0',BASE,HEAD,'--','renderer/virgl-shader/bridge.c','renderer/virgl-shader/raw_bits.c','renderer/virgl-shader/raw_bits.h'],cwd=R,text=True).splitlines():
 if line.startswith('+++ b/'):path=line[6:]
 elif line.startswith('@@'):new=int(re.search(r'\+(\d+)',line)[1])
 elif line.startswith('+') and not line.startswith('+++'):changed.setdefault(path,[]).append(new);new+=1
 elif line.startswith(' '):new+=1
records=[];waivers=[]
for path,lines in changed.items():
 source=(R/path).read_text().splitlines()
 for line in lines:
  if line in coverage.get(path,{}):
   count=coverage[path][line];test(count!='0',f'unexecuted changed executable line {path}:{line}');records.append(dict(path=path,line=line,nativeLineCount=count,classification='executed'))
  else:waivers.append(dict(path=path,line=line,text=source[line-1],reason='Declaration, layout/static assertion, comment, brace or preprocessor line; no independently executable statement. Header sizes also tested on native/Wasm.'))
report=dict(schema='independent-worker-ordered-semantics-v1',status='passed',head=HEAD,assertions=checks,rawWords=words,vertexCaptures=captures,fragmentBitplanes=planes,executableChangedLines=len(records),coverage=records,nonExecutableChangedLines=waivers,workerHardwareSha256=hashlib.sha256((R/'evidence/virgl-float-masks/worker/hardware/report.json').read_bytes()).hexdigest(),coverageSha256=hashlib.sha256((R/'evidence/virgl-float-masks/worker/native/coverage-show.txt').read_bytes()).hexdigest())
(O/'worker-semantics.json').write_text(json.dumps(report,indent=2)+'\n');print({k:report[k] for k in ['status','assertions','rawWords','executableChangedLines']})
