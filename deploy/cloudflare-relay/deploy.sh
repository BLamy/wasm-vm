#!/usr/bin/env bash
# E5-T43a: build wvrelay as a static linux/amd64 binary on this machine (zig as the C compiler
# and linker), put it in the Container image and deploy the relay Worker to Cloudflare.
#
#   bash deploy/cloudflare-relay/deploy.sh            # build and deploy
#   bash deploy/cloudflare-relay/deploy.sh --secret   # also (re)generate RELAY_HMAC_SECRET
#
# Needs: zig, rustup target x86_64-unknown-linux-musl, Docker with linux/amd64 (OrbStack here),
# `npx wrangler login` with workers and containers scopes. The secret is generated here, sent to
# Cloudflare once, and never written to disk.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
cc=$(mktemp -d)/cc
cat > "$cc" <<'CC'
#!/bin/sh
args=""
for a in "$@"; do
  case "$a" in --target=*|-target) continue ;; esac
  args="$args '$(printf '%s' "$a" | sed "s/'/'\\\\''/g")'"
done
eval exec zig cc -target x86_64-linux-musl $args
CC
chmod +x "$cc"
(cd "$repo" && CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_RUSTFLAGS="-C link-self-contained=no" \
  CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER="$cc" CC_x86_64_unknown_linux_musl="$cc" \
  AR_x86_64_unknown_linux_musl="zig ar" \
  cargo build --release --locked -p wasm-vm-cli --bin wvrelay --target x86_64-unknown-linux-musl)
cp "$repo/target/x86_64-unknown-linux-musl/release/wvrelay" "$here/wvrelay"
cd "$here"
npm ci --no-audit --no-fund >/dev/null
npx wrangler deploy
if [ "${1:-}" = "--secret" ]; then
  openssl rand -hex 32 | npx wrangler secret put RELAY_HMAC_SECRET
fi
