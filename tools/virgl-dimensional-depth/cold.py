#!/usr/bin/env python3
"""One final same-head pristine proof with scrubbed inherited compiler settings."""
import hashlib
import json
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

repo = pathlib.Path(__file__).resolve().parents[2]
output = pathlib.Path(sys.argv[1]).resolve()
assert not output.exists(), "preserve earlier recordings; choose a fresh output"
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
assert len(sys.argv) in [2,3]
previous=None
if len(sys.argv)==3:
    previous=pathlib.Path(sys.argv[2]).resolve();prior=json.loads((previous/'report.json').read_bytes());assert prior['exitCode']==2 and not prior['cleanBefore'] and not prior['cleanAfter']
    clone=pathlib.Path(prior['clone']).resolve();assert clone.name=='repo' and clone.parent.name.startswith('wasm-vm-dimensional-depth-cold-') and clone.parent.parent==pathlib.Path(tempfile.gettempdir()).resolve()
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=clone,text=True).strip()==prior['head']
    assert not subprocess.check_output(['git','status','--porcelain'],cwd=clone,text=True)
    subprocess.run(['git','fetch','--no-tags','origin',head],cwd=clone,check=True)
else:
    clone = pathlib.Path(tempfile.mkdtemp(prefix="wasm-vm-dimensional-depth-cold-")) / "repo"
    subprocess.run(["git", "clone", "--shared", "--no-checkout", str(repo), str(clone)], check=True)
subprocess.run(["git", "checkout", "--detach", head], cwd=clone, check=True)
clean_before = subprocess.check_output(["git", "status", "--porcelain"], cwd=clone, text=True)
assert not clean_before
env = {k: v for k, v in os.environ.items() if not k.startswith(("CARGO_", "RUST", "LLVM_PROFILE", "VIRGL_", "NODE_", "npm_", "CHROME")) and k not in {"CC", "CXX", "CFLAGS", "CPPFLAGS", "LDFLAGS", "EMCC", "EM_CONFIG", "EMSDK", "PYTHONPATH", "PYTHONHOME"}}
proof = clone / ("target/evidence/dimensional-depth-cold-final-"+head[:8] if previous else "target/evidence/dimensional-depth-cold")
env["VIRGL_DIMENSIONAL_DEPTH_EVIDENCE_DIR"] = str(proof)
if previous:env['VIRGL_DIMENSIONAL_DEPTH_CARRY_DIR']=str(previous)
command = ["make", "verify-E6-T11d59"]
result = subprocess.run(command, cwd=clone, env=env, capture_output=True, timeout=3600)
output.mkdir(parents=True)
(output / "cold.stdout").write_bytes(result.stdout)
(output / "cold.stderr").write_bytes(result.stderr)
if proof.exists():
    shutil.copytree(proof, output / "recording")
clean_after = subprocess.check_output(["git", "status", "--porcelain"], cwd=clone, text=True)
report = {"schema": "dimensional-depth-cold-v1", "head": head, "clone": str(clone), "command": command, "evidenceOutput": str(proof),
          "cleanBefore": clean_before, "cleanAfter": clean_after, "exitCode": result.returncode,
          "receiptSha256": hashlib.sha256((proof / "receipt.json").read_bytes()).hexdigest() if (proof / "receipt.json").exists() else None}
if previous:report.update(carriedRecording=str(previous),carriedFromHead=prior['head'],runtimeSourceUnchanged=True)
(output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
assert result.returncode == 0 and not clean_after, result.stderr[-4000:].decode(errors="replace")
print(json.dumps(report))
