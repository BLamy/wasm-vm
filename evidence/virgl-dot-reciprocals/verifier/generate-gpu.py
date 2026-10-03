"""Independent scalar/alias witnesses; expected rationals are not compiler output."""
import ctypes,hashlib,json,pathlib,random,struct,sys
from fractions import Fraction as F
V=pathlib.Path(__file__).resolve().parent;b=json.loads((V/'builds.json').read_text());label=sys.argv[1] if len(sys.argv)>1 else 'current';library=pathlib.Path(b['directory'])/(label+'.dylib')
lib=ctypes.CDLL(str(library));lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p
rng=random.Random(0x6e617469)
head='VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL TEMP[0..2]\nDCL CONST[0]\nIMM[0] FLT32 {0.25, 1, 2, 4}\nIMM[1] UINT32 {255, 15, 1056964608, 1065353216}\n'
tail='MOV OUT[1], TEMP[0]\nUSHR TEMP[1], TEMP[0], CONST[0].xxxx\nAND TEMP[1], TEMP[1], IMM[1].xxxx\nSHL TEMP[1], TEMP[1], IMM[1].yyyy\nOR TEMP[1], TEMP[1], IMM[1].zzzz\nMOV OUT[2], TEMP[1]\nMOV OUT[0], IN[0]\nEND\n'
def pair(x):return [str(x.numerator),str(x.denominator)]
programs=[]
for op in ['DP3','RCP','RSQ']:
 for mask in ['x','y','z','w','xy','xyz','xyzw']:
  for neg in [False,True]:
   sw='zxyw' if op!='RSQ' else 'wxyz'
   text=head+'ADD TEMP[0], IN[1], IMM[0].xxxx\n'+op+' TEMP[0]'+('' if mask=='xyzw' else '.'+mask)+', '+('-' if neg else '')+'TEMP[0].'+sw+(', -IN[2].yzxw' if op=='DP3' else '')+'\n'+tail
   raw=text.encode();result=json.loads(lib.bridge_translate(0,raw,len(raw)));assert result['ok'],result
   vectors=[]
   for k in range(16):
    a=[F(rng.randrange(1,65),8) for _ in range(4)];other=[F(rng.randrange(-32,33),8) for _ in range(4)]
    if op=='DP3':a[3]=F(128+k);other[3]=F(-256-k)
    elif neg:a['xyzw'.index(sw[0])]=-F(rng.randrange(4,65),8)-F(1,4)
    before=[v+F(1,4) for v in a];src=[before['xyzw'.index(c)]*(-1 if neg else 1) for c in sw]
    if op=='DP3':
     terms=[src[i]*(-other['xyzw'.index('yzxw'[i])]) for i in range(3)]
     # Every dyadic control has products and each pairwise sum exactly binary32.
     import itertools
     exact=lambda q:F(struct.unpack('<f',struct.pack('<f',float(q)))[0])==q
     assert all(exact(t) for t in terms)
     assert all(exact(x+y) and exact(x+y+z) for x,y,z in itertools.permutations(terms))
     spec={'kind':'exact','q':pair(sum(terms,F()))}
    else:
     assert src[0]>0
     spec={'kind':op.lower(),'input':pair(src[0])}
    expectations=[spec if c in mask else {'kind':'exact','q':pair(before[i])} for i,c in enumerate('xyzw')]
    vectors.append({'inputs':[list(map(float,a)),list(map(float,other))],'expectations':expectations})
   programs.append({'name':f'{op}-alias-{mask}-negative-{neg}','text':text,'result':result,'vectors':vectors,'mask':mask})
report={'seed':'6e617469','runtimeSourceDigests':b['runtimeDigests'],'librarySha256':hashlib.sha256(library.read_bytes()).hexdigest(),'label':label,'programs':programs}
(V/(label+'-gpu-inputs.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'label':label,'programs':len(programs),'vectors':sum(len(p['vectors']) for p in programs)}))
