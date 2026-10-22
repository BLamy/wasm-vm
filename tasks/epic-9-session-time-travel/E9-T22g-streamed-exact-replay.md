---
id: E9-T22g
epic: 9
title: Continue exact replay across bounded native admission windows
priority: 524.922023
status: pending
depends_on: [E9-T22f]
estimate: S
risk: high
capstone: false
---

## Goal

Continue exact replay across bounded native admission windows without weakening the original exact-history contract.

## Boundary

One core/Wasm replay continuation boundary. Preserve one exact execution and its global state/cursors while admitting the next bounded tape. Existing native resident event/byte/payload limits remain fixed.

## Acceptance criteria

- [ ] Execute an initial-to-end software and GPU exact history beyond the current 4096-event/64 MiB whole-plan bounds using bounded continuation windows; retain all intermediate and final architectural/RAM/device/disk/clock/queue/cursor witnesses.
- [ ] Bind each next window to the admitted predecessor, exact position, source cursor, pending/output frontiers and GPU payload/renderer identity. Reject duplicates, gaps, overlap, stale epoch, reordered observations and wrong endpoint before executing that window.
- [ ] Keep live replay providers/factories/egress absent and preserve fail-closed cancellation/error behavior. Do not reset the guest to an unrelated later checkpoint, materialize a global plan, or raise the resident limits.
- [ ] Pass the high-risk prescribed local gauntlet, deterministic guest traces/state digests and relevant browser paths; retain final pristine evidence and obtain a new actual Daybreak critic with threat-model attacks, novel attack and sabotage.

## Deterministic acceptance

`make verify-E9-T22g`. Planned single target including `cargo test -p wasm-vm-core session_replay_streamed_initial_to_end` and `cargo test -p wasm-vm-wasm session_replay_streamed_bindings`; no passing target exists yet.

## Adversarial verification

Split next to before/observe phases, same-transition groups, WFI, source exhaustion, deferred DMA/GPU results and nonempty host queues. Attack the ownership and predecessor fences and prove rejection does not execute partial next-window work. If an equivalent chain of fresh bounded candidates is chosen instead, first seal and prove equality of every complete actual endpoint with the next checkpoint, including physical renderer content and pending queues; no later-origin shortcut.

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
