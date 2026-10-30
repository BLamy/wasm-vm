from pathlib import Path
import os,subprocess,json,time,hashlib
root=Path.cwd();mount=Path("/Volumes/e9-final-proof-ram")
head=subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()
assert head=="98260ff67d814311b3c2cf175a57476f3d3c64ab"
assert not subprocess.check_output(["git","status","--porcelain","--untracked-files=all"])
env=os.environ.copy();env.update(TMPDIR=str(mount/"deploy-tmp")+"/",TMPPREFIX=str(mount/"deploy-tmp/zsh"),npm_config_cache="/Volumes/e9-t11-cold-scratch/e9-t12-npm-cache",WRANGLER_LOG_PATH=str(mount/"e9-t12-repaired-wrangler-v2.log"),GIT_OPTIONAL_LOCKS="0")
Path(env["TMPDIR"]).mkdir(exist_ok=True)
env["PATH"]=str(mount/"deploy-bin")+":/Volumes/e9-t11-cold-scratch/bash-tools/bin:"+env["PATH"]
log=mount/"e9-t12-repaired-full-deploy-v2.log";snapshot=mount/"e9-t12-repaired-full-deploy-v2"
report={"head":head,"status":"running","started":time.time(),"command":["bash","tools/deploy-cloudflare.sh"],"rootfs_read":"Complete validated public HTTP206 reassembly; exact content-addressed rootfs SHA reauthenticated on each copy; stock remaining R2 reads/manifest staging validation unchanged."}
try:
 with log.open("wb")as f:subprocess.run(report["command"],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,check=True)
 subprocess.run(["python3",str(mount/"publish-verified-catalog.py"),"capture","--snapshot",str(snapshot),"--log",str(log)],cwd=root,env=env,check=True)
 report["status"]="passed"
except BaseException as e:report["status"]="failed";report["failure"]=str(e);raise
finally:
 names=["artifacts.json","artifacts-alpine.json","artifacts-node-alpine.json","artifacts-omarchy.json","artifacts-omarchy-virgl.json"]
 for name in names:(root/"web/dist"/name).write_bytes(subprocess.check_output(["git","show",head+":web/dist/"+name],cwd=root))
 report["finished"]=time.time();report["log_sha256"]=hashlib.sha256(log.read_bytes()).hexdigest()
 (mount/"e9-t12-repaired-full-deploy-v2-receipt.json").write_text(json.dumps(report,indent=2)+"\n")
