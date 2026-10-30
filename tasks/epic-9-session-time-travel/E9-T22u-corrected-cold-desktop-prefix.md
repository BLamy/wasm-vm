---
id: E9-T22u
epic: 9
title: Measure the cold desktop after the session block-transfer correction
priority: 524.92202988
status: cancelled
depends_on: [E9-T22t]
estimate: S
risk: high
capstone: false
---

## User scope amendment — 2026-10-28

The user explicitly requested: “can we please just skip the cold boot and replay you have been working on that one ticket for days”.

The remaining corrected original-cold boot and its replay proof are waived. The partial recording is preserved and is not passing acceptance. Status `cancelled` records removed scope, not a successful
verification verdict. The original criteria and all prior failures remain below
for audit. Do not restart this long boot/replay campaign without a new user
request. Continue E9-T23 recovery and E9-T24 bounded user-flow integration;
functional seeking/replay tests remain required for those product behaviors.

## Goal

Record the original Omarchy cold boot again with the corrected session block
transfer boundary, then establish its first real nonblank frame or the next
exact failure frontier. The previous 21.7B checkpoint followed a guest disk
write error at 14.365B and cannot serve as a clean continuation source.

## Boundary

One fresh, bounded diagnostic prefix from transition zero in a new browser
profile, with the frozen image, kernel, bootargs, ICount/64 clock, 50M
checkpoint cadence, service files, physical renderer engine and workload
unchanged. The prior source graphs remain immutable. The host Chrome
auto-updated from the frozen v11 qualification's 155.0.8059.86 to
156.0.8078.49; pin that actual version for this diagnostic only and leave
the supported browser profile untouched. Extend diagnostic finite transition,
wall and capacity admission to cover the post-fix observation window.
Passive diagnostic observations and a build stamp generated from the actual
served package must bind that proof. Adjacent replay must reconstruct the
existing incremental checkpoint format through its authenticated full
ancestor, without relaxing frame, RAM, witness or renderer guards. This is
not the full E9-T22c qualification, a timing result, or an allowance for it.

## Acceptance criteria

- [ ] Preflight the new finite limit from measured 20B and 25.2B rates,
  16 GiB retention, browser quota and host space for a live profile plus an
  independent export, with explicit reserves. Reject insufficient capacity
  before launching the long run.
- [ ] Record the original cold guest from zero through a real nonblank frame
  or an exact bounded frontier. Show whether the formerly failing 1,179,648-
  byte virtio-blk write now completes successfully in the guest; preserve
  guest serial, disk, session, process and physical renderer evidence.
- [ ] Authenticate the exported graph and replay two adjacent checkpoint
  windows, including an incremental starting checkpoint, to exact witnesses
  without live replay egress. A fresh Daybreak
  verifier attacks the source pins, disk conclusion, frame classification,
  capacity and exact replay independently.

## Deterministic acceptance

`make verify-E9-T22u` on a clean exact head, with a unique `E9_OUT` directory.
The final high-risk submission uses `tools/verify/e9-corrected-cold-pristine.py`
to clone that head, stage explicit hash-receipted boot/calibration/cache
inputs and scrub build/log overrides before invoking this command. Compiled
outputs are rebuilt in that independent clone.

## Adversarial verification

Try the old 1 MiB transfer cap, a changed image or workload, omitted graph
chunks, a blank scanout misclassified as a frame, low quota, low disk, and a
replay that silently fetches base data. Refuse a recovered checkpoint whose
guest already observed the earlier disk failure. If the run ends without a
frame, cite the exact position and next concrete obstruction rather than
claiming a supported allowance.

## Verification log

### 2026-10-28 — worker — fresh Daybreak refuted a historical-state proof assumption

The original submission at code head `8e66d954bde8495ee5c151f6eac5b74502334473`
is a preserved failed proof attempt, not accepted evidence. A fresh actual
`gpt-daybreak-blue-latest` read-only session returned **VERDICT: refuted** for
the planned old-RAM comparison and fixed request window. The record-mode
constructor samples real `Date.now()` RTC and browser CSPRNG entropy; it does
not replay the old source tape. The current serial witness at transition
`10,750,000,000`, sequence `2011`, reports getty PID `192` and Oct 28, while
the historical E9-T22r witness reports PID `193` and Oct 26. Equal initial
state bytes before any source reads do not establish later RAM equality.
The old request's position `14,365,286,002` is not invariant under fresh
sources and prompt-gated bootstrap inputs.

The focused report is preserved at
`target/evidence/e9-t22u-8e66d954/daybreak-source-audit/report.md` in the
original cold-proof checkout, SHA-256
`7cbe73a735dcd55128914fd9848f83a9ced6b2feffd232c6f054f59a3e5f2dac`.
Its actual model/routing receipt is `routing.json`, SHA-256
`f47dd47c94a11e5bdd7d6b40e7b46fae2b23ee77bcad104ed5ff60162067da22`.
The immutable focused witness is `live-source-witness.json`, SHA-256
`14d4b8f43024ed246edbdce90e031a6786d743b1dd596e997f0b0734a35a3ddc`;
it retains current `browser.log` line 309 and the hash/pointer of the old
report's service-ordering output. The capture checkout and its served/replay
assets stayed frozen. The worker used the harness's existing graceful `STOP`
control to seal the partial history rather than spend another long run on a
refuted proof precondition. It stopped at transition `12,750,000,000`; its
terminal report has SHA-256
`7096603697deb24fa15a4711cbb05028d2f1e0d378dd0ed686d6916a7d7d6f5b`.
History opening then failed `InstalledIdentity` (the independent build-stamp
finding below). Its complete export retains 2,138 objects and 7,346 chunks,
6,095,441,402 payload bytes. The independent retained-closure command with
`--allow-incomplete` authenticated all 2,138 reachable objects; this does not
prove replay or acceptance. The report, graph, raw states, serial and trace
are preserved. These are proof-precondition findings, not a refutation of
the corrected guest block semantics.

The repair is isolated in the attached `e9-session-contract` worktree. It
keeps real fresh sources and observes the unchanged exact request identity
(type `1`, sector `24928880`, `1179648` bytes) from transition zero. A passing
observation must include `S_OK`, successful status DMA and used-ring commit,
its actual event position, retained hash-checked log parts, and a subsequent
guest/RAM witness. The historical RAM and position remain calibration
receipts only. The original workload, guest image, ICount/64, 50M cadence,
physical renderer code, frame/frontier criteria, replay and capacity gates
remain required. No implementation or final verification claim follows yet.

### 2026-10-28 — worker — diagnostic package and build identity repaired

Two bounded development runs exposed harness admission failures before the
next full cold attempt. `target/evidence/e9-t22u-source-aware-smoke-dev1`
rejected a diagnostic-glue/normal-snippet mixture before guest execution.
`e9-t22u-source-aware-smoke-dev2` retained transition zero through 550M,
906 block requests in 47 parts (224,444 bytes), but history opening correctly
rejected a normal GPU build stamp paired with diagnostic Wasm. No target
large write or adjacent replay was proven by these failed runs.

A fresh actual `gpt-daybreak-blue-latest` session returned **VERDICT: refuted**
for that installed-identity precondition, while carrying the repaired complete
diagnostic `/pkg/` routing as **HELD**. Its read-only report and actual-model
routing receipt are retained beside dev2 under `daybreak-identity-audit/`:
`report.md` SHA-256
`54a7477ac434cc033bb6bfb4679006fdbabcda5b6111ed6c5def6468de24b39e`,
`routing.json` SHA-256
`3723bf83ae0e294d9cb415ce1b93a0586d6e770f9820557995f20846b4eafee6`.

The generator now accepts explicit served-runtime and Wasm-package roots
and generates the private stamp from the actual diagnostic glue, Wasm and
snippets plus the served runtime closure. The server and sealed replay
allowlist use that same complete package and genuine stamp. Separate normal
and diagnostic byte pins are checked, the stamp is independently recomputed
before Chrome starts, and sealed static bytes are checked while recording.
The production history reader and worker identity guards remain unchanged.
Five deterministic identity tests cover both mixed-package directions,
hand relabeling, changed snippet bytes and missing dependencies; the 21 Node
tests cover finite capacity, request completion and static closure. These
worker checks pass, but do not substitute for the bounded replay smoke,
the final clean-head cold recording, or fresh final Daybreak verification.

### 2026-10-28 — worker — paged incremental-checkpoint admission repaired

Dev3 passed installed diagnostic identity and authenticated the complete
550M history (238 receipts, 12 witnesses). Its first adjacent replay,
`cold-8` → `cold-9`, matched the exact recorded digest. The next replay
failed because `cold-9.machine` is an authenticated `WVKEYF01` descriptor,
while the paged worker decoded it directly as `WVGPUB01`. The export's
independent `--allow-incomplete` closure authenticated all 169 objects.
This is a failed development run, never T22u acceptance.

Fresh actual Daybreak returned **FAIL — PRE-RUN READINESS ONLY** and
identified the direct decode at `web/session-gpu-replay-worker.js:46`.
Its report/routing are preserved under dev3's `daybreak-readiness/`:
report SHA-256
`36b63a15e11af4b40e66fdc0fe6fce78061128dd80f223e9391935a1008dc919`,
routing SHA-256
`e74aa71dd9a28ddf16723e132723f0494c5fe8a1407c66395e04db62c12ceb59`.
Source/clock/cadence/capacity and coherent installed diagnostic identity
were **HELD**; the target write and full pristine gate still need evidence.

The paged worker now uses the existing bounded delta-chain resolver,
authenticates the full ancestor and selected frame bindings, seeds the
ancestor RAM, applies ordered page chunks, and checks each reconstructed
RAM digest and dirty-page count before admitting replay. It retains the
selected native frame's exact witness and renderer bindings. No frame,
witness, renderer or installed-build guard is relaxed. The corrected-cold
observer and its auxiliary source copies now load only in T22u mode.
Explicit `--calibration-root` and `--base-cache` arguments expose external
inputs; `e9-corrected-cold-pristine.py` stages hash-receipted owned files
into an independent clean clone, scrubs build/log overrides, and runs the
prescribed complete gate there. Bounded dev4 replay and a fresh Daybreak
readiness review remain required before that full recording.

### 2026-10-28 — worker — bounded original-cold replay smoke passed

`node /private/tmp/e9-t22u-source-aware-smoke-v4.mjs` completed the real
transition-zero → 550M prefix, authenticated the history, and replayed both
adjacent `cold-8` → `cold-9` → `cold-10` windows. The second start is an
incremental descriptor. Exact guest/device/clock/queue/renderer comparisons
passed, with raw window states retained, zero replay fetches/sockets and no
console errors. The run logged 908 requests in 45 hash-checked parts,
224,880 bytes, with no guest block failure. The target write is absent at
this early frontier, so the underlying browser report correctly refuses
full T22u acceptance at that final criterion. No large-write completion or
post-completion witness is claimed.

Evidence is `target/evidence/e9-t22u-source-aware-smoke-dev4` in the repair
worktree. `smoke.json` explicitly records `fullAcceptance: false`, SHA-256
`bcbebbfedaf3df53fe3c5968ce4385efb77a091427e8e15e750e8292a41950f7`;
`desktop/report.json` SHA-256
`b47476074eaec26e2ebba113018c78076eb43da43d1b0a802025d245e1be2cb4`.
This is a dirty-tree worker smoke, not exact-head final evidence.

The next readiness collector accidentally accepted a nested review's
completion before root Daybreak finished. Its unmodified partial output
and `review-incomplete.json` are retained under dev4's
`daybreak-partial-readiness-v4/`; it is excluded as a root verdict. The
collector now waits for the exact root thread/turn and uses one Daybreak
reviewer. Concrete wrapper findings from that partial review are repaired:
the runner checks effective Cargo artifact paths/compiler wrappers, rejects
pre-existing clone artifacts and overlapping/noncanonical input roots,
enforces copied-file containment, and supervises sleep prevention with
fail-closed owned-process cleanup. These wrapper-only changes occurred
after dev4's source copy; they need the final pristine gate, not another
unchanged guest replay. Fresh root Daybreak readiness remains pending.

### 2026-10-28 — worker — fresh root Daybreak cleared final-run readiness

Actual `gpt-daybreak-blue-latest`, fresh root thread
`01a183c5-cb04-7942-894f-8f9e21e8ca16`, returned **ROOT PASS — PRE-RUN
READINESS ONLY**. The collector matched that exact root thread/turn and
disallowed nested reviewers. Report and routing are preserved under dev4's
`daybreak-readiness-v5/`: `report.md` SHA-256
`ee66f77f6aa69d0d899e5f8c6693a7933e3ba99b3ebdbe8e677ce00561d33b95`;
`routing.json` SHA-256
`75ad0b086b9a9ad2a267a2e532a2d7e83111ab91f2dfda47015d27d4d719214e`.

The fresh reviewer independently authenticated all 321 exported chunks and
168 objects, inspected the full → depth-1 → depth-2 checkpoint chain,
matched both raw adjacent replay states, and held the original source,
clock, cadence, capacity, identities and zero-egress boundaries. All 57
sealed runtime/package assets remain byte-identical to dev4. The wrapper's
post-smoke fixes passed source/effective-Cargo checks. The reviewer explicitly
left successful large-write/post-completion proof, actual clean-head pristine
execution, the complete gate and fresh final acceptance as **NEEDS EVIDENCE**.
No further repair was required before that run. Task status stays
`in-progress`; readiness is not task verification.

The intended source checkout itself borrows Git objects through an
alternate, so the pristine clone also uses `--dissociate`. A real bounded
Git fixture cloned a shared-object source with the exact flags, moved both
upstream stores away, and passed independent `fsck`/`show` checks. Its
receipt SHA-256 is
`650dfad334509f0bec21866c1e9a01f47742619682a12f5cba9ddb26523f6f1c`.
Fresh actual root Daybreak v6 returned **ROOT PASS — PRE-RUN READINESS
ONLY**, carried all unchanged v5 results forward, and rechecked that fixture
and actual source topology. Dev4's `daybreak-readiness-v6/report.md` has
SHA-256 `6cccec9c2eebe3d7fd6c9f581ab55636740419a232ef77a4c8c2307649cf093c`;
its routing receipt is
`6824db75bd4c34725c3f99298d4666143915c9dfdbafb0894c99caef28441c0a`.
The actual full independent-clone gate remains outstanding.

### 2026-10-28 — worker — user waived the remaining long cold proof

The user explicitly requested skipping this cold boot and replay. The worker
used the existing graceful STOP control, which sealed the original cold source
at transition `950000000`, retired `949941396`, sequence `861`, with 19
checkpoints. Its automatic adjacent replay was then interrupted by SIGTERM to
the owned make process group `60352`, to honor the replay cancellation too.
Unified session `37407` exited 1; the controller records status `failed` and
the actual signal exit. No target-write completion, first frame, complete
replay or passing task acceptance is claimed.

All source/proof inputs remain frozen at
`f6efcba3bf318d1eab696f8fd38711aa3a5f91f1` in the independent clone.
The live profile, request parts, logs and raw states are preserved beneath
`target/evidence/e9-t22u-resume-f6efcba3bf31-v1`. Final raw state is
19,699,223 bytes, SHA-256
`913604eb9109810bac03a29059ea21647ad2d13aac3819ac9c1082f6dc6c11a9`.
No process belonging to this run remained after cancellation. Portable copies
of the two operator-stop receipts, failed controller receipt and a file/hash
inventory are committed under `evidence/e9-t22u-user-waiver-20261028/`.
No historical failure was relabelled and no evidence file was deleted.

The task and dependent original-cold profile/combined qualification/performance
campaign are cancelled as a user scope amendment. T23 recovery and T24 bounded
user-flow integration proceed without those prerequisites. Product functional
replay checks and fresh actual Daybreak verification remain required; no
full Omarchy or numeric performance claim follows.

### 2026-10-28 — actual Daybreak — waiver/cancellation metadata PASS

Fresh actual `gpt-daybreak-blue-latest`, root thread
`01a1840a-8742-7163-b7a4-2f4ecf21a24e`, returned **PASS — waiver/cancellation
metadata only**. It independently matched all three copied stop/controller
receipts and the final-state bytes/hash, checked no new verified status,
verified T23 prerequisites and the bounded T24 scope, and retained every
full-cold/performance claim as unproven. Its read-only process-table access
was denied, so it did not independently assert process absence. This is no
runtime or task acceptance verdict. Report/routing are committed under
`evidence/e9-t22u-user-waiver-20261028/daybreak-review/`; SHA-256 hashes:
report `1ac8c199364311059569bf56b5160f01f10964a25aba8105cdd65b71a65ccb3a`,
routing `7c0cc987260cf5a45098e8a00df24a5f5b7630aea91e311304e3fcba5a8b979e`.
