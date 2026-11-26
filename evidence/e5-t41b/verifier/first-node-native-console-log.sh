#!/usr/bin/env bash
set -u
R=/Users/blamy/Documents/Codex/wasm-vm
D=$(cd "$(dirname "$0")" && pwd)
CMD='read a < /sys/block/vda/stat; node -e "console.log(6*7)"; read b < /sys/block/vda/stat; echo "VS""A $a"; echo "VS""B $b"; command -v node; echo VDO""NE'
rm -f "$D/in"; mkfifo "$D/in"; : > "$D/out.log"
( exec 3>"$D/in"; sleep 8; printf '\n' >&3; sleep 2; printf '%s\n' "$CMD" >&3; until grep -aq VDONE "$D/out.log"; do sleep 1; done; sleep 1; pkill -f "resume-from $D/ready.snap"; exec 3>&- ) &
"$R/target/release/wasm-vm" boot --kernel "$R/releases/kernel/6.6.63/Image" --drive "file=$D/disk.ext4" --ram-mib 1024 --net --virtio-rng \
  --browser-topology --icount-divider 64 --jit --block-cache --interrupt-batching --quantum 500000 --max-instrs 200000000000 \
  --append "root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4" \
  --resume-from "$D/ready.snap" --resume-core-id 302e302e31000000000000000000000000000000000000000000000000000000 \
  --resume-base-id b674702960a2b19714112b6d510bf438ed689438b91f1b12100c329e7db11dcf < "$D/in" > "$D/out.log" 2>&1
echo "boot exit $?"
