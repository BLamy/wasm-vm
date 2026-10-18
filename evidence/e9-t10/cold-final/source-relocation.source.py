from pathlib import Path
import hashlib,json,os,shutil,subprocess,time
root=Path.cwd();out=root/'target/evidence/e9-t10-cold-final-2';r=json.loads((out/'receipt.json').read_text());src=Path(r['clone']);dest=Path('/Volumes/e9-build-scratch/cold-source-e9-t10');metadata=src.with_name('repo.git-metadata');backup=src.with_name('repo.relocating');env=dict(os.environ,GIT_OPTIONAL_LOCKS='0')
assert src.is_dir()and not src.is_symlink()and(src/'.git').is_dir()and not dest.exists()and not metadata.exists()and not backup.exists()
assert not any(c.startswith(str(src)+'/')for c in subprocess.check_output(['ps','-axo','command='],text=True).splitlines())
def git(*args):return subprocess.check_output(['git',*args],cwd=src,env=env)
assert git('rev-parse','HEAD').decode().strip()==r['head']and not git('status','--porcelain','--untracked-files=all')
assert not(src/'.git/objects/info/alternates').exists()
def inventory(base):
 h=hashlib.sha256();size=0;files=0
 for p in sorted(base.rglob('*')):
  rel=p.relative_to(base)
  if rel.parts[0]=='.git':continue
  h.update(str(rel).encode()+b'\0')
  if p.is_symlink():h.update(b'link\0'+os.readlink(p).encode());continue
  if p.is_file():
   files+=1;size+=p.stat().st_size
   with p.open('rb')as f:
    for part in iter(lambda:f.read(1<<20),b''):h.update(part)
 return {'sha256':h.hexdigest(),'bytes':size,'files':files}
before=inventory(src);old_config=hashlib.sha256((src/'.git/config').read_bytes()).hexdigest()
shutil.copytree(src,dest,symlinks=True,ignore=lambda directory,names:{'.git'}if Path(directory)==src else set());assert inventory(dest)==before
(src/'.git').rename(metadata);(dest/'.git').write_text('gitdir: '+str(metadata)+'\n')
subprocess.run(['git','--git-dir',str(metadata),'config','core.worktree',str(dest)],check=True,env=env)
src.rename(backup);src.symlink_to(dest,target_is_directory=True)
assert git('rev-parse','HEAD').decode().strip()==r['head']and not git('status','--porcelain','--untracked-files=all')
assert inventory(src)==before and not(metadata/'objects/info/alternates').exists()
shutil.rmtree(backup)
report={'status':'passed','head':r['head'],'original_path':str(src),'ram_checkout':str(dest),'persistent_git_metadata':str(metadata),'inventory_before_and_after':before,'old_config_sha256':old_config,'new_config_sha256':hashlib.sha256((metadata/'config').read_bytes()).hexdigest(),'time':time.time(),'reason':'Lossless relocation of an idle disposable cold checkout to its task-owned RAM volume. All tracked and required ignored files were hashed before/after; its own immutable Git objects remain on persistent storage with no alternates. The original path remains a symlink. Original proof outputs remain on persistent storage outside this checkout. No worker build output or dependency was imported.'}
(out/'source-relocation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
