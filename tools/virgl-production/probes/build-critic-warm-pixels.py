#!/usr/bin/env python3
"""Build the independent RISC-V guest pixel challenge with the pinned local sysroot."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import uuid

repo = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--container", default="wasm-vm-production-graphics-reference")
parser.add_argument("--sysroot", default="/capture/mesa-profile/sysroot")
parser.add_argument("--output", type=Path, default=repo/"tools/virgl-production/fixtures/critic-warm-pixels-riscv64.elf")
args = parser.parse_args()
source = Path(__file__).with_name("critic-warm-pixels.c")
output = args.output.resolve()
output.parent.mkdir(parents=True, exist_ok=True)
directory = "/tmp/wvm-critic-warm-pixels-"+uuid.uuid4().hex
commands = []


def run(command, capture=False):
    commands.append(command)
    return subprocess.check_output(command, text=True) if capture else subprocess.check_call(command)


try:
    run(["docker", "exec", args.container, "mkdir", "-p", directory])
    run(["docker", "cp", str(source), args.container+":"+directory+"/critic-warm-pixels.c"])
    run(["docker", "exec", args.container, "riscv64-linux-gnu-gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-Os",
         "--sysroot="+args.sysroot, "-I"+args.sysroot+"/usr/include", directory+"/critic-warm-pixels.c",
         "-L"+args.sysroot+"/usr/lib", "-lGLESv2", "-lEGL", "-Wl,--build-id=none", "-o", directory+"/warm-pixels"])
    run(["docker", "cp", args.container+":"+directory+"/warm-pixels", str(output)])
    compiler = run(["docker", "exec", args.container, "riscv64-linux-gnu-gcc", "--version"], True)
    image = run(["docker", "inspect", args.container, "--format", "{{.Image}}"], True).strip()
    headers = run(["docker", "exec", args.container, "sha256sum", args.sysroot+"/usr/include/GLES3/gl3.h",
                   args.sysroot+"/usr/include/EGL/egl.h"], True)
    files = []
    for path in [source, output]:
        body = path.read_bytes()
        files.append({"path": str(path.relative_to(repo)) if path.is_relative_to(repo) else str(path),
                      "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
    receipt = {"scope": "Independent actual guest GLES challenge, not a renderer substitute", "status": "passed",
               "commands": commands, "compiler": compiler, "containerImage": image, "headers": headers, "files": files}
    output.with_suffix(".build.json").write_text(json.dumps(receipt, indent=2)+"\n")
    print(json.dumps(files, indent=2))
finally:
    subprocess.run(["docker", "exec", args.container, "rm", "-rf", directory], check=False)
