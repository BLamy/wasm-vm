#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [[ "${E3_T19_KEEP:-0}" == "1" ]]; then return; fi
  docker compose --profile relay down --volumes --remove-orphans >/dev/null
}
trap cleanup EXIT

if [[ ! -f web/artifacts-alpine.json || ! -f releases/chunked-alpine/manifest.json ]]; then
  SKIP_BOOT_PROFILE=1 bash tools/build_image/build.sh
fi

docker compose --profile relay up -d --build --wait
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
exit_id="$(docker compose exec -T headscale headscale -c /etc/headscale/config.yaml \
  nodes list -o json | python3 -c \
  'import json,sys; print(next(str(node["id"]) for node in json.load(sys.stdin) if node["name"] == "exit"))')"
test -n "$exit_id"

E3_T17_CONTROL_URL=http://localhost:8123 \
E3_T17_AUTH_KEY="$auth_key" \
E3_T17_HOSTNAME=wasm-vm-browser-compose \
E3_T17_PEER_IP="$peer_ip" \
E3_T17_PEER_NAME=fixture.wasm-vm.test \
E3_T17_PEER_PORT=5678 \
E3_T17_EXIT_NODE_ID="$exit_id" \
E3_T17_PUBLIC_HOST=1.1.1.1 \
E3_T17_PUBLIC_PORT=80 \
E3_T17_CLEAR_EXIT_AFTER_RESTORE=1 \
  bash -c 'cd web && npx playwright test tests/e3-t17-headscale-worker.spec.js --reporter=line'

guest_exit_key="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 cat /keys/guest-exit.key)"
test -n "$guest_exit_key"
docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys alpine:3.23 rm -f /keys/guest-exit.key
E3_T19_GUEST_PROVIDER=tailscale \
E3_T19_CONTROL_URL=http://localhost:8123 \
E3_T19_AUTH_KEY="$guest_exit_key" \
E3_T19_EXIT_NODE_ID="$exit_id" \
E3_T19_PUBLIC_URL=https://1.1.1.1/ \
  bash -c 'cd web && npx playwright test tests/e3-t19-guest-https.spec.js --reporter=line'

revoked_key="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 cat /keys/revoked.key)"
test -n "$revoked_key"
docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys alpine:3.23 rm -f /keys/revoked.key
E3_T17_CONTROL_URL=http://localhost:8123 \
E3_T17_AUTH_KEY="$revoked_key" \
E3_T17_HOSTNAME=wasm-vm-revoked-compose \
E3_T17_PEER_IP="$peer_ip" \
E3_T17_PEER_PORT=5678 \
E3_T17_REVOKE_NODE=1 \
E3_T17_HEADSCALE_DOCKER=1 \
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

copied_key="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 cat /keys/copied.key)"
collision_a_key="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 cat /keys/collision-a.key)"
collision_b_key="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 cat /keys/collision-b.key)"
test -n "$copied_key"
test -n "$collision_a_key"
test -n "$collision_b_key"
docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys alpine:3.23 \
  rm -f /keys/copied.key /keys/collision-a.key /keys/collision-b.key
E3_T19_CONTROL_URL=http://localhost:8123 \
E3_T19_COPIED_KEY="$copied_key" \
E3_T19_COLLISION_A_KEY="$collision_a_key" \
E3_T19_COLLISION_B_KEY="$collision_b_key" \
  bash -c 'cd web && npx playwright test tests/e3-t19-identity-attacks.spec.js --reporter=line'

outage_key="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 cat /keys/outage.key)"
test -n "$outage_key"
docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys alpine:3.23 rm -f /keys/outage.key
docker compose stop headscale
E3_T19_CONTROL_URL=http://localhost:8123 \
E3_T19_AUTH_KEY="$outage_key" \
  bash -c 'cd web && npx playwright test tests/e3-t19-control-outage.spec.js --reporter=line'

relay_token="$(docker compose exec -T relay sh -c \
  'WVRELAY_HMAC_SECRET="$(cat /run/wasm-vm-keys/relay.secret)" \
   wvrelay issue-token http://localhost:8123 e3-t19-compose-proof 300')"
test -n "$relay_token"
E3_T19_RELAY_TOKEN="$relay_token" \
  bash -c 'cd web && npx playwright test tests/e3-t19-compose-relay.spec.js --reporter=line'
if docker compose logs relay | grep -F "$relay_token" >/dev/null; then
  echo "relay token leaked into compose logs" >&2
  exit 1
fi
guest_relay_token="$(docker compose exec -T relay sh -c \
  'WVRELAY_HMAC_SECRET="$(cat /run/wasm-vm-keys/relay.secret)" \
   wvrelay issue-token http://localhost:8123 e3-t19-compose-guest 900')"
test -n "$guest_relay_token"
E3_T19_GUEST_PROVIDER=relay \
E3_T19_RELAY_TOKEN="$guest_relay_token" \
E3_T19_PUBLIC_URL=https://1.1.1.1/ \
  bash -c 'cd web && npx playwright test tests/e3-t19-guest-https.spec.js --reporter=line'
if docker compose logs relay | grep -F "$guest_relay_token" >/dev/null; then
  echo "guest relay token leaked into compose logs" >&2
  exit 1
fi

# The fixture and exit keys must have been consumed, while reusable credential material never
# enters the checkout. Teardown in the EXIT trap destroys the remaining one-time browser key,
# denied-browser key, Headscale database, node states, and relay secret.
remaining="$(docker run --rm -v wasm-vm-e3-t19_ephemeral-keys:/keys:ro alpine:3.23 \
  sh -c 'find /keys -maxdepth 1 -type f -exec basename {} \; | sort')"
test "$remaining" = $'ready\nrelay.secret'
echo "E3-T19 live lifecycle proof: OK (exit/clear, restore, ACLs, relay, logout, keys)"
