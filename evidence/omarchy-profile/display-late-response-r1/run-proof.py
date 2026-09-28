"""Record the local measurement without rebuilding or changing the AT runtime."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import subprocess

out = Path(__file__).resolve().parent
repo = out.parents[2]
env = dict(os.environ)
scrubbed = []
for key in list(env):
    if key.startswith(("CARGO_", "OMARCHY_")) or key in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG"):
        scrubbed.append(key)
        del env[key]
env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
env["PATH"] = str(Path.home() / ".nvm/versions/node/v24.20.0/bin") + ":" + str(Path.home() / ".cargo/bin") + ":/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, env=env, text=True).strip()
runtime = json.loads((repo / "tools/verify/omarchy-gpu-transfer-runtime.json").read_text())
for file, expected in runtime["files"].items():
    data = (repo / file).read_bytes()
    assert {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()} == expected, file
args = ["make", "verify-E5_5-T03av", "DISPLAY_LATE_OUT=" + str(out)]
receipt = {"head": head, "diagnosticOnly": True, "runtime": runtime, "runtimeMatched": True,
           "scrubbedNames": scrubbed, "args": args, "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
record = out / "proof.json"
record.write_text(json.dumps(receipt, indent=2) + "\n")
with (out / "acceptance.log").open("x") as log:
    result = subprocess.run(args, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
receipt.update(code=result.returncode, finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
               logSha256=hashlib.sha256((out / "acceptance.log").read_bytes()).hexdigest())
record.write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt), flush=True)
raise SystemExit(result.returncode)
