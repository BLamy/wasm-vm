#!/usr/bin/env bash
# E0-T30 acceptance: homepage, case studies and public pages on the shared interface.
#
#   bash tools/verify-ui-public.sh
#
# Expects `make web-build` and a committed web/dist (tools/build-web-dist.sh). Runs the verified
# E0-T29 workspace acceptance first (it runs E0-T28's foundation acceptance), because this task
# changes the shared nav, provider styles and primitives the app uses. Then checks the preview
# deploy switch without deploying, the docs corpus and packaging, the public flows in a browser, and
# the built, root-swapped web/dist. Exits nonzero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "ui-public: FAIL: $*" >&2; exit 1; }

echo "ui-public: workspace acceptance (E0-T29, includes E0-T28)"
bash tools/verify-ui-workspace.sh

# Preview deploys: PAGES_BRANCH defaults to production `main`; anything else is a preview alias.
# DEPLOY_PRINT_ONLY stops before building, credentials or upload.
deploy() { env -u PAGES_BRANCH DEPLOY_PRINT_ONLY=1 "$@" bash tools/deploy-cloudflare.sh 2>&1; }
out=$(deploy) || fail "default deploy plan exited nonzero"
grep -q "^\[deploy\] target: production (branch 'main')" <<<"$out" || fail "default target is not production: $out"
grep -q -- "--branch main --commit-dirty=true" <<<"$out" || fail "default command does not deploy main: $out"
[ "$(deploy PAGES_BRANCH=main)" = "$out" ] || fail "PAGES_BRANCH=main differs from the default"
out=$(deploy PAGES_BRANCH=ui-redesign/Preview_1) || fail "preview deploy plan exited nonzero"
grep -q "^\[deploy\] target: preview branch 'ui-redesign/Preview_1' (production untouched)" <<<"$out" || fail "preview target misnamed: $out"
grep -q "^\[deploy\] url: https://ui-redesign-preview-1.wasm-vm.pages.dev" <<<"$out" || fail "preview url wrong: $out"
grep -q -- "--branch ui-redesign/Preview_1 --commit-dirty=true" <<<"$out" || fail "preview command wrong: $out"
for bad in "bad branch" "-x" "../up"; do
  set +e; deploy PAGES_BRANCH="$bad" >/dev/null; code=$?; set -e
  [ "$code" = 2 ] || fail "PAGES_BRANCH='$bad' was not rejected (exit $code)"
done
echo "ui-public: ok   deploy defaults to production; PAGES_BRANCH previews; invalid names rejected"

# The public pages load the shared interface; the decorative shader and marketing sheet are gone.
[ ! -e web/landing.js ] && [ ! -e web/marketing.css ] || fail "retired landing.js / marketing.css still present"
for page in landing roadmap products work-market security 404 case-studies case-study-riscv-os case-study-ai-sandboxing case-study-deterministic-simulation; do
  grep -q 'data-wv-ui="site-nav"' "web/$page.html" || fail "web/$page.html lacks the shared nav"
  grep -q '\./ui\.js?rev=' "web/$page.html" || fail "web/$page.html does not load ui.js"
  grep -q 'marketing\.css' "web/$page.html" && fail "web/$page.html still loads marketing.css"
done
echo "ui-public: ok   public pages on the shared interface"

echo "ui-public: docs corpus and packaging"
node tools/check-docs.mjs
python3 tools/check-docs-dist.py web/dist >/dev/null
echo "ui-public: ok   docs corpus and dist packaging"

# UI_PUBLIC_PW_ARGS passes extra Playwright options for a recorded run (as UI_WORKSPACE_PW_ARGS
# does for the workspace stage), e.g. "--trace on --output ../target/e0t30-626/pw-public".
# PW_DISABLE_TS_ESM=1, scoped to this command: Node 24 + the pinned Playwright 1.49.1 deadlock in
# Playwright's TypeScript ESM loader before test discovery. The specs are plain JS.
(cd web && PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-8128}" node node_modules/playwright/cli.js test \
  tests/ui-public.spec.js tests/landing-hero.spec.js tests/benchmarks-home.spec.js --reporter=list ${UI_PUBLIC_PW_ARGS:-})
echo "ui-public: ok   browser checks"

node tools/check-ui-public-dist.mjs web/dist
echo "ui-public: PASS"
