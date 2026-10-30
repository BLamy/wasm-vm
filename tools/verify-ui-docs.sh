#!/usr/bin/env bash
# E0-T32 acceptance: the docs reader on Docstream 1.33 and the current field guide.
#
#   bash tools/verify-ui-docs.sh
#
# Expects `make web-build` and a committed web/dist (tools/build-web-dist.sh). Runs the verified
# E0-T30 public acceptance first (it runs E0-T29 and E0-T28): this task changes the shared package
# lock, the reader bundle and the docs pages those gates load. Then checks the Docstream pin, the
# reader bundle (one React, the library's site search and Pele, no remote code), the corpus with its
# current references and search alignment (tools/check-docs.mjs), and drives the reader
# (web/tests/ui-docs.spec.js). Exits nonzero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "ui-docs: FAIL: $*" >&2; exit 1; }

echo "ui-docs: public acceptance (E0-T30, includes E0-T29 and E0-T28)"
bash tools/verify-ui-public.sh

# Exact package pin and registry integrity; the shared library and React stay single copies.
node - <<'JS' || fail "Docstream pin"
const pkg = require("./web/package.json"), lock = require("./web/package-lock.json");
const want = "1.33.0";
if (pkg.dependencies["@brett_lamy/docstream"] !== want) throw new Error(`package.json pins ${pkg.dependencies["@brett_lamy/docstream"]}`);
const entry = lock.packages["node_modules/@brett_lamy/docstream"];
if (!entry || entry.version !== want || entry.integrity !== "sha512-oqUbekznRyVuKtOSFbh+CtkfrPfOn9nTQLGc31K7g60vlcaPv4TFx2YOVDpn4k+AJqkMNkNCSl6YF/aSoFbyBQ==")
  throw new Error("lock entry is not the registry's 1.33.0 tarball");
if (lock.packages["node_modules/@brett_lamy/ui"]?.version !== "5.10.1") throw new Error("@brett_lamy/ui drifted");
const nested = Object.keys(lock.packages).filter((p) => /node_modules\/(react|react-dom|react-aria)$/.test(p) && p.split("node_modules/").length > 2);
if (nested.length) throw new Error(`nested React copies: ${nested}`);
JS
echo "ui-docs: ok   @brett_lamy/docstream 1.33.0 (registry integrity), @brett_lamy/ui 5.10.1, single React"

# The reader bundle: one React, the 1.33 site search and Pele diagrams actually shipped, no CDN.
node - <<'JS' || fail "reader bundle"
const meta = require("./target/docs-build/bundle-metafile.json");
const shipped = Object.values(meta.outputs).flatMap((o) => Object.entries(o.inputs)).filter(([, v]) => v.bytesInOutput > 0).map(([p]) => p);
const copies = (name) => new Set(shipped.filter((p) => p.includes(`node_modules/${name}/`)).map((p) => p.slice(0, p.indexOf(`node_modules/${name}/`))));
for (const name of ["react", "react-dom"]) if (copies(name).size !== 1) throw new Error(`${name} shipped from ${copies(name).size} locations`);
const entry = Object.entries(meta.outputs).find(([file]) => file.endsWith("/reader.js"))[1];
const inEntry = Object.entries(entry.inputs).filter(([, v]) => v.bytesInOutput > 0).map(([p]) => p);
for (const need of ["@brett_lamy/docstream/dist/site/search.js", "@brett_lamy/docstream/dist/site/tree.js", "@brett_lamy/docstream/dist/asset-resolver.js"])
  if (!inEntry.some((p) => p.includes(need))) throw new Error(`reader entry lacks ${need}`);
if (!shipped.some((p) => p.includes("node_modules/pele/"))) throw new Error("Pele diagram renderer not shipped");
// DocsRenderer imports its replay/STL/Strudel/TUI wrappers statically; their engines stay lazy.
for (const lazy of ["node_modules/rrweb/", "node_modules/pele/", "node_modules/@strudel/"])
  if (inEntry.some((p) => p.includes(lazy))) throw new Error(`${lazy} is in the reader entry instead of a lazy chunk`);
JS
if grep -rEl "https?://(cdn|unpkg|esm\.sh|cdnjs|jsdelivr)" web/docs-bundle >/dev/null; then fail "reader references a CDN"; fi
# No published page uses an rrweb/Replay embed, Strudel, STL or terminal-UI block: wasm-vm's own
# recordings (.wvsession) are documented, not shown through Docstream's web-page replay.
python3 - <<'PY' || fail "a page uses a replay/Strudel/STL/TUI block"
import pathlib, re, sys
bad = []
for page in sorted(pathlib.Path("web/docs-content").glob("*.md")):
    text = page.read_text()
    if re.search(r"^```(strudel|tui)\b", text, re.M):
        bad.append(page.name)
    # Embeds count only outside fenced examples.
    prose = re.sub(r"^(`{3,})[^\n]*\n.*?^\1\s*$", "", text, flags=re.M | re.S)
    if re.search(r"\{%\s*embed[^%]*(replay\.io|\.rrweb|\.stl)", prose):
        bad.append(page.name)
sys.exit(f"widget blocks in {bad}" if bad else 0)
PY
echo "ui-docs: ok   reader bundle: one React, site search and asset resolver in the entry, lazy Pele/rrweb/Strudel; no CDN; no widget blocks in content"

# Corpus: pinned inventory unchanged, current references authenticated at their own revision,
# search corpus = published pages, every search section aligned with a rendered heading.
node tools/check-docs.mjs
git diff --quiet HEAD -- design/documentation-migration.json || fail "pinned migration inventory changed"
python3 tools/check-docs-dist.py web/dist >/dev/null
echo "ui-docs: ok   corpus, current references, search alignment and dist packaging"

# UI_DOCS_PW_ARGS passes extra Playwright options for a recorded run, e.g.
# "--trace on --output ../target/e0t32-626/pw-docs".
# PW_DISABLE_TS_ESM=1, scoped to this command: Node 24 + the pinned Playwright 1.49.1 deadlock in
# Playwright's TypeScript ESM loader before test discovery. The spec is plain JS.
(cd web && PW_DISABLE_TS_ESM=1 PLAYWRIGHT_PORT="${PLAYWRIGHT_PORT:-8128}" node node_modules/playwright/cli.js test \
  tests/ui-docs.spec.js --reporter=list ${UI_DOCS_PW_ARGS:-})
echo "ui-docs: ok   reader browser checks"
echo "ui-docs: PASS"
