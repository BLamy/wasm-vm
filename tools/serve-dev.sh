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
import http.server, os, sys, functools
PORT = int(sys.argv[1])
ROOT = os.getcwd()

class Handler(http.server.SimpleHTTPRequestHandler):
    # Map / -> web/ and /releases/* -> releases/* (artifacts live outside web/).
    def translate_path(self, path):
        p = path.split("?", 1)[0].split("#", 1)[0]
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
        if path.startswith("/releases/") or path.endswith((".wasm", "_bg.wasm")):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith(".wasm"):
            return "application/wasm"
        if path.endswith(".mjs") or path.endswith(".js"):
            return "text/javascript"
        return super().guess_type(path)

httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
print(f"serving web/ (+ /releases) at http://localhost:{PORT}/  (Ctrl-C to stop)")
httpd.serve_forever()
PY
