#!/usr/bin/env python3
"""Independent branch-initialization model and concrete structural adversaries."""
import ctypes,hashlib,json,random,subprocess,glob
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
HEAD='242ad5705dbdfd07b269c3e5850857c893af41e7'
COMP=ROOT/'renderer/virgl-shader'
def sha(b):return hashlib.sha256(b).hexdigest()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==HEAD
sources=['bridge.c','raw_bits.c','generated/u_format_table.c','vendor/src/vrend/vrend_shader.c']+sorted(str(p.relative_to(COMP)) for p in COMP.glob('vendor/src/gallium/auxiliary/tgsi/*.c'))+['vendor/src/gallium/auxiliary/cso_cache/cso_hash.c','vendor/src/gallium/auxiliary/cso_cache/cso_cache.c','vendor/src/mesa/util/u_debug.c']
command=['clang','-shared','-fPIC','-O1','-g','-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1']+['-I'+v for v in ['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']]+sources+['-lm','-o',str(OUT/'audit-current.dylib')]
with (OUT/'independent-build.log').open('w') as log:subprocess.run(command,cwd=COMP,stdout=log,stderr=subprocess.STDOUT,check=True)
lib=ctypes.CDLL(str(OUT/'audit-current.dylib')); lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p
header='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL IN[1], GENERIC[1], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL TEMP[0..2]\nIMM[0] FLT32 {0.125, 0.25, 0.5, 1}\nIMM[1] UINT32 {0, 2147483648, 2143289345, 4294967295}\n'
def emitwrite(reg,mask):return [f'MOV TEMP[{reg}].{c}, IMM[0]' for i,c in enumerate('xyzw') if mask>>i&1]
records=[]
def check(name,body,expected,kind):
    text=header+'\n'.join(body)+'\n';raw=text.encode();result=json.loads(lib.bridge_translate(1,raw,len(raw)))
    row={'name':name,'kind':kind,'source':text,'sha256':sha(raw),'predicted':expected,'observed':result}
    records.append(row)
    if result['ok'] is not expected:raise AssertionError((name,expected,result,text))
    if expected:assert result['metadata']['profile']=='virgl-webgl2-raw-bits-v8'
# Exhaustive masks: every incoming/true/false combination and four later reads.
for incoming in range(16):
 for yes in range(16):
  for no in range(16):
   for lane in range(4):
    body=emitwrite(0,incoming)+['UIF IN[1]']+emitwrite(0,yes)+['ELSE']+emitwrite(0,no)+['ENDIF',f'MOV OUT[0], TEMP[0].'+('xyzw'[lane]*4),'END']
    expected=bool((incoming|(yes&no))&(1<<lane))
    check(f'masks-{incoming}-{yes}-{no}-{lane}',body,expected,'exhaustive-join')
# Independent nested AST model includes predicate reads after one-sided writes.
rng=random.Random(0xB39D0271)
def generate(depth):
 out=[]
 for _ in range(rng.randrange(1,4)):
  if depth and rng.randrange(3)==0:
   pred=None if rng.randrange(3) else (rng.randrange(2),rng.randrange(4))
   out.append(('if',pred,generate(depth-1),generate(depth-1) if rng.randrange(2) else []))
  else:out.append(('write',rng.randrange(2),rng.randrange(16)))
 return out
def run(nodes,facts):
 lines=[];valid=True;facts=facts[:]
 for node in nodes:
  if node[0]=='write':
   _,reg,mask=node;lines+=emitwrite(reg,mask);facts[reg]|=mask
  else:
   _,pred,yes,no=node
   if pred:
    reg,lane=pred;valid &= bool(facts[reg]&(1<<lane));operand=f'TEMP[{reg}].'+('xyzw'[lane]*4)
   else:operand=rng.choice(['IN[1]','IMM[1].xxxx','IMM[1].yyyy','IMM[1].zzzz','IMM[1].wwww'])
   a,ta,va=run(yes,facts);b,tb,vb=run(no,facts);valid&=va and vb;facts=[a[i]&b[i] for i in range(2)];lines+=['UIF '+operand]+ta+(['ELSE']+tb if no else [])+['ENDIF']
 return facts,lines,valid
for case in range(1500):
 incoming=[rng.randrange(16),rng.randrange(16)];ast=[('if',None,generate(rng.randrange(3)),generate(rng.randrange(3)))];facts,body,valid=run(ast,incoming);reg,lane=rng.randrange(2),rng.randrange(4)
 body=emitwrite(0,incoming[0])+emitwrite(1,incoming[1])+body+[f'MOV OUT[0], TEMP[{reg}].'+('xyzw'[lane]*4),'END']
 check(f'nested-{case}',body,valid and bool(facts[reg]&(1<<lane)),'nested-initialization')
# Structural rejection and limits, authored without loading worker fixtures.
tail=['MOV OUT[0], IMM[0]','END']
attacks={
'dangling-else':['ELSE'],'dangling-endif':['ENDIF'],'double-else':['UIF IN[1]','ELSE','ELSE','ENDIF'],
'open-end':['UIF IN[1]'],'early-end':['UIF IN[1]','END','ENDIF'],
'outer-target':['UIF IN[1] :5','UIF IN[1] :5','ELSE','ENDIF','ELSE','ENDIF'],
'wrong-uif-target':['UIF IN[1] :1','MOV TEMP[0],IMM[0]','ELSE','ENDIF'],
'wrong-else-target':['UIF IN[1] :1','ELSE :2','MOV TEMP[0],IMM[0]','ENDIF'],
'endif-label':['UIF IN[1]','ENDIF :2'],'uninitialized':['UIF TEMP[2]','ENDIF'],
'initialized-y-only':emitwrite(2,2)+['UIF TEMP[2]','ENDIF'],
'depth-nine':['UIF IN[1]']*9+['ENDIF']*9,
'generic-if':['IF IN[1]','ENDIF'],'cont':['UIF IN[1]','CONT','ENDIF'],
'loop':['BGNLOOP','ENDLOOP'],'signed-target':['UIF IN[1] :-1','ENDIF']}
for name,body in attacks.items():check(name,body+tail,False,'structure')
check('depth-eight',['UIF IN[1]']*8+['ENDIF']*8+tail,True,'structure')
check('matching-nested-labels',['0: UIF IN[1] :4','1: UIF IN[1] :2','2: ELSE :3','3: ENDIF','4: ELSE :5','5: ENDIF']+tail,True,'structure')
check('matching-no-else',['UIF IN[1] :1','ENDIF']+tail,True,'structure')
check('explicit-initialized-y',emitwrite(2,2)+['UIF TEMP[2].yyyy','ENDIF']+tail,True,'structure')
with (OUT/'independent-results.jsonl').open('w') as f:
 for row in records:f.write(json.dumps(row,separators=(',',':'))+'\n')
summary={'status':'passed','sourceHead':HEAD,'seed':'b39d0271','cases':len(records),'accepted':sum(r['predicted'] for r in records),'rejected':sum(not r['predicted'] for r in records),'kinds':{k:sum(r['kind']==k for r in records) for k in sorted({r['kind'] for r in records})},'resultsSha256':sha((OUT/'independent-results.jsonl').read_bytes()),'sources':[{'path':str((COMP/s).relative_to(ROOT)),'sha256':sha((COMP/s).read_bytes())} for s in sources],'buildCommand':command,'binarySha256':sha((OUT/'audit-current.dylib').read_bytes())}
(OUT/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:v for k,v in summary.items() if k not in ('sources','buildCommand')}))
