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
R2_BUCKET="${R2_BUCKET:-wasm-vm}"
PAGES_FILE_LIMIT=$((25 * 1024 * 1024))

public_object_is_exact() {
  local url=$1 expected_size=$2 expected_sha=$3 tmp actual_size actual_sha
  tmp=$(mktemp "${TMPDIR:-/tmp}/wasm-vm-r2-check.XXXXXX")
  if ! curl --fail --silent --show-error --location \
    --connect-timeout 10 --max-time 300 --speed-time 30 --speed-limit 1024 \
    --output "$tmp" "$url"; then
    rm -f "$tmp"
    return 1
  fi
  actual_size=$(wc -c < "$tmp" | tr -d ' ')
  actual_sha=$(shasum -a 256 "$tmp" | awk '{print $1}')
  rm -f "$tmp"
  [ "$actual_size" = "$expected_size" ] && [ "$actual_sha" = "$expected_sha" ]
}

ensure_r2_object() {
  local source=$1 key=$2 expected_size=$3 expected_sha=$4 url="$R2_PUBLIC/$key"
  if public_object_is_exact "$url" "$expected_size" "$expected_sha"; then
    echo "[deploy] R2 already exact: $key"
    return
  fi

  # Credentials are needed only for a missing/mismatched large artifact. Keep normal Pages-only
  # deploys independent of a local .env file.
  local env_file="${WASMVM_ENV_FILE:-.env}"
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
  : "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required to upload $key}"
  : "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required to upload $key}"
  : "${R2_S3_ENDPOINT:?R2_S3_ENDPOINT is required to upload $key}"
  AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID \
  AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
    aws --endpoint-url "$R2_S3_ENDPOINT" s3 cp "$source" "s3://$R2_BUCKET/$key" \
      --no-progress --only-show-errors
  public_object_is_exact "$url" "$expected_size" "$expected_sha" || {
    echo "[deploy] ERROR: public R2 verification failed for $key" >&2
    exit 1
  }
  echo "[deploy] uploaded and verified R2 object: $key"
}

echo "[deploy] repointing manifests at R2 ($R2_PUBLIC) …"
[ -f web/artifacts-alpine.json ] && cp web/artifacts-alpine.json "$DIST/artifacts-alpine.json"
# E3.6-T05: the node-preinstalled Alpine manifest (the default flavor) ships too.
[ -f web/artifacts-node-alpine.json ] && cp web/artifacts-node-alpine.json "$DIST/artifacts-node-alpine.json"
for m in "$DIST/artifacts.json" "$DIST/artifacts-alpine.json" "$DIST/artifacts-node-alpine.json"; do
  [ -f "$m" ] || continue
  sed "s#\"releases/#\"$R2_PUBLIC/#g" "$m" > "$m.tmp" && mv "$m.tmp" "$m"
done
# Boot artifacts below the Pages limit stay deployment-local. Larger artifacts use immutable,
# content-addressed R2 keys and are verified byte-for-byte before Pages is mutated.
mkdir -p "$DIST/releases/boot-snapshot"
for snap in busybox-ready.snap.gz alpine-ready.snap.gz alpine-overlay-delta.bin.gz node-alpine-ready.snap.gz node-alpine-overlay-delta.bin.gz; do
  source="releases/boot-snapshot/$snap"
  [ -f "$source" ] || continue
  size=$(wc -c < "$source" | tr -d ' ')
  sha=$(shasum -a 256 "$source" | awk '{print $1}')
  if [ "$size" -le "$PAGES_FILE_LIMIT" ]; then
    cp "$source" "$DIST/releases/boot-snapshot/$snap"
    for m in "$DIST/artifacts.json" "$DIST/artifacts-alpine.json" "$DIST/artifacts-node-alpine.json"; do
      [ -f "$m" ] || continue
      sed "s#\"$R2_PUBLIC/boot-snapshot/$snap\"#\"releases/boot-snapshot/$snap\"#g" "$m" > "$m.tmp" && mv "$m.tmp" "$m"
    done
    echo "[deploy] shipped $snap ($(du -h "$source" | cut -f1)) on Pages"
  else
    key="boot-snapshot/sha256/$sha/$snap"
    ensure_r2_object "$source" "$key" "$size" "$sha"
    rm -f "$DIST/releases/boot-snapshot/$snap"
    for m in "$DIST/artifacts.json" "$DIST/artifacts-alpine.json" "$DIST/artifacts-node-alpine.json"; do
      [ -f "$m" ] || continue
      sed "s#\"$R2_PUBLIC/boot-snapshot/$snap\"#\"$R2_PUBLIC/$key\"#g" "$m" > "$m.tmp" && mv "$m.tmp" "$m"
    done
  fi
done

# Do NOT ship the big artifacts with the site. The chunked bases (chunked-alpine + E3.6-T05
# chunked-node-alpine) live on R2, uploaded separately; their manifest URLs are rewritten to R2 above.
rm -rf "$DIST/releases/kernel" "$DIST/releases/initramfs" "$DIST/releases/chunked-alpine" "$DIST/releases/chunked-node-alpine" 2>/dev/null || true

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
