#!/usr/bin/env bash
# E0-T28 acceptance: the shared interface foundation (web/ui → web/ui.js, web/ui.css, web/ui-assets).
#
#   bash tools/verify-ui-foundation.sh
#
# Expects `make web-build` (installs the lockfile, builds the bundle) and, for the deploy checks, a
# committed web/dist from tools/build-web-dist.sh. Exits nonzero on the first failed check.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "ui-foundation: FAIL: $*" >&2; exit 1; }
ok() { echo "ui-foundation: ok   $*"; }
sha() { { shasum -a 256 2>/dev/null || sha256sum; } | cut -c1-64; }

# 1. Pinned library, React 19, reproducible lock.
node - <<'JS' || fail "dependency pins"
const pkg = require("./web/package.json"), lock = require("./web/package-lock.json");
const want = { "@brett_lamy/ui": "5.10.1", react: "19.3.0", "react-dom": "19.3.0", "react-aria": "3.53.1" };
for (const [name, version] of Object.entries(want)) {
  if (pkg.dependencies[name] !== version) throw new Error(`${name} must be pinned to ${version}, got ${pkg.dependencies[name]}`);
  const entry = lock.packages[`node_modules/${name}`];
  if (!entry || entry.version !== version || !entry.integrity) throw new Error(`lock entry for ${name} is not ${version} with integrity`);
}
const ui = lock.packages["node_modules/@brett_lamy/ui"];
if (ui.integrity !== "sha512-cGWgu3XGzuXr8zIcztg/X56F4UV/t93hVezPWNEYDadQVHkiWLQenWnrD+F7+FNiMQCbc4muI3kMUpkcx714jQ==")
  throw new Error("@brett_lamy/ui integrity differs from the registry's 5.10.1 tarball");
const dupes = Object.keys(lock.packages).filter((p) => /node_modules\/(react|react-dom|react-aria)$/.test(p) && p.split("node_modules/").length > 2);
if (dupes.length) throw new Error(`nested copies would split React/react-aria context: ${dupes}`);
JS
ok "pins: @brett_lamy/ui 5.10.1, react 19.3.0, single react/react-dom/react-aria"

# 2. Deterministic build: two builds, identical bytes.
digest() { cat web/ui.js web/ui.css $(ls web/ui-assets/* | LC_ALL=C sort) | sha; }
(cd web && npm run --silent build:ui) >/dev/null
first=$(digest)
(cd web && npm run --silent build:ui)
second=$(digest)
[ "$first" = "$second" ] || fail "two builds differ ($first vs $second)"
ok "deterministic build digest $second"

# 3. Tree-shaking: only what the islands import ships.
node - <<'JS' || fail "bundle contents"
const meta = require("./target/ui-build/metafile.json");
const shipped = Object.entries(meta.outputs["ui.js"].inputs).filter(([, v]) => v.bytesInOutput > 0).map(([p]) => p);
const banned = /node_modules\/(@tiptap|@brett_lamy\/docstream|@brett_lamy\/docstream-editor|katex|rrweb|@electric-sql|@agent-wasm|@pierre|perfect-freehand|gpu-cron|gpu-time|gpu-lexer|cronstrue)\//;
const leaked = shipped.filter((p) => banned.test(p));
if (leaked.length) throw new Error(`unused heavy dependencies shipped: ${leaked.slice(0, 5)}`);
const css = Object.keys(meta.outputs["ui.css"].inputs);
const cssLeak = css.filter((p) => /katex|rrweb|docstream/.test(p) && meta.outputs["ui.css"].inputs[p].bytesInOutput > 0);
if (cssLeak.length) throw new Error(`unused stylesheets shipped: ${cssLeak}`);
const lib = shipped.filter((p) => p.includes("@brett_lamy/ui/dist/"));
for (const need of ["lib/theme.js", "components/button.js", "components/dialog.js", "components/list.js", "components/segmented.js", "components/select.js", "components/switch.js", "components/text-field.js", "components/sheet.js"])
  if (!lib.some((p) => p.endsWith(need))) throw new Error(`library module missing from bundle: ${need}`);
console.log(`  ${lib.length} library modules shipped`);
JS
ok "tree-shaken bundle (no editor, markdown, math, replay, storage or networking code)"

# 4. Offline asset model: no remote URLs in the stylesheet, fonts served from this origin.
if grep -Eo 'url\([^)]*\)' web/ui.css | grep -Eq 'https?:|//'; then fail "ui.css references a remote URL"; fi
for f in $(grep -Eo 'url\(ui-assets/[^)]+\)' web/ui.css | sed -E 's/^url\((.*)\)$/\1/' | sort -u); do
  [ -s "web/$f" ] || fail "ui.css references missing $f"
done
grep -q 'IBM Plex Sans' web/ui.css || fail "type face missing"
ok "self-hosted assets only"

# 5. No decorative effects in our own styles.
if grep -Eqi 'gradient\(|text-shadow|0 0 [0-9]+px (#|rgb)' web/ui/src/*.css; then fail "decorative gradient/glow in web/ui/src"; fi
ok "no gradients or glows in web/ui/src"

# 6. Pages reference the bytes they get.
js_rev=$(sha < web/ui.js | cut -c1-12); css_rev=$(sha < web/ui.css | cut -c1-12)
for page in web/index.html web/ui-kit.html; do
  grep -q "./ui.js?rev=$js_rev" "$page" || fail "$page does not reference ui.js?rev=$js_rev"
  grep -q "./ui.css?rev=$css_rev" "$page" || fail "$page does not reference ui.css?rev=$css_rev"
done
ok "source pages stamped with current revs"

# 7. Deploy bundle: root swap applied to the route table, revs name shipped bytes, SW versioned.
D=web/dist
[ -s "$D/ui.js" ] && [ -s "$D/ui.css" ] && [ -d "$D/ui-assets" ] || fail "web/dist lacks the interface bundle (run make web-dist)"
cmp -s web/ui.css "$D/ui.css" || fail "web/dist/ui.css is stale"
diff -rq web/ui-assets "$D/ui-assets" >/dev/null || fail "web/dist/ui-assets is stale"
grep -q '\./app\.html#ide' "$D/ui.js" || fail "dist ui.js lacks ./app.html#ide"
if grep -Eq '\./(index|landing)\.html' "$D/ui.js"; then fail "dist ui.js still links source page names"; fi
sed -e 's#\./index\.html#./app.html#g' -e 's#\./landing\.html#./#g' web/ui.js | cmp -s - "$D/ui.js" || fail "web/dist/ui.js is not the root-swapped build"
dist_js_rev=$(sha < "$D/ui.js" | cut -c1-12)
for page in "$D/app.html" "$D/ui-kit.html"; do
  grep -q "./ui.js?rev=$dist_js_rev" "$page" || fail "$page does not reference the shipped ui.js"
  grep -q "./ui.css?rev=$css_rev" "$page" || fail "$page does not reference the shipped ui.css"
done
if grep -q '__SW_VERSION__' "$D/sw.js"; then fail "dist sw.js not version-stamped"; fi
ok "deploy bundle: swapped routes, exact revs, stamped service worker"

# 8. Browser: the library controls render, operate, isolate from legacy CSS, and work on a phone.
# PW_DISABLE_TS_ESM=1, scoped to this command: Node 24 + the pinned Playwright 1.49.1 deadlock in
# Playwright's TypeScript ESM loader before test discovery (even `--list` hangs at 0% CPU). The
# spec is plain JS and needs no TS transform. Do not upgrade Playwright for this task.
(cd web && PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-8125}" node node_modules/playwright/cli.js test tests/ui-foundation.spec.js --reporter=list)
ok "browser checks"
echo "ui-foundation: PASS"
