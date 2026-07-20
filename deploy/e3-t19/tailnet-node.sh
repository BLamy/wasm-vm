#!/bin/sh
set -eu
role=${NODE_ROLE:?NODE_ROLE is required}
until test -s "/run/wasm-vm-keys/$role.key"; do sleep 1; done
export TS_AUTHKEY="$(cat "/run/wasm-vm-keys/$role.key")"
rm -f "/run/wasm-vm-keys/$role.key"
exec /usr/local/bin/containerboot
