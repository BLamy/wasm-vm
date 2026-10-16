import ctypes,hashlib,json,pathlib,random,struct,sys
from fractions import Fraction as F
V=pathlib.Path(__file__).resolve().parent
library=sys.argv[1] if len(sys.argv)>1 else 'audit-current.dylib'; destination=sys.argv[2] if len(sys.argv)>2 else 'gpu-inputs.json'
lib=ctypes.CDLL(str(V/library));lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p
rng=random.Random(0x851ac309)
head='VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL TEMP[0..117]\nDCL CONST[0]\nIMM[0] UINT32 {255, 15, 1056964608, 1065353216}\n'
tail='MOV OUT[1], TEMP[0]\nUSHR TEMP[1], TEMP[0], CONST[0].xxxx\nAND TEMP[1], TEMP[1], IMM[0].xxxx\nSHL TEMP[1], TEMP[1], IMM[0].yyyy\nOR TEMP[1], TEMP[1], IMM[0].zzzz\nMOV OUT[2], TEMP[1]\nMOV OUT[0], IN[0]\nEND\n'
def word(q):return struct.unpack('<I',struct.pack('<f',float(q)))[0]
programs=[]
for op,n in [('MAX',2),('FRC',1),('LRP',3),('DIV',2),('ADD',2),('MUL',2),('MAD',3)]:
 for neg in range(n):
  # yxzw and cyclic source aliases must read the prior complete temporary.
  swz=['wzyx','yxwz','zwxy'];src=['TEMP[0]','IN[2]','IN[3]'];terms=[('-' if j==neg else '')+src[j]+'.'+swz[j] for j in range(n)]
  mask='xyz' if op!='MAD' else 'xyzw'
  text=head+'MOV TEMP[0], IN[1]\n'+f'{op} TEMP[0]'+('' if mask=='xyzw' else '.'+mask)+', '+', '.join(terms)+'\n'+tail
  raw=text.encode();translated=json.loads(lib.bridge_translate(0,raw,len(raw)))
  assert translated['ok'],translated
  vectors=[]
  for k in range(24):
   a=[F(rng.randrange(-32,33),8) for _ in range(4)];b=[F(rng.randrange(1,33),8) for _ in range(4)];c=[F(rng.randrange(-32,33),8) for _ in range(4)]
   if op=='DIV' and neg==1:b=[-x for x in b] # keep the effective denominator in the spec's positive accuracy domain
   sources=[a,b,c];out=a.copy()
   for lane in range(len(mask)):
    x=[sources[j]['xyzw'.index(swz[j][lane])] * (-1 if j==neg else 1) for j in range(n)]
    if op=='MAX':q=max(x)
    elif op=='FRC':q=x[0]-(x[0].numerator//x[0].denominator)
    elif op=='LRP':q=x[0]*x[1]+(1-x[0])*x[2]
    elif op=='DIV':q=x[0]/x[1]
    elif op=='ADD':q=x[0]+x[1]
    elif op=='MUL':q=x[0]*x[1]
    else:q=x[0]*x[1]+x[2]
    out[lane]=q
   vectors.append({'inputs':list(map(lambda vs:list(map(float,vs)),sources)),'expectedWords':[word(q) for q in out],'rationals':[[str(q.numerator),str(q.denominator)] for q in out],'divisionLanes':len(mask) if op=='DIV' else 0})
  programs.append({'name':f'{op}-negative-source-{neg}-alias-{mask}','text':text,'result':translated,'vectors':vectors})
(V/destination).write_text(json.dumps({'seed':'851ac309','runtimeSourceDigests':json.loads((V/'initial-runtime-digests.json').read_text()),'librarySha256':hashlib.sha256((V/library).read_bytes()).hexdigest(),'programs':programs},indent=2)+'\n')
print(f'{len(programs)} independently authored GPU programs, {sum(len(x["vectors"]) for x in programs)} vectors')
