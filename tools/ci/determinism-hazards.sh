#!/usr/bin/env bash
# E1-T22: fail CI if any guest-reachable core source uses a native/wasm DIVERGENCE hazard.
#
# Determinism between the native and wasm32 builds (proven per-program by the determinism
# harness) rests on the core never using: nondeterministic-iteration containers (HashMap/HashSet),
# host wall-clock/time sources (only the T12 retire-count clock is legal), or randomness. This
# grep is the standing guard so a future edit can't silently reintroduce a divergence source. Host
# float is enforced separately by tools/ci/no-host-float.sh + the softfloat deny attribute.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"
cd "${repo_root}"

# Hazards banned in crates/core/src (guest-visible). BTreeMap/BTreeSet are fine (ordered).
patterns='HashMap|HashSet|std::time|SystemTime|Instant::|rand::|thread_rng|Date::now'

# grep -n prefixes `file:line:`; strip that + leading whitespace, then drop lines whose CODE
# starts with `//` (a comment mention like "No HashMap" is not a real use).
hits="$(grep -rnE "${patterns}" crates/core/src/ 2>/dev/null \
  | awk '{ code=$0; sub(/^[^:]*:[0-9]+:/, "", code); gsub(/^[ \t]+/, "", code); if (code !~ /^\/\//) print }' \
  || true)"

if [[ -n "${hits}" ]]; then
  echo "determinism-hazards: banned nondeterminism source(s) in crates/core/src:" >&2
  echo "${hits}" >&2
  echo "  (use BTreeMap for ordered maps; the only legal clock is the T12 retire-count CLINT)" >&2
  exit 1
fi
echo "determinism-hazards: crates/core/src is clean (no HashMap/HashSet/time/rand in code)."
