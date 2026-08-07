#!/usr/bin/env bash
# Assemble a self-contained, deployable browser demo into web/dist/ — the "dist directory" the
# pre-commit hook commits and poor-mans-ci deploys WITHOUT any CI-side build (that's the whole point:
# the expensive wasm/npm build happens once, locally, and the result rides in git).
#
#   bash tools/build-web-dist.sh
#
# web/dist/ contains everything the site needs to run EXCEPT the large boot artifacts (kernel Image +
# initramfs), which already live in releases/ (tracked) and are copied into the deploy by poor-mans-ci
# at deploy time — so we never duplicate ~22 MB of kernel into git history on every web change.
set -euo pipefail
cd "$(dirname "$0")/.."

DIST=web/dist

echo "[web-dist] building wasm + installing pinned deps (make web-build)…"
make web-build

echo "[web-dist] assembling $DIST …"
rm -rf "$DIST"
mkdir -p "$DIST"

# Top-level app source: js/mjs/html/json, minus build/test scaffolding and the deploy-time manifest.
for f in web/*.js web/*.mjs web/*.html web/*.json; do
  [ -e "$f" ] || continue
  b=$(basename "$f")
  case "$b" in
    package.json | package-lock.json | playwright.config.js | artifacts-alpine.json) continue ;;
  esac
  cp "$f" "$DIST/"
done

# Cloudflare Pages headers file (cross-origin isolation for the JIT). Extensionless, so the glob
# above misses it — copy explicitly into the deploy root.
[ -e web/_headers ] && cp web/_headers "$DIST/_headers"

# App subdirectories that are real source (worker, tailscale connect assets).
[ -d web/tailscale-connect ] && cp -R web/tailscale-connect "$DIST/tailscale-connect"

# The built wasm ES module (from make web-build).
cp -R web/pkg "$DIST/pkg"

# Small runtime assets (guest ELFs, riscv-tests) — NOT web/releases (large; deploy-time copy).
if [ -d web/assets ]; then
  mkdir -p "$DIST/assets"
  cp -R web/assets/. "$DIST/assets/"
  rm -rf "$DIST/assets"/*.elf.tmp 2>/dev/null || true
fi

# Vendor the three @xterm files index.html references into web/dist/vendor/ (NOT node_modules/, which
# .gitignore excludes globally — vendoring avoids a re-include fight) and rewrite the paths in the
# copied index.html so the deployed page loads them from ./vendor/.
mkdir -p "$DIST/vendor/xterm"
cp web/node_modules/@xterm/xterm/lib/xterm.js         "$DIST/vendor/xterm/xterm.js"
cp web/node_modules/@xterm/xterm/css/xterm.css        "$DIST/vendor/xterm/xterm.css"
cp web/node_modules/@xterm/addon-fit/lib/addon-fit.js "$DIST/vendor/xterm/addon-fit.js"
if [ -e "$DIST/index.html" ]; then
  # portable in-place sed (works on both GNU and BSD/macOS sed)
  sed -e 's#\./node_modules/@xterm/xterm/css/xterm\.css#./vendor/xterm/xterm.css#g' \
      -e 's#\./node_modules/@xterm/xterm/lib/xterm\.js#./vendor/xterm/xterm.js#g' \
      -e 's#\./node_modules/@xterm/addon-fit/lib/addon-fit\.js#./vendor/xterm/addon-fit.js#g' \
      "$DIST/index.html" > "$DIST/index.html.tmp" && mv "$DIST/index.html.tmp" "$DIST/index.html"
fi

# Vendor three.js (the landing page's WebGL hero) the same way, and rewrite landing.html's importmap.
if [ -e web/node_modules/three/build/three.module.js ]; then
  mkdir -p "$DIST/vendor/three"
  cp web/node_modules/three/build/three.module.js "$DIST/vendor/three/three.module.js"
  if [ -e "$DIST/landing.html" ]; then
    sed -e 's#\./node_modules/three/build/three\.module\.js#./vendor/three/three.module.js#g' \
        "$DIST/landing.html" > "$DIST/landing.html.tmp" && mv "$DIST/landing.html.tmp" "$DIST/landing.html"
  fi
fi

# DEPLOY-TIME ROOT SWAP: the marketing landing becomes the site root (/) and the app moves to
# /app.html. The SOURCE tree deliberately keeps web/index.html = the APP so the dev server (serves
# web/ at /) and the whole Playwright suite (which goto("/") expecting the app) stay unchanged — the
# swap exists ONLY in the deployed dist. Cross-links are fixed for the deployed layout: in the app,
# the home link (./landing.html) points at /; in the landing, every Launch/CTA (./index.html) points
# at /app.html.
if [ -e "$DIST/landing.html" ] && [ -e "$DIST/index.html" ]; then
  mv "$DIST/index.html" "$DIST/app.html"
  mv "$DIST/landing.html" "$DIST/index.html"
  sed -e 's#\./landing\.html#./#g' "$DIST/app.html" > "$DIST/app.html.tmp" && mv "$DIST/app.html.tmp" "$DIST/app.html"
  sed -e 's#\./index\.html#./app.html#g' -e 's#\./landing\.html#./#g' \
      "$DIST/index.html" > "$DIST/index.html.tmp" && mv "$DIST/index.html.tmp" "$DIST/index.html"
  # Other pages that link to the app by its dev name (index.html) — e.g. docs.html's "Launch" CTA —
  # must point at /app.html in the deployed layout too.
  for f in docs.html; do
    [ -e "$DIST/$f" ] && sed -e 's#\./index\.html#./app.html#g' "$DIST/$f" > "$DIST/$f.tmp" && mv "$DIST/$f.tmp" "$DIST/$f"
  done
  echo "[web-dist] deploy root: / = landing, /app.html = app"
fi

# artifacts.json (relative ./releases/… URLs; poor-mans-ci fills web/dist/releases at deploy).
[ -e web/artifacts.json ] && cp web/artifacts.json "$DIST/"

# E3-T24c: stamp the app-shell service worker with a build version = short content hash of the shell
# bytes that change per build (the wasm + main.js). A new build ⇒ new cache namespace ⇒ the SW's
# `activate` atomically drops the old cache (no half-old/half-new asset set).
if [ -e "$DIST/sw.js" ]; then
  ver=$( { cat "$DIST"/pkg/*_bg.wasm "$DIST/main.js" 2>/dev/null; } | { shasum -a 256 2>/dev/null || sha256sum; } | cut -c1-12 )
  sed -e "s/__SW_VERSION__/${ver}/g" "$DIST/sw.js" > "$DIST/sw.js.tmp" && mv "$DIST/sw.js.tmp" "$DIST/sw.js"
  echo "[web-dist] stamped sw.js app-shell version=${ver}"
fi

# GitHub Pages: don't run Jekyll over the output.
touch "$DIST/.nojekyll"

echo "[web-dist] done — $(du -sh "$DIST" | cut -f1) in $DIST (boot artifacts added at deploy time)"
