#!/usr/bin/env python3
"""Record E9-T02's shared native/Wasm codec assertions at a clean, frozen head."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import tomllib

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
env = {k: v for k, v in os.environ.items()
       if k not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG") and not k.startswith("CARGO_")}
env["CARGO_TERM_COLOR"] = "never"
report = {"task": "E9-T02", "status": "running", "started": time.time(), "commands": [],
          "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
          "scope": "Versioned metadata/event codecs and read-only admission; no guest execution or UI claim"}


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
    workspace_lock = tomllib.loads((ROOT / "Cargo.lock").read_text())
    proof_lock = tomllib.loads((ROOT / "tools/verify/session-wasm/Cargo.lock").read_text())
    dependencies = {(p["name"], p["version"]) for p in workspace_lock["package"]}
    assert all((p["name"], p["version"]) in dependencies for p in proof_lock["package"]
               if p["name"] != "session-codec-wasm-proof"), "proof dependencies drifted from the production library"
    # These byte strings are the independently specified fixture assets, not codec output.
    fixture = ROOT / "crates/storage/tests/session_manifest/fixtures"
    manifest = json.loads((fixture / "manifest-v1.json").read_bytes())
    event = json.loads((fixture / "event-v1.json").read_bytes())
    chunk = (fixture / "chunk-v1.json").read_bytes()
    for role, payload in (("vm", b"vm-runtime-v1"), ("wasm", b"wasm-module-v1"),
                          ("kernel", b"kernel-v1"), ("base", b"base-image-v1")):
        asset = next(a["content"] for a in manifest["assets"] if a["role"] == role)
        assert asset == {"sha256": hashlib.sha256(payload).hexdigest(), "length": str(len(payload))}
    assert manifest["begin"]["sequence"] == "9007199254740993"
    assert manifest["end"]["sequence"] == "9007199254740994"
    assert event["transition"] == "9007199254741094"
    assert event["payload"]["bytes"] == list(b"advance\n")
    assert json.loads(chunk) == [event]
    assert manifest["events"][0]["content"] == {
        "sha256": hashlib.sha256(chunk).hexdigest(), "length": str(len(chunk))}
    assert manifest["checkpoints"][0]["machine"] == {
        "sha256": hashlib.sha256(b"checkpoint-v1").hexdigest(), "length": str(len(b"checkpoint-v1"))}
    assert manifest["checkpoints"][0]["disk_root"] == hashlib.sha256(b"e9:before\n").hexdigest()
    (output / "fixture-oracles.json").write_text(json.dumps({"status": "passed", "wide_sequence": manifest["begin"]["sequence"],
        "chunk_sha256": hashlib.sha256(chunk).hexdigest()}, indent=2) + "\n")
    run("policy", ["python3", "tools/check_task_policy.py"])
    run("format", ["cargo", "fmt", "--all", "--check"])
    run("wasm-format", ["cargo", "fmt", "--manifest-path", "tools/verify/session-wasm/Cargo.toml", "--all", "--check"])
    run("storage-clippy", ["cargo", "clippy", "-p", "wasm-vm-storage", "--all-targets", "--", "-D", "warnings"])
    run("storage-native", ["cargo", "test", "-p", "wasm-vm-storage", "--", "--nocapture"])
    run("no-std-wasm", ["cargo", "build", "-p", "wasm-vm-storage", "--target", "wasm32-unknown-unknown"])
    run("wasm-clippy", ["cargo", "clippy", "--manifest-path", "tools/verify/session-wasm/Cargo.toml", "--locked", "--target", "wasm32-unknown-unknown", "--test", "session_manifest", "--", "-D", "warnings"])
    run("wasm-node", ["wasm-pack", "test", "--node", "tools/verify/session-wasm", "--locked", "--test", "session_manifest"])
    for name in ("storage-native", "wasm-node"):
        log = (output / (name + ".log")).read_text()
        assert "9 passed; 0 failed; 0 ignored" in log, name + " did not execute the whole shared corpus"
    clean()
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    sources = ["crates/storage/src/lib.rs", "crates/storage/src/session.rs",
               "crates/storage/tests/session_manifest.rs", "crates/storage/tests/session_manifest/cases.rs",
               "tools/verify/session-wasm/tests/session_manifest.rs", "tools/verify/session-wasm/Cargo.toml",
               "tools/verify/session-wasm/Cargo.lock", "tools/verify/session-wasm/src/lib.rs",
               "tools/verify/e9-session-manifest.py", "Makefile",
               "Cargo.lock", "rust-toolchain.toml", "docs/design/session-format.md"]
    sources.extend(str(p.relative_to(ROOT)) for p in sorted((ROOT / "crates/storage/tests/session_manifest/fixtures").glob("*.json")))
    report["source_sha256"] = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in sources}
    report["finished"] = time.time()
    report["files"] = [{"path": str(p.relative_to(output)), "bytes": p.stat().st_size,
                         "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                        for p in sorted(output.rglob("*")) if p.is_file() and p != output / "report.json"]
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
