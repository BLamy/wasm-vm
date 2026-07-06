#!/usr/bin/env bash
# E2-T24 "kill mid-write" gate. For each of KILLS iterations: boot Alpine from a WORKING copy of
# the image, log in, start a heavy parallel write load, SIGKILL the emulator at a random point
# DURING the writes (so the ext4 journal is mid-transaction), then reboot the SAME dirty image and
# require that it recovers — reaches login again and the kernel logs a clean ext4 journal recovery
# with no fs errors. Any image that fails to recover refutes crash-consistency.
#
# Env: KILLS=5  KILL_MIN=8  KILL_MAX=40  BOOT_TO=900  SEED=<int>  OUT=tests/stress/out
# Deterministic kill points: pass SEED to reproduce the exact delays (awk-seeded PRNG).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$here"
KILLS="${KILLS:-5}"; KILL_MIN="${KILL_MIN:-8}"; KILL_MAX="${KILL_MAX:-40}"; BOOT_TO="${BOOT_TO:-900}"
SEED="${SEED:-1}"; OUT="${OUT:-tests/stress/out}"
kernel="releases/kernel/6.6.63/Image"; pristine="releases/rootfs/alpine-rootfs.ext4"; bin="target/release/wasm-vm"
command -v expect >/dev/null || { echo "kill-inject: 'expect' not found" >&2; exit 2; }
[ -f "$pristine" ] && [ -x "$bin" ] || { echo "kill-inject: need $pristine and $bin (release build + rootfs)" >&2; exit 2; }
mkdir -p "$OUT"

# Deterministic per-iteration kill delay in [KILL_MIN, KILL_MAX] from SEED (reproducible).
delay_for() { awk -v s="$SEED" -v i="$1" -v lo="$KILL_MIN" -v hi="$KILL_MAX" \
  'BEGIN{srand(s+i); printf "%d", lo + int(rand()*(hi-lo+1))}'; }

fails=0
for k in $(seq 1 "$KILLS"); do
  img="$OUT/kill${k}.ext4"; cp "$pristine" "$img"
  d="$(delay_for "$k")"
  echo "=== kill iteration $k/$KILLS: SIGKILL at ${d}s into the write load (seed $SEED) ===" >&2

  # Phase 1: boot, login, start a sustained parallel write load, then SIGKILL the emulator after
  # $d seconds of writing. expect's exp_pid is the spawned emulator's PID.
  STRESS_D="$d" STRESS_IMG="$img" STRESS_KERNEL="$kernel" STRESS_BIN="$bin" STRESS_BOOT_TO="$BOOT_TO" \
  expect >"$OUT/kill${k}.phase1.log" 2>&1 <<'EXP'
    proc ge {n d} { global env; return [expr {[info exists env($n)]?$env($n):$d}] }
    set timeout [ge STRESS_BOOT_TO 900]
    spawn [ge STRESS_BIN ""] boot --kernel [ge STRESS_KERNEL ""] --drive file=[ge STRESS_IMG ""] \
      --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" --max-instrs 40000000000
    set pid [exp_pid]
    expect { -timeout [ge STRESS_BOOT_TO 900] "login:" {} timeout { exit 3 } }
    send "root\r"; sleep 3; send "\r"; sleep 2
    # Echo-proof (sweep-critic E2-T24 BUG 5, the F1 class): the token must be computed by the
    # shell so the tty echo of the command can never satisfy the expect.
    send "echo LI_\$((6*7))\r"; expect { -timeout 90 "LI_42" {} timeout { exit 4 } }
    # Sustained writers churning the journal; run detached so the shell returns immediately.
    send "for i in 1 2 3 4; do (while :; do dd if=/dev/zero of=/root/w\$i bs=1M count=8 conv=fsync 2>/dev/null; done) & done; echo WRIT_\$((6*7))\r"
    expect { -timeout 60 "WRIT_42" {} timeout { exit 5 } }
    # Let the writes run, then SIGKILL mid-transaction.
    sleep [ge STRESS_D 20]
    exec kill -9 $pid
    exit 0
EXP
  rc1=$?
  if [ "$rc1" -ne 0 ]; then echo "kill $k: phase1 failed rc=$rc1 (did not reach write load)" >&2; fails=$((fails+1)); rm -f "$img"; continue; fi

  # Phase 2: reboot the SAME dirty image; require recovery to login + a clean ext4 journal replay.
  STRESS_IMG="$img" STRESS_KERNEL="$kernel" STRESS_BIN="$bin" STRESS_BOOT_TO="$BOOT_TO" \
  expect >"$OUT/kill${k}.phase2.log" 2>&1 <<'EXP'
    proc ge {n d} { global env; return [expr {[info exists env($n)]?$env($n):$d}] }
    set timeout [ge STRESS_BOOT_TO 900]
    spawn [ge STRESS_BIN ""] boot --kernel [ge STRESS_KERNEL ""] --drive file=[ge STRESS_IMG ""] \
      --append "root=/dev/vda rw console=ttyS0 earlycon=sbi" --max-instrs 40000000000
    expect { -timeout [ge STRESS_BOOT_TO 900] "login:" {} timeout { puts "RECOVER_FAIL no-login"; exit 3 } }
    send "root\r"; sleep 3; send "\r"; sleep 2
    # Output-only tokens (echo $((6*7))=42), so the host-side greps below match SHELL OUTPUT, not
    # the echoed command text — that self-poisoning always-red bug is what critic C2 caught.
    send "echo REC\$((6*7))\r"; expect { -timeout 90 "REC42" {} timeout { puts "RECOVER_FAIL no-shell"; exit 4 } }
    # Decide FS health IN-GUEST → an output-only verdict token. FSOK42 = clean journal replay;
    # FSBAD = ext4/JBD2 errors or a read-only remount in the ring buffer.
    send "if dmesg | grep -qiE 'ext4.*error|remount.*read-only|JBD2.*Error'; then echo FSBAD; else echo FSOK\$((6*7)); fi\r"
    expect { -timeout 90 "FSOK42" {} "FSBAD" {} timeout {} }
    send "mount | grep ' / '; echo MNT\$((6*7))\r"; expect { -timeout 60 "MNT42" {} timeout {} }
    send "poweroff\r"; expect { -timeout [ge STRESS_BOOT_TO 900] eof {} timeout {} }
EXP
  rc2=$?
  p2="$OUT/kill${k}.phase2.log"
  # Recovered iff: reached shell (REC42), the guest's own FS verdict was clean (FSOK42, not FSBAD),
  # and / is still mounted rw ext4 (a string that appears only in `mount` OUTPUT). All four greps
  # target OUTPUT-ONLY tokens, so none can match an echoed command (critic C2 fix).
  if [ "$rc2" -eq 0 ] && grep -q "REC42" "$p2" \
     && grep -q "FSOK42" "$p2" && ! grep -q "FSBAD" "$p2" \
     && grep -qE "on / type ext4 \(rw" "$p2"; then
    echo "kill $k: RECOVERED (clean journal replay, / rw ext4)" >&2
  else
    echo "kill $k: RECOVERY FAILED (rc2=$rc2) — see $p2" >&2; fails=$((fails+1))
  fi
  rm -f "$img"
done

echo "kill-inject: $((KILLS-fails))/$KILLS recovered" >&2
[ "$fails" -eq 0 ] || exit 1
