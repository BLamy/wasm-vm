from pathlib import Path
import hashlib,json,time,urllib.request
root=Path('/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905');out=Path('/private/tmp/e5-5-t07-live-hashes-v1');out.mkdir(exist_ok=False)
paths=['pkg/wasm_vm_wasm_bg.wasm','pkg/wasm_vm_wasm.js','loader.js','snapshot-stream.js','gpu-checkpoint-build.js','artifacts-omarchy.json']
report={'status':'running','url':'https://wasm-vm.pages.dev/','started':time.time(),'files':[]}
try:
 for rel in paths:
  expected=(Path('/private/tmp/e5-5-t07-deploy-v1/staged-manifests')/'artifacts-omarchy.json') if rel=='artifacts-omarchy.json' else root/'web/dist'/rel
  req=urllib.request.Request('https://wasm-vm.pages.dev/'+rel+'?e5-stream=9341693b2',headers={'Cache-Control':'no-cache'})
  with urllib.request.urlopen(req,timeout=60) as response:
   data=response.read();row={'path':rel,'url':response.url,'status':response.status,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'expectedSha256':hashlib.sha256(expected.read_bytes()).hexdigest(),'headers':dict(response.headers)}
  assert data==expected.read_bytes(),rel+' differs from reviewed deployment'
  if rel=='artifacts-omarchy.json':
   entry=json.loads(data)['artifacts']['bootSnapshot'];assert entry['uncompressedSize']==634769246 and entry['uncompressedSha256']=='a356cd7455a7b5c7dddb67523e14bcfb07029b8846955ff5245d4a35ac23f762'
  report['files'].append(row)
 report['status']='passed'
except BaseException as e:report['status']='failed';report['failure']=repr(e)
finally:
 report['finished']=time.time();(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'files':len(report['files']),'failure':report.get('failure')}))
raise SystemExit(0 if report['status']=='passed' else 1)
