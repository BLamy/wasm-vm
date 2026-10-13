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

## Inspect the complete ledger

[Download the full document-by-document migration ledger](./docs-content/migration-ledger.json).

Use the reader's **Archive ledger** to search every preserved source path. The Reference library includes 139 full documents; no technical reference is represented by a link-only summary.

## Package and build

The reader uses the exact `@brett_lamy/docstream@1.8.0` npm release. Run `npm run build:docs` and `npm run check:docs` in `web/` to regenerate the corpus, bundles, and validation receipt.
