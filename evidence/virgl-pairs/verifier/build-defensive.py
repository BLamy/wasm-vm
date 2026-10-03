import json,subprocess,hashlib,os
from pathlib import Path
R=Path.cwd();V=R/'evidence/virgl-pairs/verifier';B=R/'target/virgl-pairs-verifier';d=json.loads((V/'native-build.json').read_text());base=d['commands'][0];common=base[:base.index('-c')];n=len(d['sources'])-1
compile=common+['-fprofile-instr-generate','-fcoverage-mapping','-c',str(V/'defensive.c'),'-o',str(B/'defensive.o')]
link=common+['-fprofile-instr-generate',*[str(B/f'dep{i}.o')for i in range(n-1)],str(B/'defensive.o'),'-lm','-o',str(B/'defensive')]
for command in [compile,link]:subprocess.run(command,check=True)
p=subprocess.run([str(B/'defensive')],capture_output=True,env={**os.environ,'ASAN_OPTIONS':'abort_on_error=1','UBSAN_OPTIONS':'halt_on_error=1','LLVM_PROFILE_FILE':str(B/'native-defensive-%p.profraw')});assert p.returncode==0,p.stderr.decode();result=json.loads(p.stdout);result.update(commands=[compile,link],binarySha256=hashlib.sha256((B/'defensive').read_bytes()).hexdigest(),sourceSha256=hashlib.sha256((R/'renderer/virgl-shader/bridge.c').read_bytes()).hexdigest(),stderr=p.stderr.decode());(V/'defensive.json').write_text(json.dumps(result,indent=2)+'\n');print(p.stdout.decode())
