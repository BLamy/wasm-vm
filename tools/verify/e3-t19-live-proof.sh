#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ "${E3_T19_KEEP:-0}" == "1" ]]; then return; fi
  docker compose --profile relay down --volumes --remove-orphans >/dev/null
}
trap cleanup EXIT

docker compose up -d --wait
auth_key="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 cat /keys/browser.key)"
test -n "$auth_key"
docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys alpine:3.23 rm -f /keys/browser.key
peer_ip=""
for _ in $(seq 1 30); do
  peer_ip="$(docker compose exec -T fixture tailscale ip -4 2>/dev/null || true)"
  if [[ -n "$peer_ip" ]]; then break; fi
  sleep 1
done
test -n "$peer_ip"

E3_T17_CONTROL_URL=http://localhost:8123 \
E3_T17_AUTH_KEY="$auth_key" \
E3_T17_HOSTNAME=wasm-vm-browser-compose \
E3_T17_PEER_IP="$peer_ip" \
E3_T17_PEER_NAME=fixture.wasm-vm.test \
E3_T17_PEER_PORT=5678 \
  bash -c 'cd web && npx playwright test tests/e3-t17-headscale-worker.spec.js --reporter=line'

denied_key="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 cat /keys/denied.key)"
test -n "$denied_key"
docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys alpine:3.23 rm -f /keys/denied.key
E3_T17_CONTROL_URL=http://localhost:8123 \
E3_T17_AUTH_KEY="$denied_key" \
E3_T17_HOSTNAME=wasm-vm-denied-compose \
E3_T17_PEER_IP="$peer_ip" \
E3_T17_PEER_PORT=5678 \
E3_T17_EXPECT_PEER_FAIL=1 \
  bash -c 'cd web && npx playwright test tests/e3-t17-headscale-worker.spec.js --reporter=line'

# The fixture and exit keys must have been consumed, while reusable credential material never
# enters the checkout. Teardown in the EXIT trap destroys the remaining one-time browser key,
# denied-browser key, Headscale database, node states, and relay secret.
remaining="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 \
  sh -c 'find /keys -maxdepth 1 -type f -exec basename {} \; | sort')"
test "$remaining" = $'ready\nrelay.secret'
echo "E3-T19 live lifecycle proof: OK (restore, allowed/denied ACLs, logout, consumed keys)"
