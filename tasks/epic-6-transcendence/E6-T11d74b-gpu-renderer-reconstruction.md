---
id: E6-T11d74b
epic: 6
title: Reconstruct a production renderer in a fresh physical GPU context
priority: 525.0270382
status: verified
depends_on: [E6-T11d74a]
estimate: S
risk: high
capstone: false
---

## Boundary

Record a bounded portable reconstruction journal or equivalent logical state
for the actual production bridge, including resource contents, command state,
shaders, transfers, queries and retained scanout. Recreate native WebGL objects
in a fresh qualified context; never serialize or reuse handles. Restore must
validate framing, limits, profile and data identities before publishing an owner.
Captured DMA and completion records may not mutate a restored guest during host
reconstruction. Loss/reset revokes old generations and aborts failed restores.

## Deterministic acceptance

`make verify-E6-T11d74b` records physical GPU draws, exact supported buffer/image
contents, render state and scanout before a checkpoint and after reconstruction
in a fresh context. Subsequent original draws must produce new checked pixels;
include dimensional depth, transform feedback, queries and production transfers.
Record bounded sizes/timeouts and malformed/profile/stale/incomplete refusals,
zero unexpected browser errors and allocation cleanup. Build affected target and
record one final pristine browser proof.

## Adversarial verification

Invent a data/state mutation not covered by the happy path. Check true physical
context identity changes, no stale native handles or completion callbacks, no
self-generated expected pixels, and no replay DMA into resumed RAM. Corrupt one
journal frame/data digest and remove a generation guard in isolated copies;
restoration must fail rather than display a saved screenshot.

## Verification log

### 2026-10-15 — worker — explicit accelerated warm-boot scope

The user's clarified goal is warm boot with GPU rendering. This is an ordered
implementation boundary of that request, not the cancelled software-default
workaround. Existing independent rendering/timekeeping proofs carry only across
unchanged code and dependency identities; new checkpoint behavior needs its own
recorded acceptance and fresh verifier.

### 2026-10-15 — worker — production reconstruction profile

Native74a is independently verified at e26e3e83. This layer records immutable
original events/DMA inputs and checks physical resource contents after replay in
a new context, with no live-native DMA or completion during reconstruction.
The initial checkpoint profile explicitly refuses multisample storage,
active/ended-native/pending queries, pending jobs/presentation and failed applied
prefixes. Ready queries, retained resources/private image views, dimensional
packed depth/stencil and transform-feedback-written buffers require proof.
Journal overflow makes checkpointing unavailable while ordinary rendering
continues. Detailed pre-implementation plan is in
`target/evidence/production-gpu-warm-restore-plan01/renderer-design.json`;
fresh critic recorded ten predictions before implementation.

### 2026-10-15 — worker — physical implementation frozen for acceptance

The canonical production renderer now has an opt-in bounded immutable event/DMA
journal, portable value codec, exact qualified-profile check, and unpublished
fresh-context reconstruction. Replay checks real GPU outputs, query measurements,
logical ownership and all live GPU allocation bytes, including private mip/layer
views and unreferenced retained generations. It never invokes live guest DMA or
completion. Historical scanout captures retire silently; activation reads current
restored GPU storage through the real scanout path. Epoch rebasing preserves
sequence/generation ownership. Failed/cancelled activation disposes all allocations.
MSAA, undrained query/presentation state, failed event prefixes and journal overflow
refuse checkpointing; overflow does not stop ordinary original rendering.

`make verify-E6-T11d74b` is the frozen acceptance. It builds the proof Wasm and
ordinary web target, records three worker hardware rows, the independent critic's
six-mode hardware matrix and isolated stale-epoch sabotage, the unchanged real
multisample regression, codec hostile-input tests, and the default demo. Native74a's
unchanged core evidence carries. One full-history pristine clone runs the same
command with scrubbed compiler/Cargo/critic environment. This boundary does not
claim the default worker or a production guest has GPU warm boot yet;74c/d compose
and publish that path.

Self-validation: worker self09 passed three physical rows, including literal blue
private mip sampling before/after old-ID reuse, dimensional packed depth/stencil,
GPU-written transform feedback with preserved append cursor, original WAIT_HOST
and ready queries plus independently delayed fresh physical availability, scanout
FLUSH/receipt, malformed/profile refusal, MSAA/ended-query/failed-prefix refusal,
overlapping capture refusal and budget-exhausted rendering. All native objects and
fences are released. The retained self08 failure was a test fixture passing float
values where the existing clear helper expects IEEE754 words; changing only that
fixture to `.map(word)` produced self09. It was not a runtime rendering fix.

Frozen01 at de33c99f passed policy,13 syntax checks, codec, both builds,
three worker hardware rows and six independent hardware attack rows. Its outer
runner then failed because it incorrectly required exit0 from the intentionally
sabotaged stale-epoch negative control. The browser correctly exited1 and recorded
stale expected epoch acceptance/epoch3 after removal of that one guard, with zero
browser errors/owners. This is a recording-wrapper failure, preserved in frozen01.
The runner now requires that exact exit1, authenticates its compressed row and
checks the precise failure/state/cleanup; arbitrary browser failure cannot pass.
Only the recording harness changed. Prior physical prefixes carry; the one final
pristine run executes the corrected full command and remaining default/MSAA gates.

### 2026-10-15 — worker — physical renderer reconstruction submission

Acceptance head `d38bec548bf0884067d639c7e13b1798b75d483c`; runtime head
`de33c99f` (the later change only fixes exact expected-negative handling/log).
Commands: `make web-dist` recorded before freeze;
`VIRGL_RENDERER_CHECKPOINT_EVIDENCE_DIR=... make verify-E6-T11d74b`;
then `python3 target/evidence/production-gpu-warm-restore-plan01/renderer-cold.py`
cloned full history with `git clone --no-local`, no alternates, checked out the
exact acceptance head, scrubbed RUSTFLAGS/RUSTDOCFLAGS/RUST_LOG/CARGO_*/VIRGL_*/
CRITIC_* and ran the complete22-gate acceptance. All corrected gates passed:
5 codec tests, proof/ordinary web builds, three worker GPU rows, six independent
attack rows, exact guard-removal negative, three original multisample schedules,
and default demo127passed/0failed/errors[] with screenshot. Captures include
original guest command trace/native state digests, hardware command/result rows,
fresh-context GPU content identities, source pins and browser coverage. Native74a
claims carry only over unchanged core code; no worker pairing or production guest
warm-boot claim is made at this layer.

Reopened durable worker capsule:
`evidence/virgl-production-renderer-checkpoint/worker/physical-renderer-reconstruction-submission.tar.gz`
(20,019,730bytes; SHA256 `69e04e2d872fd3915c1aaa978d67885dc5d8489565078811e13166c486cc210e`; 589members / 588authenticated identities).
It preserves the original frozen01 wrapper failure and self08 fixture failure,
self09 corrected hardware rows, the final full pristine run, source/diff and build
logs. Unpacked evidence: `target/evidence/production-renderer-checkpoint-cold01`
(exclude its `.git`/checkout from archives), `...-frozen01`, `...-self09`, and
`...-submission01/receipt.json`. Fresh verifier must inspect the diff against
these exact records, including its independent pending/active/partial/incomplete
supplement; only that verifier may set `verified`.

### 2026-10-15 — fresh verifier — VERDICT: verified

VERDICT: verified

- R1–R3 physical contents/fresh ownership/isolated replay — HELD. Before inspecting
  the implementation, predicted all retained GPU-written bytes and new draws would
  survive a different real context without live guest DMA/completion. The final
  original-queue recording preserves literal dimensional D24S8 mip/layer bytes,
  blue private image sampling after resource-ID reuse, transform-feedback data and
  append cursor; new physical query/draw outputs remain correct. Independent
  poisoned-RAM magenta/Z16 and asymmetric draw tests preserve the entire native
  digest, used ring and RAM across replay. Source and fresh owners both release
  all objects/syncs. Citations: capsule cold01/acceptance/physical-checkpoint,
  independent-attacks; independent promoted-flush-all02 and coverage ledger R1–R3.
- R4–R6 identities/epochs/bounds/applied failures — HELD. The independent rehashed
  gather-data mutation fails fresh physical identity, and deleting only the exact
  expected-epoch comparison makes the promoted stale1->3 assertion fail with
  observed epoch3. The positive check refuses at epoch2. Tightened byte/frame
  budgets refuse capture while original GPU rendering continues. Four promoted
  guard cases additionally exercise a pending original job, active query with
  zero native parts, an actually applied blue CLEAR followed by invalid DRAW
  (appliedCommands1/0x1205), and a rehashed incomplete journal; all refuse capture
  or reconstruction, preserve the original owner and clean failed staged owners.
  Citations: epoch-control-authentication.json; final-guard-supplement01, four
  physical rows/658 assertions; guard-supplement-authentication.json.
- R7–R10 actual query waits/state/cancellation/refusals — HELD. The independently
  decoded journal contains WAIT_HOST [2,0,0,0] then ready [1,4,2,0], measured native
  count6 divided by original triangle3. A final test-only count-based readiness
  supplement withholds only actual-ready measurements for16 reads after8 recorded
  false polls: checkpoint.mjs canPump return-false offsets11072–11085 execute8
  times, then fresh and NEW native queries each return6/logical2. Three physical
  rows pass (858 assertions), native parts/pending0, objects/syncs0, errors[]. The
  independent activation/disposal race originally leaked14 native objects twice;
  the frozen cancellation repair now rejects activation and releases them all.
  Actual context loss and concurrent capture mutation refuse without publication.
  Live MSAA is explicitly outside checkpoint support; three unchanged MSAA
  hardware schedules pass. Citations: abort-activation-finding.json,
  promoted-flush-all02, self05-query-journal-audit.json,
  query-wait-supplement01/authentication.json; coverage-and-verdict.json R7–R10.
- Exact custody/cold/coverage — HELD. Reopened all589 worker capsule members and
  authenticated all588 identities plus34 frozen source copies. Final pristine
  full-history --no-local clone at d38bec548bf0884067d639c7e13b1798b75d483c has no
  alternates, clean tracked source and all22 named commands passing, including13
  hardware rows (the intentional negative is expected exit1) and default127/0,
  zero errors, ordinary proof exports absent and193 pinned local served assets.
  Runtime de33c99f and native74a dependency remain unchanged. Earlier “23” counts
  were a log typo: that recorded target has22 commands; the recurring target now
  has23 after the new guard command. No evidence is relabelled or re-recorded.
  Test-only guard/query supplements carry the unchanged final cold; no duplicate
  clone/build/native run is warranted. Failed frozen01 expected-exit wrapper,
  self08 float-vs-word fixture, own race-handler and pre-supplement wait coverage
  remain preserved. Coverage ledger classifies every new module/hunk, generated
  mirrors and defensive numeric/error guards; no runtime behavior was edited by
  this verifier.
- SUITE: retain six independent modes, four original-queue guard modes, the
  epoch-removal negative, deterministic actual-query withholding, codec tests and
  recurring verify-E6-T11d74b. This verdict proves only physical renderer
  reconstruction.74c paired worker/CPU/RAM/disk/native restore and74d actual
  Omarchy GPU warm artifact/repeat/deployment are still required. It proves no
  default guest GPU warm boot, recovery, deployment or300MIPS result.

Commands: independent final authentication; the existing six-mode/negative
recordings; `python3 target/evidence/critic-production-renderer-checkpoint74b/final-guard-supplement01/run.py`
(four commands, all0); `node --check renderer/virgl-command/tests/production-checkpoint.mjs`;
`node tools/virgl-production/worker-checkpoint-browser.mjs --output target/evidence/critic-production-renderer-checkpoint74b/query-wait-supplement01/browser`
(three rows, all0). Policy/queue regenerated before this review-only commit;
`SKIP_WEB_BUILD=1` avoids rebuilding unchanged product bytes for tests/evidence.

Independent reopened seal:
`evidence/virgl-production-renderer-checkpoint/verifier/independent-renderer-reconstruction-review.tar.gz`
(28,182,270bytes; SHA256
`ae6a9d429d23e63e64d14332b0e04fa654a3bd3e7d759ab34ec91f7db1359339`;
849members /848 authenticated identities), paired JSON beside it. It includes
pre-data predictions, full independent observations and failed controls, original
source snapshots, worker/cold authentication, hunk ledger and both narrow final
supplements. The worker capsule remains separately pinned at SHA256
`69e04e2d872fd3915c1aaa978d67885dc5d8489565078811e13166c486cc210e`.
