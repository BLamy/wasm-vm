---
id: E9-T11
epic: 9
title: Record guest-visible time and entropy observations
priority: 524.911
status: verified
depends_on: [E9-T09]
estimate: S
risk: high
capstone: false
---

## Goal

Make host time and random inputs reproducible at their original guest positions.

## Boundary

Clock/RTC updates, lifecycle rebases, idle/timer decisions and supplied entropy, using the contract inventory. Deterministically derived values need a frozen policy; externally supplied values need recorded bytes.

## Acceptance criteria

- [x] A workload reading time and RNG around sleeps, pause/resume and tab lifecycle changes replays identical observations.
- [x] Replay consumes recorded values without reading the current host clock or CSPRNG for guest-visible results.
- [x] Malformed entropy lengths, clock-policy mismatches and exhausted records stop with a typed divergence error.

## Deterministic acceptance

`make verify-E9-T11` records the risk-tier native/wasm, independent guest-state oracle and built-page assertions from a clean frozen head. Override `E9_SOURCE_EVIDENCE_DIR` to select a fresh output directory. A final pristine clone runs the same command. The worker submission and fresh verifier verdict below determine its proven status.

## Adversarial verification

Replay under a different wall clock and entropy provider, including background/resume transitions. Any influence from the replay host refutes the boundary.

## Verification log

### 2026-10-18 — worker — begin

E9-T11 is the first eligible task after independently verified E9-T10. Risk is high
because external clock samples and random bytes affect guest architectural state.
The slice will freeze the admitted ICount policy, intercept actual RTC observations
(including alarm polling) and entropy fills at ordered observation positions, and
prove the same workload consumes recorded values under different host providers.
Complete provider replay remains gated by T12–T14. No implementation or verification
claim is made by this activation entry.


### 2026-10-18 — worker — frozen local and pristine submission

Runtime and acceptance harness: `7d52129e9277468cb2d8e8cfc83571d9d7fb8334`.
`E9_SOURCE_EVIDENCE_DIR=target/evidence/e9-t11-worker-final make verify-E9-T11`
passed all selected gates: 693 native tests, 81 Node protocol/input tests, no-std/default
wasm builds and clippy, built browser suite 127 passed/0 failed, zero console errors,
independent native RAM/RTC/ICount/trace and durable-object oracles, and actual retained
GPU factory instruction retirement plus a fresh physical draw. Worker report SHA-256:
`19e13fd2989eaa6d30ba7c6a8485f221f9e914ce86fabc2966f048245ba80e19`.

`python3 target/e9-t11-cold-wrapper.py` ran the same acceptance command from an
independent detached clone with scrubbed environment and initially empty compiler target.
Cold receipt SHA-256 `703c325f8e60e033ef9b2c65cfdf8952baa8f8d5422a5e8c8f5e84e5163f4043`;
acceptance report `323a57add267b0516bdb51f24169650c4904b79d9fe769be387f6ba57be97e5b`.
Original recordings remain in `target/evidence/e9-t11-worker-final/` and
`target/evidence/e9-t11-cold-final/`; authenticated compact copies are in
`evidence/e9-t11/worker-final/` and `evidence/e9-t11/cold-final/` (with wrapper source).

Claim: the real RV64 RTC/RNG/WFI workload retains identical frames, guest UART bytes,
retirement traces and source receipts across replay quanta 1/7/64 with hostile providers
and zero replay host reads. Two native seeds, policy/length/order/exhaustion refusals,
recorded provider failures, restored source cursors, safe receipt yielding, and transactional
DMA quota failure execute in the recordings. The browser actually freezes/resumes the
page while the guest is paused, injects a real Web Crypto outage, and reopens direct and
whole-worker production journals after guest poweroff. Each natural-terminal journal has
413 receipts ending at transition527/retired526; the original fixed workload ends at
transition523/retired522. Full Linux replay remains gated by T12–T14.

`bash tools/deploy-cloudflare.sh` initially hit a transient rootfs download stall and
Wrangler's upload-size fallback limit. The unchanged script succeeded on retry with
read-only curl retries and RAM temporary storage; every remote artifact was byte-verified.
Deployment: `https://d269e881.wasm-vm.pages.dev`, production `https://wasm-vm.pages.dev/`.
Logs: `/tmp/e9-t11-deploy.log` (failed attempt), `/tmp/e9-t11-deploy-retry.log` (success).
The new runtime is published; public-site proof and fresh verifier verdict follow this
entry. No runtime code changes are included in this artifact/log commit.


### 2026-10-18 — verifier — VERDICT: refuted

- **P10 admitted compiled dispatch — FAILED.** Before the run I predicted that the
  same warmed actual Wasmtime machine and source tape would replay identical ordered
  RTC samples under host budgets 6 and 1. At runtime
  `7d52129e9277468cb2d8e8cfc83571d9d7fb8334`, recording budget 6 samples the armed
  RTC at transitions 384, 390, 396, 402, 408 and 414. Replay budget 1 consumes 384,
  then requests its second sample at transition/retired **385/385**, observe ordinal 1,
  sequence 2; the second recorded sample is **390/390**. Replay stops with typed
  `SourceDivergence(Position)` and zero host RTC calls. The same-budget-6 control
  matches initial/final frames and every receipt with zero host calls. Reproduced twice
  with the real executor, 59 compiled blocks executed by recording end. Exact points:
  `evidence/e9-t11/verifier-refutation/record.observations.jsonl:2` (binary offset 78;
  tape SHA-256 `9c9233e69029e267875485471bfbc020c4cb36587f314b985996c771b61f01c1`)
  and `evidence/e9-t11/verifier-refutation/recheck.log:3` (SHA-256
  `e60e4c0d6a3dd5d0fea169b4667652123b8e98da6a6fd8da9732aaba36e01d2b`).
  Source admission at `crates/core/src/session_clock/sources.rs:662` accepts the
  installed executor, while the pure compiled span allowed at `crates/core/src/lib.rs:5699`
  changes the external polling cadence. **Demand:** make admitted source sampling
  independent of compiled host budgets, then record the corrected actual-JIT matrix and
  the risk-tier final head. This is a source-adapter failure before the full-Linux-replay gate.

- **P1–P9 existing evidence — HELD, scoped.** Preserve the fixed real RTC/RNG/WFI
  guest's native and browser frames, exact DMA/UART bytes, RTC offset/latch model,
  deterministic WFI, frozen/active pause, zero-provider replay, typed malformed/policy/
  exhausted/order/failure stops, cursor rollback and durable direct/whole-worker terminal
  journals. Worker report remains
  `19e13fd2989eaa6d30ba7c6a8485f221f9e914ce86fabc2966f048245ba80e19`;
  cold receipt `703c325f8e60e033ef9b2c65cfdf8952baa8f8d5422a5e8c8f5e84e5163f4043`;
  cold acceptance `323a57add267b0516bdb51f24169650c4904b79d9fe769be387f6ba57be97e5b`;
  public aggregate `af659af806c15c76445b95ee0bfebbc15f07e227bc028b381169e11b95cdf376`.
  Authenticated all worker/cold/public artifact indexes and 18 public runtime assets;
  public HEAD `0fcd33c8d1539bcddffab8656a4153e29a3d8623` differs only in task/evidence
  files. Fresh independent production RTC reconstruction and payload-bit sabotage checks
  passed against final worker, cold and public objects. A real direct-production CSPRNG
  outage separately proves the typed stop at 115/115/observe/sequence 3, failed entropy
  publication, no guest output and writer release. These scoped HELD results do not
  qualify the newly refuted compiled polling cadence and need not be re-litigated when
  their code, boundary and evidence digest remain unchanged.

- **COVERAGE and SUITE.** The 224 frozen diff hunks are classified in the ignored
  verifier ledger. Fresh instrumented native runs execute 733/757 changed counted lines;
  24 required trait shims/private invariant defenses have explicit waivers. All 148 changed
  counted browser JavaScript lines execute. The new source/JIT combination was missing
  from the worker's correctness proof and is now a permanent regression in the existing
  selected `e9_event_clock_critic` binary. Its armed case fails as predicted; the bounded
  **unarmed guest RTC read after compiled compute** matrix passes all budget 1/8 pairs
  with identical frames/receipts and zero replay calls. The separate 3 MiB byte-budget
  regression is appended to the selected `e9_time_entropy` binary and passes. JIT matrix
  runs emit initial/record/replay frames and source tapes under `E9_SOURCE_EVIDENCE`,
  keyed by guest-read/alarm/record/replay budgets. Runtime code was not edited.

Commands: `cargo fmt --all --check`; affected core/JIT integration-target clippy with
`-D warnings` (passed); `cargo test -p wasm-vm-core --features trace,virgl-renderer
--test e9_time_entropy critic_byte_budget -- --nocapture` (1 passed);
`cargo test -p wasm-vm-jit-runtime --test e9_event_clock_critic time_entropy --
--nocapture` (**1 passed, 1 failed**, expected exit 101 for the promoted refutation).
Evidence: `evidence/e9-t11/verifier-refutation/receipt.json` SHA-256 `db98fba97e7d3eeb21050db282510d3132c7e856884ef573b211cf2ded9fad6e`;
full fresh notes/profiles/oracles remain in `target/evidence/e9-t11-verifier/`.
Status remains `in-progress` for semantic repair, never `verified`.


### 2026-10-18 — worker — semantic rework after compiled RTC refutation

The fresh verifier's actual-JIT recording refuted the dispatch-dependent armed RTC
polling cadence. Session dispatch now caps a span at one transition while source
capture/replay is active and the RTC alarm remains armed. This preserves every poll
position regardless of host quantum. Disarmed pure compiled work remains available;
existing exact MMIO fallback handles guest RTC reads. The promoted armed/disarmed JIT
matrix and byte-budget test are part of the already-selected acceptance binaries, and
the JIT test source joins the final source-digest inventory. A new frozen worker,
pristine-clone and public submission will replace the runtime claim; prior evidence
and the verifier's failed recording remain retained. Status stays `in-progress`.


### 2026-10-18 — worker — corrected frozen submission

Runtime and selected harness: `e14e4312b9ee8df73b93646c944bf64a2f0db875`. The actual-JIT
refutation is corrected: an armed RTC is polled before every guest transition, while
disarmed pure compiled execution remains available. The promoted budget 1/6 matrix
records exactly 36 polls at transitions 384–419 and compares every receipt and full
frame with zero replay provider calls. The disarmed read matrix and 3 MiB byte-budget
regression also execute in the selected gate. Historical failed evidence remains retained.

`E9_SOURCE_EVIDENCE_DIR=target/evidence/e9-t11-worker-corrected-final make verify-E9-T11`
passed all 29 gates: 696 native tests, 81 Node tests, native/wasm lint/build checks,
127 passed/0 failed in the built browser with zero console errors, independent native
RTC/entropy/ICount/frame and durable-object oracles, and real retained-GPU factory
retirement plus physical draw. Worker report SHA-256 `3d005ff45b6687f8c9c4455c70003c9b3ba7d68adfe91c6008be7c3f80c4c777`.

`python3 target/e9-t11-cold-corrected-wrapper.py` ran the same acceptance from an
independent clean clone with scrubbed environment, separate Git metadata/no alternates
and initially empty compiler output. Cold receipt `2c4ee1f8404ddea949d1fed308139fe06352a41ba0b8b66fae65cf0aa772c931`;
acceptance report `c7e87c0bc206e838564e03087b3b38dace1a6e73012a7b0eff8f64305b50f7fe`.

The unchanged stock `bash tools/deploy-cloudflare.sh` succeeded with read-only curl
retries and task-owned RAM temporary storage. Exact successful payload and R2 bindings
are preserved in `target/e9-t11-full-corrected-deploy/`; deployment
`https://abfbb985.wasm-vm.pages.dev`, production `https://wasm-vm.pages.dev/`.
`python3 target/e9-t11-public-corrected-wrapper.py` then verified production asset hashes,
127/0 and zero errors, actual frozen/active source replay, direct and whole-worker durable
413-event terminal journals, independent byte/state oracles, and retained factory
retirement/draw. Public report SHA-256 `694d9225a41b360ccdb26580065a7e5bee147059de99b1ae444c7d4e554b8e49`.

Original recordings remain in the corresponding `target/evidence/e9-t11-*-corrected-final/`
directories. Authenticated compact copies, raw guest frames/tapes/traces and producer
sources are in `evidence/e9-t11/worker-corrected-final/`, `cold-corrected-final/` and
`public-corrected-final/`. This claim covers time/entropy adapter capture and replay;
full software session replay remains gated by T12–T14. Status is `implemented` for the
fresh critic's final incremental verdict. No verification or merge is asserted here.


### 2026-10-18 — verifier — VERDICT: verified

- **C1/C2 corrected actual-JIT cadence — HELD.** Predictions were written after
  orienting the repair diff and before inspecting corrected results. At runtime
  `e14e4312b9ee8df73b93646c944bf64a2f0db875`, all four armed record/replay budget
  1/6 pairs in both worker and independent cold recordings contain exactly 36 polls
  at transitions 384–419. The second observation is now **385/385**, observe ordinal
  1, sequence 2, as predicted: `evidence/e9-t11/verifier-corrected-final/armed.observations.jsonl:2`
  (binary offset 78; tape SHA-256
  `a7bc8890064f0f33aff0b68b91c1398720fc0fe3494784a32cc103e916046dae`).
  Initial/final native frames and tapes match across every pair and both origins;
  native end is 420/420, source cursor 36, and replay RTC calls are zero. The disarmed
  guest-read matrix has exactly four reads at 390, 398, 406 and 414, native end 416/416,
  cursor 4, matching frames and zero replay calls (tape
  `f171dbc3561b2bb1575401e81ab93e3fbc87f958dbf8f29fd5ce1475c02f0346`).
  An independent Python struct decoder checks CPU arithmetic, CLINT phase, RTC flags
  and native sections 18/19 without importing the emulator codec. Selected real-
  Wasmtime results are at `evidence/e9-t11/worker-corrected-final/jit-native.log:62`
  and `evidence/e9-t11/cold-corrected-final/jit-native.log:121`.

- **C3/C4 bounded firing-edge attack — HELD.** Predicted and observed RTC samples
  are 123, 124 and 125 at transitions 384, 385 and 386 with alarm 125. All nine
  record/replay budget pairs from 1/6/7 converge on the same tape and native frame,
  final 468/468, cursor 3, RTC disarmed/fired, and zero live replay calls. Compiled
  execution resumes after firing: quantum 6 executes 13 compiled blocks and quantum 7
  executes 3. Points: `evidence/e9-t11/verifier-corrected-final/boundary-cadence.log:4`
  and `:7`; raw matrices are retained in its `boundary-cadence/` directory. Tape
  SHA-256 `1474ed96f23150d5774705d8af541796abe61c6913a989c7fa8248d97f68874c`;
  final frame `525d65ccf3f3fc5ff9690f3dc32472c82d8303c4d2b4a2953a5cfc003d339476`.
  The disarmed captured-read control still executes four compiled blocks (log line 10),
  and ordinary uncaptured armed execution retains six polls and six compiled blocks
  (line 11). These observations cover both edges of the source/armed dispatch guard.

- **C5/C7 coverage, carried evidence and suite — HELD.** P1–P9 retain their prior
  scopes and evidence digests; the exact carried ledger SHA-256 is
  `cb0ce9a29a651d535a05f69152690ab0e4c3508d39c50604db59253a42f6da29`.
  The historical P10 failure and receipt remain unchanged. The sole new runtime hunk,
  `crates/core/src/session_clock.rs:663`, is exercised with armed/disarmed RTC,
  inactive source capture and active capture without an RTC (the selected byte-budget
  regression). Declarative/generated deltas authenticate against frozen source/assets;
  the earlier 224-hunk coverage classification and explicit invariant waivers carry
  forward. The two promoted JIT tests and 3 MiB byte-budget test execute permanently
  through `make verify-E9-T11`; worker and cold each pass all 696 native tests and
  81 Node tests. The retained red JIT recording detects the missing guard. Fresh
  independent RTC/UART reconstruction also rejects one-bit corruption of the first
  durable RTC sample in corrected worker, cold and public journals. No runtime code
  was changed by this verifier.

- **C6 exact-head, browser and origin — HELD.** Authenticated every indexed file:
  907 worker, 909 cold acceptance/911 cold outer, and 1,142 public, plus all 51 source
  digests in each submission. Report/receipt hashes match the corrected worker claim
  above. Public source and GPU proofs authenticate all 18 and 58 runtime assets against
  frozen dist, respectively; the suite is 127/0 with zero console errors. Read-only
  independent source, 28-frame clock and durable-object oracles pass, including the
  direct/whole-worker 413-event poweroff journals and zero-provider failure replay.
  Actual retained-GPU retirement and physical draw pass. The full deployment snapshot
  authenticates 739 files and all 734 frozen tracked files. Both old and corrected
  cold clones have clean exact-head source, matching 50/51 source digests, recorded
  initially empty targets and scrubbed environment. Their independent persistent Git
  metadata has no alternates and passes connectivity fsck. The exact RAM source and
  compiler directories named in `cold-origin-final-audit.json` may be released after
  this verdict; retain Git metadata, all original recordings and proof capsules.

Evidence: `evidence/e9-t11/verifier-corrected-final/receipt.json` SHA-256
`4455f027caa3a412ab7f64440b9ec0d274ba85738e560859fc2db37388b26816`
indexes 92 files, including predictions, independent decoders, raw firing-edge frames
and tapes, unchanged HELD ledger, identity/origin audits and oracle outputs. Commands:
read-only artifact/source authentication; independent `jit-frame-critic.py` on worker,
cold and firing-edge data; source/clock oracle reruns with only output paths redirected;
`production-rtc-critic.py --sabotage`; cold Git connectivity fsck; then task policy and
queue generation. Worker submission `9abe576db62c7a8f691cc2224fb507df4a384b58`
changes only task/queue/evidence from runtime e14. All three acceptance criteria are
verified for the time/entropy adapter boundary. Full software/Linux replay remains
gated by T12–T14.
