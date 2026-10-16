from pathlib import Path
import os,json,subprocess,struct,hashlib
R=Path.cwd();V=R/'evidence/virgl-components/verifier';B=R/'target/virgl-components-verifier'
H='FRAG\nDCL OUT[0], COLOR\n';I='IMM[0] FLT32 {0.125, 0.25, 0.5, 1}\n';O='MOV OUT[0], IMM[0]\nEND\n';cs=[]
def add(n,t,ok=False,stage=1):cs.append({'name':n,'text':t,'stage':stage,'ok':ok})
for n,d in [('unknown-file','DCL BOGUS[0]\n'),('missing-bracket','DCL TEMP 0]\n'),('input-range','DCL IN[0..1], GENERIC[0], PERSPECTIVE\n'),('generic-missing-open','DCL IN[0], GENERIC 0], PERSPECTIVE\n'),('generic-missing-close','DCL IN[0], GENERIC[0, PERSPECTIVE\n'),('ordered-wrong-three','DCL IN[0].xyw, GENERIC[0], PERSPECTIVE\n')]:add(n,H+d+I+O)
for n,operand in [('src-range','TEMP[9..9]'),('src-short-swizzle','TEMP[9].xxx'),('src-output','OUT[0]'),('src-sampler','SAMP[0]'),('src-view','SVIEW[0]'),('src-undeclared','TEMP[0]')]:add(n,H+'DCL TEMP[9]\nDCL SAMP[0]\nDCL SVIEW[0], 2D, FLOAT\n'+I+'MOV TEMP[9], IMM[0]\n'+f'MOV OUT[0], {operand}\nEND\n')
add('destination-range',H+'DCL TEMP[9]\n'+I+'MOV TEMP[9..9], IMM[0]\n'+O)
add('source-missing-comma',H+I+'MOV OUT[0] IMM[0]\nEND\n')
add('imm-after-start',H+I+'MOV OUT[0], IMM[0]\nIMM[1] FLT32 {1,1,1,1}\nEND\n')
add('imm-missing-open',H+'IMM 0] FLT32 {1,1,1,1}\n'+O)
add('imm-missing-close',H+'IMM[0 FLT32 {1,1,1,1}\n'+O)
add('imm-sequence-hole',H+'IMM[1] FLT32 {1,1,1,1}\n'+O)
add('constant-seven-gap',H+'DCL CONST[7]\nMOV OUT[0], CONST[7]\nEND\n',True)
add('input-seven-semantic-seven',H+'DCL IN[7].xyz, GENERIC[7], PERSPECTIVE\n'+I+'MOV OUT[0], IMM[0]\nMOV OUT[0].xyz, IN[7]\nEND\n',True)
add('sampler-view-seven',H+'DCL SAMP[7]\nDCL SVIEW[7], 2D, FLOAT\n'+I+'TEX OUT[0], IMM[0], SAMP[7], 2D\nEND\n',True)
add('imm-seven-sequential',H+''.join(f'IMM[{i}] FLT32 {{0,0,0,1}}\n' for i in range(8))+'MOV OUT[0], IMM[7]\nEND\n',True)
add('out-seven-semantic-seven','VERT\nDCL IN[7]\nDCL OUT[0], POSITION\nDCL OUT[7].xyz, GENERIC[7]\nMOV OUT[0], IN[7]\nMOV OUT[7].xyz, IN[7]\nEND\n',True,0)
# source declaration scalar masks remain rejected on non-GENERIC outputs.
add('position-xyz','VERT\nDCL IN[0]\nDCL OUT[0].xyz, POSITION\nMOV OUT[0].xyz, IN[0]\nEND\n',False,0)
b=bytearray()
for c in cs:
 t=c['text'].encode();b+=struct.pack('<II',c['stage'],len(t))+t
p=subprocess.run([str(B/'baseline')],input=b,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'ASAN_OPTIONS':'abort_on_error=1','UBSAN_OPTIONS':'halt_on_error=1','LLVM_PROFILE_FILE':str(B/'native-supp-%p.profraw')})
assert p.returncode==0,p.stderr
results=[json.loads(s) for s in p.stdout.splitlines()];assert len(results)==len(cs)
for c,result in zip(cs,results):
 assert result['ok']==c['ok'],(c,result)
 c['native']=result
(V/'supplemental-cases.json').write_text(json.dumps(cs,indent=2)+'\n')
(V/'supplemental-native.json').write_text(json.dumps({'status':'passed','cases':len(cs),'streamSha256':hashlib.sha256(b).hexdigest(),'binarySha256':hashlib.sha256((B/'baseline').read_bytes()).hexdigest(),'stderr':p.stderr.decode()},indent=2)+'\n')
print('24 supplemental native cases passed')
