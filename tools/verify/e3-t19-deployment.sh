#!/usr/bin/env bash
set -euo pipefail

docker compose config --quiet
docker compose --profile relay config --quiet
docker run --rm \
  -v "$PWD/deploy/e3-t19/headscale.yaml:/etc/headscale/config.yaml:ro" \
  -v "$PWD/deploy/e3-t19/policy.hujson:/etc/headscale/policy.hujson:ro" \
  headscale/headscale:0.29.2 configtest >/dev/null

if rg -n "hskey-auth-[A-Za-z0-9_-]{8,}|network-relay-token[^>]*value=|WVRELAY_HMAC_SECRET=[\"']?[A-Za-z0-9]" \
  docker-compose.yml deploy/e3-t19 docs/deployment/network-providers.md; then
  echo "E3-T19 secret audit failed: reusable credential material is present in tracked deployment files" >&2
  exit 1
fi

test "$(docker compose config --images | sort -u | rg ':latest$' | wc -l | tr -d ' ')" = 0
echo "E3-T19 deployment config: OK (pinned images, valid Headscale policy, no embedded credentials)"
