#!/usr/bin/env bash
# E5-T45a: Replay Node 26 for riscv64 WITH its built-in startup snapshot and code cache.
#
# Node's configure turns both off for a cross build: the generator, node_mksnapshot, is a target
# (riscv64) binary the x64 build host cannot run. qemu-user is not usable for it here (qemu 8.2 under
# Rosetta faults on V8's high address reservations, and `-R` trips an internal assertion), so the
# generator runs where riscv64 is native to us: inside wasm-vm. Three phases, on the E5-T33 build
# container (source at /opt/replay-node-26, already built once with tools/node/build-node26.sh):
#
#   1. configure with tools/node/patches/configure-cross-snapshot-emulator.patch and
#      --emulator=/opt/emu-copy.sh (tools/node/node-snapshot-emulator.sh), build the
#      node_mksnapshot target only;
#   2. run that node_mksnapshot in a native wasm-vm boot of the Replay desktop image from a second
#      drive (evidence/e5-t45a/run-mksnapshot-in-guest.mjs) and copy its node_snapshot.cc to
#      /opt/node-snapshot/ in the container;
#   3. build node: the emulator script hands the generated file to the node_mksnapshot action and
#      runs every other (host) generator as is.
#
#   bash tools/node/build-node26-snapshot.sh   (from the repo root; DOCKER_CONTEXT as for E5-T33)
set -euo pipefail
cd "$(dirname "$0")/../.."
C=${NODE_BUILD_CONTAINER:-replay-node-26-x64}
FS=${MKFS_CONTAINER:-wasm-vm-e5t45a-mkfs}
IMAGE=${REPLAY_DESKTOP_IMAGE:-target/e5-t43f/image/replay-desktop.ext4}
W=target/e5-t45a
ENV='export CC=riscv64-linux-gnu-gcc-14 CXX=riscv64-linux-gnu-g++-14 AR=riscv64-linux-gnu-ar LINK=riscv64-linux-gnu-g++-14 CC_host=gcc CXX_host=g++ AR_host=ar LINK_host=g++'
mkdir -p "$W"

docker start "$C" >/dev/null
docker cp tools/node/patches/configure-cross-snapshot-emulator.patch "$C:/tmp/"
docker cp tools/node/node-snapshot-emulator.sh "$C:/opt/emu-copy.sh"
docker exec "$C" bash -c "chmod 755 /opt/emu-copy.sh && mkdir -p /opt/node-snapshot && cd /opt/replay-node-26 &&
  (git apply --reverse --check /tmp/configure-cross-snapshot-emulator.patch 2>/dev/null || git apply /tmp/configure-cross-snapshot-emulator.patch) &&
  $ENV && ./configure --dest-cpu=riscv64 --dest-os=linux --cross-compiling --openssl-no-asm --prefix=/usr --emulator=/opt/emu-copy.sh >/dev/null &&
  make -C out BUILDTYPE=Release node_mksnapshot -j12 >/tmp/mk-target.log 2>&1"
docker cp "$C:/opt/replay-node-26/out/Release/node_mksnapshot" "$W/node_mksnapshot"

# Phase 2: an ext4 drive holding node_mksnapshot, the run in the guest, the output back out.
docker create --name "$FS" wasm-vm-replay-desktop-build:local sleep infinity >/dev/null 2>&1 || true
docker start "$FS" >/dev/null
docker exec "$FS" mkdir -p /tmp/d
docker cp "$W/node_mksnapshot" "$FS:/tmp/d/node_mksnapshot"
docker exec "$FS" bash -c 'chmod 755 /tmp/d/node_mksnapshot && rm -f /tmp/m.ext4 && mke2fs -q -t ext4 -O ^has_journal -d /tmp/d -L mksnap /tmp/m.ext4 512M'
docker cp "$FS:/tmp/m.ext4" "$W/mksnap-run.ext4"
node evidence/e5-t45a/run-mksnapshot-in-guest.mjs "$IMAGE" "$W/mksnap-run.ext4" "$W/guest-run"
docker cp "$W/mksnap-run.ext4" "$FS:/tmp/run.ext4"
docker exec "$FS" bash -c 'debugfs -R "dump /node_snapshot.cc /tmp/node_snapshot.cc" /tmp/run.ext4 >/dev/null 2>&1; test -s /tmp/node_snapshot.cc'
docker cp "$FS:/tmp/node_snapshot.cc" "$W/node_snapshot.cc"
docker stop "$FS" >/dev/null
grep -q '{ "internal/deps/undici/undici",' "$W/node_snapshot.cc" || { echo "the generated code cache is empty" >&2; exit 1; }

# Phase 3.
docker cp "$W/node_snapshot.cc" "$C:/opt/node-snapshot/node_snapshot.cc"
docker exec "$C" bash -c "cd /opt/replay-node-26 && $ENV && make -j12 >/tmp/make-node.log 2>&1 &&
  riscv64-linux-gnu-strip -o out/Release/node.stripped out/Release/node && ls -la out/Release/node.stripped"
echo NODE-SNAPSHOT-BUILD-DONE
