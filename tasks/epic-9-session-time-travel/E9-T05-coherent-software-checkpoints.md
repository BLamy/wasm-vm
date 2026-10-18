---
id: E9-T05
epic: 9
title: Capture and restore coherent software session checkpoints
priority: 524.905
status: verified
depends_on: [E9-T03, E9-T04]
estimate: S
risk: high
capstone: false
---

## Goal

Save a usable single-hart software-rendered machine at a session position and restore it after reload.

## Boundary

Coordinate CPU/RAM/device state, clock policy, input queues, log cursor and historical disk root at one bounded quiescence point. Accelerated guests remain explicitly gated until T17/T18.

## Acceptance criteria

- [x] Record and restore exact CPU/device/disk witnesses from the same boundary, including pending I/O and held keyboard state.
- [x] A failed capture or rejected restore leaves the previous committed checkpoint and current machine usable; never publish half a tuple.
- [x] Use real native and built-browser fixtures; restore guest-visible memory and files rather than accepting a screenshot as state proof.

## Deterministic acceptance

`make verify-E9-T05`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Capture during disk I/O and input transitions, force quiesce timeout and corrupt one component. Demand all-or-nothing admission and an independently checked post-restore guest witness.

## Verification log

### 2026-10-17 — worker — implemented

Runtime/source freeze: `354f0a6036221bd2b858558dc04f125f22a3323b` (runtime implementation
`4169888c`, subsequent commits correct only the evidence exporter and RPC delimiter assertion).
Command: `E9_CHECKPOINT_EVIDENCE_DIR=target/evidence/e9-t05-worker-final make verify-E9-T05`.
All **20 recorded gates passed**, including 399 core tests, resume/held-input/audio/GPU/blk
regressions, native frame/storage tests, native/wasm Clippy, browser build, shared Node/Wasm
metadata tests, protocol v4 and retained factory v2 checks.

Evidence: `target/evidence/e9-t05-worker-final/report.json`, SHA-256
`d06225f249d7c1ce6b5d3b3826d92e7cdd713649a9fe3c7ea2367ea3f5e5ef92`.
It authenticates **540 files** and exact source digests. The permanent compact packet is
`evidence/e9-t05/worker/`; its provenance maps every copy and compressed tuple to originals.
The full browser trace/profile, raw native/tuple files and reconstructed ext4 images remain
in the original evidence directory.

The recorded real Alpine guest changes a shell variable and `/root/e9-session/state`, saves
while a key is held and a UART command is queued, advances the live guest, then reloads by
committed checkpoint ID. The before/restored **23,834,211-byte tuple is identical**, SHA-256
`2fe4d221e3df99938a25afb60f047051e8f01d2d2ee27a5f8a5d7a24236cad3a`.
The independent Python oracle decodes all **16 CPU/RAM/device sections**, reconstructs sparse
RAM and ext4, and finds the saved `e9:before\n` file; the advanced state contains `e9:after\n`.
Restored execution prints `memory-before/queued-before`, proving guest memory and delivery
of the recorded pending UART command. Corrupt components and a same-generation sibling disk
are rejected without changing the native destination. Failed publication leaves revision 1
byte-identical and the live guest continues with its advanced memory values.

Actual original disk reads/writes drain without advancing CPU time. Sixteen failed quiescence
passes terminate with `session_checkpoint_busy_or_budget`; after genuine chunk bytes become
available, the same guest captures successfully and retires 49,997 instructions. Direct-control
mutations are fenced during capture, and stop joins the capture lifecycle. The built demo
passes **127/0**, with **zero console errors**, the new roadmap pip and screenshots. The
unchanged retained accelerated factory also boots: qualified, fresh epoch 4 physically drawn,
**3,999,540 retired instructions**. Accelerated session history remains gated for T17/T18.

This initial checkpoint profile is offline software/ICount, at most 256 MiB RAM, without extra
disks, microphones, host audio bridges or active PCM streams. Its event cursor is honestly zero
in checkpoints-only mode; event replay/UI/retention/runtime bundles remain their successor tasks.
Fresh adversarial verification, its promoted tests, the one final pristine clone and live
Cloudflare publication are pending; this entry makes no verifier or public-deployment claim.

### 2026-10-17 — fresh verifier — VERDICT: refuted

- **P6a coherent publication — FAILED.** Predicted that a disk-leaf producer-buffer ABA
  either refuses atomically or publishes the original coherent frame/root tuple. In two
  independent built-Wasm schedules, mutating a COW leaf after `openSession` and restoring
  the original frame immediately before its final object `put` successfully commits
  revision **1→2**, yet admission rejects `Checkpoint: historical disk mismatch`.
  Schedule 0 restores frame hash
  `fdcac301127ea9d1798a4de52db19e1fcc08054a3dabb32244fc1a2d912d5858`, but its frame/root
  leaf bytes are **67/99**; schedule 1 is **68/101**. `web/session-checkpoints.js:75`
  pins a hash over aliased bytes, `:83` yields, `:95` derives a later root from those
  aliases, and `:108` checks the restored original bytes. Demand: own or equivalently
  authenticate one immutable complete tuple before the first await, then re-record the
  selected high-risk gates. Reproducer/results: `evidence/e9-t05/verifier/aba-browser.json`
  (both schedules, exact component/root hashes), with trace
  `target/evidence/e9-t05-aba-critic-trace.zip`, SHA-256
  `43be7fa960e03858567f029e709caa2fe6b496f3b6a7e50c8661a4398455ee85`.
- **P0–P5 / unrelated P6 / P7 checks — HELD.** The original report digest, all **540**
  original files, **51** compact copies/gzip aliases and **39** source hashes authenticate.
  Independent raw decoding finds all 16 sections and identical before/restored tuples.
  Independent COW reconstruction and read-only e2fsprogs recover exact before/restored
  `e9:before\n` and advanced `e9:after\n` files. The authenticated guest memory/UART
  witness, held input, original read/write drain, 16-pass timeout/recovery, corrupt
  components, same-generation disk rejection, owner fences, 127/0 demo and unchanged
  retained GPU compatibility all hold. New native tests pass **65** all-component
  admission refusals and **32** mixed delivered/pending/staged-input continuation schedules.
  Fresh built-Wasm rehashed corruption of each of 16 components, ordinary mutation and
  detachment refusal, configuration pinning, successful append and competing append
  ownership also hold. These findings carry forward when their runtime/dependency
  boundaries and evidence digests remain unchanged.
- **P9 sabotage — HELD.** In an isolated deliberately incomplete crate copy, routing
  exact capture through the legacy physical-input codec makes the new pre-capture
  ledger oracle fail (exit **101**). The production source remains byte-identical.
  Details: `evidence/e9-t05/verifier/sabotage.json` and `sabotage.log`.
- **SUITE / remaining proof.** Promoted native and built-browser attacks are wired into
  `make verify-E9-T05`, including the two ABA schedules. They permit either an atomic
  refusal or publication/admission of the coherent original snapshot; ordinary producer
  mutation/detachment also permits that valid immutable-snapshot behavior. The full
  coverage verdict, final pristine-clone proof and public deployment proof remain
  pending. No cold clone or deployment was run during this audit.

Predictions were written before evidence in `evidence/e9-t05/verifier/predictions.md`;
authentication and independent filesystem receipts are `worker-interrogation.json` and
`files-interrogation.json`. Native test/lint/format commands and results are in
`native-gates.json`; browser results are in `browser-critic.json`. This verdict changes
tests, evidence and task metadata only; the worker must repair the runtime boundary.

### 2026-10-18 — worker — immutable tuple repair and recorded resubmission

Frozen repair source `4ce36a932feaf171c09cd8b25e90d3fc9ff376ac` bounds and copies the complete caller-owned
frame synchronously before hashing, decoding or awaiting storage. Disk leaves and
the final machine object now read the same owned bytes even when the producer
mutates, detaches or reuses its original view. Runtime identity is
`c404e41c43d7912f5ae2886848724d018b515cc5d1a668a15105ba3f54b232bc`;
the retained GPU factory bytes are unchanged.

`E9_CHECKPOINT_EVIDENCE_DIR=target/evidence/e9-t05-worker-repaired make verify-E9-T05`
passed all **20** selected high-risk gates, now including the promoted native
65-component admission attacks, 32 input-continuation schedules and built-browser
producer-buffer attacks. Both originally refuted ABA schedules commit revision 2
with matching frame/root disk hashes and successful admission; original leaf bytes
remain 67/67 and 68/68. Ordinary mutation/detachment publishes the coherent original
snapshot, configuration is pinned, and concurrent appends retain one winner.

The actual guest before/restored **23,841,728-byte** frame is identical, SHA-256
`f558b633c4605c93b5a1770f219f6759dd1cb147f8879e271b3afe446f50b047`.
The independent oracle rechecks all 16 native sections, saved RAM/UART and actual
ext4 before/restored/advanced file bytes. Original I/O, bounded timeout/recovery,
atomic refusal/publication and owner fencing all pass again. Built demo **127/0**,
zero main-page console errors, verified pip and screenshots; retained GPU factory
physically draws in fresh epoch 4 after **3,499,616** retired instructions.

Original report `target/evidence/e9-t05-worker-repaired/report.json` has SHA-256 `f503e646a19c05ed7a1c33ecd64cae767eaedc33cf06f8acfd01021a2d1aed37` and authenticates
all raw captures, browser trace/profile, reconstructed images and **42** source
digests. Permanent compact packet: `evidence/e9-t05/worker-repaired/`, including
provenance and compressed full tuples. Original refutation/evidence remain intact.
The narrow precheck is separately retained in `target/evidence/e9-t05fix-pre/`.
Fresh incremental interrogation, the one final pristine clone, and public
Cloudflare proof remain pending; this is a worker claim.

### 2026-10-18 — fresh verifier — pre-cold audit — VERDICT: needs-evidence

- **R0–R4 / repaired P6a — HELD.** Independently authenticated the repaired receipt
  `f503e646a19c05ed7a1c33ecd64cae767eaedc33cf06f8acfd01021a2d1aed37`, its **542**
  listed payloads plus the receipt (**543** originals), **51** compact copies/aliases
  and **42** frozen source hashes. Both original ABA schedules now publish and admit
  the original coherent snapshot: exact frame/root disk hashes and leaf bytes
  **67/67** and **68/68**. The source owns the bounded frame before hashes, parsing
  or awaits. Ordinary producer mutation/detachment preserves the coherent original;
  configuration remains pinned and concurrent appends retain one winner. Fresh
  supplementary browser repetitions agree. Original refutation/evidence stay intact.
- **Coherent guest / filesystem / regressions — HELD.** Independently decoded all
  16 sections and sparse RAM of repaired raw tuples, matched before/restored frame
  SHA-256 `f558b633c4605c93b5a1770f219f6759dd1cb147f8879e271b3afe446f50b047`,
  reconstructed all three COW images, and read exact before/restored `e9:before\n`
  and advanced `e9:after\n` through read-only e2fsprogs mounts. Guest memory/UART,
  held key, original I/O drain, bounded timeout/recovery, all-component refusal,
  owner fences, 127/0 zero-error demo and retained GPU compatibility remain HELD.
  The unchanged native 65 admission attacks, 32 continuation schedules and isolated
  sabotage result carry forward under the incremental policy.
- **COVERAGE / SUITE — HELD; tests frozen.** Inventoried **94** source/production
  hunks across **22** files; recorded V8 counts exercise every changed JavaScript
  hunk. Native codec/integration routes and narrow declaration/configuration/error
  waivers are documented in `evidence/e9-t05/verifier/audit.md` and
  `hunk-inventory.json`. Added only bounded direct-loader checks: valid exact restore
  while paused with zero retired instructions, descriptor/profile refusal, and a
  supported-but-false UART IRQ that reaches actual-topology rejection and frees only
  the private candidate. The original source stays byte-identical and usable. These
  promoted checks pass with zero browser errors and are included in the existing
  acceptance helper. The first supplementary wall fixture incorrectly kept an ICount
  divider, and an unknown topology kind correctly rejected at the schema; those
  harness results are preserved, and the corrected valid-range fixtures pass.
- **R5 — NEEDS EVIDENCE.** Run the **one** final pristine source proof at this final
  promoted-test head with scrubbed Rust/Cargo environment, then interrogate its exact
  receipt and perform the declared Cloudflare/public proof. No cold clone or deployment
  was run during this audit. This pending proof is not a semantic refutation.

Details, exact commands and authenticated receipts are in
`evidence/e9-t05/verifier/repair-predictions.md`, `worker-repaired-interrogation.json`,
`files-repaired-interrogation.json`, `repair-browser-critic.json`,
`repair-aba-browser.json`, `coverage-blocks.json` and `repair-final-receipt.json`.
The only source change after the worker recording is the bounded promoted browser
test helper; native/runtime/dependencies are unchanged. This commit freezes tests and
changes verification evidence/status only otherwise. All unchanged HELD findings carry
forward into the final cold/public audit.

### 2026-10-18 — worker — one final pristine-source proof

The single final clean-checkout proof at frozen promoted-test head
`7ac83e660cc316440a9e42cf961224f0c24a314a` passed all **20** gates. Command:
`python3 -u target/e9-t05-cold-wrapper.py` (exact wrapper retained in the packet),
which creates `/Users/blamy/.codex/worktrees/e9-session-contract/wasm-vm/target/e9-t05-cold-9sn4z7cr/repo`, detaches the exact commit,
unsets Rust logging/flag and Cargo/Git environment overrides, and runs
`make verify-E9-T05` with a fresh target and node_modules. Ordinary locked
package-download caches/toolchains remain available; no Git alternates or inherited
source/build output is used. The clean cone includes all source/configuration/release
directories and required historical compile-time fixtures; unrelated historical binary
evidence is read from immutable Git blobs by Docstream.

Original receipt: `target/evidence/e9-t05-cold-final/receipt.json`, SHA-256
`6d4f5d414489eff824e17da6a74b1a0dd03b9ac66525d542be4fb50592d7316d`. Acceptance:
`target/evidence/e9-t05-cold-final/acceptance/report.json`, SHA-256
`0241e2c0d9704ec478594e61e324dfa2f3df845b20ff8c267b721e9173d106f2`.
The packet `evidence/e9-t05/cold/` retains all gate logs, reports, compressed
full tuples, filesystem witnesses, screenshots, wrapper and original-file provenance.
The original full trace/profile/images remain outside the checkout in that evidence
directory; the checkout remains available for the verifier.

The clean build reproduces runtime
`c404e41c43d7912f5ae2886848724d018b515cc5d1a668a15105ba3f54b232bc`
and the committed Wasm bytes exactly. Actual before/restored frames match, guest
memory/pending UART/held input and ext4 files pass, original I/O and all permanent
refusal/producer-buffer/loader checks pass. Built browser **127/0**, zero errors;
the retained GPU factory physically draws after **2,499,808** retired instructions.

The original worktree's publication preparation changes task catalog/service-worker
metadata only, after the isolated source freeze. Runtime, tests and dependencies
remain frozen. Independent receipt interrogation and Cloudflare/public proof remain
pending; status stays `evidence-needed`.


### 2026-10-18 — worker — public deployment and sealed recording

Published the committed deployable build at `3508ad16ca0de135f06e6f7cc8d2fb4b3a879332`
with `bash tools/deploy-cloudflare.sh`: deployment
<https://6545bb6f.wasm-vm.pages.dev>, production <https://wasm-vm.pages.dev/>.
The deployment-only rewrites of the five artifact URL manifests were restored to their
committed bytes before recording; the source tree was clean before and after the run.
Runtime remains `c404e41c43d7912f5ae2886848724d018b515cc5d1a668a15105ba3f54b232bc`.

Command: `node tools/verify/e9-software-checkpoints-browser.mjs --url https://wasm-vm.pages.dev/ --output target/evidence/e9-t05-public-final`.
The recording passed from 04:42:52 to 04:51:30 UTC. All **16** checked production assets
match the frozen deployable bytes. The actual guest checkpoint reload preserves the
complete frame byte for byte, RAM, queued UART and held input; the guest file and
independent ext4 witnesses agree. Original-I/O, publication-failure, direct-loader and
both repaired producer-buffer schedules pass. The demo reports **127 passed, 0 failed**,
zero console errors and the checkpoint roadmap pip is verified. The retained factory
GPU is qualified, neither lost nor poisoned, and physically draws in its fresh epoch
after **2,499,808** retired guest instructions.

Original report: `target/evidence/e9-t05-public-final/report.json`, SHA-256
`6b31a2af91a67ab9f6eac8bec336bc96d9e543fb18ffbddbb18b2be83cf03217`.
`evidence/e9-t05/public/` contains **34** compact files plus provenance authenticating
**781** original files, including the retained full browser trace/profile, raw tuples
and ext4 images outside Git. The packet records the exact command, deployment log,
source hashes, screenshots and lossless tuple aliases. Status remains `evidence-needed`
until the fresh reviewer interrogates the cold and public receipts and records a verdict.


### 2026-10-18 — fresh final receipt verifier — VERDICT: verified

- **F0–F4 provenance/source/isolation — HELD.** Authenticated the prior fresh verifier's
  44 files, four external proofs and frozen test hashes; carry its unchanged correctness,
  94-hunk coverage, regression, bounded novel-check and sabotage results forward. The one
  final pristine run is at promoted-test head `7ac83e660cc316440a9e42cf961224f0c24a314a`:
  20 commands match the frozen harness and exit zero. All 42 source hashes agree with
  frozen Git blobs, the clean retained checkout and current/public sources. All 541
  acceptance originals, 542 outer-listed payloads, 51 compact copies, restored alias
  and three outer copies authenticate. Exact cold receipt/acceptance hashes remain
  `6d4f5d414489eff824e17da6a74b1a0dd03b9ac66525d542be4fb50592d7316d` /
  `0241e2c0d9704ec478594e61e324dfa2f3df845b20ff8c267b721e9173d106f2`.
  Independent hashing reproduces the runtime and Wasm identities above. Environment
  scrub, no inherited build outputs/alternates, exact detached head and final clean
  checkout hold. The two logged register panics are passing should-panic cases.
- **F5–F6 recorded checkpoint state and regressions — HELD.** Independently decoded
  five components, all 16 native sections and sparse-RAM digests from cold/public raw
  tuples. Cold before/restored: **23,815,994 bytes**, SHA-256
  `0995665f26a010e24a725433ae23d83de5317346fbd187c9a9467c0b77b558d3`;
  public: **23,837,160 bytes**, SHA-256
  `95ec5bad55a328fa55bf97e8543e84089d955450db4616d496a00cbd52807e4b`.
  Each is byte-identical across reload, paused with zero instructions, pending UART
  and held key [30], actual saved-memory continuation and exact saved/restored/advanced
  file bytes. Recorded I/O, bounded timeout/recovery, component refusal, direct-loader,
  source preservation and both coherent ABA schedules hold. Both demos show **127/0**,
  errors [], verified pip; retained GPU physically draws in fresh epoch 4 after
  **2,499,808** retired instructions.
- **F7 public proof — HELD.** Report
  `6b31a2af91a67ab9f6eac8bec336bc96d9e543fb18ffbddbb18b2be83cf03217`
  and sealed provenance
  `013d218a591da579c65e78611069d7072ec736a445c6fecf7b6deb58014e669a`
  authenticate **781** originals, **34** compact files and a restored alias. All 16
  recorded public assets and 16 fresh read-only HTTP checks match frozen dist bytes.
  Deployment `https://6545bb6f.wasm-vm.pages.dev`, production `https://wasm-vm.pages.dev/`.
- **SUITE / no remaining gap.** Preserve the already-frozen promoted native/browser
  tests and make target; no new scenario or program test was executed in this receipt
  review, and no runtime or test code changed. The pristine checkout may be cleaned up;
  keep original full evidence. No merge is performed by this verdict.

Predictions were written before receipt inspection. Exact commands, source boundaries,
report line citations, full authentication counts, raw frame/RAM/file hashes, trace and
screenshot digests are in `evidence/e9-t05/verifier-final/audit.md`, its four observation
JSON files and `receipt.json`. This final audit changes verification/task metadata only.
