import json,pathlib,random
O=pathlib.Path(__file__).resolve().parent;M=(1<<32)-1
core='MOV TEMP[117], CONST[45]\nFSLT TEMP[117].xy, TEMP[117].yxwz, CONST[43]\nFSGE TEMP[17], CONST[45], CONST[43]\nUSEQ TEMP[18], CONST[45], CONST[43]\nUCMP TEMP[9], CONST[42], TEMP[117], TEMP[17]\nUADD TEMP[9].z, TEMP[17].zzzz, TEMP[18].zzzz\nUADD TEMP[9].w, TEMP[117].xxxx, TEMP[18].wwww\n'

shaders=[]
for lane in range(4):
 text='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {0, 8, 16, 24}\nIMM[1] UINT32 {255, 255, 255, 255}\nIMM[2] UINT32 {15, 15, 15, 15}\nIMM[3] UINT32 {1056964608, 1056964608, 1056964608, 1056964608}\n'+core
 text+='USHR TEMP[16], TEMP[9].'+('xyzw'[lane]*4)+', IMM[0]\nAND TEMP[16], TEMP[16], IMM[1]\nSHL TEMP[16], TEMP[16], IMM[2]\nOR TEMP[16], TEMP[16], IMM[3]\nMOV OUT[0], IN[0]\nMOV OUT[1], TEMP[16]\nEND\n'
 shaders.append(dict(name=f'alias-vertex-{lane}',stage='vertex',text=text))
text='FRAG\nDCL OUT[0], COLOR\nDCL TEMP[0..117]\nDCL CONST[0..45]\nIMM[0] UINT32 {1, 1, 1, 1}\nIMM[1] UINT32 {23, 23, 23, 23}\nIMM[2] UINT32 {2, 2, 2, 2}\nIMM[3] UINT32 {3, 3, 3, 3}\n'+core
text+='USHR TEMP[16], TEMP[9], CONST[44].xxxx\nAND TEMP[16], TEMP[16], IMM[0]\nSHL TEMP[16], TEMP[16], IMM[1]\nSHL TEMP[15], TEMP[16], IMM[0]\nOR TEMP[16], TEMP[16], TEMP[15]\nSHL TEMP[15], TEMP[16], IMM[2]\nOR TEMP[16], TEMP[16], TEMP[15]\nSHL TEMP[15], TEMP[16], IMM[3]\nOR TEMP[16], TEMP[16], TEMP[15]\nMOV OUT[0], TEMP[16]\nEND\n'
shaders.append(dict(name='alias-fragment',stage='fragment',text=text))
shaders += [dict(name='legacy-vertex',stage='vertex',text='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n'),dict(name='legacy-fragment',stage='fragment',text='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {0.0, 0.0, 0.0, 1.0}\nMOV OUT[0], IMM[0]\nEND\n')]
def ordered(a,b,ge):
 sa,sb=a>>31,b>>31;ea,eb=(a>>23)&255,(b>>23)&255;fa,fb=a&0x7fffff,b&0x7fffff
 if (ea==255 and fa) or (eb==255 and fb):return 0
 if not(ea or eb or fa or fb):cmp=0
 elif sa!=sb:cmp=-1 if sa else 1
 else:
  cmp=((ea,fa)>(eb,fb))-((ea,fa)<(eb,fb))
  if sa:cmp=-cmp
 return M if (cmp>=0 if ge else cmp<0) else 0
def expected(a,b,c,d,e):
 t=[ordered(a[1],b[0],False),ordered(a[0],b[1],False),a[2],a[3]]
 g=[ordered(a[i],b[i],True) for i in range(4)];q=[M if a[i]==b[i] else 0 for i in range(4)]
 z=[t[i] if c[i] else g[i] for i in range(4)];z[2]=(g[2]+q[2])&M;z[3]=(t[0]+q[3])&M;return z
vectors=[]
def add(name,a,b,c):vectors.append(dict(name=name,a=a,b=b,c=c,d=[0]*4,e=[0]*4,expected=expected(a,b,c,[0]*4,[0]*4)))
add('alias-sign-boundary',[0x3f800000,0xbf800000,0,0x80000000],[0,0,0x80000000,0],[1,1,0,0])
add('negative-adjacent',[0xbf800001,0xbf800000,0x80800000,0x80000001],[0xbf800000,0xbf800001,0x807fffff,0x80000000],[1,1,1,1])
add('signed-zeros',[0,0x80000000,0,0x80000000],[0x80000000,0,0x80000000,0],[1,1,1,1])
add('nan-first',[0xff800001,0x7fc015c9,0x7f80000f,0xfffc9139],[0xff800000,0x3f800000,0x7f80000f,0xfffc9139],[1,1,1,1])
add('nan-second',[0xff800000,0x3f800000,0xff800000,0x7f800000],[0xffc9153d,0x7f800001,0x7fc01019,0xff913d87],[0,0,0,0])
add('infinities',[0xff800000,0x7f800000,0xff800000,0x7f800000],[0xff800000,0x7f800000,0x7f800000,0xff800000],[1,1,1,1])
add('subnormal-boundary',[1,0x80000001,0x800000,0x80800000],[0,0x80000000,0x7fffff,0x807fffff],[1,1,1,1])
r=random.Random(0x784f153b)
for i in range(17):add('seeded-'+str(i),*[[r.getrandbits(32) for _ in range(4)] for _ in range(3)])
assert vectors[0]['expected']==[M,0,M,M]
(O/'hardware-fixture.json').write_text(json.dumps(dict(schema='independent-float-mask-hardware-v1',seed='784f153b',shaders=shaders,vectors=vectors),indent=2)+'\n')
