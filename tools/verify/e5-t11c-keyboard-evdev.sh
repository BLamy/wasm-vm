#!/usr/bin/env bash
# E5-T11c: native guest-side evdev proof for the concrete virtio keyboard.
#
# The guest runs only the stock Alpine serial shell. dd+od is the deterministic fallback for
# evtest in the intentionally lean rootfs: it reads one complete /dev/input/event0 record per
# syscall and keeps the proof independent of a host-side input parser. The CLI's --keyboard-proof hook waits
# for the echo-proof marker after the guest has opened the event device, then injects KEY_A down /
# up. The normalized serial result is compared with the checked-in fixture.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="${WASM_VM_CLI:-$repo_root/target/release/wasm-vm}"
kernel="${WASM_VM_KERNEL:-$repo_root/releases/kernel/6.6.63/Image}"
rootfs="${WASM_VM_ROOTFS:-$repo_root/releases/rootfs/alpine-rootfs.ext4}"
fixture="$repo_root/evidence/e5-t11c/keyboard-evdev-serial.txt"

for required in "$cli" "$kernel" "$rootfs" "$fixture"; do
  [ -e "$required" ] || {
    echo "e5-t11c: missing $required" >&2
    exit 2
  }
done

work="$(mktemp -d "${TMPDIR:-/tmp}/wasm-vm-e5-t11c.XXXXXX")"
disk="$work/alpine.ext4"
capture="$work/serial.txt"
bytes="$work/bytes.txt"
normalized="$work/normalized.txt"
trap 'rm -rf "$work"' EXIT
cp -p "$rootfs" "$disk"

CAPTURE="$capture" CLI="$cli" KERNEL="$kernel" DISK="$disk" expect <<'EXPECT'
set timeout 900
log_file -noappend $env(CAPTURE)
spawn -noecho $env(CLI) boot --kernel $env(KERNEL) --drive file=$env(DISK) --append {root=/dev/vda rw console=ttyS0 earlycon=sbi} --max-instrs 60000000000 --keyboard-proof
expect {
    -re {login:} {}
    timeout { puts stderr "e5-t11c: guest did not reach login"; exit 1 }
}
send -- "root\r"
after 3000
send -- "\r"
send -- "echo WASMVM_LOGIN_\"OK\"\r"
expect {
    -re {WASMVM_LOGIN_OK} {}
    timeout { puts stderr "e5-t11c: guest shell did not become ready"; exit 1 }
}

# Capture the kernel's actual evdev capability summary. Quotes keep the sent command from
# containing the output-only sentinel that the expect gate waits for.
send -- "cat /proc/bus/input/devices; echo T11C_MAP_\"OK\"\r"
expect {
    -re {T11C_MAP_OK} {}
    timeout { puts stderr "e5-t11c: input-device map command did not finish"; exit 1 }
}

# The marker is split by shell quotes in the echoed input, but printf joins it in guest output.
# Open the event device before printing the marker; the CLI hook then injects two complete frames
# while the same descriptor remains open, so probe-time events cannot be consumed before evdev read.
set proof {exec 3</dev/input/event0; printf 'WVM_KB_'"INJECT"; printf 'T11C_BYTES_'"BEGIN\n"; for i in 1 2 3 4; do dd bs=24 count=1 <&3 2>/dev/null; done | od -An -tu1; printf 'T11C_BYTES_'"END\n"; echo T11C_STREAM_"OK"}
send -- "$proof\r"
expect {
    -re {T11C_STREAM_OK} {}
    timeout { puts stderr "e5-t11c: guest event stream did not finish"; exit 1 }
}
send -- "poweroff\r"
expect eof
EXPECT

grep -Eq 'B: EV=20013' "$capture"
grep -Eq 'B: LED=7' "$capture"
grep -Eq 'B: MSC=10' "$capture"
if grep -Eq 'B: EV=120013' "$capture"; then
  echo "e5-t11c: guest advertised EV_REP even though the keyboard spec omits it" >&2
  exit 1
fi

# A 64-bit Linux input_event is 24 bytes: timeval (16) followed by type/code/value (8). Read one
# complete record per dd invocation; this avoids asking the lean Alpine od implementation to issue
# a multi-record read against the character device. Select the trailing fields from four records.
awk '
  /T11C_BYTES_BEGIN/ { capture=1; next }
  /T11C_BYTES_END/ { capture=0 }
  capture {
    gsub(/\r/, "")
    for (i = 1; i <= NF; i++) if ($i ~ /^[0-9]+$/) print $i
  }
' "$capture" > "$bytes"
[ "$(wc -l < "$bytes" | tr -d ' ')" -eq 96 ] || {
  echo "e5-t11c: expected 96 evdev bytes" >&2
  exit 1
}
observed="$(awk '
  NR >= 17 && NR <= 24 || NR >= 41 && NR <= 48 || NR >= 65 && NR <= 72 || NR >= 89 && NR <= 96 {
    if (seen++) printf " "; printf "%s", $0
  }
  END { print "" }
' "$bytes")"
expected='1 0 30 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0 30 0 0 0 0 0 0 0 0 0 0 0 0 0'
[ "$observed" = "$expected" ] || {
  echo "e5-t11c: unexpected event bytes: $observed" >&2
  exit 1
}

{
  echo 'keyboard-evdev-proof-v1'
  echo 'device=/dev/input/event0'
  echo 'B: EV=20013'
  echo 'B: LED=7'
  echo 'B: MSC=10'
  echo 'EV_REP=absent'
  echo 'EV_KEY KEY_A 1'
  echo 'EV_SYN SYN_REPORT 0'
  echo 'EV_KEY KEY_A 0'
  echo 'EV_SYN SYN_REPORT 0'
  echo 'HOLD KEY_A_DOWN events=1 repeat=0'
} > "$normalized"
diff -u "$fixture" "$normalized"
echo "e5-t11c: keyboard evdev guest proof passed"
