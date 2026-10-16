"""Replay the critic's independent bounded tests against the submitted evidence."""
import datetime,hashlib,json,pathlib,subprocess
out=pathlib.Path(__file__).resolve().parent;root=out.parents[2];records=[]
commands=[['python3',name] for name in ['attack.py','interpret.py']]+[['node','consumer.mjs']]+[['python3',name] for name in ['sabotage.py','receipt-attacks.py','native-wasm-forgeries.py','browser-forgeries.py','pixels.py','coverage.py','js-coverage.py']]
for command in commands:
 command=[command[0],str(out/command[1])];result=subprocess.run(command,cwd=root,text=True,capture_output=True)
 records.append({'command':command,'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
 (out/'commands.json').write_text(json.dumps(records,indent=2)+'\n')
 assert result.returncode==0,result.stderr
 print(pathlib.Path(command[1]).name+': passed',flush=True)
