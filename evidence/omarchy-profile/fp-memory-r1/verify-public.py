from pathlib import Path
import hashlib,json,re,subprocess,tempfile,time
repo=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent
log=(out/'cloudflare-deploy.log').read_text()
urls=re.findall(r'https://[0-9a-f]+\.wasm-vm\.pages\.dev',log)
assert urls, 'immutable deployment URL missing'
origins=[urls[-1],'https://wasm-vm.pages.dev']
rows=[]
for origin in origins:
 for path in ['pkg/wasm_vm_wasm_bg.wasm','pkg/wasm_vm_wasm.js','roadmap.js','app.html']:
  url=origin+'/'+path
  with tempfile.NamedTemporaryFile() as tmp:
   proc=subprocess.run(['/usr/bin/curl','--fail','--silent','--show-error','--location','--connect-timeout','10','--max-time','120','--output',tmp.name,'--write-out','%{http_code}',url],capture_output=True,text=True)
   data=Path(tmp.name).read_bytes()
  expected=(repo/'web/dist'/path).read_bytes()
  row={'url':url,'status':int(proc.stdout or 0),'code':proc.returncode,'client':'system curl, TLS verification enabled','size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'expectedSha256':hashlib.sha256(expected).hexdigest(),'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
  rows.append(row)
  (out/'cloudflare-public.json').write_text(json.dumps(rows,indent=2)+'\n')
  assert proc.returncode==0 and row['status']==200 and data==expected, row
print(json.dumps(rows,indent=2))
