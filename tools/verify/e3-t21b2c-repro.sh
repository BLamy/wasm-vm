#!/usr/bin/env bash
set -euo pipefail

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
evidence_dir=${1:-"$repo/target/e3-t21b2c-rootfs-repro"}

if [[ -e "$evidence_dir" ]]; then
  echo "refusing to replace existing evidence directory: $evidence_dir" >&2
  exit 2
fi
mkdir -p "$evidence_dir"

for label in a b; do
  log="$evidence_dir/build-$label.log"
  (
    cd "$repo"
    bash tools/build-rootfs.sh
    bash tools/verify/e3-t21b2c-rootfs.sh
  ) >"$log" 2>&1
  cp "$repo/releases/rootfs/alpine-rootfs.ext4" "$evidence_dir/rootfs-$label.ext4"
  shasum -a 256 "$evidence_dir/rootfs-$label.ext4" >"$evidence_dir/rootfs-$label.sha256"
done

cmp "$evidence_dir/rootfs-a.ext4" "$evidence_dir/rootfs-b.ext4"
test "$(cut -d' ' -f1 "$evidence_dir/rootfs-a.sha256")" = \
  "$(cut -d' ' -f1 "$evidence_dir/rootfs-b.sha256")"

{
  printf 'E3-T21b2c rootfs double-build: OK\n'
  cat "$evidence_dir/rootfs-a.sha256"
  cat "$evidence_dir/rootfs-b.sha256"
  printf 'artifacts:\n'
  printf '  %s\n' "$evidence_dir/rootfs-a.ext4" "$evidence_dir/rootfs-b.ext4"
  printf 'logs:\n'
  printf '  %s\n' "$evidence_dir/build-a.log" "$evidence_dir/build-b.log"
} | tee "$evidence_dir/result.txt"
