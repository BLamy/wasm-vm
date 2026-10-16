import hashlib,json,pathlib,random,struct
O=pathlib.Path(__file__).resolve().parent
common='''DCL TEMP[0..117]
DCL CONST[0..1]
IMM[0] FLT32 {0.5, 0.5, 0.5, 0.5}
IMM[1] FLT32 {-0.25, -0.25, -0.25, -0.25}
IMM[2] UINT32 {1, 1, 1, 1}
IMM[3] UINT32 {0, 8, 16, 24}
IMM[4] UINT32 {255, 255, 255, 255}
IMM[5] UINT32 {15, 15, 15, 15}
IMM[6] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}
IMM[7] UINT32 {1065353216, 1065353216, 1065353216, 1065353216}
OR TEMP[114], IMM[2], IMM[2]
'''
chain='''ADD TEMP[0], TEMP[0], IMM[0]
MUL TEMP[1], TEMP[1], IMM[0]
UCMP TEMP[2], CONST[0], TEMP[0], TEMP[1]
MOV TEMP[2].xy, TEMP[2].yxxx
MAD TEMP[3], TEMP[2], IMM[0], IMM[1]
MOV TEMP[3].z, TEMP[0].yyyy
UCMP TEMP[3].w, IMM[2], TEMP[1].zzzz, CONST[1]
ADD TEMP[0], TEMP[1], IMM[0]
ADD TEMP[4], TEMP[3], IMM[0]
'''
sh=[]
for lane in 'xyzw':
 text='VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\n'+common+'MOV TEMP[0], IN[1]\nMOV TEMP[1], IN[2]\n'+chain+f'''USHR TEMP[5], TEMP[3].{lane*4}, IMM[3]
AND TEMP[5], TEMP[5], IMM[4]
SHL TEMP[5], TEMP[5], IMM[5]
OR TEMP[5], TEMP[5], IMM[6]
MOV OUT[0], IN[0]
MOV OUT[1], TEMP[4]
MOV OUT[2], TEMP[5]
END
''';sh.append(dict(name='numeric-vertex-'+lane,stage='vertex',text=text))
for target in [3,4]:
 text='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\nDCL SAMP[7]\nDCL SVIEW[7], 2D, FLOAT\n'+common+'TEX TEMP[0], IN[0], SAMP[0], 2D\nTEX TEMP[1], IN[0].yxzw, SAMP[7], 2D\n'+chain+f'''USHR TEMP[5], TEMP[{target}], CONST[1]
AND TEMP[5], TEMP[5], IMM[2]
USHR TEMP[7], IMM[2], IMM[3].wwww
UCMP TEMP[5], TEMP[5], IMM[7], TEMP[7]
MOV OUT[0], TEMP[5]
END
''';sh.append(dict(name='texture-fragment-'+str(target),stage='fragment',text=text))
sh += [dict(name='legacy-fragment',stage='fragment',text='FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nMOV OUT[0], IN[0]\nEND\n'),dict(name='legacy-vertex',stage='vertex',text='VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nMOV OUT[0], IN[0]\nMOV OUT[1], IN[1]\nEND\n')]
def bits32(n):return struct.unpack('<I',struct.pack('<f',n/32))[0]
def expected(a,b,c):
 # all inputs integer eighths. Preserve the parallel assignment of x/y.
 p=[4*(x+4) for x in a];q=[2*x for x in b];t=[p[i] if c[i] else q[i] for i in range(4)];t=[t[1],t[0],t[2],t[3]];r=[x//2-8 for x in t];r[2]=p[1];r[3]=q[2];return dict(raw=r,numeric=[x+16 for x in r],rawBits=list(map(bits32,r)),numericBits=list(map(bits32,[x+16 for x in r])))
rng=random.Random(0x9183ac6f);v=[]
for i in range(32):
 a=[rng.randrange(-8,9) for _ in range(4)];b=[rng.randrange(-8,9) for _ in range(4)];c=[rng.choice([0,1,2,0x80000000,0xffffffff]) for _ in range(4)];v.append(dict(name='dyadic-'+str(i),a=a,b=b,c=c,**expected(a,b,c)))
t=[]
for i in range(32):
 a=[8*((i>>j)&1) for j in range(4)];b=[8*((((i*7)^11)>>j)&1) for j in range(4)];c=[0 if ((i+j)%3)==0 else [1,2,0x80000000,0xffffffff][j] for j in range(4)];t.append(dict(name='texture-'+str(i),a=a,b=b,c=c,**expected(a,b,c)))
(O/'hardware-fixture.json').write_text(json.dumps(dict(shaders=sh,vectors=v,textures=t),indent=2)+'\n')
