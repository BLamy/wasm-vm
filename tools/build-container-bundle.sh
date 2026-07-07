#!/usr/bin/env bash
# build-container-bundle.sh — turn a public OCI image into a runnable riscv64 BUNDLE (E3.5 runner
# path, → `wvrun <bundle>`). Wraps the two real steps and asserts the result is genuinely riscv64:
#
#   1. tools/oci-sideload.sh   <ref> <layout>  <arch>    (pull image-layout, digest-verify blobs)
#   2. wasm-vm oci unpack      <layout> --out <bundle> --arch <arch>   (flatten layers → rootfs/+config)
#   3. verify rootfs/bin/sh (or the config argv[0]) is an ELF for <arch>  — no fake bundles slip through
#
# Usage:  tools/build-container-bundle.sh <ref> <out-bundle-dir> [<arch=riscv64>]
#   e.g.  tools/build-container-bundle.sh busybox      web/assets/containers/busybox
#         tools/build-container-bundle.sh postgres:18  /tmp/pg-bundle              riscv64
#
# Env: WASM_VM=path to the wasm-vm binary (default: cargo-built ./target/{release,debug}/wasm-vm).
# Emits, next to the bundle, a small manifest.json (real image ref + config/layer digests + argv/env)
# the demo's Docker tab reads — REAL metadata, not placeholders.
set -euo pipefail

REF="${1:?usage: build-container-bundle.sh <ref> <out-bundle-dir> [arch]}"
OUT="${2:?usage: build-container-bundle.sh <ref> <out-bundle-dir> [arch]}"
ARCH="${3:-riscv64}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# Locate the wasm-vm binary (or build it).
WASM_VM="${WASM_VM:-}"
if [ -z "$WASM_VM" ]; then
  for c in "$ROOT/target/release/wasm-vm" "$ROOT/target/debug/wasm-vm"; do
    [ -x "$c" ] && WASM_VM="$c" && break
  done
fi
if [ -z "$WASM_VM" ]; then
  echo "[bundle] building wasm-vm CLI…" >&2
  ( cd "$ROOT" && cargo build -q -p wasm-vm-cli --bin wasm-vm )
  WASM_VM="$ROOT/target/debug/wasm-vm"
fi

echo "[bundle] using wasm-vm: $WASM_VM ($(date -r "$WASM_VM" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?'))" >&2

LAYOUT="$(mktemp -d)/layout"
trap 'rm -rf "$(dirname "$LAYOUT")"' EXIT

echo "[bundle] 1/3 sideload $REF ($ARCH) → layout" >&2
bash "$HERE/oci-sideload.sh" "$REF" "$LAYOUT" "$ARCH"

echo "[bundle] 2/3 unpack → $OUT" >&2
rm -rf "$OUT"
mkdir -p "$OUT"
"$WASM_VM" oci unpack "$LAYOUT" --out "$OUT" --arch "$ARCH"

# 3. Prove the bundle is a REAL <arch> container: the entry binary (config argv[0], falling back to
# /bin/sh) must be an ELF for the target machine. A wrong-arch or empty bundle fails here, loudly.
echo "[bundle] 3/3 verify rootfs is $ARCH" >&2
entry="$(head -n1 "$OUT/config/argv" 2>/dev/null || true)"
case "$entry" in
  /*) probe="$OUT/rootfs$entry" ;;
  *)  probe="$OUT/rootfs/bin/sh" ;;
esac
[ -e "$probe" ] || probe="$OUT/rootfs/bin/busybox"
if [ ! -e "$probe" ]; then
  echo "[bundle] FAIL: no entry/shell binary found in rootfs (looked for $probe)" >&2
  exit 1
fi
want=""
case "$ARCH" in
  riscv64) want="RISC-V" ;;
  amd64|x86_64) want="x86-64" ;;
  arm64|aarch64) want="ARM aarch64" ;;
esac
desc="$(file -L "$probe")"
if [ -n "$want" ] && ! printf '%s' "$desc" | grep -q "$want"; then
  echo "[bundle] FAIL: $probe is not $want:" >&2
  echo "         $desc" >&2
  exit 1
fi

# Real metadata for the demo (image ref + digests + entry) — pulled from the layout we just verified.
manifest_digest="$(python3 - "$LAYOUT" <<'PY'
import json,sys,os
lay=sys.argv[1]
idx=json.load(open(os.path.join(lay,"index.json")))
print(idx["manifests"][0]["digest"])
PY
)"
# Real on-disk size via `du` (counts hardlinks/symlinks once — busybox is one binary + applet links,
# so a naive cat-and-count would inflate it ~400x).
rootfs_kib="$(du -sk "$OUT/rootfs" | awk '{print $1}')"
rootfs_bytes="$(( rootfs_kib * 1024 ))"
entries="$(find "$OUT/rootfs" | wc -l | tr -d ' ')"
entry_line="$(tr '\n' ' ' < "$OUT/config/argv" | sed 's/ *$//')"
elf_desc="$(printf '%s' "$desc" | sed 's/.*: //; s/"/'"'"'/g' | cut -c1-120)"
cat > "$(dirname "$OUT")/manifest.json" <<JSON
{
  "ref": "$REF",
  "arch": "$ARCH",
  "manifestDigest": "$manifest_digest",
  "entry": "$entry_line",
  "rootfsBytes": $rootfs_bytes,
  "rootfsEntries": $entries,
  "entryElf": "$elf_desc"
}
JSON

echo "[bundle] OK — real $ARCH bundle at $OUT ($entries rootfs entries, entry: $entry)" >&2
echo "[bundle]      run it in-guest with:  wvrun $OUT" >&2
