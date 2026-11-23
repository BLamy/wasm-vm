#!/usr/bin/env bash
# E5-T34a: produce the whole-image prefill artifact for a chunked boot — `<out>.img.gz` (gzip of the
# raw base image) plus `<out>.img.gz.json` ({ size, sha256, gzipSize, gzipSha256, manifestImageLen }).
# The loader's `wholeImageUrl` / `wholeImageSha256` / `wholeImageSize` options take the URL of the
# .img.gz and the DECOMPRESSED sha256/size from the sidecar.
#
#   bash tools/build-whole-image.sh <raw-image> <chunk-manifest.json> <out.img.gz>
#
# Refuses to write anything unless the raw image is EXACTLY the image the chunk manifest describes:
# its length must equal image_len and every chunk's SHA-256 must match (so the prefill can never
# serve bytes the lazy path would have rejected).
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo "usage: $0 <raw-image> <chunk-manifest.json> <out.img.gz>" >&2
  exit 2
fi
RAW=$1
MANIFEST=$2
OUT=$3

python3 -I - "$RAW" "$MANIFEST" <<'PY'
import hashlib, json, os, sys
raw, manifest = sys.argv[1], sys.argv[2]
m = json.load(open(manifest))
size = os.path.getsize(raw)
if size != m["image_len"]:
    sys.exit(f"build-whole-image: {raw} is {size} bytes, manifest image_len is {m['image_len']}")
cs = m["chunk_size"]
with open(raw, "rb") as f:
    for i, want in enumerate(m["chunks"]):
        got = hashlib.sha256(f.read(cs)).hexdigest()
        if got != want:
            sys.exit(f"build-whole-image: chunk {i} of {raw} does not match {manifest}")
print(f"build-whole-image: {raw} matches all {len(m['chunks'])} chunks of {manifest}")
PY

TMP="$OUT.tmp.$$"
trap 'rm -f "$TMP"' EXIT
# -n: no name/timestamp in the header, so the artifact is byte-reproducible.
gzip -n -6 -c "$RAW" >"$TMP"
mv "$TMP" "$OUT"

python3 -I - "$RAW" "$MANIFEST" "$OUT" <<'PY'
import hashlib, json, os, sys
raw, manifest, out = sys.argv[1:4]
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()
meta = {
    "size": os.path.getsize(raw),
    "sha256": sha(raw),
    "gzipSize": os.path.getsize(out),
    "gzipSha256": sha(out),
    "manifestImageLen": json.load(open(manifest))["image_len"],
}
with open(out + ".json", "w") as f:
    json.dump(meta, f, indent=2)
    f.write("\n")
print(json.dumps(meta))
PY
