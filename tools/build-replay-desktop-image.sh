#!/usr/bin/env bash
# E5-T34b: build the minimal read-only Replay desktop rootfs (Replay Chrome 108 + Replay Node 26
# + sway + foot on busybox init) as a raw ext4 image, a chunked blob manifest, and the E5-T34a
# whole-image prefill artifact (.img.gz + sidecar).
#
#   bash tools/build-replay-desktop-image.sh [OUT_DIR]        (default target/e5-t34b/image)
#
# Assembly runs in a throwaway container from wasm-vm-replay-desktop-build:local on the
# colima-replay-chromium Docker context (arm64, riscv64 packages unpacked, never installed); see
# tools/replay-desktop/assemble.py for the file-selection rules and packages.txt for the sources.
# The Replay backend privacy check runs on the staged tree BEFORE packing and on the packed image
# and the compressed artifact AFTER; any failure aborts. Inputs are gitignored local artifacts:
#   local/chromium-riscv64/artifacts/2026-11-03/build20/replay-chromium-riscv64.tar.gz  (E0-T34)
#   local/node-26/replay-node-26-riscv64.tar.xz                                         (E5-T45a)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
OUT=${1:-target/e5-t34b/image}
export DOCKER_CONTEXT=${DOCKER_CONTEXT:-colima-replay-chromium}
TOOL_IMAGE=wasm-vm-replay-desktop-build:local
CHROME_TAR=local/chromium-riscv64/artifacts/2026-11-03/build20/replay-chromium-riscv64.tar.gz
CHROME_SHA=fae3717a934ea33d0a47d258a921c9d9643fe1a595d1eb9e3238a029e21ad42e
NODE_TAR=local/node-26/replay-node-26-riscv64.tar.xz
NODE_SHA=6d504bc599792a10b4abbc884a3a5c2d39ad8651aa5806878cf3d5effc6e4c39
CHUNK_SIZE=262144

sha() { shasum -a 256 "$1" | awk '{print $1}'; }
for pair in "$CHROME_TAR:$CHROME_SHA" "$NODE_TAR:$NODE_SHA"; do
  f=${pair%%:*}; want=${pair##*:}
  [ -f "$f" ] || { echo "missing input $f" >&2; exit 1; }
  [ "$(sha "$f")" = "$want" ] || { echo "input digest mismatch: $f" >&2; exit 1; }
done
case "$OUT" in target/*) ;; *) echo "OUT_DIR must be below target/" >&2; exit 1 ;; esac
[ ! -e "$OUT" ] || { echo "$OUT already exists" >&2; exit 1; }
mkdir -p "$OUT"
avail_kib=$(df -k . | awk 'NR==2{print $4}')
[ "$avail_kib" -gt $((10 * 1024 * 1024)) ] || { echo "less than 10 GiB free; refusing" >&2; exit 1; }

docker build -q -t "$TOOL_IMAGE" tools/replay-desktop >/dev/null
NAME=wasm-vm-e5t34b-build-$$
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$OUT/stage" "$OUT/stage.tar"; }
trap cleanup EXIT
docker create --name "$NAME" "$TOOL_IMAGE" sleep infinity >/dev/null
docker start "$NAME" >/dev/null
docker exec "$NAME" mkdir -p /in/local/chromium /in/local/node /in/tools/chromium/built /in/tools/chromium/guest /scratch
docker cp "$CHROME_TAR" "$NAME:/in/local/chromium/"
docker cp "$NODE_TAR" "$NAME:/in/local/node/"
docker cp tools/replay-desktop "$NAME:/in/tools/replay-desktop"
docker cp tools/chromium/built/runtime-files.json "$NAME:/in/tools/chromium/built/"
docker cp tools/chromium/guest/smoke.html "$NAME:/in/tools/chromium/guest/"

echo "[replay-desktop] stage" >&2
docker exec "$NAME" python3 /in/tools/replay-desktop/assemble.py stage 2>"$OUT/stage.log"
docker cp "$NAME:/out/stage.tar" "$OUT/stage.tar"
docker cp "$NAME:/out/stage-manifest.json" "$OUT/stage-manifest.json"
mkdir "$OUT/stage"
tar -xf "$OUT/stage.tar" -C "$OUT/stage"

echo "[replay-desktop] privacy check: staged tree (before packing)" >&2
python3 tools/privacy/check-no-replay-backend.py "$OUT/stage" | tee "$OUT/privacy-stage.txt"

echo "[replay-desktop] pack" >&2
docker exec "$NAME" python3 /in/tools/replay-desktop/assemble.py pack 2>"$OUT/pack.log"
docker cp "$NAME:/out/rootfs.ext4" "$OUT/replay-desktop.ext4"
docker cp "$NAME:/out/pack.json" "$OUT/pack.json"
[ "$(sha "$OUT/replay-desktop.ext4")" = "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["sha256"])' "$OUT/pack.json")" ]

echo "[replay-desktop] privacy check: packed image" >&2
python3 tools/privacy/check-no-replay-backend.py "$OUT/replay-desktop.ext4" | tee "$OUT/privacy-image.txt"

echo "[replay-desktop] chunk + whole-image prefill artifact" >&2
python3 tools/chunk_image.py split "$OUT/replay-desktop.ext4" --out "$OUT/chunked" --chunk-size "$CHUNK_SIZE" --layout blob >"$OUT/chunk.log"
bash tools/build-whole-image.sh "$OUT/replay-desktop.ext4" "$OUT/chunked/manifest.json" "$OUT/replay-desktop.img.gz"
python3 tools/privacy/check-no-replay-backend.py "$OUT/replay-desktop.img.gz" | tee "$OUT/privacy-img-gz.txt"

python3 -I - "$OUT" "$(git rev-parse HEAD)" <<'PY'
import hashlib, json, os, sys
out, head = sys.argv[1], sys.argv[2]
def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()
stage = json.load(open(f"{out}/stage-manifest.json"))
whole = json.load(open(f"{out}/replay-desktop.img.gz.json"))
manifest = json.load(open(f"{out}/chunked/manifest.json"))
receipt = {
    "task": "E5-T34b", "head": head,
    "image": {"file": "replay-desktop.ext4", "bytes": os.path.getsize(f"{out}/replay-desktop.ext4"),
              "sha256": sha(f"{out}/replay-desktop.ext4"), "fs": "ext4 (no journal), mounted read-only"},
    "imgGz": {"file": "replay-desktop.img.gz", "bytes": whole["gzipSize"], "sha256": whole["gzipSha256"]},
    "chunkManifest": {"file": "chunked/manifest.json", "sha256": sha(f"{out}/chunked/manifest.json"),
                      "chunk_size": manifest["chunk_size"], "layout": manifest["layout"],
                      "chunks": len(manifest["chunks"])},
    "stagedRegularBytes": stage["stagedRegularBytes"],
    "stagedEntries": len(stage["files"]),
    "packagesInAptClosure": len(stage["aptClosure"]),
    "packagesContributingFiles": stage["packagesContributingFiles"],
    "payload": stage["payload"],
    "privacy": {k: open(f"{out}/{f}").read().strip() for k, f in
                (("stage", "privacy-stage.txt"), ("image", "privacy-image.txt"), ("imgGz", "privacy-img-gz.txt"))},
}
json.dump(receipt, open(f"{out}/build.json", "w"), indent=2)
print(json.dumps({k: receipt[k] for k in ("image", "imgGz", "chunkManifest", "stagedRegularBytes")}, indent=2))
PY
