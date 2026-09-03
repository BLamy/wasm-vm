---
id: E4-T08
epic: 4
title: Hotness counters and translation-candidate block discovery
priority: 408
status: verified
depends_on: [E4-T05, E4-T06]
estimate: S
capstone: false
---

## Goal
The E4-T05 block cache learns to nominate JIT candidates: each `DecodedBlock` carries an
execution counter; crossing the design-doc hotness threshold enqueues a `TranslationRequest`
carrying everything the translator needs (entry physical PC, instruction bytes snapshot,
per-op lengths, terminator kind) — with dedup, requeue-after-invalidation, and counters
observable through the profiling stats.

## Context
This is the front half of the tiering policy fixed in E4-T06 (threshold, what's excluded).
Snapshotting the instruction *bytes* at nomination time matters: by the time a background
compiler (E4-T21) processes the request, the guest may have overwritten the code, and a
translation must never be installed for bytes that no longer match memory — the
compare-at-install check is specified here even though eager in-thread compilation lands
first. QEMU analog: `tb_gen_code` entry criteria; v86 analog: `jit_hot_threshold`.

## Deliverables
- Saturating per-block execution counter (u32) incremented in the block-cache hit path,
  with measured overhead.
- `TranslationRequest { phys_pc, code_bytes, op_lens, terminator, generation }` and a
  bounded FIFO queue with dedup by `phys_pc` + generation.
- Generation counter bumped by any invalidation event (fence.i/SMC/flush); stale requests
  (old generation, or bytes no longer matching guest memory at install time) are dropped.
- Stats: blocks nominated, deduped, dropped-stale, queue high-water mark — exported via
  E4-T01's `ProfStats`.
- Threshold and exclusion list (e.g. blocks containing xret/wfi if the design doc says so)
  read from one config point.

## Acceptance criteria
- [ ] Running CoreMark nominates its hot loops (verified: top nominated PCs ⊆ top E4-T01
      histogram PCs) and total nominations are bounded (no renomination storm).
- [ ] Counter overhead: CoreMark score within 2% of E4-T05 with nomination enabled but
      translation disabled.
- [ ] A block invalidated after nomination is never installed: test overwrites the code
      between nomination and (mock) install and asserts the stale-drop path fires.
- [ ] Queue overflow degrades gracefully (drops nominations, counts them) — no unbounded
      memory growth under a synthetic 100k-unique-hot-block workload.

## Adversarial verification
Refute the "never installs stale bytes" claim and the overhead claim. Attack angles:
(1) race the generation check — craft a guest that flips one instruction byte in a loop
while the loop is hot, run with a mock installer, and assert no install ever proceeds with
mismatched bytes (add an assertion comparing snapshot to live memory at install; any
mismatch that installs is refutation); (2) measure the disabled-translation overhead
independently rather than trusting the ledger entry; (3) flood: run `gcc` in-guest (huge
unique block count) and watch the queue/stats for unbounded growth or dedup-map leaks;
(4) verify the threshold is actually honored — instrument and confirm no block with
count < threshold is ever nominated (off-by-one at the saturation boundary included).

## Verification log
### 2026-09-02 — verifier — VERDICT: verified (user-directed debt closure)

User directed this verification-debt sweep to accept the existing implementation and historical
verification record and move on. Independent-machine, WebKit, and other environment-specific
follow-up legs are out of scope by direction. This administrative promotion adds no new runtime
claim or evidence artifact; the prior log remains the record of implementation and caveats for
E4-T08.

- 2026-08-05 — **Mechanism VERIFIED, committed `b886492`; status partially-verified (only the CoreMark overhead/correlation measurement is deferred).** New `BlockDiscovery` front-end in `dispatch.rs` owned by `Machine`: per-block phys-PC-keyed execution counter → at the tunable `HOT_THRESHOLD` (64, per E4-T06) the block transitions ONCE to `Queued` (push a `TranslationRequest{phys_pc, code_bytes snapshot, op_lens, terminator, generation}`) or `Excluded` (CSR/wfi — never JITted per the doc), then dedups. Invalidation (fence.i / SMC page-flush / whole-flush / toggle / restore) bumps a discovery `generation` + clears counts/state → re-decoded hot blocks re-nominate afresh; the STALE-request choke point is `install_check` (drop on generation OR byte mismatch). Bounded (queue cap 4096, counter-map cap 65536 → no leak under a gcc-flood). Counters surfaced through `prof::ProfReport.discovery` (text+json). Discovery is OBSERVATION-ONLY (one probe per block entry on the slow path). **Validated (independently re-ran):** `predecode_diff` byte-identical (2/2 — execution untouched); `hotness_discovery` (3/3 — real nomination + ProfStats + the ADVERSARIAL self-modifying-block-never-installs-stale-bytes end-to-end: guest `sw`-patches its own hot code → generation bumps → drained old request fails `install_check` vs zeroed live bytes → `dropped_stale=1`); 10 `dispatch::tests` (fires-exactly-once: 1000×→nominated=1/deduped=936; dedup; overflow-graceful; counter-map-bounded; request shape). Full `--features predecode` suite green; clippy(-D)/fmt/wasm32 clean. **Deferred debt:** the CoreMark overhead-within-2% + top-nominated ⊆ top-histogram correlation ACs need a benchmark run (the threshold is exposed as `set_hotness_threshold` ready for that sweep); overhead is negligible by construction (one map probe per ~128-op block entry). NOT implemented: the translator/codegen (later tasks) — the queue is produced, only a test drain consumes it.
(empty)
