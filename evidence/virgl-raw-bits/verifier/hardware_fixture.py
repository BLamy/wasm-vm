import json,pathlib,random
O=pathlib.Path(__file__).resolve().parent
M=(1<<32)-1
core='MOV TEMP[117], CONST[45]\nSHL TEMP[117].xy, TEMP[117].yxwz, CONST[43]\nUSHR TEMP[17], TEMP[117], CONST[42]\nOR TEMP[9], TEMP[17], CONST[41]\nAND TEMP[9], TEMP[9], CONST[40]\nNOT TEMP[9].w, TEMP[9].wwww\n'
shaders=[]
for lane in range(4):
 text='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {0, 8, 16, 24}\nIMM[1] UINT32 {255, 255, 255, 255}\nIMM[2] UINT32 {15, 15, 15, 15}\nIMM[3] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}\n'+core
 text+='USHR TEMP[16], TEMP[9].'+('xyzw'[lane]*4)+', IMM[0]\nAND TEMP[16], TEMP[16], IMM[1]\nSHL TEMP[16], TEMP[16], IMM[2]\nOR TEMP[16], TEMP[16], IMM[3]\nMOV OUT[0], IN[0]\nMOV OUT[1], TEMP[16]\nEND\n'
 shaders.append(dict(name=f'alias-vertex-{lane}',stage='vertex',text=text))
text='FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {1, 1, 1, 1}\nIMM[1] UINT32 {23, 23, 23, 23}\nIMM[2] UINT32 {2, 2, 2, 2}\nIMM[3] UINT32 {3, 3, 3, 3}\n'+core
text+='USHR TEMP[16], TEMP[9], CONST[44].xxxx\nAND TEMP[16], TEMP[16], IMM[0]\nSHL TEMP[16], TEMP[16], IMM[1]\nSHL TEMP[15], TEMP[16], IMM[0]\nOR TEMP[16], TEMP[16], TEMP[15]\nSHL TEMP[15], TEMP[16], IMM[2]\nOR TEMP[16], TEMP[16], TEMP[15]\nSHL TEMP[15], TEMP[16], IMM[3]\nOR TEMP[16], TEMP[16], TEMP[15]\nMOV OUT[0], TEMP[16]\nEND\n'
shaders.append(dict(name='alias-fragment',stage='fragment',text=text))
shaders+= [dict(name='legacy-vertex',stage='vertex',text='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n'),dict(name='legacy-fragment',stage='fragment',text='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.0, 0.0, 0.0, 1.0}\nMOV OUT[0], IMM[0]\nEND\n')]
vectors=[]
def add(name,a,b,c,d=[0]*4,e=[M]*4):
 t=[(a[1]<<(b[0]&31))&M,(a[0]<<(b[1]&31))&M,a[2],a[3]]
 expected=[((t[i]>>(c[i]&31))|d[i])&e[i] for i in range(4)]; expected[3]^=M
 vectors.append(dict(name=name,a=a,b=b,c=c,d=d,e=e,expected=expected))
add('prediction-alias',[0x80000001,M,0x7f800001,1],[32,33,0x80000000,M],[0]*4)
add('changed-counts',[0x80000001,M,0x7f800001,1],[M,32,33,0x80000000],[0,1,32,33])
add('zeros-subnormal',[0,1,0x007fffff,0x80000001],[0,1,31,63],[32,33,31,63])
add('alternating',[0xaaaaaaaa,0x55555555,0xff800000,0x7fc12345],[31,32,33,0],[1,32,33,0],d=[0x80000000,0,0x00000001,0],e=[M,0x7fffffff,M,M])
r=random.Random(0x154acfe9)
for i in range(8): add('seeded-'+str(i),[r.getrandbits(32) for _ in range(4)],[r.getrandbits(32) for _ in range(4)],[r.getrandbits(32) for _ in range(4)],[r.getrandbits(32) for _ in range(4)],[r.getrandbits(32) for _ in range(4)])
assert vectors[0]['expected']==[M,2,0x7f800001,0xfffffffe]
(O/'hardware-fixture.json').write_text(json.dumps(dict(schema='independent-raw-hardware-v1',seed='154acfe9',shaders=shaders,vectors=vectors),indent=2)+'\n')
