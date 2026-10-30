#!/usr/bin/env bash
# E0-T29 acceptance: launcher and workspace (with PR 626 recordings and self-checks) on the shared interface.
#
#   bash tools/verify-ui-workspace.sh
#
# Expects `make web-build` and a committed web/dist (tools/build-web-dist.sh). Runs the verified
# E0-T28 foundation acceptance first, then drives the real launcher and workspace against the real
# BusyBox guest. Exits nonzero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "ui-workspace: foundation acceptance (E0-T28)"
bash tools/verify-ui-foundation.sh

# The workspace and its tool panes ship in the same bundle the foundation check just rebuilt.
for needle in 'data-wv-ui="launcher"' 'data-wv-ui="workspace"' 'class="os-launcher-engine" hidden'; do
  grep -q "$needle" web/index.html || { echo "ui-workspace: FAIL: web/index.html lacks $needle" >&2; exit 1; }
  grep -q "$needle" web/dist/app.html || { echo "ui-workspace: FAIL: web/dist/app.html lacks $needle" >&2; exit 1; }
done
grep -q 'launcherReady = "true"' web/main.js || { echo "ui-workspace: FAIL: main.js readiness marker missing" >&2; exit 1; }
echo "ui-workspace: ok   launcher/workspace hosts present in source and dist"

# UI_WORKSPACE_PW_ARGS passes extra Playwright options for a recorded run, e.g.
#   UI_WORKSPACE_PW_ARGS="--trace on --output ../target/e0t29-626/pw" bash tools/verify-ui-workspace.sh
# PW_DISABLE_TS_ESM=1, scoped to this command: Node 24 + the pinned Playwright 1.49.1 deadlock in
# Playwright's TypeScript ESM loader before test discovery. The spec is plain JS.
# ui-foundation-guest-navigation.spec.js is the E0-T28 verifier's promoted real-guest navigation
# test; ui-workspace-recordings.spec.js covers the PR 626 recordings/sessions/self-check panes, the
# header and the carried phone terminal-tap criterion against the real engine.
(cd web && PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-8128}" node node_modules/playwright/cli.js test \
  tests/ui-foundation-guest-navigation.spec.js tests/ui-workspace.spec.js tests/ui-workspace-contracts.spec.js \
  tests/ui-workspace-recordings.spec.js --reporter=list ${UI_WORKSPACE_PW_ARGS:-})
echo "ui-workspace: ok   browser checks"
echo "ui-workspace: PASS"
