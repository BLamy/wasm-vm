import ctypes,hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3]
V=pathlib.Path(__file__).resolve().parent
PARENT='67ca333c05fb70d719c49b3dc5cb8c1f8bb2f6de'
def lib(name):
 d=ctypes.CDLL(str(V/f'audit-{name}.dylib'),mode=ctypes.RTLD_LOCAL);d.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];d.bridge_translate.restype=ctypes.c_char_p;return d
now,old=lib('current'),lib('parent')
def call(d,stage,text):
 b=text.encode();return d.bridge_translate(stage=='fragment',b,len(b)).decode()
results=[];diffs=[];legacy=0;legacy_records=[]
for f in sorted((ROOT/'renderer/virgl-shader/tests').glob('*.json')):
 if f.name.startswith('component-'):continue
 try:raw=subprocess.check_output(['git','show',f'{PARENT}:{f.relative_to(ROOT)}'],stderr=subprocess.DEVNULL);x=json.loads(raw)
 except (subprocess.CalledProcessError,ValueError):continue
 def cases(x,path=''):
  if isinstance(x,dict):
   if {'text','stage'}<=x.keys() and x['stage'] in ('vertex','fragment'):yield x
   else:
    for v in x.values():yield from cases(v)
  elif isinstance(x,list):
   for v in x:yield from cases(v)
 for c in cases(x):
  a,b=call(old,c['stage'],c['text']),call(now,c['stage'],c['text']);legacy+=1
  legacy_records.append({'fixture':f.name,'name':c.get('name'),'stage':c['stage'],'inputSha256':hashlib.sha256(c['text'].encode()).hexdigest(),'parentResultSha256':hashlib.sha256(a.encode()).hexdigest(),'currentResultSha256':hashlib.sha256(b.encode()).hexdigest(),'equal':a==b})
  if a!=b:diffs.append({'fixture':f.name,'name':c.get('name'),'old':json.loads(a),'new':json.loads(b),'inputSha256':hashlib.sha256(c['text'].encode()).hexdigest()})
# Independently authored public-entrypoint adversarial inputs.
head='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL IN[1], GENERIC[1], PERSPECTIVE\nDCL IN[2], GENERIC[2], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {0, 1065353216, 2147483648, 4294967295}\n'
def test(name,body,expected,checks=()):
 text=head+body+'\nEND\n';raw=call(now,'fragment',text);r=json.loads(raw)
 entry={'name':name,'text':text,'expected':expected,'result':r,'checks':list(checks)}
 assert r['ok']==expected,(name,r)
 if expected:
  assert r['metadata']['profile']=='virgl-webgl2-raw-bits-v5',(name,r)
  assert all(s in r['glsl'] for s in checks),(name,checks,r['glsl'])
 else:assert not ({'glsl','vertex','fragment'} & set(r)),(name,r)
 results.append(entry)
ops={'DIV':2,'MAX':2,'FRC':1,'LRP':3,'ADD':2,'MUL':2,'MAD':3}
for op,n in ops.items():
 for neg in range(n):
  for mask in (['','x','xy','xyz'] if op!='MAD' else ['']):
   dst='TEMP[1]'+('.'+mask if mask else '')
   src=[('-' if i==neg else '')+f'IN[{i}].wzyx' for i in range(n)]
   body='MOV TEMP[1], IN[0]\n'+f'{op} {dst}, '+', '.join(src)+'\nMOV OUT[0], TEMP[1]'
   test(f'{op}/neg{neg}/mask{mask or "full"}',body,True)
 # Unknown raw at every position, including a negation, must reject.
 for bad in range(n):
  src=[f'IN[{i}]' for i in range(n)];src[bad]='-CONST[4]'
  test(f'{op}/raw-source{bad}',f'{op} TEMP[1], '+', '.join(src)+'\nMOV OUT[0], TEMP[1]',False)
 # Novel lane overwrite plus swizzle attack: y invalidated, x retained, w/z retained.
 for lane in 'xyzw':
  src=[f'-TEMP[0].{lane*4}']+[f'IN[{i}]' for i in range(1,n)]
  pre='MAX TEMP[0], IN[0], IN[1]\nMOV TEMP[0].y, CONST[4].xxxx\n'
  test(f'{op}/overwritten-lane-{lane}',pre+f'{op} OUT[0], '+', '.join(src),lane!='y')
# Authorized safe raw signed zero/normal versus subnormal/Inf/NaN.
for raw,ok in [(0,True),(0x80000000,True),(0x00800000,True),(0x7f7fffff,True),(1,False),(0x7f800000,False),(0x7fc00001,False)]:
 oldhead=head;head=head.replace('4294967295',str(raw))
 test(f'raw-domain-{raw:08x}','MAX OUT[0], -IMM[0].wwww, IN[0]',ok);head=oldhead
for op,body in [('MOV','MOV OUT[0], -IN[0]'),('UCMP','UCMP OUT[0], IMM[0].xxxx, -IN[0], IN[1]'),('FSLT','FSLT TEMP[0], -IN[0], IN[1]\nMOV OUT[0], IN[0]'),('AND','AND TEMP[0], -IN[0], IMM[0]\nMOV OUT[0], IN[0]')]:
 test('reject-'+op,body,False)
for modifier in ['--IN[0]','+IN[0]','|IN[0]|','-|IN[0]|']:
 test('reject-'+modifier,'MAX OUT[0], '+modifier+', IN[1]',False)
for body in ['MAX_SAT OUT[0], IN[0], IN[1]','MAX PRECISE OUT[0], IN[0], IN[1]','PROPERTY LEGACY_MATH_RULES 1\nMAX OUT[0], IN[0], IN[1]','FRC OUT[0], IN[0], IN[1]']:
 test('reject-'+body.splitlines()[0],body,False)
(V/'audit-results.json').write_text(json.dumps({'parent':PARENT,'legacyCases':legacy,'legacyResultBindings':legacy_records,'legacyDifferences':diffs,'attacks':results},indent=2)+'\n')
print(json.dumps({'legacyCases':legacy,'legacyDifferences':[(x['fixture'],x['name'],x['old'].get('ok'),x['new'].get('ok')) for x in diffs],'novelAttacks':len(results)},indent=2))
