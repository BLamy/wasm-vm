"""Run the final acceptance from a pristine committed checkout and scrubbed env."""
import argparse,hashlib,json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2];parser=argparse.ArgumentParser();parser.add_argument('output');parser.add_argument('--carry-from');args=parser.parse_args();out=Path(args.output).resolve();assert not out.exists()
git=lambda *args:subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
parent=repo/'target/evidence/stream-output-capture-cold-clones';parent.mkdir(parents=True,exist_ok=True);assert shutil.disk_usage(parent).free>=4*1024**3
clone=Path(tempfile.mkdtemp(prefix='original-capture-',dir=parent))/'repo'
subprocess.run(['git','clone','--shared','--no-checkout',str(repo),str(clone)],check=True)
selection=[n for n in git('ls-tree','-d','--name-only',head).splitlines() if n not in ['evidence','releases']]+['evidence/virgl-stream-output-shaders/worker','evidence/virgl-stream-output-shaders/verifier','evidence/virgl-stream-output-shaders/deployment','releases/kernel','releases/initramfs','releases/boot-snapshot']
for command in [['git','sparse-checkout','init','--cone'],['git','sparse-checkout','set',*selection],['git','checkout','--detach',head]]:subprocess.run(command,cwd=clone,check=True)
status=lambda:subprocess.check_output(['git','status','--porcelain'],cwd=clone,text=True)
before=status();assert not before
proof=clone/'target/evidence/stream-output-capture';env={k:v for k,v in os.environ.items() if not k.startswith(('CARGO_','RUST','LLVM_PROFILE','NODE_','VIRGL_','npm_','NPM_')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EMSDK','EM_CONFIG','CHROME','PYTHONPATH','PYTHONHOME'}};env['VIRGL_STREAM_OUTPUT_CAPTURE_EVIDENCE_DIR']=str(proof)
command=['python3','tools/virgl-stream-output-capture/verify.py','--output',str(proof),*(['--carry-from',str(Path(args.carry_from).resolve())] if args.carry_from else [])];out.mkdir(parents=True)
with (out/'cold.stdout').open('wb') as stdout,(out/'cold.stderr').open('wb') as stderr:r=subprocess.run(command,cwd=clone,env=env,stdout=stdout,stderr=stderr,timeout=7200)
after=status();report=dict(schema='stream-output-capture-cold-v1',head=head,clone=str(clone),command=command,cleanBefore=before,cleanAfter=after,exitCode=r.returncode,sourceCheckout=dict(mode='declared cone sparse checkout',included=selection,borrowedGeneratedArtifacts=False),receiptSha256=hashlib.sha256((proof/'receipt.json').read_bytes()).hexdigest() if (proof/'receipt.json').is_file() else None)
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
if proof.exists():shutil.copytree(proof,out/'recording')
assert not after and r.returncode==0,'inspect preserved output';print(json.dumps(report))
