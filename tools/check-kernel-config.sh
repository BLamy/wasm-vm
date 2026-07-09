#!/usr/bin/env bash
# E2-T12 acceptance #3/#4: verify the built kernel config honors the fragment and has no
# modules. Every `X=y` / `X=n` line in configs/wasm-vm.config must appear verbatim in the
# built releases/kernel/<ver>/config; and no `=m` may exist.
#   bash tools/check-kernel-config.sh [version]
set -euo pipefail
cd "$(dirname "$0")/.."

VER="${1:-6.6.63}"
BUILT="releases/kernel/${VER}/config"
FRAG="configs/wasm-vm.config"

[ -f "$BUILT" ] || { echo "no built config at $BUILT — run tools/build-kernel.sh"; exit 2; }

fail=0
while IFS= read -r line; do
  case "$line" in
    ''|\#*) continue ;;                       # skip blanks/comments
  esac
  # Kconfig writes a disabled symbol as `# CONFIG_X is not set`, not `CONFIG_X=n`, and may
  # omit a never-selected one entirely — both satisfy a fragment `CONFIG_X=n`.
  case "$line" in
    CONFIG_*=n)
      sym="${line%=n}"
      if grep -qxF "# ${sym} is not set" "$BUILT" || ! grep -qxF "${sym}=y" "$BUILT"; then
        continue
      fi
      echo "STILL ENABLED: $line"; fail=1 ;;
    *)
      if ! grep -qxF "$line" "$BUILT"; then
        echo "MISSING/DIFFERENT: $line"; fail=1
      fi ;;
  esac
done < "$FRAG"

if grep -q '=m$' "$BUILT"; then
  echo "MODULES PRESENT: $(grep -c '=m$' "$BUILT") symbols set to =m (fragment requires MODULES=n)"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "kernel ${VER} config: fragment honored, no modules ✅"
fi
exit "$fail"
