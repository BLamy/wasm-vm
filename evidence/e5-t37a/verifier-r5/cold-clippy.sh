#!/usr/bin/env bash
# E5-T37a round-5 verifier — the clippy line in a cold clone, second attempt.
#
# cold-clone.sh's clippy step failed for a reason that is mine, not the tree's: my sparse set
# leaves out evidence/, and `--all-targets` builds crates/core/tests/virtio_keyboard_guest_stream.rs,
# which `include_str!`s a TRACKED fixture, evidence/e5-t11c/keyboard-evdev-serial.txt (commit
# ba49df308, long before this task). A full clone has that file. Here the sparse set adds that
# one file and nothing else, and the clippy line runs again under the same scrubbed environment.
#
#   bash evidence/e5-t37a/verifier-r5/cold-clippy.sh <head>
set -uo pipefail
REPO=/Users/blamy/Documents/Codex/wasm-vm
S=/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/358f3812-2a26-47fa-96c6-985caf0a6f11/scratchpad/verifier-r5
D=$S/cold-clippy
clean() { env -i HOME="$HOME" PATH="$PATH" TERM=dumb "$@"; }
rm -rf "$D"
git clone -q --no-checkout "$REPO" "$D" && cd "$D" || exit 9
git sparse-checkout init --no-cone
git sparse-checkout set '/*' '!/evidence/' '/evidence/perf-overhaul/oracle-baseline/' '/evidence/e5-t11c/keyboard-evdev-serial.txt' '!/web/dist/' '!/rr-traces/'
git checkout -q "$1"
echo "cold clone (sparse) at $(git rev-parse HEAD), tracked changes=$(git status --porcelain | wc -l | tr -d ' ')"
echo "what of evidence/ is checked out: $(find evidence -type f | sort | tr '\n' ' ')"
echo "env passed to every command: $(clean env | cut -d= -f1 | tr '\n' ' ')"
echo '$ cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings'
clean cargo clippy -p wasm-vm-core -p wasm-vm-cli --all-targets -- -D warnings 2>&1 | grep -E "^(warning|error)|Finished" | sort | uniq -c
echo "rc=${PIPESTATUS[0]}"
cd "$S" && rm -rf "$D" && echo "clone deleted: $([ -e "$D" ] && echo NO || echo yes)"
echo "COLD_CLIPPY_DONE"
