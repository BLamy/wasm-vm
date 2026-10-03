from pathlib import Path
import hashlib,json,os,struct,subprocess
r=Path.cwd();v=r/'evidence/virgl-banks/verifier';b=r/'target/virgl-banks-verifier';g=json.loads((v/'gpu.json').read_text());stream=bytearray()
for c in g['result']['translations']:
 text=c['text'].encode();stream+=struct.pack('<III',int(c['stage']=='fragment'),len(text),0)+text
run=subprocess.run([str(b/'baseline')],input=stream,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=dict(os.environ,ASAN_OPTIONS='abort_on_error=1',UBSAN_OPTIONS='halt_on_error=1',LLVM_PROFILE_FILE=str(b/'extras.profraw')),timeout=30)
assert run.returncode==0 and not run.stderr,run.stderr
records=[]
assert len(g['result']['translations'])==len(run.stdout.splitlines())
for x,line in zip(g['result']['translations'],run.stdout.splitlines()):
 result=json.loads(line);assert result==x['result'],x['name'];records.append({'name':x['name'],'stage':x['stage'],'textSha256':hashlib.sha256(x['text'].encode()).hexdigest(),'result':result})
(v/'extra-native-parity.json').write_text(json.dumps({'status':'passed','inputs':len(records),'records':records,'streamSha256':hashlib.sha256(stream).hexdigest(),'stdoutSha256':hashlib.sha256(run.stdout).hexdigest(),'binarySha256':hashlib.sha256((b/'baseline').read_bytes()).hexdigest()},indent=2)+'\n')
print('Six exact additional hardware shader inputs independently match native results.')
