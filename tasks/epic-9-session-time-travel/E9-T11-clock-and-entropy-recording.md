---
id: E9-T11
epic: 9
title: Record guest-visible time and entropy observations
priority: 524.911
status: in-progress
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

- [ ] A workload reading time and RNG around sleeps, pause/resume and tab lifecycle changes replays identical observations.
- [ ] Replay consumes recorded values without reading the current host clock or CSPRNG for guest-visible results.
- [ ] Malformed entropy lengths, clock-policy mismatches and exhausted records stop with a typed divergence error.

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
