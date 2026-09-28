set -euo pipefail
cd /build
tar xf /src/linux.tar.xz
cd linux-6.6.63
echo 'b5d436fbe355b563f5dc40854bc3cc65e11c8fef348b0200463d736a726ffe56  drivers/input/evdev.c' | sha256sum -c -
cp drivers/input/evdev.c /out/evdev.original.c
python3 - <<'PATCH'
import difflib
from pathlib import Path
source = Path('drivers/input/evdev.c')
original = source.read_text()
old = '#define EVDEV_MIN_BUFFER_SIZE\t64U\n'
new = '#define EVDEV_MIN_BUFFER_SIZE\t1024U\n'
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
