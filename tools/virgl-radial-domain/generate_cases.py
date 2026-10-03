#!/usr/bin/env python3
"""Authored radial predicate cases; captured bodies are only labelled structure ports."""
import hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
THRESHOLD=0x3727c5ac

def contracts(stage,count,profile,indices=None,loop=False):
 name=('vs' if stage=='vertex' else 'fs')+'const0';base=dict(stage=stage,slot=0,name=name,count=count)
 e={'profile':'virgl-webgl2-raw-bits-v'+str(profile),'constantCount':count,
    'constantDomains':[dict(base,kind='constant-bank-finite-f32-v1')],
    'constantRadialDomains':[dict(base,kind='constant-bank-radial-coefficient-f32-v1',register=4,component=0,minimumMagnitude=THRESHOLD)]}
 if indices:e['constantAccesses']=[dict(base,kind='constant-bank-static-indirect-v1',indices=indices)]
 if loop:e['constantConstraints']=[dict(base,kind='constant-bank-counted-table-i32-v1',register=9,component=0,maximum=18)]
 return e

def mini(stage,offset=0,lane='x',nested=False,indirect=False):
 r=lambda i:f'TEMP[{i+offset}]'; sw=lane*4
 header=['VERT' if stage=='vertex' else 'FRAG', 'DCL IN[0]' if stage=='vertex' else 'DCL IN[0], GENERIC[0], CONSTANT',
   'DCL OUT[0], POSITION' if stage=='vertex' else 'DCL OUT[0], COLOR']
 if stage=='vertex':header+=['DCL OUT[1], GENERIC[0]']
 header+=['DCL CONST[0..5]','DCL TEMP[0..117]']
 if indirect:header+=['DCL ADDR[0]']
 header+=[f'IMM[0] UINT32 {{{THRESHOLD},0,1065353216,5}}']
 if indirect:prefix=[f'MOV {r(7)}.x, IMM[0].wwww',f'UARL ADDR[0].x, {r(7)}.xxxx']
 else:prefix=[]
 body=[f'MAX {r(0)}.{lane}, CONST[4].xxxx, -CONST[4].xxxx',
       f'FSLT {r(1)}.{lane}, {r(0)}.{sw}, IMM[0].xxxx', f'UIF {r(1)}.{sw}',
       f'MOV {r(3)}, IMM[0].yyyy','ELSE',
       f'MOV {r(2)}, '+('CONST[ADDR[0].x]' if indirect else 'CONST[5]'), 'ENDIF',
       f'ADD {r(4)}, {r(2)}, IMM[0].yyyy']
 if nested:
  body=[f'UIF IMM[0].zzzz',f'MOV {r(6)}, IMM[0].yyyy','ELSE']+body+[f'MOV {r(6)}, {r(4)}','ENDIF']
  # Enter the outer ELSE; selector is a raw zero, not float zero testing.
  body[0]='UIF IMM[0].yyyy';result=r(6)
 else:result=r(4)
 if stage=='vertex':body += ['MOV OUT[0], IN[0]',f'MOV OUT[1], {result}']
 else:body+=[f'MOV OUT[0], {result}']
 return '\n'.join(header+prefix+body+['END'])+'\n'

def main():
 cases=[];kernels=[]
 for stage in ('vertex','fragment'):
  for label,offset,lane,nested,indirect in [('plain',0,'x',False,False),('renamed',23,'w',False,False),('nested',50,'y',True,False),('indirect',80,'z',False,True)]:
   text=mini(stage,offset,lane,nested,indirect);name=label+'-'+stage
   cases.append(dict(name=name,stage=stage,text=text,ok=True,expected=contracts(stage,6,15 if indirect else 14,[5] if indirect else None)))
   kernels.append({'case':name,'stage':stage,'kind':'mini','count':6})
  base=mini(stage);mutations={
   'wrong-constant':base.replace('CONST[4].xxxx','CONST[3].xxxx'),
   'wrong-component':base.replace('CONST[4].xxxx','CONST[4].yyyy'),
   'missing-negation':base.replace('-CONST[4].xxxx','CONST[4].xxxx'),
   'both-negative':base.replace(', CONST[4].xxxx, -',', -CONST[4].xxxx, -'),
   'wrong-threshold':base.replace(str(THRESHOLD),str(THRESHOLD+1)),
   'reversed-comparison':base.replace('FSLT TEMP[1].x, TEMP[0].xxxx, IMM[0].xxxx','FSLT TEMP[1].x, IMM[0].xxxx, TEMP[0].xxxx'),
   'changed-predicate':base.replace('FSLT TEMP[1]','FSGE TEMP[1]'),
   'wrong-selector-lane':base.replace('UIF TEMP[1].xxxx','UIF TEMP[1].yyyy'),
   'condition-clobber':base.replace('UIF TEMP[1].xxxx','MOV TEMP[1].x, IMM[0].zzzz\nUIF TEMP[1].xxxx'),
   'magnitude-clobber':base.replace('FSLT TEMP[1]','MOV TEMP[0].x, IMM[0].zzzz\nFSLT TEMP[1]'),
   'no-else-definition':base.replace('MOV TEMP[2], CONST[5]','MOV TEMP[2].x, CONST[5].xxxx'),
   'unrelated-missing':base.replace('ADD TEMP[4], TEMP[2]','ADD TEMP[4], TEMP[8]'),
   'precise-gated':base.replace('MAX TEMP[0]','MAX_PRECISE TEMP[0]'),
   'second-certificate':base.replace('ADD TEMP[4]', 'MAX TEMP[9].x, CONST[4].xxxx, -CONST[4].xxxx\nFSLT TEMP[10].x, TEMP[9].xxxx, IMM[0].xxxx\nUIF TEMP[10].xxxx\nMOV TEMP[3], IMM[0].yyyy\nELSE\nMOV TEMP[3], IMM[0].yyyy\nENDIF\nADD TEMP[4]')}
  for label,text in mutations.items():cases.append(dict(name='reject-'+label+'-'+stage,stage=stage,text=text,ok=False,expected={'errorCode':'unsupported-feature'}))
 # Exact original source is preserved; these explicitly unmarked ports isolate
 # the radial graph until the separate PRECISE task. They are NOT originals.
 captures=['a6143f113a7d0a3ce6118a518c12bc7c537bebfdfa9a0af6580496709188379e','e911b393909ab041c24f608b41497143eba765cc8d7db1206a47896934d43c51']
 for index,digest in enumerate(captures):
  path=ROOT/f'evidence/virgl-corpus/captures/glmark2-es2/shaders/{digest}.tgsi';raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==digest
  original=raw.decode('ascii');unmarked=original.replace('_PRECISE','');text=re.sub(r'MOV TEMP\[0\]\.w, (TEMP\[\d+\]\.[xyzw]{4})',r'ADD TEMP[0].w, \1, IMM[1].yyyy',unmarked);assert text!=unmarked;name='unmarked-structural-port-'+('nested' if index==0 else 'loop')+'-fragment'
  cases.append(dict(name=name,stage='fragment',text=text,ok=True,expected=contracts('fragment',26 if index==0 else 46,14 if index==0 else 16,list(range(10,46)) if index else None,bool(index)),derivedFrom={'path':str(path.relative_to(ROOT)),'sha256':digest,'operation':'explicit authored removal of PRECISE suffixes and numeric ADD-zero alpha output projection; original remains gated'}))
  kernels.append({'case':name,'stage':'fragment','kind':'structural-port','count':26 if index==0 else 46})
  cases.append(dict(name='reject-no-alpha-view-'+name,stage='fragment',text=unmarked,ok=False,expected={'errorCode':'unsupported-feature'}))
 # The pre-existing exact counted-table graph plus an independent radial edge.
 held=json.loads((ROOT/'renderer/virgl-shader/tests/bounded-loop-cases.json').read_bytes())
 for stage in ('vertex','fragment'):
  base=next(x['text'] for x in held if x['name']=='loop-small-'+stage)
  intro=f'IMM[4] UINT32 {{{THRESHOLD},0,0,0}}\nMAX TEMP[110].w, CONST[4].xxxx, -CONST[4].xxxx\nFSLT TEMP[111].w, TEMP[110].wwww, IMM[4].xxxx\nUIF TEMP[111].wwww\nMOV TEMP[113], IMM[3].yyyy\nELSE\nMOV TEMP[112], CONST[5]\nENDIF\nADD TEMP[113], TEMP[112], IMM[3].zzzz\n'
  text=base.replace('MOV TEMP[0].x',intro+'MOV TEMP[0].x',1)
  # Force the selected initialized result to be an actual observable consumer.
  text=text.replace('MOV OUT[1], IN[0]','MOV OUT[1], TEMP[113]').replace('MOV OUT[0], IN[1]','MOV OUT[0], TEMP[113]')
  name='loop-'+stage;cases.append(dict(name=name,stage=stage,text=text,ok=True,expected=contracts(stage,46,16,list(range(10,46)),True)))
  kernels.append({'case':name,'stage':stage,'kind':'mini','count':46})
 pairs=[]
 for label in ('plain','indirect','loop'):
  pairs.append(dict(name=label+'-pair',vertex=label+'-vertex',fragment=label+'-fragment',ok=True))
  pairs.append(dict(name=label+'-vertex-mixed-pair',vertex=label+'-vertex',fragment='loop::loop-small-fragment',ok=True))
  pairs.append(dict(name=label+'-fragment-mixed-pair',vertex='loop::loop-small-vertex',fragment=label+'-fragment',ok=True))
 for item in cases:
  if not item['ok']:
   pairs.append(dict(name=item['name']+'-pair',vertex=item['name'] if item['stage']=='vertex' else 'plain-vertex',fragment=item['name'] if item['stage']=='fragment' else 'plain-fragment',ok=False))
 partners=json.loads((ROOT/'renderer/virgl-command/tests/bounded-loops-shaders.json').read_bytes())
 for item in partners['shaders']:
  if item['name'].startswith('pass-'):
   cases.append(dict(name=item['name'],stage=item['stage'],text=item['text'],ok=True,expected={'profile':'virgl-webgl2-straight-line-v5','constantCount':0}))
 for kernel in kernels:
  pairs.append(dict(name='gpu-'+kernel['case']+'-pair',vertex=kernel['case'] if kernel['stage']=='vertex' else 'pass-vertex',fragment=kernel['case'] if kernel['stage']=='fragment' else 'pass-fragment',ok=True))
 result={'schema':'radial-domain-cases-v1','thresholdWord':THRESHOLD,'cases':cases,'pairs':pairs,'kernels':kernels}
 output=ROOT/'renderer/virgl-shader/tests/radial-domain-cases.json';output.write_text(json.dumps(result,indent=2)+'\n')
 print('Authored radial cases:',len(cases),'hardware kernels:',len(kernels))
if __name__=='__main__':main()
