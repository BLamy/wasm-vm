#!/usr/bin/env python3
"""Fresh native-app desktop from the independently accepted package assembly.

The input volume is mounted read-only. All build state belongs to a new output
volume; only its duplicate root/image are removed after authenticated export.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
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


def prepare(args):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]+", args.assembly_volume):
        raise ValueError("explicit accepted volume name required")
    if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT):
        raise ValueError("frozen clean tracked source required")
    output = args.output.resolve()
    if output.exists():
        raise ValueError("new output directory required")
    output.mkdir(parents=True, mode=0o700)
    volume = "wasm-vm-omarchy-desktop-proof-" + uuid.uuid4().hex[:12]
    report = {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "status": "running", "assemblyVolume": args.assembly_volume, "outputVolume": volume,
              "commands": [], "runtimeOrDesktopClaim": False}

    def save():
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")

    def run(command):
        log = output / f"command-{len(report['commands']):02d}.log"
        started = time.monotonic()
        with log.open("wb") as stream:
            result = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
        report["commands"].append({"command": command, "exitCode": result.returncode,
                                   "seconds": time.monotonic() - started, "log": log.name, "sha256": digest(log)})
        save()
        if result.returncode:
            raise RuntimeError(f"desktop preparation failed; see {log}")

    tools = str(ROOT / "tools/image")
    common = ["docker", "run", "--rm", "--privileged", "--network", "none", "-v", volume + ":/work",
              "-v", tools + ":/tools:ro"]
    try:
        run(["docker", "volume", "create", volume])
        run(common + ["-v", args.assembly_volume + ":/accepted:ro", args.tool_image,
                      "python3", "/tools/build-omarchy-image.py", "/accepted/native/assembled", "/work/software",
                      "--selection", "/accepted/native/package-selection.json",
                      "--overlays", "/tools/omarchy-apps/reviewed-overlays.json", "--image-mib", "12288", "--applications"])
        run(common + [args.tool_image, "python3", "/tools/check-native-app-filesystem.py",
                      "--image", "/work/software/omarchy.ext4", "--overlays", "/tools/omarchy-apps/reviewed-overlays.json",
                      "--output", "/work/filesystem-metadata.json"])
        export = '''from pathlib import Path
import shutil
for source,target in [('software/commands.log','build.log'),('software/build-receipt.json','build-receipt.json'),('software/root/etc/wasm-vm/demo-overlay.json','demo-overlay.json'),('filesystem-metadata.json','filesystem-metadata.json')]:
 shutil.copyfile(Path('/work')/source,Path('/out')/target)
with open('/work/software/omarchy.ext4','rb') as source,open('/out/guest.ext4','xb') as target:
 for block in iter(lambda:source.read(1024*1024),b''):
  if block.strip(b'\\0'):target.write(block)
  else:target.seek(len(block),1)
 target.truncate(source.tell())
'''
        run(["docker", "run", "--rm", "--network", "none", "-v", volume + ":/work:ro",
             "-v", str(output) + ":/out", args.tool_image, "python3", "-c", export])
        build = json.loads((output / "build-receipt.json").read_text())
        if digest(output / "guest.ext4") != build["image"]["sha256"] or not build["applicationIntegration"]:
            raise ValueError("desktop export identity/integration mismatch")
        chunks = output / "chunks"
        chunks.mkdir()
        hashes = []
        with (output / "guest.ext4").open("rb") as stream:
            for block in iter(lambda: stream.read(256 * 1024), b""):
                pin = hashlib.sha256(block).hexdigest()
                hashes.append(pin)
                destination = chunks / (pin + ".bin")
                if destination.exists():
                    continue
                reuse = args.reuse_chunks / destination.name if args.reuse_chunks else None
                if reuse and reuse.is_file() and not reuse.is_symlink() and digest(reuse) == pin:
                    os.link(reuse, destination)
                else:
                    destination.write_bytes(block)
        manifest = {"version": 1, "image_len": build["image"]["size"], "chunk_size": 256 * 1024,
                    "layout": "split", "chunks": hashes}
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        run(["docker", "run", "--rm", "--network", "none", "-v", volume + ":/work", args.tool_image,
             "python3", "-c", "import shutil;from pathlib import Path;shutil.rmtree('/work/software/root');Path('/work/software/omarchy.ext4').unlink()"])
        final_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        if final_head != report["head"] or subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT):
            raise ValueError("desktop preparation changed frozen tracked source")
        report.update(status="passed", image=build["image"], manifestSha256=digest(output / "manifest.json"),
                      chunks=len(hashes), uniqueChunks=len(set(hashes)))
        save()
        print(json.dumps({"status": report["status"], "image": report["image"], "outputVolume": volume}))
    except Exception as error:
        report.update(status="failed", error=str(error))
        save()
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assembly-volume", required=True)
    parser.add_argument("--tool-image", default="wasm-vm-omarchy-image:profile")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reuse-chunks", type=Path)
    prepare(parser.parse_args())
