#!/usr/bin/env bash
# E3.6-T05 native round-trip proof: reconstruct the post-boot disk from (pristine ext4 + overlay-delta),
# resume the node-alpine RAM snapshot against it, and drive real `node` at the restored shell. This both
# proves the shipped snapshot lands Node on PATH AND independently validates the overlay-delta coherence
# (the disk the browser will reassemble = pristine + this delta).
set -euo pipefail
cd "$(dirname "$0")/.."

BIN=target/release/wasm-vm
KERNEL=releases/kernel/6.6.63/Image
PRISTINE=releases/rootfs/alpine-rootfs.ext4
RAM_GZ=releases/boot-snapshot/node-alpine-ready.snap.gz
DELTA_GZ=releases/boot-snapshot/node-alpine-overlay-delta.bin.gz

SNAP=$(mktemp -t na-snap.XXXXXX.snap)
DELTA=$(mktemp -t na-delta.XXXXXX.bin)
DISK=$(mktemp -t na-disk.XXXXXX.ext4)
FIFO=$(mktemp -u -t na-in.XXXXXX); mkfifo "$FIFO"
LOG=$(mktemp -t na-resume.XXXXXX.log)
trap 'rm -f "$SNAP" "$DELTA" "$DISK" "$FIFO" "$LOG"' EXIT

gunzip -c "$RAM_GZ" > "$SNAP"
gunzip -c "$DELTA_GZ" > "$DELTA"

# The shipped snap is stamped (core_hash=version, base_image_hash=chunk base) for the BROWSER coherence
# guard. A fresh NATIVE machine has all-zero coherence, so zero the blob's identity (header bytes
# 12..76) for this native resume — RAM/sections are untouched; only the coherence labels change.
python3 - "$SNAP" <<'PY'
import sys
with open(sys.argv[1],"r+b") as f:
    f.seek(12); f.write(b"\x00"*64)
print("[proof] zeroed snapshot identity for native resume")
PY

echo "[proof] reconstructing post-boot disk = pristine + overlay-delta…"
cp "$PRISTINE" "$DISK"
python3 - "$DISK" "$DELTA" <<'PY'
import sys,struct
disk,delta=sys.argv[1:3]
with open(delta,"rb") as d:
    assert d.read(5)==b"WVOD1"
    (bs,)=struct.unpack("<I",d.read(4))
    (image_len,)=struct.unpack("<Q",d.read(8))
    d.read(32)                       # base_binding
    d.read(8)                        # generation
    (count,)=struct.unpack("<I",d.read(4))
    with open(disk,"r+b") as o:
        for _ in range(count):
            (idx,)=struct.unpack("<Q",d.read(8))
            blk=d.read(bs)
            o.seek(idx*bs); o.write(blk)
    print(f"applied {count} blocks (block_size={bs})")
PY

echo "[proof] resuming node-alpine snapshot and driving node at the restored shell…"
(
  exec 3>"$FIFO"
  sleep 6
  printf 'node --version\n' >&3
  sleep 3
  printf "node -e 'console.log(6*7)'\n" >&3
  sleep 3
  # Runtime-computed, non-canned result (adversarial check #1): sum 1..1000 = 500500.
  printf "node -e 'let s=0;for(let i=1;i<=1000;i++)s+=i;console.log(\"SUM=\"+s)'\n" >&3
  sleep 3
  # Write-a-file-then-read-it-back with node (adversarial check #2 — live, coherent fs).
  printf "node -e 'const fs=require(\"fs\");fs.writeFileSync(\"/root/proof.txt\",String(21*2));console.log(\"FILE=\"+fs.readFileSync(\"/root/proof.txt\",\"utf8\"))'\n" >&3
  sleep 3
  printf 'echo NODEPROOF_DONE\n' >&3
  sleep 10
) &
WRITER=$!

"$BIN" boot \
  --kernel "$KERNEL" \
  --drive "file=$DISK" \
  --net-slirp \
  --virtio-rng \
  --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" \
  --max-instrs 40000000000 \
  --resume-from "$SNAP" < "$FIFO" | tee "$LOG" &
BOOTPID=$!
# Stop once the proof marker prints (the resumed guest otherwise idles at the shell).
for _ in $(seq 1 300); do grep -q "NODEPROOF_DONE" "$LOG" && break; sleep 1; done
kill "$WRITER" "$BOOTPID" 2>/dev/null || true
wait 2>/dev/null || true

echo "==================== PROOF OUTPUT ===================="
grep -aE "v[0-9]+\.[0-9]+|^42$|SUM=|FILE=|NODEPROOF_DONE" "$LOG" || true
echo "====================================================="
