#!/usr/bin/env bash
# Record the production image's ordered first-touch read chunks from a real Alpine boot.
# The native CLI and browser share the same virtio-blk device semantics; --profile-boot stops
# at getty's first `login:` marker, while --blk-log provides exact sector/length reads.
set -euo pipefail
cd "$(dirname "$0")/../.."

ROOTFS="${1:-releases/rootfs/alpine-rootfs.ext4}"
MANIFEST="${2:-releases/chunked-alpine/manifest.json}"
OUT="${3:-releases/chunked-alpine/boot-profile.json}"
CLI="target/release/wasm-vm"
KERNEL="releases/kernel/6.6.63/Image"
WORK="target/e3-t11-boot-profile"
DISK="$WORK.ext4"
CONSOLE="$WORK.console"
BLKLOG="$WORK.blklog"

for required in "$ROOTFS" "$MANIFEST" "$CLI" "$KERNEL"; do
  [ -e "$required" ] || { echo "record_boot_profile: missing $required" >&2; exit 2; }
done

# FileBackend is writable and Alpine updates runtime files during boot. Profile a disposable copy
# so the deterministic production image and its manifest remain byte-identical after recording.
rm -f "$DISK" "$CONSOLE" "$BLKLOG"
cp -p "$ROOTFS" "$DISK"
trap 'rm -f "$DISK"' EXIT

echo "record_boot_profile: booting a disposable image copy to the login marker…" >&2
"$CLI" boot \
  --kernel "$KERNEL" \
  --drive "file=$DISK" \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" \
  --max-instrs "${PROFILE_MAX_INSTRS:-60000000000}" \
  --no-input --profile-boot --blk-log \
  >"$CONSOLE" 2>"$BLKLOG"

grep -q 'login:' "$CONSOLE" || {
  echo "record_boot_profile: profile command exited without the login marker" >&2
  exit 1
}

python3 - "$MANIFEST" "$BLKLOG" "$OUT" <<'PY'
import json
import pathlib
import re
import sys

manifest_path, log_path, out_path = map(pathlib.Path, sys.argv[1:])
manifest = json.loads(manifest_path.read_text())
chunk_size = int(manifest["chunk_size"])
chunk_count = len(manifest["chunks"])
pattern = re.compile(r"^blk: IN\s+sector=(\d+) len=(\d+) status=0$")
seen: set[int] = set()
ordered: list[int] = []

for line in log_path.read_text(errors="replace").splitlines():
    match = pattern.match(line)
    if not match:
        continue
    sector, length = map(int, match.groups())
    if length == 0:
        continue
    first = sector * 512 // chunk_size
    last = (sector * 512 + length - 1) // chunk_size
    for index in range(first, last + 1):
        if index >= chunk_count:
            raise SystemExit(f"record_boot_profile: read chunk {index} outside manifest ({chunk_count})")
        if index not in seen:
            seen.add(index)
            ordered.append(index)

if not ordered:
    raise SystemExit("record_boot_profile: boot completed without a successful block read")
out_path.write_text(json.dumps(ordered, separators=(",", ":")) + "\n")
print(f"record_boot_profile: wrote {out_path} with {len(ordered)} ordered chunks", file=sys.stderr)
PY
