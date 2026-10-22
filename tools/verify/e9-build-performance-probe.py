#!/usr/bin/env python3
"""Cross-compile the unchanged T01 EGL/GLES2 challenge in the local reference container."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
PIN = "822b258f329ee2d16d7f25fa676684e02227531dbdf8bf5edbf7dc8b45868155"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
output = args.output.resolve()
output.mkdir(exist_ok=False)
source = ROOT / "docs/design/session-gpu-probe.c"
assert hashlib.sha256(source.read_bytes()).hexdigest() == PIN
container = "wasm-vm-production-graphics-reference"
sysroot = "/capture/mesa-profile/sysroot"
scratch = "/tmp/e9-performance-probe-" + uuid.uuid4().hex
report = {"scope": "RV64 build receipt only; execution inside the real GPU desktop is still required", "status": "building", "commands": [], "sourceSha256": PIN}
def run(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    report["commands"].append({"command": command, "exitCode": result.returncode, "output": result.stdout})
    if result.returncode:
        raise RuntimeError(result.stdout)
    return result.stdout
try:
    report["containerImage"] = run(["docker", "inspect", container, "--format", "{{.Image}}"] ).strip()
    report["compiler"] = run(["docker", "exec", container, "riscv64-linux-gnu-gcc", "--version"])
    run(["docker", "exec", container, "mkdir", "-p", scratch])
    run(["docker", "cp", str(source), container + ":" + scratch + "/probe.c"])
    command = ["docker", "exec", container, "riscv64-linux-gnu-gcc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "--sysroot=" + sysroot, "-I" + sysroot + "/usr/include", scratch + "/probe.c", "-L" + sysroot + "/usr/lib", "-lGLESv2", "-lEGL", "-Wl,--build-id=none", "-o", scratch + "/probe"]
    run(command)
    report["headersAndLibraries"] = run(["docker", "exec", container, "sha256sum", sysroot + "/usr/include/EGL/egl.h", sysroot + "/usr/include/GLES2/gl2.h", sysroot + "/usr/lib/libEGL.so", sysroot + "/usr/lib/libGLESv2.so"])
    report["elf"] = run(["docker", "exec", container, "riscv64-linux-gnu-readelf", "-h", scratch + "/probe"])
    report["dynamic"] = run(["docker", "exec", container, "riscv64-linux-gnu-readelf", "-d", scratch + "/probe"])
    assert "RISC-V" in report["elf"] and "ELF64" in report["elf"] and "double-float ABI" in report["elf"]
    run(["docker", "cp", container + ":" + scratch + "/probe", str(output / "session-gpu-probe-riscv64.elf")])
    binary = (output / "session-gpu-probe-riscv64.elf").read_bytes()
    report["binary"] = {"path": "session-gpu-probe-riscv64.elf", "bytes": len(binary), "sha256": hashlib.sha256(binary).hexdigest()}
    report["status"] = "built-not-executed"
except Exception as error:
    report["status"] = "failed"
    report["error"] = str(error)
    raise
finally:
    run(["docker", "exec", container, "rm", "-rf", scratch])
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"status": report["status"], "binary": report.get("binary"), "output": str(output)}))
