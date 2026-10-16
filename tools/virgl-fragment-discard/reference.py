#!/usr/bin/env python3
"""Literal TGSI execution and half-pixel coverage before hardware observation.

The compiler classifies integer encodings. This oracle decodes IEEE binary32
with Python's struct module and uses ordered host floating-point comparison.
It never reads emitted GLSL, metadata, a GPU value or a capture-derived constant.
"""
from pathlib import Path
import hashlib,json,re,struct,subprocess,sys

def digest(raw):return hashlib.sha256(raw).hexdigest()
def floating(word):return struct.unpack('<f',struct.pack('<I',word))[0]
def encoding(value):return struct.unpack('<I',struct.pack('<f',value))[0]
def execute(text,words,x,y):
 registers={('CONST',i//4):words[i:i+4]for i in range(0,len(words),4)}
 registers[('IN',0)]=[encoding(x+.5),encoding(y+.5),0,encoding(1)]
 stack=[];active=True
 def operand(token):
  m=re.fullmatch(r'(-?)(\|?)(CONST|IN|TEMP|IMM)\[(\d+)\](?:\.([xyzw]{4}))?(\|?)',token);assert m,token
  negative,absolute,file,index,swizzle,close=m.groups();assert absolute==close
  value=[registers[(file,int(index))]['xyzw'.index(c)]for c in (swizzle or 'xyzw')]
  # Source word modifiers are applied before any numeric interpretation. This
  # also retains payloads for copies. The discard predicate below uses decode.
  if absolute:value=[w&0x7fffffff for w in value]
  if negative:value=[w^0x80000000 for w in value]
  return value
 for line in text.splitlines():
  if not line or line.startswith(('FRAG','DCL','PROPERTY')):continue
  if line.startswith('IMM['):
   m=re.fullmatch(r'IMM\[(\d+)\] (UINT32|FLT32) \{(.+)\}',line);assert m,line
   registers[('IMM',int(m[1]))]=[int(v)if m[2]=='UINT32'else encoding(float(v))for v in m[3].split(',')];continue
  op,*rest=line.split(' ',1)
  if op=='END':break
  if op=='UIF':
   selected=operand(rest[0])[0]!=0 if active else False
   stack.append((active,selected));active=active and selected;continue
  if op=='ELSE':active=stack[-1][0] and not stack[-1][1];continue
  if op=='ENDIF':active=stack.pop()[0];continue
  if not active:continue
  if op=='KILL':return True
  if op=='KILL_IF':
   if any(floating(w)<0.0 for w in operand(rest[0])):return True
   continue
  tokens=rest[0].split(', ');destination=re.fullmatch(r'(TEMP|OUT)\[(\d+)\](?:\.([xyzw]+))?',tokens[0]);assert destination,line
  file,index,mask=destination.groups();key=(file,int(index));mask=mask or 'xyzw';args=[operand(t)for t in tokens[1:]]
  if op=='MOV':values=args[0]
  elif op=='FSLT':values=[0xffffffff if floating(a)<floating(b)else 0 for a,b in zip(*args)]
  elif op=='AND':values=[a&b for a,b in zip(*args)]
  else:raise ValueError('unsupported literal reference operation '+op)
  previous=registers.setdefault(key,[None]*4)
  for c in mask:lane='xyzw'.index(c);previous[lane]=values[lane]
 assert not stack
 assert registers[('OUT',0)]==[encoding(v)for v in [.25,.5,.75,1]],'literal written color obligation'
 return False

def prediction(probe):
 g=probe['geometry'];x0,y0,w,h=g['viewport'];points=[]
 # The supplied two triangles cover the complete viewport: clip coordinates
 # are exact +/-1, w=1. No inverse fitted to observed raster data is used.
 assert g['vertices']==[[-1,-1,0,1],[1,-1,0,1],[-1,1,0,1],[-1,1,0,1],[1,-1,0,1],[1,1,0,1]]
 assert g['indices']==[0,1,2,3,4,5]
 for y in range(g['height']):
  for x in range(g['width']):
   inside=x0<=x<x0+w and y0<=y<y0+h
   killed=execute(probe['text'],probe['words'],x,y)if inside else None
   written=inside and not killed
   points.append(dict(x=x,y=y,inside=inside,discarded=killed,written=written,rgba=[64,128,191,255]if written else[17,34,51,68]))
 return dict(textSha256=digest(probe['text'].encode()),geometry=g,points=points)

def main():
 seed=int(sys.argv[1]);out=Path(sys.argv[2]);root=Path(__file__).resolve().parents[2]
 raw=subprocess.check_output(['node','--input-type=module','-e',f"import{{physicalPlan}}from'./tools/virgl-fragment-discard/cases.mjs';process.stdout.write(JSON.stringify(physicalPlan({seed})));"],cwd=root)
 plan=json.loads(raw);result=dict(schema='fragment-discard-literal-reference-v1',task='E6-T12g6l',seed=seed,sourceSha256=digest(Path(__file__).read_bytes()),planSha256=digest(raw),rows=[prediction(probe)for probe in plan])
 out.write_text(json.dumps(result,separators=(',',':'))+'\n');print(f'{len(plan)} literal discard/half-pixel predictions before observation.')
if __name__=='__main__':main()
