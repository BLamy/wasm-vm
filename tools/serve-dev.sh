#!/usr/bin/env bash
# E2-T21: dev server for the browser page. Serves `web/` at / and `releases/` at /releases with
# the headers the loader needs: `application/wasm` for the module (WebAssembly.instantiate-
# Streaming requires it), long immutable caching for the content-hashed boot artifacts, and
# cross-origin isolation headers (harmless now; required once Epic 4 uses SharedArrayBuffer).
#
#   bash tools/serve-dev.sh [PORT]   # default 8000, then open http://localhost:PORT/
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8000}"

python3 - "$PORT" <<'PY'
import http.server, os, re, sys, functools
PORT = int(sys.argv[1])
ROOT = os.getcwd()
NODE_ASSET_ROOT = os.environ.get("E4T32_NODE_ASSET_DIR", "").strip()
if NODE_ASSET_ROOT:
    NODE_ASSET_ROOT = os.path.realpath(NODE_ASSET_ROOT)
    if not os.path.isfile(os.path.join(NODE_ASSET_ROOT, "manifest.json")):
        raise SystemExit(f"E4T32_NODE_ASSET_DIR has no manifest.json: {NODE_ASSET_ROOT}")
    if not os.path.isdir(os.path.join(NODE_ASSET_ROOT, "chunks")):
        raise SystemExit(f"E4T32_NODE_ASSET_DIR has no chunks/: {NODE_ASSET_ROOT}")
DESKTOP_ASSET_ROOT = os.environ.get("E5_T18A_DESKTOP_ASSET_DIR", "").strip()
if DESKTOP_ASSET_ROOT:
    DESKTOP_ASSET_ROOT = os.path.realpath(DESKTOP_ASSET_ROOT)
    if not os.path.isfile(os.path.join(DESKTOP_ASSET_ROOT, "manifest.json")):
        raise SystemExit(f"E5_T18A_DESKTOP_ASSET_DIR has no manifest.json: {DESKTOP_ASSET_ROOT}")
    if not os.path.isdir(os.path.join(DESKTOP_ASSET_ROOT, "chunks")):
        raise SystemExit(f"E5_T18A_DESKTOP_ASSET_DIR has no chunks/: {DESKTOP_ASSET_ROOT}")
DESKTOP_T18B_ASSET_ROOT = os.environ.get("E5_T18B_DESKTOP_ASSET_DIR", "").strip()
if DESKTOP_T18B_ASSET_ROOT:
    DESKTOP_T18B_ASSET_ROOT = os.path.realpath(DESKTOP_T18B_ASSET_ROOT)
    if not os.path.isfile(os.path.join(DESKTOP_T18B_ASSET_ROOT, "manifest.json")):
        raise SystemExit(f"E5_T18B_DESKTOP_ASSET_DIR has no manifest.json: {DESKTOP_T18B_ASSET_ROOT}")
    if not os.path.isdir(os.path.join(DESKTOP_T18B_ASSET_ROOT, "chunks")):
        raise SystemExit(f"E5_T18B_DESKTOP_ASSET_DIR has no chunks/: {DESKTOP_T18B_ASSET_ROOT}")
WARM_ASSET_ROOT = os.environ.get("E4T34_WARM_ASSET_DIR", "").strip()
if WARM_ASSET_ROOT:
    WARM_ASSET_ROOT = os.path.realpath(WARM_ASSET_ROOT)
    for name in ("candidate.snap.gz", "candidate.overlay-delta.bin.gz"):
        if not os.path.isfile(os.path.join(WARM_ASSET_ROOT, name)):
            raise SystemExit(f"E4T34_WARM_ASSET_DIR has no {name}: {WARM_ASSET_ROOT}")
GCC_OVERLAY = os.path.realpath(os.path.join(ROOT, "bench", "guest", "gcc.ext4"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # A single Node process touches hundreds of verified chunks. Keep Playwright evidence
        # readable while retaining manifest/page/error requests in the server transcript.
        if self.path.split("?", 1)[0].startswith(
            "/e4t32-node-assets/chunked-node-alpine/chunks/"
        ):
            return
        super().log_message(format, *args)

    # Map / -> web/ and /releases/* -> releases/* (artifacts live outside web/).
    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
        # E4-T32 CPU-parity evidence serves a verified immutable copy of the deployed Node chunk
        # store from the same origin. Keep this route deliberately closed: only the manifest and
        # content-addressed chunk names can escape into the external cache directory.
        node_prefix = "/e4t32-node-assets/chunked-node-alpine/"
        if NODE_ASSET_ROOT and p.startswith(node_prefix):
            rel = p[len(node_prefix):]
            if rel == "manifest.json" or re.fullmatch(r"chunks/[0-9a-f]{64}\.bin", rel):
                return os.path.join(NODE_ASSET_ROOT, *rel.split("/"))
            return os.path.join(NODE_ASSET_ROOT, ".not-found")
        # E5-T18a: serve the exact T17 desktop chunk publication selected by the verifier. Keep
        # this route closed to the manifest, optional boot profile, and content-addressed chunks;
        # an arbitrary path must never turn the dev server into a file browser.
        desktop_prefix = "/e5t18a-desktop/"
        if DESKTOP_ASSET_ROOT and p.startswith(desktop_prefix):
            rel = p[len(desktop_prefix):]
            if rel in ("manifest.json", "boot-profile.json") or re.fullmatch(r"chunks/[0-9a-f]{64}\.bin", rel):
                return os.path.join(DESKTOP_ASSET_ROOT, *rel.split("/"))
            return os.path.join(DESKTOP_ASSET_ROOT, ".not-found")
        # E5-T18b: keep the interactive terminal proof on its own immutable asset route so its
        # exact launcher-enabled image cannot be confused with T18a's cold-boot publication.
        desktop_b_prefix = "/e5t18b-desktop/"
        if DESKTOP_T18B_ASSET_ROOT and p.startswith(desktop_b_prefix):
            rel = p[len(desktop_b_prefix):]
            if rel in ("manifest.json", "boot-profile.json") or re.fullmatch(r"chunks/[0-9a-f]{64}\.bin", rel):
                return os.path.join(DESKTOP_T18B_ASSET_ROOT, *rel.split("/"))
            return os.path.join(DESKTOP_T18B_ASSET_ROOT, ".not-found")
        warm_prefix = "/e4t34-warm-assets/"
        if WARM_ASSET_ROOT and p.startswith(warm_prefix):
            rel = p[len(warm_prefix):]
            if rel in ("candidate.snap.gz", "candidate.overlay-delta.bin.gz"):
                return os.path.join(WARM_ASSET_ROOT, rel)
            return os.path.join(WARM_ASSET_ROOT, ".not-found")
        if p == "/gcc-overlay/gcc.ext4":
            # E4-T28e only: this is a local, gitignored benchmark input. A fresh checkout that has
            # not run bench/mk-gcc-image.sh gets a normal 404; it must never silently substitute a
            # different toolchain image.
            return GCC_OVERLAY if os.path.isfile(GCC_OVERLAY) else os.path.join(ROOT, "web", ".not-found")
        if p.startswith("/releases/"):
            return os.path.join(ROOT, p.lstrip("/"))
        return os.path.join(ROOT, "web", p.lstrip("/"))

    def end_headers(self):
        # Cross-origin isolation (no-op today; SAB needs it in Epic 4).
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        path = self.path.split("?", 1)[0]
        # guess_type() below already emits the one authoritative Content-Type. Adding it here too
        # produces a comma-joined duplicate that Chromium rejects for instantiateStreaming().
        # Content-hashed artifacts + the wasm bundle are immutable → cache hard.
        if path.startswith(("/releases/", "/e4t32-node-assets/", "/e5t18a-desktop/", "/e5t18b-desktop/", "/e4t34-warm-assets/")) or path.endswith((".wasm", "_bg.wasm")):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".wasm"):
            return "application/wasm"
        if path.endswith(".mjs") or path.endswith(".js"):
            return "text/javascript"
        return super().guess_type(path)

httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
extra = f" + E4-T32 Node assets from {NODE_ASSET_ROOT}" if NODE_ASSET_ROOT else ""
if DESKTOP_ASSET_ROOT:
    extra += f" + E5-T18a desktop assets from {DESKTOP_ASSET_ROOT}"
if DESKTOP_T18B_ASSET_ROOT:
    extra += f" + E5-T18b desktop assets from {DESKTOP_T18B_ASSET_ROOT}"
if WARM_ASSET_ROOT:
    extra += f" + E4-T34 warm candidate from {WARM_ASSET_ROOT}"
print(f"serving web/ (+ /releases){extra} at http://localhost:{PORT}/  (Ctrl-C to stop)")
httpd.serve_forever()
PY
