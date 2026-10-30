---
kind: "Migration inventory"
source: "web/docs-content/coverage.md"
generated_by: "tools/build-docs-corpus.py"
source_revision: "2691b24e6c00478f8d69f81180b6827761de246a"
scope: "Baseline accounting; later evidence retains its own revision"
---

# Documentation coverage

The migration ledger accounts for **1,533 tracked prose files** at source revision `2691b24e6c00478f8d69f81180b6827761de246a`, **456 additional legal/specification/trace records**, and the six original public documentation pages. Every item is marked **rewritten**, **preserved with a reason**, or **obsolete with a replacement**.

## Dispositions

| Disposition | Documents | Meaning |
| --- | --- | --- |
| Rewritten | 110 | Complete technical reference published in Docstream, with resolved navigation and original technical details retained. |
| Preserved | 1879 | Immutable evidence, task logs, policy, protocols, legal/vendor texts, or dated measurements remain authoritative and unchanged. |
| Obsolete | 6 | Six static web docs pages replaced by working Docstream entry points. |

## Editorial scope

The field guides are newly authored for user and contributor questions. The full technical reference corpus is migrated, rather than silently summarized: commands, tables, code, constraints and historical citations remain in each page. Preserved protocol and measurement references can be read here with their original scope stated. The original source documents remain in the repository so evidence and line citations do not drift.

Task acceptance/status and verifier logs are operating state, not help-center prose. Evidence is a recorded run, not copy to improve. Vendor specifications, legal terms and provenance are not ours to rewrite. The ledger includes each of these files individually with its exact SHA-256 and immutable source URL.

Plain-text licenses, notices, diagnostic transcripts, fixture text, manifests, golden traces and primary-source PDFs are catalogued separately from Markdown/RST prose. Their extension does not remove them from the accounting; they remain preserved sources rather than newly authored reader pages. Build metadata such as upstream `CMakeLists.txt` is explicitly labelled by role.

This ledger is an immutable inventory of the stated migration revision. Later task logs and release evidence keep their own source revisions; the current [desktop guide](./docs.html?page=desktop) names the application-image evidence separately. A reference's native **Properties** sheet exposes its exact original revision and SHA-256. Guide properties identify authored explanations, not an independent verification result.

## Current references

Four session references are published separately from this inventory, from exact blobs at revision `c396efe1ecd061721865a5929235e6d0a6268561` (the PR 626 stack): [Session replay](./docs.html?page=current-docs-design-session-replay), [Session format](./docs.html?page=current-docs-design-session-format), [Session store](./docs.html?page=current-docs-design-session-store), [GPU history reader](./docs.html?page=current-docs-design-session-gpu-history-reader). Each page's **Properties** sheet carries that revision and the source SHA-256. They are not counted in the dispositions above and do not change the migration ledger.

## Inspect the complete ledger

[Download the full document-by-document migration ledger](./docs-content/migration-ledger.json).

Use the reader's **Archive ledger** to search every preserved source path. The Reference library includes 139 full documents; no technical reference is represented by a link-only summary.

## Package and build

The reader uses the exact `@brett_lamy/docstream@1.33.0` npm release, including read-only document properties and native task-state icons. Run `npm run build:docs` and `npm run check:docs` in `web/` to regenerate the corpus, bundles, and validation receipt.
