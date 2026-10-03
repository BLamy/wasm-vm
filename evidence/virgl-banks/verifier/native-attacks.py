from pathlib import Path
import subprocess,struct,json,hashlib,os,gzip,random,re
R=Path.cwd();V=R/'evidence/virgl-banks/verifier';B=R/'target/virgl-banks-verifier';sha=lambda b:hashlib.sha256(b).hexdigest()
vs='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0..45]\nDCL TEMP[0..117]\nMOV TEMP[17], CONST[5]\nMOV TEMP[117], CONST[45]\nMUL TEMP[117], TEMP[117], CONST[44]\nADD OUT[1], TEMP[117], TEMP[17]\nMOV OUT[0], IN[0]\nEND\n'
fs='FRAG\nDCL OUT[0], COLOR\nDCL CONST[0..45]\nDCL TEMP[0..117]\nMOV TEMP[17], CONST[5]\nMOV TEMP[117], CONST[45]\nMUL TEMP[117], TEMP[117], CONST[44]\nADD OUT[0], TEMP[117], TEMP[17]\nEND\n'
anchors=[(0,vs,''),(1,fs,''),(2,vs,fs)];cases=[]
def add(name,mode,a,ok,b='',code=None):
 cases.append({'name':name,'mode':mode,'a':a,'b':b,'ok':ok,'code':code})
def simple(stage,decl='DCL CONST[0]',instr='MOV OUT[0], CONST[0]'):
 return ('VERT' if stage==0 else 'FRAG')+'\nDCL OUT[0], '+('POSITION' if stage==0 else 'COLOR')+'\n'+decl+'\n'+instr+'\nEND\n'
for stage in range(2):
 for n in range(121):
  add(f's{stage}-TEMP-{n}',stage,simple(stage,f'DCL TEMP[{n}]\nDCL CONST[0]',f'MOV TEMP[{n}], CONST[0]\nMOV OUT[0], TEMP[{n}]'),n<=117)
 for n in range(49):add(f's{stage}-CONST-{n}',stage,simple(stage,f'DCL CONST[{n}]',f'MOV OUT[0], CONST[{n}]'),n<=45)
 for file,limit in [('TEMP',118),('CONST',46)]:
  for first in range(limit):
   for last in sorted({first,limit-1,min(first+1,limit-1)}):
    d=f'DCL {file}[{first}..{last}]';i=f'MOV OUT[0], {file}[{last}]'
    if file=='TEMP':d+='\nDCL CONST[0]';i=f'MOV TEMP[{last}], CONST[0]\n'+i
    add(f's{stage}-{file}-range-{first}-{last}',stage,simple(stage,d,i),True)
  for d in [f'DCL {file}[{limit-1}..{limit}]',f'DCL {file}[{limit-1}..0]',f'DCL {file}[0..{limit-1}]\nDCL {file}[{limit-1}]',f'DCL {file}[{limit-1}]\nDCL {file}[0..{limit-1}]']:
   add(f's{stage}-{file}-invalid-range-{len(cases)}',stage,simple(stage,d),False)
 for raw in ['00','01','007','010','045','099','0117','118','999','1000','1170','4294967295','4294967296','-1','+1','0x0','0e0','1 0','']:
  for file in ['TEMP','CONST','IN','OUT','IMM','SAMP','SVIEW']:
   add(f's{stage}-{file}-numeric-{raw}',stage,simple(stage,f'DCL {file}[{raw}]\nDCL CONST[0]'),False)
 for file in ['IN','OUT','IMM','SAMP','SVIEW']:
  for raw in ['8','9','10','45','117']:
   add(f's{stage}-small-{file}-{raw}',stage,simple(stage,f'DCL {file}[{raw}]\nDCL CONST[0]'),False)
 for n in [8,9,10,45,117]:
  add(f's{stage}-semantic-{n}',stage,simple(stage,f'DCL IN[0], GENERIC[{n}], PERSPECTIVE\nDCL CONST[0]') if stage else simple(stage,f'DCL OUT[1], GENERIC[{n}]\nDCL CONST[0]','MOV OUT[1], CONST[0]\nMOV OUT[0], CONST[0]'),False)
 for r in [9,10,17,99,100,113,117]:
  for written in ['x','y','z','w','xy','xyz']:
   for consumed in 'xyzw':
    d=f'DCL TEMP[{r}]\nDCL CONST[0]'
    i=f'MOV TEMP[{r}].{written}, CONST[0]\nMOV OUT[0], TEMP[{r}].{consumed*4}'
    add(f's{stage}-lanes-{r}-{written}-{consumed}',stage,simple(stage,d,i),consumed in written)
  add(f's{stage}-uninitialized-self-{r}',stage,simple(stage,f'DCL TEMP[{r}]\nDCL CONST[0]',f'ADD TEMP[{r}], TEMP[{r}], CONST[0]\nMOV OUT[0], TEMP[{r}]'),False)
 for write,read in [(17,117),(117,17),(5,45),(45,5),(0,117)]:
  add(f's{stage}-temp-alias-{write}-{read}',stage,simple(stage,'DCL TEMP[0..117]\nDCL CONST[0]',f'MOV TEMP[{write}], CONST[0]\nMOV OUT[0], TEMP[{read}]'),False)
 for decl,src in [('DCL CONST[45]','TEMP[45]'),('DCL TEMP[45]','CONST[45]'),('DCL IN[7]','TEMP[7]')]:add(f's{stage}-file-alias-{src}',stage,simple(stage,decl,'MOV OUT[0], '+src),False)
 for order,decl,extent in [('high-first','DCL CONST[45]\nDCL CONST[0]',47),('low-first','DCL CONST[0]\nDCL CONST[45]',46)]:
  add(f's{stage}-order-{order}',stage,simple(stage,decl,'MOV OUT[0], CONST[45]'),True);cases[-1]['extent']=extent
 for n in [178,179,180]:
  for labelled in [False,True]:
   instructions=['MOV TEMP[117], CONST[45]']*(n-1)+['MOV OUT[0], TEMP[117]','END']
   if labelled:instructions=[f'{i}: {x}' for i,x in enumerate(instructions)]
   t=('VERT' if stage==0 else 'FRAG')+'\nDCL OUT[0], '+('POSITION' if stage==0 else 'COLOR')+'\nDCL CONST[45]\nDCL TEMP[117]\n'+'\n'.join(instructions)+'\n'
   add(f's{stage}-instructions-{n}-label-{labelled}',stage,t,n<=179)
   add(f'pair-s{stage}-instructions-{n}-label-{labelled}',2,t if stage==0 else vs,n<=179,fs if stage==0 else t)
 for raw,ok,code in [('0',True,None),('2147483648',True,None),('1065353216',True,None),('1232348160',True,None),('1',False,'unsupported-feature'),('8388607',False,'unsupported-feature'),('2147483649',False,'unsupported-feature'),('2139095040',False,'unsupported-feature'),('4286578688',False,'unsupported-feature'),('2143289344',False,'unsupported-feature'),('1232348161',False,'unsupported-feature'),('4294967295',False,'unsupported-feature'),('4294967296',False,'parse-error'),('1x',False,'parse-error'),('1e0',False,'parse-error'),('0x1',False,'parse-error'),('',False,'parse-error'),('2139095040z',False,'parse-error')]:
  add(f's{stage}-floatbits-{raw}',stage,simple(stage,f'IMM[0] UINT32 {{{raw}, 0, 0, 0}}','MOV OUT[0], IMM[0]'),ok,code=code)
 for word in ['ADDR','ADDRX','ADDRESS','ADDR_']:
  for pos in ['decl','src','dst']:
   d='DCL CONST[0]';i='MOV OUT[0], CONST[0]'
   if pos=='decl':d+='\nDCL '+word+'[0]'
   if pos=='src':i='MOV OUT[0], '+word+'[0]'
   if pos=='dst':i='MOV '+word+'[0], CONST[0]\n'+i
   add(f's{stage}-{word}-{pos}',stage,simple(stage,d,i),False,code='unsupported-feature' if word=='ADDR' else 'parse-error')
 for bad in ['CONST[ADDR[0].x]','CONST[45+ADDR[0].x]','TEMP[ADDR[0].x]']:
  add(f's{stage}-indirect-{bad}',stage,simple(stage,'DCL CONST[0..45]\nDCL TEMP[0..117]','MOV OUT[0], '+bad),False)
 for opcode in ['ADD_PRECISE','MOV_PRECISE','MUL_PRECISE','UIF','UADD','MAX','DP3']:
  add(f's{stage}-opcode-{opcode}',stage,simple(stage,'DCL CONST[0]',opcode+' OUT[0], CONST[0]'),False)
 base=vs if stage==0 else fs
 for size in [16384,16385]:add(f's{stage}-text-{size}',stage,base+'\n'*(size-len(base)),size==16384)
 for width in [512,513]:add(f's{stage}-line-{width}',stage,base.replace('DCL TEMP[0..117]','DCL TEMP[0..117]'+' '*(width-len('DCL TEMP[0..117]'))),width==512)
 # Reach exactly 256 meaningful lines using harmless disjoint declarations and the allowed instruction budget.
 prefix=['VERT' if stage==0 else 'FRAG','DCL OUT[0], '+('POSITION' if stage==0 else 'COLOR'),'DCL CONST[0]']+[f'DCL TEMP[{i}]' for i in range(75)]
 for lines in [256,257]:
  t='\n'.join(prefix+['MOV TEMP[0], CONST[0]']*(lines-len(prefix)-2)+['MOV OUT[0], CONST[0]','END'])+'\n'
  add(f's{stage}-nonempty-lines-{lines}',stage,t,lines==256)
# Every legal sampler, input, output and semantic high-small endpoint remains individually legal.
for n in range(8):
 add(f'small-in-{n}',0,f'VERT\nDCL IN[{n}]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[{n}]\nEND\n',True)
 add(f'small-sampler-{n}',1,f'FRAG\nDCL OUT[0], COLOR\nDCL CONST[0]\nDCL SAMP[{n}]\nDCL SVIEW[{n}], 2D, FLOAT\nTEX OUT[0], CONST[0], SAMP[{n}], 2D\nEND\n',True)
 imm='\n'.join(f'IMM[{i}] FLT32 {{0, 0, 0, 1}}' for i in range(n+1))
 add(f'small-imm-{n}',1,simple(1,imm,f'MOV OUT[0], IMM[{n}]'),True)
 if n:
  add(f'small-out-{n}',0,f'VERT\nDCL OUT[0], POSITION\nDCL OUT[{n}], GENERIC[{n}]\nDCL CONST[0]\nMOV OUT[0], CONST[0]\nMOV OUT[{n}], CONST[0]\nEND\n',True)
# independent truncations and seeded mutation schedule, never assume mutations are invalid.
for stage,anchor in [(0,vs),(1,fs)]:
 for n in range(len(anchor)):add(f'truncate-{stage}-{n}',stage,anchor[:n],None)
for seed in [0x0b69d3e1,0x57a2c90f,0xcd41e875,0x913ef246]:
 rng=random.Random(seed)
 for i in range(256):
  stage=rng.randrange(2);b=bytearray((vs if stage==0 else fs).encode())
  for _ in range(1+rng.randrange(4)):b[rng.randrange(len(b))]=rng.randrange(128)
  add(f'mutate-{seed:08x}-{i}',stage,b.decode('ascii'),None)
stream=bytearray()
def emit(mode,a,b):
 aa=a.encode('ascii');bb=b.encode('ascii');stream.extend(struct.pack('<III',mode,len(aa),len(bb))+aa+bb)
for x in anchors:emit(*x)
for case in cases:
 emit(case['mode'],case['a'],case['b'])
 for x in anchors:emit(*x)
(V/'anchors.json').write_text(json.dumps({'vertexText':vs,'fragmentText':fs,'constants':{'5':[.125,.0625,0,.25],'44':[.5,.25,1,.5],'45':[.25,.5,.75,1]},'expectedFloatBits':[0x3e800000,0x3e400000,0x3f400000,0x3f400000],'expectedRGBA':[64,48,191,191]},indent=2)+'\n')
env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1',LLVM_PROFILE_FILE=str(B/'native.profraw'))
run=subprocess.run([str(B/'baseline')],input=stream,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=180)
(V/'native-output.jsonl.gz').write_bytes(gzip.compress(run.stdout,mtime=0));(V/'native-stderr.log').write_bytes(run.stderr)
assert run.returncode==0,(run.returncode,run.stderr.decode(errors='replace'))
lines=run.stdout.splitlines();assert len(lines)==3+len(cases)*4
base=[json.loads(x) for x in lines[:3]];assert all(x['ok'] for x in base)
results=[]; failures=[]
for i,c in enumerate(cases):
 result=json.loads(lines[3+4*i]);r={'name':c['name'],'mode':c['mode'],'inputSha256':sha(c['a'].encode()),'secondSha256':sha(c['b'].encode()),'expected':c['ok'],'expectedCode':c['code'],'result':result}
 if c['ok'] is not None and result['ok'] != c['ok']:failures.append(r)
 if c['code'] and result.get('error',{}).get('code')!=c['code']:failures.append(r)
 if 'extent' in c and result.get('metadata',{}).get('uniforms',[{}])[0].get('count')!=c['extent']:failures.append(r)
 for j in range(3):assert json.loads(lines[4+4*i+j])==base[j],('recovery',c['name'],j)
 results.append(r)
report={'schema':'wasm-vm-banks-independent-native-v1','frozenHead':'f88d7bb0c52cb4ac1189f7a05fb1dfdf77b03b91','status':'failed' if failures else 'passed','cases':len(cases),'calls':len(lines),'recoveries':len(cases)*3,'seeds':['0b69d3e1','57a2c90f','cd41e875','913ef246'],'streamSha256':sha(stream),'outputSha256':sha(run.stdout),'compressedOutputSha256':sha((V/'native-output.jsonl.gz').read_bytes()),'binarySha256':sha((B/'baseline').read_bytes()),'anchors':base,'failures':failures,'results':results}
(V/'native.json').write_text(json.dumps(report,indent=2)+'\n')
(V/'browser-cases.json').write_text(json.dumps([{k:c[k] for k in ['name','mode','a','b','ok','code']} for c in cases if c['ok'] is not None]+[{'name':'anchor-vertex','mode':0,'a':vs,'b':'','ok':True,'code':None},{'name':'anchor-fragment','mode':1,'a':fs,'b':'','ok':True,'code':None},{'name':'anchor-pair','mode':2,'a':vs,'b':fs,'ok':True,'code':None}])+'\n')
print(json.dumps({k:report[k] for k in ['status','cases','calls','recoveries','failures']},indent=2));assert not failures
