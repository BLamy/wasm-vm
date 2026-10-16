#!/usr/bin/env python3
"""Record the paired production worker boundary; stock Omarchy publication is74d."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo)
env = {key: value for key, value in os.environ.items()
       if key not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG")
       and not key.startswith(("CARGO_", "VIRGL_", "CRITIC_"))}
report = {"task": "E6-T11d74c", "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
          "scope": "Actual production worker with original-MMIO supervisor guest; not stock Linux/Mesa publication",
          "status": "running", "commands": [], "started": time.time()}


def run(name, command, timeout=1800, extra=None, expected=0):
    print(name, flush=True)
    started = time.time()
    with (output/(name+".stdout")).open("wb") as stdout, (output/(name+".stderr")).open("wb") as stderr:
        result = subprocess.run(command, cwd=repo, env=dict(env, **(extra or {})),
                                stdout=stdout, stderr=stderr, timeout=timeout)
    report["commands"].append({"name": name, "command": command, "seconds": time.time()-started,
                               "exitCode": result.returncode, "expectedExitCode": expected})
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")
    assert result.returncode == expected, name+" failed; inspect recorded output"


try:
    run("policy", ["python3", "tools/check_task_policy.py"])
    run("format", ["cargo", "fmt", "--all", "--check"])
    run("core-clippy", ["cargo", "clippy", "-p", "wasm-vm-core", "--tests", "--features",
                        "virgl-renderer,virgl-control-proof,gpu-trace,trace", "--", "-D", "warnings"])
    run("wasm-clippy", ["cargo", "clippy", "-p", "wasm-vm-wasm", "--target", "wasm32-unknown-unknown",
                        "--features", "virgl-renderer", "--", "-D", "warnings"])
    run("storage-unit", ["cargo", "test", "-p", "wasm-vm-storage", "--lib"])
    run("wasm-native", ["cargo", "test", "-p", "wasm-vm-wasm", "--lib", "--features", "virgl-renderer"])
    run("core-unit", ["cargo", "test", "-p", "wasm-vm-core", "--lib", "--features", "virgl-renderer,trace"])
    run("original-wire", ["cargo", "test", "-p", "wasm-vm-core", "--features", "virgl-renderer,trace",
                          "--test", "production_virgl_critic", "--test", "production_gpu_checkpoint_critic", "--test", "production_sparse_restore_critic",
                          "--", "--nocapture", "--test-threads=1"])
    run("legacy-resume", ["cargo", "test", "-p", "wasm-vm-core", "--features", "virgl-renderer,trace",
                          "--test", "desktop_machine_resume", "--test", "desktop_machine_resume_verifier",
                          "--test", "cpu_resume", "--test", "snapshot_coherence", "--test", "desktop_snapshot_save",
                          "--", "--nocapture", "--test-threads=1"])
    run("default-core", ["cargo", "check", "-p", "wasm-vm-core"])
    run("no-std-wasm", ["cargo", "build", "-p", "wasm-vm-core", "--no-default-features", "--target",
                        "wasm32-unknown-unknown", "--features", "virgl-renderer,trace"])
    tests = ["tools/virgl-production/gpu-checkpoint-dma.test.mjs", "tools/virgl-production/critic-checkpoint-dma.test.mjs", "tools/virgl-production/critic-gpu-pair-codec.test.mjs",
             "tools/virgl-production/critic-gpu-checkpoint-profile.test.mjs",
             "tools/virgl-production/critic-gpu-restored-clock.test.mjs",
             "web/tests/e4-t32-worker-protocol.test.mjs", "web/tests/virgl-interactive-clock.test.mjs",
             "web/tests/e6-t11d72-interactive-clock-critic.test.mjs", "web/tests/e6-t11d72-paced-policy-critic.test.mjs",
             "web/tests/e6-t11d72-keyboard-abi-critic.test.mjs", "web/tests/e5-t26i-guest-clock.test.mjs",
             "web/tests/e5-t26j-icount-divider.test.mjs", "web/tests/omarchy-seeded-loader.test.mjs",
             "web/tests/omarchy-admission-probe.test.mjs", "tools/virgl-production/critic-fast-boots-protocol.test.mjs",
             "tools/virgl-production/critic-fast-boots-final.test.mjs"]
    run("pair-clock-protocol", ["node", "--test", *tests])
    guest = repo/"guest/prebuilt/production-gpu-pair.bin"
    pin = hashlib.sha256(guest.read_bytes()).hexdigest()
    run("original-guest-build", ["node", "tools/virgl-production/paired-guest/build.mjs"])
    assert hashlib.sha256(guest.read_bytes()).hexdigest() == pin, "original guest is not reproducible"
    report["supervisorGuestSha256"] = pin
    run("web-build", ["make", "web-build"])
    built = repo/"web/pkg/wasm_vm_wasm_bg.wasm"
    committed = repo/"web/dist/pkg/wasm_vm_wasm_bg.wasm"
    assert hashlib.sha256(built.read_bytes()).digest() == hashlib.sha256(committed.read_bytes()).digest(), "committed Wasm differs"
    run("paired-worker", ["node", "tools/virgl-production/paired-worker-browser.mjs", str(output/"paired-worker"), "roundtrip"])
    run("paired-worker-production-ram", ["node", "tools/virgl-production/paired-worker-browser.mjs", str(output/"production-ram"), "roundtrip", "1024"])
    run("proof-wasm", ["wasm-pack", "build", "crates/wasm", "--target", "web", "--out-dir", "../../target/virgl-production/pkg", "--features", "virgl-renderer,virgl-control-proof"])
    run("physical-checkpoint-regression", ["node", "tools/virgl-production/worker-checkpoint-browser.mjs", "--output", str(output/"physical-checkpoint")])
    run("independent-pair-attacks", ["node", "tools/virgl-production/critic-paired-worker-browser.mjs", str(output/"independent-attacks"), "healthy"])
    run("independent-release-readiness", ["node", "tools/virgl-production/critic-paired-worker-browser.mjs", str(output/"release-readiness"), "release-readiness"])
    run("independent-disk-negative", ["node", "tools/virgl-production/critic-paired-worker-browser.mjs", str(output/"disk-negative"), "no-disk-witness"], expected=1)
    negative_dir = output/"disk-negative"
    negative = json.loads((negative_dir/"report.json").read_text())
    assert negative["status"] == "failed" and negative["mode"] == "no-disk-witness" and negative["errors"] == []
    assert negative["failure"]["message"] == "forbidden-native-application: mismatched pair reached native load before rejection"
    outcome = json.loads((negative_dir/"mixed-disk-native-refusal.json").read_text())
    assert outcome["resolved"]["forbiddenNativeApplication"] is True and outcome["serial"] == "" and outcome["errors"] == []
    event = outcome["resolved"]["event"]
    assert event["type"] == "checkpoint-loaded" and event["freshEpoch"] > event["savedEpoch"]
    a, b = negative["mix"]["diskA"], negative["mix"]["diskB"]
    assert a["base"] == b["base"] and a["generation"] == b["generation"] and (a["marker"], b["marker"]) == (77, 122)
    original = (negative_dir/"negative-control-original-gpu-checkpoint.js").read_bytes()
    modified = (negative_dir/"source/web/gpu-checkpoint.js").read_bytes()
    change = negative["negativeControl"]
    assert hashlib.sha256(original).hexdigest() == change["originalSha256"]
    assert hashlib.sha256(modified).hexdigest() == change["servedSha256"] != change["originalSha256"]
    assert original == (repo/"web/gpu-checkpoint.js").read_bytes()
    needle = b"clockState:clock,rendererSha256,diskSha256}"
    assert original.count(needle) == 1 and modified == original.replace(needle, b"clockState:clock,rendererSha256 /* critic isolated omitted disk binding */}")
    run("software-fast-boots", ["node", "tools/virgl-production/critic-fast-boots.mjs", str(output/"software-fast-boots")], 1800,
        {"CRITIC_FAST_BOOT_WEB_ROOT": str(repo/"web/dist"), "CRITIC_FAST_BOOT_GPU": "0",
         "CRITIC_FAST_BOOT_GUESTS": "busybox,alpine,node-alpine,omarchy", "CRITIC_FAST_BOOT_SAVE_ON_REPEAT": "1"})
    run("default-browser", ["node", "tools/verify-virgl-default-demo.mjs", "--output", str(output/"default-browser"), "--task", "E6-T11d74c"])
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo), "acceptance changed tracked files"
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    report["finished"] = time.time()
    report["files"] = [{"path": str(file.relative_to(output)), "bytes": file.stat().st_size,
                        "sha256": hashlib.sha256(file.read_bytes()).hexdigest()}
                       for file in sorted(output.rglob("*")) if file.is_file() and file != output/"report.json"]
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")
