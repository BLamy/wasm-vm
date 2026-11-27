#!/usr/bin/env bash
# E5-T41b round-2 verifier: resume the published warm snapshot natively (fresh resume per call)
# and count root-disk reads (/sys/block/vda/stat field 1 = read requests, field 3 = sectors)
# around the session's FIRST command. SETUP (optional) runs before the first stat read and may
# only use already-resident busybox builtins; its own reads are reported separately. The first
# command runs with its output on the serial tty unless it redirects it itself.
#   bash first-cmd.sh WORKDIR 'first command' ['setup']
set -u
R=$(cd "$(dirname "$0")/../../.." && pwd); W=$1; FIRST=$2; SETUP=${3:-true}
SNAPGZ="$R/$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1]))['artifacts']['bootSnapshot']['url'])" "$R/web/artifacts-replay-desktop.json")"
mkdir -p "$W"; SHARED="$(dirname "$W")/ready.snap"
[ -f "$SHARED" ] || gunzip -c "$SNAPGZ" > "$SHARED"
gunzip -c "$R/releases/rootfs/replay-desktop-20f03da7c51d.img.gz" > "$W/disk.ext4"
CMD="read s < /sys/block/vda/stat; $SETUP; read a < /sys/block/vda/stat; $FIRST; echo \"RC\"\"=\$?\"; read b < /sys/block/vda/stat; echo \"VS\"\"S \$s\"; echo \"VS\"\"A \$a\"; echo \"VS\"\"B \$b\"; echo VDO\"\"NE"
rm -f "$W/in"; mkfifo "$W/in"; : > "$W/out.log"
( exec 3>"$W/in"; sleep 8; printf '\n' >&3; sleep 2; printf '%s\n' "$CMD" >&3; until grep -aq VDONE "$W/out.log"; do sleep 1; done; sleep 1; exec 3>&- ) &
FEED=$!
SNAP=$(python3 -I -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))['artifacts']['bootSnapshot']['identity']))" "$R/web/artifacts-replay-desktop.json")
CORE=$(python3 -I -c "import json,sys;print(json.loads(sys.argv[1])['coreId'])" "$SNAP"); BASE=$(python3 -I -c "import json,sys;print(json.loads(sys.argv[1])['baseId'])" "$SNAP")
"$R/target/release/wasm-vm" boot --kernel "$R/releases/kernel/6.6.63/Image" --drive "file=$W/disk.ext4" --ram-mib 1024 --net --virtio-rng \
  --browser-topology --icount-divider 64 --block-cache --interrupt-batching --quantum 500000 --max-instrs 200000000000 \
  --append "root=/dev/vda ro rootfstype=ext4 rootwait init=/sbin/init console=ttyS0 earlycon=sbi quiet loglevel=4" \
  --resume-from "$SHARED" --resume-core-id "$CORE" --resume-base-id "$BASE" < "$W/in" > "$W/out.log" 2>&1 &
VM=$!
until grep -aq VDONE "$W/out.log" 2>/dev/null; do sleep 1; kill -0 $VM 2>/dev/null || break; done
sleep 1; kill $VM 2>/dev/null; wait $VM 2>/dev/null; wait $FEED 2>/dev/null
f() { grep -a "^$1" "$W/out.log" | tail -1 | awk '{print $2, $4}'; }
s=$(f VSS); a=$(f VSA); b=$(f VSB); rc=$(grep -ao 'RC=[0-9]*' "$W/out.log" | tail -1)
read ra sa <<<"$a"; read rb sb <<<"$b"
echo "snapshot: $SNAPGZ"
echo "first command: $FIRST   (setup: $SETUP)  $rc"
echo "  setup: $s -> $a ; first command: before $a after $b ; delta requests=$((rb-ra)) KiB=$(((sb-sa)/2))"
rm -f "$W/disk.ext4"
