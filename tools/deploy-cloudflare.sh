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
MANIFEST_NAMES=(artifacts.json artifacts-alpine.json artifacts-node-alpine.json)
LOCAL_RECORDS=$(mktemp "${TMPDIR:-/tmp}/wasm-vm-artifact-records.XXXXXX")
RELEASE_URLS=$(mktemp "${TMPDIR:-/tmp}/wasm-vm-release-urls.XXXXXX")
R2_QUEUE=$(mktemp "${TMPDIR:-/tmp}/wasm-vm-r2-queue.XXXXXX")
trap 'rm -f "$LOCAL_RECORDS" "$RELEASE_URLS" "$R2_QUEUE"' EXIT

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

echo "[deploy] staging and validating artifact manifests …"
# Always stage manifests from web/. A prior deploy rewrites web/dist URLs, and reusing that mutated
# manifest would make the next deploy validate the wrong expected bytes. Optional flavor manifests
# are removed from the staging directory when absent, so an old snapshot cannot remain reachable.
[ -f web/artifacts.json ] || { echo "[deploy] ERROR: missing web/artifacts.json" >&2; exit 1; }
for name in "${MANIFEST_NAMES[@]}"; do
  source="web/$name"
  if [ -f "$source" ]; then
    cp "$source" "$DIST/$name"
  elif [ "$name" != "artifacts.json" ]; then
    rm -f "$DIST/$name"
  fi
done

MANIFEST_ARGS=()
for name in "${MANIFEST_NAMES[@]}"; do
  manifest="$DIST/$name"
  [ -f "$manifest" ] || continue
  MANIFEST_ARGS+=(--manifest "$manifest")
done
[ "${#MANIFEST_ARGS[@]}" -gt 0 ] || { echo "[deploy] ERROR: no artifact manifests staged" >&2; exit 1; }

# This is deliberately before any URL rewrite or R2 upload. It catches a stale manifest, a
# missing release, a size mismatch, and the kernel/initramfs drift that the old script missed.
python3 tools/validate-deploy-artifacts.py \
  --root "$PWD" --reject-remote --print-records "${MANIFEST_ARGS[@]}" > "$LOCAL_RECORDS"
python3 tools/validate-deploy-artifacts.py \
  --root "$PWD" --reject-remote --print-release-urls "${MANIFEST_ARGS[@]}" > "$RELEASE_URLS"

rewrite_r2_reference() {
  local relative=$1 key=$2 m
  python3 tools/validate-deploy-artifacts.py \
    --root "$PWD" "${MANIFEST_ARGS[@]}" \
    --rewrite-reference "$relative" "$R2_PUBLIC/$key"
}

queue_r2_object() {
  local source=$1 key=$2 size=$3 sha=$4
  printf '%s\t%s\t%s\t%s\n' "$source" "$key" "$size" "$sha" >> "$R2_QUEUE"
}

# Large boot artifacts stay off Pages. Every R2 key is content-addressed from the already-validated
# manifest digest, so a mutable old key can never be the URL in the release manifest.
while IFS=$'\t' read -r relative sha size; do
  source="$PWD/$relative"
  case "$relative" in
    releases/kernel/*|releases/initramfs/*|releases/rootfs/*)
      key="sha256/$sha/$relative"
      rewrite_r2_reference "$relative" "$key"
      queue_r2_object "$source" "$key" "$size" "$sha"
      ;;
    releases/boot-snapshot/*)
      if [ "$size" -le "$PAGES_FILE_LIMIT" ]; then
        destination="$DIST/$relative"
        mkdir -p "$(dirname "$destination")"
        cp "$source" "$destination"
        echo "[deploy] shipped $(basename "$relative") on Pages"
      else
        key="sha256/$sha/$relative"
        rewrite_r2_reference "$relative" "$key"
        rm -f "$DIST/$relative"
        queue_r2_object "$source" "$key" "$size" "$sha"
      fi
      ;;
  esac
done < "$LOCAL_RECORDS"

# Chunked base/profile references are schema-level URLs rather than artifact entries. They use the
# same R2 base as main.js (without the source-only `releases/` prefix), and are rewritten by exact
# JSON string equality so a URL such as `a.bin` cannot collide with `axbin`.
while IFS= read -r relative; do
  case "$relative" in
    releases/chunked-alpine/*|releases/chunked-node-alpine/*)
      rewrite_r2_reference "$relative" "${relative#releases/}"
      ;;
  esac
done < "$RELEASE_URLS"

# Do NOT ship the big artifacts with the site. The chunked bases (chunked-alpine + E3.6-T05
# chunked-node-alpine) live on R2, uploaded separately; their manifest URLs are rewritten to R2 above.
rm -rf "$DIST/releases/kernel" "$DIST/releases/initramfs" "$DIST/releases/chunked-alpine" "$DIST/releases/chunked-node-alpine" 2>/dev/null || true

# Validate the exact staged tree after optional snapshots have been copied and excluded artifacts
# have been removed. Remote entries are checked below through their public URL; every remaining
# relative entry must exist in Pages staging and match its manifest declaration.
python3 tools/validate-deploy-artifacts.py \
  --root "$DIST" "${MANIFEST_ARGS[@]}" \
  --reject-local-prefix releases/kernel/ \
  --reject-local-prefix releases/initramfs/ \
  --reject-local-prefix releases/rootfs/ \
  --reject-local-prefix releases/chunked-alpine/ \
  --reject-local-prefix releases/chunked-node-alpine/ \
  --binding-file "$R2_QUEUE" --binding-root "$PWD" --r2-base "$R2_PUBLIC"

# Check R2 without credentials first. A missing or mismatched public object is not accepted as
# "close enough": the deploy must have credentials to publish the exact already-validated bytes,
# then it must pass the same public check again. The content-addressed key also prevents later drift.
while IFS=$'\t' read -r source key size sha; do
  ensure_r2_object "$source" "$key" "$size" "$sha"
done < "$R2_QUEUE"

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
