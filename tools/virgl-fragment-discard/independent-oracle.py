#!/usr/bin/env python3
"""Independent critic: decoded TGSI values and literal clip rectangle; no GLSL or recorded expectations."""
import argparse,struct,re,json,hashlib,subprocess
from pathlib import Path

def word(v):return struct.unpack('<I',struct.pack('<f',v))[0]
def floating(w):return struct.unpack('<f',struct.pack('<I',w))[0]
def killed(text,bank,x,y):
 regs={('CONST',i):list(bank[i*4:i*4+4]) for i in range(len(bank)//4)}
 regs['IN',0]=[word(x+.5),word(y+.5),word(.5),word(1.)]
 enabled=[True];choices=[]
 def read(token):
  m=re.fullmatch(r'(-?)(\|?)(IMM|CONST|TEMP|IN)\[(\d+)\](?:\.([xyzw]{4}))?(\|?)',token)
  assert m,'literal operand '+token
  negative,absolute,file,index,swizzle,close=m.groups();assert absolute==close
  result=[regs[file,int(index)]['xyzw'.index(c)] for c in (swizzle or 'xyzw')]
  assert all(v is not None for v in result),'literal source initialized'
  if absolute:result=[v&0x7fffffff for v in result]
  if negative:result=[v^0x80000000 for v in result]
  return result
 for raw in text.splitlines():
  line=re.sub(r'^\d+:\s*','',raw).strip()
  if not line or line=='FRAG' or line.startswith(('PROPERTY ','DCL ')):continue
  imm=re.fullmatch(r'IMM\[(\d+)\] (FLT32|UINT32) \{(.*)\}',line)
  if imm:
   i,kind,values=imm.groups();regs['IMM',int(i)]=[int(v) if kind=='UINT32' else word(float(v)) for v in values.split(',')];continue
  opcode,_,args=line.partition(' ')
  if opcode=='END':break
  if opcode=='UIF':
   choices.append(read(args)[0]!=0 if enabled[-1] else False);enabled.append(enabled[-1] and choices[-1]);continue
  if opcode=='ELSE':enabled[-1]=enabled[-2] and not choices[-1];continue
  if opcode=='ENDIF':enabled.pop();choices.pop();continue
  if not enabled[-1]:continue
  if opcode=='KILL':return True
  if opcode=='KILL_IF':
   values=read(args)
   if any(floating(v)<0. for v in values):return True
   continue
  tokens=args.split(', ');m=re.fullmatch(r'(OUT|TEMP)\[(\d+)\](?:\.([xyzw]+))?',tokens[0]);assert m,line
  file,index,mask=m.groups();operands=[read(v) for v in tokens[1:]]
  if opcode=='MOV':new=list(operands[0])
  elif opcode=='AND':new=[a&b for a,b in zip(*operands)]
  elif opcode=='OR':new=[a|b for a,b in zip(*operands)]
  elif opcode=='FSLT':new=[0xffffffff if floating(a)<floating(b) else 0 for a,b in zip(*operands)]
  else:raise AssertionError('unmodeled literal instruction '+opcode)
  existing=regs.setdefault((file,int(index)),[None]*4)
  for c in mask or 'xyzw':existing['xyzw'.index(c)]=new['xyzw'.index(c)]
 assert enabled==[True] and not choices
 assert regs['OUT',0]==[word(.25),word(.5),word(.75),word(1.)],'literal color'
 return False

def pixels(probe,width=None,height=None):
 g=probe['geometry'];width=width or g['width'];height=height or g['height']
 assert g['vertices']==[[-1,-1,0,1],[1,-1,0,1],[-1,1,0,1],[-1,1,0,1],[1,-1,0,1],[1,1,0,1]] and g['indices']==list(range(6))
 x0,y0,w,h=g['viewport'];out=[]
 for y in range(height):
  for x in range(width):
   inside=x0<=x<x0+w and y0<=y<y0+h
   discarded=killed(probe['text'],probe['words'],x,y) if inside else None
   out.append(dict(x=x,y=y,inside=inside,discarded=discarded,rgba=[64,128,191,255] if inside and not discarded else [17,34,51,68]))
 return out

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('report',type=Path);parser.add_argument('output',type=Path)
 args=parser.parse_args();raw=args.report.read_bytes();report=json.loads(raw);a=report['acceptance']
 root=Path(__file__).resolve().parents[2];seed=a['seed'];assert isinstance(seed,int) and 0<=seed<=0xffffffff
 planned=subprocess.check_output(['node','--input-type=module','-e',f"import{{physicalPlan}}from'./tools/virgl-fragment-discard/cases.mjs';process.stdout.write(JSON.stringify(physicalPlan({seed})));"],cwd=root)
 plan=json.loads(planned);assert hashlib.sha256(planned).hexdigest()==a['planSha256']
 # Materialize literal source/geometry predictions before consulting raw cells.
 predictions=[pixels(p)for p in plan]
 selected={c['sourceIndex']for consumer in a['consumers']for c in consumer['captures']}
 indexed={i:pixels(plan[i],width=32,height=32)for i in selected}
 assert report['status']==a['status']==('failed'if a['fault']else'passed')
 assert len(a['probes'])<=len(plan)
 if not a['fault']:assert len(a['probes'])==len(plan)
 rows=[];checked=qualified=0;faults=[]
 def compare(probe,points,strict):
  data=bytes(probe['rgbaBytes']);assert hashlib.sha256(data).hexdigest()==probe['sha256']
  assert len(data)==len(points)*4
  failures=[];qualifications=0
  for i,p in enumerate(points):
   observed=list(data[i*4:i*4+4])
   if observed!=p['rgba']:
    if not strict and p['inside'] and observed in [[17,34,51,68],[64,128,191,255]]:qualifications+=1
    else:failures.append(dict(x=p['x'],y=p['y'],expected=p['rgba'],observed=observed))
  return dict(name=probe['name'],pixels=len(points),rawSha256=probe['sha256'],mismatches=len(failures),first=failures[0]if failures else None,qualifications=qualifications)
 for i,(p,literal)in enumerate(zip(a['probes'],plan)):
  assert all(p[k]==v for k,v in literal.items()),'literal source and geometry'
  row=compare(p,predictions[i],literal['backend']=='owned'or literal['portablePrimary'])
  if p['mutation']:
   assert p['mutation']['kind']==a['fault'] and literal['backend']=='owned' and row['mismatches']>0
   faults.append(dict(kind=a['fault'],sourceIndex=i,first=row['first'],mismatches=row['mismatches']))
  else:assert row['mismatches']==0,(i,row)
  checked+=row['pixels'];qualified+=row['qualifications'];rows.append(row)
 for consumer in a['consumers']:
  for capture in consumer['captures']:
   i=capture['sourceIndex'];literal=plan[i]
   assert literal['backend']=='owned' and capture['fragmentText']==literal['text'] and capture['words']==literal['words']
   row=compare(capture,indexed[i],True);assert row['mismatches']==0,(i,row)
   checked+=row['pixels'];rows.append(row)
 if a['fault']:assert len(faults)==1 and not a['consumers']
 else:assert a['checkedPixels']==checked and len(a['consumers'])==2
 result=dict(schema='fragment-discard-independent-oracle-v1',task='E6-T12g6l',status='passed',gitHead=report['gitHead'],sourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),sourceReportSha256=hashlib.sha256(raw).hexdigest(),planSha256=hashlib.sha256(planned).hexdigest(),seed=seed,fault=a['fault'],checkedPixels=checked,qualifications=qualified,rows=rows,faults=faults)
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,indent=2)+'\n')
 print(f'{checked} independent literal cells; {qualified} qualified primary cells; {len(faults)} actual faults caught.')

if __name__=='__main__':main()
