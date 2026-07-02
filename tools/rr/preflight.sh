#!/usr/bin/env bash
# Can this machine record and replay rr traces? Exits 0 only if a real record/replay
# round-trip works. Run this before trusting any rr-based verification step.
set -euo pipefail

fail() { echo "preflight FAILED: $*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || fail "rr requires Linux; this is $(uname -s).
  On macOS, use guest-layer evidence (see AGENTS.md) and record rr traces in CI
  or on a Linux box. Docker Desktop / VMs on Apple Silicon will NOT work (no PMU)."

command -v rr >/dev/null 2>&1 || fail "rr not installed (apt/dnf install rr, or
  https://github.com/rr-debugger/rr/releases)"

paranoid=$(cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null || echo 99)
if (( paranoid > 1 )); then
  echo "warning: perf_event_paranoid=${paranoid} (want <= 1):" >&2
  echo "  echo 1 | sudo tee /proc/sys/kernel/perf_event_paranoid" >&2
  echo "continuing — rr may still work with -n or CAP_PERFMON" >&2
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Real round-trip: record /bin/true, then replay it non-interactively.
rr record -o "$tmp/trace" -- /bin/true >/dev/null 2>&1 \
  || fail "rr record failed — most likely no usable PMU (cloud VM without vPMU,
  or a container without perf access). See tools/rr/README.md platform table."
rr replay -a "$tmp/trace" >/dev/null 2>&1 \
  || fail "recorded OK but replay failed — check rr version / CPU compatibility"

echo "preflight OK: rr $(rr --version 2>&1 | head -n1 | grep -o '[0-9][0-9.]*' | head -n1) record/replay round-trip works"
