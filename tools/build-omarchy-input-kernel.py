#!/usr/bin/env python3
"""Build the isolated fixed-capacity Omarchy kernel; never overwrite the baseline."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "sha256:e8d02030be71b3eada014b615269d0a9e8eb93ace68fb2a8f9097c9467c109e1"
TAR = ROOT / "target/kernel-build/linux-6.6.63.tar.xz"
BASE = ROOT / "releases/kernel/6.6.63"
EVDEV_SHA = "b5d436fbe355b563f5dc40854bc3cc65e11c8fef348b0200463d736a726ffe56"


def identity(path):
    return {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    assert len(sys.argv) == 2, "usage: build-omarchy-input-kernel.py NEW_OUTPUT_DIR"
    out = Path(sys.argv[1]).resolve()
    assert out.is_relative_to(ROOT / "target"), "candidate kernel belongs under target/"
    out.mkdir(parents=True, exist_ok=False)
    assert identity(TAR)["sha256"] == "d1054ab4803413efe2850f50f1a84349c091631ec50a1cf9e891d1b1f9061835"
    assert identity(BASE / "Image")["sha256"] == "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce"
    baseline = {name: identity(BASE / name) for name in ("Image", "System.map", "config")}
    volume = "wasm-vm-omarchy-input-" + uuid.uuid4().hex[:16]
    receipt = {"passed": False, "image": IMAGE, "volume": volume, "baseline": baseline,
               "tarball": identity(TAR), "patch": identity(ROOT / "configs/omarchy-evdev-buffer.patch"),
               "configFragment": identity(ROOT / "configs/wasm-vm.config"), "commands": []}
    env = {**os.environ, "DEVELOPER_DIR": "/Library/Developer/CommandLineTools"}
    receipt["head"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, env=env, text=True).strip()
    script = f"""set -euo pipefail
cd /build
tar xf /src/linux.tar.xz
cd linux-6.6.63
echo '{EVDEV_SHA}  drivers/input/evdev.c' | sha256sum -c -
cp drivers/input/evdev.c /out/evdev.original.c
python3 - <<'PATCH'
import difflib
from pathlib import Path
source = Path('drivers/input/evdev.c')
original = source.read_text()
old = '#define EVDEV_MIN_BUFFER_SIZE\\t64U\\n'
new = '#define EVDEV_MIN_BUFFER_SIZE\\t1024U\\n'
assert original.count(old) == 1
patched = original.replace(old, new, 1)
diff = ''.join(difflib.unified_diff(original.splitlines(True), patched.splitlines(True),
    fromfile='a/drivers/input/evdev.c', tofile='b/drivers/input/evdev.c'))
assert diff == Path('/src/buffer.patch').read_text(), 'patch is not the exact one-line replacement'
source.write_text(patched)
PATCH
cp drivers/input/evdev.c /out/evdev.c
make defconfig
scripts/kconfig/merge_config.sh -m .config /src/wasm-vm.config
make olddefconfig
echo 1 > .version
riscv64-linux-gnu-gcc --version > /out/compiler.txt
make -j$(nproc) KBUILD_BUILD_VERSION=1 Image
cat arch/riscv/boot/Image > /out/Image
cat System.map > /out/System.map
cat .config > /out/config
"""
    (out / "build.sh").write_text(script)
    command = ["docker", "run", "--rm", "--network", "none", "--ulimit", "nofile=1048576:1048576",
               "-v", f"{volume}:/build", "-v", f"{TAR}:/src/linux.tar.xz:ro",
               "-v", f"{ROOT / 'configs/omarchy-evdev-buffer.patch'}:/src/buffer.patch:ro",
               "-v", f"{ROOT / 'configs/wasm-vm.config'}:/src/wasm-vm.config:ro",
               "-v", f"{out}:/out", "-e", "KBUILD_BUILD_TIMESTAMP=Thu Nov 14 2024",
               IMAGE, "bash", "/out/build.sh"]
    receipt["commands"].append(command)
    try:
        subprocess.run(["docker", "volume", "create", volume], check=True, timeout=30)
        with (out / "build.log").open("w") as log:
            subprocess.run(command, check=True, timeout=1800, stdout=log, stderr=subprocess.STDOUT)
        assert (out / "config").read_bytes() == (BASE / "config").read_bytes()
        original = (out / "evdev.original.c").read_bytes()
        assert (out / "evdev.c").read_bytes() == original.replace(
            b"#define EVDEV_MIN_BUFFER_SIZE\t64U", b"#define EVDEV_MIN_BUFFER_SIZE\t1024U", 1)
        assert baseline == {name: identity(BASE / name) for name in baseline}
        receipt["artifacts"] = {name: identity(out / name) for name in
                                ("Image", "System.map", "config", "evdev.c", "evdev.original.c", "compiler.txt")}
        receipt["passed"] = True
    finally:
        # This unique volume contains only this invocation's source/build intermediates.
        cleanup = subprocess.run(["docker", "volume", "rm", volume], capture_output=True, text=True, timeout=30)
        receipt["cleanup"] = {"returncode": cleanup.returncode, "stdout": cleanup.stdout, "stderr": cleanup.stderr}
        (out / "build.json").write_text(json.dumps(receipt, indent=2) + "\n")
    assert receipt["cleanup"]["returncode"] == 0
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
