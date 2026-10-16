"""Verifier-authored test sabotage; unsafe shader translations never reach a GPU."""
import hashlib,json,pathlib,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[3];out=pathlib.Path(__file__).resolve().parent
source=root/'renderer/virgl-command/constant-domain.mjs';raw=source.read_text();before='if (!(word >= 0x80000000 || word <= 18))';assert raw.count(before)==1
with tempfile.TemporaryDirectory(prefix='e9-count-sabotage-') as temporary:
 module=pathlib.Path(temporary)/'count-bypass.mjs';module.write_text(raw.replace(before,'if (false)'))
 result=subprocess.run(['node',str(out/'consumer.mjs'),str(module)],text=True,capture_output=True)
 assert result.returncode!=0 and 'word 13' in result.stderr and 'true !== false' in result.stderr
 count=dict(source=str(source.relative_to(root)),before=before,after='if (false)',sourceSha256=hashlib.sha256(raw.encode()).hexdigest(),mutantSha256=hashlib.sha256(module.read_bytes()).hexdigest(),returncode=result.returncode,stdout=result.stdout,stderr=result.stderr)
base=json.loads((out/'attack-results.json').read_text())[0]['input'];before='UADD TEMP[48].w, TEMP[43].wwww, IMM[0].zzzz';after='UADD TEMP[48].w, TEMP[43].wwww, IMM[0].yyyy';assert base.count(before)==1
mutant=base.replace(before,after);translations=[]
for name,path,expected in [('healthy',root/'renderer/virgl-shader/build/native/virgl-shader',False),('recurrence-fault',root/'evidence/virgl-bounded-loops/worker/fault-artifacts/recurrence-guard/native/virgl-shader',True)]:
 p=subprocess.run([str(path),'vertex'],input=mutant,text=True,capture_output=True,check=True);value=json.loads(p.stdout);assert value['ok'] is expected;translations.append(dict(mode=name,binarySha256=hashlib.sha256(path.read_bytes()).hexdigest(),result=value,stderr=p.stderr))
# Execute the mutant's raw integer recurrence itself. Changing only j's
# increment destroys a=j+10 and b=16*j; those healthy invariants must not be
# carried into this counterexample. The early comparison is false (all table
# words and q are zero), and signed raw count18 forces exit at the third header.
j,a,b=1,11,16;header_j=[];header_addresses=[];states=[]
while True:
 header_j.append(j);header_addresses.append(a);states.append({'j':j,'a':a,'b':b})
 if j>=18:break
 next_j=(j+16)&0xffffffff;shift=(j<<4)&0xffffffff
 b=(shift+16)&0xffffffff;a=((176+shift)&0xffffffff)>>4;j=next_j
 assert len(states)<10
shift=(j<<4)&0xffffffff
predecessor=((144+shift)&0xffffffff)>>4
lower=((432+shift)&0xffffffff)>>4
upper=((448+b)&0xffffffff)>>4
tail=[predecessor,upper,lower]
assert header_j==[1,17,33] and header_addresses==[11,12,28] and tail==[42,46,60]
recurrence=dict(before=before,after=after,input=mutant,inputSha256=hashlib.sha256(mutant.encode()).hexdigest(),translations=translations,countWord=18,headerJ=header_j,headerAddresses=header_addresses,headerStates=states,tailAddresses=tail,gpuDispatched=False)
(out/'sabotage-results.json').write_text(json.dumps({'countAdmission':count,'recurrenceAdmission':recurrence},indent=2)+'\n');print('count bypass fails at19; missing recurrence check admits +16 counterexample, CPU translation only')
