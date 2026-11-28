#!/bin/sh
# Verifier: the release CLI with a 30 s slirp lease, so udhcpc renews on its own at T1 (~15 s).
exec "$(dirname "$0")/../../../target/release/wasm-vm" "$@" --net-slirp-lease-secs 30
