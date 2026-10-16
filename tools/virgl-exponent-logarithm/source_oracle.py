"""Independently read source-level operands/versions, before carrier encoding.

This interpreter stops before the diagnostic carrier instructions. It derives
which real equation or untouched word must appear from the original TGSI,
never from its GLSL, a worker's selected list, or observed physical bytes.
"""
import re
from reference import predict,accepts
def result_rows(text,condition,bank_a,bank_b,backend):
 regs={('CONST',0):bank_a,('CONST',45):bank_b,('CONST',43):[condition,0,0,0]};active=True;stack=[]
 def source(s):
  match=re.fullmatch(r'(-?)(IMM|TEMP|CONST)\[(\d+)\](?:\.([xyzw]{4}))?',s);assert match,s
  neg,file,index,swizzle=match.groups();words=regs.get((file,int(index)),[0]*4);out=[words['xyzw'.index(c)] for c in swizzle or 'xyzw']
  if neg:out=[w^0x80000000 for w in out]
  return out
 for line in text.splitlines():
  line=line.strip()
  if not line or line.startswith(('VERT','FRAG','DCL')):continue
  if line.startswith('IMM'):
   m=re.fullmatch(r'IMM\[(\d+)\] UINT32 \{([0-9,]+)\}',line);assert m,line
   regs[('IMM',int(m[1]))]=[int(w) for w in m[2].split(',')];continue
  if line.startswith('UIF '):stack.append((active,bool(source(line[4:])[0])));active=active and stack[-1][1];continue
  if line=='ELSE':parent,yes=stack[-1];active=parent and not yes;continue
  if line=='ENDIF':active=stack.pop()[0];continue
  if line.startswith(('AND TEMP[1], TEMP[0]','USHR TEMP[1], TEMP[0]')):break
  if not active:continue
  m=re.fullmatch(r'(MOV|EX2|LG2|UADD|AND|OR) (TEMP)\[(\d+)\](?:\.([xyzw]+))?, (.*)',line);assert m,line
  op,file,index,mask,args=m.groups();index=int(index);mask=mask or 'xyzw';values=[source(s) for s in args.split(', ')]
  if op=='MOV':out=values[0]
  elif op in ['EX2','LG2']:out=[dict(op=op,word=values[0][i if backend=='mesa' else 0]) for i in range(4)]
  elif op=='UADD':out=[(a+b)&0xffffffff for a,b in zip(*values)]
  elif op=='AND':out=[a&b for a,b in zip(*values)]
  else:out=[a|b for a,b in zip(*values)]
  old=regs.get((file,index),[None]*4).copy()
  for lane,c in enumerate('xyzw'):
   if c in mask:old[lane]=out[lane]
  regs[(file,index)]=old
 assert not stack,'balanced independent source flow'
 out=regs[('TEMP',0)];assert all(v is not None for v in out)
 return [predict(v['op'],v['word']) if isinstance(v,dict) else {'exact':v} for v in out]
def allowed(row,w):return row['exact']==w if 'exact' in row else accepts(row,w)
