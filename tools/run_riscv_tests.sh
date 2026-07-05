#!/usr/bin/env bash
# E1-T19: run the full riscv-tests regression wall natively and surface the report.
#
# Runs every vendored official test ELF under the real (E1) CSR file, writes
# target/riscv-tests-report.{md,json}, and enforces the reviewed allowlist
# (tests/riscv-tests-allowlist.txt). Exit code is the cargo test exit code — a non-allowlisted
# failure (or a stale allowlist entry) makes this red. No Docker, no network: hermetic over the
# committed ELFs.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== riscv-tests regression wall (native, real CSR file) =="
cargo test -p wasm-vm-core --test riscv_tests_suite -- --nocapture

report="target/riscv-tests-report.md"
if [[ -f "$report" ]]; then
  echo
  echo "== report: $report =="
  sed -n '1,6p' "$report"
  echo "(full per-test table in $report and target/riscv-tests-report.json)"
fi
