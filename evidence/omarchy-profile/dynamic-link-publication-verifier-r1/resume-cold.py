"""Run the task's final native/wasm/harness gates from a clean exact-head clone."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import subprocess
import tempfile
import time

out = Path(__file__).resolve().parent
repo = out.parents[2]
head = "d35217b4655d77fe762dd5ca98b98313e928c3c1"
receipt = json.loads((out / "cold.json").read_text())
work = Path(receipt["clone"])
env = dict(os.environ)
scrubbed = []
for key in list(env):
    if key.startswith(("CARGO_", "OMARCHY_")) or key in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG", "NODE_ENV", "NODE_PATH"):
        scrubbed.append(key)
        del env[key]
env["DEVELOPER_DIR"] = "/Library/Developer/CommandLineTools"
env["PATH"] = str(Path.home() / ".nvm/versions/node/v24.20.0/bin") + ":" + str(Path.home() / ".cargo/bin") + ":/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
env["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] = "1"

def save():
    (out / "cold.json").write_text(json.dumps(receipt, indent=2) + "\n")

def run(name, args, cwd):
    log = out / ("cold-" + name + ".log")
    start = time.monotonic()
    with log.open("x") as stream:
        result = subprocess.run(args, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT)
    row = {"name": name, "args": args, "cwd": str(cwd), "code": result.returncode,
           "seconds": time.monotonic()-start, "log": log.name,
           "sha256": hashlib.sha256(log.read_bytes()).hexdigest()}
    receipt["steps"].append(row)
    save()
    print(json.dumps(row), flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)

receipt["initialAllTargetsFailure"] = "Unchanged retirement_capture_baseline example requires trace feature; resumed all-target clippy with explicit trace."
run("clippy-trace", ["cargo", "clippy", "--locked", "--offline", "-p", "wasm-vm-core", "--all-targets", "--features", "trace", "--", "-D", "warnings"], work)
run("core", ["cargo", "test", "--locked", "--offline", "-p", "wasm-vm-core", "--lib"], work)
run("capacity", ["cargo", "test", "--locked", "--offline", "-p", "wasm-vm-core", "--lib", "decoded_cache_capacity_tests", "--", "--nocapture"], work)
run("publication", ["cargo", "test", "--locked", "--offline", "-p", "wasm-vm-core", "--test", "dynamic_link_publication", "--", "--nocapture"], work)
run("wasm", ["cargo", "check", "--locked", "--offline", "-p", "wasm-vm-wasm", "--target", "wasm32-unknown-unknown", "--lib"], work)
run("browser-jit", ["wasm-pack", "test", "--mode", "no-install", "--node", "crates/wasm", "--locked", "--offline", "--test", "jit_browser_parity", "--", "--nocapture"], work)
run("node", ["node", "--test", "tools/verify/omarchy-input-kernel-response.test.mjs", "tools/verify/omarchy-input-trial.test.mjs", "tools/verify/omarchy-user-input.test.mjs", "tools/verify/omarchy-desktop-live.test.mjs", "tools/verify/omarchy-owned-trial.test.mjs"], work)
receipt["trackedStatusAfter"] = subprocess.check_output(["git", "status", "--porcelain=v1", "-uno"], cwd=work, env=env, text=True)
assert receipt["trackedStatusAfter"] == ""
receipt["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
receipt["passed"] = True
save()
print(json.dumps({"passed": True, "clone": str(work), "head": head}), flush=True)
