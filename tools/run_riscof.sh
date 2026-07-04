#!/usr/bin/env bash
# E1-T20: run the RISCOF architectural-compliance flow (DUT = native wasm-vm; reference = Spike via
# the Docker toolchain image) and enforce compliance/EXCLUSIONS.md — every failing test MUST be
# listed there, else this exits nonzero. Requires `bash compliance/provision.sh` first (venv +
# arch-test). Generates compliance/config.ini (machine-absolute paths; gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
VENV="${RISCOF_VENV:-$REPO/compliance/.venv}"
SUITE="${RISCOF_SUITE:-riscv-arch-test/riscv-test-suite/rv64i_m}"
[ -x "$VENV/bin/riscof" ] || { echo "error: run 'bash compliance/provision.sh' first" >&2; exit 1; }

cargo build --release -p wasm-vm-cli
# Reference model: SAIL by default (E1-T26 — Sail honors hw_data_misaligned_support, so it can
# validate our misaligned support; Spike-1.1.1 hardcodes misaligned trapping). Override with
# RISCOF_REF=spike to use the Spike fallback.
REF="${RISCOF_REF:-sail}"
if [ "$REF" = "spike" ]; then
  REF_ISPEC="$REPO/compliance/spike/spike_simple_isa.yaml"
  REF_PSPEC="$REPO/compliance/spike/spike_simple_platform.yaml"
else
  REF_ISPEC="$REPO/compliance/sail/sail_isa.yaml"
  REF_PSPEC="$REPO/compliance/sail/sail_platform.yaml"
fi
cat > compliance/config.ini <<CFG
[RISCOF]
ReferencePlugin=$REF
ReferencePluginPath=$REPO/compliance/$REF
DUTPlugin=wasmvm
DUTPluginPath=$REPO/compliance/wasmvm

[wasmvm]
pluginpath=$REPO/compliance/wasmvm
ispec=$REPO/compliance/wasmvm/wasmvm_isa.yaml
pspec=$REPO/compliance/wasmvm/wasmvm_platform.yaml
target_run=1

[$REF]
pluginpath=$REPO/compliance/$REF
ispec=$REF_ISPEC
pspec=$REF_PSPEC
target_run=1
CFG

cd compliance
rm -rf riscof_work
"$VENV/bin/riscof" run --config=config.ini --suite="$SUITE" \
  --env=riscv-arch-test/riscv-test-suite/env --no-browser 2>&1 | tee /tmp/riscof_last.log || true

# Enforce EXCLUSIONS.md: any Failed test not listed is an UNEXCUSED failure → red.
fails="$(sed 's/\x1b\[[0-9;]*m//g' /tmp/riscof_last.log | grep ': Failed' | sed 's#.*/[a-z0-9_]*_m/##; s# : .*##' | sort -u || true)"
passed="$(sed 's/\x1b\[[0-9;]*m//g' /tmp/riscof_last.log | grep -c ': Passed' || true)"
unexcused=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! grep -qF "$f" EXCLUSIONS.md; then echo "UNEXCUSED FAILURE: $f" >&2; unexcused=$((unexcused+1)); fi
done <<< "$fails"
echo "RISCOF: ${passed} passed; $(echo "$fails" | grep -c . ) failed (all must be EXCLUSIONS-listed)."
[ "$unexcused" -eq 0 ] || { echo "error: $unexcused unexcused failure(s) — fix or add to EXCLUSIONS.md" >&2; exit 1; }
echo "RISCOF compliance: GREEN (report: compliance/riscof_work/report.html)"
