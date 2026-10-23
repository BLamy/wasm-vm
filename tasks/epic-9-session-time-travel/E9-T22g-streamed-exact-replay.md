---
id: E9-T22g
epic: 9
title: Continue exact replay across bounded native admission windows
priority: 524.922023
status: verified
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

- [x] Execute an initial-to-end software and GPU exact history beyond the current 4096-event/64 MiB whole-plan bounds using bounded continuation windows; retain all intermediate and final architectural/RAM/device/disk/clock/queue/cursor witnesses.
- [x] Bind each next window to the admitted predecessor, exact position, source cursor, pending/output frontiers and GPU payload/renderer identity. Reject duplicates, gaps, overlap, stale epoch, reordered observations and wrong endpoint before executing that window.
- [x] Keep live replay providers/factories/egress absent and preserve fail-closed cancellation/error behavior. Do not reset the guest to an unrelated later checkpoint, materialize a global plan, or raise the resident limits.
- [x] Pass the high-risk prescribed local gauntlet, deterministic guest traces/state digests and relevant browser paths; retain final pristine evidence and obtain a new actual Daybreak critic with threat-model attacks, novel attack and sabotage.

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

### 2026-10-23 — worker — bounded exact replay submission

Runtime and deployable bundle were frozen at `da1fc30bd9a4f2f52afb5658aa6453876bb575dd`.
`make verify-E9-T22g E9_OUT=target/evidence/e9-t22g-submission-2` passed all 14 selected
commands with a clean checkout; report SHA-256
`b17313662cf4e813ab8325f932d3c785ce2568497f97ab442469c169bbf8cda8`.
Four real original guest traces and state witnesses cover software 4359 events / 260
large-body events and GPU 4366 events / 267 large-body events, each across two
bounded windows; both large-body histories exceed 64 MiB. The final native
resumes and GPU logical/RAM witnesses equal their original complete histories.
The browser ABI rejected six malformed/stale continuations before next-window
guest work; the built demo passed 127/0 with the new capability live, zero
console/HTTP errors and no phone-width overflow. Native/Wasm strict Clippy,
format, GPU/adversarial/observation regressions and the prescribed local wall
are retained in the report. Raw `make ci` alone returned 2 for the same five
historical `zicsr-stub` dead-code diagnostics; production Clippy, the narrow
stub waiver and all remaining local wall commands passed. This is an explicit
waiver, not an unqualified `make ci` pass.

The only later source change at `a64e15c69332962fba34657427493c8d2264a14c`
made the browser proof process exit after its report, trace, browser and server
were closed. Its focused exact-head demo report is
`target/evidence/e9-t22g-demo-shutdown-exact-1/report.json`, SHA-256
`633b2b214ce23fc49e9b0c8a84edc6f6197720d8b937506e82e7ba8052d03ad5`.
`python3 -B tools/verify/e9-streamed-replay.py --output
target/evidence/e9-t22g-cold-2 --cold-clone
/private/tmp/wasm-vm-e9-t22g-cold-2` passed all 16 cold-clone commands on that
exact head, including the browser and 127/0 demo; report SHA-256
`d302713eb54bfe8039f76805823c7edff519c43c264937536d836dcc594b5b89`.
The earlier cold-1 failure is preserved: its demo assertions passed, but the
Node runner kept an idle handle open. No replay semantics changed in the fix.

Claim: the same private software or GPU machine now executes and witnesses an
initial-to-end exact history through bounded continuation windows without a
global resident tape, an unrelated checkpoint reset or live replay ingress.
Continuation binds the native state/source/adapter/GPU cursors and browser
pending/output bytes before admitting the next window. This is a worker claim,
not a verifier verdict. Main publication and a fresh actual Daybreak adversarial
review remain required before `verified`; H, C, D, T23 and T24 remain open.

### 2026-10-23 — fresh actual Daybreak final publication verifier — VERDICT: verified

- C1 bounded initial-to-end software/GPU history — HELD. Predicted the unchanged
  original histories would cross both whole-plan limits through two resident
  windows and retain original endpoint equality. The fresh local Daybreak critic
  independently recomputed all four trace/state digests and GPU composite
  witnesses at unchanged runtime `da1fc30bd9a4f2f52afb5658aa6453876bb575dd`;
  its report SHA-256 is
  `56e27c95e2b94ec5c7d313c78fe617c4305063a76485dd2076a580ec93578a64`.
- C2 complete admission fences and refusal-before-work — HELD. The same fresh
  critic covered predecessor/position/source/network/GPU/renderer/queue identity,
  before/observe, same-transition, WFI, deferred GPU completion, duplicates,
  gap/overlap/stale/reorder/wrong endpoint, an independent late-ordinal attack,
  and a partial-work sabotage oracle. Requested/returned
  `gpt-daybreak-blue-latest` on `daybreakBlue`; routing SHA-256
  `3d79de9777e3bb53a4ad86f8a0d01307686a87565894fa4fb2cb93463321b6ef`,
  completed without fallback or errors.
- C3 same private machine and fail-closed boundary — HELD. The final critic
  confirmed `a64e15c69332962fba34657427493c8d2264a14c..1fb03f231b9f6c107607dc77f86fd13def175638`
  changes only the task, queue, generated task timelines, and service-worker
  cache key; `da1fc30b..a64e15c6` is browser-runner shutdown only. No runtime,
  dependency, test, fixture, recording, live ingress/egress, resident-limit, or
  evidence boundary changed, so all four local HELD results carry forward.
- C4 high-risk proof and final publication — HELD. Local submission report
  `target/evidence/e9-t22g-submission-2/report.json` SHA-256
  `b17313662cf4e813ab8325f932d3c785ce2568497f97ab442469c169bbf8cda8`
  retains 14/14 commands. Pristine report
  `target/evidence/e9-t22g-cold-2/report.json` SHA-256
  `d302713eb54bfe8039f76805823c7edff519c43c264937536d836dcc594b5b89`
  retains 16/16 at cold head `a64e15c6`; exact demo report SHA-256
  `633b2b214ce23fc49e9b0c8a84edc6f6197720d8b937506e82e7ba8052d03ad5`
  retains 127/0. Raw `make ci` remains exit 2 for exactly five historical
  `zicsr-stub` dead-code diagnostics and is not claimed as a pass; production
  Clippy, the narrow waiver, and the remaining wall passed.
- MAIN publication — HELD. Frozen receipt
  `target/evidence/e9-t22g-main-publication-1/receipt.json` SHA-256
  `3a0264f8f0aca719f3cc05feba3a1f0302b436febd04a771b4d0bd3ef1996019`
  retains status `worker-main-proven-awaiting-final-Daybreak-verdict`, project
  `wasm-vm`, branch `main`, source head `1fb03f23`, `REBUILD=0`, and deployment
  `8cefc9c1` (`https://8cefc9c1.wasm-vm.pages.dev`). Acceptance was independently
  checked on canonical `https://wasm-vm.pages.dev/`: root, all 14 changed
  deployable bodies, and five sealed sidecars returned exact hashes; seven exact
  artifact R2 refs and two chunk-manifest refs returned bounded HEAD 200. Deploy
  log SHA-256 is
  `bf6f8823acb940287877eb753dc3ffd81fc10fe751183f219b79f8745f838ed2`.
- Retained public browser evidence — HELD. Report/executed-source/trace SHA-256
  values are respectively
  `2fcf049674a74bf7ba4abcfaad8bce7ba584f9e5e5330f21610a7e378ef1f823`,
  `0020ce8c5a1eed696f46d871b850c7d077b2ffee2a33f34c298ee7ba9cf05e21`,
  and `c709455ee3d96e9c5f9b1575bc776f4658c2c427613b6d62aae32bf7bb08aa83`.
  They retain 127/0, six ABI refusals, both G pips live, mobile `388 == 388`,
  and zero non-favicon console/HTTP/request errors. The first attempt's only
  console error is pinned by its trace to
  `https://wasm-vm.pages.dev/favicon.ico`, which AGENTS.md permits.
- Publication/PR hygiene — HELD. PR #611's sealed post-push snapshot SHA-256
  `e641489db6f68d4f971dadecf6b22ceea71f2133bfef3c53c3d32bcd64ad3269`
  and receipt record draft/OPEN, head `1fb03f23`, base
  `codex/e9-streamed-gpu-reader`; local and `origin/` refs match. Prior stack
  evidence SHA-256
  `25ab031a362ddb102230383756e06358a9e3ec0671e9f36677c0c70dfca13769`
  records all 33 predecessors OPEN/unmerged/unqueued, and retained Actions-policy
  evidence SHA-256
  `32700f5e09febdcc97d40b65c42a1c4b981b4b96af6eb1b8e87c932aba0a71ca`
  records `enabled:false`. No merge, queue, push, deployment, or remote mutation
  was performed by this verifier.
- Final verifier evidence: predictions SHA-256
  `edc14cb34ed743adc9477e28a6fd5a73150803817a643f92266cec412af8f02f`;
  `target/evidence/e9-t22g-daybreak-final-publication/report.md` SHA-256
  `9bd169ce826363705ea20115a290a801efc28ec4af7180fee21ff7a7187fbb61`;
  `report.json` SHA-256
  `4562a3b1878a8cfa3d586ddc43043a04d5519f9c573e9f2acc7272d42f91aed3`.
  Checkout was clean after the temporary production-manifest rewrite/restore.
- SUITE: retained the existing deterministic, guest-trace, pristine, adversarial,
  sabotage, browser-trace, and publication artifacts. No publication-only test,
  fixture, benchmark, broad-suite rerun, or browser rerun was warranted.

No E9-T22h timeline-consumer, full Alpine/Omarchy qualification, performance,
T23, T24, or whole-Epic claim is made.
