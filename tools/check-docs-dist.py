#!/usr/bin/env python3
"""Validate docs/marketing packaging after the existing production route swap."""
import hashlib
import html as html_parser
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "web/dist"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def fences(text):
    return re.findall(r"^\s*(`{3,})[^\n]*\n(.*?)^\s*\1\s*$", text, re.M | re.S)


catalog = json.loads((DIST / "docs-content/catalog.json").read_text())
ledger = json.loads((DIST / "docs-content/migration-ledger.json").read_text())
require(catalog["docstreamVersion"] == "1.8.0", "Wrong published Docstream release")
hashes = {}
for page in catalog["pages"]:
    target = DIST / "docs-content" / f"{page['id']}.md"
    text = target.read_text()
    hashes[page["id"]] = sha(target.read_bytes())
    require(hashes[page["id"]] == page["sha256"], f"Published document hash drift: {page['id']}")
    original = (ROOT / "web/docs-content" / f"{page['id']}.md").read_text()
    require(fences(text) == fences(original), f"Deployment changed a code example: {page['id']}")
    outside = re.sub(r"^\s*(`{3,})[^\n]*\n.*?^\s*\1\s*$", "", text, flags=re.M | re.S)
    require("](./index.html" not in outside and "](./landing.html" not in outside, f"Source-layout URL remains: {page['id']}")
for item in ledger["documents"]:
    if item.get("page"):
        require(item["publishedSha256"] == hashes[item["page"]], f"Published ledger hash drift: {item['path']}")

reader = (DIST / "docs-bundle/reader.js").read_text()
require('href:"./app.html"' in reader and 'href:"./"' in reader, "Reader navigation did not receive production routes")
require('href:"./index.html"' not in reader and 'href:"./landing.html"' not in reader, "Reader retains source-layout navigation")
reader_revision = sha((DIST / "docs-bundle/reader.js").read_bytes())[:12]
for name in ["docs.html", "docs-embedding.html", "docs-guest.html", "docs-containers.html", "docs-verification.html", "docs-explainers.html"]:
    html = (DIST / name).read_text()
    require(f"./docs-bundle/reader.js?rev={reader_revision}" in html, f"Reader cache identity drift: {name}")
for name in ["index.html", "products.html", "security.html", "work-market.html", "roadmap.html"]:
    html = (DIST / name).read_text()
    require("./vendor/three/three.module.js" in html and "./node_modules/three" not in html, f"Missing vendored hero import: {name}")
    require("./index.html" not in html and "./landing.html" not in html, f"Marketing route swap incomplete: {name}")
    for module in ["landing-page.js", "landing-benchmarks.js"]:
        if f"./{module}" in html:
            require(f"./{module}?rev={sha((DIST / module).read_bytes())[:12]}" in html, f"Marketing cache identity drift: {module}")
require('data-embed-src="./app.html?embed=1&noAutoBoot#ide"' in html_parser.unescape((DIST / "index.html").read_text()), "Embedded launcher points at marketing root")
benchmark_js = (DIST / "landing-benchmarks.js").read_text()
for name, token in [("runtime-benchmarks.json", "__RUNTIME_BENCHMARK_VERSION__"), ("runtime-compute-benchmarks.json", "__RUNTIME_COMPUTE_BENCHMARK_VERSION__")]:
    require(token not in benchmark_js, f"Benchmark token was not stamped: {token}")
    require(sha((DIST / name).read_bytes())[:12] in benchmark_js, f"Benchmark identity missing: {name}")
    require((DIST / name).read_bytes() == (ROOT / "web" / name).read_bytes(), f"Raw benchmark changed: {name}")
require("__SW_VERSION__" not in (DIST / "sw.js").read_text(), "Service worker version not stamped")
features = list((DIST / "docs-bundle/features").glob("*.js"))
require(features and not (DIST / "docs-bundle/chunks").exists(), "Lazy docs features collide with the disk-chunk cache exclusion")
oversize = [str(p.relative_to(DIST)) for p in DIST.rglob("*") if p.is_file() and p.stat().st_size > 25 * 1024 * 1024]
require(not oversize, f"Cloudflare file-size boundary exceeded: {oversize}")
receipt = {"schema": 1, "dist": str(DIST.resolve()), "docstreamVersion": catalog["docstreamVersion"], "pages": len(catalog["pages"]), "ledgerDocuments": len(ledger["documents"]), "readerRevision": reader_revision, "lazyFeatures": len(features), "codeExamplesPreserved": True, "rawBenchmarkBytesPreserved": True, "largestAssetBytes": max(p.stat().st_size for p in DIST.rglob("*") if p.is_file())}
print(json.dumps(receipt, indent=2))
