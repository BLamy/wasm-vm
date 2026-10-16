"""Fresh independent near-domain-boundary witnesses, no ADD preconditioning."""
import ctypes,hashlib,json,pathlib
from fractions import Fraction as F
V=pathlib.Path(__file__).resolve().parent;b=json.loads((V/'builds.json').read_text());library=pathlib.Path(b['directory'])/'current.dylib'
lib=ctypes.CDLL(str(library));lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p
head='VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL OUT[2], GENERIC[1]\nDCL TEMP[0..1]\nDCL CONST[0]\nIMM[0] UINT32 {255, 15, 1056964608, 1065353216}\nMOV TEMP[0], IN[1]\n'
tail='MOV OUT[1], TEMP[0]\nUSHR TEMP[1], TEMP[0], CONST[0].xxxx\nAND TEMP[1], TEMP[1], IMM[0].xxxx\nSHL TEMP[1], TEMP[1], IMM[0].yyyy\nOR TEMP[1], TEMP[1], IMM[0].zzzz\nMOV OUT[2], TEMP[1]\nMOV OUT[0], IN[0]\nEND\n'
values=[F(1,2**126),F(1,2**100),F(1,2**24),F(1,2),F(2**23-1,2**23),F(1),F(2**23+1,2**23),F(2),F(2**24-1,2**23),F(2**100),F(2**126)]
def pair(x):return [str(x.numerator),str(x.denominator)]
programs=[]
for op in ['RCP','RSQ']:
 for mask in ['w','xyzw']:
  text=head+op+' TEMP[0]'+('' if mask=='xyzw' else '.w')+', TEMP[0].xyzw\n'+tail
  raw=text.encode();result=json.loads(lib.bridge_translate(0,raw,len(raw)));assert result['ok']
  vectors=[]
  for x in values:
   a=[x,F(13,4),F(17,4),F(19,4)];expected=[{'kind':op.lower(),'input':pair(x)} if c in mask else {'kind':'exact','q':pair(a[i])} for i,c in enumerate('xyzw')]
   vectors.append({'inputs':[list(map(float,a))],'expectations':expected})
  programs.append({'name':op+'-edge-alias-'+mask,'text':text,'result':result,'vectors':vectors,'mask':mask})
(V/'edges-gpu-inputs.json').write_text(json.dumps({'runtimeSourceDigests':b['runtimeDigests'],'librarySha256':hashlib.sha256(library.read_bytes()).hexdigest(),'label':'edges','programs':programs},indent=2)+'\n')
