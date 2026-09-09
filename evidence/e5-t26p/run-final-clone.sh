#!/usr/bin/env bash
# Sole exact-head local clone. Run only after final source/test/bundle freeze.
set -euo pipefail
expected=${1:?exact frozen commit required}
[[ "$expected" =~ ^[0-9a-f]{40}$ ]]
[ "$#" -eq 1 ]
repo=$(git rev-parse --show-toplevel)
[ "$(git rev-parse HEAD)" = "$expected" ]
git diff --quiet "$expected" -- Makefile Cargo.toml Cargo.lock crates
clone_dir=$(mktemp -d /private/tmp/e5-t26p-final.XXXXXXXX)
echo "E5-T26p exact head: $expected"
echo "E5-T26p retained clone: $clone_dir/repo"
git clone --no-local --no-checkout "$repo" "$clone_dir/repo"
git -C "$clone_dir/repo" checkout --detach "$expected"
[ "$(git -C "$clone_dir/repo" rev-parse HEAD)" = "$expected" ]
[ ! -e "$clone_dir/repo/.git/objects/info/alternates" ]
[ -z "$(git -C "$clone_dir/repo" status --porcelain)" ]
echo "Initial checkout clean; no object alternates; fresh local target directory."
unset_args=(-u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u MAKEFLAGS -u MFLAGS)
while IFS= read -r name; do
  case "$name" in CARGO_*|E5_*|WASM_BINDGEN_*|WASM_PACK_*) unset_args+=(-u "$name") ;; esac
done < <(env | cut -d= -f1)
trusted_path="${HOME}/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"
set +e
env "${unset_args[@]}" PATH="$trusted_path" bash --noprofile --norc -c \
  'cd "$1" && make verify-E5-T26p' e5-t26p-final "$clone_dir/repo"
result=$?
set -e
git -C "$clone_dir/repo" status --porcelain
[ -z "$(git -C "$clone_dir/repo" status --porcelain)" ]
echo "Final checkout clean; make exit=$result; retained=$clone_dir/repo"
exit "$result"
