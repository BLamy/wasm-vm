#!/usr/bin/env bash
# oci-sideload.sh — pull a public OCI image for a target arch into a local OCI image-layout that
# `wasm-vm oci unpack` consumes. This is the dev-side "get the image in" step for the E3.5 runner
# path (→ `wvrun postgres`): no built-in registry client / new Rust HTTP dependency, just curl +
# python3 (already required by the build tooling). Works with ANY standard Docker v2 registry —
# Docker Hub, ghcr.io, quay.io, gcr.io, public.ecr.aws, localhost:5000 — via the standard
# `WWW-Authenticate` token challenge; anonymous pull only (no login).
#
# Usage:  tools/oci-sideload.sh [<host>/]<repo>[:<tag>] <out-dir> [<arch>]
#   e.g.  tools/oci-sideload.sh busybox              /tmp/busybox-oci
#         tools/oci-sideload.sh postgres:16          /tmp/pg-oci        riscv64
#         tools/oci-sideload.sh quay.io/foo/bar:1.2  /tmp/bar-oci       riscv64
#         tools/oci-sideload.sh ghcr.io/owner/img    /tmp/img-oci       riscv64
#
# Output layout (standard OCI image-layout):
#   <out-dir>/index.json
#   <out-dir>/blobs/sha256/<hex>          (manifest + config + every layer, digest-named)
#
# EVERY blob is sha256-verified against its digest as it lands — a registry that serves wrong bytes
# fails here, not silently downstream. Re-running is idempotent: an already-present, verifying blob
# is not re-downloaded (a poor-man's cache; the real digest-deduped browser cache is E3.5-T04).
set -euo pipefail

log() { printf '[sideload] %s\n' "$*" >&2; }

# ── Parse [host/]repo[:tag] the way Docker does — pure, unit-tested via `--selftest` ──
# The first `/`-segment is a REGISTRY HOST iff it has a `.` or `:` or is `localhost`; otherwise the
# registry is Docker Hub and the whole thing is the repo (bare official names get `library/`).
# Echoes `HOST|repo|tag|REG_HOST`. Supports ghcr.io / quay.io / gcr.io / public.ecr.aws /
# localhost:5000 / … — any standard Docker v2 registry.
parse_ref() {
  local ref="$1" first rest host repo tag reg_host
  # A host only exists if there's a `/` AND the first segment looks like one — otherwise the ref is a
  # Docker Hub bare name that may itself contain a `:tag` (e.g. `nginx:1.27`, which must NOT be read
  # as host `nginx:1.27`).
  case "$ref" in
    */*)
      first="${ref%%/*}"
      case "$first" in
        *.*|*:*|localhost) host="$first"; rest="${ref#*/}" ;;
        *)                 host="docker.io"; rest="$ref" ;;
      esac ;;
    *) host="docker.io"; rest="$ref" ;;
  esac
  # A colon is a tag separator only in the LAST path segment (so a `host:port` or a `/`-bearing repo
  # isn't mis-split).
  case "${rest##*/}" in
    *:*) tag="${rest##*:}"; repo="${rest%:*}" ;;
    *)   tag="latest"; repo="$rest" ;;
  esac
  [ "$host" = docker.io ] && case "$repo" in */*) : ;; *) repo="library/$repo" ;; esac
  case "$host" in docker.io) reg_host="registry-1.docker.io" ;; *) reg_host="$host" ;; esac
  printf '%s|%s|%s|%s' "$host" "$repo" "$tag" "$reg_host"
}

# `--selftest`: deterministic ref-parsing assertions (no network), so CI catches host/repo/tag bugs.
if [ "${1:-}" = "--selftest" ]; then
  f=0; ck() { g=$(parse_ref "$1"); [ "$g" = "$2" ] && echo "PASS $1 → $g" || { echo "FAIL $1 → $g (want $2)"; f=1; }; }
  ck busybox                    "docker.io|library/busybox|latest|registry-1.docker.io"
  ck nginx:1.27                 "docker.io|library/nginx|1.27|registry-1.docker.io"
  ck user/img                   "docker.io|user/img|latest|registry-1.docker.io"
  ck ghcr.io/owner/img          "ghcr.io|owner/img|latest|ghcr.io"
  ck quay.io/podman/hello:v1.2  "quay.io|podman/hello|v1.2|quay.io"
  ck gcr.io/proj/sub/img:tag    "gcr.io|proj/sub/img|tag|gcr.io"
  ck localhost:5000/img:v2      "localhost:5000|img|v2|localhost:5000"
  ck "busybox:"                 "docker.io|library/busybox||registry-1.docker.io"  # empty tag → rejected at runtime
  [ "$f" = 0 ] && echo "PARSE SELFTEST OK" || echo "PARSE SELFTEST FAILED"; exit "$f"
fi

ref="${1:?usage: oci-sideload.sh [<host>/]<repo>[:<tag>] <out-dir> [<arch>]}"
out="${2:?usage: oci-sideload.sh [<host>/]<repo>[:<tag>] <out-dir> [<arch>]}"
arch="${3:-riscv64}"

# Digest-pinned refs (`repo@sha256:…`) aren't supported (we resolve tags → arch manifest ourselves).
case "$ref" in
  *@*) echo "[sideload] digest-pinned refs (repo@sha256:…) unsupported — use a tag" >&2; exit 2 ;;
esac

IFS='|' read -r HOST repo tag REG_HOST <<EOF
$(parse_ref "$ref")
EOF
REG="https://$REG_HOST"
# A trailing colon (`busybox:`) yields an empty tag → a malformed `…/manifests/` request; reject it
# with a clear message instead of a confusing 404 (critic MINOR).
[ -n "$tag" ] || { echo "[sideload] empty tag in ref '$ref' (trailing ':') — omit the colon or give a tag" >&2; exit 2; }

blobs="$out/blobs/sha256"
mkdir -p "$blobs"

MTYPES="application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"

# Auth via the STANDARD Docker v2 challenge, ON THE ACTUAL REQUEST (not a pre-probe — quay allows an
# unauthenticated HEAD but 401s the GET, so the challenge must be read from the real response): make
# the request; on a 401, parse `WWW-Authenticate: Bearer realm=…,service=…,scope=…` from THAT
# response and fetch a token from its realm. Works for any compliant registry (Docker Hub / ghcr /
# quay / gcr / …) without hardcoding endpoints. A no-auth registry (200, no challenge) leaves TOK "".
TOK=""
log "registry=$REG_HOST repo=$repo tag=$tag"

# Given a `WWW-Authenticate: Bearer …` line, fetch a pull token into TOK. Returns non-zero if the
# challenge has no realm.
token_from_challenge() {
  local chal="$1" realm service scope q
  realm=$(printf '%s' "$chal"   | sed -n 's/.*realm="\([^"]*\)".*/\1/p')
  service=$(printf '%s' "$chal" | sed -n 's/.*service="\([^"]*\)".*/\1/p')
  scope=$(printf '%s' "$chal"   | sed -n 's/.*scope="\([^"]*\)".*/\1/p')
  [ -n "$scope" ] || scope="repository:$repo:pull"
  [ -n "$realm" ] || { log "auth challenge without a realm: $chal"; return 1; }
  # The realm URL is ATTACKER-CONTROLLED (it comes from the registry's challenge). Require https and
  # forbid redirects + non-http protocols so a malicious registry can't point it at `file:///…`
  # (local-file read → token exfil) or an internal URL (SSRF) — critic MAJOR.
  case "$realm" in https://*) ;; *) log "refusing non-https auth realm: $realm"; return 1 ;; esac
  q="scope=$scope"; [ -n "$service" ] && q="service=$service&$q"
  # ghcr returns {"token":…}; some registries use {"access_token":…}. Accept either.
  TOK=$(curl -fsS --proto '=https' --max-redirs 0 "$realm?$q" 2>/dev/null \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('token') or d.get('access_token') or '')")
}

# sha256 of a file, portable across macOS (shasum) and Linux (sha256sum).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# GET a registry URL into $2. On a 401 (no/expired token — includes the FIRST request, which carries
# the empty initial token), read the auth challenge from that response, fetch a token, and retry
# once. This both bootstraps auth and survives a mid-pull token expiry (Docker Hub tokens ~300s; the
# multi-layer postgres pull can outlast one). Returns non-zero (and logs) on any non-2xx.
authed_get() {
  local url="$1" dst="$2" code hdr chal
  hdr=$(mktemp)
  code=$(curl -sSL -H "Authorization: Bearer $TOK" -H "Accept: $MTYPES" -D "$hdr" -w '%{http_code}' -o "$dst" "$url" || true)
  if [ "$code" = "401" ]; then
    chal=$(tr -d '\r' < "$hdr" | grep -i '^www-authenticate:' | head -1 || true)
    if [ -n "$chal" ] && token_from_challenge "$chal"; then
      code=$(curl -sSL -H "Authorization: Bearer $TOK" -H "Accept: $MTYPES" -w '%{http_code}' -o "$dst" "$url" || true)
    fi
  fi
  rm -f "$hdr"
  case "$code" in 2*) return 0 ;; *) log "GET $url → HTTP $code"; return 1 ;; esac
}

# Download a blob by digest into blobs/sha256/<hex>, verifying the digest. Skips if already valid.
fetch_blob() {
  local digest="$1" hex dst got
  hex="${digest#sha256:}"; dst="$blobs/$hex"
  if [ -f "$dst" ] && [ "$(sha256_of "$dst")" = "$hex" ]; then log "cache hit  $digest"; return 0; fi
  log "download   $digest"
  authed_get "$REG/v2/$repo/blobs/$digest" "$dst" || { rm -f "$dst"; exit 2; }
  got="$(sha256_of "$dst")"
  if [ "$got" != "$hex" ]; then log "DIGEST MISMATCH for $digest (got sha256:$got)"; rm -f "$dst"; exit 3; fi
}

# Fetch a manifest document by reference (tag OR digest), store it as a blob, echo its digest.
# When the ref IS a digest (the arch manifest picked out of the index), VERIFY the received bytes
# hash to it — the index→manifest integrity link (critic MAJOR: this was previously unchecked, so a
# corrupted/lying manifest was accepted and dictated which config/layer digests got pulled). A
# tag-fetched top document has no committed digest, so it is content-named without a check.
fetch_manifest_blob() {
  local ref="$1" tmp hex
  tmp="$(mktemp)"
  authed_get "$REG/v2/$repo/manifests/$ref" "$tmp" || { rm -f "$tmp"; exit 2; }
  hex="$(sha256_of "$tmp")"
  case "$ref" in
    sha256:*)
      if [ "sha256:$hex" != "$ref" ]; then
        log "MANIFEST DIGEST MISMATCH: want $ref got sha256:$hex"; rm -f "$tmp"; exit 3
      fi ;;
  esac
  mv "$tmp" "$blobs/$hex"; echo "sha256:$hex"
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
