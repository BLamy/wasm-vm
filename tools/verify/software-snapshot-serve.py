#!/usr/bin/env python3
"""Serve the unchanged built app and release inputs for computer-use warm launch proof."""
import http.server, json, sys
from pathlib import Path
from urllib.parse import unquote, urlsplit
ROOT=Path(__file__).resolve().parents[2]
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map={**http.server.SimpleHTTPRequestHandler.extensions_map, '.js':'text/javascript', '.mjs':'text/javascript', '.wasm':'application/wasm'}
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy','same-origin')
        self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def do_GET(self):
        if urlsplit(self.path).path == '/favicon.ico':
            self.send_response(204); self.end_headers(); return
        super().do_GET()
    def translate_path(self, path):
        rel=unquote(urlsplit(path).path).lstrip('/')
        if rel in ('app','app.html'): rel='app.html'
        base=ROOT if rel.startswith('releases/') else ROOT/'web/dist'
        candidate=(base/rel).resolve()
        return str(candidate if candidate.is_relative_to(base) else base/'.not-found')
port=int(sys.argv[1]) if len(sys.argv)>1 else 8774
server=http.server.ThreadingHTTPServer(('127.0.0.1',port),Handler)
print(json.dumps({'port':server.server_address[1],'root':str(ROOT),'purpose':'built software warm launch; no cold boot or replay'}),flush=True)
server.serve_forever()
