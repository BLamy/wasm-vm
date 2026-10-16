#!/usr/bin/env python3
"""Verifier-owned typed join/partial-write oracle, not worker fixture expectations."""
import ctypes, glob, hashlib, itertools, json, random, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
SRC=ROOT/'renderer/virgl-shader'
HEAD='f81c83b7444e3e5d8d7e52d9daa04adf1a209fc2'
sha=lambda data:hashlib.sha256(data).hexdigest()
TYPES={'constant':('MOV TEMP[{n}], CONST[45]',True,False),'input':('MOV TEMP[{n}], IN[0]',True,True),'computed':('ADD TEMP[{n}], CONST[45], IN[0]',True,True),'normal':('MOV TEMP[{n}], IMM[0].yyyy',True,True),'zero':('MOV TEMP[{n}], IMM[0].xxxx',True,True),'raw':('OR TEMP[{n}], CONST[45], IMM[0].xxxx',False,False),'subnormal':('MOV TEMP[{n}], IMM[1].xxxx',False,False),'nan':('MOV TEMP[{n}], IMM[1].yyyy',False,False)}

def shader(stage,body):
 return '\n'.join(['VERT' if stage==0 else 'FRAG','DCL IN[0]'+('' if stage==0 else ', GENERIC[0], PERSPECTIVE'),'DCL OUT[0], '+('POSITION' if stage==0 else 'COLOR'),'DCL TEMP[0..8]','DCL CONST[0..45]','IMM[0] FLT32 {0, 1, 0.5, 2}','IMM[1] UINT32 {1, 2143289344, 4294967295, 1065353216}','AND TEMP[8], CONST[0], IMM[1].zzzz','ADD TEMP[7], CONST[0], IN[0]']+body+['END'])+'\n'

def build(name,fault=False):
 flags=['-std=gnu11','-D_GNU_SOURCE','-D_DARWIN_C_SOURCE','-DUTIL_ARCH_LITTLE_ENDIAN=1','-DUTIL_ARCH_BIG_ENDIAN=0','-DHAVE___BUILTIN_CLZ=1','-DHAVE___BUILTIN_CLZLL=1','-DHAVE___BUILTIN_POPCOUNT=1']
 flags += ['-I'+str(SRC/p) for p in ['.','generated','vendor/src','vendor/src/mesa','vendor/src/mesa/pipe','vendor/src/mesa/compat','vendor/src/gallium/include','vendor/src/gallium/auxiliary','vendor/src/gallium/auxiliary/util']]
 raw=SRC/'raw_bits.c'
 if fault:
  text=raw.read_text();before='return (value.origin & RAW_OUTPUT) || safe_raw_float(value);';after='return value.origin || safe_raw_float(value);'
  assert text.count(before)==1
  raw=OUT/'fault-output-permission.c';raw.write_text(text.replace(before,after))
 sources=[str(SRC/'bridge.c'),str(raw),str(SRC/'generated/u_format_table.c'),str(SRC/'vendor/src/vrend/vrend_shader.c')]+glob.glob(str(SRC/'vendor/src/gallium/auxiliary/tgsi/*.c'))+[str(SRC/'vendor/src/gallium/auxiliary/cso_cache'/p) for p in ['cso_hash.c','cso_cache.c']]+[str(SRC/'vendor/src/mesa/util/u_debug.c')]
 target=OUT/(name+'.dylib');cmd=['clang']+flags+['-g','-O1','-dynamiclib']+sources+['-lm','-o',str(target)]
 proc=subprocess.run(cmd,cwd=SRC,capture_output=True,text=True);(OUT/(name+'-build.log')).write_text(proc.stdout+proc.stderr);assert proc.returncode==0,proc.stderr
 lib=ctypes.CDLL(str(target));lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p
 return lib,{'command':cmd,'sha256':sha(target.read_bytes()),'buildLogSha256':sha((proc.stdout+proc.stderr).encode())}

cases=[]
for stage,(selector,sel),(yes,y),(no,n),numeric in itertools.product(range(2),[('zero',0),('nonzero',1),('dynamic',None)],TYPES.items(),TYPES.items(),[False,True]):
 selected=[y,n] if sel is None else [y if sel else n]
 expected=all(x[1 if numeric else 2] for x in selected)
 condition={'zero':'IMM[0].xxxx','nonzero':'IMM[1].zzzz','dynamic':'CONST[0]'}[selector]
 body=[y[0].format(n=0),n[0].format(n=1),f'UCMP TEMP[2], {condition}, TEMP[0].wzyx, TEMP[1].yxwz','MOV TEMP[3], TEMP[2].wzyx','MOV TEMP[2], TEMP[3].yxwz']
 body+=[('ADD OUT[0], TEMP[2], IN[0]' if numeric else 'MOV OUT[0], TEMP[2]')]
 cases.append({'name':f'join-{stage}-{selector}-{yes}-{no}-{numeric}','stage':stage,'text':shader(stage,body),'ok':expected})
for stage,mask,read in itertools.product(range(2),['x','y','z','w'],['x','y','z','w']):
 body=['MOV TEMP[0], CONST[45]',f'OR TEMP[0].{mask}, TEMP[0], IMM[0].xxxx','MOV TEMP[1], IN[0]',f'ADD TEMP[1].w, TEMP[0].{read*4}, IN[0]','MOV OUT[0], TEMP[1]']
 cases.append({'name':f'partial-{stage}-{mask}-{read}','stage':stage,'text':shader(stage,body),'ok':mask!=read})
# Write all independently predicted outcomes BEFORE calling the compiler.
(OUT/'independent-inputs.json').write_text(json.dumps(cases,indent=2)+'\n')
for source in ['bridge.c','raw_bits.c','raw_bits.h']:
 assert (SRC/source).read_bytes()==subprocess.check_output(['git','show',f'{HEAD}:renderer/virgl-shader/{source}'],cwd=ROOT)
lib,build_info=build('audit-current')
fault,fault_info=build('audit-output-fault',True)
records=[];failures=[];faults=[]
for seed in [0x8319bb27,0x562dee19,0xc7a5026b]:
 order=list(cases);random.Random(seed).shuffle(order)
 for case in order:
  text=case['text'].encode();raw=lib.bridge_translate(case['stage'],text,len(text));result=json.loads(raw)
  held=result['ok']==case['ok'];record={'seed':seed,'name':case['name'],'inputSha256':sha(text),'expectedOk':case['ok'],'actual':result,'resultSha256':sha(raw),'held':held};records.append(record)
  if not held:failures.append(record)
  if result['ok']:assert result['metadata']['constantDomains']==[{'kind':'constant-bank-finite-f32-v1','stage':'vertex' if case['stage']==0 else 'fragment','slot':0,'name':'vsconst0' if case['stage']==0 else 'fsconst0','count':46}]
# Same oracle, target one conditional dynamic join; mutated permission admits raw output.
case=next(c for c in cases if c['name']=='join-1-dynamic-constant-input-False');text=case['text'].encode();raw=fault.bridge_translate(1,text,len(text));result=json.loads(raw)
faults.append({'name':case['name'],'expectedOk':False,'actual':result,'caught':result['ok'] is True,'inputSha256':sha(text)})
assert faults[0]['caught'],'targeted authority sabotage was not exposed'
(OUT/'independent-calls.jsonl').write_text(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in records))
summary={'sourceHead':HEAD,'sources':{p:sha((SRC/p).read_bytes()) for p in ['bridge.c','raw_bits.c','raw_bits.h']},'oracleCases':len(cases),'calls':len(records),'seeds':[0x8319bb27,0x562dee19,0xc7a5026b],'build':build_info,'faultBuild':fault_info,'failures':failures,'faults':faults,'inputsSha256':sha((OUT/'independent-inputs.json').read_bytes()),'callsSha256':sha((OUT/'independent-calls.jsonl').read_bytes())}
(OUT/'independent-report.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'cases':len(cases),'calls':len(records),'failures':len(failures),'sabotageCaught':faults[0]['caught']}))
assert not failures
