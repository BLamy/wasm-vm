import hashlib,json,os,pathlib,random,re,struct,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3];O=pathlib.Path(__file__).resolve().parent;R=ROOT/'renderer/virgl-shader';BASE='59f1b924286af70096d9fb19fbdb35b9ec2ed7a1';HEAD=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
def sha(x):return hashlib.sha256(x).hexdigest()
def save(n,v):(O/n).write_text(json.dumps(v,indent=2)+'\n')
cases=[]
def add(n,t,ok=None,stage='fragment',baseline=False,code=None):cases.append(dict(name=n,text=t,ok=ok,stage=stage,baseline=baseline,code=code))
def source(body,stage='fragment',output='TEMP[117]',extra='',encode=False):
 h=('VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n' if stage=='vertex' else 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL IN[1], GENERIC[1], PERSPECTIVE\nDCL OUT[0], COLOR\n')
 h+='DCL TEMP[0..117]\nDCL CONST[0..45]\n'+(extra if extra.startswith('DCL') else '')+'IMM[0] UINT32 {0, 0, 0, 0}\nIMM[1] UINT32 {8388607, 8388607, 8388607, 8388607}\nIMM[2] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}\nIMM[3] UINT32 {1, 2, 2147483648, 4294967295}\n'+(extra if extra.startswith('IMM') else '')+'OR TEMP[114], IMM[0], IMM[0]\n'+body
 if encode:h+=f'AND TEMP[116], {output}, IMM[1]\nOR TEMP[116], TEMP[116], IMM[2]\n';output='TEMP[116]'
 return h+(f'MOV OUT[0], IN[0]\nMOV OUT[1], {output}\n' if stage=='vertex' else f'MOV OUT[0], {output}\n')+'END\n'
for stage in ['vertex','fragment']:
 for op in ['ADD','MUL','MAD']:
  arity=3 if op=='MAD' else 2
  for mask in ['', '.x','.y','.z','.w','.xy','.xyz','.xz','.xyzw']:
   b='MOV TEMP[117], IN[0]\n'+f'{op} TEMP[117]{mask}, '+', '.join(['TEMP[117].wzyx','IN[1].yxwz','IMM[2]'][:arity])+'\n'
   add(f'{stage}-{op}-alias-{mask}',source(b,stage),mask=='' or (op!='MAD' and mask not in ['.xz','.xyzw']),stage)
  for bad in ['CONST[0]','CONST[45]','TEMP[115]','OUT[0]','SAMP[0]','-IN[0]','|IN[0]|','IN[0].x','IN[8]','TEMP[118]']:
   b=f'{op} TEMP[117], '+', '.join([bad]+['IN[0]']*(arity-1))+'\n'
   add(f'{stage}-{op}-unsafe-{bad}',source(b,stage),False,stage)
  for word in [0,0x80000000,1,0x80000001,0x7fffff,0x800000,0x80800000,0x3f800000,0xbf800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,0x7f800001,0xffc00000]:
   ex=f'IMM[4] UINT32 {{{word}, {word}, {word}, {word}}}\n';b=f'{op} TEMP[117], '+', '.join(['IMM[4]']*arity)+'\n';e=(word>>23)&255;safe=e not in [0,255] or (word&0x7fffffff)==0
   add(f'{stage}-{op}-domain-{word:08x}',source(b,stage,extra=ex),safe,stage)
  for operand in ['IN[0]','TEMP[115]']:
   b='MOV TEMP[115], IN[1]\n'+f'{op} TEMP[117], '+', '.join([operand]*arity)+'\nMOV TEMP[115], CONST[45]\n'
   add(f'{stage}-{op}-instruction-time-{operand}',source(b,stage),True,stage)
  b='MOV TEMP[115], CONST[45]\n'+f'{op} TEMP[117], '+', '.join(['TEMP[115]']*arity)+'\nMOV TEMP[115], IN[1]\n'
  add(f'{stage}-{op}-future-authority',source(b,stage),False,stage)
 for condition in ['IMM[0]','IMM[3]','CONST[0]']:
  for yes,no in [('IN[0]','IN[1]'),('IN[0]','CONST[1]'),('CONST[1]','IN[0]'),('TEMP[115]','CONST[1]'),('CONST[1]','TEMP[115]')]:
   b='ADD TEMP[115], IN[0], IMM[2]\n'+f'UCMP TEMP[117], {condition}, {yes}, {no}\nMUL TEMP[117], TEMP[117], IMM[2]\n'
   good=condition=='IMM[0]' and no!='CONST[1]' or condition=='IMM[3]' and yes!='CONST[1]' or condition=='CONST[0]' and 'CONST[1]' not in (yes,no)
   add(f'{stage}-selector-{condition}-{yes}-{no}',source(b,stage),bool(good),stage)
 # A numeric token after the UCMP must enable exactly the mixed join, not authorize raw arms.
 add(f'{stage}-early-wide-join',source('UCMP TEMP[117], CONST[0], IN[0], IN[1]\nADD TEMP[115], IN[0], IN[0]\n',stage),True,stage)
 for lane in 'xyzw':
  b=f'ADD TEMP[117], IN[0], IMM[2]\nMOV TEMP[117].{lane}, CONST[0]\nADD TEMP[116], TEMP[117], IMM[2]\n'
  add(f'{stage}-invalidate-{lane}',source(b,stage,output='TEMP[116]'),False,stage)
  b=f'ADD TEMP[117], IN[0], IMM[2]\nMOV TEMP[117].{lane}, CONST[0]\nADD TEMP[116].'+''.join([x for x in 'xyzw' if x!=lane][0])+', TEMP[117], IMM[2]\n'
  add(f'{stage}-untouched-{lane}',source(b,stage,output='IN[0]'),True,stage)
  b=f'MOV TEMP[115].{lane}, IN[1]\nUCMP TEMP[117], IMM[3], IN[0], TEMP[115]\nADD TEMP[117], TEMP[117], IMM[2]\n'
  add(f'{stage}-unselected-uninitialized-{lane}',source(b,stage),False,stage)
 for mask in [0x807fffff,0x7fffffff,0xff7fffff,0x80000000]:
  ex=f'IMM[4] UINT32 {{{mask}, {mask}, {mask}, {mask}}}\n';b='AND TEMP[117], CONST[45], IMM[4]\n'
  add(f'{stage}-dynamic-domain-{mask:08x}',source(b+'ADD TEMP[117], TEMP[117], IMM[0]\n',stage,extra=ex),mask==0x80000000,stage)
  add(f'{stage}-dynamic-safe-{mask:08x}',source(b+'OR TEMP[117], TEMP[117], IMM[2]\nMUL TEMP[117], TEMP[117], IMM[2]\n',stage,extra=ex),mask in [0x807fffff,0xff7fffff,0x80000000],stage)
for index in range(8):
 extra=f'DCL SAMP[{index}]\nDCL SVIEW[{index}], 2D, FLOAT\n'
 b=f'TEX TEMP[117], IN[0], SAMP[{index}], 2D\nMUL TEMP[117], TEMP[117], IMM[2]\n'
 add(f'sampler-{index}',source(b,extra=extra),True)
 add(f'sampler-{index}-vertex',source(b,'vertex',extra=extra),False,'vertex')
 for bad in ['.xy','.x','.xyz']:
  add(f'sampler-{index}-partial-{bad}',source(b.replace('TEX TEMP[117],','TEX TEMP[117]'+bad+','),extra=extra),False)
for filename in ['raw-bit-cases.json','raw-bit-hardware.json','integer-mask-cases.json','integer-mask-hardware.json','float-mask-cases.json','float-mask-hardware.json']:
 old=json.loads(subprocess.check_output(['git','show',f'{BASE}:renderer/virgl-shader/tests/{filename}'],cwd=ROOT));old=old['shaders'] if isinstance(old,dict) else old
 for c in old:add('baseline-'+filename+'-'+c['name'],c['text'],None,c['stage'],True)
text=(R/'tests/components.mjs').read_text()
for digest,size,stage,workload in re.findall(r"\['([a-f0-9]{64})',(\d+),'(vertex|fragment)','([^']+)'\]",text):
 b=(ROOT/f'evidence/virgl-corpus/captures/{workload}/shaders/{digest}.tgsi').read_bytes();assert sha(b)==digest and len(b)==int(size);add('original-'+digest,b.decode(),None,stage,True)
seeds=[0x19cd7083,0x52e4a601,0x76a31f9b,0xc20f74b5]
base=source('ADD TEMP[117], IN[0], IMM[2]\n')
for seed in seeds:
 rng=random.Random(seed)
 for i in range(128):
  p=rng.randrange(len(base));m=i%4;t=base[:p]+chr(rng.randrange(1,128))+base[p+(m==0):] if m<2 else base[:p]+base[p+1:] if m==2 else base[:p];add(f'mutation-{seed:08x}-{i}',t)
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
 if r['ok'] and not c['baseline'] and re.search(r'^(?:ADD|MUL|MAD|TEX) ',c['text'],re.M):assert r['metadata']['profile']=='virgl-webgl2-raw-bits-v4',c['name']
 if c['code']:assert r.get('error',{}).get('code')==c['code'],(c['name'],c['code'],r)
baseline=[c for c in cases if c['baseline']];old=execute('audit-parent',baseline)
for i,c in enumerate(baseline):assert results[cases.index(c)*3]==old[i*3],(c['name'],'baseline drift')
originals=[i for i,c in enumerate(cases) if c['name'].startswith('original-')];assert len(originals)==19 and sum(results[i*3]['ok'] for i in originals)==12
report=dict(status='passed',head=HEAD,baseline=BASE,cases=len(cases),conversions=len(results),recoveries=len(cases)*2,baselineFullResults=len(baseline),originals=19,acceptedOriginals=12,seeds=list(map(hex,seeds)),commands=commands,sources={str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in [R/'bridge.c',R/'raw_bits.c',R/'raw_bits.h',O/'driver.c',O/'native_audit.py']},records={n:sha((O/n).read_bytes()) for n in ['native-cases.json','audit-native.input','audit-native.jsonl','audit-native.stderr','audit-parent.input','audit-parent.jsonl','audit-parent.stderr']},binaries={n:sha((O/n).read_bytes()) for n in ['audit-native','audit-parent']})
save('native-report.json',report);print(json.dumps({k:report[k] for k in ['status','cases','conversions','recoveries','baselineFullResults','originals']}))
