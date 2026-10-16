import hashlib,itertools,json,os,struct,subprocess
from pathlib import Path
R=Path.cwd();V=R/'evidence/virgl-components/verifier';B=R/'target/virgl-components-verifier'
h=lambda b:hashlib.sha256(b).hexdigest()
HEAD='FRAG\nDCL OUT[0], COLOR\n';IMM='IMM[0] FLT32 {0.125, 0.25, 0.5, 1}\n';TAIL='MOV OUT[0], IMM[0]\nEND\n'
cases=[]
def add(name,text,ok=True,stage=1,browser=False):cases.append(dict(name=name,text=text,ok=ok,stage=stage,browser=browser))
def program(decl,body):return HEAD+decl+IMM+body+'END\n'
# An independent set oracle, not the guard's bit operations. Swizzle positions
# are destination lanes, and their selected register lanes must already exist.
letters='xyzw';masks=['x','y','z','w','xy','xyz',''];selectors=[''.join(x) for x in itertools.product(letters,repeat=4)]
for bits in range(16):
 initialized={c for i,c in enumerate(letters) if bits//(2**i)%2}
 writes=''.join(f'MOV TEMP[9].{c}, IMM[0].{c*4}\n' for c in sorted(initialized))
 for i,sw in enumerate(selectors):
  for mask in masks:
   consumed=mask or letters;needed={sw[letters.index(c)] for c in consumed};ok=needed<=initialized
   dest='OUT[0]'+('.'+mask if mask else '')
   add(f'lane-{bits}-{sw}-{mask or "all"}',program('DCL TEMP[9]\n',writes+'MOV OUT[0], IMM[0]\n'+f'MOV {dest}, TEMP[9].{sw}\n'),ok,browser=(i in [0,27,85,108,170,228,255] and bits in [0,1,2,3,7,8,15]))
 # Aliasing validates before the same instruction's writes; ADD/MUL need both sources.
 for op in ['MOV','ADD','MUL']:
  for mask in masks:
   for sw in ['xxxx','wzyx','xyzw','yyyy']:
    needed={sw[letters.index(c)] for c in (mask or letters)}
    dest='TEMP[9]'+('.'+mask if mask else '')
    extra=', IMM[0]' if op!='MOV' else ''
    add(f'alias-{bits}-{op}-{mask or "all"}-{sw}',program('DCL TEMP[9]\n',writes+f'{op} {dest}, TEMP[9].{sw}{extra}\n'+'MOV OUT[0], IMM[0]\n'),needed<=initialized,browser=bits in [0,1,3,15] and mask in ['w','xyz'])
 # TEX consumes only xy regardless of full-vector destination.
 for i,sw in enumerate(selectors):
  add(f'tex-{bits}-{sw}',program('DCL TEMP[9]\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\n',writes+f'TEX OUT[0], TEMP[9].{sw}, SAMP[0], 2D\n'),set(sw[:2])<=initialized,browser=bits in [1,3,7,15] and i in [0,27,108,228,255])
# Bank/range and hostile syntax cases, independently constructed.
for file,limit in [('TEMP',10),('CONST',8)]:
 for first in range(limit):
  for last in range(limit):add(f'range-{file}-{first}-{last}',program(f'DCL {file}[{first}..{last}]\n','MOV OUT[0], IMM[0]\n'),first<=last,browser=True)
 for spelling in ['10','99','4294967295','18446744073709551616','-1','+1','00','9..10','0..999999999999999999999999','7..2','ADDR[0].x']:
  add(f'index-{file}-{spelling}',program(f'DCL {file}[{spelling}]\n','MOV OUT[0], IMM[0]\n'),False,browser=True)
 for decl in [f'DCL {file}[0..2]\nDCL {file}[2..3]\n',f'DCL {file}[0]\nDCL {file}[0]\n',f'DCL {file}[0..2].xyz\n']:
  add('duplicate-or-mask-'+file+'-'+h(decl.encode())[:8],program(decl,'MOV OUT[0], IMM[0]\n'),False,browser=True)
for file in ['IN','OUT','IMM','SAMP','SVIEW']:
 for index in [8,9,10]:
  if file=='IN':decl=f'DCL IN[{index}], GENERIC[0], PERSPECTIVE\n'
  elif file=='OUT':decl=f'DCL OUT[{index}], COLOR\n'
  elif file=='IMM':decl=f'IMM[{index}] FLT32 {{1, 1, 1, 1}}\n'
  elif file=='SVIEW':decl=f'DCL SVIEW[{index}], 2D, FLOAT\n'
  else:decl=f'DCL SAMP[{index}]\n'
  add(f'bank-{file}-{index}',program(decl,'MOV OUT[0], IMM[0]\n'),False,browser=True)
for sid in [7,8,9]:add(f'semantic-{sid}',program(f'DCL IN[0].xyz, GENERIC[{sid}], PERSPECTIVE\n','MOV OUT[0], IMM[0]\n'),sid==7,browser=True)
for mask in ['x','y','z','w','xz','yx','xx','xyy','zyx','xyzw','xyzwx','']:
 add('bad-declaration-'+(mask or 'empty'),program(f'DCL IN[0].{mask}, GENERIC[0], PERSPECTIVE\n','MOV OUT[0], IMM[0]\n'),False,browser=True)
for declmask in ['xy','xyz']:
 for sw in ['xxxx','yyyy','zzzz','wwww','xyzw','wzyx']:
  for mask in masks:
   need={sw[letters.index(c)] for c in (mask or letters)}
   add(f'declared-{declmask}-{sw}-{mask or "all"}',program(f'DCL IN[0].{declmask}, GENERIC[0], PERSPECTIVE\n','MOV OUT[0], IMM[0]\n'+f'MOV OUT[0]{"."+mask if mask else ""}, IN[0].{sw}\n'),need<=set(declmask),browser=True)
for mask in ['xz','yw','xw','yx','xx','xyy','zyx','xyzw','xyzwx','']:
 add('bad-destination-'+(mask or 'empty'),program('',f'MOV OUT[0].{mask}, IMM[0]\n'),False,browser=True)
for op in ['MAD','TEX']:
 for mask in ['x','y','z','w','xy','xyz']:
  decl='DCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\n' if op=='TEX' else ''
  body=f'{op} OUT[0].{mask}, IMM[0], '+('SAMP[0], 2D' if op=='TEX' else 'IMM[0], IMM[0]')+'\n'
  add(f'partial-{op}-{mask}',program(decl,body),False,browser=True)
for missing in letters:
 body=''.join(f'MOV OUT[0].{c}, IMM[0]\n' for c in letters if c!=missing)
 add('missing-output-'+missing,program('',body),False,browser=True)
for op in ['MOV_PRECISE','ADD_PRECISE','UADD','IF','DP3','ARL','MOV_SAT']:
 add('forbidden-'+op,program('',f'{op} OUT[0], IMM[0]\n'),False,browser=True)
for count in [128,129]:add(f'instructions-{count}',program('','MOV OUT[0], IMM[0]\n'*count),count==128,browser=True)
valid=HEAD+IMM+TAIL
for n in [16384,16385]:add(f'textbytes-{n}',valid+' '*(n-len(valid)),n==16384,browser=True)
# Original corpus is the historical hash authority, never a regenerated fixture.
new={'003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605','9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83','403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c','e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551'}
for item in json.loads((R/'docs/virgl-shader-original-inventory.json').read_text())['rows']:
 text=(R/item['paths'][0]).read_text();assert h(text.encode())==item['sha256']
 add('original-'+item['sha256'],text,item['sha256'] in new or item['recordedT10dOutcome']=='translated',int(item['stage']=='FRAG'),True)
# Keep replay stream under ignored target; report records and generators are sufficient to reconstruct it.
stream=bytearray();order=[]
for i,c in enumerate(cases):
 b=c['text'].encode();stream+=struct.pack('<II',c['stage'],len(b))+b;order.append(i)
 if not c['ok']:
  b=valid.encode();stream+=struct.pack('<II',1,len(b))+b;order.append(None)
(B/'cases.bin').write_bytes(stream)
base_env={**os.environ,'ASAN_OPTIONS':'abort_on_error=1','UBSAN_OPTIONS':'halt_on_error=1','LLVM_PROFILE_FILE':str(B/'native-%p.profraw')}
p=subprocess.run([str(B/'baseline')],input=stream,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=base_env)
(V/'native-run.log').write_bytes(p.stderr);assert p.returncode==0,('native failed',p.returncode,p.stderr[-1000:])
results=[json.loads(x) for x in p.stdout.splitlines()];assert len(results)==len(order)
report={'status':'running','cases':len(cases),'translations':len(order),'streamSha256':h(stream),'binarySha256':h((B/'baseline').read_bytes()),'records':[]};browser=[];recovery=None
for n,(i,result) in enumerate(zip(order,results)):
 if i is None:
  assert result['ok'];recovery=recovery or result;assert result==recovery
  continue
 c=cases[i];record={'name':c['name'],'textSha256':h(c['text'].encode()),'expected':c['ok'],'actual':result['ok'],'resultSha256':h(json.dumps(result,sort_keys=True).encode())}
 if not result['ok']:record['error']=result['error']
 report['records'].append(record)
 if result['ok']!=c['ok']:
  report.update(status='failed',failure={'case':c,'result':result,'record':n});(V/'native.json').write_text(json.dumps(report,indent=2)+'\n');raise AssertionError(report['failure'])
 if c['browser']:browser.append({**c,'native':result})
report.update(status='passed',accepted=sum(x['actual'] for x in report['records']),rejected=sum(not x['actual'] for x in report['records']),recoveries=len(order)-len(cases),browserCases=len(browser),errors=p.stderr.decode())
(V/'native.json').write_text(json.dumps(report,indent=2)+'\n');(V/'browser-cases.json').write_text(json.dumps(browser,indent=2)+'\n')
# Novel mutant bypasses ordered mapping; target requires x for destination w through xxxx.
control=next(c for c in cases if c['name']=='lane-1-xxxx-w');b=control['text'].encode()
env={**base_env,'LLVM_PROFILE_FILE':str(B/'mutant-%p.profraw')}
r=subprocess.run([str(B/'consumed-lane-omission')],input=struct.pack('<II',1,len(b))+b,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
assert r.returncode==0 and not json.loads(r.stdout)['ok'],('mutation not caught',r.stdout,r.stderr)
(V/'sabotage-native.json').write_text(json.dumps({'status':'passed','control':control,'expectedBaseline':True,'actualMutated':json.loads(r.stdout),'mutationBinarySha256':h((B/'consumed-lane-omission').read_bytes()),'stderr':r.stderr.decode()},indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='records'},indent=2))
