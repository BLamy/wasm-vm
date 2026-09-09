#!/usr/bin/env bash
# E0-T25: run a verify target from a PRISTINE clone of HEAD, in a scratch directory, with
# a scrubbed environment — eliminating "works on the implementer's machine".
#
#   tools/verify/cold_clone.sh [--keep] [--parent DIR] <make-target>
#
# - Clones the COMMITTED HEAD (never the dirty working tree) into `mktemp -d`.
# - --parent selects an existing Docker-shared scratch parent when the system
#   temporary directory is not mounted into the local container runtime.
# - Scrubs the environment: unsets RUSTFLAGS / RUSTDOCFLAGS / RUST_LOG and every CARGO_*,
#   and PREPENDS the trusted toolchain dirs (~/.cargo/bin + core system bins) to PATH so a
#   caller-poisoned shim (e.g. a fake `cargo` prepended to PATH) is OUTRANKED by the real
#   tools — while the rest of PATH is kept so legitimate tools further down (a container
#   runtime for the Spike differential, etc.) still resolve. A targeted scrub, not `env -i`.
# - `bash --noprofile --norc` so the user's shell profile can't re-inject those vars.
set -euo pipefail

keep=0
clone_parent=""
target=""
usage() {
  echo "usage: cold_clone.sh [--keep] [--parent DIR] <make-target>" >&2
  exit 2
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --keep) keep=1; shift ;;
    --parent)
      [ "$#" -ge 2 ] && [ -n "$2" ] || usage
      clone_parent="$2"; shift 2 ;;
    -*) usage ;;
    *) [ -z "$target" ] || usage; target="$1"; shift ;;
  esac
done
# One literal make target, never shell code, a make assignment, or extra flags.
[[ "$target" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || usage
if [ -n "$clone_parent" ]; then
  [ -d "$clone_parent" ] || { echo "cold_clone: parent is not an existing directory: $clone_parent" >&2; exit 2; }
  clone_parent="$(cd "$clone_parent" && pwd -P)"
fi

repo_root="$(git rev-parse --show-toplevel)"
sha="$(git -C "${repo_root}" rev-parse HEAD)"
if [ -n "$clone_parent" ]; then
  dir="$(mktemp -d "$clone_parent/wasm-vm-cold.XXXXXXXX")"
else
  dir="$(mktemp -d)"
fi
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
  bash --noprofile --norc -c 'cd "$1" && make "$2"' cold-clone "${dir}/repo" "${target}"
rc=$?
set -e

if [ "${keep}" -eq 1 ]; then echo "cold_clone: kept ${dir}"; fi
if [ "${rc}" -eq 0 ]; then
  echo "cold_clone: ${target} PASSED from a pristine clone"
else
  echo "cold_clone: ${target} FAILED (exit ${rc})" >&2
fi
exit "${rc}"
