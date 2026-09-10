#!/usr/bin/env bash
# Generate the Omarchy browser manifest from the complete matched desktop release.
set -euo pipefail
cd "$(dirname "$0")/.."

kernel="${OMARCHY_KERNEL:-releases/kernel/6.6.63/Image}"
out="${OMARCHY_MANIFEST_OUT:-web/artifacts-omarchy.json}"
ram="${OMARCHY_RAM_SNAPSHOT:-releases/boot-snapshot/omarchy-ready.snap.gz}"
delta="${OMARCHY_OVERLAY_DELTA:-releases/boot-snapshot/omarchy-overlay-delta.bin.gz}"
chunk_manifest="${OMARCHY_CHUNK_MANIFEST:-releases/chunked-omarchy/manifest.json}"

for artifact in "$kernel" "$ram" "$delta" "$chunk_manifest"; do
  [ -s "$artifact" ] || { echo "gen-omarchy-manifest: missing $artifact" >&2; exit 2; }
done
ksha=$(shasum -a 256 "$kernel" | awk '{print $1}')
ksize=$(wc -c < "$kernel" | tr -d ' ')

rsha=$(shasum -a 256 "$ram" | awk '{print $1}')
rsize=$(wc -c < "$ram" | tr -d ' ')
dsha=$(shasum -a 256 "$delta" | awk '{print $1}')
dsize=$(wc -c < "$delta" | tr -d ' ')

# This is the exact identity used by ImageManifest::base_hash and by the snapshot/delta builders.
# Keep the production descriptor tied to the actual canonical input, not a hand-copied digest.
chunk_manifest_meta=$(python3 - "$chunk_manifest" <<'PY'
import hashlib
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    manifest = json.load(f)
identity = {key: manifest[key] for key in ("version", "image_len", "chunk_size", "layout", "chunks")}
base = hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()
raw = open(sys.argv[1], "rb").read()
raw_sha = hashlib.sha256(raw).hexdigest()
print(raw_sha, manifest["image_len"], len(raw), base)
PY
)
read -r chunk_manifest_sha chunk_manifest_image_len chunk_manifest_size chunk_manifest_base <<< "$chunk_manifest_meta"

# Validate the paired artifacts before touching the generated manifest. The first headers carry the
# base binding, image length, and overlay generation; a mixed SDR RAM/delta pair must fail closed.
python3 - "$delta" "$ram" "$chunk_manifest_base" "$chunk_manifest_image_len" <<'PY'
import gzip
import struct
import sys

delta_path, ram_path, expected_base, expected_image_len = sys.argv[1:]
expected_base_bytes = bytes.fromhex(expected_base)
expected_image_len = int(expected_image_len)

with gzip.open(delta_path, "rb") as stream:
    delta = stream.read(57)
if len(delta) < 57 or delta[:5] != b"WVOD1":
    raise SystemExit("gen-omarchy-manifest: overlay delta has no valid WVOD1 header")
block_size = struct.unpack_from("<I", delta, 5)[0]
image_len = struct.unpack_from("<Q", delta, 9)[0]
base = delta[17:49]
generation = struct.unpack_from("<Q", delta, 49)[0]
if block_size != 4096:
    raise SystemExit(f"gen-omarchy-manifest: overlay delta block size is {block_size}, expected 4096")
if image_len != expected_image_len or base != expected_base_bytes:
    raise SystemExit("gen-omarchy-manifest: overlay delta is not bound to the canonical chunk manifest")

with gzip.open(ram_path, "rb") as stream:
    ram = stream.read(84)
if len(ram) < 84 or ram[:8] != b"WVMRESU1":
    raise SystemExit("gen-omarchy-manifest: RAM snapshot has no valid WVMRESU1 header")
ram_version = struct.unpack_from("<I", ram, 8)[0]
ram_base = ram[44:76]
ram_generation = struct.unpack_from("<Q", ram, 76)[0]
if ram_version != 1 or ram_base != expected_base_bytes or ram_generation != generation:
    raise SystemExit("gen-omarchy-manifest: RAM snapshot and overlay delta are not a coherent pair")
PY

cat > "$out" <<JSON
{
  "generated": "content-hashed Omarchy desktop (kernel + paired RAM snapshot/disk delta)",
  "artifacts": {
    "kernel": { "url": "releases/kernel/6.6.63/Image", "sha256": "$ksha", "size": $ksize },
    "bootSnapshot": { "url": "$ram", "sha256": "$rsha", "size": $rsize },
    "overlayDelta": { "url": "$delta", "sha256": "$dsha", "size": $dsize }
  },
  "chunkedImage": {
    "key": "chunked-omarchy/manifest-$chunk_manifest_sha.json",
    "sha256": "$chunk_manifest_sha",
    "size": $chunk_manifest_size
  }
}
JSON
echo "gen-omarchy-manifest: wrote $out" >&2
