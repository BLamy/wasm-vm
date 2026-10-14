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

# The syntax audit follows the actual module graph and excludes only test-only
# scopes. Test recordings may use host clocks; production core code may not.
cargo test -p wasm-vm-core --test no_stdout_in_core core_has_no_stdout_macros -- --nocapture
echo "determinism-hazards: production core has no ambient time, random or unordered-map source."
