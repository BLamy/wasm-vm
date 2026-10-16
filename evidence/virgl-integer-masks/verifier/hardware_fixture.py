import json,pathlib,random
O=pathlib.Path(__file__).resolve().parent;M=(1<<32)-1
core='MOV TEMP[117], CONST[45]\nUADD TEMP[117].xy, TEMP[117].yxwz, CONST[43]\nISGE TEMP[17], TEMP[117], CONST[42]\nUSEQ TEMP[18], TEMP[117], CONST[41]\nUSNE TEMP[19], TEMP[117], CONST[40]\nUCMP TEMP[117].xy, TEMP[117].wzyx, TEMP[17].yxwz, TEMP[18].wzyx\nUCMP TEMP[9], TEMP[19], TEMP[117], CONST[45].wzyx\nUADD TEMP[9].w, TEMP[9].wwww, CONST[43].zzzz\n'
shaders=[]
for lane in range(4):
 text='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {0, 8, 16, 24}\nIMM[1] UINT32 {255, 255, 255, 255}\nIMM[2] UINT32 {15, 15, 15, 15}\nIMM[3] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}\n'+core
 text+='USHR TEMP[16], TEMP[9].'+('xyzw'[lane]*4)+', IMM[0]\nAND TEMP[16], TEMP[16], IMM[1]\nSHL TEMP[16], TEMP[16], IMM[2]\nOR TEMP[16], TEMP[16], IMM[3]\nMOV OUT[0], IN[0]\nMOV OUT[1], TEMP[16]\nEND\n'
 shaders.append(dict(name=f'alias-vertex-{lane}',stage='vertex',text=text))
text='FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {1, 1, 1, 1}\nIMM[1] UINT32 {23, 23, 23, 23}\nIMM[2] UINT32 {2, 2, 2, 2}\nIMM[3] UINT32 {3, 3, 3, 3}\n'+core
text+='USHR TEMP[16], TEMP[9], CONST[44].xxxx\nAND TEMP[16], TEMP[16], IMM[0]\nSHL TEMP[16], TEMP[16], IMM[1]\nSHL TEMP[15], TEMP[16], IMM[0]\nOR TEMP[16], TEMP[16], TEMP[15]\nSHL TEMP[15], TEMP[16], IMM[2]\nOR TEMP[16], TEMP[16], TEMP[15]\nSHL TEMP[15], TEMP[16], IMM[3]\nOR TEMP[16], TEMP[16], TEMP[15]\nMOV OUT[0], TEMP[16]\nEND\n'
shaders.append(dict(name='alias-fragment',stage='fragment',text=text))
shaders += [dict(name='legacy-vertex',stage='vertex',text='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n'),dict(name='legacy-fragment',stage='fragment',text='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.0, 0.0, 0.0, 1.0}\nMOV OUT[0], IMM[0]\nEND\n')]
def signed(x):return x if x<2**31 else x-2**32
def expected(a,b,c,d,e):
 t=[(a[1]+b[0])&M,(a[0]+b[1])&M,a[2],a[3]]
 g=[M if signed(x)>=signed(c[i]) else 0 for i,x in enumerate(t)];q=[M if x==d[i] else 0 for i,x in enumerate(t)];n=[M if x!=e[i] else 0 for i,x in enumerate(t)]
 t=[g[1] if t[3] else q[3],g[0] if t[2] else q[2],t[2],t[3]]
 z=[t[i] if n[i] else a[3-i] for i in range(4)];z[3]=(z[3]+b[2])&M;return z
vectors=[]
def add(name,a,b,c,d,e):vectors.append(dict(name=name,a=a,b=b,c=c,d=d,e=e,expected=expected(a,b,c,d,e)))
add('prediction-arms',[M,1,0x7fc00001,2],[M,1,0x80000000,0],[0,0x80000000,0x7fffffff,0x80000000],[0,0,0,1],[1,1,0,0])
add('false-conditions',[0,0,0x80000000,0],[0,0,0,0],[0]*4,[0]*4,[0]*4)
add('equal-payloads',[0x80000000,0x7fffffff,1,M],[1,M,1,0],[0,0x80000000,0,M],[0x80000000,0x7fffffff,1,M],[0x80000000,0x7fffffff,1,M])
add('nan-inf',[0x7f800000,0xff800000,0x7f800001,0x80000001],[1,0x80000000,M,2],[M,1,0x80000000,0x7fffffff],[0]*4,[0]*4)
r=random.Random(0x592b7d13)
for i in range(12):add('seeded-'+str(i),*[[r.getrandbits(32) for _ in range(4)] for _ in range(5)])
assert vectors[0]['expected']==[M,M,0x7fc00001,0x80000002]
(O/'hardware-fixture.json').write_text(json.dumps(dict(schema='independent-integer-hardware-v1',seed='592b7d13',shaders=shaders,vectors=vectors),indent=2)+'\n')
