import concurrent.futures,gzip,hashlib,json,subprocess,time,urllib.request
from pathlib import Path
root=Path.cwd(); notes=root/'target/evidence/e9-t05-final-review'; compact=root/'evidence/e9-t05/public'; p=json.loads((compact/'provenance.json').read_text()); original=Path(p['original_evidence']); b=json.loads((original/'report.json').read_text())
sha=lambda data:hashlib.sha256(data).hexdigest()
def file_sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1<<20),b''):h.update(chunk)
 return h.hexdigest()
def git(*args):return subprocess.check_output(['git','--no-optional-locks',*args],cwd=root)
def check(path,size,digest):assert path.is_file() and path.stat().st_size==size and file_sha(path)==digest,str(path)
assert p['status']=='passed' and p['head']==b['head']=='3508ad16ca0de135f06e6f7cc8d2fb4b3a879332' and p['runtime_head']=='4ce36a932feaf171c09cd8b25e90d3fc9ff376ac'
assert p['report_sha256']==file_sha(original/'report.json')=='6b31a2af91a67ab9f6eac8bec336bc96d9e543fb18ffbddbb18b2be83cf03217'
assert p['source_clean_before_and_after'] and p['deployment']=='https://6545bb6f.wasm-vm.pages.dev' and p['production']=='https://wasm-vm.pages.dev/'
assert p['command']==['node','tools/verify/e9-software-checkpoints-browser.mjs','--url','https://wasm-vm.pages.dev/','--output','target/evidence/e9-t05-public-final']
assert len(p['files'])==len({e['path'] for e in p['files']})==781
for e in p['files']:check(original/e['path'],e['bytes'],e['sha256'])
for e in p['packet']:
 check(compact/e['path'],e['bytes'],e['sha256']);check(Path(e['source']),e['source_bytes'],e['source_sha256'])
 body=(compact/e['path']).read_bytes();body=gzip.decompress(body) if e['encoding']=='gzip' else body
 assert len(body)==e['source_bytes'] and sha(body)==e['source_sha256'],e['path']
assert len(p['packet'])==34 and len(p['aliases'])==1
for e in p['aliases']:assert file_sha(original/e['source'])==e['source_sha256']==sha(gzip.decompress((compact/e['packet']).read_bytes()))
assert len(p['source_sha256'])==42
for name,digest in p['source_sha256'].items():
 assert file_sha(root/name)==digest and sha(git('show','7ac83e660cc316440a9e42cf961224f0c24a314a:'+name))==digest,name
current=git('diff','--name-only','7ac83e660cc316440a9e42cf961224f0c24a314a','HEAD').decode().splitlines();allowed={'web/tasks.json','web/dist/tasks.json','web/dist/sw.js'}
assert not [n for n in current if not n.startswith(('evidence/','tasks/')) and n not in allowed]
assets=b['checks']['publicBytes'];assert len(assets)==16
for e in assets:assert e['status']==200;check(root/'web/dist'/e['name'],e['bytes'],e['sha256'])
def http(e):
 url='https://wasm-vm.pages.dev/'+e['name'];request=urllib.request.Request(url,headers={'Cache-Control':'no-cache','User-Agent':'wasm-vm-E9-T05-verifier'})
 with urllib.request.urlopen(request,timeout=45) as response:
  body=response.read();status=response.status;final=response.url
 assert status==200 and len(body)==e['bytes'] and sha(body)==e['sha256'],e['name']
 return {'url':url,'final_url':final,'status':status,'bytes':len(body),'sha256':sha(body)}
started=time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:observed=list(pool.map(http,assets))
deploy=(compact/'deploy.log').read_text();assert '6545bb6f.wasm-vm.pages.dev' in deploy and 'Deployment complete!' in deploy
receipt={'status':'passed','scope':'Read-only provenance/source/HTTP byte checks; no program tests','public_predictions_sha256':file_sha(notes/'public-predictions.md'),'provenance_sha256':file_sha(compact/'provenance.json'),'report_sha256':p['report_sha256'],'source_head':p['head'],'reviewed_head':git('rev-parse','HEAD').decode().strip(),'originals':len(p['files']),'original_bytes':sum(e['bytes'] for e in p['files']),'compact_files':len(p['packet']),'aliases':len(p['aliases']),'source_hashes':len(p['source_sha256']),'source_boundary_unchanged':True,'command':p['command'],'deployment':p['deployment'],'production':p['production'],'deployment_log_sha256':file_sha(compact/'deploy.log'),'recorded_http_files':len(assets),'fresh_http_files':len(observed),'fresh_http_started':started,'fresh_http_finished':time.time(),'http':observed}
(notes/'public-authentication.json').write_text(json.dumps(receipt,indent=2)+chr(10));print(json.dumps({k:v for k,v in receipt.items() if k!='http'},indent=2))
