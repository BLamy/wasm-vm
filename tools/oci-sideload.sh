#!/usr/bin/env bash
# oci-sideload.sh — pull a public OCI image for a target arch into a local OCI image-layout that
# `wasm-vm oci unpack` consumes. This is the dev-side "get the image in" step for the E3.5 runner
# path (→ `wvrun postgres`): no built-in registry client / new Rust HTTP dependency, just curl +
# python3 (already required by the build tooling). Registry: Docker Hub (registry-1.docker.io) with
# anonymous pull tokens; other registries are a later generalization.
#
# Usage:  tools/oci-sideload.sh <repo>[:<tag>] <out-dir> [<arch>]
#   e.g.  tools/oci-sideload.sh busybox        /tmp/busybox-oci
#         tools/oci-sideload.sh postgres:16     /tmp/pg-oci        riscv64
#
# Output layout (standard OCI image-layout):
#   <out-dir>/index.json
#   <out-dir>/blobs/sha256/<hex>          (manifest + config + every layer, digest-named)
#
# EVERY blob is sha256-verified against its digest as it lands — a registry that serves wrong bytes
# fails here, not silently downstream. Re-running is idempotent: an already-present, verifying blob
# is not re-downloaded (a poor-man's cache; the real digest-deduped browser cache is E3.5-T04).
set -euo pipefail

REG="https://registry-1.docker.io"
AUTH="https://auth.docker.io/token"
SVC="registry.docker.io"

ref="${1:?usage: oci-sideload.sh <repo>[:<tag>] <out-dir> [<arch>]}"
out="${2:?usage: oci-sideload.sh <repo>[:<tag>] <out-dir> [<arch>]}"
arch="${3:-riscv64}"

repo="${ref%%:*}"
tag="latest"; case "$ref" in *:*) tag="${ref##*:}";; esac
# Official images live under library/ (e.g. `busybox` → `library/busybox`).
case "$repo" in */*) : ;; *) repo="library/$repo";; esac

blobs="$out/blobs/sha256"
mkdir -p "$blobs"

MTYPES="application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"

log() { printf '[sideload] %s\n' "$*" >&2; }

token() {
  curl -fsSL "$AUTH?service=$SVC&scope=repository:$repo:pull" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])"
}
TOK="$(token)"

# sha256 of a file, portable across macOS (shasum) and Linux (sha256sum).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# Download a blob by digest into blobs/sha256/<hex>, verifying the digest. Skips if already valid.
fetch_blob() {
  digest="$1"; hex="${digest#sha256:}"; dst="$blobs/$hex"
  if [ -f "$dst" ] && [ "$(sha256_of "$dst")" = "$hex" ]; then log "cache hit  $digest"; return 0; fi
  log "download   $digest"
  curl -fsSL -H "Authorization: Bearer $TOK" -H "Accept: $MTYPES" \
    "$REG/v2/$repo/blobs/$digest" -o "$dst"
  got="$(sha256_of "$dst")"
  if [ "$got" != "$hex" ]; then log "DIGEST MISMATCH for $digest (got sha256:$got)"; rm -f "$dst"; exit 3; fi
}

# Fetch a manifest document by reference (tag or digest), store it as a blob, echo its digest.
# Manifests are content that unpack reads by digest, so they live in blobs/ like everything else.
fetch_manifest_blob() {
  ref="$1"; tmp="$(mktemp)"
  curl -fsSL -H "Authorization: Bearer $TOK" -H "Accept: $MTYPES" \
    "$REG/v2/$repo/manifests/$ref" -o "$tmp"
  hex="$(sha256_of "$tmp")"; mv "$tmp" "$blobs/$hex"; echo "sha256:$hex"
}

log "repo=$repo tag=$tag arch=$arch → $out"

# 1. Top document: an image index / manifest-list (multi-arch) or a single manifest.
top_dig="$(fetch_manifest_blob "$tag")"
top="$blobs/${top_dig#sha256:}"
media="$(python3 -c "import sys,json;print(json.load(open(sys.argv[1])).get('mediaType',''))" "$top")"

# 2. Resolve to the arch-specific image manifest digest.
if python3 -c "import sys,json;d=json.load(open(sys.argv[1]));sys.exit(0 if 'manifests' in d else 1)" "$top"; then
  man_dig="$(python3 - "$top" "$arch" <<'PY'
import sys, json
d = json.load(open(sys.argv[1])); arch = sys.argv[2]
for m in d["manifests"]:
    p = m.get("platform", {})
    if p.get("architecture") == arch and p.get("os", "linux") in ("linux", ""):
        print(m["digest"]); break
else:
    sys.stderr.write("[sideload] no %s manifest in the index\n" % arch); sys.exit(4)
PY
)"
  man_dig="$(fetch_manifest_blob "$man_dig")"   # fetch the picked manifest, store as blob
else
  man_dig="$top_dig"                            # already a single-arch manifest
fi
man="$blobs/${man_dig#sha256:}"

# 3. Fetch the config + every layer blob (digest-verified).
config_dig="$(python3 -c "import sys,json;print(json.load(open(sys.argv[1]))['config']['digest'])" "$man")"
fetch_blob "$config_dig"
python3 -c "import sys,json;[print(l['digest']) for l in json.load(open(sys.argv[1]))['layers']]" "$man" \
  | while read -r ld; do fetch_blob "$ld"; done

# 4. index.json pointing at the arch manifest (the shape `wasm-vm oci unpack` resolves).
python3 - "$out/index.json" "$man_dig" "$arch" <<'PY'
import sys, json
path, dig, arch = sys.argv[1], sys.argv[2], sys.argv[3]
json.dump({
    "schemaVersion": 2,
    "manifests": [{
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "digest": dig, "size": 0,
        "platform": {"architecture": arch, "os": "linux"},
    }],
}, open(path, "w"))
PY

log "done. layout at $out — run: wasm-vm oci unpack $out --out <bundle> --arch $arch"
