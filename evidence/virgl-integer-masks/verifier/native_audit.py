import hashlib,json,os,pathlib,random,re,struct,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3]; O=pathlib.Path(__file__).resolve().parent;R=ROOT/'renderer/virgl-shader'
HEAD='1e8f2586a125efd91460db3a7e11049855acb495';BASE='98314e2ddb082cf372a46ab90871b7cfdb77d587'
def sha(x):return hashlib.sha256(x).hexdigest()
def save(n,v):(O/n).write_text(json.dumps(v,indent=2)+'\n')
cases=[]
def add(n,t,ok=None,stage='fragment',baseline=False,code=None):cases.append(dict(name=n,text=t,ok=ok,stage=stage,baseline=baseline,code=code))
def source(body,stage='fragment',output='TEMP[117]',encode=True,extra=''):
 h=('VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n' if stage=='vertex' else 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL IN[1], GENERIC[1], PERSPECTIVE\nDCL OUT[0], COLOR\n')
 h+='DCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {0, 0, 0, 0}\nIMM[1] UINT32 {8388607, 8388607, 8388607, 8388607}\nIMM[2] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}\nIMM[3] UINT32 {1, 2, 2147483648, 4294967295}\n'+extra+body
 if encode:h+=f'AND TEMP[116], {output}, IMM[1]\nOR TEMP[116], TEMP[116], IMM[2]\n';output='TEMP[116]'
 return h+(f'MOV OUT[0], IN[0]\nMOV OUT[1], {output}\n' if stage=='vertex' else f'MOV OUT[0], {output}\n')+'END\n'
for stage in ['vertex','fragment']:
 for op in ['UADD','ISGE','USEQ','USNE','UCMP']:
  for mask in ['x','y','z','w','xy','xz','yw','xyz','xyzw']:
   body='MOV TEMP[117], CONST[45]\n'+f'{op} TEMP[117].{mask}, TEMP[117].wzyx, CONST[44].ywxz'+(', TEMP[117].xywz' if op=='UCMP' else '')+'\n'
   # Textual destination profile requires canonical increasing unique mask; explicit full mask is unsupported.
   add(f'{stage}-alias-{op}-{mask}',source(body,stage),mask not in ['xyzw','xz','yw'],stage)
 for dest in 'xyzw':
  for lane in 'xyzw':
   body=f'MOV TEMP[115].{lane}, IMM[3]\nMOV TEMP[117], IMM[2]\nUCMP TEMP[117].{dest}, IMM[0], IMM[2], TEMP[115].{lane*4}\n'
   add(f'{stage}-src3-consumed-{dest}-{lane}',source(body,stage),True,stage)
   wrong='xyzw'[('xyzw'.index(lane)+1)%4]
   add(f'{stage}-src3-uninitialized-{dest}-{lane}',source(body.replace('TEMP[115].'+lane*4,'TEMP[115].'+wrong*4),stage),False,stage,code='parse-error')
 for arm in [1,2]:
  operands=['IMM[0]','IMM[2]','IMM[2]'];operands[arm]='TEMP[115]'
  add(f'{stage}-dead-arm-init-{arm}',source('UCMP TEMP[117], '+', '.join(operands)+'\n',stage),False,stage,code='parse-error')
 for operand in ['CONST[46]','TEMP[118]','IN[8]','OUT[0]','SAMP[0]','IMM[8]','TEMP[117].xx','CONST[45].xxxxx','-CONST[45]','|CONST[45]|','CONST[0][1]','CONST[ADDR[0].x]']:
  add(f'{stage}-src3-invalid-{operand}',source('UCMP TEMP[117], CONST[0], CONST[45], '+operand+'\n',stage),False,stage)
 for args in ['CONST[0], CONST[45]','CONST[0]','CONST[0], CONST[45], IMM[2], IMM[3]','CONST[0],, IMM[2]']:
  add(f'{stage}-UCMP-arity-{args}',source('UCMP TEMP[117], '+args+'\n',stage),False,stage,code='parse-error')
 for condition,yes,no,ok in [('IMM[0]','IN[0]','IN[1]',True),('IMM[3]','IN[0]','IN[1]',True),('CONST[0]','IN[0]','IN[0]',True),('CONST[0]','IN[0]','IN[1]',False),('CONST[0]','IN[0].xyzw','IN[0].wzyx',False),('CONST[0]','IMM[0]','IMM[2]',True)]:
  add(f'{stage}-origin-{condition}-{yes}-{no}',source(f'UCMP TEMP[117], {condition}, {yes}, {no}\n',stage,encode=False),ok,stage)
 for op in ['UADD','ISGE','USEQ','USNE']:
  add(f'{stage}-no-origin-{op}',source(f'{op} TEMP[117], IN[0], IMM[0]\n',stage,encode=False),False,stage,code='unsupported-feature')
 for word in [0,1,2,0x7fffffff,0x80000000,0xffffffff,0x7f800000,0x7fc00001,0x80000001,0x00800000,0x3f800000]:
  extra=f'IMM[4] UINT32 {{{word}, {word}, {word}, {word}}}\n'
  exponent=(word>>23)&255;safe=exponent!=255 and (exponent!=0 or (word&0x7fffff)==0)
  add(f'{stage}-exact-uadd-output-{word:08x}',source('UADD TEMP[117], IMM[4], IMM[0]\n',stage,encode=False,extra=extra),safe,stage)
 for body in ['ISGE TEMP[117], IMM[0], IMM[3]\n','USEQ TEMP[117], IMM[3], IMM[3]\n','USNE TEMP[117], IMM[0], IMM[3]\n']:
  add(f'{stage}-unsafe-mask-{len(cases)}',source(body,stage,encode=False),False,stage,code='unsupported-feature')
 for op in ['FSLT','FSGE','ADD','MAD','UMUL','UIF','UADD_PRECISE','UCMP_SAT']:
  add(f'{stage}-unsupported-{op}',source('UADD TEMP[117], CONST[0], CONST[45]\n'+f'{op} TEMP[117], CONST[0], CONST[45], IMM[0]\n',stage),False,stage)
# Exact full old results, against an independently compiled baseline.
for filename in ['raw-bit-cases.json','raw-bit-hardware.json']:
 old=json.loads(subprocess.check_output(['git','show',f'{BASE}:renderer/virgl-shader/tests/{filename}'],cwd=ROOT))
 if isinstance(old,dict):old=old['shaders']
 for c in old:add('baseline-'+c['name'],c['text'],None,c['stage'],True)
text=(R/'tests/components.mjs').read_text()
for digest,size,stage,workload in re.findall(r"\['([a-f0-9]{64})',(\d+),'(vertex|fragment)','([^']+)'\]",text):
 p=ROOT/f'evidence/virgl-corpus/captures/{workload}/shaders/{digest}.tgsi';b=p.read_bytes();assert sha(b)==digest and len(b)==int(size)
 add('original-'+digest,b.decode(),None,stage,True)
old_captured=json.loads(subprocess.check_output(['git','show',f'{BASE}:renderer/virgl-shader/tests/captured-invalid.json'],cwd=ROOT))
c=next(c for c in old_captured if c['name']=='integer-opcode-remains-rejected');add('migrated-captured-UADD',c['text'],True,c['stage'])
old_banks=json.loads(subprocess.check_output(['git','show',f'{BASE}:renderer/virgl-shader/tests/bank-cases.json'],cwd=ROOT))
for c in old_banks:
 if c['name'].endswith('unsupported-UADD'):add('migrated-'+c['name'],c['text'],False,c['stage'],code='parse-error')
seeds=[0x93e45617,0xbd248069,0x64a317ef,0x0cb526d9]
base=source('UCMP TEMP[117], CONST[0], CONST[45], CONST[43]\n')
for seed in seeds:
 rng=random.Random(seed)
 for i in range(256):
  p=rng.randrange(len(base));m=i%4;t=base[:p]+chr(rng.randrange(1,128))+base[p+(m==0):] if m<2 else base[:p]+base[p+1:] if m==2 else base[:p]
  add(f'mutation-{seed:08x}-{i}',t)
hardware=O/'hardware-fixture.json'
if hardware.exists():
 for c in json.loads(hardware.read_text())['shaders']:add('hardware-'+c['name'],c['text'],True,c['stage'])
save('native-cases.json',cases)
common=['clang','-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1']
for p in ['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']:common+=['-I'+str(R/p)]
vendor=[R/'generated/u_format_table.c',R/'vendor/src/vrend/vrend_shader.c',*sorted((R/'vendor/src/gallium/auxiliary/tgsi').glob('*.c')),R/'vendor/src/gallium/auxiliary/cso_cache/cso_hash.c',R/'vendor/src/gallium/auxiliary/cso_cache/cso_cache.c',R/'vendor/src/mesa/util/u_debug.c']
commands=[]
for name,sources in [('audit-native',[R/'bridge.c',R/'raw_bits.c']),('audit-parent',[O/'parent/bridge.c',O/'parent/raw_bits.c'])]:
 if name=='audit-parent':
  (O/'parent').mkdir(exist_ok=True)
  for file in ['bridge.c','bridge.h','raw_bits.c','raw_bits.h']:(O/'parent'/file).write_bytes(subprocess.check_output(['git','show',f'{BASE}:renderer/virgl-shader/{file}'],cwd=ROOT))
 command=common+['-g','-O1','-fno-omit-frame-pointer','-fsanitize=address,undefined']+list(map(str,sources+vendor))+[str(O/'driver.c'),'-lm','-o',str(O/name)];commands.append(command)
 subprocess.run(command,check=True,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def execute(name,entries):
 data=b''.join(struct.pack('<II',c['stage']=='fragment',len(c['text'].encode()))+c['text'].encode() for c in entries);(O/(name+'.input')).write_bytes(data)
 p=subprocess.run([str(O/name)],input=data,capture_output=True,timeout=120,env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1'));(O/(name+'.jsonl')).write_bytes(p.stdout);(O/(name+'.stderr')).write_bytes(p.stderr)
 assert p.returncode==0 and not p.stderr,(p.returncode,p.stderr[-2000:]);r=list(map(json.loads,p.stdout.splitlines()));assert len(r)==3*len(entries);return r
results=execute('audit-native',cases);recovery=results[1:3];assert all(r['ok'] for r in recovery)
for i,c in enumerate(cases):
 r=results[i*3];assert results[i*3+1:i*3+3]==recovery,(c['name'],'recovery')
 if c['ok'] is not None:assert r['ok']==c['ok'],(c['name'],c['ok'],r)
 if c['code']:assert r.get('error',{}).get('code')==c['code'],(c['name'],c['code'],r)
baseline=[c for c in cases if c['baseline']];old=execute('audit-parent',baseline)
for i,c in enumerate(baseline):assert results[cases.index(c)*3]==old[i*3],(c['name'],'baseline drift')
originals=[i for i,c in enumerate(cases) if c['name'].startswith('original-')];assert len(originals)==19 and sum(results[i*3]['ok'] for i in originals)==12
report=dict(status='passed',head=HEAD,baseline=BASE,cases=len(cases),conversions=len(results),recoveries=len(cases)*2,baselineFullResults=len(baseline),originals=19,acceptedOriginals=12,seeds=list(map(hex,seeds)),commands=commands,sources={str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in [R/'bridge.c',R/'raw_bits.c',R/'raw_bits.h',O/'driver.c',O/'native_audit.py']},records={n:sha((O/n).read_bytes()) for n in ['native-cases.json','audit-native.input','audit-native.jsonl','audit-native.stderr','audit-parent.input','audit-parent.jsonl','audit-parent.stderr']},binaries={n:sha((O/n).read_bytes()) for n in ['audit-native','audit-parent']})
save('native-report.json',report);print(json.dumps({k:report[k] for k in ['status','cases','conversions','recoveries','baselineFullResults','originals']}))
