#!/usr/bin/env bash
# Real RV64 Linux filesystem fixture; requires the repo's pinned local rootfs builder.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
out=${1:?usage: build.sh OUTPUT_DIRECTORY}
mkdir -p "$out"
out=$(cd "$out" && pwd)
busybox="$repo/releases/initramfs/busybox"
test "$(shasum -a 256 "$busybox" | awk '{print $1}')" = 9958179c84ee901615fef183214b90ec2306b5579d0640f520790105f4d79f30
builder=wasm-vm-rootfs-build:local
test "$(docker image inspect "$builder" --format '{{.Id}}')" = sha256:0d1ead8c1106a838e478676dff113f21cdd91eb9456232ff9f6c24679a87d0eb
docker run --rm -i -v "$busybox:/busybox:ro" \
  -v "$repo/tools/session-branch-fixture/init.sh:/init:ro" -v "$out:/out" "$builder" -s <<'INNER'
set -euo pipefail
export E2FSPROGS_FAKE_TIME=1700000000
root=/tmp/root
mkdir -p "$root"/{bin,dev,proc,sys}
cp /busybox "$root/bin/busybox"
chmod 755 "$root/bin/busybox"
for applet in sh mount sync cat sha256sum; do ln -s busybox "$root/bin/$applet"; done
cp /init "$root/init"
chmod 755 "$root/init"
mknod "$root/dev/console" c 5 1
mknod "$root/dev/null" c 1 3
find "$root" -exec touch -h -d @1700000000 {} +
image=/out/branch-linux.ext2
truncate -s 8M "$image"
uuid=6cf75ee0-330e-44de-bc63-c049ba212c46
mke2fs -q -t ext2 -b 4096 -N 128 -I 128 -O none -U "$uuid" \
  -E "root_owner=0:0,hash_seed=$uuid" -d "$root" "$image"
find "$root" -print | while IFS= read -r source; do
  name=${source#"$root"}; test -n "$name" || name=/
  printf 'set_inode_field "%s" ctime 1700000000\n' "$name"
  printf 'set_inode_field "%s" atime 1700000000\n' "$name"
done > /tmp/times
debugfs -w -f /tmp/times "$image" >/out/normalize.log 2>&1
e2fsck -fn "$image"
INNER
