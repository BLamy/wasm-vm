---
id: E9-T12
epic: 9
title: Record asynchronous device payloads and completion order
priority: 524.912
status: verified
depends_on: [E9-T09]
estimate: S
risk: high
capstone: false
---

## Goal

Prevent host scheduling of I/O from changing the recorded guest execution.

## Boundary

Record external completion delivery and any guest-visible bytes/DMA writes for supported block, console/file-agent and audio-input adapters. GPU results are reserved for T18, and unrecorded adapters must refuse recording.

## Acceptance criteria

- [x] Separate immutable base-disk payload references from nondeterministic completion delivery; identify each request and record exactly one accepted completion.
- [x] Replay payload bytes, completion sequence and interrupt effects under deliberately different host callback schedules.
- [x] Include pending adapter state and event cursors in checkpoints; cancellations and stale-generation replies cannot mutate a restored guest.

## Qualified adapter contract

The core adapters are installed with Machine::enable_session_devices and the ordinary
bare-metal browser machine's installDeviceSession API before execution. The block
adapter uses a frozen immutable manifest and sector-aligned local COW state. Existing
unrecorded block/audio/console transports are rejected at installation; persistent host
writeback, live worklet playback, GPU results and the existing Linux provider assembly
are not implicitly admitted. T14 composes executable Linux replay after T13 supplies
the network boundary. The demo retains an explicitly incomplete capture prefix.

Each missing immutable base chunk, posted named-agent receive buffer and due capture
quantum creates a non-wrapping request ID. A private allocation identity revokes callback
leases on restore even when saved request IDs rewind. An accepted owned completion is
a common before-transition event (channel 19), with request intent and result distinct
from its guest position. The durable journal puts base payload bytes in their own
content-addressed object; delivery metadata references those bytes without incorporating
callback timing into the immutable identity. Replay accepts recorded envelopes at exact
positions and refuses live leases.

The frozen v1 profile bounds individual payloads to 1 MiB minus 256 bytes, pending
requests to 256, immutable cache bytes to 16 MiB and local COW sectors to 256 MiB.
Eviction follows accepted completion order and preserves chunks pinned by pending reads.
Capture uses guest ICount time and S16 mono/stereo at 48 kHz; unavailable or short
quantums retain their real status/XRUN behavior. An awaiting owned capture result leaves
DMA, status and the used ring untouched. Active playback refuses this profile.

Native section 20 preserves pending requests, complete cache/COW state, request/event
cursors, capture result state and parked block descriptors. The qualified sound codec
preserves capture descriptors and deadlines; ordinary legacy audio snapshots keep their
existing host-ring repair policy. Restore validates the whole envelope before mutation
and replaces the callback incarnation only after a successful commit.

## Deterministic acceptance

`make verify-E9-T12`. This target records the qualified adapter assertions and high-risk native, Wasm, built-browser, independent guest/object-oracle and retained GPU regression gates. Set E9_DEVICE_EVIDENCE_DIR to a new absolute recording directory.

## Adversarial verification

Reorder and delay host callbacks, cancel an in-flight request at a checkpoint and inject an old completion after restore. Compare guest memory and queue/interrupt witnesses.

## Verification log

### 2026-10-18 — worker — begin

E9-T12 is the top eligible queue task after independently verified and published
E9-T11. Risk is high: completion ordering, guest DMA/interrupts and persisted pending
requests cross architectural and asynchronous state boundaries. The slice will bind
accepted completions to exact guest positions and request identities, keep immutable
base payload references separate, and restore pending state/cursors while revoking
stale callback generations. Supported block, console/file-agent and audio-input
adapters must record their actual results; unsupported adapters remain gated. GPU
results stay in T18. The final command will exercise delayed/reordered callbacks,
cancellation and restore with guest memory/ring/IRQ witnesses. No implementation
or verification claim is made by this activation entry.

### 2026-10-18 — worker — respond to fresh checkpoint refutation

The fresh critic reproduced an accepted malformed checkpoint at runtime 76b56b01:
erasing capture_pending while retaining capture request 4 revoked live leases and
issued duplicate request 5 at the next transition. Its independently rechecked point
is /Volumes/e9-t11-cold-scratch/e9-t12-verifier/recheck.log:6–8, mutant SHA-256
bb64f5b8a82261207e0cae4a36acfebce483c9a357f64f14ec5d627f1064473b.
The task remains in-progress. The initial cold/browser recordings and successful
publication 48988385 remain historical evidence; no verified claim is made for them.

The worker repair validates reciprocal ownership between the broker pending map,
capture owner/result and actual due sound descriptor before any restore commit or
lease revocation. A missing owner cannot leave a pending capture behind, and removing
both owner and request cannot erase the obligation of a real due descriptor. Future
and stopped capture descriptors retain their proper scheduling behavior. The original
regression fails before the fix; all eight then-existing adapter tests and the new
future-descriptor round trip pass afterward. Exact red/green logs and raw frames are
retained losslessly in evidence/e9-t12/repair-precheck/receipt.json. These are worker
prechecks. The frozen repaired head must earn a new high-risk submission and fresh
critic verdict before this task can become verified.

### 2026-10-18 — worker — restore initialization and inactive capture canonicality

The fresh critic independently reproduced two further edge failures. With capture
disabled, a real translated six-instruction loop stopped at transition 5001 saved
different unused broker clock values under different execution budgets. Its repeated
raw browser packets are actual-jit-edge and actual-jit-edge-recheck beneath
/Volumes/e9-t11-cold-scratch/e9-t12-verifier; jit-edge-audit.json identifies section 20
as the sole difference. Separately, every capture-enabled initial profile saved a
transition-zero frame that restore rejected: broker epoch 0 disagreed with the
installed sound stream epoch 1. The critic's eight-profile packet is recorded-initial
in that same directory. Both findings are accepted; no earlier passing runtime proof
is substituted for a new submission.

The worker added independent regressions, observed both fail before the repair, then
initialized the broker from the actual installed capture epoch and canonicalized the
unused capture clock to zero. Disabled capture profiles reject nonzero persisted clock
or epoch before mutation. The native Wasmtime regression executes real translated
six-instruction blocks, compares complete device/CPU/RAM checkpoints at transitions
5000, 5001 and 5002 under budgets 31, 1, 8 and 4096, and checks actual block/agent DMA
queue completion and cursor values. All eight optional adapter profiles roundtrip
before their first guest instruction. Red logs and frames are retained on the task RAM
volume for inclusion in the final evidence packet. This remains worker implementation,
not a verifier verdict.

### 2026-10-18 — worker — implemented claim, frozen repaired submission

Frozen source and deployable bundle: 98260ff67d814311b3c2cf175a57476f3d3c64ab.
The task diff starts after independently verified E9-T11,
8e57ceada7752057de307027bf2d371c14ca0f78. The orphaned capture, initial epoch
and inactive-clock refutations above are repaired; earlier failed recordings remain
preserved. No superseded runtime passing result substitutes for this submission.

Command: python3 /Volumes/e9-t11-cold-scratch/e9-t12-final-frozen-cold-wrapper.py.
It creates a clean exact-head independent Git checkout and initially empty compiler
target, scrubs CARGO_*/GIT_* flags and Rust flags/wrappers/logging, then runs make
verify-E9-T12. Source, refs/index, compiler output, fresh Node installation and
temporary files reside on task RAM because the persistent disk refuses new writes.
Immutable Git objects are shared read-only through disclosed alternates; the wrapper
receipt names the exact parent store and empty target. Official GNU Bash 5.2.37
and a byte-authenticated pinned emsdk 4.0.22 copy keep build temporaries on RAM;
receipts are retained. No compiler or node_modules from an earlier proof is reused.

All 24 recorded commands passed: policy, format, fixture reproduction, native clippy,
core/device/session/JIT/Wasm/storage tests, no-std Wasm build, Wasm clippy, reproducible
browser build, JavaScript syntax, documentation/contract audits, independent native
and browser guest/object oracles, retained GPU integrity and actual factory boot.
The core library passes 400 tests. All 11 final adapter regressions and 32 varied
callback schedules pass. Real Wasmtime six-instruction blocks execute at checkpoint
edges 5000/5001/5002 under budgets 31/1/8/4096. Both built and production browser
suites report 127 passed, 0 failed and zero errors; live device/roadmap pips, mobile
capture and reload pass. The unchanged retained GPU factory retires 2,999,712 guest
instructions and presents fresh resource 13 at epoch 4 without loss/poisoning.

Cold primary evidence: evidence/e9-t12/worker-repaired-final/provenance.json,
SHA256 1c61ebeb7ae04b692b452ebe9ab50f58efdf659614fc10988594d71887b2ccf3.
It losslessly retains 156 primary files: full guest frames/traces, logs, durable CAS
objects, screenshots, Playwright recordings, source hashes, exact commands and cold
wrapper provenance. Acceptance report SHA256
fbd9e07628abb1ac2f1b4628e1c6b8071e527452441472d4dae74c709d9abde4.
All 332 raw files and the authenticated complete gzip archive remain at
/Volumes/e9-final-proof-ram/cold-proof-e9-t12-98260ff67d81 and
/Volumes/e9-final-proof-ram/e9-t12-final-full-archive. The 176 derived GPU-regression
Chromium profile/cache files are explicitly inventoried there; exported proof is the
evidence of record. The fresh critic confirmed the owned object graph is complete.

Stock Cloudflare deployment completed at https://c5aa196d.wasm-vm.pages.dev,
production https://wasm-vm.pages.dev/. It validated local manifest-bound images,
all seven immutable public R2 objects and the 25 MiB Pages limit. The complete public
512 MiB rootfs was reconstructed from recorded strict HTTP206 ranges and its SHA256
reauthenticated for the deployment read; other public objects were freshly checked
by stock curl. Missing ignored large boot images in the isolated checkout were copied
only after declared size/SHA validation. The initial missing-file failure remains
preserved separately. Exact publication logs, payload inventory, range/local-image
receipts and producers: evidence/e9-t12/production-repaired/deployment/.
Public browser evidence: evidence/e9-t12/production-repaired/provenance.json,
SHA256 694c80594da2b419748998edd17c54bf3e938dc4c1c2af82d4c003c4b7dec3a1.
Command: node tools/verify/e9-device-completions-browser.mjs --url
https://wasm-vm.pages.dev/ --output
/Volumes/e9-final-proof-ram/e9-t12-repaired-public-browser, then python3 -B
tools/verify/e9-device-completions-files.py --directory that-output --browser.
Built ordinary Wasm SHA256:
3c47a1dc51ee801f9fe08d0adbb120913ea4d1e1aafc00803c61de8c86d44c44.

Claim: qualified immutable-base/local-COW block, named-console file-agent receive and
guest-clocked S16 capture adapters bind accepted payloads to exact before-phase
positions and request identities. Reordered/delayed callbacks replay identical
complete CPU/RAM/device/COW/cursor frames, DMA, used-ring and IRQ witnesses.
Pending checkpoints resume without duplicating capture; initial profiles roundtrip
before the first transition; restored incarnations reject stale leases without
mutation. Immutable payload identity remains separate from delivery position in the
durable object graph. Unsupported adapters refuse admission. GPU result replay and
full Linux assembly remain later tasks. This is the worker claim awaiting a fresh
verifier verdict.

### 2026-10-18 — verifier — VERDICT: verified

- P1/P2/P4/P5 — HELD. Independently authenticated all 332 final raw/full-archive
  files, 156 primary artifacts, 35 submission source hashes, 54 contract boundary
  hashes and the clean clone's origin/connectivity. Its initially empty compiler,
  fresh dependencies, scrubbed environment and disclosed read-only Git object
  alternates match the claim. At native/pending.resume transition 4096 the actual
  block, named-agent and capture descriptors own requests 1–4 with cursor 0 and
  untouched DMA/used rings. Native/final.resume at 9096 has used=[2,1,1], heads=[3,0],
  guest report=[2,1,1,1,1,1], PCM3412cdab and exact independently computed block/agent
  bytes. Its SHA256 is e91b70afc94e7031df2d903479d34a25f54640ee4dadf3a2bc8fcc5fd40663de.
  The independent struct/hashlib decoder authenticates the complete durable object
  graph and separates immutable payload hashes from positioned deliveries. See
  cold-final-audit.json and public-independent-evidence.json in the verifier packet.
- P3/P6/P8/P9 — HELD. Recorded deliveries are IDs 2,3,4,1 at before-phase positions
  4096/4269/4442/4615, ordinal 1, sequence 1–4. Replay budgets 1/7/4096 reproduce
  complete frames and the original guest trace suffix. Six independent same-boundary
  schedules additionally exercise ordinals 1–4. Cancellation, block reset, console
  generation restart, wrong positions, foreign/stale leases and missing section 20
  refuse without state/cursor mutation. Stereo/short/failed/ready capture, deadline
  edges, cache pinning/eviction, failed block replay, finite ID/pending/payload/COW
  bounds and structured malformed checkpoints have concrete recorded assertions.
  The bounded byte attack produced 2606 atomic refusals and 1688 canonical accepted
  states from 4294 mutations; six compound and ten descriptor/sound mutations add
  relations that a single-byte corpus cannot prove. Exact producers, original frames,
  hashes and observations are indexed by verifier/ledger.md.
- P7/P11/J5/initial-profile predictions — FAILED on their superseded runtimes;
  repaired results HELD at 98260ff. The original erased-owner mutant remains
  preserved with its rechecked duplicate-capture point, as do both compiled-loop
  inactive-clock disagreements and the eight initial-profile frames. Final reciprocal
  ownership rejects those mutants before revoking a live lease; all eight initial
  profiles roundtrip with the real installed epoch. Actual ordinary-browser JIT at
  transition 5001 executes 464 translated six-instruction blocks/2784 JIT retires
  with capture disabled, then matches entire frames under replay budgets 1/8/4096
  with inactive clock 0. Enabled single-instruction and conservative multi-instruction
  paths also agree. An independent arithmetic oracle verifies all twelve CPU
  witnesses; the six-instruction loop reaches x20..24=[566,1698,2830,3962,6226] and
  pc0x80001914. See jit-edge-audit.json, initial-audit.json, final-repair-audit.json,
  actual-jit-final-edge/report.json and jit-cpu-audit.json in the verifier packet.
- P10 — HELD. The exact-head cold high-risk report passes all 24 commands, including
  native/Wasm/reproducible build, built browser 127/0, independent guest/CAS oracles
  and retained factory GPU retirement 2999712 with fresh resource 13/epoch 4 drawn.
  Public 127/0 has zero errors, live pips and durable reload. Independently checked
  all 36 public primary artifacts, 744 deployment payload entries, each strict
  HTTP206 rootfs range and the complete 512MiB object's expected SHA. Fresh reads
  from both c5aa196d.wasm-vm.pages.dev and wasm-vm.pages.dev serve exactly the frozen
  2140719-byte Wasm, SHA3c47a1dc51ee801f9fe08d0adbb120913ea4d1e1aafc00803c61de8c86d44c44.
  See cold-final-audit.json, public-audit.json and retained original HTTP receipts.
- P12/P13 — HELD with the explicit changed-line classifications in verifier/ledger.md.
  LLVM raw profiles, all fourteen executable coverage objects, source copies, lcov
  and commands are retained; only identical source lines carry hits across revisions.
  Actual browser JIT/V8 recordings supply the browser-only coverage. Exhaustive enum
  representations, a dominated decode bound, error forwarding, internal Before-phase
  assertion and generated/declarative/logging lines have specific waivers. The direct
  private-trait recording exercises the remaining capture shape/size/issue/ready and
  block/source-identity guards with an authenticated untouched runtime prefix. Scratch
  sabotage of Rc incarnation identity makes the stale-restore regression fail; source
  restoration makes it pass. This unchanged ownership-boundary result carries forward.
- SUITE — Eleven useful independent regressions are promoted into
  crates/core/tests/e9_device_completions.rs; the target now passes 22 tests with no
  ignores. cargo fmt --all --check, narrow core clippy with -D warnings and that
  adapter integration target all pass on the authoritative checkout. Source hash
  d89d90374850417337174a81ee371473541ef13005bee4f711a23700a0f306e0 and exact commands
  are in promotion-checks-receipt.json. No implementation code changed in verification;
  the frozen runtime gauntlet remains valid under the tests-only incremental policy.

Independent packet: evidence/e9-t12/verifier/provenance.json, SHA256
1038e06ab1623fd1b2d04e44ccabc6a56b60ff10aa2b062ca89ef4960c91dea7.
It retains 1283 lossless original-file entries, including every failed prediction,
recheck, raw mutation, browser recording, trace, profile, coverage object, producer and
setup-failure receipt. The plain ledger and original pre-inspection predictions sit
beside the SHA-addressed gzip inventory. Worker/public packet hashes remain those in
the implemented claim. No original evidence was deleted; derived compiler caches and
duplicate public extraction are explicitly classified in the inventory.

Verdict is limited to the qualified core and ordinary Wasm block/named-agent/S16
capture contract above. The existing Linux demo remains an incomplete prefix until
T13/T14; playback, unrecorded transports and GPU result replay remain refused or gated.
After this verification commit, the separate final cold source/compiler directories
may be released while preserving their Git metadata/object stores, all raw recordings,
complete archives and producer receipts. The authoritative worker checkout/compiler
remains active. Policy is checked before queue regeneration and this verdict commit.
