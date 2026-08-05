#!/bin/sh
set -eu
until test -s /run/wasm-vm-keys/relay.secret; do sleep 1; done
export WVRELAY_HMAC_SECRET="$(cat /run/wasm-vm-keys/relay.secret)"
exec /usr/local/bin/wvrelay 0.0.0.0:8080
