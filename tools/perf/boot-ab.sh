#!/usr/bin/env bash
# Interleaved A/B wall-clock of the busybox boot-to-userland (fast mode unless MODE_FLAGS is set).
#   bash tools/perf/boot-ab.sh <binA> <binB> [reps]
# Prints one line per run: label total_ms retired MIPS. Interleaving cancels machine-load drift.
set -euo pipefail
A=$1; B=$2; N=${3:-3}
REL=${RELEASES:-releases}
FLAGS=${MODE_FLAGS:---block-cache --interrupt-batching}
for i in $(seq "$N"); do
  for bin in "$A" "$B"; do
    # shellcheck disable=SC2086
    "$bin" boot --kernel "$REL/kernel/6.6.63/Image" --initrd "$REL/initramfs/initramfs.cpio.gz" \
      --no-input --fixed-rtc-ns 1790000000000000000 $FLAGS --profile-boot 2>&1 >/dev/null |
      sed -n 's/.*"total_ms":\([0-9]*\),"total_retired":\([0-9]*\),"overall_mips":\([0-9.]*\).*/\1 \2 \3/p' |
      sed "s|^|$bin |"
  done
done
