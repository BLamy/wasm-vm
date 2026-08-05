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

# Is a hardware PMU exposed? A cloud VM like `ssh dev` typically has no `cpu` event source,
# so mainline rr can't count retired instructions — that's the rr-soft case, not a hard stop.
have_pmu=1
[[ -e /sys/bus/event_source/devices/cpu ]] || have_pmu=0

soft_hint() {
  echo "  No hardware PMU here (no /sys/bus/event_source/devices/cpu) — this looks like a" >&2
  echo "  cloud VM such as \`ssh dev\`. Use rr-soft (software instruction counters), which" >&2
  echo "  records/replays without a PMU. See tools/rr/README.md → 'rr-soft'." >&2
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Real round-trip: record /bin/true, then replay it non-interactively.
if ! rr record -o "$tmp/trace" -- /bin/true >/dev/null 2>&1; then
  if (( have_pmu == 0 )); then
    echo "mainline rr record failed and no hardware PMU is present:" >&2
    soft_hint
    fail "mainline rr unusable on this box — switch to rr-soft (see above)."
  fi
  fail "rr record failed despite a PMU being present — check perf access / container caps.
  See tools/rr/README.md platform table."
fi
rr replay -a "$tmp/trace" >/dev/null 2>&1 \
  || fail "recorded OK but replay failed — check rr version / CPU compatibility"

echo "preflight OK: rr $(rr --version 2>&1 | head -n1 | grep -o '[0-9][0-9.]*' | head -n1) record/replay round-trip works"
