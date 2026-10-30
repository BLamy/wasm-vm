from pathlib import Path
import hashlib,json,os,shutil,subprocess,time
root=Path.cwd();mount=Path('/Volumes/e9-build-scratch');assert mount.is_mount()
paths=[Path('target/wasm32-unknown-unknown'),Path('target/wasm-release')]
paths += [p/'chromium-profile' for p in sorted(Path('target/evidence').glob('e9-t10-browser-precheck*')) if (p/'chromium-profile').is_dir()]
paths += [Path('target/e9-t10-quick-profile'),Path('target/e9-t10-file-precheck-profile'),Path('target/e9-t10-concurrent-stop-precheck/chromium-profile'),Path('target/e9-t10-concurrent-stop-direct-precheck/chromium-profile')]
commands=subprocess.check_output(['ps','-axo','comm='],text=True).splitlines();assert not any(Path(c.strip()).name in ('cargo','rustc','rustdoc')for c in commands)
processes=subprocess.check_output(['ps','-axo','command='],text=True).splitlines()
def inventory(base):
 h=hashlib.sha256();size=0;count=0
 for p in sorted(base.rglob('*')):
  relative=str(p.relative_to(base)).encode();h.update(relative+b'\0')
  if p.is_symlink():h.update(b'link\0'+os.readlink(p).encode());continue
  if p.is_file():
   count+=1;size+=p.stat().st_size
   with p.open('rb')as f:
    for b in iter(lambda:f.read(1<<20),b''):h.update(b)
 return {'sha256':h.hexdigest(),'bytes':size,'files':count}
report={'reason':'Relocate only rebuildable compiler outputs and this task’s disposable development browser profiles to its RAM scratch volume. Frozen source, release packages and every original recorded evidence/log/guest artifact stay on persistent storage. Original precheck paths remain usable through symlinks.','started':time.time(),'moves':[]}
for index,src in enumerate(paths):
 assert src.is_dir()and not src.is_symlink(),src
 assert not any(c.startswith('/Applications/Google Chrome.app/')and '--user-data-dir='+str((root/src).resolve())in c for c in processes),src
 dest=mount/('relocated-'+str(index)+'-'+src.name);backup=src.with_name(src.name+'-relocating');assert not dest.exists()and not backup.exists()
 before=inventory(src);shutil.copytree(src,dest,symlinks=True);assert inventory(dest)==before
 src.rename(backup);src.symlink_to(dest,target_is_directory=True);assert inventory(src)==before
 shutil.rmtree(backup)
 report['moves'].append({'source':str(root/src),'destination':str(dest),**before});print(str(src),before['bytes'],flush=True)
 Path('target/e9-t10-scratch-relocation.json').write_text(json.dumps(report,indent=2)+'\n')
report['finished']=time.time();Path('target/e9-t10-scratch-relocation.json').write_text(json.dumps(report,indent=2)+'\n')
