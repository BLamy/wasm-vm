#!/usr/bin/env bash
# Deploy the browser demo to Cloudflare Pages — NO GitHub Actions, no CI bill.
#
#   bash tools/deploy-cloudflare.sh            # build (if needed) + deploy to production (wasm-vm.pages.dev)
#   REBUILD=1 bash tools/deploy-cloudflare.sh  # force a fresh web/dist build first
#
# Auth: `npx wrangler login` once (OAuth), or export CLOUDFLARE_API_TOKEN. The project is 'wasm-vm'
# (https://wasm-vm.pages.dev). Every file must be < 25 MiB (Cloudflare Pages limit) — the kernel Image
# (~21 MiB) and the tailscale wasm (~25 MiB) are the ones to watch.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=wasm-vm
DIST=web/dist

if [ "${REBUILD:-0}" = "1" ] || [ ! -f "$DIST/index.html" ]; then
  echo "[deploy] building web/dist (make web-dist)…"
  make web-dist
fi

# The large boot artifacts are not committed into web/dist (they live in releases/). Stage them for a
# standalone Cloudflare deploy — a build-free file copy.
echo "[deploy] staging boot artifacts into $DIST/releases …"
mkdir -p "$DIST/releases/kernel/6.6.63" "$DIST/releases/initramfs"
cp releases/kernel/6.6.63/Image "$DIST/releases/kernel/6.6.63/Image"
cp releases/initramfs/initramfs.cpio.gz "$DIST/releases/initramfs/initramfs.cpio.gz"

# Fail fast on any file over Cloudflare Pages' 25 MiB per-file limit.
big=$(find "$DIST" -type f -size +25M -print)
if [ -n "$big" ]; then
  echo "[deploy] ERROR: file(s) over Cloudflare's 25 MiB limit:" >&2
  echo "$big" >&2
  exit 1
fi

echo "[deploy] deploying $DIST to Cloudflare Pages project '$PROJECT' (production)…"
npx --yes wrangler pages deploy "$DIST" --project-name "$PROJECT" --branch main --commit-dirty=true
echo "[deploy] live at https://$PROJECT.pages.dev/"
