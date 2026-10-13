"""One final scrubbed pristine clone; generated compiler bytes come from D61."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
output = Path(sys.argv[1]).resolve()
assert not output.exists(), 'preserve earlier recordings'
git = lambda *args: subprocess.check_output(['git', *args], cwd=repo, text=True).strip()
head = git('rev-parse', 'HEAD')
assert not git('status', '--porcelain', '--untracked-files=no')
clone = Path(tempfile.mkdtemp(prefix='wasm-vm-dimensional-shadow-samplers-cold-')) / 'repo'
subprocess.run(['git', 'clone', '--shared', '--no-checkout', str(repo), str(clone)], check=True)
directories = git('ls-tree', '-d', '--name-only', head).splitlines()
selection = [name for name in directories if name not in {'evidence', 'releases'}]
selection += ['evidence/' + family + '/' + role for family in ['virgl-dimensional-shadow-shaders', 'virgl-dimensional-depth-views', 'virgl-shadow-samplers'] for role in ['worker', 'verifier']]
selection += ['releases/kernel', 'releases/initramfs', 'releases/boot-snapshot']
subprocess.run(['git', 'sparse-checkout', 'init', '--cone'], cwd=clone, check=True)
subprocess.run(['git', 'sparse-checkout', 'set', *selection], cwd=clone, check=True)
subprocess.run(['git', 'checkout', '--detach', head], cwd=clone, check=True)
status = lambda: subprocess.check_output(['git', 'status', '--porcelain'], cwd=clone, text=True)
before = status()
assert not before
env = {k: v for k, v in os.environ.items() if not k.startswith(('CARGO_', 'RUST', 'LLVM_PROFILE', 'VIRGL_', 'NODE_', 'npm_', 'NPM_', 'CHROME')) and k not in {'CC', 'CXX', 'CFLAGS', 'CPPFLAGS', 'LDFLAGS', 'EMCC', 'EM_CONFIG', 'EMSDK', 'PYTHONPATH', 'PYTHONHOME'}}
proof = clone / 'target/evidence/dimensional-shadow-samplers-cold'
env['VIRGL_DIMENSIONAL_SHADOW_SAMPLER_EVIDENCE_DIR'] = str(proof)
command = ['make', 'verify-E6-T11d62']
output.mkdir(parents=True)
with (output / 'cold.stdout').open('wb') as stdout, (output / 'cold.stderr').open('wb') as stderr:
    result = subprocess.run(command, cwd=clone, env=env, stdout=stdout, stderr=stderr, timeout=7200)
if proof.exists():
    shutil.copytree(proof, output / 'recording')
after = status()
report = dict(schema='dimensional-shadow-samplers-cold-v1', head=head, clone=str(clone), command=command, evidenceOutput=str(proof),
              cleanBefore=before, cleanAfter=after, exitCode=result.returncode,
              sourceCheckout=dict(mode='declared cone sparse checkout', included=selection, borrowedGeneratedArtifacts=False,
                                  generatedCompilerAuthority='complete authenticated D61 worker seal', claim='selected dimensional comparison consumer and ordinary default demo'),
              receiptSha256=hashlib.sha256((proof / 'receipt.json').read_bytes()).hexdigest() if (proof / 'receipt.json').exists() else None)
(output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
assert result.returncode == 0 and not after, 'inspect preserved complete output'
print(json.dumps(report))
