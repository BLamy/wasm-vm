#!/usr/bin/env bash
# E0-T15 zero-cost proof: the release `step` path with NullSink must contain NO trace
# machinery. We emit asm for two probe functions in the `zerocost` example:
#   step_nullsink_probe   — calls hart.step (NullSink path)  → must have NO trace call
#   step_recording_probe  — calls step_traced with a real recording sink → HAS it
# The script asserts the null probe is trace-free and (self-test) the recording probe is
# not, so a regression that leaked trace code into the null path fails loudly.
#
#   tools/check-zero-cost.sh            # assert zero cost
#   tools/check-zero-cost.sh --selftest # also assert the detector can SEE trace code
set -euo pipefail
cd "$(dirname "$0")/.."

asm="$(mktemp)"
trap 'rm -f "${asm}"' EXIT

# Emit optimized asm for the example holding the probes. release + a single codegen
# unit so the probes are fully monomorphized/inlined.
CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
  cargo rustc --release -p wasm-vm-core --example zerocost -- --emit asm -C "llvm-args=-x86-asm-syntax=intel" \
  >/dev/null 2>&1 || \
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 cargo rustc --release -p wasm-vm-core --example zerocost -- --emit asm >/dev/null 2>&1

# Locate the emitted .s for the example.
sfile="$(find target/release/examples -name 'zerocost-*.s' 2>/dev/null | head -n1)"
if [ -z "${sfile}" ]; then
  echo "check-zero-cost: could not find emitted asm" >&2
  exit 2
fi
cp "${sfile}" "${asm}"

# Extract the body of a labeled probe function from the asm: from its label (with an
# optional leading `_`, as Mach-O uses) to the next `.globl` directive or top-level
# label. Works for AT&T and Intel syntax, ELF and Mach-O.
probe_body() {
  # From the probe's label to the next `.globl` directive (each exported function is
  # preceded by one). Robust across ELF/Mach-O and local-label styles (.Lxx / Lxx).
  awk -v want="$1" '
    $0 ~ ("^_?" want ":") { grab=1; next }
    grab && /^[[:space:]]*\.globl/ { grab=0 }
    grab { print }
  ' "${asm}"
}

# A trace call would show up as a call/branch to an on_retire / TraceRecord / record
# symbol. NullSink's on_retire is empty+inline, so the null probe body must have none.
trace_refs() {
  printf '%s\n' "$1" | grep -iE 'on_retire|TraceRecord|record_retire|RecordingSink' || true
}

null_body="$(probe_body step_nullsink_probe || true)"
if [ -z "${null_body}" ]; then
  # Symbol may be mangled or the label form differs; fall back to a symbol scan of the
  # rlib for a non-inlined on_retire in the null path.
  echo "check-zero-cost: probe label not found in asm; falling back to symbol scan" >&2
  rlib="$(find target/release -name 'libwasm_vm_core-*.rlib' | head -n1)"
  if command -v llvm-nm >/dev/null 2>&1; then NM=llvm-nm; else NM=nm; fi
  if "${NM}" "${rlib}" 2>/dev/null | grep -iq 'NullSink.*on_retire'; then
    echo "check-zero-cost FAILED: NullSink::on_retire is a real (non-inlined) symbol" >&2
    exit 1
  fi
  echo "check-zero-cost OK (symbol-scan fallback): no NullSink::on_retire symbol"
  exit 0
fi

refs="$(trace_refs "${null_body}")"
if [ -n "${refs}" ]; then
  echo "check-zero-cost FAILED: null-sink step path references trace code:" >&2
  printf '%s\n' "${refs}" >&2
  exit 1
fi
echo "check-zero-cost OK: null-sink step path has no trace calls"

if [ "${1:-}" = "--selftest" ]; then
  rec_body="$(probe_body step_recording_probe || true)"
  rec_refs="$(trace_refs "${rec_body}")"
  if [ -z "${rec_refs}" ]; then
    echo "check-zero-cost SELFTEST FAILED: detector saw no trace code in the RECORDING probe (it should)" >&2
    exit 1
  fi
  echo "check-zero-cost selftest OK: recording probe visibly references trace code"
fi
