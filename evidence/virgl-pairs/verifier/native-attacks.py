import hashlib,itertools,json,os,struct,subprocess
from pathlib import Path
R=Path.cwd();V=R/'evidence/virgl-pairs/verifier';B=R/'target/virgl-pairs-verifier';h=lambda b:hashlib.sha256(b).hexdigest()
MASK={3:'xy',7:'xyz',15:''}
def vertex(reg=1,sid=0,mask=15):
 suffix='.'+MASK[mask] if mask!=15 else ''
 return f'VERT\nDCL IN[0]\nDCL IN[1]\nDCL OUT[0], POSITION\nDCL OUT[{reg}]{suffix}, GENERIC[{sid}]\nMOV OUT[0], IN[0]\nMOV OUT[{reg}]{suffix}, IN[1]\nEND\n'
def fragment(reg=0,sid=0,mask=15,flat=True):
 suffix='.'+MASK[mask] if mask!=15 else ''
 return f'FRAG\nDCL IN[{reg}]{suffix}, GENERIC[{sid}], {"CONSTANT" if flat else "PERSPECTIVE"}\nDCL OUT[0], COLOR\nIMM[0] FLT32 {{0,0,0,1}}\nMOV OUT[0], IMM[0]\nMOV OUT[0]{suffix}, IN[{reg}]\nEND\n'
flat_path=R/'evidence/virgl-corpus/captures/compositor/shaders/67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa.tgsi';flat=flat_path.read_text();assert h(flat.encode())==flat_path.stem
anchorV=vertex();anchorF=flat;cases=[]
def add(name,v,f,ok=True,key=None,browser=False,mode=2):cases.append({'name':name,'vertexText':v,'fragmentText':f,'expected':ok,'key':key,'browser':browser,'mode':mode})
add('original-flat-anchor',anchorV,flat,True,'generic-interpolation-v1:g0/15/flat',True)
for vr,fr,vs,fs,vm,fm,fl in itertools.product([1,3,7],[0,1,7],[0,3,7],[0,3,7],[3,7,15],[3,7,15],[False,True]):
 key=f'generic-interpolation-v1:g{fs}/{fm}/{"flat" if fl else "smooth"}'
 add(f'map-{vr}-{fr}-{vs}-{fs}-{vm}-{fm}-{int(fl)}',vertex(vr,vs,vm),fragment(fr,fs,fm,fl),vs==fs and fm&vm==fm,key,browser=vr==7 and fr==1)
# Two semantics, nonuniform modes, and all physical/declaration permutations.
for semantics in itertools.permutations([0,3,7],2):
 for vo,fo,reverse,flats in itertools.product([(1,7),(7,1)],[(0,7),(7,0)],[False,True],itertools.product([False,True],repeat=2)):
  masks=[3,15];vd=['DCL IN[0]','DCL IN[1]','DCL OUT[0], POSITION'];fd=[];vw=['MOV OUT[0], IN[0]'];fw=['MOV OUT[0], IMM[0]']
  order=[1,0] if reverse else [0,1]
  for i in order:
   suffix='.xy' if masks[i]==3 else '';vd.append(f'DCL OUT[{vo[i]}]{suffix}, GENERIC[{semantics[i]}]');fd.append(f'DCL IN[{fo[i]}]{suffix}, GENERIC[{semantics[i]}], {"CONSTANT" if flats[i] else "PERSPECTIVE"}');vw.append(f'MOV OUT[{vo[i]}]{suffix}, IN[1]');fw.append(f'MOV OUT[0]{suffix}, IN[{fo[i]}]')
  v='VERT\n'+'\n'.join(vd+vw+['END'])+'\n';f='FRAG\n'+'\n'.join(fd+['DCL OUT[0], COLOR','IMM[0] FLT32 {0,0,0,1}']+fw+['END'])+'\n'
  key='generic-interpolation-v1:'+';'.join(f'g{s}/{m}/{"flat" if flag else "smooth"}' for s,m,flag in sorted(zip(semantics,masks,flats)))
  add(f'mixed-{semantics}-{vo}-{fo}-{reverse}-{flats}',v,f,True,key,browser=semantics==(3,0))
emptyF='FRAG\nDCL OUT[0], COLOR\nIMM[0] FLT32 {1,0,0,1}\nMOV OUT[0], IMM[0]\nEND\n';emptyV='VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nMOV OUT[0], IN[0]\nEND\n'
add('empty-interface',emptyV,emptyF,True,'generic-interpolation-v1:',True)
add('unused-vertex-interface',anchorV,emptyF,True,'generic-interpolation-v1:',True)
add('missing-producer',emptyV,flat,False,browser=True)
for word in ['CONSTANTX','CONSTANT CONSTANT','CONSTANT, PERSPECTIVE','CONSTANT, CENTROID','LINEAR','COLOR','', 'CONSTANT 0']:
 add('bad-mode-'+word,anchorV,flat.replace('CONSTANT',word),False,browser=True)
for text in [flat.replace('DCL OUT[0], COLOR','DCL IN[7], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR'),flat.replace('GENERIC[0]','GENERIC[8]'),flat.replace('GENERIC[0], CONSTANT','GENERIC[0] CONSTANT')]:add('bad-decl-'+h(text.encode())[:8],anchorV,text,False,browser=True)
add('vertex-constant',anchorV.replace('GENERIC[0]','GENERIC[0], CONSTANT'),flat,False,browser=True)
add('vertex-invalid-after-match',anchorV.replace('MOV OUT[0]','MOV_PRECISE OUT[0]'),flat,False,browser=True)
add('fragment-invalid-after-match',anchorV,flat.replace('MOV OUT[0]','MOV_PRECISE OUT[0]'),False,browser=True)
for size in [16384,16385]:
 for side in ['v','f','both']:
  v=anchorV+'\n'*(size-len(anchorV)) if side in ['v','both'] else anchorV
  f=flat+'\n'*(size-len(flat)) if side in ['f','both'] else flat
  add(f'bytes-{side}-{size}',v,f,size==16384,'generic-interpolation-v1:g0/15/flat',True)
for mode in [3,4,5,6]:add(f'native-null-length-{mode}',anchorV,flat,False,mode=mode)
for side in ['v','f']:
 for byte in ['\x00','\x01','\u00e9']:
  add(f'invalid-byte-{side}-{ord(byte)}',anchorV+(byte if side=='v' else ''),flat+(byte if side=='f' else ''),False,browser=ord(byte)<128)
for name,text,stage in [('wrong-v-stage',flat,1),('wrong-f-stage',anchorV,0)]:add(name,text if stage else anchorV,flat if stage else text,False,browser=True)
new={'003270109615e05345631cf8a2273ebc1bf3d86c7590e05ddc8424c441db7605','9819066def2df1cd09f36f142fd2bc6b659395aa21bea6db7f58fbcc122c7c83','403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c','e9bc6d3b61e3cda2c215ac8b44a432e2eb1bd4891cfa921c6f914fd3fd86b551',flat_path.stem}
for row in json.loads((R/'docs/virgl-shader-original-inventory.json').read_text())['rows']:
 text=(R/row['paths'][0]).read_text();assert h(text.encode())==row['sha256'];add('original-'+row['sha256'],text,'',row['sha256'] in new or row['recordedT10dOutcome']=='translated',mode=int(row['stage']=='FRAG'))
# Independent seeds fixed in predictions, 512 mutations each, bounded structure/recovery oracle.
for seed in [0x00e612e2,0x47c033a9]:
 state=seed
 def rng():
  global state
  state^=(state<<13)&0xffffffff;state^=state>>17;state^=(state<<5)&0xffffffff;state&=0xffffffff;return state
 for n in range(512):
  side=rng()%2;b=bytearray((anchorV if not side else flat).encode())
  for k in range(1+rng()%4):b[rng()%len(b)]=rng()%128
  text=b.decode('ascii');add(f'mutation-{seed:08x}-{n}',text if not side else anchorV,flat if not side else text,None)
stream=bytearray();order=[]
def emit(mode,v,f,i):
 a=v.encode();b=f.encode();stream.extend(struct.pack('<III',mode,len(a),len(b))+a+b);order.append(i)
for i,c in enumerate(cases):
 emit(c['mode'],c['vertexText'],c['fragmentText'],i)
 emit(2,anchorV,flat,'pair-recovery');emit(0,anchorV,'','single-recovery')
(B/'cases.bin').write_bytes(stream)
p=subprocess.run([str(B/'baseline')],input=stream,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'ASAN_OPTIONS':'abort_on_error=1','UBSAN_OPTIONS':'halt_on_error=1','LLVM_PROFILE_FILE':str(B/'native-%p.profraw')})
(V/'native-run.log').write_bytes(p.stderr);assert p.returncode==0,(p.returncode,p.stderr[-1000:])
results=[json.loads(s) for s in p.stdout.splitlines()];assert len(results)==len(order)
records=[];browser=[];recover={}
for i,result in zip(order,results):
 if isinstance(i,str):
  assert result['ok'];recover.setdefault(i,result);assert recover[i]==result;continue
 c=cases[i];assert isinstance(result.get('ok'),bool)
 if c['expected'] is not None:assert result['ok']==c['expected'],(c,result)
 if not result['ok']:assert set(result)=={'ok','error'}
 if result['ok'] and c['mode']==2 and c['key'] is not None:assert result['interfaceKey']==c['key'],(c,result)
 rec={k:v for k,v in c.items() if k not in ['vertexText','fragmentText']};rec.update(vertexSha256=h(c['vertexText'].encode()),fragmentSha256=h(c['fragmentText'].encode()),actual=result['ok'],resultSha256=h(json.dumps(result,sort_keys=True).encode()))
 if not result['ok']:rec['error']=result['error']
 records.append(rec)
 if c['browser']:browser.append({**c,'native':result})
report={'status':'passed','cases':len(cases),'translations':len(order),'pairRecoveries':len(cases),'singleRecoveries':len(cases),'browserCases':len(browser),'mutations':1024,'binarySha256':h((B/'baseline').read_bytes()),'streamSha256':h(stream),'stderr':p.stderr.decode(),'records':records}
(V/'native.json').write_text(json.dumps(report,indent=2)+'\n');(V/'browser-cases.json').write_text(json.dumps(browser,indent=2)+'\n');(V/'anchors.json').write_text(json.dumps({'vertexText':anchorV,'fragmentText':flat,'pair':recover['pair-recovery'],'singleVertex':recover['single-recovery']},indent=2)+'\n')
# Isolated native source control drops the derived vertex key but retains real upstream conversion.
b=anchorV.encode();f=flat.encode();raw=struct.pack('<III',2,len(b),len(f))+b+f
r=subprocess.run([str(B/'flat-interface-omission')],input=raw,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'ASAN_OPTIONS':'abort_on_error=1','UBSAN_OPTIONS':'halt_on_error=1','LLVM_PROFILE_FILE':str(B/'mutant-%p.profraw')});assert r.returncode==0,r.stderr
mutant=json.loads(r.stdout);import re
flatout=lambda s:bool(re.search(r'\bflat\s+out\s+vec4\s+vso_g0\b',s))
assert flatout(recover['pair-recovery']['vertex']['glsl']) and mutant['ok'] and not flatout(mutant['vertex']['glsl'])
(V/'native-sabotage.json').write_text(json.dumps({'status':'passed','control':'derived vertex qualifier omission','expectedFlatOutput':True,'observedFlatOutput':False,'mutatedResult':mutant,'stderr':r.stderr.decode()},indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='records'},indent=2))
