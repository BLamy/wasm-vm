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

# The LARGE boot artifacts (kernel, initramfs, the ~130 MB chunked Alpine image) live on Cloudflare R2,
# NOT on Pages — this keeps the Pages deploy tiny and off the 25 MiB/file limit. Upload them once with
# `bash tools/deploy-r2.sh`. Here we only ship the small manifests and REWRITE their relative
# `releases/…` URLs to the R2 public base (kernel/initramfs/rootfs/chunked-alpine). The chunked-image
# manifest URL is set to R2 directly in web/main.js (R2_ASSETS).
R2_PUBLIC="https://pub-ee599ce692e44e29868ebfa96dd9c7fd.r2.dev"
echo "[deploy] repointing manifests at R2 ($R2_PUBLIC) …"
[ -f web/artifacts-alpine.json ] && cp web/artifacts-alpine.json "$DIST/artifacts-alpine.json"
for m in "$DIST/artifacts.json" "$DIST/artifacts-alpine.json"; do
  [ -f "$m" ] || continue
  sed "s#\"releases/#\"$R2_PUBLIC/#g" "$m" > "$m.tmp" && mv "$m.tmp" "$m"
  # E4 boot snapshot: the compressed busybox boot snapshot is small (a few MB) and ships ON Pages, so
  # repoint ONLY its URL back to the relative releases/ path (the generic rewrite above sent it to R2,
  # where it is not uploaded). If a future snapshot exceeds the 25 MiB Pages cap, upload it to R2 and
  # drop this line so its URL stays R2-hosted.
  sed "s#\"$R2_PUBLIC/boot-snapshot/#\"releases/boot-snapshot/#g" "$m" > "$m.tmp" && mv "$m.tmp" "$m"
done
# E4 boot snapshot ships ON Pages (URL kept relative above), so the FILE must be present under
# $DIST/releases/ — build-web-dist.sh deliberately skips releases/, so copy it here at deploy time
# (same "poor-mans-ci at deploy time" pattern as the kernel, except this one stays on Pages).
mkdir -p "$DIST/releases/boot-snapshot"
# busybox (initramfs) + Alpine (chunked) restore artifacts all ship ON Pages (each < 25 MiB).
for snap in busybox-ready.snap.gz alpine-ready.snap.gz alpine-overlay-delta.bin.gz; do
  if [ -f "releases/boot-snapshot/$snap" ]; then
    cp "releases/boot-snapshot/$snap" "$DIST/releases/boot-snapshot/$snap"
    echo "[deploy] shipped $snap ($(du -h "releases/boot-snapshot/$snap" | cut -f1)) on Pages"
  fi
done

# Do NOT ship the big artifacts with the site.
rm -rf "$DIST/releases/kernel" "$DIST/releases/initramfs" "$DIST/releases/chunked-alpine" 2>/dev/null || true

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
