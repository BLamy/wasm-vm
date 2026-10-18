#!/usr/bin/env python3
"""Record the high-risk coherent-software-checkpoint acceptance at a frozen clean source head."""
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
env = {key: value for key, value in os.environ.items()
       if key not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG") and not key.startswith("CARGO_")}
env["CARGO_TERM_COLOR"] = "never"
report = {"task": "E9-T05", "status": "running", "started": time.time(), "commands": [],
          "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
          "scope": "Exact single-hart offline software checkpoints; event replay remains E9-T09 onward"}


def clean():
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT), "source tree must be clean"


def file_sha(file):
    digest = hashlib.sha256()
    with file.open("rb") as source:
        for part in iter(lambda: source.read(1 << 20), b""):
            digest.update(part)
    return digest.hexdigest()


def run(name, command):
    print(name, flush=True)
    started = time.time()
    with (output / (name + ".log")).open("wb") as log:
        result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=3600)
    report["commands"].append({"name": name, "command": command, "seconds": time.time() - started, "exit_code": result.returncode})
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    assert result.returncode == 0, name + " failed; inspect its recorded log"


try:
    clean()
    for name in ["session-checkpoints.js", "session-disk-roots.js", "session-store.js", "loader.js", "linux-worker-host.js", "linux-worker-protocol.js",
                 "roadmap.js", "session-alpine-image.json", "session-software-fixture.json"]:
        assert (ROOT / "web" / name).read_bytes() == (ROOT / "web/dist" / name).read_bytes(), "stale browser source: " + name
    run("policy", ["python3", "tools/check_task_policy.py"])
    run("format", ["cargo", "fmt", "--all", "--check"])
    run("core-clippy", ["cargo", "clippy", "-p", "wasm-vm-core", "--all-targets", "--features", "virgl-renderer,trace", "--", "-D", "warnings"])
    run("storage-clippy", ["cargo", "clippy", "-p", "wasm-vm-storage", "--all-targets", "--", "-D", "warnings"])
    run("boundary-clippy", ["cargo", "clippy", "-p", "wasm-vm-wasm", "--all-targets", "--", "-D", "warnings"])
    run("core-native", ["cargo", "test", "-p", "wasm-vm-core", "--lib", "--features", "virgl-renderer,trace", "--", "--nocapture"])
    run("checkpoint-native", ["cargo", "test", "-p", "wasm-vm-core", "--features", "virgl-renderer,trace",
        "--test", "e9_session_checkpoint", "--test", "cpu_resume", "--test", "snapshot_coherence",
        "--test", "desktop_machine_resume", "--test", "desktop_machine_resume_verifier",
        "--test", "desktop_machine_audio_resume", "--test", "virtio_blk_quiesce",
        "--test", "production_gpu_checkpoint_critic", "--", "--nocapture"])
    run("frame-native", ["cargo", "test", "-p", "wasm-vm-wasm", "--test", "software_checkpoint", "--", "--nocapture"])
    run("storage-native", ["cargo", "test", "-p", "wasm-vm-storage", "--", "--nocapture"])
    run("boundary-native", ["cargo", "test", "-p", "wasm-vm-wasm", "--lib", "--", "--nocapture"])
    run("adapter-native", ["cargo", "test", "-p", "wasm-vm-session-web"])
    run("no-std-wasm", ["cargo", "build", "-p", "wasm-vm-storage", "--target", "wasm32-unknown-unknown"])
    run("boundary-wasm-clippy", ["cargo", "clippy", "-p", "wasm-vm-wasm", "--target", "wasm32-unknown-unknown", "--features", "virgl-renderer", "--lib", "--", "-D", "warnings"])
    run("adapter-wasm-clippy", ["cargo", "clippy", "-p", "wasm-vm-session-web", "--target", "wasm32-unknown-unknown", "--lib", "--", "-D", "warnings"])
    run("browser-build", ["make", "web-build"])
    for folder, names in [("pkg", ["wasm_vm_wasm.js", "wasm_vm_wasm_bg.wasm"]),
                          ("session-pkg", ["wasm_vm_session.js", "wasm_vm_session_bg.wasm"])]:
        for name in names:
            assert (ROOT / "web" / folder / name).read_bytes() == (ROOT / "web/dist" / folder / name).read_bytes(), "stale compiled browser bundle: " + name
    run("shared-node-wasm", ["wasm-pack", "test", "--node", "tools/verify/session-wasm", "--locked"])
    run("worker-protocol", ["node", "--test", "web/tests/e4-t32-worker-protocol.test.mjs"])
    run("contract", ["python3", "tools/verify/e9-session-contract.py"])
    run("retained-gpu", ["python3", "tools/verify/e9-retained-gpu-runtime.py"])
    run("browser", ["node", "tools/verify/e9-software-checkpoints-browser.mjs", "--output", str(output / "browser")])
    browser = json.loads((output / "browser/report.json").read_text())
    assert browser["status"] == "passed" and browser["errors"] == [] and not browser["development"]
    assert browser["head"] == report["head"] and browser["checks"]["suite"] == {"passed": 127, "failed": 0}
    assert json.loads((output / "browser/tuple-oracle.json").read_text())["status"] == "passed"
    clean()
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    sources = ['crates/core/src/lib.rs', 'crates/core/src/dev/virtio/input/mod.rs', 'crates/core/src/dev/virtio/input/snapshot.rs', 'crates/core/src/dev/virtio/snd/mod.rs', 'crates/core/src/dev/virtio/snd/snapshot.rs', 'crates/core/src/dev/virtio/console.rs', 'crates/core/src/dev/virtio/console/session_snapshot.rs', 'crates/core/tests/e9_session_checkpoint.rs', 'crates/storage/src/checkpoint.rs', 'crates/storage/tests/checkpoint_context.rs', 'crates/storage/tests/checkpoint_context/cases.rs', 'crates/wasm/src/lib.rs', 'crates/wasm/src/software_checkpoint.rs', 'crates/wasm/src/session_checkpoint.rs', 'crates/wasm/tests/software_checkpoint.rs', 'crates/session-web/src/lib.rs', 'web/session-checkpoints.js', 'web/session-disk-roots.js', 'web/session-store.js', 'web/loader.js', 'web/linux-worker-protocol.js', 'web/linux-worker-host.js', 'web/tests/e4-t32-worker-protocol.test.mjs', 'web/roadmap.js', 'web/session-alpine-image.json', 'web/session-software-fixture.json', 'tools/gen-gpu-checkpoint-build.py', 'tools/verify/e9-software-checkpoints.py', 'tools/verify/e9-software-checkpoints-browser.mjs', 'tools/verify/e9-software-checkpoints-io.mjs', 'tools/verify/e9-software-checkpoints-files.py', 'tools/verify/session-wasm/tests/checkpoint_context.rs', 'tools/verify/session-wasm/Cargo.toml', 'tools/verify/session-wasm/Cargo.lock', 'docs/design/session-replay-contract.json', 'docs/design/session-replay.md', 'Cargo.lock', 'rust-toolchain.toml', 'Makefile']
    report["source_sha256"] = {name: file_sha(ROOT / name) for name in sources}
    report["finished"] = time.time()
    report["files"] = [{"path": str(file.relative_to(output)), "bytes": file.stat().st_size,
                        "sha256": file_sha(file)}
                       for file in sorted(output.rglob("*")) if file.is_file() and file != output / "report.json"]
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
