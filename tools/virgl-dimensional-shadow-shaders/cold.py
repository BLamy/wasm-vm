"""Final scrubbed clone: all source directories and the exact baseline evidence closure."""
import hashlib,json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
repo=Path(__file__).resolve().parents[2];output=Path(sys.argv[1]).resolve()
assert not output.exists(),'preserve previous runs'
git=lambda *args:subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
head=git('rev-parse','HEAD');assert not git('status','--porcelain','--untracked-files=no')
clone=Path(tempfile.mkdtemp(prefix='wasm-vm-dimensional-shadow-cold-'))/'repo'
subprocess.run(['git','clone','--shared','--no-checkout',str(repo),str(clone)],check=True)
directories=git('ls-tree','-d','--name-only',head).splitlines()
# The ordinary demo build also copies its kernel, initramfs and optional boot
# snapshot before regenerating the manifest. Include those exact build inputs.
selection=[p for p in directories if p not in {'evidence','releases'}]+['evidence/virgl-production-readiness/dimensional-shadow-compiler-gap','releases/kernel','releases/initramfs','releases/boot-snapshot']
subprocess.run(['git','sparse-checkout','init','--cone'],cwd=clone,check=True)
subprocess.run(['git','sparse-checkout','set',*selection],cwd=clone,check=True)
subprocess.run(['git','checkout','--detach',head],cwd=clone,check=True)
status=lambda:subprocess.check_output(['git','status','--porcelain'],cwd=clone,text=True)
clean_before=status();assert not clean_before
env={k:v for k,v in os.environ.items() if not k.startswith(('CARGO_','RUST','LLVM_PROFILE','VIRGL_','NODE_','npm_','NPM_','CHROME')) and k not in {'CC','CXX','CFLAGS','CPPFLAGS','LDFLAGS','EMCC','EM_CONFIG','EMSDK','PYTHONPATH','PYTHONHOME'}}
proof=clone/'target/evidence/dimensional-shadow-cold';env['VIRGL_DIMENSIONAL_SHADOW_SHADER_EVIDENCE_DIR']=str(proof)
command=['make','verify-E6-T11d61'];output.mkdir(parents=True)
with (output/'cold.stdout').open('wb') as stdout,(output/'cold.stderr').open('wb') as stderr:
    result=subprocess.run(command,cwd=clone,env=env,stdout=stdout,stderr=stderr,timeout=1800)
if proof.exists():shutil.copytree(proof,output/'recording')
clean_after=status()
report=dict(schema='dimensional-shadow-cold-v1',head=head,clone=str(clone),command=command,evidenceOutput=str(proof),cleanBefore=clean_before,cleanAfter=clean_after,exitCode=result.returncode,
            sourceCheckout=dict(mode='declared cone sparse checkout',included=selection,excluded=['unrelated historical evidence archives','unrelated releases outside kernel/initramfs/boot-snapshot'],claim='C/Wasm comparison compiler and ordinary default demo; no Linux boot/deployment portability claim',borrowedGeneratedArtifacts=False),
            receiptSha256=hashlib.sha256((proof/'receipt.json').read_bytes()).hexdigest() if (proof/'receipt.json').exists() else None)
(output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
assert result.returncode==0 and not clean_after,'inspect preserved complete output'
print(json.dumps(report))
