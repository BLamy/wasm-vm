from pathlib import Path
import subprocess,json,sys
root=Path.cwd();release=root/'target/ui-release-626';deploy=json.loads((release/'deploy-command.json').read_text());assert deploy['published'] and deploy['immutablePreview']
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==deploy['head']
out=release/'published';out.mkdir(exist_ok=True)
with (out/'published-smoke.log').open('w') as log:
 p=subprocess.run(['node','/tmp/wasm-vm-ui-verify-preview.mjs',deploy['immutablePreview'],str(out),str(root)],stdout=log,stderr=subprocess.STDOUT)
report=json.loads((out/'published-smoke.json').read_text()) if (out/'published-smoke.json').exists() else {}
print(json.dumps({'exit':p.returncode,'origin':report.get('origin'),'status':report.get('status'),'checks':len(report.get('checks',[])),'fixedBindings':len(report.get('assetDigests',{})),'completedRequestedBindings':len(report.get('requestedAssetDigests',{})),'cancelled':report.get('cancelledAssetRequests'),'errors':report.get('errors'),'failure':report.get('failure')},indent=2));sys.exit(p.returncode)
