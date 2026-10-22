---
id: E9-T22e
epic: 9
title: Publish long GPU histories through bounded resident windows
priority: 524.922021
status: pending
depends_on: [E9-T22b]
estimate: S
risk: high
capstone: false
---

## Goal

Publish long GPU histories through bounded resident windows without weakening the original exact-history contract.

## Boundary

One durable GPU recording publication boundary. Separate lifetime durable event count/bytes from fixed resident pending/interval limits. Do not alter guest semantics, native replay admission, full-history qualification or numerical budgets.

## Acceptance criteria

- [ ] Persist a production GPU journal with more than 4096 receipts and at least 67125760 block-envelope bytes, then reopen and independently authenticate every byte, sequence, manifest range and content reference without truncation.
- [ ] Keep pending batches at 256 receipts/4 MiB and GPU bodies/intervals at their existing 256-object/64 MiB bounds. Separate durable-history accounting from resident windows; no constants-only increase, dropped receipt or record-after-boot shortcut.
- [ ] Preserve immutable initial/provider/renderer/profile identity, append/CAS ownership, failure atomicity and retained older roots. Refuse an overfull resident batch and corrupt/missing content with precise evidence.
- [ ] Record the scoped high-risk local browser/store gates, actual demo proof, production release and final pristine proof. A fresh actual Daybreak critic must cover all changed hunks, adversarial cases, one novel attack and sabotage before setting verified.

## Deterministic acceptance

`make verify-E9-T22e`. Planned single acceptance target for production store/browser streaming publication; includes `node tools/verify/e9-gpu-journal-stream-browser.mjs --events 4100 --block-bytes 67125760` once implemented. It is not an existing passing target.

## Adversarial verification

Use a middle/tail payload mutation, stale competing writer, quota failure and exact resident-window overflow. Independently count and hash all reopened receipts and referenced payloads. Distinguish generated storage-boundary fixtures from an executed full guest: this slice makes no cold-Omarchy qualification or replay claim.

## Verification log

### 2026-10-22 — worker — ordered prerequisite from authenticated cold-boot failure

The fresh actual Daybreak capacity review is retained at
`target/evidence/e9-t22c-daybreak-capacity/report.md`, SHA-256
`a341f3ffc80ca87b347d97cc1ea6e2270323e1004e752fcd6db47a4a2f9d53ec`.
Its controller completed on requested/returned `gpt-daybreak-blue-latest` with
`daybreakBlue`, fallback disabled, no errors. Corrected original Omarchy attempt
3 rejected receipt 702 at transition `2207340032`: `67179533` lifetime envelope
bytes exceeded `67108864`, although the resident pending+candidate window was
only `524420`. All 256 block envelopes alone exceeded the lifetime bound. The
retained production store authenticates an exact durable prefix through 701;
this is a runtime prerequisite finding, not C qualification or performance.

Keep the original assets, pure ICount/64 cold profile, fixed 50M maximum
checkpoint gap, workload amounts and numeric budgets. Only this slice may enter
the active lane after its dependencies are verified. Prospective checkpoint,
witness-extension and storage limits are not waived; independently reproduce
any additional blocker and give it its own ordered S boundary. All PRs remain
open; no merge is authorized.
