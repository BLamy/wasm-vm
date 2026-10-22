---
id: E9-T22h
epic: 9
title: Run the complete GPU replay chain through browser consumers
priority: 524.922024
status: pending
depends_on: [E9-T22g]
estimate: S
risk: high
capstone: false
---

## Goal

Run the complete GPU replay chain through browser consumers without weakening the original exact-history contract.

## Boundary

One browser integration boundary for authenticated long histories: timeline seek, private GPU replay and local archive verification use the bounded readers/executor. Entire real-workload qualification remains E9-T22c.

## Acceptance criteria

- [ ] Open and navigate a long production GPU history using authenticated bounded window admission while preserving latest-owner cancellation, selected state, branch eligibility and exact event navigation.
- [ ] Execute EVERY window from the actual initial checkpoint to final end in a recorded whole-chain proof with zero live replay egress; compare full native/RAM/disk/device/clock, pending/output queues, actual renderer checkpoint content/identity and global event cursor.
- [ ] Authenticate all long-history content and witnesses in local export/import and GC/retention, including a middle corruption and incompatible profile. Keep previous selected view/source history intact on rejected or cancelled work.
- [ ] Complete scoped high-risk browser/local gates, update the visible demo and publish to the main Cloudflare URL; retain final pristine evidence and a fresh actual Daybreak adversarial verdict including novel attack and sabotage.

## Deterministic acceptance

`make verify-E9-T22h`. Planned single target including `node tools/verify/e9-gpu-whole-chain-replay-browser.mjs --from initial --to end --zero-egress`; no passing target exists yet.

## Adversarial verification

Attempt late/overlapping windows, worker/context loss, rapid seeks/cancel, stale epoch and malformed middle payloads. Interrogate actual readbacks and renderer checkpoint bytes, not just a logical endpoint caption. No full cold-Omarchy, fixed-workload or performance acceptance follows from a small integration fixture.

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
