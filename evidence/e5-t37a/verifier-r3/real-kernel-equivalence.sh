#!/usr/bin/env bash
# E5-T37a round-3 verifier — the novel attack: the idle yield on a REAL kernel with real drivers.
#
# The worker's and both earlier verifiers' equivalence runs use hand-written guests. Here Linux
# 6.6 boots natively under the paced ICount clock on a host clock that advances a fixed amount
# per reading, three ways — busybox initramfs (8250 UART, RTC), Alpine on virtio-blk (plus the
# block queue), and the warm Replay desktop snapshot in the browser's device topology (virtio
# net, rng, keyboard, tablet, mouse, GPU, sound, console) — with the yield off and on, with the
# turbo loop and without, with and without a busy-lag bound. Every run stops after the same
# number of retirements.
#
# Why this can refute. With no host input the yield may only move where host calls end, so the
# evidence (rolling hash of every retired instruction, retired count, SHA-256 of guest RAM) and
# the console output must be identical with the yield on and off. It is also a detector for a
# FALSE wait: if a wait were ever reported while a device owed the guest an interrupt, that
# interrupt would be pending at the next call's first boundary, `paced_wake` would read the host
# clock once more than the yield-off run does, every later reading would be shifted by one step,
# and the traces would diverge.
#
#   python3 evidence/e5-t37a/verifier-r3/cli-paced-yield-probe.py apply
#   CARGO_TARGET_DIR=target/verifier-r3-probe cargo build --release -p wasm-vm-cli
#   python3 evidence/e5-t37a/verifier-r3/cli-paced-yield-probe.py revert
#   bash evidence/e5-t37a/verifier-r3/real-kernel-equivalence.sh target/verifier-r3-probe/release/wasm-vm target/verifier-r3-real
set -uo pipefail
cd "$(dirname "$0")/../../.."
BIN=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
OUT=$2
REL=$(cd "${RELEASES:-releases}" && pwd)
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
MANIFEST=web/artifacts-replay-desktop.json
field() { python3 -c "import json,sys; d=json.load(open('$MANIFEST'))['artifacts']; print(eval(sys.argv[1], {'d': d}))" "$1"; }
FAIL=0

# run <case> <variant> <retirements> <step_ns> <yield:0|1> <lag_ns or -> <extra cli flags...>
run() {
  local case=$1 variant=$2 n=$3 step=$4 yield=$5 lag=$6; shift 6
  local name="$case.$variant"
  local -a env=(WVM_R3_PACED_STEP_NS="$step" WVM_R3_STOP_RETIRED="$n")
  [ "$yield" = 1 ] && env+=(WVM_R3_YIELD=1)
  [ "$lag" != - ] && env+=(WVM_R3_LAG_NS="$lag")
  local -a args=(boot --kernel "$REL/kernel/6.6.63/Image" --block-cache --interrupt-batching
    --no-input --max-instrs 9000000000000000000 --quantum 200000
    --evidence "$OUT/$name.evidence.txt")
  local disk=""
  case $case in
    busybox) args+=(--initrd "$REL/initramfs/initramfs.cpio.gz" --fixed-rtc-ns 1790000000000000000) ;;
    alpine)
      disk="$OUT/$name.ext4"
      cp -c "$REL/rootfs/alpine-rootfs.ext4" "$disk" 2>/dev/null || cp "$REL/rootfs/alpine-rootfs.ext4" "$disk"
      args+=(--drive "file=$disk" --append "root=/dev/vda rw console=ttyS0 earlycon=sbi"
        --fixed-rtc-ns 1790000000000000000) ;;
    desktop)
      disk="$OUT/$name.ext4"
      cp -c "$IMAGE" "$disk" 2>/dev/null || cp "$IMAGE" "$disk"
      args+=(--drive "file=$disk" --ram-mib "$(field "d['bootSnapshot']['identity']['ramMib']")" --net
        --virtio-rng --virtio-rng-seed 42 --browser-topology
        --icount-divider "$(field "d['bootSnapshot']['identity']['icountDivider']")" --no-reboot
        --fixed-rtc-ns 1700000000000000000 --resume-from "$OUT/ready.snap"
        --resume-core-id "$(field "d['bootSnapshot']['identity']['coreId']")"
        --resume-base-id "$(field "d['bootSnapshot']['identity']['baseId']")"
        --append "$(field "d['bootSnapshot']['identity']['bootargs']")") ;;
  esac
  env "${env[@]}" "$BIN" "${args[@]}" "$@" > "$OUT/$name.out" 2> "$OUT/$name.err"
  local rc=$?
  [ -n "$disk" ] && rm -f "$disk"
  printf '%-34s exit %-3s %s\n' "$name" "$rc" "$(grep -h '^r3-probe:' "$OUT/$name.err" || echo 'NO r3-probe LINE')"
}

# compare <case> <reference variant> <variant>...
compare() {
  local case=$1 ref=$2; shift 2
  for v in "$@"; do
    if cmp -s "$OUT/$case.$ref.evidence.txt" "$OUT/$case.$v.evidence.txt" \
        && cmp -s "$OUT/$case.$ref.out" "$OUT/$case.$v.out"; then
      echo "  $case: $v == $ref  ($(grep -h 'fnv64\|retired=' "$OUT/$case.$v.evidence.txt" | tr '\n' ' ')$(grep -h sha256 "$OUT/$case.$v.evidence.txt" | cut -c1-29)…, console $(wc -c < "$OUT/$case.$v.out" | tr -d ' ') bytes)"
    else
      echo "  $case: $v DIVERGED from $ref"
      diff "$OUT/$case.$ref.evidence.txt" "$OUT/$case.$v.evidence.txt" | sed 's/^/      /'
      FAIL=1
    fi
  done
}

# group <case> <retirements> <step_ns> <lag or ->
group() {
  local case=$1 n=$2 step=$3 lag=$4 tag="s$3.l$4"
  echo "── $case: $n retirements, host clock +$step ns per reading, busy-lag bound $lag"
  run "$case" "$tag.off-turbo" "$n" "$step" 0 "$lag" &
  run "$case" "$tag.on-turbo" "$n" "$step" 1 "$lag" &
  run "$case" "$tag.off-batched" "$n" "$step" 0 "$lag" --no-turbo &
  run "$case" "$tag.on-batched" "$n" "$step" 1 "$lag" --no-turbo &
  wait
  compare "$case" "$tag.off-turbo" "$tag.on-turbo" "$tag.off-batched" "$tag.on-batched"
}

group busybox 350000000 1000000 -
group busybox 350000000 37000 50000000
group alpine 1500000000 1000000 -
group alpine 1500000000 250000 20000000

SNAPSHOT="$REL/$(field "d['bootSnapshot']['url']" | sed 's#^releases/##')"
IMAGE="${IMAGE:-target/e5-t34b/image/replay-desktop.ext4}"
if [ -f "$SNAPSHOT" ] && [ -f "$IMAGE" ]; then
  gunzip -c "$SNAPSHOT" > "$OUT/ready.snap"
  group desktop 1500000000 1000000 -
  group desktop 1500000000 120000 50000000
  rm -f "$OUT/ready.snap"
else
  echo "desktop: snapshot or image missing, skipped"
fi

if [ "$FAIL" = 0 ]; then echo "ALL EQUIVALENT"; else echo "DIVERGENCE FOUND"; exit 1; fi
