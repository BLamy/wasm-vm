#!/usr/bin/env python3
"""Author independent bounded structure, predecessor and authority witnesses."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CASES=[]
def expectation(stage,conditional=False):
 return {'profile':'virgl-webgl2-raw-bits-v'+('9' if conditional else '8'),'constantCount':46,'constantDomains':[{'kind':'constant-bank-finite-f32-v1','stage':stage,'slot':0,'name':('vs' if stage=='vertex' else 'fs')+'const0','count':46}] if conditional else None}
def shader(stage,body,terminal=True,texture=False):
 v=stage=='vertex'
 h=['VERT' if v else 'FRAG']+[f'DCL IN[{i}]'+('' if v else f', GENERIC[{i}], PERSPECTIVE') for i in range(3)]
 h+=['DCL OUT[0], POSITION','DCL OUT[1], GENERIC[0]'] if v else ['DCL OUT[0], COLOR']
 h+=['DCL TEMP[0..117]','DCL CONST[0..45]']
 if texture:h+=['DCL SAMP[0]','DCL SVIEW[0], 2D, FLOAT']
 h+=['IMM[0] FLT32 {0, 1, 0.5, 2}','IMM[1] UINT32 {0, 1, 2147483648, 4294967295}','IMM[2] UINT32 {2143289345, 8388607, 1065353216, 2}']
 h+=body
 if terminal:h+=['MOV OUT[1], TEMP[0]','MOV OUT[0], IN[0]','END'] if v else ['MOV OUT[0], TEMP[0]','END']
 return '\n'.join(h)+'\n'
def add(name,stage,body,ok=True,conditional=False,code='unsupported-feature',**kw):
 CASES.append({'name':name+'-'+stage,'stage':stage,'text':shader(stage,body,**kw),'ok':ok,'expected':expectation(stage,conditional) if ok else {'errorCode':code}})
def labelled(body,targets=True):
 stack=[];out=[]
 for i,line in enumerate(body):
  op=line.split()[0]
  if op=='UIF':stack.append([i,None])
  elif op=='ELSE':
   if targets:out[stack[-1][0]]+=' :'+str(i)
   stack[-1][1]=i
  elif op=='ENDIF':
   u,e=stack.pop()
   if targets:out[u if e is None else e]+=' :'+str(i)
  out.append(line)
 assert not stack
 return [str(i)+': '+line for i,line in enumerate(out)]
def main():
 for stage in ('vertex','fragment'):
  clean=['UIF IN[2].xxxx','MOV TEMP[0], IN[1]','ELSE','MOV TEMP[0], IMM[0]','ENDIF']
  for pred in ['IMM[1].xxxx','IMM[1].yyyy','IMM[1].zzzz','IMM[1].wwww','IMM[2].xxxx','IMM[2].yyyy','IMM[2].wwww','IN[2]','IN[2].yyyy','CONST[45].wzyx']:
   add('predicate-'+pred.replace('[','').replace(']',''),stage,[clean[0].replace('IN[2].xxxx',pred)]+clean[1:])
  for depth in range(1,10):
   body=['MOV TEMP[0], IN[1]']+['UIF IN[2].xxxx']*depth+['MOV TEMP[0], IMM[0]']+['ENDIF']*depth
   add('depth-'+str(depth),stage,body,depth<=8)
  for variant,body in [('full-labels',labelled(clean)),('prefix-labels',labelled(clean,False)),('branch-labels',[x.split(': ',1)[1] for x in labelled(clean)]),('no-else-target',labelled(['MOV TEMP[0],IN[1]','UIF IN[2].xxxx','MOV TEMP[0],IMM[0]','ENDIF']))]:add(variant,stage,body)
  nested=['MOV TEMP[0],IN[1]','UIF IN[2]','UIF IN[1]','MOV TEMP[0],IMM[0]','ELSE','MOV TEMP[0],IN[0]','ENDIF','ELSE','MOV TEMP[0],IN[2]','ENDIF']
  add('nested-full-labels',stage,labelled(nested))
  wrong=labelled(nested);wrong[2]=wrong[2].rsplit(':',1)[0]+':9'
  add('reject-nested-outer-target',stage,wrong,False)
  malformed={
   'dangling-else':['ELSE'],'dangling-endif':['ENDIF'],'duplicate-else':['UIF IN[2]','ELSE','ELSE','ENDIF'],
   'unclosed-end':['MOV TEMP[0],IMM[0]','UIF IN[2]'],'end-in-branch':['UIF IN[2]','END','ENDIF'],
   'wrong-uif-target':['UIF IN[2] :3','MOV TEMP[0],IMM[0]','ELSE','MOV TEMP[0],IN[1]','ENDIF'],
   'wrong-else-target':['UIF IN[2] :2','MOV TEMP[0],IMM[0]','ELSE :3','MOV TEMP[0],IN[1]','ENDIF'],
   'backward-target':['UIF IN[2] :0','ENDIF'],'huge-target':['UIF IN[2] :999','ENDIF'],
   'leading-zero-target':['UIF IN[2] :01','ENDIF'],'signed-target':['UIF IN[2] :-1','ENDIF'],
   'missing-target':['UIF IN[2] :','ENDIF'],'float-target':['UIF IN[2] :1.0','ENDIF'],
   'endif-target':['UIF IN[2]','ENDIF :2'],'extra-uif-source':['UIF IN[2],IMM[0]','ENDIF'],
   'uif-negate':['UIF -IN[2]','ENDIF'],'uif-absolute':['UIF |IN[2]|','ENDIF'],
   'uif-sampler':['UIF SAMP[0]','ENDIF'],'else-operand':['UIF IN[2]','ELSE IN[2]','ENDIF'],
   'endif-operand':['UIF IN[2]','ENDIF IN[2]'],'uif-no-source':['UIF','ENDIF'],
   'uninitialized-predicate':['UIF TEMP[117]','ENDIF'],
  }
  for name,body in malformed.items():add('reject-'+name,stage,body,False)
  for name,body,code in [
   ('wrong-prefix',['1: UIF IN[2]','ENDIF'],'parse-error'),
   ('declaration-arm',['UIF IN[2]','DCL TEMP[1]','ENDIF'],'parse-error'),
   ('empty-shader',[],'unsupported-feature'),
   ('generic-if',['IF IN[2]','ENDIF'],'unsupported-feature'),
   ('loop',['UIF IN[2]','BGNLOOP','ENDLOOP','ENDIF'],'unsupported-feature'),
   ('precise',['UIF IN[2]','MOV_PRECISE TEMP[0],IN[1]','ENDIF'],'unsupported-feature')]:add('reject-'+name,stage,body,False,code=code)
  add('reject-eof-open',stage,['UIF IN[2]'],False,terminal=False)
  add('reject-control-instruction-limit',stage,['MOV TEMP[0],IMM[0]']*179+['UIF IN[2]','ENDIF'],False)
  add('reject-no-else-wrong-target',stage,['UIF IN[2] :2','ENDIF'],False)
  add('raw-shadow-partial',stage,['MOV TEMP[0],IMM[0]','UIF IN[2]','AND TEMP[0].x,IMM[2].zzzz,IMM[2].zzzz','ELSE','NOT TEMP[0].y,IMM[1].wwww','ENDIF'])
  initcases={
   'both-lanes':(['UIF IN[2]','MOV TEMP[1].x,IN[1]','ELSE','MOV TEMP[1].x,IMM[0]','ENDIF','MOV TEMP[0],TEMP[1].xxxx'],True),
   'different-lanes':(['UIF IN[2]','MOV TEMP[1].x,IN[1]','ELSE','MOV TEMP[1].y,IMM[0]','ENDIF','MOV TEMP[0],TEMP[1].xxxx'],False),
   'one-sided':(['UIF IN[2]','MOV TEMP[1],IN[1]','ENDIF','MOV TEMP[0],TEMP[1]'],False),
   'other-arm-read':(['UIF IN[2]','MOV TEMP[1],IN[1]','ELSE','MOV TEMP[0],TEMP[1]','ENDIF'],False),
   'incoming':(['MOV TEMP[1],IN[1]','UIF IN[2]','MOV TEMP[1].x,IMM[0]','ENDIF','MOV TEMP[0],TEMP[1]'],True),
   'known-true-still-two-paths':(['UIF IMM[1].yyyy','MOV TEMP[1],IN[1]','ENDIF','MOV TEMP[0],TEMP[1]'],False),
   'y-only-predicate':(['MOV TEMP[1].y,IN[1]','UIF TEMP[1]','MOV TEMP[0],IN[1]','ELSE','MOV TEMP[0],IMM[0]','ENDIF'],False),
   'swizzled-y-predicate':(['MOV TEMP[1].y,IN[1]','UIF TEMP[1].yyyy','MOV TEMP[0],IN[1]','ELSE','MOV TEMP[0],IMM[0]','ENDIF'],True),
   'captured-lrp-gap':(['UIF IN[2]','MOV TEMP[1],IN[1]','MOV TEMP[2],IN[1]','ELSE','MOV TEMP[1],IMM[0]','ENDIF','LRP TEMP[0],IMM[0].xxxx,TEMP[2],TEMP[1]'],False),
   'captured-prior-else-gap':(['UIF IN[2]','MOV TEMP[1],IN[1]','ELSE','MOV TEMP[1],IMM[0]','MOV TEMP[2],IN[1]','ENDIF','UIF TEMP[1]','MUL TEMP[0],TEMP[2],IMM[0].yyyy','ELSE','MOV TEMP[0],IMM[0]','ENDIF'],False),
  }
  for name,(body,ok) in initcases.items():add('init-'+name,stage,body,ok,code='parse-error' if not ok and name not in ('y-only-predicate','captured-lrp-gap','captured-prior-else-gap') else 'unsupported-feature')
  # Every pair of incoming numerical representations crosses a real unknown branch.
  sources={'in':'MOV TEMP[1],IN[1]','other-in':'MOV TEMP[1],IN[0]','computed':'ADD TEMP[1],IN[1],IMM[0].yyyy','known':'MOV TEMP[1],IMM[0]','const':'MOV TEMP[1],CONST[45]','const-mov':'MOV TEMP[2],CONST[0]\nMOV TEMP[1],TEMP[2].wzyx','const-ucmp':'UCMP TEMP[1],IN[2],CONST[0],IN[1]'}
  for yes,ytext in sources.items():
   for no,ntext in sources.items():
    body=['UIF IN[2]']+ytext.splitlines()+['ELSE']+ntext.splitlines()+['ENDIF','ADD TEMP[0],TEMP[1],IMM[0].yyyy']
    add('join-'+yes+'-'+no,stage,body,conditional='const' in yes or 'const' in no)
  for op,src in [('AND','TEMP[1], CONST[0]'),('OR','TEMP[1],CONST[0]'),('NOT','TEMP[1]'),('SHL','TEMP[1],CONST[0]'),('USHR','TEMP[1],CONST[0]'),('UADD','TEMP[1],CONST[0]'),('ISGE','TEMP[1],CONST[0]'),('USEQ','TEMP[1],CONST[0]'),('USNE','TEMP[1],CONST[0]'),('FSLT','TEMP[1],CONST[0]'),('FSGE','TEMP[1],CONST[0]')]:
   add('join-raw-clobber-'+op,stage,['MOV TEMP[1],IN[1]','UIF IN[2]',op+' TEMP[1],'+src,'ENDIF','ADD TEMP[0],TEMP[1],IMM[0].yyyy'],False)
  for arm in (0,1):
   branches=['MOV TEMP[1],IN[1]','MOV TEMP[1],CONST[0]'];branches=branches if arm else branches[::-1]
   body=['UIF IN[2]',branches[0],'ELSE',branches[1],'ENDIF','MOV TEMP[0],TEMP[1]']
   add('reject-output-permission-'+str(arm),stage,body,False)
   add('output-overwrite-repairs-'+str(arm),stage,body+['MOV TEMP[0],IMM[0]'])
  for op,args in [('ADD','TEMP[1],IMM[0].yyyy'),('MUL','TEMP[1],IMM[0].yyyy'),('MAD','TEMP[1],IMM[0].yyyy,IMM[0].xxxx'),('DIV','TEMP[1],IMM[0].yyyy'),('MAX','TEMP[1],IMM[0].yyyy'),('FRC','TEMP[1]'),('LRP','IMM[0].zzzz,TEMP[1],IMM[0].yyyy'),('DP3','TEMP[1],IMM[0].yyyy'),('RCP','TEMP[1].yyyy'),('RSQ','TEMP[1].yyyy')]:
   add('numeric-'+op,stage,['UIF IN[2]','MOV TEMP[1],CONST[0]','ELSE','MOV TEMP[1],IN[1]','ENDIF',op+' TEMP[0],'+args],conditional=True)
  if stage=='fragment':add('numeric-TEX',stage,['UIF IN[2]','MOV TEMP[1],CONST[0]','ELSE','MOV TEMP[1],IN[1]','ENDIF','TEX TEMP[0],TEMP[1],SAMP[0],2D'],conditional=True,texture=True)
  for cond in (False,True):
   body=['UIF IN[2]','ADD TEMP[0],'+('CONST[0]' if cond else 'IN[1]')+',IMM[0].yyyy','ELSE','MOV TEMP[0],IMM[0]','ENDIF']
   add('retry-later-precise-'+str(cond),stage,body+['MOV_PRECISE TEMP[0],IN[1]'],False)
   add('retry-later-structural-'+str(cond),stage,body+['ELSE'],False)
  for size in (178,179,180):
   # terminal output writes count toward the existing non-END limit.
   n=size-(2 if stage=='vertex' else 1)-4
   body=['UIF IN[2]','MOV TEMP[0],IMM[0]','ENDIF']+['ADD TEMP[0],CONST[0],IMM[0].yyyy']+['MOV TEMP[0],TEMP[0]']*n
   add('instruction-count-'+str(size),stage,body,size<=179,conditional=True,code='unsupported-feature')
  # Fully numeric MAD + materialized MOV expansion hits the fixed GLSL bound.
  body=['UIF IN[2]','MOV TEMP[0],IN[1]','ELSE','MOV TEMP[0],IN[1]','ENDIF']+['MAD TEMP[0],CONST[0],CONST[1],CONST[2]']*(172 if stage=='vertex' else 173)
  add('conditional-emitter-overflow',stage,body,False)
 assert len({c['name'] for c in CASES})==len(CASES)
 (ROOT/'renderer/virgl-shader/tests/structured-conditional-cases.json').write_text(json.dumps(CASES,indent=2)+'\n')
 print(len(CASES))
if __name__=='__main__':main()
