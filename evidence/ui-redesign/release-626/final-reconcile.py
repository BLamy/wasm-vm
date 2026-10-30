from pathlib import Path
import subprocess,json,hashlib
root=Path.cwd();out=root/'target/ui-release-626';prior='2d7b3414d0b16a744a246236f275870e51ba88a4'
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
changed=subprocess.check_output(['git','diff','--name-only',prior,head],text=True).splitlines()
allowed={'tools/deploy-cloudflare.sh','tasks/epic-0-ignition/E0-T30-ui-homepage-public.md','tasks/QUEUE.md','web/tasks.json','web/dist/tasks.json','web/dist/sw.js'}
unexpected=[p for p in changed if p not in allowed and not p.startswith('evidence/ui-redesign/public-626-deploy-repair/')]
assert not unexpected,unexpected
old=subprocess.check_output(['git','show',prior+':tools/deploy-cloudflare.sh'])
new=(root/'tools/deploy-cloudflare.sh').read_bytes()
assert old.replace(b'$DEPLOY_TARGET\xe2\x80\xa6',b'${DEPLOY_TARGET}\xe2\x80\xa6')==new
cold=json.loads((out/'pristine/cold-clone-dist-sha256.json').read_text())
if isinstance(cold,dict) and 'files' in cold:cold=cold['files']
# The frozen corpus uses a relative-path -> digest mapping.
assert isinstance(cold,dict),type(cold)
cold={p.removeprefix('web/dist/'):sha for p,sha in cold.items()}
now={str(p.relative_to(root/'web/dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root/'web/dist').rglob('*')) if p.is_file()}
assert set(now)==set(cold),(len(now),len(cold))
distChanges=[{'path':p,'pristineSha256':cold[p],'publishedPrestageSha256':now[p]} for p in now if now[p]!=cold[p]]
assert {x['path'] for x in distChanges}<={'tasks.json','sw.js'},distChanges
result={'priorPristineHead':prior,'finalFrozenHead':head,'implementationDiff':'One braced deployment log interpolation; all other non-evidence changes are task/queue/task-catalog/SW metadata.','changedPaths':changed,'unexpectedProductChanges':unexpected,'distFiles':len(now),'distIdenticalFiles':len(now)-len(distChanges),'distMetadataChanges':distChanges,'deploymentScriptSha256':hashlib.sha256(new).hexdigest(),'coldCloneCarry':'All73 UI acceptance checks and780-original-dist-byte proof carry across the unchanged UI/runtime/package/docs source boundary. Only task catalog and corresponding cache stamp differ in final prestage dist.'}
(out/'final-reconciliation.json').write_text(json.dumps(result,indent=2)+'\n')
(out/'final-dist-sha256.json').write_text(json.dumps(now,indent=2)+'\n')
print(json.dumps(result,indent=2))
