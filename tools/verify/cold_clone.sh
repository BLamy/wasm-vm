#!/usr/bin/env bash
# E0-T25: run a verify target from a PRISTINE clone of HEAD, in a scratch directory, with
# a scrubbed environment — eliminating "works on the implementer's machine".
#
#   tools/verify/cold_clone.sh [--keep] <make-target>
#
# - Clones the COMMITTED HEAD (never the dirty working tree) into `mktemp -d`.
# - Scrubs the environment: unsets RUSTFLAGS / RUSTDOCFLAGS / RUST_LOG and every CARGO_*,
#   and PREPENDS the trusted toolchain dirs (~/.cargo/bin + core system bins) to PATH so a
#   caller-poisoned shim (e.g. a fake `cargo` prepended to PATH) is OUTRANKED by the real
#   tools — while the rest of PATH is kept so legitimate tools further down (a container
#   runtime for the Spike differential, etc.) still resolve. A targeted scrub, not `env -i`.
# - `bash --noprofile --norc` so the user's shell profile can't re-inject those vars.
set -euo pipefail

keep=0
if [ "${1:-}" = "--keep" ]; then keep=1; shift; fi
target="${1:?usage: cold_clone.sh [--keep] <make-target>}"

repo_root="$(git rev-parse --show-toplevel)"
sha="$(git -C "${repo_root}" rev-parse HEAD)"
dir="$(mktemp -d)"
cleanup() { [ "${keep}" -eq 1 ] || rm -rf "${dir}"; }
trap cleanup EXIT

echo "cold_clone: cloning HEAD ${sha} → ${dir}"
git clone --quiet "${repo_root}" "${dir}/repo"
git -C "${dir}/repo" checkout --quiet "${sha}"

# Trusted toolchain dirs prepended so a poisoned shim in the caller's PATH loses.
trusted="${HOME}/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
clean_path="${trusted}:${PATH}"
# Every CARGO_* currently in the environment, plus the fixed rust vars, are unset.
unset_args=(-u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG)
while IFS= read -r v; do unset_args+=(-u "$v"); done < <(env | sed -n 's/^\(CARGO_[A-Za-z0-9_]*\)=.*/\1/p')

echo "cold_clone: make ${target} (scrubbed RUSTFLAGS/CARGO_*/RUST_LOG, trusted PATH prepended)"
set +e
env "${unset_args[@]}" \
  PATH="${clean_path}" \
  bash --noprofile --norc -c "cd '${dir}/repo' && make ${target}"
rc=$?
set -e

if [ "${keep}" -eq 1 ]; then echo "cold_clone: kept ${dir}"; fi
if [ "${rc}" -eq 0 ]; then
  echo "cold_clone: ${target} PASSED from a pristine clone"
else
  echo "cold_clone: ${target} FAILED (exit ${rc})" >&2
fi
exit "${rc}"
