#!/usr/bin/env python3
"""Cross-build unchanged Mesa demos 9.0.0 eglinfo against the guest sysroot.

Runs inside the repository's pinned local reference container. The source disk
is opened read-only by debugfs; all outputs belong to the supplied directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--rootfs", required=True, type=Path)
p.add_argument("--archive", required=True, type=Path)
p.add_argument("--output", required=True, type=Path)
a = p.parse_args()
assert hashlib.sha256(a.archive.read_bytes()).hexdigest() == "3046a3d26a7b051af7ebdd257a5f23bfeb160cad6ed952329cdff1e9f1ed496b"
a.output.mkdir(parents=True, exist_ok=False)
source = a.output / "mesa-demos-9.0.0"
with tarfile.open(a.archive) as archive:
    for member in archive.getmembers():
        assert not Path(member.name).is_absolute() and ".." not in Path(member.name).parts
        if member.isfile():
            path = a.output / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.extractfile(member).read())
sysroot = a.output / "sysroot"
libraries = sysroot / "usr/lib"
libraries.mkdir(parents=True)
def debugfs(command):
    return subprocess.check_output(["debugfs", "-R", command, str(a.rootfs)], stderr=subprocess.DEVNULL, text=True)
debugfs("rdump /usr/include " + str(sysroot / "usr"))
extracted = set()
def extract(name):
    if name in extracted:
        return
    assert re.fullmatch(r"[A-Za-z0-9_.+-]+", name)
    status = debugfs("stat /usr/lib/" + name)
    assert "Inode:" in status, name
    extracted.add(name)
    path = libraries / name
    link = re.search(r'Fast link dest: "([^"]+)"', status)
    if link:
        assert "/" not in link[1]
        path.symlink_to(link[1])
        extract(link[1])
    else:
        debugfs("dump -p /usr/lib/" + name + " " + str(path))
        if path.read_bytes()[:4] == b"\x7fELF":
            dynamic = subprocess.check_output(["riscv64-linux-gnu-readelf", "-d", str(path)], text=True)
            for dependency in re.findall(r"\(NEEDED\).*\[([^\]]+)\]", dynamic):
                extract(dependency)
for name in ("libEGL.so", "libm.so", "libdl.a", "libpthread.a", "libc.so", "libc.so.6", "libc_nonshared.a", "ld-linux-riscv64-lp64d.so.1", "crt1.o", "Scrt1.o", "crti.o", "crtn.o"):
    extract(name)
binary = a.output / "eglinfo"
command = ["riscv64-linux-gnu-gcc", "--sysroot=" + str(sysroot), "-B" + str(libraries), "-O2", "-Wl,--build-id=none", "-I" + str(sysroot / "usr/include"), "-Isrc/glad/include", "-Isrc/util", "-L" + str(libraries), "-Wl,-rpath-link," + str(libraries), "src/egl/opengl/eglinfo.c", "src/glad/src/glad.c", "src/util/glinfo_common.c", "-lEGL", "-lm", "-ldl", "-o", str(binary)]
subprocess.run(command, cwd=source, check=True)
(a.output / "build.json").write_text(json.dumps({"command": command, "sourceArchiveSha256": hashlib.sha256(a.archive.read_bytes()).hexdigest(), "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest()}, indent=2) + "\n")
