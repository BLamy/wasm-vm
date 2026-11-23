#!/usr/bin/env bash
# Shallow, no-history sync of Replay Chromium 157 for a linux/riscv64 cross build (E5-T32a prep).
set -euo pipefail
ROOT=/opt/replay-chromium-157
BRANCH=157.0.8103.0-replay
mkdir -p "$ROOT"; cd "$ROOT"
[ -d depot_tools ] || git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git depot_tools
export PATH="$ROOT/depot_tools:$PATH" DEPOT_TOOLS_UPDATE=0 DEPOT_TOOLS_METRICS=0 VPYTHON_BYPASS="manually managed python not supported by chrome operations"
git config --global --add safe.directory '*'
if [ ! -d src/.git ]; then
  git clone --depth 1 --single-branch --branch "$BRANCH" https://github.com/replayio/chromium.git src
fi
cat > .gclient <<'G'
solutions = [{
  "name": "src",
  "url": "https://github.com/replayio/chromium.git",
  "managed": False,
  "custom_deps": {},
  "custom_vars": {"checkout_nacl": False, "checkout_pgo_profiles": False},
}]
target_os = ["linux"]
target_cpu = ["riscv64"]
G
echo "src head: $(git -C src rev-parse HEAD)"
gclient sync --nohooks --noprehooks --no-history --shallow --jobs=12 -D
echo SYNC-DONE
df -h /opt | tail -1
du -sh "$ROOT/src"
