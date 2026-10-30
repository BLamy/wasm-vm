from pathlib import Path
import subprocess,json,hashlib,os
root=Path.cwd();out=root/'evidence/ui-redesign/public-626-deploy-repair';out.mkdir(parents=True,exist_ok=True)
script=root/'tools/deploy-cloudflare.sh';s=script.read_text();lines=s.splitlines();matches=[(i+1,x) for i,x in enumerate(lines) if 'echo "[deploy] deploying $DIST' in x];assert len(matches)==1
line,text=matches[0];assert '${DEPLOY_TARGET}…' in text,text
result={'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'scriptSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'changedLogLine':line,'actualSourceLine':text,'locale':{k:v for k,v in os.environ.items() if k in ['LANG','LC_ALL','LC_CTYPE']},'checks':[]}
def run(label,args,env=None):
 p=subprocess.run(args,cwd=root,env=env,text=True,capture_output=True);result['checks'].append({'name':label,'argv':args,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr});assert p.returncode==0,(label,p.stderr);return p.stdout
run('shell syntax',['bash','-n','tools/deploy-cloudflare.sh'])
fragment='set -eu\nDIST=web/dist\nPROJECT=wasm-vm\nDEPLOY_TARGET="preview branch ui-redesign-20261030"\n'+text+'\n'
result['fragment']=fragment
actual=run('actual source echo line under inherited default macOS Bash locale',['bash','-c',fragment]);assert 'preview branch ui-redesign-20261030…' in actual
previewEnv=os.environ.copy();previewEnv.update(PAGES_BRANCH='ui-redesign-20261030',DEPLOY_PRINT_ONLY='1')
actual=run('actual unchanged validated preview target and noninteractive command',['bash','tools/deploy-cloudflare.sh'],previewEnv)
assert "preview branch 'ui-redesign-20261030'" in actual and '--branch ui-redesign-20261030' in actual and 'https://ui-redesign-20261030.wasm-vm.pages.dev/' in actual
(out/'direct-proof.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
