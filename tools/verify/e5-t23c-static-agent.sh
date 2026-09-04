#!/bin/bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/e5-t23c-static-agent.XXXXXX")
trap 'rm -rf "$work"' EXIT

clean_env() {
  env \
    -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG \
    -u CARGO_TARGET_DIR -u CARGO_BUILD_TARGET -u CARGO_BUILD_RUSTFLAGS \
    -u CARGO_ENCODED_RUSTFLAGS -u CARGO_NET_OFFLINE \
    -u CARGO_PROFILE_RELEASE_LTO -u CARGO_PROFILE_RELEASE_CODEGEN_UNITS \
    -u CARGO_PROFILE_RELEASE_OPT_LEVEL -u CARGO_PROFILE_RELEASE_PANIC \
    -u CARGO_PROFILE_RELEASE_STRIP \
    "$@"
}

# Test the state machine with a scrubbed caller environment before making the two independent
# cross-builds. The fixture covers byte-dribbled frames, malformed/oversized input, a full
# response queue, and a reset that discards an in-flight frame.
clean_env cargo test -p wasm-vm-guest-agent -- --nocapture

clean_env \
  CARGO_TARGET_DIR="$work/target-a" "$repo/tools/build-agent.sh" "$work/agent-a"
clean_env \
  CARGO_TARGET_DIR="$work/target-b" "$repo/tools/build-agent.sh" "$work/agent-b"

cmp "$work/agent-a" "$work/agent-b"
sha_a=$(shasum -a 256 "$work/agent-a" | awk '{print $1}')
sha_b=$(shasum -a 256 "$work/agent-b" | awk '{print $1}')
test "$sha_a" = "$sha_b"

size=$(wc -c < "$work/agent-a" | tr -d ' ')
test "$size" -le 1048576
description=$(file "$work/agent-a")
printf '%s\n' "$description"
printf '%s\n' "$description" | grep -qi 'ELF 64-bit'
printf '%s\n' "$description" | grep -qi 'RISC-V'
printf '%s\n' "$description" | grep -Eqi 'statically linked|static-pie linked'

# macOS has no native riscv64 ldd. The repository's local riscv64 Alpine verifier image is the
# same Linux userspace used by the T17 image builder; use it when the host ldd cannot inspect ELF.
if command -v ldd >/dev/null 2>&1 && ldd "$work/agent-a" >"$work/ldd.txt" 2>&1; then
  :
elif command -v docker >/dev/null 2>&1 && docker image inspect archriscv:base >/dev/null 2>&1; then
  # The temporary directory may live outside Colima's shared host paths, so stream the ELF over
  # stdin instead of asking Docker to bind-mount a host file.
  docker run --rm --platform=linux/riscv64 -i archriscv:base \
    sh -lc 'cat > /tmp/agent && chmod 0755 /tmp/agent && ldd /tmp/agent' \
    <"$work/agent-a" >"$work/ldd.txt" 2>&1
else
  echo "no riscv64 ldd verifier available (install/use the local archriscv:base image)" >&2
  exit 2
fi
cat "$work/ldd.txt"
grep -Eqi 'not a dynamic executable|statically linked' "$work/ldd.txt"

# Rebuild the actual T17 image once at this exact head. This is the authoritative installation
# proof; the disposable root below keeps the same path/link assertions cheap to inspect as well.
(cd "$repo" && clean_env bash tools/build-rootfs.sh)

# Inspect the finished ext4 read-only through debugfs. The source-level link check below catches
# wiring regressions; this catches a packer or image-tree regression that leaves the link or ELF out
# of the actual T17 artifact.
if command -v docker >/dev/null 2>&1; then
  docker run --rm --platform=linux/amd64 \
    -v "$repo/releases/rootfs/alpine-rootfs.ext4:/image:ro" \
    alpine:3.20 sh -lc \
    'apk add --no-cache e2fsprogs-extra >/dev/null &&
     debugfs -R "stat /etc/runlevels/default/wasmvm-agent" /image 2>&1 &&
     debugfs -R "stat /usr/libexec/wasm-vm/wasmvm-agent" /image 2>&1 &&
     debugfs -R "dump /usr/libexec/wasm-vm/wasmvm-agent /tmp/wasmvm-agent" /image >/dev/null 2>&1 &&
     sha256sum /tmp/wasmvm-agent &&
     debugfs -R "cat /etc/init.d/wasmvm-agent" /image 2>&1 &&
     debugfs -R "cat /etc/inittab" /image 2>&1' >"$work/rootfs-inspection.txt"
  grep -Fq 'Fast link dest: "/etc/init.d/wasmvm-agent"' "$work/rootfs-inspection.txt"
  grep -Fq "Size: $size" "$work/rootfs-inspection.txt"
  grep -Fq "$sha_a" "$work/rootfs-inspection.txt"
  grep -Fq 'ttyS0::respawn:/sbin/getty -L 115200 ttyS0 vt100' "$work/rootfs-inspection.txt"
else
  echo "rootfs build completed but no Docker debugfs inspector is available" >&2
  exit 2
fi

# This slice is a fixed named-port service. Keep the capability boundary obvious and reject
# accidental networking, command execution, or user-supplied path configuration in the binary.
grep -Fq 'pub const PORT_PATH: &str = "/dev/virtio-ports/org.wasmvm.agent"' \
  "$repo/guest/agent/src/lib.rs"
if rg -n 'TcpListener|UdpSocket|Command::|std::env::args|/bin/(sh|bash)|https?://' \
  "$repo/guest/agent/src"; then
  echo "guest agent contains an out-of-scope listener, command, or path capability" >&2
  exit 1
fi

# Recreate the image-builder's custom install surface in a disposable root. This keeps the exact
# path/link assertions easy to inspect alongside the authoritative image build above.
root="$work/root"
mkdir -p \
  "$root/etc/init.d" \
  "$root/etc/runlevels/default" \
  "$root/usr/libexec/wasm-vm"
install -m755 "$work/agent-a" "$root/usr/libexec/wasm-vm/wasmvm-agent"
install -m755 "$repo/tools/rootfs/wasmvm-agent.initd" "$root/etc/init.d/wasmvm-agent"
ln -s /etc/init.d/wasmvm-agent "$root/etc/runlevels/default/wasmvm-agent"

test -x "$root/usr/libexec/wasm-vm/wasmvm-agent"
test -x "$root/etc/init.d/wasmvm-agent"
test "$(readlink "$root/etc/runlevels/default/wasmvm-agent")" = /etc/init.d/wasmvm-agent
grep -Fq 'command="/usr/libexec/wasm-vm/wasmvm-agent"' \
  "$root/etc/init.d/wasmvm-agent"
grep -Fq 'respawn_delay=1' "$root/etc/init.d/wasmvm-agent"
grep -Fq 'respawn_max=5' "$root/etc/init.d/wasmvm-agent"
grep -Fq 'respawn_period=60' "$root/etc/init.d/wasmvm-agent"
grep -Fq 'ttyS0::respawn:/sbin/getty -L 115200 ttyS0 vt100' "$repo/tools/rootfs-inner.sh"
if grep -nE 'ttyS0.*wasmvm-agent|wasmvm-agent.*ttyS0' "$repo/tools/rootfs-inner.sh"; then
  echo "virtio agent changed the serial-console path" >&2
  exit 1
fi

# The manifest has an entry only after the final rootfs build; when it does, its two new paths
# must be present and its existing serial-owned service remains tracked separately.
if [ -f "$repo/releases/rootfs/FILE-MANIFEST.txt" ]; then
  agent_manifest=$(grep ' /usr/libexec/wasm-vm/wasmvm-agent$' \
    "$repo/releases/rootfs/FILE-MANIFEST.txt")
  service_manifest=$(grep ' /etc/init.d/wasmvm-agent$' \
    "$repo/releases/rootfs/FILE-MANIFEST.txt")
  test "$(printf '%s\n' "$agent_manifest" | awk '{print $1, $2}')" = "$sha_a 0755"
  service_sha=$(shasum -a 256 "$repo/tools/rootfs/wasmvm-agent.initd" | awk '{print $1}')
  test "$(printf '%s\n' "$service_manifest" | awk '{print $1, $2}')" = "$service_sha 0755"
  test "$(shasum -a 256 "$repo/releases/rootfs/FILE-MANIFEST.txt" | awk '{print $1}')" = \
    "$(awk '$2 == "FILE-MANIFEST.txt" {print $1}' "$repo/releases/rootfs/SHA256SUMS")"
else
  echo "missing T17 custom FILE-MANIFEST.txt" >&2
  exit 1
fi

printf 'E5-T23c static agent: OK sha256=%s size=%s\n' "$sha_a" "$size"
