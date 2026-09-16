from pathlib import Path
import hashlib,json,re,subprocess,tempfile
root=Path(__file__).resolve().parent
repo=root.parents[2]
log=(root/'cloudflare-deploy.log').read_text()
urls=re.findall(r'https://[a-z0-9]+[.]wasm-vm[.]pages[.]dev',log)
assert urls, 'deployment URL absent'
origins=[urls[-1],'https://wasm-vm.pages.dev']
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
records=[]
with tempfile.TemporaryDirectory(prefix='wasm-vm-to-word-public-',dir='/private/tmp') as temporary:
 for origin in origins:
  for name in ['pkg/wasm_vm_wasm_bg.wasm','pkg/wasm_vm_wasm.js','roadmap.js','app.html']:
   url=origin+'/'+name+'?verify='+head
   target=Path(temporary)/'asset'
   result=subprocess.run(['curl','--fail','--silent','--show-error','--location','--retry','3','--output',str(target),'--write-out','%{http_code}',url],capture_output=True,text=True)
   if result.returncode: raise RuntimeError(result.stderr)
   actual=hashlib.sha256(target.read_bytes()).hexdigest()
   expected=hashlib.sha256((repo/'web/dist'/name).read_bytes()).hexdigest()
   row={'url':url,'status':int(result.stdout),'sha256':actual,'expectedSha256':expected};records.append(row)
   (root/'cloudflare-public.json').write_text(json.dumps(records,indent=2)+'\n')
   assert actual==expected,row
print(json.dumps(records,indent=2))
