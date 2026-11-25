#!/usr/bin/env bash
# Serve the COMMITTED deployable (web/dist) exactly as it is in the tree, with releases/ mounted at
# /releases — the local stand-in for the live site, for verifying a built page without touching the
# working copy of web/ (tools/serve-dev.sh serves the source tree instead).
#
#   bash tools/serve-dist.sh [PORT] [ROOT]   # default 8125 and web/dist; the app is /app.html
#
# ROOT may name another web root, e.g. `web` to serve a source tree whose release artifacts live in
# a different checkout (the app is then /).
#
# RELEASES (default ./releases) may point at another checkout that holds the large gitignored
# artifacts. Nothing is copied or linked into web/dist.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8125}"
RELEASES="${RELEASES:-releases}"
ROOT="${2:-web/dist}"
python3 - "$PORT" "$(cd "$ROOT" && pwd)" "$(cd "$RELEASES" && pwd)" <<'PY'
import functools, http.server, os, sys
port, dist, releases = int(sys.argv[1]), sys.argv[2], sys.argv[3]

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm", ".mjs": "text/javascript"}
    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean == "/releases" or clean.startswith("/releases/"):
            target = os.path.realpath(os.path.join(releases, clean[len("/releases"):].lstrip("/")))
            return target if target == releases or target.startswith(releases + os.sep) else os.path.join(dist, "404.html")
        return super().translate_path(path)
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=dist))
print(f"serving {dist} (+ /releases -> {releases}) on http://127.0.0.1:{port}/app.html", flush=True)
server.serve_forever()
PY
