#!/usr/bin/env bash
# E5-T41b: resume a warm snapshot natively and count the root disk's reads (/sys/block/vda/stat,
# field 1: read requests, field 3: sectors) around the FIRST node command of the session.
#   bash first-node.sh SNAPSHOT.gz WORKDIR 'first command'
set -u
R=$(cd "$(dirname "$0")/../../.." && pwd); SNAPGZ=$1; W=$2; FIRST=$3
mkdir -p "$W"; [ -f "$W/ready.snap" ] || gunzip -c "$SNAPGZ" > "$W/ready.snap"
gunzip -c "$R/releases/rootfs/replay-desktop-20f03da7c51d.img.gz" > "$W/disk.ext4"
CMD="read a < /sys/block/vda/stat; $FIRST >/dev/null; read b < /sys/block/vda/stat; echo \"VS\"\"A \$a\"; echo \"VS\"\"B \$b\"; echo VDO\"\"NE"
rm -f "$W/in"; mkfifo "$W/in"; : > "$W/out.log"
( exec 3>"$W/in"; sleep 8; printf '\n' >&3; sleep 2; printf '%s\n' "$CMD" >&3; until grep -aq VDONE "$W/out.log"; do sleep 1; done; sleep 1; pkill -f "resume-from $W/ready.snap"; exec 3>&- ) &
SNAP=$(python3 -c "import json;print(json.dumps(json.load(open('$R/web/artifacts-replay-desktop.json'))['artifacts']['bootSnapshot']['identity']))")
CORE=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['coreId'])" "$SNAP"); BASE=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['baseId'])" "$SNAP")
"$R/target/release/wasm-vm" boot --kernel "$R/releases/kernel/6.6.63/Image" --drive "file=$W/disk.ext4" --ram-mib 1024 --net --virtio-rng \
  --browser-topology --icount-divider 64 --block-cache --interrupt-batching --quantum 500000 --max-instrs 200000000000 \
  --append "root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4" \
  --resume-from "$W/ready.snap" --resume-core-id "$CORE" --resume-base-id "$BASE" < "$W/in" > "$W/out.log" 2>&1
a=$(grep -a '^VSA' "$W/out.log" | awk '{print $2, $4}'); b=$(grep -a '^VSB' "$W/out.log" | awk '{print $2, $4}')
echo "first command: $FIRST"; echo "before: requests sectors = $a"; echo "after:  requests sectors = $b"
