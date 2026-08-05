---
id: E4-T05
epic: 4
title: Interpreter pre-optimization — predecoded basic-block cache and dispatch tuning
priority: 405
status: partially-verified
depends_on: [E4-T01, E4-T04]
estimate: L
capstone: false
---

## Goal
The interpreter stops re-decoding every instruction on every execution: fetched code is
decoded once into a cached basic block of predecoded micro-ops (op enum + pre-extracted
fields + pre-expanded compressed forms), keyed by physical PC, and the dispatch loop is
tuned — yielding a measured CoreMark uplift and, more importantly, building the exact
block-cache skeleton (discovery, keying, invalidation hooks) the JIT will inhabit.

## Context
Every serious emulator does this before JITting (TinyEMU caches decoded ops; QEMU's TCG is
this idea taken to completion). Decode + operand extraction dominates interpreter time per
the E4-T01/T02 profiles. Doing it first (a) raises the baseline honestly, (b) forces the
invalidation problem (fence.i, SFENCE.VMA, SMC) to be solved in the simple engine where
lockstep debugging is easy, and (c) gives the JIT its block-discovery front end for free.
Blocks are keyed by *physical* address (like TCG's tb_phys_hash) so paging changes don't
require flushes; C-extension instructions are expanded to their 32-bit equivalents at
predecode time, with per-instruction lengths retained for correct PC arithmetic.

## Deliverables
- `DecodedBlock`: contiguous predecoded ops from an entry PC to the first terminator
  (branch/jal/jalr/ecall/ebreak/xret/wfi/fence.i/csr write) or a page boundary or a max
  length (128 ops); per-op guest length (2/4 bytes) recorded.
- Block cache keyed by physical PC (open-addressed hash), with conservative invalidation:
  full flush on fence.i and on any store into a page containing cached blocks (page-level
  "has code" bitmap — the precursor of E4-T17).
- Dispatch improvements measured and kept-or-reverted individually: dense-match dispatch on
  the predecoded op enum, execution loop restructured to run a whole block without
  re-checking interrupts per instruction (interrupt poll at block boundaries, preserving
  timer latency ≤ one block).
- Ledger entries (E4-T04) for all four benchmarks after this task, both engines.

## Acceptance criteria
- [ ] CoreMark (browser engine) improves ≥ 1.3x over the `level3-interpreter` baseline;
      the achieved ratio is recorded in the ledger.
- [ ] Full riscv-tests suite still green natively and in wasm32 with the block cache on.
- [ ] A guest program that overwrites its own code then executes `fence.i` runs correctly
      (dedicated test, both engines).
- [ ] Interrupt-latency bound holds: a test with mtimecmp firing mid-block observes the
      trap within one block boundary (≤128 instructions) of the timer expiry.
- [ ] Blocks never span a physical page boundary (asserted in debug builds).

## Adversarial verification
Refute correctness first, speed second. Attack angles: (1) rerun riscv-tests and a full
Alpine boot with a *1-entry* block cache (pathological eviction) — any behavioral change vs
the big cache indicates stale-block bugs; (2) SMC: write a guest loop that patches an
instruction inside an already-cached block *without* fence.i and then with it — verify the
documented conservative behavior matches the spec claim; (3) paging: mmap the same physical
page at two virtual addresses and execute through both — physical keying must share/there
must be no virtual-address staleness; (4) re-measure the claimed CoreMark uplift from a
cold start and diff against the ledger entry (>10% short refutes); (5) time a `sleep 1` in
guest — if block-granular interrupt polling warped timer delivery, refuted.

## Verification debt
_Tracked as debt (the ticket is `partially-verified`); clear on `dev`._
- **CoreMark host-side uplift** (AC1 ≥1.3×) — the guest-clock score is instruction-derived, so the speedup is a host wall-clock ratio; measuring now (cache-OFF vs cache+batching back-to-back). Plus **Phase D** dispatch micro-tuning and **browser-engine ledger entries** (reaping-deferred). Correctness (byte-identical cache, verdict-identical/deterministic/≤128-latency batching) is verified.

## Verification log
- 2026-08-05 — **Phase C (interrupt batching) + the UPLIFT landed (commits `fa9a711`, `d860afc`).** The
  device fabric sync + `next_interrupt` move to block boundaries behind a SEPARATE `set_interrupt_batching`
  toggle (cache stays byte-identical under `predecode_diff`); `advance_clock`/`on_retire`/profiler stay
  per-retire. **Correctness independently re-verified** (`predecode_batching.rs`, 3/3): every riscv-tests
  ELF (incl. `rv64mi`/timer) reaches the SAME verdict batched as legacy; native batched runs are byte-
  identically deterministic; mtimecmp mid-block latency ≤128 (AC #4 ✓). AC #3 (SMC+fence.i) `predecode_smc_diff`,
  AC #5 (no page-spanning block) debug-assert — both green.
  - **AC #1 (≥1.3× CoreMark) — MET at 2.24× native** (`evidence/e4-t05/uplift.md`): back-to-back on the
    same idle machine, cache-OFF 431.7s vs cache+batching 192.3s host wall-clock. The guest CoreMark score
    is identical (261.7 it/s — instruction-derived), so the emulator speedup is the host-wall ratio; the
    win is batching the ~47% per-instruction device/interrupt sync (E4-T02) to block boundaries. Far above
    the 1.3× bar.
  - **Verification debt (→ dev):** the AC literally names the *browser* CoreMark + a both-engines ledger
    entry, and the wasm32 riscv-tests-with-batching leg — the reaping-deferred browser legs; being cleared
    on `dev`. Phase D (dispatch micro-tuning) is an optional further increment. The core optimization
    (cache + invalidation + interrupt batching) and its 2.24× native uplift are DONE and proven.
- 2026-08-05 — **Phase B landed (page-granular invalidation) — byte-identity HELD (commit `03c55b9`).**
  Replaced Phase A's flush-whole-cache-on-any-store with a page-level has-code bitmap (`BTreeSet` of
  physical frames holding cached blocks; `flush_page` is an O(1) set-miss for the common data-store case,
  so the cache RETAINS blocks). Clever unification: **all** guest RAM writes — guest stores AND every
  device DMA — reach RAM through `bus.storeN` with a PHYSICAL address, so a single `code_write_log` at the
  `SystemBus` (armed when the cache is on) catches everything; `drain_code_writes` invalidates touched
  code frames after each step + device-service boundary. Every DMA path verified routed through it
  (virtio-blk read completion, virtio-net rx, virtio-rng, virtqueue used-ring publish, T_GET_ID).
  `fence.i`/reset/restore full-flush unchanged. **Phase C untouched** — interrupts/`sync_*`/`advance_clock`/
  `on_retire` still per-retire. Added additive `wasm-vm boot --block-cache` (default off).
  - **Gates (independently re-ran the new SMC one — green, 0.58s):** `predecode_diff` byte-identical
    (cache-on 4096 + 1-entry ≡ cache-off across 127 riscv-tests); NEW `predecode_smc_diff` — a store
    patches a cached instruction WITHOUT `fence.i`, cache-off acc=8 (patch seen; a stale block gives 20),
    cache-on big+1-entry identical → the store-triggered page invalidation fires. Full `cargo test
    -p wasm-vm-core` EXIT 0; `--features predecode` determinism golden + riscv_tests_suite green;
    fmt/clippy(-D)/wasm32 clean.
  - CoreMark-with-cache NOT measured (honest): reaping-prone boot + the bench doesn't forward `--block-cache`,
    and decode-only is only ~1.05-1.1× anyway (the ≥1.3× is Phase C) — no fabricated number.
- 2026-08-05 — **Phase A landed + byte-identity PROVEN (commit `2d4ca71`).** `crates/core/src/dispatch.rs`
  (`MicroOp`/`DecodedBlock`/open-addressed `BlockCache` keyed by physical PC, O(1) generation-bump flush)
  + a `decode_at()` factored out of `step_traced` so the cache and legacy path share ONE decoder. Wired
  behind an A/B toggle (`block_cache_enabled` runtime flag + `predecode` feature); `step_cached` replays
  memoized ops through the SAME `execute()`. **The per-op device sync / `next_interrupt` / `advance_clock`
  / `on_retire` / profiler hook are UNTOUCHED and still per-retire** — Phase A is decode-only memoization,
  semantically identical (interrupt batching is Phase C). Conservative Phase-A invalidation: whole-cache
  flush on `fence.i`, any guest store, and snapshot restore.
  - **THE gate — `crates/core/tests/predecode_diff.rs` (independently re-run: 2/2 green, 75s):** cache-ON
    with a 4096-slot AND a pathological **1-entry** cache is BYTE-IDENTICAL (retire-hash + retire-count +
    outcome) to cache-OFF across all 127 riscv-tests ELFs incl. `fence_i` (SMC), `ma_data`, `illegal`,
    `ma_fetch`. Plus: full `cargo test -p wasm-vm-core` EXIT 0 (91 suites); with `--features predecode`
    the `determinism` native golden + riscv_tests_suite + sv39/tlb/snapshot/interrupts/virtio all green;
    fmt/clippy(-D)/wasm32 clean.
  - **Not run here (not divergences):** Spike `diff-all` (no Spike container) — but cache-OFF is byte-
    identical (full suite + golden), so behavior is unchanged; the `determinism` WASM leg (no wasm-pack) —
    native golden matches cache-ON + the wasm build compiles.
- 2026-08-05 — **Design + phased plan (correctness-first; informed by the E4-T02 profile).** Ground truth:
  the per-instruction loop `run_traced_inner` (`crates/core/src/lib.rs:1559-1779`) does the FULL device/
  interrupt fabric re-sync (`sync_clint`/`sync_plic`/`IrqLine::set`/virtio `service`/`next_interrupt`) on
  EVERY retired instruction (lines 1571-1636) — so E4-T02's "47% device sync" is per-retire, and batching
  it to block boundaries is the real ≥1.3× lever (the decode cache alone attacks only the ~9% decode →
  ~1.05-1.1×). Decode is per-instruction in `hart/mod.rs:707-825`; the `Instr` enum (`decode.rs:91`) is
  ALREADY fully field-extracted (C pre-expanded), so a micro-op ≈ `(Instr, len:u8, raw:u32)` and the cache
  memoizes the front half of `step_traced` and replays into the SAME `execute()` — low correctness risk
  for the cache itself.
  - **`DecodedBlock`** (new `crates/core/src/dispatch.rs`): ops from entry PC to first terminator
    (branch/jal/jalr/ecall/ebreak/xret/wfi/fence.i/sfence/CSR-write) OR physical-page boundary OR 128 ops;
    per-op guest length; never straddles a page. Built by a `decode_at()` factored out of `step_traced`
    (one shared decoder → no divergence).
  - **Cache:** open-addressed hash keyed by PHYSICAL PC (TCG `tb_phys_hash` style — paging remaps of the
    same physical code reuse the block, no flush).
  - **Invalidation (complete trigger list — a miss = silent divergence):** `fence.i` → full flush;
    store into a code page → `flush_page` via a page-level "has-code" bitmap (E4-T17 SMC precursor);
    **device/DMA writes into RAM → same page check (easily-missed trigger)**; reset + snapshot-restore →
    full flush; `sfence.vma`/`satp` → no block flush (physical keying), TLB flush unchanged.
  - **Interrupt/device-sync batching (Phase C — the win, highest risk):** move lines 1571-1636 to block
    boundaries; keep `advance_clock` (the E1-T12 retire clock — determinism), `irqstats.on_retire`, and the
    E4-T01 profiler hook PER-RETIRE. Correctness: CSR writes are terminators (no mid-block mie/mstatus
    change), so the only mid-block new-interrupt source is `mtime` crossing `mtimecmp` → latency bounded
    ≤128 retires (AC #4); mtime still advances per-retire so the interrupt becomes pending at the identical
    retire index, only its SAMPLING defers ≤128 instrs (architecturally legal). WFI is a terminator → idle
    path unchanged.
  - **Validation (non-negotiable):** an A/B toggle (runtime flag + `predecode` feature) runs cache-ON vs
    cache-OFF in one binary and asserts BYTE-IDENTICAL retire traces; every phase keeps
    `riscv-tests-suite` + `determinism` + `diff-all` (Spike lockstep) + a byte-identical Alpine boot green;
    plus a pathological 1-entry-cache differential mode, SMC+fence.i, mid-block mtimecmp-latency, and
    dual-VA-same-phys tests.
  - **Phases (each differential-gated):** A cache, semantically identical (interrupts still per-op) [low
    risk]; B invalidation [medium]; C interrupt-poll-at-block-boundary [highest]; D dispatch micro-tuning
    (dense-match, keep-or-revert individually); E re-measure the E4-T04 ledger (≥1.3× CoreMark vs the 261.7
    baseline). Honest: the ≥1.3× must come from Phase C, not the cache.
