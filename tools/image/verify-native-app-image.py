#!/usr/bin/env python3
"""Record the offline signed native-app assembly and fresh ext4 acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def verify(args):
    output = args.output.resolve()
    if output.exists():
        raise ValueError("new output directory required")
    output.mkdir(parents=True, mode=0o700)
    report = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "status": "running", "commands": [], "runtimeOrDesktopClaim": False}
    volume = "wasm-vm-omarchy-app-proof-" + uuid.uuid4().hex[:12]
    report["outputVolume"] = volume  # Retain for the independent verifier; explicit cleanup only.

    def save():
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")

    def run(command):
        number = len(report["commands"])
        log = output / f"command-{number:02d}.log"
        started = time.monotonic()
        with log.open("wb") as stream:
            result = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
        report["commands"].append({"command": [str(arg) for arg in command], "exitCode": result.returncode,
                                   "seconds": time.monotonic() - started, "log": log.name, "sha256": digest(log)})
        save()
        if result.returncode:
            raise RuntimeError(f"acceptance command {number} failed; see {log}")

    tools = str(ROOT / "tools/image")
    cache = str(args.archives.resolve())
    common = ["docker", "run", "--rm", "--privileged", "--network", "none", "-v", volume + ":/work",
              "-v", tools + ":/tools:ro"]
    try:
        run(["python3", "-m", "unittest", "discover", "-s", "tools/image", "-p", "test_*.py", "-v"])
        run(["docker", "run", "--rm", "--privileged", "--network", "none", "-v", tools + ":/tools:ro",
             args.tool_image, "python3", "-m", "unittest", "discover", "-s", "/tools", "-p", "test_*.py", "-v"])
        run(["docker", "image", "inspect", args.tool_image])
        run(["docker", "volume", "create", volume])
        run(common + ["-v", args.source_volume + ":/input:ro", "-v", cache + ":/packages:ro",
                      "-v", str(ROOT / "evidence/omarchy-preparation/package-selection.json") + ":/inputs/selection.json:ro",
                      args.tool_image, "python3", "/tools/install-omarchy-apps.py", "--source", "/input/" + args.source_directory,
                      "--output", "/work/native", "--archives", "/packages", "--lock", "/tools/omarchy-apps/native-packages.lock.json",
                      "--selection", "/inputs/selection.json", "--source-overlays", "/tools/omarchy-reviewed-source-overlays.json",
                      "--final-overlays", "/tools/omarchy-apps/reviewed-overlays.json"])
        run(common + [args.tool_image, "python3", "/tools/build-omarchy-image.py", "/work/native/assembled", "/work/image",
                      "--selection", "/work/native/package-selection.json", "--overlays", "/tools/omarchy-apps/reviewed-overlays.json",
                      "--image-mib", "12288"])
        export = '''from pathlib import Path
import json, shutil
out=Path('/out')
for src, dst in [('native/commands.log','install.log'),('native/receipt.json','install-receipt.json'),('native/package-selection.json','package-selection.json'),('native/runtime-elf.json','runtime-elf.json'),('native/assembled/etc/wasm-vm/omarchy-assembly.json','assembly.json'),('image/commands.log','build.log'),('image/build-receipt.json','build-receipt.json')]:
 shutil.copyfile(Path('/work')/src,out/dst)
source=Path('/work/image/omarchy.ext4')
with source.open('rb') as src, (out/'omarchy.ext4').open('xb') as dst:
 for block in iter(lambda:src.read(1024*1024),b''):
  if block.strip(b'\\0'): dst.write(block)
  else: dst.seek(len(block),1)
 dst.truncate(source.stat().st_size)
'''
        run(["docker", "run", "--rm", "--network", "none", "-v", volume + ":/work:ro", "-v", str(output) + ":/out",
             args.tool_image, "python3", "-c", export])
        build = json.loads((output / "build-receipt.json").read_text())
        if digest(output / "omarchy.ext4") != build["image"]["sha256"]:
            raise ValueError("exported fresh image differs from build receipt")
        # Bounded-memory, split immutable chunks; no whole-image allocation.
        chunks = output / "chunks"
        chunks.mkdir()
        hashes = []
        with (output / "omarchy.ext4").open("rb") as stream:
            for block in iter(lambda: stream.read(256 * 1024), b""):
                pin = hashlib.sha256(block).hexdigest()
                hashes.append(pin)
                path = chunks / (pin + ".bin")
                if not path.exists():
                    path.write_bytes(block)
        manifest = {"version": 1, "image_len": build["image"]["size"], "chunk_size": 256 * 1024, "layout": "split", "chunks": hashes}
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        report.update(status="passed", image=build["image"], manifestSha256=digest(output / "manifest.json"),
                      chunkCount=len(hashes), uniqueChunks=len(set(hashes)))
        save()
        print(json.dumps({"status": "passed", "image": report["image"], "outputVolume": volume}), flush=True)
    except Exception as error:
        report.update(status="failed", error=str(error))
        save()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-volume", default="wasm-vm-omarchy-prep-20260909")
    parser.add_argument("--source-directory", default="assembled-r3", choices=("assembled-r3",))
    parser.add_argument("--archives", type=Path, default=ROOT / "target/omarchy-full/packages")
    parser.add_argument("--tool-image", default="wasm-vm-omarchy-image:profile")
    parser.add_argument("--output", type=Path, required=True)
    verify(parser.parse_args())
