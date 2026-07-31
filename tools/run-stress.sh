#!/usr/bin/env bash
# E2-T24 stress-validation entry point. Runs the disk/process/interactivity battery
# (tests/stress/battery.exp) against the native Alpine boot N times from a PRISTINE image copy
# each run, captures a JSON summary, and checks reproducibility (identical PASS/FAIL set + a
# normalized-transcript diff) across runs. Exit 0 iff every run's battery passed AND the results
# were identical across runs.
#
# A single Alpine/OpenRC boot is ~5-7 min in the interpreter, so RUNS scales cost linearly:
#   RUNS=1  (default)  fast smoke / per-PR         ~10 min
#   RUNS=10            full reproducibility gate    ~1.5-2 h  (nightly)
#
# Env (all optional):
#   RUNS=1  DD_MB=8  WRITERS=2  FORKBOMB=0  BOOT_TO=900
#   OUT=<dir>   where to write summary.json + per-run transcripts  (default tests/stress/out)
#   KEEP=0      keep per-run image copies (debug)                  (default 0)
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

RUNS="${RUNS:-1}"; DD_MB="${DD_MB:-8}"; WRITERS="${WRITERS:-2}"; FORKBOMB="${FORKBOMB:-0}"; BOOT_TO="${BOOT_TO:-900}"
OUT="${OUT:-tests/stress/out}"; KEEP="${KEEP:-0}"
kernel="releases/kernel/6.6.63/Image"
pristine="releases/rootfs/alpine-rootfs.ext4"
bin="target/release/wasm-vm"

command -v expect >/dev/null || { echo "run-stress: 'expect' not found" >&2; exit 2; }
[ -f "$kernel" ] || { echo "run-stress: missing kernel $kernel" >&2; exit 2; }
[ -f "$pristine" ] || { echo "run-stress: missing rootfs $pristine — bash tools/build-rootfs.sh" >&2; exit 2; }
[ -x "$bin" ] || { echo "run-stress: building release wasm-vm…" >&2; cargo build --release -p wasm-vm-cli >&2 || exit 2; }

mkdir -p "$OUT"
# Normalize a transcript for reproducibility diffing. Strips everything that legitimately varies
# run-to-run WITHOUT reflecting guest-logic nondeterminism: kernel timestamps [   1.234567], the
# spawn line (per-run image path), hex addresses, interactivity latency (host wall-clock), CR,
# ANSI escapes + the ESC[6n cursor-position query, the goldfish RTC wall-clock line + the
# boot-time hwclock RTC-readiness race (a documented time/RTC source), and the shell job-control
# `[N]+ Done` background-completion notice (fires at a nondeterministic instant). What remains is
# the guest-visible OUTPUT, which is byte-identical across deterministic runs.
normalize() { sed -E '
  s/\r//g;
  s/\x1b\[[0-9;?]*[A-Za-z]//g;
  s/\[6n//g;
  s/\[[[:space:]]*[0-9]+\.[0-9]+\]//g;
  s/spawn .*//;
  s/0x[0-9a-fA-F]+/0xADDR/g;
  s/echo_latency_ms=[0-9]+/echo_latency_ms=N/g;
  s/goldfish_rtc.*//;
  s/.*etting system clock using the hardware clock.*//;
  s/.*hwclock: select.*//;
  s/.*Failed to set the system clock.*//;
  s/\[ *!! *\]//g;
  s/\[[0-9]+\]\+[[:space:]]+Done[[:space:]]+dd if=\/dev\/(zero|urandom)[^;]*//g;
  '; }
# The kernel/boot log (dmesg) = everything up to the login prompt. Reproducibility of the BOOT is
# what E2-T24 criterion 4 pins ("normalized dmesg identical"); the post-login interactive section
# is a pty echo stream whose character-wrapping/interleaving is a terminal-rendering artifact, not
# guest nondeterminism — so it is NOT part of the determinism gate.
dmesg_slice() { normalize | sed -n '1,/wasm-vm login:/p' | grep -vE '^[[:space:]]*$'; }

declare -a run_pass run_results
overall=0
for i in $(seq 1 "$RUNS"); do
  img="$OUT/run${i}.ext4"; log="$OUT/run${i}.log"
  cp "$pristine" "$img"
  echo "=== stress run $i/$RUNS (dd=${DD_MB}MiB writers=$WRITERS forkbomb=$FORKBOMB) ===" >&2
  STRESS_IMG="$img" STRESS_KERNEL="$kernel" STRESS_BIN="$bin" \
  STRESS_DD_MB="$DD_MB" STRESS_WRITERS="$WRITERS" STRESS_FORKBOMB="$FORKBOMB" STRESS_BOOT_TO="$BOOT_TO" \
    expect tests/stress/battery.exp >"$log" 2>&1
  rc=$?
  [ "$KEEP" = 1 ] || rm -f "$img"
  # Extract the sorted result set (RESULT <name> <PASS|FAIL|SKIP>), un-anchored because expect's
  # puts can interleave a RESULT line onto the tail of a guest prompt. Latency detail dropped.
  results="$(grep -oE 'RESULT [a-z0-9_]+ (PASS|FAIL|SKIP)' "$log" | sort -u | tr '\n' ';')"
  run_results[$i]="$results"
  if [ "$rc" -eq 0 ]; then run_pass[$i]=1; else run_pass[$i]=0; overall=1; fi
  # Save a normalized transcript (full) + the boot/dmesg slice for the cross-run diff.
  normalize <"$log" >"$OUT/run${i}.norm"
  dmesg_slice <"$log" >"$OUT/run${i}.dmesg"
  echo "run $i: rc=$rc results=[$results]" >&2
done

# Reproducibility: every run's RESULT set must match run 1's, and the normalized boot/dmesg log
# must be byte-identical (the meaningful boot-determinism invariant; the interactive pty echo is
# a rendering artifact and is deliberately excluded — see dmesg_slice).
repro=1
for i in $(seq 2 "$RUNS"); do
  [ "${run_results[$i]}" = "${run_results[1]}" ] || { repro=0; echo "run $i RESULT set differs from run 1" >&2; }
  if ! diff -q "$OUT/run1.dmesg" "$OUT/run${i}.dmesg" >/dev/null; then
    repro=0; echo "run $i normalized dmesg differs from run 1 (see $OUT/run${i}.dmesg)" >&2
  fi
done
[ "$RUNS" -gt 1 ] && [ "$repro" -ne 1 ] && overall=1

# JSON summary.
{
  echo "{"
  echo "  \"runs\": $RUNS, \"dd_mb\": $DD_MB, \"writers\": $WRITERS, \"forkbomb\": $FORKBOMB,"
  echo "  \"all_runs_passed\": $([ "$overall" -eq 0 ] && echo true || echo false),"
  echo "  \"reproducible\": $([ "$RUNS" -gt 1 ] && { [ "$repro" -eq 1 ] && echo true || echo false; } || echo null),"
  echo -n "  \"per_run\": ["
  for i in $(seq 1 "$RUNS"); do
    lat="$(grep -oE 'echo_latency_ms=[0-9]+' "$OUT/run${i}.log" | head -1 | cut -d= -f2)"
    [ "$i" -gt 1 ] && echo -n ","
    echo -n "{\"run\":$i,\"passed\":$([ "${run_pass[$i]}" = 1 ] && echo true || echo false),\"echo_latency_ms\":${lat:-null}}"
  done
  echo "]"
  echo "}"
} | tee "$OUT/summary.json"

echo "run-stress: overall $([ "$overall" -eq 0 ] && echo PASS || echo FAIL) (summary: $OUT/summary.json)" >&2
exit "$overall"
