#!/usr/bin/env python3
"""Publish the complete prose corpus in Docstream without rewriting evidence/policy.

The ledger is intentionally exhaustive. Every baseline prose file has a disposition,
reason, original digest, and either a rendered page or its immutable source URL.
Technical paragraphs, commands, trace citations and measured data remain complete.
"""
from __future__ import annotations

import hashlib
import json
import posixpath
import re
import subprocess
from collections import Counter
from pathlib import Path
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = "2691b24e6c00478f8d69f81180b6827761de246a"
SOURCE = ROOT / "web/docs-source/guides"
OUT = ROOT / "web/docs-content"
REPO_URL = "https://github.com/BLamy/wasm-vm"
DOCSTREAM_VERSION = json.loads((ROOT / "web/package.json").read_text())["dependencies"]["@brett_lamy/docstream"]
GUIDES = [
    ("overview", "The field guide", "Start here"),
    ("quickstart", "Boot your first guest", "Start here"),
    ("architecture", "Architecture", "Use the machine"),
    ("embedding", "Embed the machine", "Use the machine"),
    ("storage", "Storage and persistence", "Use the machine"),
    ("time-travel", "Record, rewind, and branch", "Use the machine"),
    ("networking", "Networking", "Use the machine"),
    ("desktop", "Display, input, and audio", "Use the machine"),
    ("graphics", "Guest graphics: the admitted boundary", "Use the machine"),
    ("containers", "Containers", "Use the machine"),
    ("verification", "Reproduce a claim", "Build and prove"),
    ("performance", "Read the measurements", "Build and prove"),
    ("contributing", "Work in the repository", "Build and prove"),
    ("explainers", "Docs and explainers", "Build and prove"),
    ("proofmesh", "Proposed product layer", "Product direction"),
]
ALIASES = {
    "web/docs.html": "overview", "web/docs-embedding.html": "embedding",
    "web/docs-guest.html": "storage", "web/docs-containers.html": "containers",
    "web/docs-verification.html": "verification", "web/docs-explainers.html": "explainers",
}
PRESERVED_PROTOCOLS = {
    "docs/agent-protocol.md", "docs/trace-format.md", "docs/audio.md",
    "docs/virtio-snd.md", "docs/design/tailscale-worker-protocol.md",
    "docs/design/ws-proxy-protocol.md", "docs/design/chunked-image.md",
}
PRESERVED_POLICY = {"AGENTS.md", "ROADMAP.md", "docs/RELEASE_ASSURANCE.md", "tasks/README.md", "tasks/QUEUE.md"}
HISTORICAL_SNAPSHOTS = {
    "docs/gpu-3d-decision.md": (
        "Historical graphics decision",
        "Historical graphics decision and accumulated proof notes at the pinned source revision. The opening v5 profile, CONST≤45 limit, twelve-of-19 count, PRECISE rejection, and Chrome 154 qualification describe earlier slices, not the current renderer API. Later independently verified tasks extend those boundaries. Read the current graphics guide before using this record.",
        "graphics",
    ),
    "docs/virgl-shader-prerequisites.md": (
        "Historical shader prerequisite proposal",
        "Historical T12e planning proposal. Its original outcome labels, rejected features, register bounds, and proposed acceptance targets belong to that earlier receipt. They are not the current compiler admission policy.",
        "graphics",
    ),
    "docs/container-matrix.md": (
        "Historical nine-image container matrix",
        "Historical static image survey dated 2026-07-06. Image availability and deferred milestones belong to that survey. A static PASS is not a booted workload result or a current registry availability claim.",
        "containers",
    ),
    "docs/containers.md": (
        "Historical guest kernel container audit",
        "Historical E3.5-T02 audit of the named kernel configuration and guest smoke test. Configuration decisions and deferred work are recorded as they stood in that task; use the current container guide and exact task evidence for a present capability claim.",
        "containers",
    ),
    "tools/rr/README.md": (
        "Historical rr tooling",
        "Historical host-trace tooling. Current operating policy waives rr and retires ssh dev. New work uses local guest traces and deterministic/browser evidence. The original runbook remains intact for provenance.",
        "verification",
    ),
}


def slug(path: str) -> str:
    return "reference-" + re.sub(r"[^a-z0-9]+", "-", re.sub(r"\.(md|mdx)$", "", path.lower())).strip("-")


def source_url(path: str, anchor: str = "") -> str:
    return f"{REPO_URL}/blob/{BASE}/{quote(path, safe='/')}" + anchor


def digest(text) -> str:
    return hashlib.sha256(text.encode() if isinstance(text, str) else text).hexdigest()


def with_properties(body: str, **properties: str) -> str:
    """Publication metadata is separate from the exact authoritative source blobs."""
    yaml = "\n".join(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in properties.items())
    return f"---\n{yaml}\n---\n\n{body}"


def baseline_sources(paths: list[str]) -> dict[str, bytes]:
    """Read the pinned blobs, never mutable integration-worktree copies."""
    requests = "".join(f"{BASE}:{path}\n" for path in paths).encode()
    output = subprocess.check_output(["git", "cat-file", "--batch"], input=requests, cwd=ROOT)
    sources, offset = {}, 0
    for path in paths:
        end = output.index(b"\n", offset)
        header = output[offset:end].split()
        if len(header) != 3 or header[1] != b"blob":
            raise RuntimeError(f"Missing baseline prose blob: {path}")
        size = int(header[2])
        offset = end + 1
        sources[path] = output[offset:offset + size]
        offset += size + 1
    return sources


def auxiliary_record(path: str) -> bool:
    name = Path(path).name.upper()
    return path.lower().endswith((".txt", ".pdf")) or name == "README" or name.startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE"))


def auxiliary_reason(path: str) -> str:
    name = Path(path).name.upper()
    if name.startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE")):
        return "Legal terms and attribution; exact source retained, never editorially rewritten."
    if path.lower().endswith(".pdf"):
        return "Primary-source specification or binary publication; exact PDF and provenance retained."
    if path.startswith(("evidence/", "docs/golden/")):
        return "Immutable recorded proof or golden guest trace; exact bytes retained."
    if path.startswith(("crates/", "tests/")):
        return "Deterministic fixture, repro, or disassembly record; exact bytes retained."
    if name == "CMAKELISTS.TXT":
        return "Build metadata rather than reader prose; exact upstream/source configuration retained."
    return "Source manifest, diagnostic transcript, or upstream text record; preserved with immutable provenance."


def title_for(path: str, text: str) -> str:
    precise_titles = {
        "compliance/spike/README.md": "RISCOF Spike reference plugin",
        "compliance/wasmvm/README.md": "RISCOF wasm-vm plugin",
        "renderer/virgl-shader/STANDARD.md": "Standard VirGL shader bindings",
    }
    if path in precise_titles:
        return precise_titles[path]
    heading = re.search(r"^#\s+(.+)$", text, flags=re.M)
    if heading:
        return re.sub(r"[*`✅]", "", heading.group(1)).strip()
    name = Path(path).stem
    if name.lower() == "readme":
        name = Path(path).parent.name
    return name.replace("-", " ").replace("_", " ").capitalize()


def category_for(path: str) -> str:
    if path.startswith("docs/product/"): return "Product proposals"
    if path.startswith(("docs/perf/", "bench/", "tools/perf/")) or "baseline" in path: return "Performance"
    if path.startswith(("renderer/", "tools/virgl-")) or "gpu-3d" in path or "virgl" in path: return "Graphics"
    if path.startswith(("compliance/", "fuzz/", "tests/", "tools/diff/", "tools/fuzz/", "tools/verify/", "tools/rr/", "guest/")): return "Verification"
    if path.startswith(("tools/image/",)) or any(x in path for x in ["rootfs", "kernel", "image", "containers", "container-matrix", "boot-debugging"]): return "Boot and images"
    if any(x in path for x in ["network", "slirp", "tailscale", "ws-proxy", "http-fast"]): return "Networking"
    if any(x in path for x in ["audio", "input", "clipboard", "display", "desktop", "virtio-snd", "docs/ui"]): return "Display and input"
    if any(x in path for x in ["overlay", "file-transfer", "chunked"]): return "Storage"
    if path.startswith(("crates/",)) or any(x in path for x in ["jit-", "platform", "worker", "timekeeping", "softfloat", "sbi-firmware"]): return "Architecture"
    return "Build and integration"


def disposition(path: str) -> tuple[str, str]:
    if path.startswith("web/dist/"): return "preserved", "Generated deployment copy; source documentation is published from its canonical source path."
    if path.startswith("evidence/"): return "preserved", "Immutable recorded evidence and verifier citations."
    if path.startswith("tasks/"): return "preserved", "Task status, acceptance, and historical verification ledger."
    if path in PRESERVED_POLICY: return "preserved", "Operating policy or authoritative release/roadmap source."
    if path in HISTORICAL_SNAPSHOTS: return "preserved", HISTORICAL_SNAPSHOTS[path][1]
    if path in PRESERVED_PROTOCOLS: return "preserved", "Published protocol or binary/byte-format contract; exact source retained."
    if path.endswith(".rst") or path.startswith("third_party/"): return "preserved", "Upstream specification or vendor source; exact attribution retained."
    if any(x in path.lower() for x in ["license", "provenance"]): return "preserved", "Legal terms and provenance are not editorial content."
    if path in {"docs/level1-report.md", "docs/capstone-e0.md", "bench/module-costs/results/README.md"} or path.startswith("docs/perf/") or "baseline" in path or path=="compliance/EXCLUSIONS.md":
        return "preserved", "Dated measurement/report; original numbers, host, revision, and scope retained."
    return "rewritten", "Published as a complete Docstream reference page with navigation, source provenance, resolved links, portable Markdown, and complete technical body."


def links_for(text: str, path: str, known: set[str]) -> str:
    """Resolve authored repository links without changing fences or measured text."""
    parts = re.split(r"(^\s*`{3,}[^\n]*\n.*?^\s*`{3,}\s*$)", text, flags=re.M | re.S)
    pattern = re.compile(r"(?<!!)\[([^\]\n]*)\]\(([^\s)]+)(?:\s+\"[^\"]*\")?\)")
    def rewrite(match: re.Match[str]) -> str:
        label, target = match.groups()
        split = urlsplit(target)
        if split.scheme or target.startswith(("#", "//", "mailto:")):
            return match.group(0)
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), split.path))
        anchor = f"#{split.fragment}" if split.fragment else ""
        if resolved in ALIASES: return f"[{label}](./docs.html?page={ALIASES[resolved]}{anchor})"
        if resolved == "web/index.html": return f"[{label}](./index.html{anchor})"
        if resolved in known: return f"[{label}](./docs.html?page={slug(resolved)}{anchor})"
        # Relative code/evidence links refer to the real source tree, not the docs asset directory.
        return f"[{label}]({source_url(resolved, anchor)})"
    return "".join(part if i%2 else pattern.sub(rewrite, part) for i,part in enumerate(parts))


def publish_current_structure(body: str, path: str) -> str:
    """Give current technical pages useful Docstream blocks without changing code.

    Named fences expose purpose and numbered/copyable source. A related guide gives
    a reader a route from the contract's exact details to the user-facing boundary.
    Historical measurements and protocol sources do not pass through this rewrite.
    """
    heading = title_for(path, body)
    output, opened, ordinal = [], None, 0
    for line in body.splitlines():
        if opened is not None:
            output.append(line)
            if re.fullmatch(r"\s*" + re.escape(opened) + r"\s*", line):
                opened = None
            continue
        section = re.match(r"^#{2,6}\s+(.+)$", line)
        if section:
            heading = re.sub(r"[*`\[\]]", "", section.group(1)).strip()
        fence = re.match(r"^(`{3,})([^`]*)$", line)
        if fence:
            opened = fence.group(1)
            ordinal += 1
            metadata = fence.group(2).strip()
            if "title=" not in metadata and (not metadata or re.fullmatch(r"[A-Za-z0-9_+-]+", metadata)):
                label = f"{heading} / {ordinal:02d}".replace('"', "'")
                line = f'{opened}{metadata or "text"} title="{label}"'
        output.append(line)
    category = category_for(path)
    guide = {
        "Architecture": ("architecture", "Architecture"),
        "Boot and images": ("quickstart", "Boot your first guest"),
        "Build and integration": ("contributing", "Work in the repository"),
        "Display and input": ("desktop", "Display, input, and audio"),
        "Graphics": ("graphics", "Guest graphics: the admitted boundary"),
        "Networking": ("networking", "Networking"),
        "Performance": ("performance", "Read the measurements"),
        "Product proposals": ("proofmesh", "Proposed product layer"),
        "Storage": ("storage", "Storage and persistence"),
        "Verification": ("verification", "Reproduce a claim"),
    }[category]
    return "\n".join(output) + f'\n\n## Related field guide\n\n{{% content-ref url="./docs.html?page={guide[0]}" %}}\n{guide[1]}\n{{% endcontent-ref %}}\n'


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for old_page in OUT.glob("*.md"):
        old_page.unlink()
    tracked = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", BASE], cwd=ROOT, text=True).splitlines()
    prose = [p for p in tracked if p.lower().endswith((".md", ".mdx", ".rst", ".adoc"))]
    auxiliary = [p for p in tracked if p not in prose and auxiliary_record(p)]
    originals = baseline_sources(prose + auxiliary)
    renderable = {p for p in prose if p.lower().endswith((".md", ".mdx")) and not p.startswith(("evidence/", "tasks/", "third_party/", "web/dist/")) and not any(x in p.lower() for x in ["license", "provenance"]) and p not in {"AGENTS.md", "ROADMAP.md"}}
    catalog, ledger = [], []
    for page, title, group in GUIDES:
        path = SOURCE / f"{page}.md"
        text = with_properties(path.read_text(), kind="Field guide", source=f"web/docs-source/guides/{page}.md", scope="Authored explanation; verification belongs to the named evidence")
        (OUT / f"{page}.md").write_text(text)
        catalog.append({"id":page,"title":title,"group":group,"category":"Guides","kind":"guide","url":f"./docs-content/{page}.md","source":f"web/docs-source/guides/{page}.md","sourceUrl":f"./docs-content/{page}.md","sha256":digest(text),"search":re.sub(r"[`#*{}%]", "", text)})
    for path in prose:
        text = originals[path].decode("utf-8")
        status, reason = disposition(path)
        item = {"path":path,"status":status,"reason":reason,"sourceSha256":digest(text),"sourceUrl":source_url(path)}
        if path in renderable:
            page = slug(path)
            title = title_for(path,text)
            if path in HISTORICAL_SNAPSHOTS:
                title = HISTORICAL_SNAPSHOTS[path][0]
            body = text
            if body.startswith("---\n"):
                body = body.split("\n---\n",1)[-1]
            body = re.sub(r"^#\s+.*\n", "", body, count=1)
            body = links_for(body,path,renderable)
            if status == "rewritten":
                body = publish_current_structure(body,path)
            if path in HISTORICAL_SNAPSHOTS:
                note = HISTORICAL_SNAPSHOTS[path][1]
                guide = HISTORICAL_SNAPSHOTS[path][2]
                note += f' [Read the current guide](./docs.html?page={guide}).'
            elif path in PRESERVED_POLICY:
                note = "Operating policy. The complete authoritative source is retained at its stated revision. Publication does not change task status, release assurance, or the verification rules."
            elif path.startswith("docs/product/"):
                note = "Product proposal. These contracts describe proposed work above the browser machine, not a verified current implementation."
            elif path in PRESERVED_PROTOCOLS:
                note = "Protocol reference. The complete original technical contract is retained; the authoritative source is linked above."
            elif status == "preserved":
                note = "Historical record. Numbers and verdicts belong to the original run and its stated revision, host, and workload; publication here does not refresh that verification."
            elif path == "tools/rr/README.md":
                note = "Historical tooling. The current operating policy waives rr and retires ssh dev. Use local guest traces and deterministic/browser evidence for new work."
            else:
                note = "Technical reference. Read the stated acceptance boundary and source context before treating a described milestone as current verification."
            published = with_properties(
                f"# {title}\n\n{{% hint style=\"info\" %}}\n{note}\n{{% endhint %}}\n\n" + body.strip() + "\n",
                kind="Preserved source record" if status == "preserved" else "Technical reference",
                source=path, source_revision=BASE, source_sha256=digest(text),
                scope="Historical snapshot; use current field guides for present capabilities" if path in HISTORICAL_SNAPSHOTS else "Pinned source; publication does not refresh verification",
            )
            (OUT / f"{page}.md").write_text(published)
            item.update({"page":page,"replacement":f"./docs.html?page={page}","publishedSha256":digest(published)})
            catalog.append({"id":page,"title":title,"group":"Reference library","category":category_for(path),"kind":"reference","disposition":status,"url":f"./docs-content/{page}.md","source":path,"sourceUrl":source_url(path),"sourceSha256":digest(text),"sha256":digest(published),"search":re.sub(r"[`#*{}%]", "", published)})
        ledger.append(item)
    for path in auxiliary:
        ledger.append({"path":path,"status":"preserved","role":"auxiliary-record","reason":auxiliary_reason(path),"sourceSha256":digest(originals[path]),"sourceUrl":source_url(path)})
    for path,page in ALIASES.items():
        ledger.append({"path":path,"status":"obsolete","reason":"Static public documentation page superseded by the Docstream reader; legacy URL remains a working reader entry.","replacement":f"./docs.html?page={page}","sourceUrl":source_url(path)})
    # The whole baseline is accounted for, including records that should never be reauthored.
    counts = dict(Counter(item["status"] for item in ledger))
    coverage = f"""# Documentation coverage

The migration ledger accounts for **{len(prose):,} tracked prose files** at source revision `{BASE}`, **{len(auxiliary):,} additional legal/specification/trace records**, and the six original public documentation pages. Every item is marked **rewritten**, **preserved with a reason**, or **obsolete with a replacement**.

## Dispositions

| Disposition | Documents | Meaning |
| --- | --- | --- |
| Rewritten | {counts.get('rewritten',0)} | Complete technical reference published in Docstream, with resolved navigation and original technical details retained. |
| Preserved | {counts.get('preserved',0)} | Immutable evidence, task logs, policy, protocols, legal/vendor texts, or dated measurements remain authoritative and unchanged. |
| Obsolete | {counts.get('obsolete',0)} | Six static web docs pages replaced by working Docstream entry points. |

## Editorial scope

The field guides are newly authored for user and contributor questions. The full technical reference corpus is migrated, rather than silently summarized: commands, tables, code, constraints and historical citations remain in each page. Preserved protocol and measurement references can be read here with their original scope stated. The original source documents remain in the repository so evidence and line citations do not drift.

Task acceptance/status and verifier logs are operating state, not help-center prose. Evidence is a recorded run, not copy to improve. Vendor specifications, legal terms and provenance are not ours to rewrite. The ledger includes each of these files individually with its exact SHA-256 and immutable source URL.

Plain-text licenses, notices, diagnostic transcripts, fixture text, manifests, golden traces and primary-source PDFs are catalogued separately from Markdown/RST prose. Their extension does not remove them from the accounting; they remain preserved sources rather than newly authored reader pages. Build metadata such as upstream `CMakeLists.txt` is explicitly labelled by role.

This ledger is an immutable inventory of the stated migration revision. Later task logs and release evidence keep their own source revisions; the current [desktop guide](./docs.html?page=desktop) names the application-image evidence separately. A reference's native **Properties** sheet exposes its exact original revision and SHA-256. Guide properties identify authored explanations, not an independent verification result.

## Inspect the complete ledger

[Download the full document-by-document migration ledger](./docs-content/migration-ledger.json).

Use the reader's **Archive ledger** to search every preserved source path. The Reference library includes {sum(p['kind']=='reference' for p in catalog)} full documents; no technical reference is represented by a link-only summary.

## Package and build

The reader uses the exact `@brett_lamy/docstream@{DOCSTREAM_VERSION}` npm release, including read-only document properties and native task-state icons. Run `npm run build:docs` and `npm run check:docs` in `web/` to regenerate the corpus, bundles, and validation receipt.
"""
    coverage = with_properties(coverage, kind="Migration inventory", source="web/docs-content/coverage.md", generated_by="tools/build-docs-corpus.py", source_revision=BASE, scope="Baseline accounting; later evidence retains its own revision")
    (OUT / "coverage.md").write_text(coverage)
    catalog.append({"id":"coverage","title":"Documentation coverage","group":"Build and prove","category":"Guides","kind":"guide","url":"./docs-content/coverage.md","source":"web/docs-content/coverage.md","sourceUrl":"./docs-content/coverage.md","sha256":digest(coverage),"search":coverage})
    for item in ledger:
        if item["status"]=="rewritten" and "page" not in item:
            raise RuntimeError(f"Unpublished rewritten document: {item['path']}")
    ids=[p['id'] for p in catalog]
    if len(ids)!=len(set(ids)): raise RuntimeError("Duplicate page IDs")
    manifest={"schema":1,"docstreamVersion":DOCSTREAM_VERSION,"sourceRevision":BASE,"pages":catalog,"counts":{"baselineProse":len(prose),"auxiliaryRecords":len(auxiliary),"totalDocuments":len(ledger),"pages":len(catalog),**counts}}
    (OUT / "catalog.json").write_text(json.dumps(manifest,ensure_ascii=False,separators=(",",":"))+"\n")
    (OUT / "migration-ledger.json").write_text(json.dumps({"schema":1,"sourceRevision":BASE,"counts":counts,"documents":ledger},indent=2,ensure_ascii=False)+"\n")
    design=ROOT/"design";design.mkdir(exist_ok=True)
    (design/"documentation-migration.json").write_text(json.dumps({"schema":1,"sourceRevision":BASE,"counts":counts,"documents":ledger},indent=2,ensure_ascii=False)+"\n")
    print(f"Docstream corpus: {len(catalog)} pages; {len(prose)} baseline prose files accounted for; {counts}")


if __name__ == "__main__":
    main()
