import hashlib,json,os,pathlib,random,re,struct,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3]; O=pathlib.Path(__file__).resolve().parent;R=ROOT/'renderer/virgl-shader'
HEAD=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();BASE='7be4e09748bc4acfcdf167bd66cd6f3d890132d5'
def sha(x):return hashlib.sha256(x).hexdigest()
def save(n,v):(O/n).write_text(json.dumps(v,indent=2)+'\n')
cases=[]
def add(n,t,ok=None,stage='fragment',baseline=False,code=None):cases.append(dict(name=n,text=t,ok=ok,stage=stage,baseline=baseline,code=code))
def source(body,stage='fragment',output='TEMP[117]',encode=True,extra=''):
 h=('VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\n' if stage=='vertex' else 'FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL IN[1], GENERIC[1], PERSPECTIVE\nDCL OUT[0], COLOR\n')
 h+='DCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {0, 0, 0, 0}\nIMM[1] UINT32 {8388607, 8388607, 8388607, 8388607}\nIMM[2] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}\nIMM[3] UINT32 {1, 2, 2147483648, 4294967295}\n'+extra+body
 if encode:h+=f'AND TEMP[116], {output}, IMM[1]\nOR TEMP[116], TEMP[116], IMM[2]\n';output='TEMP[116]'
 return h+(f'MOV OUT[0], IN[0]\nMOV OUT[1], {output}\n' if stage=='vertex' else f'MOV OUT[0], {output}\n')+'END\n'

def ordered(a,b,ge):
 sa,sb=a>>31,b>>31;ea,eb=(a>>23)&255,(b>>23)&255;fa,fb=a&0x7fffff,b&0x7fffff
 if (ea==255 and fa) or (eb==255 and fb):return 0
 if not(ea or eb or fa or fb):cmp=0
 elif sa!=sb:cmp=-1 if sa else 1
 else:
  cmp=((ea,fa)>(eb,fb))-((ea,fa)<(eb,fb))
  if sa:cmp=-cmp
 return 0xffffffff if (cmp>=0 if ge else cmp<0) else 0
edges=[0,1,2,0x7fffff,0x800000,0x800001,0x3f7fffff,0x3f800000,0x3f800001,0x7f7fffff,0x7f800000,0x7f800001,0x7fbfffff,0x7fc00000,0x7fffffff]
edges += [v|0x80000000 for v in edges]
for stage in ['vertex','fragment']:
 for op in ['FSLT','FSGE']:
  for mask in ['x','y','z','w','xy','xz','yw','xyz','xyzw']:
   body='MOV TEMP[117], CONST[45]\n'+f'{op} TEMP[117].{mask}, TEMP[117].wzyx, CONST[44].ywxz\n'
   add(f'{stage}-alias-{op}-{mask}',source(body,stage),mask not in ['xyzw','xz','yw'],stage)
  for dest in 'xyzw':
   for lane in 'xyzw':
    body=f'MOV TEMP[115].{lane}, IMM[3]\nMOV TEMP[117], IMM[2]\n{op} TEMP[117].{dest}, TEMP[115].{lane*4}, CONST[45]\n'
    add(f'{stage}-consumed-{op}-{dest}-{lane}',source(body,stage),True,stage)
    wrong='xyzw'[('xyzw'.index(lane)+1)%4]
    add(f'{stage}-uninitialized-{op}-{dest}-{lane}',source(body.replace('TEMP[115].'+lane*4,'TEMP[115].'+wrong*4),stage),False,stage,code='parse-error')
  for operand in ['CONST[46]','TEMP[118]','IN[8]','OUT[0]','SAMP[0]','IMM[8]','TEMP[117].xx','CONST[45].xxxxx','-CONST[45]','|CONST[45]|','CONST[0][1]','CONST[ADDR[0].x]']:
   add(f'{stage}-invalid-{op}-{operand}',source(f'{op} TEMP[117], CONST[0], '+operand+'\n',stage),False,stage)
  for args in ['CONST[0]','CONST[0], CONST[45], IMM[2]','CONST[0],, IMM[2]']:
   add(f'{stage}-arity-{op}-{args}',source(f'{op} TEMP[117], '+args+'\n',stage),False,stage,code='parse-error')
  for operand in ['IN[0]','CONST[0]']:
   add(f'{stage}-no-origin-{op}-{operand}',source(f'{op} TEMP[117], {operand}, IMM[0]\n',stage,encode=False),False,stage,code='unsupported-feature')
  for a in edges:
   for b in [0,0x80000000,a,a^0x80000000,0x7f800000,0xff800000,0x7f800001,0xffc13e77]:
    extra=f'IMM[4] UINT32 {{{a}, {a}, {a}, {a}}}\nIMM[5] UINT32 {{{b}, {b}, {b}, {b}}}\n'
    add(f'{stage}-constant-{op}-{a:08x}-{b:08x}',source(f'{op} TEMP[117], IMM[4], IMM[5]\n',stage,encode=False,extra=extra),ordered(a,b,op=='FSGE')==0,stage)
 for op in ['FSEQ','FSNE','ADD','MAD','UMUL','UIF','FSLT_PRECISE','FSGE_SAT']:
  add(f'{stage}-unsupported-{op}',source('FSLT TEMP[117], CONST[0], CONST[45]\n'+f'{op} TEMP[117], CONST[0], CONST[45]\n',stage),False,stage)
# New-profile emitter overflow: preserve the parent validated long-program final
# output, replacing just its first integer instruction with a float comparison.
old=json.loads(subprocess.check_output(['git','show',f'{BASE}:renderer/virgl-shader/tests/integer-mask-cases.json'],cwd=ROOT))
for c in old:
 if c['name'].startswith('glsl-output-bound-'):
  lines=c['text'].splitlines();i=next(i for i,line in enumerate(lines) if line.startswith('UCMP '));lines[i]='FSLT TEMP[116], CONST[0], CONST[45]'
  add('v3-'+c['name'],'\n'.join(lines)+'\n',False,c['stage'],code='translation-error')
# Bound every previous private profile result independently of current fixtures.
for filename in ['raw-bit-cases.json','raw-bit-hardware.json','integer-mask-cases.json','integer-mask-hardware.json']:
 old=json.loads(subprocess.check_output(['git','show',f'{BASE}:renderer/virgl-shader/tests/{filename}'],cwd=ROOT))
 if isinstance(old,dict):old=old['shaders']
 for c in old:
  migrated=bool(re.search(r'^F(?:SLT|SGE) ',c['text'],re.M))
  add(('promoted-' if migrated else 'baseline-')+filename+'-'+c['name'],c['text'],True if migrated else None,c['stage'],not migrated)
text=(R/'tests/components.mjs').read_text()
for digest,size,stage,workload in re.findall(r"\['([a-f0-9]{64})',(\d+),'(vertex|fragment)','([^']+)'\]",text):
 p=ROOT/f'evidence/virgl-corpus/captures/{workload}/shaders/{digest}.tgsi';b=p.read_bytes();assert sha(b)==digest and len(b)==int(size)
 add('original-'+digest,b.decode(),None,stage,True)
seeds=[0x741acf95,0x029bd837,0xee17b45d,0x58930abf]
base=source('FSGE TEMP[117], CONST[0], CONST[45]\n')
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
 if r['ok'] and re.search(r'^F(?:SLT|SGE) ',c['text'],re.M):assert r['metadata']['profile']=='virgl-webgl2-raw-bits-v3',c['name']
 if c['code']:assert r.get('error',{}).get('code')==c['code'],(c['name'],c['code'],r)
baseline=[c for c in cases if c['baseline']];old=execute('audit-parent',baseline)
for i,c in enumerate(baseline):assert results[cases.index(c)*3]==old[i*3],(c['name'],'baseline drift')
originals=[i for i,c in enumerate(cases) if c['name'].startswith('original-')];assert len(originals)==19 and sum(results[i*3]['ok'] for i in originals)==12
report=dict(status='passed',head=HEAD,baseline=BASE,cases=len(cases),conversions=len(results),recoveries=len(cases)*2,baselineFullResults=len(baseline),originals=19,acceptedOriginals=12,seeds=list(map(hex,seeds)),commands=commands,sources={str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in [R/'bridge.c',R/'raw_bits.c',R/'raw_bits.h',O/'driver.c',O/'native_audit.py']},records={n:sha((O/n).read_bytes()) for n in ['native-cases.json','audit-native.input','audit-native.jsonl','audit-native.stderr','audit-parent.input','audit-parent.jsonl','audit-parent.stderr']},binaries={n:sha((O/n).read_bytes()) for n in ['audit-native','audit-parent']})
save('native-report.json',report);print(json.dumps({k:report[k] for k in ['status','cases','conversions','recoveries','baselineFullResults','originals']}))
