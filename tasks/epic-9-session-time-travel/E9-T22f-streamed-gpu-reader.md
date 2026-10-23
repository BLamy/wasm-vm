---
id: E9-T22f
epic: 9
title: Authenticate long GPU histories with bounded interval reads
priority: 524.922022
status: in-progress
depends_on: [E9-T22i]
estimate: S
risk: high
capstone: false
---

## Goal

Authenticate long GPU histories with bounded interval reads without weakening the original exact-history contract.

## Boundary

One authenticated persisted-history reader boundary. Consume the complete durable directory through bounded event/body windows while preserving every original sequence, witness, identity and fail-closed check. No native replay continuation or workload qualification is claimed.

## Acceptance criteria

- [ ] Read the complete production history beyond 4096 receipts/64 MiB as ordered bounded windows, with exact initial/final positions, contiguous sequence coverage and independently verified raw content identities.
- [ ] Authenticate the complete store closure and required runtime/provider/renderer identity before allocating a replay candidate. Never retain all envelope bodies in a global array; report observed resident window bounds.
- [ ] Reject a corrupted or missing middle chunk/body, invalid range/order/ticket, changed profile and unfinished/invalid witness commitment at its exact anchor. Preserve compatible small-history reads and cancellation ownership.
- [ ] Record scoped high-risk native/Wasm/browser gates, demo/main publication and a final pristine proof; obtain a fresh actual Daybreak critic with full changed-boundary attacks, a novel attack and meaningful sabotage.

## Deterministic acceptance

`make verify-E9-T22f`. Planned single target including `node tools/verify/e9-gpu-reader-stream-browser.mjs --events 4100 --mutate-middle`; no passing target exists yet.

## Adversarial verification

Mutate a middle event rather than only endpoints, replay an old window, cross an event-chunk boundary, duplicate/omit one sequence and change a body hash/length. An authenticated later checkpoint is not a substitute for complete coverage. Keep existing staging, body and native replay-plan bounds unchanged.

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


### 2026-10-23 — worker — activate the bounded durable-reader boundary

E9-T22i is verified at `f9b6b514284ef49305a8a6672d6fa0a08bf4a264`
and pushed to open draft PR #609. Main source release
`278e0bcb65481ccbccb85617b33514a7371da04e`, deployment `c19a6ac8`,
is live at <https://wasm-vm.pages.dev/app>. A NEW actual Daybreak final
publication critic verified all four I criteria, source/digest/cold carry,
the full current main native witness recording, readable UI captures, 24
main response bodies and seven exact R2 HEAD references. Final report
`target/evidence/e9-t22i-daybreak-final-publication/report.json`, SHA-256
`7c9d17325054ffb5ec34975f3e3f0d791a3e690fae16b0d982ed154c425fa8d6`;
actual completed requested/returned `gpt-daybreak-blue-latest`, `daybreakBlue`,
no errors/fallback, routing SHA-256
`e9e92a74bb1ad2644afaf338f7dd6900409826eb798401fe79e592c0d3890218`.
All 32 existing native PRs stay OPEN/draft/unmerged/unqueued; Actions disabled.

Continue the native stack on `codex/e9-streamed-gpu-reader`. F alone enters
the active lane, high risk for authenticated persisted history and asynchronous
window ownership. Consume complete durable v2 pages, every event/body and
checkpoint identity through bounded windows. Keep the required runtime/provider/
renderer fences, old v1 reads and all manifest/extension/retention/native plan/
body/staging bounds. Prove actual native history beyond 4096 receipts and
64 MiB, including a corrupted middle body/chunk and stale/cancelled ownership.
Native continuation remains G, browser execution remains H, and original
Linux/Omarchy/workload/performance remain C/D. No later-checkpoint substitute
for complete directory coverage, global body array or constants-only increase.
The planned acceptance target does not exist or pass yet.
