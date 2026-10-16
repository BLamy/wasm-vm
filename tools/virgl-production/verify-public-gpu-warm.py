#!/usr/bin/env python3
"""Record default Omarchy GPU warm/repeat boots and the unified published site."""
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
parser.add_argument("--url", help="Deployed HTTPS origin; run only direct publication checks")
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo)
env = {key: value for key, value in os.environ.items()
       if key not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG")
       and not key.startswith(("CARGO_", "VIRGL_", "CRITIC_"))}
report = {"task": "E6-T11d74d", "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
          "url": args.url, "status": "running", "commands": [], "started": time.time()}


def run(name, command, timeout=1800, extra=None):
    print(name, flush=True)
    started = time.time()
    with (output/(name+".stdout")).open("wb") as stdout, (output/(name+".stderr")).open("wb") as stderr:
        result = subprocess.run(command, cwd=repo, env=dict(env, **(extra or {})),
                                stdout=stdout, stderr=stderr, timeout=timeout)
    report["commands"].append({"name": name, "command": command, "seconds": time.time()-started,
                               "exitCode": result.returncode})
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")
    assert result.returncode == 0, name+" failed; inspect recorded output"


try:
    if not args.url:
        run("policy", ["python3", "tools/check_task_policy.py"])
        run("format", ["cargo", "fmt", "--all", "--check"])
        run("core-clippy", ["cargo", "clippy", "-p", "wasm-vm-core", "--tests", "--features",
                            "virgl-renderer,virgl-control-proof,gpu-trace,trace", "--", "-D", "warnings"])
        run("wasm-clippy", ["cargo", "clippy", "-p", "wasm-vm-wasm", "--target", "wasm32-unknown-unknown",
                            "--features", "virgl-renderer", "--", "-D", "warnings"])
        run("native", ["cargo", "test", "-p", "wasm-vm-core", "--features", "virgl-renderer,trace", "--lib",
                       "--test", "production_virgl_critic", "--test", "production_gpu_checkpoint_critic",
                       "--test", "production_sparse_restore_critic", "--test", "virgl_capabilities"])
        run("protocol", ["node", "--test", "web/tests/e4-t32-worker-protocol.test.mjs",
                         "web/tests/omarchy-startup-state.test.mjs", "web/tests/omarchy-seeded-loader.test.mjs",
                         "web/tests/virgl-interactive-clock.test.mjs",
                         "web/tests/e6-t11d72-interactive-clock-critic.test.mjs",
                         "web/tests/e6-t11d72-paced-policy-critic.test.mjs",
                         "web/tests/e6-t11d72-keyboard-abi-critic.test.mjs",
                         "tools/virgl-production/critic-gpu-restored-clock.test.mjs",
                         "tools/virgl-production/critic-fast-boots-protocol.test.mjs",
                         "tools/virgl-production/critic-fast-boots-final.test.mjs",
                         "tools/virgl-production/critic-warm-ui-fixtures.test.mjs",
                         "tools/virgl-production/published-source.test.mjs",
                         "tools/virgl-production/critic-warm-pixels.test.mjs",
                         "tools/virgl-production/critic-warm-readiness.test.mjs"])
        run("web-dist", ["make", "web-dist"])
        assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo), "fresh deployable build differs from the committed bundle"
        assert hashlib.sha256((repo/"web/pkg/wasm_vm_wasm_bg.wasm").read_bytes()).digest() == hashlib.sha256((repo/"web/dist/pkg/wasm_vm_wasm_bg.wasm").read_bytes()).digest(), "committed Wasm differs"
        run("docs", ["node", "tools/check-docs.mjs"])
        run("docs-dist", ["python3", "tools/check-docs-dist.py"])
        run("idle-guest-build", ["node", "tools/virgl-production/paired-guest/build-idle.mjs"])
        assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo), "original idle guest binary did not reproduce"
        run("idle-gpu-warm", ["node", "tools/virgl-production/idle-worker-browser.mjs", str(output/"idle-gpu-warm"), "roundtrip"])
        run("failed-warm-restore", ["node", "--max-old-space-size=16384", "tools/virgl-production/critic-warm-ui-browser.mjs", str(output/"failed-warm-restore")],
            extra={"CRITIC_WARM_UI_WEB_ROOT": str(repo/"web/dist")})
    gpu_env = {"CRITIC_FAST_BOOT_WEB_ROOT": str(repo/"web/dist"), "CRITIC_FAST_BOOT_GPU": "warm",
               "CRITIC_FAST_BOOT_GUESTS": "omarchy", "CRITIC_FAST_BOOT_GPU_TRACE": "1",
               "CRITIC_FAST_BOOT_PERSISTENCE": "0"}
    if args.url:
        gpu_env["CRITIC_FAST_BOOT_URL"] = args.url
    run("default-gpu-warm", ["node", "--max-old-space-size=16384", "tools/virgl-production/critic-fast-boots.mjs", str(output/"default-gpu-warm")], 1800, gpu_env)
    software_env = {"CRITIC_FAST_BOOT_WEB_ROOT": str(repo/"web/dist"), "CRITIC_FAST_BOOT_GPU": "0",
                    "CRITIC_FAST_BOOT_GUESTS": "busybox,alpine,node-alpine,omarchy", "CRITIC_FAST_BOOT_SAVE_ON_REPEAT": "1"}
    if args.url:
        software_env["CRITIC_FAST_BOOT_URL"] = args.url
    run("software-fast-boots", ["node", "--max-old-space-size=16384", "tools/virgl-production/critic-fast-boots.mjs", str(output/"software-fast-boots")], 1800, software_env)
    remote = ["--url", args.url] if args.url else []
    run("default-browser", ["node", "tools/verify-virgl-default-demo.mjs", "--output", str(output/"default-browser"), "--task", "E6-T11d74d", *remote])
    run("unified-site", ["node", "tools/verify-reviewed-site.mjs", "--output", str(output/"unified-site"), *remote])
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
