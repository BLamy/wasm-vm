import hashlib,json,pathlib
O=pathlib.Path(__file__).resolve().parent;R=O.parents[2];P=R/'evidence/virgl-float-masks/worker/native/coverage.json'
data=json.loads(P.read_text());wanted={'raw_bits.c':{53,54,55,56,57,58,101,176,196,214,216},'bridge.c':{296,297,461,586}};records=[]
for d in data['data']:
 for f in d['files']:
  name=pathlib.Path(f['filename']).name
  if name not in wanted:continue
  found=set()
  for b in f['branches']:
   if b[0] not in wanted[name]:continue
   assert b[4]>0 and b[5]>0,(name,b)
   records.append(dict(file='renderer/virgl-shader/'+name,line=b[0],column=b[1],endLine=b[2],endColumn=b[3],trueCount=b[4],falseCount=b[5]));found.add(b[0])
  assert found==wanted[name],(name,found)
report=dict(status='passed',frozenHead='d549500106399ada00fcd48f1439bd107377ebc5',conditions=len(records),outcomes=len(records)*2,records=records,coverageSha256=hashlib.sha256(P.read_bytes()).hexdigest())
(O/'coverage-branches.json').write_text(json.dumps(report,indent=2)+'\n');print(dict(status='passed',conditions=len(records),outcomes=len(records)*2))
