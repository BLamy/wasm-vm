#!/usr/bin/env bash
# E0-T20 self-test: prove the differential harness actually DETECTS divergence (a harness
# that always says "match" is worthless) and pins the normalizer against a committed
# golden. Runs entirely from the committed guests + the T13 container.
#
#   1. Genuine full match on loops.elf, and the normalized Spike trace == the committed
#      golden (regression pin for both Spike and the normalizer).
#   2. On memops.elf (>100 instructions): a clean run reports the compared-line count
#      (asserted > 100), then a single corrupted normalized line is DETECTED at exactly
#      that line number.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

cargo build --release -p wasm-vm-cli >/dev/null 2>&1

# Normalize a guest under Spike into $2, our trace into $3.
spike_norm() { # <elf> <out-spike-norm> <out-ours>
  local elf="$1" outs="$2" outo="$3"
  local rel entry
  rel="$(python3 -c 'import os,sys;print(os.path.relpath(os.path.abspath(sys.argv[1]),sys.argv[2]))' "${elf}" "${repo_root}")"
  entry="$(python3 -c 'import struct,sys;f=open(sys.argv[1],"rb");f.seek(24);print(hex(struct.unpack("<Q",f.read(8))[0]))' "${elf}")"
  "${repo_root}/target/release/wasm-vm" run "${elf}" --trace "${outo}" >/dev/null 2>&1 || true
  "${repo_root}/tools/toolchain/run.sh" -- bash -c \
    "spike --isa=rv64i -m0x80000000:0x8000000 -l --log-commits '${rel}' 2>&1 >/dev/null" 2>/dev/null | \
    python3 "${here}/normalize_spike.py" --entry "${entry}" 2>/dev/null > "${outs}"
}

echo "[1/4] loops.elf genuine match + golden pin"
spike_norm "${repo_root}/guest/prebuilt/loops.elf" "${work}/loops.spike" "${work}/loops.ours"
python3 "${here}/report.py" "${work}/loops.ours" "${work}/loops.spike" --level commit >/dev/null
if ! cmp -s <(head -48 "${work}/loops.spike") "${repo_root}/tools/diff/golden/loops.spike.trace"; then
  echo "FAIL: normalized Spike loops trace drifted from the committed golden" >&2
  exit 1
fi
echo "  ok: loops matches Spike and the golden is unchanged"

echo "[2/4] memops.elf clean match reports > 100 compared lines"
spike_norm "${repo_root}/guest/prebuilt/memops.elf" "${work}/m.spike" "${work}/m.ours"
msg="$(python3 "${here}/report.py" "${work}/m.ours" "${work}/m.spike" --level commit)"
echo "  ${msg}"
count="$(printf '%s' "${msg}" | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
if [ "${count}" -le 100 ]; then
  echo "FAIL: expected > 100 compared lines, got ${count}" >&2
  exit 1
fi

echo "[3/4] a single corrupted line is detected at the exact instruction"
target_line=50
sed "${target_line}s/.*/core 0: 0xdeadbeefdeadbeef (0xdeadbeef)/" "${work}/m.spike" > "${work}/m.bad"
if python3 "${here}/report.py" "${work}/m.ours" "${work}/m.bad" --level commit >/dev/null 2>"${work}/err"; then
  echo "FAIL: harness did NOT detect the injected corruption" >&2
  exit 1
fi
if ! grep -q "DIVERGENCE at instruction ${target_line} " "${work}/err"; then
  echo "FAIL: corruption reported at the wrong line:" >&2
  head -1 "${work}/err" >&2
  exit 1
fi
echo "  ok: divergence detected at instruction ${target_line}"

echo "[4/4] a crash-truncated trace is NOT a false MATCH"
# rv64ui-p-add hits `csrr mhartid` early; our stubless release CLI traps (exit 101). The
# crash-truncated trace matches Spike's prefix, but the harness MUST report divergence
# (our emulator diverged by trapping where Spike executed), never MATCH. Regression pin
# for the E0-T20 verifier's decisive false-pass finding.
add_elf="${repo_root}/tests/riscv-tests-bin/rv64ui-p-add"
if [ -f "${add_elf}" ]; then
  if "${here}/run_diff.sh" "${add_elf}" --level commit >"${work}/add.out" 2>&1; then
    echo "FAIL: harness reported MATCH on a trap-crashed run:" >&2
    cat "${work}/add.out" >&2
    exit 1
  fi
  if ! grep -q "our emulator TRAPPED" "${work}/add.out"; then
    echo "FAIL: trap-truncated run not reported as a trap divergence:" >&2
    cat "${work}/add.out" >&2
    exit 1
  fi
  echo "  ok: trap-crashed run reported as divergence, not MATCH"
else
  echo "  skip: rv64ui-p-add not built (run tools/riscv-tests/build.sh)"
fi

echo "diff-selftest OK"
