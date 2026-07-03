#!/usr/bin/env bash
# E0-T19 acceptance 4: the quarantined zicsr-stub must NOT leak into default builds.
# Builds wasm-vm-core with default features and asserts `nm` finds zero `zicsr` symbols,
# then confirms the feature build DOES contain them (so a false-negative nm can't pass).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"
cd "${repo_root}"

rlib() { ls -t target/release/libwasm_vm_core*.rlib | head -1; }

cargo build -p wasm-vm-core --release >/dev/null 2>&1
default_hits="$(nm "$(rlib)" 2>/dev/null | grep -ci zicsr || true)"
if [ "${default_hits}" -ne 0 ]; then
  echo "FAIL: ${default_hits} zicsr symbol(s) leaked into the DEFAULT build" >&2
  exit 1
fi

cargo build -p wasm-vm-core --release --features zicsr-stub >/dev/null 2>&1
feature_hits="$(nm "$(rlib)" 2>/dev/null | grep -ci zicsr || true)"
if [ "${feature_hits}" -eq 0 ]; then
  echo "FAIL: nm found no zicsr symbols even WITH the feature — the check is blind" >&2
  exit 1
fi

echo "quarantine OK: 0 zicsr symbols in default build, ${feature_hits} with --features zicsr-stub"
