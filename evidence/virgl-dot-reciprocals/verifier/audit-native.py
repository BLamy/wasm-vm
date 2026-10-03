import ctypes,hashlib,itertools,json,pathlib,subprocess
V=pathlib.Path(__file__).resolve().parent;ROOT=V.parents[2];build=json.loads((V/'builds.json').read_text());T=pathlib.Path(build['directory'])
def compiler(label):
 lib=ctypes.CDLL(str(T/(label+'.dylib')));lib.bridge_translate.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate.restype=ctypes.c_char_p
 def call(text,stage=0):
  raw=text.encode();return json.loads(lib.bridge_translate(stage,raw,len(raw)))
 return call
current,parent=compiler('current'),compiler('parent');out=[]
head='VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..2]\nDCL CONST[0]\n'
tail='MOV OUT[1], TEMP[0]\nMOV OUT[0], IN[0]\nEND\n'
for op in ['DP3','RCP','RSQ']:
 for dst in [1,2,4,8,3,7,15]:
  mask=''.join(c for i,c in enumerate('xyzw') if dst>>i&1)
  for sw in itertools.permutations('xyzw'):
   sw=''.join(sw);consumed=set(sw[:3 if op=='DP3' else 1])
   # Discard initialization and authority independently for each source component.
   for missing in 'xyzw':
    init=''.join(c for c in 'xyzw' if c!=missing)
    for attack in ['initialization','authority']:
     setup='MOV TEMP[0], IN[1]\n'+''.join(f'MOV TEMP[1].{c}, IN[1]\n' for c in init)
     if attack=='authority':setup+=f'MOV TEMP[1].{missing}, CONST[0]\n'
     text=head+setup+f'{op} TEMP[0]'+('' if dst==15 else '.'+mask)+f', -TEMP[1].{sw}'+(', IN[2].wzxy' if op=='DP3' else '')+'\n'+tail
     result=current(text);wanted=missing not in consumed
     assert result['ok']==wanted,(op,mask,sw,missing,attack,result)
     if wanted:assert result['metadata']['profile']=='virgl-webgl2-raw-bits-v6'
     out.append({'opcode':op,'mask':mask,'swizzle':sw,'missing':missing,'attack':attack,'ok':result['ok'],'sourceSha256':hashlib.sha256(text.encode()).hexdigest(),'resultSha256':hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()})
held=json.loads((ROOT/'evidence/virgl-component-floats/worker/native/native-report.json').read_text())
compat=[];migrations=[]
for group in ['rawCases','integerCases','floatCases','numericCases','cases']:
 for e in held[group]:
  result=current(e['text'],int(e['stage']=='fragment'));base=parent(e['text'],int(e['stage']=='fragment'))
  assert base==e['result'],('parent baseline mismatch',group,e['name'])
  if e['name'] in ['unsupported-DP3-vertex','unsupported-DP3-fragment']:
   assert not base['ok'] and result['ok'] and result['metadata']['profile']=='virgl-webgl2-raw-bits-v6';migrations.append(e['name'])
  else:assert result==base,('unlisted complete result difference',group,e['name'])
  compat.append({'group':group,'name':e['name'],'same':result==base})
pairs_checked=[]
for label in ['current','parent']:
 lib=ctypes.CDLL(str(T/(label+'.dylib')));lib.bridge_translate_pair.argtypes=[ctypes.c_char_p,ctypes.c_size_t,ctypes.c_char_p,ctypes.c_size_t];lib.bridge_translate_pair.restype=ctypes.c_char_p
 for group in ['raw','integer','float','numeric','']:
  entries=held[group+'Cases' if group else 'cases'];by_name={e['name']:e for e in entries}
  for e in held[group+'Pairs' if group else 'pairs']:
   a=by_name[e['vertexCaseName']]['text'].encode();b=by_name[e['fragmentCaseName']]['text'].encode()
   result=json.loads(lib.bridge_translate_pair(a,len(a),b,len(b)));assert result==e['result'],('pair result mismatch',label,group,e['name'])
   pairs_checked.append({'compiler':label,'group':group,'name':e['name'],'same':True})
originals=[];inventory=[]
for e in held['originals']:
 text=(ROOT/e['path']).read_text();stage=int(e['stage']=='fragment');a=current(text,stage);b=parent(text,stage)
 assert a==b==e['result'];originals.append({'path':e['path'],'ok':a['ok'],'resultSha256':e['resultSha256']})
 for n,line in enumerate(text.splitlines(),1):
  import re
  if re.search(r'\b(DP3|RCP|RSQ)\b',line):inventory.append({'path':e['path'],'line':n,'text':line,'preciseOriginal':'PRECISE' in text})
assert sum(e['ok'] for e in originals)==12 and all(e['preciseOriginal'] for e in inventory)
report={'status':'passed','runtimeDigests':build['runtimeDigests'],'librarySha256':build['libraries']['current'],'novelAttackCount':len(out),'novelAttacks':out,'compatibility':compat,'compatibilityPairs':pairs_checked,'migrations':migrations,'originals':originals,'captureInventory':inventory}
(V/'native-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'passed','novelAttackCount':len(out),'compatibilityCount':len(compat),'migrations':migrations,'originals':len(originals),'captureInventory':len(inventory)}))
