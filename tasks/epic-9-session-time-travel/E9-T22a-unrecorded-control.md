---
id: E9-T22a
epic: 9
title: Add a genuine live unrecorded execution control
priority: 524.92201
status: evidence-needed
depends_on: [E9-T15, E9-T16, E9-T18c, E9-T19]
estimate: S
risk: high
capstone: false
---

## Goal

Provide the honest recording-OFF control required by the unchanged T01 campaign.

## Boundary

One runtime execution-mode boundary: explicit live-unrecorded, record and replay
assembly for the same fixed software/GPU profiles. Preserve the RAM, topology,
immutable-base/COW path, pure ICount dividers, execution/JIT settings and owned
live-provider seams. Live-unrecorded must disable SessionClock and source,
input/output and GPU-result recording, checkpoint history and JS persistence;
discarding captured receipts is not OFF. It cannot be imported or relabelled as
an exact recording. Do not add a live network service in this slice; T22b owns it.

## Acceptance criteria

- [x] An explicit constructor/mode provides the original 256 MiB/ICount10 and 1 GiB/ICount64 live controls using the same owned device/provider seams as record mode.
- [x] Read-only diagnostics and direct tests demonstrate no session clock/source tape, receipt queues, recorder dirty epoch, GPU-result history or durable recording in OFF; record/replay remain unchanged and refuse cross-mode misuse before mutation.
- [x] Equal-work accounting includes actual attempted/retired/idle transitions without a per-instruction JavaScript loop, invented requested work, or artificial baseline delay. Input positions and completed work are independently inspectable.
- [x] Exercise real full Alpine disk/input/file work and the production physical GPU path. These qualify the new mode only; full GPU desktop/HTTP and performance claims remain gated on T22b/c/d.
- [ ] Run the high-risk local gauntlet, recorded deterministic state/guest evidence, actual built-browser proof, exact-head final cold clone and fresh actual Daybreak attacks; surface the accepted control on the demo/roadmap and publish the built main Cloudflare path.

## Deterministic acceptance

`make verify-E9-T22a`. The orchestrator requires a clean frozen head; a second
run with `--cold-clone NEW_DIRECTORY` rebuilds from that exact revision and
reconstructs the full immutable Alpine image from authenticated public chunks.
Record all affected core/Wasm tests, native/Wasm builds and direct browser
control assertions, plus source/evidence digests and the final cold-clone proof.

## Adversarial verification

Attack invalid/replayed constructors, stale and cross-owner I/O leases,
recording/checkpoint/import APIs invoked on OFF, post-restore mode confusion,
input/console ordering, dirty RAM and GPU completion paths. Inspect that OFF
never constructs capture structures or simply drains a recorder invisibly.
Probe real work counts at interrupt, exception, SBI, WFI/idle, JIT, source-flush
and final-budget boundaries. Preserve genuine baseline optimizations; do not
slow OFF to make the later overhead ratio pass. Sabotage one meaningful mode
or accounting guard and show that the promoted direct tests detect it.

## Verification log

### 2026-10-22 — worker — begin explicit unrecorded runtime boundary

Activated only after Daybreak's completed read-only design audit identified the
missing mode. All dependencies are verified. Parent E9-T22 is cancelled solely
as a planning container, replaced by ordered T22a–d. This task alone occupies
the active lane. Risk is high: architectural scheduling, provider ownership,
recording/replay identity and GPU-result boundaries change. No runtime code or
acceptance target is implemented at activation. Implement, record the full
prescribed risk-tier proof and final cold clone, and hand the exact diff plus
evidence to a fresh actual Daybreak verifier. Only that verifier sets verified.
No merge is authorized; continue the native stack with every PR left open.

### 2026-10-22 — worker — development findings and implementation (not final acceptance)

The explicit mode now assembles the same owned-provider software/GPU profiles
with raw live RTC/entropy and no SessionClock, source/input/result tape,
recorder dirty bitmap, checkpoint history or durable namespace. Payload-free
native work counters charge actual interpreter/JIT/tail retires, traps/SBI,
interrupts and separately fenced WFI timer advancement. UART offer/FIFO counters
report actual positions and bytes; ordinary optimizations remain enabled.

Fresh actual Daybreak design sessions used `gpt-daybreak-blue-latest`,
`cyberAccessProgram=daybreakBlue`, with provider fallback disabled. Candidate 1
found clock, GPU profile/lease, WFI wake and history ingress defects; they were
fixed with direct regressions. Candidate 2 carried P1/P2/P3/P5/P6 and the narrow
P8 construction predictions, and identified the remaining legacy snapshot
namespace chain. Its report is `target/evidence/e9-t22a-daybreak-runtime-design-2/final-message.md`,
SHA256 3dda06ae15427d93948d154f2c76691e06ff611cafaa0a4ac14fb813f3c2c959. Neither design audit sets task status or substitutes for
final exact-head verification.

The preserved pre-fix browser counterexample is
`target/evidence/e9-t22a-legacy-history-development-failure-1/report.json`,
SHA256 `52d68feafa3e1a9ea389bc534dca6be2069141f2932751be154a43fbd2c10d36`:
`stampBootSnapshotIdentity` plus `importStoredSnapshot` created an IndexedDB
namespace while OFF, and generation advanced from 0 to 1. Explicit OFF guards
now precede all nine legacy identity/generation/snapshot operations; diagnostics
also expose the legacy resume and persistent namespace flags. The new isolated
history attack is a required acceptance gate.

Development evidence before this last correction includes full pinned Alpine
file/setup and all three UART frames delivered, the 127/0 visible demo with real
JIT execution, physical M4 Max GPU query/readback and 24 original-owner/numeric/
profile/history refusal attacks, plus the existing interpreter/JIT software and
physical GPU record/replay regressions. These dirty-tree receipts are preserved
under `target/evidence/e9-t22a-*-development-*`; they are self-validation, not a
final claim. The native OFF/record comparison now retains both complete 4096-line
guest traces and a standalone literal-instruction/value oracle. Trace SHA256
`ff4c8f7046da309f79f8af510369a74bc1fd590f3deb1b0ff88c95c816f2046a`;
architectural digest `2f46d4f0185cd2e94327082dc107b2c75c94b0637dfa678113789184de6d779f`.

`make verify-E9-T22a` now selects affected strict native/Wasm checks, recorded
native/guest boundaries, built demo, full Alpine OFF and physical GPU OFF proof,
legacy-history attacks, both complete record/replay regressions and an artifact
reader, followed by the prescribed full local wall. The final cold-clone mode
rebuilds from the exact clean revision with scrubbed Rust/Cargo configuration,
no inherited target/node_modules/rootfs, and independently reconstructs the full
pinned Alpine base from authenticated public content-addressed chunks. The
full risk-tier run, final cold proof, fresh Daybreak full charter, publication
and terminal verification remain outstanding. No HTTP, desktop workload or
performance result is claimed by this task.

The corrected legacy attack passed at development Wasm
`b103aa2068b06bfbafdd85b0ddbb0f8e12db8cb2c3c3ef9cf694eabc5e0d31a1`:
`target/evidence/e9-t22a-legacy-history-development-fixed-1/report.json`, SHA256
`f8f58524d8fe4e15fca7c61a9b0acc2bd827c4c53e954ef29968bb55e18b2fa8`.
All nine operations refused, both legacy namespace flags stayed false, generation
remained zero, and no IndexedDB database was created. This remains development
evidence; final frozen submission is required below. Candidate 2's report has a
one-entry inventory typo (34 source files, not 35); its cited manifest and patch
hashes match exactly, and the original report is preserved with a companion note.

### 2026-10-22 — worker — fixed audio provider parity and completed coverage

The first frozen submission at `39700c0626249487f6a00fbdfeabed6bd0a4a32a`
completed every selected acceptance gate and the complete local wall:
`target/evidence/e9-t22a-final-39700c0/report.json`, SHA256
`034c176f36d385f4210f3a1b26e0ee6642ce9a02718619da6ff44f39868f0b22`;
its gauntlet report is SHA256
`f04b0ce42c8bcfbd5410babb882a244398068a1462ec15596a21fbef13ec02f6`.
The wall retained the exact five historical zicsr-stub diagnostics; strict
production checks and the remaining wall passed. A stop was planned after the
provider finding below, but the observed test process had already exited and no
signal was sent. The run finished normally. Those passing old-build receipts
remain preserved; they do not establish the corrected runtime's acceptance.

A third fresh actual Daybreak configuration audit found an uncovered fixed-profile
contradiction: OFF alone could hot-replace audio providers because its
`input_capture` is absent. Report
`target/evidence/e9-t22a-daybreak-provider-audit-39700c0/final-message.md`, SHA256
`c77214340f26b48a9f3f20cf1de42f9ec5e6c566e1c3f89c6b2895236a9e710d`.
It correctly distinguished the device-local audio clock from CPU ICount and
hardware microphone capture from time-travel recording. The microphone remains
inert in this profile, but installing either unsupported provider still violates
the unchanged contract's hot-attachment policy. P5 found no other comparable
ingress contradiction in its bounded audit.

The valid-production-ring browser counterexample is
`target/evidence/e9-t22a-audio-provider-development-failure-1/report.json`, SHA256
`59248bb029c33ec7fec6ca9e0353bfeb49861d34443b55f5fab295b4c1ebf5f7`.
A separate ordinary VM accepted both rings; OFF also accepted them and changed
both attachment flags. Both OFF APIs now reject before provider ownership changes,
while preserving Record/Replay validation and error precedence. Diagnostics expose
`audioOutputAttached` and `audioCaptureAttached`. The corrected browser result is
`target/evidence/e9-t22a-audio-provider-development-fixed-1/report.json`, SHA256
`bbb0cf364e98f4addd919ef1a6037e4d843f897a59a03bca064145caf95267e3`:
all 11 history/provider attempts refused with unchanged RAM/work/clock/generation/
audio state and no database; the ordinary valid-ring control still passed.

Added the permanent `e9_unrecorded_providers` native regression so the new OFF
agent completion branch is exercised by a real guest named-agent request and DMA,
including oversized and duplicate result refusals. The fixture is the independently
pinned T12 guest with only its 13 console-slot LUI materializations changed from
slot 7 to the production profile's slot 8. The workspace-locked development test
passed, retaining 9096 retired instructions, the actual 23-byte guest payload,
one used entry/cursor increment, no recorder, and architectural digest
`7ffc20c4eb29b661cb177b8d13f187296ca09add37c6e2920fccec64890fc301`.
Evidence: `target/evidence/e9-t22a-agent-permanent-development-1` and its adjacent
log. An earlier standalone development driver resolved newer cached dependencies;
that result is explicitly unqualified and preserved with a drift note. The new
permanent test uses the repository lock and supersedes that driver.

GPU proof now challenges numeric APIs with the renderer's authentic pending DMA
coordinates before allowing the original typed capability, and covers the existing
physical layered fixture. Development layered OFF proof passed at Wasm
`05fdca361c492aa7d4bf45ae1d41f69f354162627807a042ba1889d64b46b3ea`:
`target/evidence/e9-t22a-gpu-off-layered-development-1/report.json`, SHA256
`8bd0696696ba3120c50cd1e9add71f9b8902e06b3ed3ab5dc3aebb16e77888cf`.
All four real gather/scatter forms refused numeric authority, while typed layered
input/output, guard bytes and physical GPU results succeeded. These are bounded
functional fixtures; they do not qualify the full desktop or any performance budget.

The final acceptance target now requires the agent raw witness, default and
layered physical GPU proof, valid-ring parity attacks and the previous complete
regressions. Because the audio admission semantics changed, freeze the corrected
runtime and rerun the selected high-risk submission from the top, followed by
its final exact-head cold checkout and a fresh actual Daybreak full charter.
Only that later verifier may set a terminal task status. No new ISA or compliance
ELF is introduced by this mode boundary; the existing 127-test demo remains the
required live suite. No merge or performance/desktop/HTTP claim is authorized.

### 2026-10-22 — worker — final corrected exact-head submission

Runtime is frozen at `ba85c3978d665fe20c9b750c7261d803e8f6340d`, with clean
source before and after both submissions. The diff is `73794d3ec..ba85c397`;
this status/log commit changes no runtime or harness. The corrected submission
passed all 27 selected gates, including the complete local wall:

- Command: `E9_UNRECORDED_EVIDENCE_DIR="$PWD/target/evidence/e9-t22a-final-ba85c39" make verify-E9-T22a`.
- Primary report: `target/evidence/e9-t22a-final-ba85c39/report.json`, SHA256
  `1415078644a610f64f5a7fc06dbc9886153430eb679b76d3ab982a1c6b7dae8a`.
- Wall report: `target/evidence/e9-t22a-final-ba85c39/gauntlet/report.json`,
  SHA256 `0d07370e5c0d09e14e3b72a29caacc01f197ec2be12614dbe52007ecd720270b`.
  Initial `make ci` stopped at exactly the five documented historical
  quarantined zicsr-stub dead-code diagnostics. Its exact scoped waiver passed;
  production Clippy remained strict. The complete remaining wall passed in
  1957.65 seconds: native/Wasm tests, feature matrix, RISC-V suites, native/Wasm
  golden fingerprints and performance smoke. Its passing test summaries total
  2480 invocations, not a claim of 2480 unique cases. Performance smoke is not
  the deferred recording-overhead campaign.
- Final cold command: `python3 -B tools/verify/e9-unrecorded.py --output "$PWD/target/evidence/e9-t22a-cold-ba85c39" --cold-clone /Users/blamy/Documents/Codex/.e9-t22a-cold-ba85c39`.
  All 28 cold gates passed. Report SHA256
  `2506fcd84d1746e7225ecd740caeedfcd8afa11fc099bc4a4bb43a77ec0da00d`.
  The exact detached runtime checkout had no inherited target, node_modules or
  rootfs, and used scrubbed Rust/Cargo environment. It reconstructed the full
  536870912-byte Alpine base from 227 unique authenticated public chunks;
  final raw SHA256 `ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8`.
  The full wall executes once in the primary; cold repeats the direct native,
  Wasm, built-browser and artifact gates. Both final source manifests (51
  changed files) and all rebuilt runtime identities match exactly.

Both submissions recorded the literal 4096-instruction OFF/record comparison,
IRQ/exception/SBI/WFI/tail/overflow and code-coherence assertions, original-owner
block/network/agent boundaries, actual UART delivery counters, and unchanged
software/GPU record/replay. The permanent workspace-locked agent test retained
9096 guest trace lines and the real 23-byte DMA payload with cursor/used = 1.
The trace is SHA256 `48ada638af5fe8bc36b2e0dbb7fbe6860764cd85ab06ba5cc3437cd622b82245`;
DMA SHA256 `4325207858c8fa8276b84319205a2fab3cdc528f31c210e33ab1c6cf1485df7c`.
The independent artifact readers passed: primary SHA256
`949ade0d45c644c0b5e546c1c20e8a92df415fd758a60890940e0e6f02b2495f`, cold
`627a12e803e095327970213f6a667045895c98126329c7b49d5a851130443f42`.
All 141 primary and 364 cold evidence-file hashes were rechecked before this
submission. Raw files, original failed attempts and old-build passing receipts
remain preserved; none were relabelled as final corrected proof.

All seven browser paths passed in both final submissions: valid-ring ordinary
control plus 11 OFF history/audio refusals; the 127/0 demo with the visible
one-million-transition real-JIT control; full pinned Alpine literal file/input/
RTC/entropy work; physical Apple M4 Max GPU OFF; software record/replay; physical
GPU record/replay with rollback/context-loss attacks; and physical layered GPU
OFF with authentic pending numeric-DMA refusals, successful original typed DMA
and guard bytes. Reports bind screenshots, Playwright traces, full source and
raw witnesses. No unexpected console errors were recorded. Built Wasm SHA256
is `05fdca361c492aa7d4bf45ae1d41f69f354162627807a042ba1889d64b46b3ea`;
GPU graph is `e49121f1109c9b5cdbdc5bec0e2ecb94d8496b822658c87dc6fcf32c79424164`
over 74 files. Source/dist bytes and the cold rebuild agree.

Actual Daybreak's read-only corrected preflight completed with P1–P7 HELD,
no new runtime contradiction, and P8 requiring the then-unfinished final proof.
Report `target/evidence/e9-t22a-daybreak-corrected-review/final-message.md`, SHA256
`e0f8e8f6146a926bf0cca55b20f74b31670cae82693acb2751783f3f38cca26e`;
routing SHA256 `03756ff6b07c2553e8a74c8c7fbe02f25c4b879dcfd3d0b0f526705f6d659eb0`.
The requested/returned model was `gpt-daybreak-blue-latest`, program
`daybreakBlue`, provider fallback disabled. That preflight was not a full task
verdict. A new fresh actual Daybreak session must now perform the complete
charter, bounded novel attack and guard sabotage, audit coverage and retain or
promote the permanent checks. The main Cloudflare publication and independent
public-path verdict are still outstanding. Only the verifier may set verified.
The roadmap remains partial until the accepted local boundary is ready to ship.
No HTTP, full GPU desktop, recording-overhead or Epic 9 completion claim is
made; T22b/c/d, T23 and T24 remain required. PR #605 stays open and unmerged.

### 2026-10-22 — verifier — VERDICT: needs-evidence

- **P1–P17 local/cold correctness and sufficiency — HELD.** Predictions were frozen
  before evidence inspection in
  `target/evidence/e9-t22a-daybreak-full-charter/predictions.md`, SHA256
  `2616cc3b023ef9a28d8e6331a10e7c6052bf3eee8677b7bf39c86b0dfc1fd24f`.
  Independent rehashing found zero mismatch across all 141 primary and 364 cold
  manifest files, all 51 exact-`ba85c39` source bindings and all nine rebuilt
  source/committed-dist entries. The cold checkout is clean at `ba85c39`; its
  independently streamed full 512 MiB Alpine reconstruction matches raw SHA256
  `ebcd6b7a3569f6280f901b9697f3b8f06a11dd800b2410b540fb6bbdea8c60f8`.
  The literal 4096-line OFF/Record traces, 9096-line agent trace/23-byte DMA,
  full Alpine file/input/RTC/entropy work, 127/0 visible demo, default/layered
  physical GPU authority attacks, valid-audio control plus 11 atomic OFF refusals,
  and unchanged software/physical-GPU Record/Replay were inspected at their raw
  values. Primary/cold/wall bindings remain respectively
  `1415078644a610f64f5a7fc06dbc9886153430eb679b76d3ab982a1c6b7dae8a`,
  `2506fcd84d1746e7225ecd740caeedfcd8afa11fc099bc4a4bb43a77ec0da00d`,
  and `0d07370e5c0d09e14e3b72a29caacc01f197ec2be12614dbe52007ecd720270b`.
  The full wall contains only the exact five historical quarantined zicsr-stub
  dead-code diagnostics, with its exact waiver and strict production Clippy passing.
- **P18 novel post-construction owner-confusion attack — HELD.** After a valid OFF
  receive, a Record-owner capability with the same numeric request id and identical
  frame was rejected `StaleLease` without changing the OFF snapshot, request, cursor,
  work or queued receive; the original OFF lease then completed. Scratch log SHA256
  `f1027e0a013f75e695b0522cd568eeb38305caa6df6ff02f2591a173b99f1605`;
  preserved test patch SHA256
  `5d3d40a4a67133c8fa0bcda689e2e3ce15e59af73100e0e23b8e68ae027fda27`.
- **P19 sabotage — HELD.** The permanent history/mode-refusal test passed original,
  failed exit 101 with `Ok(())` versus `Err(AlreadyActive)` when only the
  `live_unrecorded` guard in `start_session_clock` was removed, and passed after exact
  restoration. Mutant log SHA256
  `3e2d6d83513fb7647c9eb10d35d6d85b9c5e5e2286f0bb485379400577f7ca95`;
  sabotage patch SHA256
  `6f78a0aadbecc00665c9daf7a4ec7d8c1d6e77d63f4d22709387758a8d14fc28`.
  Main runtime/fixture source was never edited.
- **COVERAGE — HELD.** All 193 textual hunks across 51 changed files are classified:
  core 56/12 files, Wasm 60/8, verifier/Make 10/10, source web runtime 10/5 and
  deployable runtime 32/10 are exercised; generated `tasks.json` 11/1,
  declarations/cache stamp 11/3 and task metadata 3/2 are narrowly waived.
  No changed runtime hunk needs evidence. Exact hunk headers and evidence mapping are
  in `manifest-audit.json:/hunkInventory` and `report.json:/changedHunkCoverage`.
- **SUITE — retain existing.** The permanent `session_live`, GPU capability and locked
  agent regressions plus the guest traces already assert the verified primitives. The
  novel scratch composition found no new primitive warranting a frozen-source test
  promotion; its runnable patch/log are preserved without invalidating the cold boundary.
- **P20 main publication — NEEDS EVIDENCE.** No deployment or remote request was
  authorized in this charter. The sole remaining T22a proof is publication of the exact
  accepted committed dist to `https://wasm-vm.pages.dev`, followed by a new independent
  Daybreak verifier binding main `/app` bytes to Wasm
  `05fdca361c492aa7d4bf45ae1d41f69f354162627807a042ba1889d64b46b3ea`
  and GPU graph
  `e49121f1109c9b5cdbdc5bec0e2ecb94d8496b822658c87dc6fcf32c79424164`,
  and checking the bounded public 127/0 OFF control, live/verified pips, no history/
  namespace and zero unexpected errors. This is not a runtime refutation; status is
  `evidence-needed`, and the fifth acceptance checkbox remains open. T22b/c/d, T23
  and T24 are unchanged.

Full reports:
`target/evidence/e9-t22a-daybreak-full-charter/report.json`, SHA256
`03acae1882bf92a9d5ceda60006abfcd87d82481487d4f57049f376c8017f96a`;
`report.md`, SHA256
`ff9fe8bd96b8491d1d92a30e1b82620810d2403df624605e616d85d9653f75b9`;
corrected independent manifest audit SHA256
`0d8b1e8840bf303fec7f10696f58333d6ac12a2273f2ed624dc6899e0e081a3d`.
The initial audit receipt is retained separately: it treated the authenticated sparse
zero chunk as absent; after applying the manifest's explicit sparse-hole rule, the
full reconstruction matched exactly. No push, merge or publication was performed.

### 2026-10-22 — worker — main production release and public proof

Published committed release `242c7d5b92aaeee87306fc123821272b368d2ea9` with
`bash tools/deploy-cloudflare.sh` to project `wasm-vm`, production branch `main`:
**https://wasm-vm.pages.dev/**, demo **https://wasm-vm.pages.dev/app**.
Cloudflare deployment is `1fe76e3b`. The native stack submission pushed the same
release to draft OPEN PR #605; all 28 PRs remain open/unmerged/unqueued, Actions
is disabled, and auto-merge is absent. The release differs from verifier commit
`5830efac71dadd4f96fc461e47e64ba0685e6899` in exactly five declarative/generated
files: roadmap source/dist, task JSON source/dist and the app-shell cache stamp
`ec4afe2e12e2`. Manual `make web-dist` completed before committing its dist;
accepted Wasm `05fdca36…b3ea` and 74-file GPU graph `e49121f1…4164` are unchanged.
Local release demo report SHA256
`ff67046d03e37fe1edbf48cab396b4210413f709ba739a9e46d540601a0866df`
proves 127/0, the real-JIT one-million-transition OFF control and live pips with
zero errors. The documentation check passed after rerunning with write access
to its normal receipt directory; its first sandboxed invocation could not write
`target/docs-build/docs-validation.json`. No product check was contradicted.

The deployment validated all local and public content-addressed R2 payloads,
then uploaded the site. Exact committed/deployed five-manifest sidecars and the
original deploy log are retained. Temporary R2 URL rewrites were restored to
committed bytes before subsequent browser proof, leaving tracked source clean.
The first immediate public-byte check failed: main `/app.html` returned SHA256
`1b3ccafecb3a0a641a1f62b0592ec07a4fb7ddb4426c762e5887de554197e252`,
exactly the prior T21 accepted HTML, instead of current
`515aa72dd77ac6819147dcbdafaa90bd43c03ab271eb86cd84d9e990384adad6`.
The original publication receipt remains FAILED, SHA256
`ccb35857d5bade03857dff8fd49d9456114512d185a3affd917ee7039173ca1b`;
its failed public-assets report remains SHA256
`fc75b9abd34454c89eb6eb5b8d0e219b51f9eeb614717a321708fcc081e92155`.
Later raw GETs of both main spellings and deployment `/app` returned the exact
new 64376-byte HTML, preserved with headers/diffs under
`target/evidence/e9-t22a-public-html-diagnosis-1`. No original result was relabelled.

After that main-alias rollout delay, repeated only the missing public proof,
with no product or redeployment change. The strict reader uses the original
five deployed manifest sidecars as expected bytes while source remains restored;
all other files compare against committed dist. Final follow-up receipt:
`target/evidence/e9-t22a-production-release-public-recheck/receipt.json`, SHA256
`b8b230fc1d283c729823206c4df501a237d5f5780383de42902f7c8ffedcc1cd`.
Its public-assets report SHA256
`a9185847e2873a8f440bfa60d09d14879fdb566d77f2710b8313bd290e869725`
proves all 107 actual-main assets, including the full 74-file trusted runtime,
every changed deployable and all three marketing cases. Its recorded public
browser report SHA256
`813d02b36b70c16a54bc6df38ccd8ad57f326b158d1fb05b86f413ec76d24a16`
proves 127 passed/0 failed, one million real OFF transitions with JIT execution,
refused history APIs, absent capture/persistence flags and live pips. No
unexpected console/page/missing requests occurred. One exact same-origin
`/favicon.ico` resource 404 is retained separately under the AGENTS exception.
The sole off-origin probe request was the exact content-addressed pinned R2
kernel; the probe checks its full response digest. Screenshot, Playwright trace
and exact executed driver are retained; driver SHA256
`50a07a4b14a011ccb1c1c301b920c5eb99e16bb8aa176ffe740eec13320b5a94`.

This worker entry does not set verified. The final fresh actual Daybreak public
verifier must carry the unchanged local/cold/full-charter HELD results, inspect
these receipts and independently read the current main path, then close only
T22a if every criterion holds. T22b/c/d, T23 and T24 remain required. No merge
or performance/full-desktop/HTTP campaign claim is made.
