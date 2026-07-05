#!/usr/bin/env bash
# E2-T21: generate web/artifacts.json — the browser loader's manifest of boot artifacts
# (url + sha256 + size) so the page can fetch, show honest progress, and INTEGRITY-CHECK the
# bytes before booting. The sha256 doubles as the cache-buster (content-hashed URL) and the
# thing the loader verifies against.
set -euo pipefail
cd "$(dirname "$0")/.."

# Each entry: <role> <path-under-releases> served at /releases/<path>.
entries=(
  "kernel   kernel/6.6.63/Image"
  "initramfs initramfs/initramfs.cpio.gz"
)

json='{\n  "generated": "content-hashed; regenerate with tools/gen-web-manifest.sh",\n  "artifacts": {\n'
first=1
for e in "${entries[@]}"; do
  role="${e%% *}"; rel="${e##* }"
  f="releases/$rel"
  [ -f "$f" ] || { echo "gen-web-manifest: missing $f" >&2; exit 1; }
  sha=$(shasum -a 256 "$f" | awk '{print $1}')
  size=$(stat -f '%z' "$f")
  [ "$first" = 1 ] || json+=',\n'
  first=0
  json+="    \"$role\": { \"url\": \"/releases/$rel\", \"sha256\": \"$sha\", \"size\": $size }"
done
json+='\n  }\n}\n'

printf "$json" > web/artifacts.json
echo "wrote web/artifacts.json:"
cat web/artifacts.json
