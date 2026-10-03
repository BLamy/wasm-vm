import json, subprocess, pathlib, re, hashlib
root=pathlib.Path(__file__).resolve().parents[3]
# Independent compact fixture exercises exactly the documented graph, with independent slots.
preamble='''VERT
DCL IN[0]
DCL OUT[0], POSITION
DCL TEMP[0..117]
DCL CONST[0..45]
DCL ADDR[0]
IMM[0] UINT32 {11,16,1,4}
IMM[1] UINT32 {176,432,144,448}
IMM[2] FLT32 {0,1,0,1}
'''
body='''MOV TEMP[40].w, IMM[2].xxxx
MOV TEMP[41].z, IMM[0].xxxx
MOV TEMP[42].y, IMM[0].yyyy
MOV TEMP[43].w, IMM[0].zzzz
BGNLOOP :0
UARL ADDR[0].x, TEMP[41].zzzz
MOV TEMP[44].z, CONST[ADDR[0].x].xxxx
FSLT TEMP[45].w, TEMP[40].wwww, TEMP[44].zzzz
ISGE TEMP[46].y, TEMP[43].wwww, CONST[9].xxxx
OR TEMP[47].z, TEMP[45].wwww, TEMP[46].yyyy
UIF TEMP[47].zzzz
BRK
ENDIF
UADD TEMP[48].w, TEMP[43].wwww, IMM[0].zzzz
SHL TEMP[49].y, TEMP[43].wwww, IMM[0].wwww
UADD TEMP[42].y, TEMP[49].yyyy, IMM[0].yyyy
UADD TEMP[50].z, IMM[1].xxxx, TEMP[49].yyyy
USHR TEMP[41].z, TEMP[50].zzzz, IMM[0].wwww
MOV TEMP[43].w, TEMP[48].wwww
ENDLOOP :0
USNE TEMP[51].z, TEMP[43].wwww, CONST[9].xxxx
UIF TEMP[51].zzzz
SHL TEMP[52].w, TEMP[43].wwww, IMM[0].wwww
UADD TEMP[53].xy, IMM[1].yzzz, TEMP[52].wwww
USHR TEMP[54].xy, TEMP[53].xyxx, IMM[0].wwww
MOV TEMP[55].y, TEMP[54].yyyy
UARL ADDR[0].x, TEMP[55].yyyy
MOV TEMP[56].w, CONST[ADDR[0].x].xxxx
UADD TEMP[57].z, IMM[1].wwww, TEMP[42].yyyy
USHR TEMP[58].y, TEMP[57].zzzz, IMM[0].wwww
UARL ADDR[0].x, TEMP[58].yyyy
MOV TEMP[59], CONST[ADDR[0].x]
MOV TEMP[60].w, TEMP[54].xxxx
UARL ADDR[0].x, TEMP[60].wwww
MOV TEMP[61], CONST[ADDR[0].x]
ENDIF
MOV OUT[0], IN[0]
END
'''
base=preamble+body
cases=[('independent-lanes',base,True)]
# Control, unsafe recurrence and use-site graph attacks, all predicted reject.
for name,old,new in [
 ('break-outside','MOV OUT[0], IN[0]','BRK\nMOV OUT[0], IN[0]'),
 ('no-break','BRK\n',''),('break-label','BRK\n','BRK :0\n'),
 ('begin-target','BGNLOOP :0','BGNLOOP :1'),('end-target','ENDLOOP :0','ENDLOOP :1'),
 ('continue','BRK\n','CONT\n'),('nested','BGNLOOP :0','BGNLOOP :0\nBGNLOOP :0'),
 ('guard-and','OR TEMP[47]','AND TEMP[47]'),('count-y','CONST[9].xxxx','CONST[9].yyyy'),
 ('signed-wrap','UINT32 {11,16,1,4}','UINT32 {11,16,4294967295,4}'),
 ('shift-wrap','UINT32 {11,16,1,4}','UINT32 {11,16,1,36}'),
 ('different-count','CONST[9].xxxx','CONST[8].xxxx'),
 ('counter-stall','MOV TEMP[43].w, TEMP[48].wwww','MOV TEMP[43].w, TEMP[43].wwww'),
 ('header-offset','UARL ADDR[0].x, TEMP[41].zzzz','UARL ADDR[0].x, TEMP[43].wwww'),
 ('tail-equality','USNE TEMP[51]','USEQ TEMP[51]'),
 ('tail-lower-swap','MOV TEMP[60].w, TEMP[54].xxxx','MOV TEMP[60].w, TEMP[54].yyyy'),
 ('pre-break-extra-indirect','UIF TEMP[47].zzzz','MOV TEMP[62], CONST[ADDR[0].x]\nUIF TEMP[47].zzzz'),
 ('carried-uninitialized','TEMP[40].wwww, TEMP[44].zzzz','TEMP[48].wwww, TEMP[44].zzzz'),
 ('tail-protected-clobber','UADD TEMP[57].z','MOV TEMP[43].w, IMM[1].wwww\nUADD TEMP[57].z'),
 ('tail-address-clobber','UADD TEMP[57].z','MOV TEMP[54].x, IMM[1].wwww\nUADD TEMP[57].z'),
]:
 assert old in base,name
 cases.append((name,base.replace(old,new),False))
# Alter every single consumed recurrence/guard source register to another defined role.
for line_index,line in enumerate(base.splitlines()):
 if not any(line.startswith(op) for op in ['MOV','UADD','SHL','USHR','FSLT','ISGE','OR','USNE','UARL','UIF']): continue
 for match in list(re.finditer(r'TEMP\[(\d+)\]',line)):
  # Mutations include destination aliases; accepted equivalent programs are classified separately.
  for target in range(40,63):
   if target==int(match[1]): continue
   mutated=line[:match.start()]+f'TEMP[{target}]'+line[match.end():]
   lines=base.splitlines();lines[line_index]=mutated
   cases.append((f'alias-{line_index}-{match.start()}-{target}','\n'.join(lines)+'\n',None))
records=[]
for name,text,expected in cases:
 p=subprocess.run([str(root/'renderer/virgl-shader/build/native/virgl-shader'),'vertex'],input=text,text=True,capture_output=True,check=True)
 result=json.loads(p.stdout)
 records.append(dict(name=name,expected=expected,result=result,input=text,inputSha256=hashlib.sha256(text.encode()).hexdigest()))
(pathlib.Path(__file__).resolve().parent / 'attack-results.json').write_text(json.dumps(records,indent=2)+'\n')
assert all(r['result']['ok'] is r['expected'] for r in records if r['expected'] is not None),[(r['name'],r['result']['ok']) for r in records if r['expected'] is not None and r['result']['ok'] is not r['expected']]
accepted=[r['name'] for r in records if r['result']['ok']]
print(json.dumps(dict(cases=len(records),accepted=accepted),indent=2))
