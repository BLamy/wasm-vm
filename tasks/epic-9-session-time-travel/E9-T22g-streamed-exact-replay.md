---
id: E9-T22g
epic: 9
title: Continue exact replay across bounded native admission windows
priority: 524.922023
status: in-progress
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

`make verify-E9-T22g`. The target records bounded software/GPU long-history native tests, guest traces and state digests, adversarial observation and GPU regression tests, affected native/Wasm Clippy, a rebuilt browser ABI handoff, the visible demo and ISA suite, and the full local gauntlet at one clean exact head. Run the same script with `--cold-clone <scratch path>` for the final pristine proof.

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


### 2026-10-23 — worker — begin bounded native continuation

E9-T22f is independently verified at `7cce84411405a81023b0d8f94bbb557f950bf7d3` after production deployment `d1141406` on the main wasm-vm URL. The fresh actual Daybreak final report is `target/evidence/e9-t22f-daybreak-final-publication/report.json`, SHA-256 `6b36071e4211f5afbafe2a074b633a62be16bccbe234cdf2a289f3d923c89207`; its completed routing receipt is SHA-256 `aef4756d2d9ee7dece6e2e274e4f48048c218ea81d353ea75fe1e28318872a24`. All four F criteria are verified, and the preceding 33 native stack PRs remain open and unmerged.

This high-risk S task changes only the core/Wasm exact replay continuation boundary. It must preserve one private machine and continuous architectural/cursor/queue state across bounded windows. Every next window is bound before execution to the already admitted predecessor and a real witness; per-window event/body limits stay fixed. Long original software and GPU histories, guest traces, targeted attacks, final local wall, browser path, pristine proof, main publication and a new actual Daybreak verdict are required before this task can be verified. H/C/D and T23/T24 remain separate.
