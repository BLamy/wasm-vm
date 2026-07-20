#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_URL="https://github.com/BLamy/tailscale.git"
SOURCE_COMMIT="0c78282d89c9c0af8e31d460a61bc5517d54c769"
TOOLCHAIN_COMMIT="c803676bcc7f2b195b167a53d49d728045cd9b36"
PATCH="$ROOT/third_party/tailscale-connect/patches/0001-generic-netconn-streams.patch"
DEST="$ROOT/web/tailscale-connect"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/wasm-vm-tailscale.XXXXXX")"
trap 'chmod -R u+w "$WORK" 2>/dev/null || true; rm -rf "$WORK"' EXIT

git clone --filter=blob:none --no-checkout "$SOURCE_URL" "$WORK/source"
# Some developer git configs rewrite HTTPS GitHub URLs to SSH. Restore an unauthenticated,
# reproducible fetch URL before the partial clone lazily requests pinned blobs.
git -C "$WORK/source" remote set-url origin "$SOURCE_URL"
git -C "$WORK/source" checkout --detach "$SOURCE_COMMIT"
test "$(git -C "$WORK/source" rev-parse HEAD)" = "$SOURCE_COMMIT"
test "$(tr -d '[:space:]' < "$WORK/source/go.toolchain.rev")" = "$TOOLCHAIN_COMMIT"
git -C "$WORK/source" apply --check "$PATCH"
git -C "$WORK/source" apply "$PATCH"

mkdir -p "$WORK/cache/go-build" "$WORK/cache/go-mod" "$WORK/pkg"
(
  cd "$WORK/source"
  env \
    GOCACHE="$WORK/cache/go-build" \
    GOMODCACHE="$WORK/cache/go-mod" \
    ./tool/go run tailscale.com/cmd/tsconnect \
      -rootdir "$WORK/source" \
      -pkgdir "$WORK/pkg" \
      -fast-compression \
      build-pkg
)

test -s "$WORK/pkg/main.wasm"
test -s "$WORK/pkg/pkg.js"
TYPES="$WORK/pkg/pkg.d.ts"
# Upstream's dts-bundle-generator currently hardcodes this relative output even when -pkgdir is
# absolute. Accept that known build output, but still require it to exist.
if [[ ! -s "$TYPES" ]]; then
  TYPES="$WORK/source/cmd/tsconnect/pkg/pkg.d.ts"
fi
test -s "$TYPES"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -p "$WORK/pkg/main.wasm" "$WORK/pkg/pkg.js" "$TYPES" \
  "$WORK/pkg/package.json" "$WORK/pkg/README.md" "$DEST/"
cp -p "$ROOT/third_party/tailscale-connect/LICENSE" "$DEST/LICENSE"
(
  cd "$DEST"
  shasum -a 256 main.wasm > main.wasm.sha256
)
