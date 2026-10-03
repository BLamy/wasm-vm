import json,re,struct,pathlib
v=json.load(open(pathlib.Path(__file__).with_name('attack-results.json')))
f32=lambda w:struct.unpack('<f',struct.pack('<I',w))[0]
word=lambda f:struct.unpack('<I',struct.pack('<f',f))[0]
def run(text,n,early):
 r={'IN[0]':[0,0,0,word(1)]}; instr=[]
 for i in range(46):r[f'CONST[{i}]']=[word(1) if i==early+10 else 0,0,0,0]
 r['CONST[9]'][0]=n&0xffffffff
 for l in text.splitlines():
  if l.startswith(('VERT','DCL')):continue
  m=re.fullmatch(r'IMM\[(\d+)\] (UINT32|FLT32) \{(.*)\}',l)
  if m:r['IMM['+m[1]+']']=[int(x) if m[2]=='UINT32' else word(float(x)) for x in m[3].split(',')];continue
  instr.append(l)
 ends={};stack=[]
 for pc,l in enumerate(instr):
  if l.startswith(('BGNLOOP','UIF')):stack.append(pc)
  if l.startswith(('ENDLOOP','ENDIF')):ends[stack.pop()]=pc
 assert not stack
 accesses=[];addr=None;headers=0;iterations=[];pc=0;steps=0
 def parse(x):
  if x.startswith('CONST[ADDR[0].x]'):
   assert addr is not None and 0<=addr<46,('unsafe',addr)
   accesses.append(addr);x=x.replace('CONST[ADDR[0].x]',f'CONST[{addr}]')
  m=re.fullmatch(r'((?:IMM|CONST|TEMP|IN|OUT)\[\d+\])(?:\.([xyzw]+))?',x);assert m,x
  return m[1],m[2] or 'xyzw'
 def read(x,c):
  k,s=parse(x);idx='xyzw'.index(s[0] if len(s)==1 else s[c]);value=r.get(k,[None]*4)[idx];assert value is not None,('undefined',x,c);return value
 while pc<len(instr):
  steps+=1;assert steps<2000,('unbounded',n,early)
  l=instr[pc];op=l.split()[0];tail=l[len(op):].strip();pc+=1
  if op=='END':break
  if op=='BGNLOOP':headers+=1;iterations.append(pc-1);continue
  if op=='ENDLOOP':headers+=1;pc=iterations[-1]+1;continue
  if op=='BRK':pc=ends[iterations.pop()]+1;continue
  if op=='UIF':
   if not read(tail,0):pc=ends[pc-1]+1
   continue
  if op=='ENDIF':continue
  args=tail.split(', ')
  if op=='UARL':addr=read(args[1],0);continue
  key,mask=parse(args[0]);new=[]
  for c in mask:
   lane='xyzw'.index(c);a=[read(x,lane) for x in args[1:]]
   if op=='MOV':w=a[0]
   elif op=='UADD':w=(a[0]+a[1])&0xffffffff
   elif op=='SHL':w=(a[0]<<(a[1]&31))&0xffffffff
   elif op=='USHR':w=a[0]>>(a[1]&31)
   elif op=='OR':w=a[0]|a[1]
   elif op=='FSLT':w=0xffffffff if f32(a[0])<f32(a[1]) else 0
   elif op=='ISGE':w=0xffffffff if (a[0] if a[0]<2**31 else a[0]-2**32)>=(a[1] if a[1]<2**31 else a[1]-2**32) else 0
   elif op=='USNE':w=0xffffffff if a[0]!=a[1] else 0
   else:raise Exception(op)
   new.append((lane,w))
  r.setdefault(key,[None]*4)
  for c,w in new:r[key][c]=w
 assert 1<=headers<=18,(headers,n,early)
 return {'count':n,'early':early,'headers':headers,'accesses':accesses}
report=[]
for x in v:
 if not x['result']['ok']:continue
 for n in [-2147483648,-2130706432,-1073741824,0,*range(1,19)]:
  for early in range(1,max(1,n)+2):
   result=run(x['input'],n,early);report.append({'case':x['name'],**result})
(pathlib.Path(__file__).resolve().parent / 'dynamic-address-results.json').write_text(json.dumps(report,indent=2)+'\n')
print('Accepted program executions',len(report),'max headers',max(x['headers'] for x in report),'address range',min(a for x in report for a in x['accesses']),max(a for x in report for a in x['accesses']))
