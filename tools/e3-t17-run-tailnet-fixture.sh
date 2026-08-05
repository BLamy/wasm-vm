#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_URL="https://github.com/BLamy/tailscale.git"
SOURCE_COMMIT="0c78282d89c9c0af8e31d460a61bc5517d54c769"
TOOLCHAIN_COMMIT="c803676bcc7f2b195b167a53d49d728045cd9b36"
GVISOR_PATCH="$ROOT/third_party/tailscale-connect/gvisor-patches/0001-preserve-tcp-reset.patch"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wasm-vm-tailnet-fixture.XXXXXX")"
trap 'chmod -R u+w "$WORK" 2>/dev/null || true; rm -rf "$WORK"' EXIT

: "${E3_T17_CONTROL_URL:?E3_T17_CONTROL_URL is required}"
: "${E3_T17_AUTH_KEY:?E3_T17_AUTH_KEY is required}"

git clone --filter=blob:none --no-checkout "$SOURCE_URL" "$WORK/source"
git -C "$WORK/source" remote set-url origin "$SOURCE_URL"
git -C "$WORK/source" checkout --detach "$SOURCE_COMMIT"
test "$(git -C "$WORK/source" rev-parse HEAD)" = "$SOURCE_COMMIT"
test "$(tr -d '[:space:]' < "$WORK/source/go.toolchain.rev")" = "$TOOLCHAIN_COMMIT"

mkdir -p "$WORK/cache/go-build" "$WORK/cache/go-mod"
(
  cd "$WORK/source"
  env GOMODCACHE="$WORK/cache/go-mod" ./tool/go mod download gvisor.dev/gvisor
)
GVISOR_SOURCE="$(find "$WORK/cache/go-mod/gvisor.dev" -maxdepth 1 -type d -name 'gvisor@*' -print -quit)"
test -n "$GVISOR_SOURCE"
chmod -R u+w "$GVISOR_SOURCE"
patch -d "$GVISOR_SOURCE" -p1 --forward --batch < "$GVISOR_PATCH"

cd "$WORK/source"
exec env GOCACHE="$WORK/cache/go-build" GOMODCACHE="$WORK/cache/go-mod" \
  ./tool/go run "$ROOT/tools/e3-t17-tailnet-fixture.go"
