#!/usr/bin/env python3
"""Bounded independently predicted declaration-order and stage-bank identity attack."""
import ctypes,hashlib,json
from pathlib import Path
OUT=Path(__file__).resolve().parent
LIB=OUT/'audit-current.dylib';lib=ctypes.CDLL(str(LIB));lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p
lib.bridge_translate_pair.argtypes=[ctypes.c_char_p,ctypes.c_size_t,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate_pair.restype=ctypes.c_char_p
cases=[]
for stage in range(2):
 for name,declarations,index,count in [('only-zero',['DCL CONST[0]'],0,1),('only-high',['DCL CONST[45]'],45,46),('low-high',['DCL CONST[0]','DCL CONST[45]'],45,46),('high-low',['DCL CONST[45]','DCL CONST[0]'],0,47)]:
  body=['VERT' if not stage else 'FRAG','DCL IN[0]'+('' if not stage else ', GENERIC[0], PERSPECTIVE'),'DCL OUT[0], '+('POSITION' if not stage else 'COLOR')]
  if not stage:body+=['DCL OUT[1], GENERIC[0]']
  body+=declarations+[f'RCP OUT[0], CONST[{index}].zzzz']
  if not stage:body+=['MOV OUT[1], IN[0]']
  text='\n'.join(body+['END'])+'\n'
  cases.append({'name':f'{name}-{stage}','stage':stage,'text':text,'expectedCount':count})
(OUT/'extent-inputs.json').write_text(json.dumps(cases,indent=2)+'\n')
results=[]
for c in cases:
 text=c['text'].encode();raw=lib.bridge_translate(c['stage'],text,len(text));r=json.loads(raw);s='fragment' if c['stage'] else 'vertex';name=('fs' if c['stage'] else 'vs')+'const0'
 assert r['ok'] and r['metadata']['constantDomains']==[{'kind':'constant-bank-finite-f32-v1','stage':s,'slot':0,'name':name,'count':c['expectedCount']}]
 assert r['metadata']['uniforms'][0]['count']==c['expectedCount']
 results.append({'name':c['name'],'result':r,'sha256':hashlib.sha256(raw).hexdigest()})
pairs=[]
for v in cases[:4]:
 for f in cases[4:]:
  a,b=v['text'].encode(),f['text'].encode();raw=lib.bridge_translate_pair(a,len(a),b,len(b));r=json.loads(raw);assert r['ok']
  for key,c in [('vertex',v),('fragment',f)]:assert r[key]['metadata']['constantDomains']==next(e['result']['metadata']['constantDomains'] for e in results if e['name']==c['name'])
  pairs.append({'vertex':v['name'],'fragment':f['name'],'result':r,'sha256':hashlib.sha256(raw).hexdigest()})
report={'sourceHead':'f81c83b7444e3e5d8d7e52d9daa04adf1a209fc2','binarySha256':hashlib.sha256(LIB.read_bytes()).hexdigest(),'singles':results,'pairs':pairs,'status':'passed'}
(OUT/'extent-report.json').write_text(json.dumps(report,indent=2)+'\n');print('8 standalone + 16 pair declaration-order/extent predictions HELD, including host-only extent47.')
