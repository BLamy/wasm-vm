#!/usr/bin/env bash
# Verifier runs of the acceptance script: the task's command, its control, and both crossed
# expectations (which must fail). Each run logs its command, output and exit code.
set -u
cd "$(dirname "$0")/../../.."
V=evidence/e5-t36b/verifier
NEW=target/e5-t36b/image/replay-desktop.ext4
GEN1=target/e5-t34b/image/replay-desktop.ext4
run() { # name image [extra args]
  local name=$1 image=$2; shift 2
  { echo "\$ node tools/verify/e5-t36b-hardware-cursor.mjs --image $image --out $V/$name $*"
    node tools/verify/e5-t36b-hardware-cursor.mjs --image "$image" --out "$V/$name" "$@"
    echo "exit=$?"; } >"$V/$name.log" 2>&1
}
run native "$NEW" &
run control-gen1 "$GEN1" --expect software &
run cross-new-expect-software "$NEW" --expect software &
run cross-gen1-expect-hardware "$GEN1" &
wait
grep -H '^exit=' "$V"/native.log "$V"/control-gen1.log "$V"/cross-*.log
