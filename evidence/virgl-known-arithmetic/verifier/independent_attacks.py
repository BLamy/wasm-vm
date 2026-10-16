#!/usr/bin/env python3
"""Scoped native attack predictions are saved before invoking original binary."""
from pathlib import Path
import importlib.util,json,hashlib,struct,subprocess,os
ROOT=Path(__file__).resolve().parents[3];E=Path(__file__).parent;O=ROOT/'target/evidence/virgl-known-arithmetic-critic';U=O/'unpacked'
spec=importlib.util.spec_from_file_location('critic_oracle',E/'independent_oracle.py');oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
sha=oracle.sha;arith=oracle.arithmetic
bits=lambda x:struct.unpack('<I',struct.pack('<f',x))[0]
imm=lambda i,ws:f'IMM[{i}] UINT32 '+'{'+','.join(map(str,ws))+'}'
PV='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[0]\nEND\n'
h=['FRAG','DCL IN[0], GENERIC[0], PERSPECTIVE','DCL OUT[0], COLOR','DCL TEMP[0..7]','DCL CONST[0..45]']
cases=[]
def add(name,lines,ok,wanted=None,head=h):
 cases.append(dict(name=name,stage='fragment',text='\n'.join(head+(['DCL ADDR[0]']if any('ADDR['in l for l in lines)else[])+lines+['END','']),partner=PV,ok=ok,pairOk=ok,expectedWords=wanted))
for op in ['ADD','MUL']:
 for a,b in [(0,bits(1.5)),(bits(1.5),0),(0x80000000,bits(-1.5)),(bits(-1.5),0x80000000),(bits(1),bits(-1)),(0x00800000,0x00800000),(bits(1),bits(2**-24)),(bits(1)+1,bits(2**-24))]:
  w=arith(op,a,b);ok=(w&0x7f800000)!=0x7f800000 and (w&0x7fffffff)==0 or 0<(w&0x7f800000)<0x7f800000
  add(f'new/{op}/{a:08x}/{b:08x}',[imm(0,[a]*4),imm(1,[b]*4),f'{op} TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]'],bool(ok),[w]*4)
# Complete vector exercises both identity returns and exact cancellation in one retry.
add('supplemental-zero-return-vector',[imm(0,[0,bits(1.5),bits(1),0]),imm(1,[bits(1.5),0,bits(-1),bits(1)]),'ADD TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]'],True,[bits(1.5),bits(1.5),0,bits(1)])
for source in ['IN[0]','CONST[0]','TEMP[2]']:
 add('integer-unknown/'+source,[imm(0,[bits(.5)]*4),'UADD TEMP[2], IN[0], IMM[0]',f'ADD TEMP[0], {source}, IMM[0]','SIN OUT[0], TEMP[0]'],False)
for op in ['ADD','MUL']:
 for wrong in ['MOV TEMP[0].x, IN[0].xxxx','UADD TEMP[0].x, IN[0].xxxx, IMM[0].xxxx','MOV TEMP[0].xy, CONST[0].xyxx']:
  add('source-kill/'+op+'/'+wrong,[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),f'{op} TEMP[0], IMM[0], IMM[1]',wrong,'SIN OUT[0], TEMP[0]'],False)
 add('scalar-unwritten-keeps-y/'+op,[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),f'{op} TEMP[0], IMM[0], IMM[1]','MOV TEMP[0].x, IN[0].xxxx','SIN OUT[0], TEMP[0].yyyy'],True)
 add('missing-lane/'+op,[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),f'{op} TEMP[0].y, IMM[0], IMM[1]','SIN OUT[0], TEMP[0]'],False)
 for join in ['same','different','missing']:
  yes=[f'{op} TEMP[0], IMM[0], IMM[1]'];no=yes if join=='same'else ['MOV TEMP[0], IMM[2]']if join=='different'else['MOV TEMP[2], IMM[0]']
  add('join/'+op+'/'+join,[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),imm(2,[bits(2**32)]*4),'UIF CONST[43].xxxx',*yes,'ELSE',*no,'ENDIF','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]'],join=='same')
 for a,b in [(0x7f7fffff,0x7f7fffff),(0x00800000,bits(.5)),(1,bits(1)),(0x7f800000,bits(1)),(0x7fc00001,bits(1))]:
  # ADD(min-normal,.5) rounds to .5; all other listed cases cannot prove F2I.
  good=op=='ADD'and a==0x00800000
  add(f'unsafe/{op}/{a:08x}/{b:08x}',[imm(0,[a]*4),imm(1,[b]*4),f'{op} TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]'],good)
for n,good in [(0,True),(45,True),(46,False)]:
 add('address/'+str(n),[imm(0,[bits(n)]*4),imm(1,[0]*4),'ADD TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','UARL ADDR[0].x, TEMP[1].xxxx','MOV OUT[0], CONST[ADDR[0].x]'],good)
add('address-kill',[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),'ADD TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','UARL ADDR[0].x, TEMP[1].xxxx','UARL ADDR[0].x, IN[0].xxxx','MOV OUT[0], CONST[ADDR[0].x]'],False)
for n,good in [(2**31,False),(-2**31,True),(-2**31-256,False),(2**31-128,True)]:
 add('F2I-boundary/'+str(n),[imm(0,[bits(n)]*4),imm(1,[0]*4),'ADD TEMP[0], IMM[0], IMM[1]','F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]'],good)
coord=['FRAG','PROPERTY FS_COORD_ORIGIN LOWER_LEFT','PROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER','DCL IN[0], POSITION, LINEAR','DCL OUT[0], COLOR','DCL TEMP[0..7]']
add('supplemental-coordinate-wrapper',[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),'ADD TEMP[0], IMM[0], IMM[1]','SIN TEMP[1], TEMP[0]','ADD OUT[0], TEMP[1], IN[0]'],True,head=coord)
add('both-operation-wrapper',[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),'ADD TEMP[0], IMM[0], IMM[1]','MUL TEMP[0], TEMP[0], IMM[1]','SIN OUT[0], TEMP[0]'],True)
base=[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),'ADD TEMP[0], IMM[0], IMM[1]']
for depth,good in [(16,True),(17,False)]:add('depth/'+str(depth),base+['MOV OUT[0], IMM[0]']+['UIF CONST[43].xxxx']*depth+['SIN OUT[0], TEMP[0]']+['ENDIF']*depth,good)
add('instruction-limit',base+['MOV TEMP[2], IMM[0]']*769+['SIN OUT[0], TEMP[0]'],False)
for malformed in ['ADD TEMP[0], |IMM[0]|, IMM[1]','ADD TEMP[0], IMM[0]','ADD TEMP[8], IMM[0], IMM[1]','MUL TEMP[0], IMM[0], IMM[1], IMM[2]']:
 add('grammar/'+malformed,[imm(0,[bits(.25)]*4),imm(1,[bits(.5)]*4),malformed,'SIN OUT[0], TEMP[0]'],False)
# Novel producer-version mask/negation guard with an independent xorshift seed.
seed=0x9e3779b9;state=seed
def nxt():
 global state
 state^=(state<<13)&0xffffffff;state^=state>>17;state^=(state<<5)&0xffffffff;state&=0xffffffff;return state
for mask in range(1,16):
 a=[bits((nxt()%8193-4096)/1024)for _ in range(4)];b=[bits((nxt()%4097-2048)/1024)for _ in range(4)];sa='wzyx';sb='zxyw';out=a.copy()
 for i in range(4):
  if mask&(1<<i):out[i]=arith('ADD',a['xyzw'.index(sa[i])]^0x80000000,b['xyzw'.index(sb[i])])
 add('novel-alias-postmodifier-mask/'+str(mask),[imm(0,a),imm(1,b),'MOV TEMP[0], IMM[0]',f"ADD TEMP[0].{''.join(c for i,c in enumerate('xyzw')if mask&(1<<i))}, -TEMP[0].{sa}, IMM[1].{sb}",'F2I TEMP[1], TEMP[0]','I2F OUT[0], TEMP[1]'],True,out)
words=[]
for a,b in [(0,bits(1.5)),(bits(1.5),0),(bits(1),bits(2**-24)),(bits(1)+1,bits(2**-24)),(0x80000000,bits(-1.5)),(bits(-1.5),0x80000000)]:
 for op in ['ADD','MUL']:words.append(dict(op=op,a=a,b=b,expected=arith(op,a,b)))
for _ in range(2048):
 a=((nxt()&0x807fffff)|((1+nxt()%254)<<23))&0xffffffff;b=((nxt()&0x807fffff)|((1+nxt()%254)<<23))&0xffffffff
 for op in ['ADD','MUL']:words.append(dict(op=op,a=a,b=b,expected=arith(op,a,b)))
pred={'schema':'virgl-known-arithmetic-critic-attack-predictions-v1','task':'E6-T12g6m1','seed':seed,'beforeInspection':True,'words':words,'cases':cases,'externalCases':[dict(name='source-size',stage='fragment',text=' '*49153,ok=False,errorCode='input-too-large')]}
(E/'attack-predictions.json').write_text(json.dumps(pred,indent=2)+'\n')
u=lambda w:struct.pack('<I',w)
fixture=b'VKA1'+u(len(words))+b''.join(u(w)for row in words for w in [int(row['op']=='MUL'),row['a'],row['b'],row['expected']])+u(len(cases))+b''.join(u(w)for row in [] for w in [])
for c in cases:
 t=c['text'].encode();p=c['partner'].encode();fixture+=b''.join(u(w)for w in [1,int(c['ok']),len(t),len(p),int(c['pairOk'])])+t+p
(O/'independent-cases.bin').write_bytes(fixture)
cmd=[str(U/'generated/known-arithmetic-sanitize/known-test')];env=dict(os.environ,LLVM_PROFILE_FILE=str(O/'independent-native.profraw'),ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1')
p=subprocess.run(cmd,input=fixture,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
(O/'independent-native.log').write_bytes(p.stdout);(O/'independent-native.stderr').write_bytes(p.stderr)
assert p.returncode==0,p.stderr.decode();assert not p.stderr
actual={};pairs={}
for line in p.stdout.decode().splitlines():
 if line.startswith('CASE ')or line.startswith('PAIR '):
  typ,i,rest=line.split(' ',2);(actual if typ=='CASE'else pairs)[int(i)]=json.loads(rest)
for i,c in enumerate(cases):
 r=actual[i];assert r['ok']==c['ok'],c['name'];c['result']=r;c['pairResult']=pairs[i]
 if c['ok']and c['expectedWords']:
  temp,literals=oracle.parse_producers(c['text']);assert temp[0]==c['expectedWords'],c['name']+' independent source calculation'
  emitted=[int(w)for w in __import__('re').findall(r'/\* known:word \*/ raw_rhs\.[xyzw] = (\d+)u;',r['glsl'])]
  assert emitted==[w for ps in literals for w in ps.values()],c['name']+' literal producer authority'
 cli=U/'generated/native/virgl-shader'
external=[]
for c in pred['externalCases']:
 p=subprocess.run([str(cli),c['stage']],input=c['text'].encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE);r=json.loads(p.stdout);assert r['ok']==c['ok']and r['error']['code']==c['errorCode'];external.append({**c,'text':None,'bytes':len(c['text']),'result':r})
report={'schema':'virgl-known-arithmetic-critic-native-attacks-v1','task':'E6-T12g6m1','status':'passed','sourceHead':'cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee','originalBinarySha256':sha(Path(cmd[0]).read_bytes()),'fixtureSha256':sha(fixture),'predictionsSha256':sha((E/'attack-predictions.json').read_bytes()),'profileSha256':sha((O/'independent-native.profraw').read_bytes()),'stdoutSha256':sha((O/'independent-native.log').read_bytes()),'stderrSha256':sha((O/'independent-native.stderr').read_bytes()),'arithmeticCount':len(words),'cases':cases,'external':external}
(E/'native-attacks.json').write_text(json.dumps(report,indent=2)+'\n');print({'status':'passed','words':len(words),'publicSinglesPairs':len(cases),'sourceLimit':external[0]['result']})
