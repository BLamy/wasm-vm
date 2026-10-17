import hashlib,json,pathlib,subprocess,time
root=pathlib.Path.cwd(); out=root/'target/e9-t04-base-publication'; report=json.loads((out/'public-chunks.json').read_text()); publications=[]
with (out/'upload.log').open('ab') as log:
 for record in report['files']:
  if record['status']=='passed':continue
  assert record['status']=='missing', record
  sha=record['sha256']; source=out/(sha+'.bin'); data=source.read_bytes()
  assert len(data)==131072 and hashlib.sha256(data).hexdigest()==sha
  command=['npx','--yes','wrangler','r2','object','put','wasm-vm/chunked-alpine/chunks/'+sha+'.bin','--file',str(source),'--remote','-y']
  result=subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT,timeout=120)
  publications.append({'sha256':sha,'bytes':len(data),'command':command,'exit_code':result.returncode,'time':time.time()})
  (out/'uploads.json').write_text(json.dumps(publications,indent=2)+'\n')
  assert result.returncode==0,sha
  print('Published',sha,flush=True)
