from pathlib import Path
import subprocess,os,json,re,time,hashlib,sys
root=Path.cwd();out=root/'target/ui-release-626';head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();env=os.environ.copy();env['PAGES_BRANCH']='ui-redesign-20261030'
start=time.time()
with (out/'deploy.log').open('w') as log:
 p=subprocess.run(['bash','tools/deploy-cloudflare.sh'],env=env,stdout=log,stderr=subprocess.STDOUT)
s=(out/'deploy.log').read_text();urls=list(dict.fromkeys(re.findall(r'https://[a-z0-9-]+\.wasm-vm\.pages\.dev',s)))
immutable=[u for u in urls if u!='https://ui-redesign-20261030.wasm-vm.pages.dev']
result={'head':head,'command':['bash','tools/deploy-cloudflare.sh'],'explicitEnvironment':{'PAGES_BRANCH':env['PAGES_BRANCH']},'exit':p.returncode,'seconds':round(time.time()-start,2),'previewUrls':urls,'immutablePreview':immutable[-1] if immutable else None,'logSha256':hashlib.sha256((out/'deploy.log').read_bytes()).hexdigest(),'published':p.returncode==0 and bool(immutable) and '[deploy] published to preview branch' in s}
(out/'deploy-command.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(0 if result['published'] else 1)
