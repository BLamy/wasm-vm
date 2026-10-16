#!/usr/bin/env python3
"""Select actual GLES for the image's unchanged Quickshell application.

Build one public Qt API initializer and add it as a Quickshell-only ELF
dependency. The source base is read-only, and the original package executable
is retained alongside exact source/header/tool/library identities.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--base", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
p.add_argument("--container", default="wasm-vm-production-graphics-reference")
p.add_argument("--sysroot", default="/capture/mesa-profile/sysroot")
a = p.parse_args()
repo = Path(__file__).resolve().parents[2]
a.output = a.output.resolve()
a.output.mkdir(parents=True, exist_ok=False)
source = repo / "tools/virgl-production/quickshell-gles-format.cpp"
scratch = "/capture/quickshell-profile-" + a.output.name
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
original = a.output / "quickshell-original"
extract = ["docker", "run", "--rm", "-v", str(a.base.resolve()) + ":/disk/base:ro",
           "-v", str(a.output) + ":/work", "wasm-vm-virgl-reference:1.3.0",
           "debugfs", "-R", "dump /usr/bin/quickshell /work/quickshell-original", "/disk/base"]
subprocess.run(extract, check=True, capture_output=True)
assert original.read_bytes()[:4] == b"\x7fELF", "the original package must be an ELF executable"
shutil.copyfile(source, a.output / source.name)
subprocess.run(["docker", "exec", a.container, "mkdir", "-p", scratch], check=True)
subprocess.run(["docker", "cp", str(source), a.container + ":" + scratch + "/profile.cpp"], check=True)
subprocess.run(["docker", "cp", str(original), a.container + ":" + scratch + "/quickshell"], check=True)
library = "libquickshell-browser-gles.so"
compile_command = ["riscv64-linux-gnu-g++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-shared", "-fPIC", "-Os",
                   "--sysroot=" + a.sysroot, "-MMD", "-MF", scratch + "/headers.d",
                   "-I" + a.sysroot + "/usr/include/qt6", "-I" + a.sysroot + "/usr/include/qt6/QtGui",
                   "-I" + a.sysroot + "/usr/include/qt6/QtCore", scratch + "/profile.cpp",
                   "-L" + a.sysroot + "/usr/lib", "-lQt6Gui", "-lQt6Core",
                   "-Wl,-soname," + library, "-o", scratch + "/" + library]
subprocess.run(["docker", "exec", a.container, *compile_command], check=True)
patch = ["patchelf", "--add-needed", "/usr/lib/omarchy/" + library, scratch + "/quickshell"]
subprocess.run(["docker", "exec", a.container, *patch], check=True)
for name in [library, "quickshell", "headers.d"]:
    subprocess.run(["docker", "cp", a.container + ":" + scratch + "/" + name, str(a.output / name)], check=True)
needed = subprocess.check_output(["docker", "exec", a.container, "patchelf", "--print-needed", scratch + "/quickshell"], text=True).splitlines()
assert needed.count("/usr/lib/omarchy/" + library) == 1

def elf_sections(path):
    data = path.read_bytes()
    assert data[:6] == b"\x7fELF\x02\x01" and struct.unpack_from("<H", data, 18)[0] == 243
    offset = struct.unpack_from("<Q", data, 40)[0]
    size, count, strings = struct.unpack_from("<HHH", data, 58)
    headers = [struct.unpack_from("<IIQQQQIIQQ", data, offset + i * size) for i in range(count)]
    table = data[headers[strings][4]:headers[strings][4] + headers[strings][5]]
    return {table[h[0]:table.index(b"\x00", h[0])].decode(): data[h[4]:h[4] + h[5]] for h in headers}

before, after = elf_sections(original), elf_sections(a.output / "quickshell")
sections = {}
for name in (".text", ".rodata"):
    assert before[name] == after[name], "client code/data changed during dependency addition"
    sections[name] = hashlib.sha256(before[name]).hexdigest()
headers = (a.output / "headers.d").read_text().replace("\\\n", " ").split(":", 1)[1].split()
qt_headers = sorted({name for name in headers if name.startswith(a.sysroot + "/usr/include/qt6/")})
assert qt_headers
identities = {}
for name in qt_headers + [a.sysroot + "/usr/lib/libQt6Gui.so.6.11.2", a.sysroot + "/usr/lib/libQt6Core.so.6.11.2"]:
    value = subprocess.check_output(["docker", "exec", a.container, "sha256sum", name], text=True).split()[0]
    identities[name.removeprefix(a.sysroot)] = value
receipt = {"scope": "Quickshell-only early QSurfaceFormat OpenGLES 3.0 selection; original executable code and Omarchy QML retained, no global preload or inherited child preload",
           "qt": "6.11.2", "compile": compile_command, "patch": patch, "needed": needed,
           "compiler": subprocess.check_output(["docker", "exec", a.container, "riscv64-linux-gnu-g++", "--version"], text=True).splitlines()[0],
           "patchelf": subprocess.check_output(["docker", "exec", a.container, "patchelf", "--version"], text=True).strip(),
           "originalExecutableSha256": digest(original), "sourceSha256": digest(source), "qtIdentities": identities, "unchangedExecutableSections": sections,
           "files": {name: {"sha256": digest(a.output / name), "bytes": (a.output / name).stat().st_size}
                     for name in [library, "quickshell", "quickshell-original", source.name, "headers.d"]}}
(a.output / "build.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"status": "built", "original": receipt["originalExecutableSha256"], "files": receipt["files"]}))
