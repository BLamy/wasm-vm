---
id: E9-T22f
epic: 9
title: Authenticate long GPU histories with bounded interval reads
priority: 524.922022
status: implemented
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

### 2026-10-23 — worker — strict test lint and oracle refinement

Frozen submission 1 at `7b4a244bec86d9ce0b9814b5b86d9662ad8878eb`
stopped at affected all-target Clippy: the new origin test assigned fields after
`Default::default()`. Use a struct initializer; no lint allowance or runtime
semantic change. No later formal gate ran. The independent oracle now also
decodes native `WVGPUR01` body hash/length fields literally and checks real green
pixels and visible/empty query packets, rather than relying on the reader's body
reference for that association. Keep the failed submission/log and development
evidence. Rerun the failed gate and the final frozen submission; no verdict or
publication is claimed.


### 2026-10-23 — worker — preserve completed submission and repair legacy cancellation

Frozen high-risk submission 2 passed all 50 commands at
`2b61e2d6091ce16e8c6168ac7d43900b0458ed1b` with clean final checkout.
Report `target/evidence/e9-t22f-final-submission-2/report.json`, SHA-256
`40a4e1cc8f4053e15ad09dd1943cd37fdc79883878b93719b74033dfe5b6213e`.
It includes the complete bounded reader/literal oracle, 130-witness/archive
regression, original GPU replay/literal oracle, v1 store crash/race/quota,
built demo and local gauntlet. The gauntlet preserves the raw make-ci failure
and exact five pre-existing zicsr-stub dead-code warnings; the narrow explicit
waiver and remaining full wall passed. This is worker evidence, not a verdict.

The separate actual Daybreak v1 cancellation session executed its sealed
bounded browser probe and recorded 38 losing-scan IDB transactions after the
outer cancellation and writer-lock reuse, with no callback/result/candidate
escape. Its raw probe is `target/evidence/e9-t22f-daybreak-v1-cancel-probe/probe-raw.json`,
SHA-256 `794b014c2741e5c4ffb7ff288711063971c1b1e4d66f20edfc720a1989d940e8`.
The session subsequently FAILED with a cyberPolicy account eligibility error;
it produced no completed report/verdict. Preserve routing and the raw probe;
do not count this session as completed independent verification.

The worker propagates cancellation through legacy root/prefix/small/descriptor
metadata reads, checks activity across their awaits and preserves Cancelled/
Closed through descriptor parsing. The permanent v1/v2 initial-open regression
now waits for the entire losing open to settle, rather than only its first
stream, and tests abort plus store close. A focused development replay of the
same retained genuine v1/v2 inputs passed with the same caller signal and zero
late transactions for either format; no callback or replay candidate.
Worker-only self-check `target/evidence/e9-t22f-v1-cancel-repair-development/probe-raw.json`,
SHA-256 `d9c45dc73d821092aa409735114c84a86db608e1c62f30ceabbdb04c25ee3f80`.
Runtime changes require a new freeze, selected high-risk gates and final cold
proof; all terminal criteria and status remain incomplete.


### 2026-10-23 — worker — implemented complete authenticated bounded history reads

Final runtime source `24e9da174a7e6cf44f1edce1487a9c56514f6f60` passed the frozen high-risk submission
`E9_OUT=target/evidence/e9-t22f-final-submission-3 make verify-E9-T22f`.
The one final pristine run used
`python3 -B tools/verify/e9-gpu-reader-stream.py --output target/evidence/e9-t22f-final-cold-1 --cold-clone /Users/blamy/Documents/Codex/.e9-t22f-final-cold-24e9da17`:
fresh checkout/target/npm dependencies, scrubbed Rust/Cargo/log flags, debug
information disabled while normal debug assertions remain enabled. All 53
pristine commands passed and source/dist runtime bytes matched with clean final
checkouts. The primary local wall retains raw `make ci` exit2 for ONLY the exact
five historical quarantined zicsr-stub dead-code diagnostics; strict production
Clippy, the explicit narrow stub waiver and the remaining complete local wall
passed. Do not describe raw `make ci` as an unqualified pass.

The actual native recordings contain 4,359 input/control receipts and a separate
67,125,819-byte block receipt history, plus the original physical GPU/query/
readback guest. Closure/runtime/profile/frame/witness authentication precedes
consumer/candidate access. All 58 threats and 10 codec/ownership checks passed,
including four v1/v2 abort/close initial scans with the identical caller signal,
zero new IDB transactions after writer reuse through full losing-open settlement,
zero consumer/candidate/result escape, and unchanged 2,048-receipt v1 reading.
Opaque one-use bounded cursors retain exact positions/sequences and real 2,048
witnesses with the 4,096/4,097 Before cut. The literal oracle independently decoded
raw/native GPU body refs, CAS and returned bytes, green pixels and query results.
Reported window/buffer maxima are explicit ownership counters, not RSS or heap
use. All three native final/RAM/queue/logical-state/workload results match the
pristine run; only actual ephemeral loopback URL ports differ in configurations,
as separately enumerated without normalizing persisted bytes.

The built app and pristine app both passed 127/0 with zero browser/HTTP errors,
coordinated controls, panel/roadmap LIVE and desktop/phone screenshots. Root viewed
the fresh primary captures and the layout holds. Current VM SHA
`ad6b8fd8b76c89d67ad4c38b6ae6b414e6abc57d885c37742dd29e50e8849db8`,
2599831 bytes; GPU build
`d2d4d0f21ab13b9eff92aeeffe57ebfe60b11dfb528a21a2a1ca9c412a8a5cf7`.

Completed actual Daybreak reviews held the repaired legacy metadata boundary,
root/descriptor/event await edges, meaningful sabotage (38 late reads on the
mutant versus 0 frozen), unchanged scoped predictions and the full current local
proof/coverage. The callback-settlement scope review found no stronger read-drain
guarantee in F and demanded no rework; do not infer a new zero-I/O promise for
unawaited consumer operations. Local closure is nonterminal and still requires
main deployment/public byte and browser checks plus a fresh final publication
critic. Status becomes implemented only. No native continuation, timeline
execution, original Linux/Omarchy workload/performance or whole-Epic completion
is claimed; G/H/C/D and later T23/T24 remain gated. Native stacked PRs remain
OPEN/draft/unmerged/unqueued and Actions disabled.

Frozen evidence:

- `target/evidence/e9-t22f-final-submission-3/report.json`, SHA-256 `d159b745554f98f3d00af775fb2e629f6995be8b05540f11364bac7f7e73dd5d`.
- `target/evidence/e9-t22f-final-cold-1/report.json`, SHA-256 `eb22e1288e691d2b6bfae1be8c64cec6afdd4cf86af5514a546b3e590c38ec21`.
- `target/evidence/e9-t22f-daybreak-legacy-repair-review/report.json`, SHA-256 `bc22572795848a3b0e0a50359b2e02f58b2136b27129cdad5a3fd03998504b1f`.
- `target/evidence/e9-t22f-daybreak-legacy-repair-review/routing.json`, SHA-256 `f15fb88de7548788fbc742c38e8c4808deac202283557876d469f245447c3da7`.
- `target/evidence/e9-t22f-daybreak-callback-settlement-probe/report.json`, SHA-256 `f9b2166225e68dba8128e0329255c7c0a862512e6710969f3e696be81b9a9df2`.
- `target/evidence/e9-t22f-daybreak-callback-settlement-probe/routing.json`, SHA-256 `59c293d497ae8ee3080b0869ad967566de69f877bcbfe4a8b9a7a48ddafc896b`.
- `target/evidence/e9-t22f-daybreak-local-gate-closure/report.json`, SHA-256 `0801d7e1d34e1b74cf35be0732cf8d6690738d0bf954bfcaba37d135ab1fce02`.
- `target/evidence/e9-t22f-daybreak-local-gate-closure/routing.json`, SHA-256 `b0ff6e166c271df26477a3f36b014b2daadd0a737fffd8d82c0a50f3105d9d86`.
- `target/evidence/e9-t22f-final-submission-3/reader/report.json`, SHA-256 `d11257181ef8d4fb2082d179c88e5ba000590383dbe4432b122205690a55b40e`.
- `target/evidence/e9-t22f-final-submission-3/reader/independent-reader-oracle/report.json`, SHA-256 `f9de938579acd0014ae1255f21cf2618c0c757097d7c4d5b9aa5d7b757a48f3b`.
- `target/evidence/e9-t22f-final-submission-3/demo/report.json`, SHA-256 `e0b87dff9df1d7c03db0128d4c39df4d40977a675a50b6ea59036d19368ca223`.
