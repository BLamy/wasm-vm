import hashlib,json,pathlib,struct
O=pathlib.Path(__file__).resolve().parent;R=O.parents[2];P=R/'evidence/virgl-float-masks/worker/hardware/report.json';a=json.loads(P.read_text())['acceptance'];checks=0

def check(x,m):
 global checks
 checks+=1
 if not x:raise AssertionError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
anchors={c['name']:c for c in a['anchors']};pairs={p['name']:p for p in a['pairs']};pixels=0
for draw in a['pairDraws']:
 raw=bytes(draw['rawBytes']);check(sha(raw)==draw['bytesSha256'],'framebuffer hash');check(len(raw)==32*32*4,'framebuffer extent')
 for stage in ['vertex','fragment']:check(sha(pairs[draw['name']]['result'][stage]['glsl'].encode())==draw[stage+'GlslSha256'],'actual linked pair GLSL')
 for y in range(32):
  for x in range(32):
   if x+y==31:continue # exact primitive diagonal rasterization ownership, no interpolation claim there
   expected=[0,0,255,255] if x+y>31 else [0,255,0,255] if draw['mode']=='flat' else [round((x+.5)/32*255),round((y+.5)/32*255),0,255]
   check(list(raw[(y*32+x)*4:(y*32+x)*4+4])==expected,f"pair {draw['name']} pixel({x},{y})");pixels+=1
# Interpret the actual source, independent of the browser operation labels or expected masks.
from worker_semantics import interpret,ordered
for stage,probe in a['finiteSelections'].items():
 for e in probe['captures' if stage=='vertex' else 'draws']:
  words=e['upload']['words'];check(words[:4]==e['operands']['a']==e['upload']['observedA'],'actual finite A');check(words[180:184]==e['operands']['b']==e['upload']['observedB'],'actual finite B')
  selected=[ordered(x,y,stage=='fragment') for x,y in zip(words[:4],words[180:184])]
  check(e['expectedMaskWords']==selected,'finite reference ordered masks')
  output=interpret(anchors[probe[stage]]['text'],words,{0:[0,0,0,0x3f800000]})
  if stage=='vertex':
   bits=output[0]+output[1];raw=struct.pack('<8I',*bits)
   check(e['observedBits']==bits==e['expectedBits'],'finite exact TF0/1');check(bytes(e['rawBytes'])==raw,'finite TF raw bytes')
  else:
   check(all(x in [0,0x3f800000] for x in output[0]),'finite binary32 zero/one')
   raw=bytes(255 if x else 0 for x in output[0]);check(e['observedBytes']==list(raw)==e['expectedBytes'],'finite exact FS0/1')
  check(sha(raw)==e['bytesSha256'],'finite readback digest')
pressure=a['allocationPressure'];failure_messages=set();capacity=[]
for target in pressure['targets']:
 check(target['heapBefore']==target['heapAfter']==16777216,'fixed heap before/after pressure')
 check(target['reservedChunks']==target['releasedChunks'],'all pressure allocations released')
 check(target['capacityBefore']==target['capacityAfter'],'capacity recovered on same Wasm module')
 for attempt in target['attempts']:
  check(attempt['capacityBefore']==attempt['capacityAfter'],'per-attempt capacity')
  if not attempt['result']['ok']:failure_messages.add(attempt['result']['error']['message'])
 baseline=(pairs if target['kind']=='pair' else anchors)[target['name']]['result']
 check(target['recoveredResult']==baseline,'complete result recovery')
 for entry in target['recoveryPairs']:check(entry['result']==pairs[entry['name']]['result'],'mixed pair full recovery')
 capacity.append({'name':target['name'],'before':target['capacityBefore'],'after':target['capacityAfter']})
check({'Raw IR allocation failed.','Raw GLSL allocation or output bound failed.'}<=failure_messages,'both owned allocation failures')
check(a['objects']['live']==0 and a['objects']['created']==a['objects']['deleted'],'GL lifecycle complete')
report=dict(status='passed',checks=checks,interpolationPixels=pixels,finiteSelections=24,allocationFailureMessages=sorted(failure_messages),capacity=capacity,objects=a['objects'],workerHardwareSha256=sha(P.read_bytes()),scriptSha256=sha(pathlib.Path(__file__).read_bytes()))
(O/'hardware-details.json').write_text(json.dumps(report,indent=2)+'\n');print({k:report[k] for k in ['status','checks','interpolationPixels','finiteSelections']})
