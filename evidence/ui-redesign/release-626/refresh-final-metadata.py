from pathlib import Path
import subprocess,json,time,sys
root=Path.cwd();out=root/'target/ui-release-626';prior=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();start=time.time()
with (out/'post-repair-metadata-refresh.log').open('w') as log:
 for args in [['python3','tools/check_task_policy.py'],['python3','tools/build_queue.py'],['python3','tools/gen-tasks-json.py'],['git','add','web/tasks.json'],['git','commit','-m','chore(ui): refresh verified release metadata']]:
  log.write('$ '+' '.join(args)+'\n');log.flush();p=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT)
  if p.returncode:sys.exit(p.returncode)
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();changed=subprocess.check_output(['git','diff','--name-only',prior,head],text=True).splitlines()
expected={'web/tasks.json','web/dist/tasks.json','web/dist/sw.js'};assert set(changed)==expected,changed
result={'before':prior,'head':head,'changedPaths':changed,'seconds':round(time.time()-start,2),'taskStatus':'E0-T30 and E0-T32 verified; no active task','productChange':'Task catalog and corresponding service-worker cache stamp only'}
(out/'post-repair-metadata-refresh.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
