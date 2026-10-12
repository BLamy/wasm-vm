#!/usr/bin/env python3
"""One final same-head pristine proof with scrubbed inherited compiler settings."""
import hashlib
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
clone = pathlib.Path(tempfile.mkdtemp(prefix="wasm-vm-native-image-cold-")) / "repo"
subprocess.run(["git", "clone", "--shared", "--no-checkout", str(repo), str(clone)], check=True)
subprocess.run(["git", "checkout", "--detach", head], cwd=clone, check=True)
clean_before = subprocess.check_output(["git", "status", "--porcelain"], cwd=clone, text=True)
assert not clean_before
env = {k: v for k, v in os.environ.items() if not k.startswith(("CARGO_", "RUST", "LLVM_PROFILE", "VIRGL_", "NODE_", "npm_", "CHROME"))}
proof = clone / "target/evidence/native-image-cold"
command = [sys.executable, "tools/virgl-native-image/verify.py", "--output", str(proof)]
result = subprocess.run(command, cwd=clone, env=env, capture_output=True, timeout=1800)
output.mkdir(parents=True)
(output / "cold.stdout").write_bytes(result.stdout)
(output / "cold.stderr").write_bytes(result.stderr)
if proof.exists():
    shutil.copytree(proof, output / "recording")
clean_after = subprocess.check_output(["git", "status", "--porcelain"], cwd=clone, text=True)
report = {"schema": "native-image-cold-v1", "head": head, "clone": str(clone), "command": command,
          "cleanBefore": clean_before, "cleanAfter": clean_after, "exitCode": result.returncode,
          "receiptSha256": hashlib.sha256((proof / "receipt.json").read_bytes()).hexdigest() if (proof / "receipt.json").exists() else None}
(output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
assert result.returncode == 0 and not clean_after, result.stderr[-4000:].decode(errors="replace")
print(json.dumps(report))
