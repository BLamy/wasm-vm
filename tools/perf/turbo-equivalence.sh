#!/usr/bin/env bash
# Turbo run-loop equivalence on the real desktop workload: resume the warm Replay desktop
# snapshot natively and run the same instruction budget twice — once with the turbo loop (the
# default) and once with `--no-turbo` — hashing every retired instruction. The two evidence files
# (rolling FNV of every retirement, retired count, SHA-256 of all guest RAM) must be identical.
#
#   bash tools/perf/turbo-equivalence.sh [INSTRUCTIONS] [OUT_DIR]
#
# Defaults: 2,000,000,000 instructions; OUT_DIR target/turbo-equivalence. Exit 0 and a final
# `EQUIVALENT` line on a match, exit 1 and `DIVERGED` otherwise.
#
# Inputs (gitignored build outputs / release artifacts):
#   BIN       target/release/wasm-vm                      (cargo build --release -p wasm-vm-cli)
#   RELEASES  the release-artifact root (default ./releases). A pristine clone holds only the
#             tracked artifacts, so point this at a checkout that has the large gitignored ones.
#   KERNEL    $RELEASES/kernel/6.6.63/Image
#   SNAPSHOT  the bootSnapshot named by web/artifacts-replay-desktop.json ($RELEASES/boot-snapshot/)
#   IMAGE     target/e5-t34b/image/replay-desktop.ext4, else the wholeImage .img.gz under $RELEASES
#   CACHE_ENTRIES  optional decoded-cache slot count for both runs (default: the CLI's 4096).
#             The evidence must not depend on it; tools/perf/decoded-cache-equivalence.sh checks.
#
# The run is made reproducible by pinning its only host inputs: no stdin (`--no-input`), a fixed
# RTC (`--fixed-rtc-ns`) and a seeded byte stream for the entropy device (`--virtio-rng-seed`; the
# snapshot was taken with the rng slot present, so the device must stay attached).
set -euo pipefail
cd "$(dirname "$0")/../.."
N="${1:-2000000000}"
OUT="${2:-target/turbo-equivalence}"
BIN="${BIN:-target/release/wasm-vm}"
RELEASES="${RELEASES:-releases}"
KERNEL="${KERNEL:-$RELEASES/kernel/6.6.63/Image}"
MANIFEST=web/artifacts-replay-desktop.json
field() { python3 -c "import json,sys; d=json.load(open('$MANIFEST'))['artifacts']; print(eval(sys.argv[1], {'d': d}))" "$1"; }
# Manifest URLs are relative to the page (`releases/...`); resolve them under $RELEASES.
artifact() { local url; url=$(field "$1"); echo "$RELEASES/${url#releases/}"; }
SNAPSHOT="${SNAPSHOT:-$(artifact "d['bootSnapshot']['url']")}"
CORE_ID=$(field "d['bootSnapshot']['identity']['coreId']")
BASE_ID=$(field "d['bootSnapshot']['identity']['baseId']")
APPEND=$(field "d['bootSnapshot']['identity']['bootargs']")
RAM_MIB=$(field "d['bootSnapshot']['identity']['ramMib']")
DIVIDER=$(field "d['bootSnapshot']['identity']['icountDivider']")
for f in "$BIN" "$KERNEL" "$SNAPSHOT"; do
  [ -f "$f" ] || { echo "turbo-equivalence: missing $f" >&2; exit 2; }
done
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
gunzip -c "$SNAPSHOT" > "$OUT/ready.snap"
if [ -n "${IMAGE:-}" ]; then :
elif [ -f target/e5-t34b/image/replay-desktop.ext4 ]; then IMAGE=target/e5-t34b/image/replay-desktop.ext4
else
  IMAGE="$OUT/replay-desktop.ext4"
  gunzip -c "$(artifact "d['wholeImage']['url']")" > "$IMAGE"
fi
EXPECT=$(field "d['wholeImage']['uncompressedSha256']")
ACTUAL=$(shasum -a 256 "$IMAGE" | awk '{print $1}')
[ "$ACTUAL" = "$EXPECT" ] || { echo "turbo-equivalence: $IMAGE is not the manifest's image ($ACTUAL)" >&2; exit 2; }

run() { # name, extra flags…
  local name=$1; shift
  local disk="$OUT/$name.ext4"
  cp -c "$IMAGE" "$disk" 2>/dev/null || cp "$IMAGE" "$disk"
  local t0; t0=$(date +%s)
  local rc=0
  "$BIN" boot --kernel "$KERNEL" --drive "file=$disk" --ram-mib "$RAM_MIB" --net \
    --virtio-rng --virtio-rng-seed 42 --browser-topology --icount-divider "$DIVIDER" \
    --block-cache --interrupt-batching --quantum 500000 --no-input --no-reboot \
    --fixed-rtc-ns 1700000000000000000 --max-instrs "$N" \
    --resume-from "$OUT/ready.snap" --resume-core-id "$CORE_ID" --resume-base-id "$BASE_ID" \
    --evidence "$OUT/$name.evidence.txt" --append "$APPEND" \
    ${CACHE_ENTRIES:+--decoded-cache-entries "$CACHE_ENTRIES"} "$@" \
    > "$OUT/$name.out" 2> "$OUT/$name.err" || rc=$?
  rm -f "$disk"
  echo "$name: exit $rc, $(( $(date +%s) - t0 )) s, $(grep -h '^turbo:' "$OUT/$name.err" || echo 'no turbo line')"
}
run turbo &
run ordinary --no-turbo &
wait
rm -f "$OUT/ready.snap"
echo "--- turbo";    cat "$OUT/turbo.evidence.txt"
echo "--- ordinary"; cat "$OUT/ordinary.evidence.txt"
grep -q '^turbo: enabled=true entries=[1-9]' "$OUT/turbo.err" \
  || { echo "turbo-equivalence: the turbo loop never engaged" >&2; exit 1; }
grep -q '^turbo: enabled=false entries=0 ' "$OUT/ordinary.err" \
  || { echo "turbo-equivalence: the control run used the turbo loop" >&2; exit 1; }
if cmp -s "$OUT/turbo.evidence.txt" "$OUT/ordinary.evidence.txt" && cmp -s "$OUT/turbo.out" "$OUT/ordinary.out"; then
  echo "EQUIVALENT ($N instructions)"
else
  echo "DIVERGED ($N instructions)"
  exit 1
fi
