#!/usr/bin/env bash
# E2-T26 capstone: boot unmodified Alpine riscv64 to a login shell IN THE BROWSER.
#
# Builds the wasm bundle + web deps, generates the LOCAL-ONLY Alpine manifest (kernel + the 512 MB
# ext4 rootfs — too big for gh-pages, so served straight from releases/ by the dev server), then
# serves the page and prints the demo script. From a cold clone:
#
#   cargo build --release -p wasm-vm-cli && bash tools/build-rootfs.sh   # if the rootfs is absent
#   bash tools/demo-capstone.sh [PORT]
#
# Then open the URL, click "Boot Alpine", wait for `login:` (~minutes — it is a full OS), log in as
# root (empty password), and run the demo below.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$here"
PORT="${1:-8000}"
kernel="releases/kernel/6.6.63/Image"
rootfs="releases/rootfs/alpine-rootfs.ext4"

command -v wasm-pack >/dev/null || { echo "demo-capstone: wasm-pack not installed" >&2; exit 2; }
[ -f "$kernel" ] || { echo "demo-capstone: missing kernel $kernel" >&2; exit 2; }
if [ ! -f "$rootfs" ]; then
  echo "demo-capstone: rootfs absent — build it: bash tools/build-rootfs.sh" >&2; exit 2
fi

echo "demo-capstone: building web bundle (wasm-pack + npm ci + assets)…" >&2
make web-build >&2

# The local-only manifest is also emitted by E3-T11's production image build. Regenerate it here
# so this standalone demo always pairs the kernel with the exact rootfs on disk.
bash tools/gen-alpine-manifest.sh

cat >&2 <<EOF

────────────────────────────────────────────────────────────────────────────
  CAPSTONE — unmodified Alpine riscv64, in your browser
────────────────────────────────────────────────────────────────────────────
  1. open  http://localhost:${PORT}/
  2. click "Boot Alpine"  → progress bars → boot log in xterm.js → \`login:\`
     (a full OS boot: ~minutes at interpreter speed — the WFI fast-forward helps)
  3. log in:  root   (empty password)
  4. demo:
       vi /root/hello.sh        # write:  for i in 1 2 3; do echo "hi \$i"; done
       sh /root/hello.sh        # → hi 1 / hi 2 / hi 3
       top                      # renders + updates; press ^C to exit
       poweroff                 # OpenRC shutdown → "Power down" → halted-state UI
────────────────────────────────────────────────────────────────────────────
EOF

exec bash tools/serve-dev.sh "$PORT"
