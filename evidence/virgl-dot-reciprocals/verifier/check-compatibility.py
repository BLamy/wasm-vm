"""Independent reconstruction plus adversarial successor receipt input tests."""
import copy,hashlib,importlib.util,json,os,pathlib,shutil,struct,subprocess,sys,tempfile
V=pathlib.Path(__file__).resolve().parent;ROOT=V.parents[2];source=pathlib.Path(sys.argv[1]).resolve();parent='3adaa72f95fd88b8fefd5caa32d6407df22af1dd'
def sha(b):return hashlib.sha256(b).hexdigest()
held=json.loads(subprocess.check_output(['git','show',parent+':evidence/virgl-component-floats/worker/native/native-report.json'],cwd=ROOT));actual=json.loads((source/'native/native-report.json').read_text())
expected=copy.deepcopy(held)
for e in expected['numericCases']:
 if e['name'] in ['unsupported-DP3-vertex','unsupported-DP3-fragment']:
  assert e['text'].count('DP3 TEMP[117], IN[1], IMM[0].yyyy')==1
  e['name']=e['name'].replace('DP3-','DP3-absolute-')
  e['text']=e['text'].replace('DP3 TEMP[117], IN[1], IMM[0].yyyy','DP3 TEMP[117], |IN[1]|, IMM[0].yyyy')
  e['bytes']=len(e['text'].encode());e['inputSha256']=sha(e['text'].encode())
for k in ['originals','rawCases','rawPairs','integerCases','integerPairs','floatCases','floatPairs','numericCases','numericPairs','cases','pairs','recoverySingles','recoveryPairs','stats','seeds','layout','recordedMaxima']:
 assert actual[k]==expected[k],('complete predecessor mismatch',k)
for p in ['renderer/virgl-shader/native_tests/component_floats.c','tools/virgl-component-floats/native.py','tools/virgl-component-floats/native_receipt.py']:
 assert (ROOT/p).read_bytes()==subprocess.check_output(['git','show',parent+':'+p],cwd=ROOT)
profiles=['virgl-webgl2-straight-line-v5']+[f'virgl-webgl2-raw-bits-v{i}' for i in range(1,6)]
rows=[];pairs=[]
for prefix,ck,pk in [('raw::','rawCases','rawPairs'),('integer::','integerCases','integerPairs'),('float::','floatCases','floatPairs'),('numeric::','numericCases','numericPairs'),('','cases','pairs')]:
 rows.extend((prefix+r['name'],r) for r in expected[ck]);pairs.extend((prefix+p['name'],prefix,p) for p in expected[pk])
ids={n:i for i,(n,_) in enumerate(rows)};pids={n:i for i,(n,_,_) in enumerate(pairs)}
stream=bytearray(b'VGC5'+struct.pack('<I',19))
for e in expected['originals']:
 raw=(ROOT/e['path']).read_bytes();assert sha(raw)==e['sha256'];stream+=struct.pack('<III',int(e['stage']=='fragment'),int(e['ok']),len(raw))+raw
stream+=struct.pack('<I',len(rows))
for n,e in rows:
 nb=n.encode();raw=e['text'].encode();profile=profiles.index(e['profile']) if e.get('profile') else 0
 stream+=struct.pack('<IIIII',int(e['stage']=='fragment'),int(e['ok']),profile,len(nb),len(raw))+nb+raw
stream+=struct.pack('<I',len(pairs))
for n,p,e in pairs:
 nb=n.encode();stream+=struct.pack('<IIII',ids[p+e['vertexCaseName']],ids[p+e['fragmentCaseName']],int(e['ok']),len(nb))+nb
stream+=struct.pack('<12I',*[ids[n] for n in held['recoverySingles']])+struct.pack('<10I',*[pids[n] for n in held['recoveryPairs']])
assert bytes(stream)==(source/'native/native-input.bin').read_bytes() and sha(stream)==actual['streamSha256']
spec=importlib.util.spec_from_file_location('independent_verifier_receipt',ROOT/'tools/virgl-dot-reciprocals/native_receipt.py');receipt=importlib.util.module_from_spec(spec);spec.loader.exec_module(receipt)
receipt.verify_recording(source,compatibility=True)
mutations={
 'rename-case':lambda r:r['numericCases'][0].update(name='forged-name'),
 'change-migration-transform':lambda r:r['migrations'][0].update(replacementInputSha256='1'*64),
 'change-input-and-rehash':lambda r:r['numericCases'][0].update(text=r['numericCases'][0]['text']+'\n',bytes=r['numericCases'][0]['bytes']+1,inputSha256=sha((r['numericCases'][0]['text']+'\n').encode())),
 'change-full-result':lambda r:r['cases'][0]['result'].update(glsl=r['cases'][0]['result'].get('glsl','')+' '),
 'change-anchor':lambda r:r['recoverySingles'].__setitem__(0,r['recoverySingles'][1]),
 'change-seed':lambda r:r['seeds'].__setitem__(0,'00000001'),
 'change-log-digest':lambda r:r.update(logSha256='0'*64),
 'claim-historical-full-gate':lambda r:r['compatibility'].update(predecessorFullGateClaimed=True),
 'remove-case':lambda r:r['rawCases'].pop(),
 'change-stream-and-rehash':None,
 'change-log-and-rehash':None,
}
results=[]
with tempfile.TemporaryDirectory(prefix='scalar-verifier-compat-') as temp:
 for name,mutate in mutations.items():
  out=pathlib.Path(temp)/name/'native';out.mkdir(parents=True)
  for p in (source/'native').iterdir():
   if p.name in ['native-report.json','native-input.bin','native.log']:shutil.copy2(p,out/p.name)
   else:os.symlink(p,out/p.name,target_is_directory=p.is_dir())
  r=copy.deepcopy(actual)
  if mutate:mutate(r)
  elif name=='change-stream-and-rehash':
   b=bytearray((out/'native-input.bin').read_bytes());b[-1]^=1;(out/'native-input.bin').write_bytes(b);r['streamSha256']=sha(b)
  else:
   b=(out/'native.log').read_bytes().replace(b'SEED 6bd2c931',b'SEED 00000001');assert sha(b)!=r['logSha256'];(out/'native.log').write_bytes(b);r['logSha256']=sha(b)
  (out/'native-report.json').write_text(json.dumps(r))
  try:receipt.verify_recording(out.parent,compatibility=True)
  except (ValueError,AssertionError,KeyError,IndexError) as e:results.append({'attack':name,'status':'rejected','reason':str(e)})
  else:raise AssertionError('tampering escaped:'+name)
report={'status':'passed','source':str(source),'baselineSha256':sha(subprocess.check_output(['git','show',parent+':evidence/virgl-component-floats/worker/native/native-report.json'],cwd=ROOT)),'streamBytes':len(stream),'streamSha256':sha(stream),'cases':len(rows),'pairs':len(pairs),'anchors':[12,10],'exactStats':actual['stats'],'mutations':results,'reportSha256':sha((source/'native/native-report.json').read_bytes())}
(V/'compatibility-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','streamBytes':len(stream),'cases':len(rows),'pairs':len(pairs),'tamperRejections':len(results)}))
