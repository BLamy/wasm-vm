#!/usr/bin/env bash
# E1-T05: fail CI if any guest-reachable FP datapath source uses HOST float arithmetic.
#
# The primary enforcement is `#![deny(clippy::float_arithmetic)]` inside the softfloat
# module (a compile error on any +,-,*,/ over host f32/f64). This grep is the belt-and-
# braces backup: it scans the FP datapath file list for host-float method calls, casts to
# float, and float literals used arithmetically. As E1-T06/T07 add the F/D execute arms,
# add their files to FILES and the deny attribute to them.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${here}/../.." && pwd)"

# Guest-reachable FP datapath sources (NOT tests/benches — those may use host float as an
# independent oracle / for input generation).
FILES=(
  "crates/core/src/softfloat.rs"
)

# Host-float tells: math method calls on floats, casts to float, and float suffixed literals
# used outside string/doc context. `to_bits`/`from_bits` are ALLOWED (pure reinterpretation).
PATTERN='\.(sqrt|powi|powf|abs|floor|ceil|round|trunc|recip|mul_add|hypot)\(|\bas +f(32|64)\b|[0-9]\.[0-9]+f(32|64)\b'

fail=0
for f in "${FILES[@]}"; do
  path="${repo_root}/${f}"
  [ -f "${path}" ] || { echo "no-host-float: missing ${f}" >&2; exit 2; }
  # Assert the deny attribute is present (the real enforcement).
  if ! grep -q 'deny(clippy::float_arithmetic)' "${path}"; then
    echo "no-host-float: ${f} is missing #![deny(clippy::float_arithmetic)]" >&2
    fail=1
  fi
  # Strip line comments before grepping so doc/comment mentions don't trip the guard.
  if sed 's://.*$::' "${path}" | grep -nEq "${PATTERN}"; then
    echo "no-host-float: host float arithmetic found in ${f}:" >&2
    sed 's://.*$::' "${path}" | grep -nE "${PATTERN}" >&2 || true
    fail=1
  fi
done

if [ "${fail}" -ne 0 ]; then
  echo "no-host-float: FAILED — the guest FP datapath must use the softfloat backend only." >&2
  exit 1
fi
echo "no-host-float: OK — no host float arithmetic in the FP datapath."
