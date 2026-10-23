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

`make verify-E9-T22f`. The single frozen submission includes `node tools/verify/e9-gpu-reader-stream-browser.mjs --events 4100 --mutate-middle`, its independent literal byte oracle, native/Wasm gates, affected store/witness/GPU regressions and the built demo. Final pristine proof, publication and fresh Daybreak verification are also required.

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

### 2026-10-23 — worker — freeze the bounded reader for formal submission

The implementation adds a callback-scoped session read lease, allocation-free
core/Wasm CLOCK-origin and installed-topology inspectors, streamed native-frame
inspection, retained renderer/profile checks, a complete closure-first preflight
and one-use bounded receipt/witness cursors. The default v1 writer and small v1
reader and all existing body, staging, directory and native-plan limits remain.
The demo exposes the complete bounded read check and a live roadmap pip. F
returns `storageAuthenticated:true, nativeAdmitted:false`; G/H and original C/D
qualification are not claimed.

A NEW actual Daybreak frozen-source review identified missing same-Observe ticket
contiguity and requested initial-scan cancellation, structured failure anchors
and explicit buffer evidence. Review JSON
`target/evidence/e9-t22f-daybreak-reader-review-1/report.json`, SHA-256
`cc7810296aea64a05f2ee62383099fef4a9dcf1807ac63f7810057fa1742865d`;
completed actual requested/returned `gpt-daybreak-blue-latest`, `daybreakBlue`, no
errors/fallback, routing SHA-256
`d3822b46701cd89315800f46d04eb5b99b462747bd41cd896839743008989502`.

The ticket finding conflicted with the earlier design R2, so a separate NEW
actual Daybreak session resolved it against native source and a focused real
observation/replay test. Its JSON
`target/evidence/e9-t22f-daybreak-observe-ticket-resolution/report.json`, SHA-256
`dbd999e018066cb5704b32491081806b2336d0f3078fd73cfba476bfe1b7f346`,
explicitly retracts the earlier phase-wide-gap allowance for the current ABI:
commit leaves Observe; reopening a scope resets transition or ordinal, so
consecutive same-T Observe ordinals require ticket+1. Same-Before gaps and
cross-transition decreases remain allowed. Actual completed routing SHA-256
`df0c8702bdd260257efbe6ecf621bd925f5ead47398f6c37346ed94b6c529913`,
requested/returned Daybreak, no errors/fallback. This is the governing R2
correction; the old review is retained, not overwritten.

Worker development checks (not final frozen acceptance): core library 409/0,
format and scoped strict Clippy pass. Development browser capture
`target/evidence/e9-t22f-reader-development-6/report.json`, SHA-256
`fdc40db2eed19dd57a03845092a156219a527a8bc27cdb5ce985141233266c7e`, recorded 4359 native receipts and a separate
67125819-byte native receipt history, plus the original production physical GPU
query/readback guest. All exact reads, 54 adversarial checks and 10 codec/ownership
checks passed with zero replay-candidate allocations, browser errors, HTTP
failures or external requests. Initial-scan abort and close each showed zero
late IDB transactions. The actual first Before cut is 4096/4097 at T0; the genuine
2048 witness is preserved. Largest receipt window is 66863580 bytes. Counters
state explicit window maxima and a conservative buffer upper bound, not RSS or
JS heap use; encoded retained metadata and renderer decode buffers are separate.
The literal Python oracle passed all raw/CAS/returned identities and window
digests at
`target/evidence/e9-t22f-reader-development-6/independent-reader-oracle/report.json`,
SHA-256 `c23de5eb6caf17e41007096a47d8ee5abe7a2029ed96d6ddf5f8fd476096f25c`. Earlier failed development harness attempts
are retained: optional effects were rejected earlier by the native codec,
coherent identity mutants initially hit the existing frame/witness guard before
F, and the first oracle caught the mutation harness aliasing its saved report.
The production fixes are described above; harness corrections did not fabricate
new guest executions or change original workloads.

Status remains in-progress. The next step is the exact-head high-risk target,
pristine proof, fresh actual Daybreak charter/sabotage and main publication.
