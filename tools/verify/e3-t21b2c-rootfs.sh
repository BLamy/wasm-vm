#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/e3-t21b2c.XXXXXX")
trap 'rm -rf "$work"' EXIT

CARGO_TARGET_DIR="$work/target" "$repo/tools/build-file-agent.sh" "$work/wvft-agent"

mkdir -p \
  "$work/root/etc/init.d" \
  "$work/root/etc/wasm-vm" \
  "$work/root/usr/libexec/wasm-vm" \
  "$work/root/usr/bin" \
  "$work/root/var/lib/wasm-vm/transfer/inbox" \
  "$work/root/var/lib/wasm-vm/transfer/outbox"
install -m755 "$repo/tools/rootfs/wasm-vm-file-agent.initd" \
  "$work/root/etc/init.d/wasm-vm-file-agent"
install -m644 "$repo/tools/rootfs/file-transfer.conf" \
  "$work/root/etc/wasm-vm/file-transfer.conf"
install -m755 "$work/wvft-agent" "$work/root/usr/libexec/wasm-vm/wvft-agent"
install -m755 "$repo/tools/rootfs/vm-download" "$work/root/usr/bin/vm-download"
chmod 0750 \
  "$work/root/var/lib/wasm-vm/transfer" \
  "$work/root/var/lib/wasm-vm/transfer/inbox" \
  "$work/root/var/lib/wasm-vm/transfer/outbox"

{
  for image_path in \
    /etc/init.d/wasm-vm-file-agent \
    /etc/wasm-vm/file-transfer.conf \
    /usr/libexec/wasm-vm/wvft-agent \
    /usr/bin/vm-download
  do
    mode=$(stat -c '%a' "$work/root$image_path" 2>/dev/null || stat -f '%Lp' "$work/root$image_path")
    digest=$(shasum -a 256 "$work/root$image_path" | awk '{print $1}')
    printf '%s 0%s %s\n' "$digest" "$mode" "$image_path"
  done
  for image_path in \
    /var/lib/wasm-vm/transfer \
    /var/lib/wasm-vm/transfer/inbox \
    /var/lib/wasm-vm/transfer/outbox
  do
    mode=$(stat -c '%a' "$work/root$image_path" 2>/dev/null || stat -f '%Lp' "$work/root$image_path")
    printf '%s 0%s %s\n' directory "$mode" "$image_path"
  done
} | sort -k3,3 > "$work/FILE-MANIFEST.txt"

diff -u "$repo/releases/rootfs/FILE-MANIFEST.txt" "$work/FILE-MANIFEST.txt"
grep -q 'command="/usr/libexec/wasm-vm/wvft-agent"' \
  "$work/root/etc/init.d/wasm-vm-file-agent"
grep -q 'need networking' "$work/root/etc/init.d/wasm-vm-file-agent"
grep -q '^/usr/libexec/wasm-vm/wvft-agent vm-download' "$work/root/usr/bin/vm-download"
grep -q 'trap restore_service EXIT HUP INT TERM' "$work/root/usr/bin/vm-download"
grep -q '^endpoint=10.0.2.2:10021$' "$work/root/etc/wasm-vm/file-transfer.conf"
if grep -Eq 'nc -l|netcat|socat|TcpListener|0\\.0\\.0\\.0|:::' \
  "$repo/tools/rootfs/wasm-vm-file-agent.initd" \
  "$repo/tools/rootfs/vm-download" \
  "$repo/tools/rootfs/file-transfer.conf"
then
  echo "rootfs integration contains a listener or general forwarding tool" >&2
  exit 1
fi

description=$(file "$work/root/usr/libexec/wasm-vm/wvft-agent")
printf '%s\n' "$description" | grep -qi 'RISC-V'
printf '%s\n' "$description" | grep -Eqi 'statically linked|static-pie linked'
printf 'E3-T21b2c rootfs: OK\n'
