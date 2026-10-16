#!/usr/bin/env python3
"""Execute scoped release acceptance against the committed bundle and public origin."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlsplit

repo = Path(__file__).resolve().parents[2]
phases = ("checks", "gpu-timing", "gpu-functional", "factory", "other-images",
          "software", "software-persistence", "swap-gpu", "swap-software",
          "applications", "recovery", "demo", "site")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", required=True, type=Path)
parser.add_argument("--url", default="https://wasm-vm.pages.dev/")
parser.add_argument("--phase", choices=("all", *phases), default="all",
                    help="An incremental phase does not claim the omitted phases passed")
parser.add_argument("--application-image", type=Path, default=repo/"target/virgl-production/image-18")
parser.add_argument("--inventory", type=Path,
                    default=repo/"target/evidence/omarchy-native-app-image-final01/runtime-elf.json")
args = parser.parse_args()
origin = urlsplit(args.url)
assert origin.scheme == "https" and origin.netloc and origin.path in ("", "/")
assert not (origin.query or origin.fragment or origin.username or origin.password)
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=False)
assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo), "commit source before recording"
selected = phases if args.phase == "all" else (args.phase,)
env = {k: v for k, v in os.environ.items() if k not in ("RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG")
       and not k.startswith(("CARGO_", "CRITIC_", "VIRGL_", "OMARCHY_"))}
report = {"schema": "omarchy-application-release-acceptance-v1", "task": "E5.5-T05d", "status": "running",
          "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
          "selectedPhases": list(selected), "omittedPhases": [p for p in phases if p not in selected],
          "url": args.url, "started": time.time(), "commands": []}


def digest(file):
    h = hashlib.sha256()
    with file.open("rb") as stream:
        for data in iter(lambda: stream.read(1024*1024), b""):
            h.update(data)
    return h.hexdigest()


def save():
    (output/"report.json").write_text(json.dumps(report, indent=2)+"\n")


def run(name, command, extra=None, timeout=3600):
    print(name, flush=True)
    row = {"name": name, "command": command, "extraEnvironment": extra or {}, "started": time.time()}
    report["commands"].append(row)
    save()
    try:
        with (output/(name+".log")).open("wb") as log:
            result = subprocess.run(command, cwd=repo, env=dict(env, **(extra or {})),
                                    stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        row["exit"] = result.returncode
        assert result.returncode == 0, name+" failed; retain and inspect the original log"
    finally:
        row["finished"] = time.time()
        file = output/(name+".log")
        if file.exists():
            row["log"] = {"path": file.name, "bytes": file.stat().st_size, "sha256": digest(file)}
        save()


def boot(name, extra, public=True, timeout=3600):
    options = {"CRITIC_FAST_BOOT_WEB_ROOT": str(repo/"web/dist"),
               "CRITIC_FAST_BOOT_PUBLIC_ASSET_ORIGIN": args.url,
               "CRITIC_FAST_BOOT_GUESTS": "omarchy", "CRITIC_FAST_BOOT_PERSISTENCE": "0", **extra}
    if public:
        options["CRITIC_FAST_BOOT_URL"] = args.url
    run(name, ["node", "--max-old-space-size=16384", "tools/virgl-production/critic-fast-boots.mjs", str(output/name)], options, timeout)
    assert json.loads((output/name/"report.json").read_text())["status"] == "passed"


try:
    if "applications" in selected:
        image = args.application_image.resolve()
        inventory = args.inventory.resolve()
        assert (image/"guest.ext4").is_file() and (image/"preparation.json").is_file()
        assert inventory.is_file(), "native signed-ELF inventory is an explicit application-proof input"
        report["applicationInputs"] = {"directory": str(image), "inventory": str(inventory),
                                      "inventorySha256": digest(inventory),
                                      "preparationSha256": digest(image/"preparation.json"),
                                      "manifestSha256": digest(image/"manifest.json")}
        save()
    for phase in selected:
        report["activePhase"] = phase
        save()
        if phase == "checks":
            run("policy", ["python3", "tools/check_task_policy.py"])
            run("whitespace", ["git", "diff", "--check"])
            run("publisher-tests", ["node", "--test", "tools/publish-omarchy-chunks.test.mjs", "tools/verify/omarchy-r2-proxy.test.mjs"])
            run("software-manifest-tests", ["node", "--test", "tools/gen-omarchy-manifest.test.mjs"])
            run("snapshot-fetch-syntax", ["node", "--check", "tools/fetch-omarchy-snapshot.mjs"])
            run("capture-syntax", ["node", "--check", "tools/verify/omarchy-native-capture.mjs"])
            run("software-builder-syntax", ["bash", "-n", "tools/build-omarchy-snapshot.sh"])
            for name in ("critic-fast-boots", "critic-fast-boots-input", "critic-desktop-actions",
                         "omarchy-swap-checkpoint", "omarchy-factory-guard", "omarchy-factory-prewarm",
                         "omarchy-restored-app-launches", "omarchy-release-recovery", "recompress-gpu-factory"):
                run("syntax-"+name, ["node", "--check", "tools/virgl-production/"+name+".mjs"])
            run("docs", ["node", "tools/check-docs.mjs"])
            run("docs-dist", ["python3", "tools/check-docs-dist.py"])
        elif phase == "gpu-timing":
            boot(phase, {"CRITIC_FAST_BOOT_GPU": "warm", "CRITIC_FAST_BOOT_GPU_TIMING_ONLY": "1"})
        elif phase == "gpu-functional":
            boot(phase, {"CRITIC_FAST_BOOT_GPU": "warm", "CRITIC_FAST_BOOT_GPU_TRACE": "1"})
        elif phase == "factory":
            boot(phase, {"CRITIC_FAST_BOOT_GPU": "warm", "CRITIC_FAST_BOOT_FACTORY_GUARD_ONLY": "1"})
            boot("factory-software", {"CRITIC_FAST_BOOT_GPU": "0", "CRITIC_FAST_BOOT_FACTORY_GUARD_ONLY": "1"})
        elif phase == "other-images":
            boot(phase, {"CRITIC_FAST_BOOT_GPU": "0", "CRITIC_FAST_BOOT_GUESTS": "busybox,alpine,node-alpine",
                         "CRITIC_FAST_BOOT_PERSISTENCE": "1", "CRITIC_FAST_BOOT_SAVE_ON_REPEAT": "1"})
        elif phase == "software":
            boot(phase, {"CRITIC_FAST_BOOT_GPU": "0"})
        elif phase == "software-persistence":
            boot(phase, {"CRITIC_FAST_BOOT_GPU": "0", "CRITIC_FAST_BOOT_OMARCHY_PERSIST": "1",
                         "CRITIC_FAST_BOOT_PERSISTENCE": "1", "CRITIC_FAST_BOOT_SAVE_ON_REPEAT": "1"})
        elif phase in ("swap-gpu", "swap-software"):
            boot(phase, {"CRITIC_FAST_BOOT_GPU": "warm" if phase == "swap-gpu" else "0",
                         "CRITIC_FAST_BOOT_GPU_TRACE": "1" if phase == "swap-gpu" else "0",
                         "CRITIC_FAST_BOOT_SWAP": "1"}, public=False)
        elif phase == "applications":
            boot(phase, {"CRITIC_FAST_BOOT_GPU": "warm", "CRITIC_FAST_BOOT_GPU_TRACE": "1",
                         "CRITIC_FAST_BOOT_RESTORED_APPLICATIONS": "1", "OMARCHY_DESKTOP_IMAGE_DIRECTORY": str(image),
                         "CRITIC_FAST_BOOT_APPLICATION_INVENTORY": str(inventory)}, timeout=5400)
        elif phase == "recovery":
            run(phase, ["node", "tools/virgl-production/omarchy-release-recovery.mjs", "--output", str(output/phase), "--url", args.url])
            assert json.loads((output/phase/"report.json").read_text())["status"] == "passed"
        elif phase == "demo":
            run(phase, ["node", "tools/verify-virgl-default-demo.mjs", "--output", str(output/phase), "--task", "E5.5-T05d", "--url", args.url])
        elif phase == "site":
            run(phase, ["node", "tools/verify-reviewed-site.mjs", "--output", str(output/phase), "--url", args.url])
    assert not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo), "acceptance changed tracked files"
    report["status"] = "passed"
except BaseException as error:
    report["status"] = "failed"
    report["failure"] = str(error)
    raise
finally:
    report["finished"] = time.time()
    report["files"] = [{"path": str(f.relative_to(output)), "bytes": f.stat().st_size, "sha256": digest(f)}
                       for f in sorted(output.rglob("*")) if f.is_file() and f != output/"report.json"]
    save()
