#!/usr/bin/env python3
"""Apply the existing source/production route boundary to the Docstream bundle."""
import hashlib
import json
import re
import sys
from pathlib import Path

dist = Path(sys.argv[1])
content = dist / "docs-content"
if content.is_dir():
    for page in content.glob("*.md"):
        text = page.read_text()
        # Docs use authored Markdown links. Never rewrite literal JS or code examples.
        parts = re.split(r"(^\s*`{3,}[^\n]*\n.*?^\s*`{3,}\s*$)", text, flags=re.M | re.S)
        text = "".join(part if i % 2 else part.replace("]('./index.html", "]('./app.html").replace("](./index.html", "](./app.html").replace("](./landing.html", "](./") for i, part in enumerate(parts))
        page.write_text(text)
    catalog_path = content / "catalog.json"
    catalog = json.loads(catalog_path.read_text())
    for page in catalog["pages"]:
        text = (content / f"{page['id']}.md").read_text()
        page["sha256"] = hashlib.sha256(text.encode()).hexdigest()
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n")
    ledger_path = content / "migration-ledger.json"
    ledger = json.loads(ledger_path.read_text())
    hashes = {page["id"]:page["sha256"] for page in catalog["pages"]}
    for item in ledger["documents"]:
        if item.get("page") in hashes:
            item["publishedSha256"] = hashes[item["page"]]
    ledger_path.write_text(json.dumps(ledger, indent=2, ensure_ascii=False) + "\n")
bundle = dist / "docs-bundle"
if bundle.is_dir():
    for asset in bundle.glob("*.js"):
        # The reader bundle carries the shared nav's route table (web/ui/src/routes.js) as quoted
        # strings; apply the same root swap as the HTML pages and ui.js.
        text = re.sub(r'(["\'])\./index\.html', r'\1./app.html', asset.read_text())
        text = re.sub(r'(["\'])\./landing\.html(["\'#])', r'\1./\2', text)
        asset.write_text(text)
    revision = hashlib.sha256((bundle / "reader.js").read_bytes()).hexdigest()[:12]
    for name in ["docs.html", "docs-embedding.html", "docs-guest.html", "docs-containers.html", "docs-verification.html", "docs-explainers.html"]:
        page = dist / name
        if page.is_file():
            text = re.sub(r"(\./docs-bundle/reader\.js\?rev=)[a-f0-9]+", lambda m:m.group(1)+revision, page.read_text())
            page.write_text(text)

# This script is called after deployment placeholder replacement. Preserve the
# source preview's cache boundary while using hashes of the shipped module bytes.
for name in ["index.html", "products.html", "work-market.html", "security.html", "roadmap.html"]:
    page = dist / name
    if not page.is_file():
        continue
    text = page.read_text()
    for module in ["landing-page.js", "landing-benchmarks.js"]:
        asset = dist / module
        if asset.is_file():
            revision = hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
            text = re.sub(r"(\./" + re.escape(module) + r"\?rev=)[a-f0-9]+", lambda m:m.group(1)+revision, text)
    page.write_text(text)
