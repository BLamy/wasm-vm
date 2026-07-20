#!/bin/sh
set -eu

CONFIG=/etc/headscale/config.yaml
KEYS=/run/wasm-vm-keys
mkdir -p "$KEYS"
chmod 700 "$KEYS"

until headscale -c "$CONFIG" health >/dev/null 2>&1; do sleep 1; done
for user in browser@example.com denied@example.com infra@example.com; do
  headscale -c "$CONFIG" users create "$user" >/dev/null 2>&1 || true
done

make_key() {
  name=$1
  user_name=$2
  shift 2
  headscale -c "$CONFIG" -o json users list --name "$user_name" > "$KEYS/user.json"
  user_id="$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$KEYS/user.json" | head -n 1)"
  rm -f "$KEYS/user.json"
  test -n "$user_id"
  umask 077
  headscale -c "$CONFIG" -o json preauthkeys create \
    --user "$user_id" --expiration 1h "$@" > "$KEYS/$name.json"
  sed -n 's/.*"key"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$KEYS/$name.json" > "$KEYS/$name.key"
  test -s "$KEYS/$name.key"
  rm -f "$KEYS/$name.json"
}

make_key browser browser@example.com
make_key denied denied@example.com
make_key fixture infra@example.com --tags tag:fixture
make_key exit infra@example.com --tags tag:exit

# Generated per `docker compose up`, never stored in the checkout or printed by any service.
umask 077
head -c 48 /dev/urandom | base64 > "$KEYS/relay.secret"
touch "$KEYS/ready"
tail -f /dev/null
