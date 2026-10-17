#!/usr/bin/env python3
"""Record the native/Wasm and actual IndexedDB session-store proof at a clean head."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
env = {k: v for k, v in os.environ.items()
       if k not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG") and not k.startswith("CARGO_")}
env["CARGO_TERM_COLOR"] = "never"
report = {"task": "E9-T03", "status": "running", "started": time.time(), "commands": [],
          "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
          "scope": "Atomic browser session storage; no guest checkpoint decoding or replay qualification"}


def clean():
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT), "source tree must be clean"


def run(name, command):
    print(name, flush=True)
    started = time.time()
    with (output / (name + ".log")).open("wb") as log:
        result = subprocess.run(command, cwd=ROOT, env=env, stdout=log,
                                stderr=subprocess.STDOUT, timeout=3600)
    report["commands"].append({"name": name, "command": command,
                               "seconds": time.time() - started, "exit_code": result.returncode})
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    assert result.returncode == 0, name + " failed; inspect its recorded log"


try:
    clean()
    for name in ("session-store.js", "roadmap.js"):
        assert (ROOT / "web" / name).read_bytes() == (ROOT / "web/dist" / name).read_bytes(), "stale committed browser source: " + name
    run("retained-gpu-runtime", ["python3", "tools/verify/e9-retained-gpu-runtime.py"])
    run("policy", ["python3", "tools/check_task_policy.py"])
    run("format", ["cargo", "fmt", "--all", "--check"])
    run("storage-clippy", ["cargo", "clippy", "-p", "wasm-vm-storage", "--all-targets", "--", "-D", "warnings"])
    run("storage-native", ["cargo", "test", "-p", "wasm-vm-storage", "--", "--nocapture"])
    run("no-std-wasm", ["cargo", "build", "-p", "wasm-vm-storage", "--target", "wasm32-unknown-unknown"])
    run("adapter-native", ["cargo", "test", "-p", "wasm-vm-session-web"])
    run("wasm-clippy", ["cargo", "clippy", "-p", "wasm-vm-session-web", "--target", "wasm32-unknown-unknown", "--lib", "--", "-D", "warnings"])
    run("wasm-build", ["wasm-pack", "build", "crates/session-web", "--target", "web", "--profile", "wasm-release", "--out-name", "wasm_vm_session"])
    for name in ("wasm_vm_session.js", "wasm_vm_session_bg.wasm", "wasm_vm_session.d.ts", "wasm_vm_session_bg.wasm.d.ts"):
        assert (ROOT / "crates/session-web/pkg" / name).read_bytes() == (ROOT / "web/dist/session-pkg" / name).read_bytes(), "stale adapter build: " + name
    run("contract", ["python3", "tools/verify/e9-session-contract.py"])
    run("codec-node", ["wasm-pack", "test", "--node", "tools/verify/session-wasm", "--locked", "--test", "session_manifest"])
    run("javascript", ["node", "--check", "web/session-store.js"])
    run("browser-dependencies", ["npm", "ci", "--prefix", "web", "--no-audit", "--no-fund"])
    run("browser", ["node", "tools/verify/e9-session-store-browser.mjs", "--output", str(output / "browser")])
    browser = json.loads((output / "browser/report.json").read_text())
    assert browser["status"] == "passed" and not browser["development"]
    assert browser["head"] == report["head"] and browser["errors"] == []
    assert len(browser["crashes"]) == 4 and len(browser["races"]) == 20
    clean()
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    sources = ["crates/storage/src/lib.rs", "crates/storage/src/session_publication.rs",
               "crates/storage/tests/session_publication.rs", "crates/session-web/Cargo.toml",
               "crates/session-web/src/lib.rs", "web/session-store.js", "web/roadmap.js",
               "tools/verify/e9-session-store.py", "tools/verify/e9-session-store-browser.mjs",
               "tools/verify/e9-session-store-critic.mjs",
               "tools/verify/e9-retained-gpu-runtime.py", "web/gpu-runtime/manifest.json",
               "web/gpu-runtime-worker.js", "web/linux-worker-host.js", "web/main.js",
               "Cargo.lock", "rust-toolchain.toml", "Makefile"]
    report["source_sha256"] = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in sources}
    report["finished"] = time.time()
    # The original browser profile/trace stay locally available, with compact file receipts.
    report["files"] = [{"path": str(p.relative_to(output)), "bytes": p.stat().st_size,
                         "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                        for p in sorted(output.rglob("*")) if p.is_file() and p != output / "report.json"]
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
