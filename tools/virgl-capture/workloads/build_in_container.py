#!/usr/bin/env python3
"""Read-only ext4 extraction and native ARM64 -> RISC-V workload cross-build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(data)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rootfs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    pins = json.loads((here / "pins.json").read_text())
    if os.uname().machine != "aarch64":
        raise SystemExit("This workload build is pinned to the native ARM64 reference container")
    packages = {}
    for name, expected in pins["cross_packages"].items():
        actual = subprocess.check_output(["dpkg-query", "-W", "-f=${Version}", name], text=True)
        if actual != expected:
            raise SystemExit(f"Cross toolchain package mismatch: {name} {actual} != {expected}")
        packages[name] = actual
    source_hash = digest(args.rootfs)
    if source_hash != pins["source_image_sha256"]:
        raise SystemExit("Source rootfs hash mismatch")
    sysroot = Path("/workload-sysroot")
    libraries = sysroot / "usr/lib"
    if libraries.exists():
        shutil.rmtree(libraries)
    libraries.mkdir(parents=True, exist_ok=True)
    inputs = Path("/workload-build/inputs")
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "bin").mkdir(exist_ok=True)
    sources = args.output / "sources"
    sources.mkdir(exist_ok=True)
    archive = inputs / "kmscube.tar"
    package = inputs / pins["glmark2"]["package"]
    for path, expected in [(archive, pins["kmscube"]["git_archive_sha256"]), (package, pins["glmark2"]["sha256"])]:
        if digest(path) != expected:
            raise SystemExit("Pinned input differs: " + str(path))
        shutil.copy2(path, sources / path.name)
    shutil.copy2(here / "textured-scene.c", sources / "textured-scene.c")
    shutil.copy2(here / "pins.json", sources / "pins.json")

    def debugfs(command):
        # No -w, mount, loop device, or guest disk modification.
        return subprocess.check_output(["debugfs", "-R", command, str(args.rootfs)], stderr=subprocess.DEVNULL, text=True)

    # Re-extract to ensure a previous scratch sysroot cannot supply stale headers.
    if (sysroot / "usr/include").exists():
        shutil.rmtree(sysroot / "usr/include")
    debugfs("rdump /usr/include " + str(sysroot / "usr"))
    if not (sysroot / "usr/include/EGL/egl.h").exists():
        raise SystemExit("Guest header extraction failed")
    extracted = set()

    def extract(name):
        if name in extracted:
            return
        if not re.fullmatch(r"[A-Za-z0-9_.+-]+", name):
            raise SystemExit("Unexpected library name: " + name)
        stat = debugfs("stat /usr/lib/" + name)
        if "Inode:" not in stat:
            raise SystemExit("Missing guest library: " + name)
        target = libraries / name
        if target.exists() or target.is_symlink():
            target.unlink()
        extracted.add(name)
        link = re.search(r'Fast link dest: "([^"]+)"', stat)
        if link:
            linked = link.group(1)
            if "/" in linked:
                raise SystemExit("Unexpected nonlocal guest library link: " + linked)
            target.symlink_to(linked)
            extract(linked)
        else:
            debugfs("dump -p /usr/lib/" + name + " " + str(target))
            if not target.exists() or not target.stat().st_size:
                raise SystemExit("Guest library extraction failed: " + name)
            if target.read_bytes()[:4] == b"\x7fELF":
                dynamic = subprocess.check_output(["riscv64-linux-gnu-readelf", "-d", str(target)], text=True)
                for needed in re.findall(r"\(NEEDED\).*\[([^\]]+)\]", dynamic):
                    extract(needed)

    for name in ["libEGL.so", "libGLESv2.so", "libgbm.so", "libdrm.so", "libm.so", "libdl.a",
                 "libpthread.a", "libc.so", "libc.so.6", "libc_nonshared.a", "ld-linux-riscv64-lp64d.so.1",
                 "crt1.o", "Scrt1.o", "crti.o", "crtn.o"]:
        extract(name)

    kmscube = Path("/workload-build/kmscube")
    if kmscube.exists():
        shutil.rmtree(kmscube)
    kmscube.mkdir()
    # Archive is authenticated against the official pinned git archive above.
    with tarfile.open(archive) as source:
        for item in source.getmembers():
            if item.name.startswith("/") or ".." in Path(item.name).parts or item.issym() or item.islnk():
                raise SystemExit("Unexpected archive member")
        source.extractall(kmscube)
    subprocess.run(["tar", "--zstd", "-xf", str(package), "-C", str(args.output)], check=True)
    flags = ["riscv64-linux-gnu-gcc", "--sysroot=" + str(sysroot), "-B" + str(libraries), "-O2",
             "-Wl,--build-id=none", "-I" + str(sysroot / "usr/include"),
             "-I" + str(sysroot / "usr/include/libdrm"), "-L" + str(libraries),
             "-Wl,-rpath-link," + str(libraries)]
    commands = []

    def compile(source_files, name, directory, extra):
        command = flags + extra + source_files + ["-lEGL", "-lGLESv2", "-lgbm", "-ldrm", "-lm", "-ldl", "-pthread",
                                               "-o", str(args.output / "bin" / name)]
        subprocess.run(command, cwd=directory, check=True)
        commands.append({"cwd": str(directory), "argv": command})
        header = subprocess.check_output(["riscv64-linux-gnu-readelf", "-h", str(args.output / "bin" / name)], text=True)
        if not re.search(r"Machine:\s+RISC-V", header):
            raise SystemExit("Compiler did not produce a RISC-V executable")

    compile(["textured-scene.c"], "virgl-textured-scene", here, ["-std=gnu11", "-Wall", "-Wextra", "-Werror"])
    # Sabotage changes uploaded pixels, not the independent expected values.
    # Its only successful test outcome is the guest program rejecting the draw.
    sabotage = Path("/workload-build/sabotage")
    sabotage.mkdir(exist_ok=True)
    original = (here / "textured-scene.c").read_text()
    needle = "const unsigned char texels[16] = {255,0,0,255,"
    if original.count(needle) != 1:
        raise SystemExit("Texture sabotage anchor changed; review the test deliberately")
    altered = original.replace(needle, "const unsigned char texels[16] = {0,255,0,255,")
    (sabotage / "textured-scene.c").write_text(altered)
    shutil.copy2(sabotage / "textured-scene.c", sources / "textured-scene-sabotage.c")
    compile(["textured-scene.c"], "virgl-textured-scene-sabotage", sabotage, ["-std=gnu11", "-Wall", "-Wextra", "-Werror"])
    # Same mandatory source list as pinned meson.build. Optional GStreamer,
    # PNG export and GLES3 shadertoy/texturator are deliberately not compiled.
    compile(["common.c", "cube-smooth.c", "cube-gears.c", "cube-tex.c", "drm-atomic.c", "drm-common.c",
             "drm-legacy.c", "drm-offscreen.c", "esTransform.c", "frame-512x512-NV12.c", "frame-512x512-RGBA.c",
             "kmscube.c", "perfcntrs.c"], "kmscube", kmscube, ["-std=gnu99"])
    file_hashes = {}
    for tree in [sysroot / "usr/include", libraries]:
        for path in sorted(tree.rglob("*")):
            if path.is_file():
                file_hashes[str(path.relative_to(sysroot))] = digest(path)
    inventory = json.dumps(file_hashes, sort_keys=True, separators=(",", ":")).encode()
    (args.output / "sysroot-files.json").write_bytes(inventory + b"\n")
    manifest = {
        "schema": "virgl-guest-workloads-v1", "source_image_sha256": source_hash, "pins": pins,
        "cross_packages": packages, "compiler": subprocess.check_output(["riscv64-linux-gnu-gcc", "--version"], text=True).splitlines()[0],
        "commands": commands, "sysroot_inventory_sha256": digest(args.output / "sysroot-files.json"),
        "binaries": {str(path.relative_to(args.output)): digest(path) for path in [args.output / "bin/virgl-textured-scene",
                     args.output / "bin/virgl-textured-scene-sabotage", args.output / "bin/kmscube",
                     args.output / "usr/bin/glmark2-es2-drm", args.output / "usr/bin/glmark2-es2-wayland"]},
        "workload_source_sha256": digest(here / "textured-scene.c"),
        "sabotage_source_sha256": digest(sabotage / "textured-scene.c"),
        "kmscube_optional_features": {"gstreamer": False, "png_export": False, "gles3_shadertoy": False},
    }
    (args.output / "build-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"status": "built", "manifest": str(args.output / "build-manifest.json"), "binaries": manifest["binaries"]}, indent=2))


if __name__ == "__main__":
    main()
