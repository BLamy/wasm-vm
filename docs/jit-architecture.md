# JIT architecture — tiering, block shape, ABI, side exits, invalidation, budgets (E4-T06)

**Status:** accepted (design) · **Date:** 2026-08-05 · **Epic:** 4 (acceleration)
**Depends on:** E4-T02 (profiling), E4-T05 (predecoded block cache) · **Implemented by:** E4-T07…T28

This document commits to the load-bearing decisions of the WASM JIT. Every later Epic-4 task
implements a *section* of this document rather than re-litigating it: E4-T07 the emitter,
E4-T08 hotness, E4-T09/T13/T14/T15 translation, E4-T10 dispatch/instantiation, E4-T11 the
inline TLB, E4-T12 trap side-exits, E4-T16/T17 invalidation, E4-T18 chaining, E4-T19/T20
module batching + budgets, E4-T21 the compile queue, E4-T22/T23/T24 the worker model.

It is deliberately decisive. Where a choice is a hypothesis rather than a measurement, it says
so and names the task that will falsify it. Where a number is cited, it is read from a committed
profiling artifact (`evidence/e4-t02/*`, `bench/ledger.json`, `docs/perf/*`) — **no number in
this document is invented**.

---

## 0. The one number that shapes everything

The Level-3 interpreter baseline (`docs/perf/level3-interpreter-baseline.md`, ledger
`bench/ledger.json`) is **261.734 CoreMark it/s, 189.717 DMIPS, ~30 MIPS**, boot 375 s. The
capstone (E4-T28) target is **≥10× CoreMark**. That factor of ten is arithmetic on *these*
numbers, not aspiration.

The native host flamegraph (`evidence/e4-t02/hotspots-summary.md`, two real `samply` captures,
323 k + 690 k samples) bucketed the interpreter's host self-time as:

| Bucket | Share | Leaf frames |
|---|---:|---|
| Per-quantum **device / interrupt re-sync** | **≈47%** | `sync_plic` 24.1%, `IrqLine::set` 7.7%, `sync_clint` 7.1%, `sync_sbi_timer` 4.3%, `next_interrupt` 3.9% |
| **Address translation** | ≈24% | `translate_cached` 9.8%, `mode_params` 5.1%, `satp` 4.4%, `pmp::check` 3.1%, `finish_leaf` 2.4% |
| **Dispatch + execute** | ≈13–23% | `run_traced_inner` self 9.5%, `Hart::execute` 3.6% |
| **Decode** | ≈9% | `decode` 4.9%, `expand_c` 4.4% |
| Device I/O | ≈3% | `blk::service` 1.5% |

The browser capture (`evidence/e4-t02/browser-capture.md`, real `.cpuprofile`, 373 k samples)
confirms the shape: **89.3% of host self-time is inside wasm**, top-3 wasm functions ≈47%, and
the `performance.now()` wasm-bindgen boundary (`__wbg_now`) is **7.1%** — a browser-only tax the
native profile cannot see.

**Three consequences drive the whole design:**

1. **Decode is only ~9%.** A JIT's value is *not* eliminating decode — E4-T05's predecoded cache
   already did that. The prize is eliminating the **per-instruction interpreter overheads that a
   compiled block folds away**: dispatch, the repeated TLB/PMP walk, and above all the per-quantum
   device/interrupt re-sync.
2. **Device-sync is already the measured #1 lever, and E4-T05 already attacked it.** Batching the
   ~47% device-sync path to block boundaries delivered a **measured 2.24× native host uplift**
   (`evidence/e4-t05/uplift.md`: 431.7 s → 192.3 s host wall, same idle machine, guest CoreMark
   score unchanged at 261.7 it/s because it is instruction-derived). **The JIT must preserve this
   batching semantics or it regresses the thing that already works.** This is the single most
   important constraint in this document.
3. **The browser is the hard target.** `performance.now()` at 7.1% and the `WebAssembly.compile`
   size/latency caps (§7) mean the JIT is budget-bound, not throughput-bound, in the browser. A
   design that is fast natively but blows the module-instantiation budget in a tab is a failure.

---

## 1. Tiering policy

**Decision.** Three tiers, promotion by execution count on the existing E4-T05 block cache:

| Tier | Engine | Entry condition | Owner |
|---|---|---|---|
| **T0 — interpret** | `run_traced_inner` per-op | cold code; anything not yet a block | today |
| **T1 — predecoded block** | `dispatch.rs` `step_cached`, device-sync batched to block boundary | first execution of a discovered block | **E4-T05 (done)** |
| **T2 — compiled block** | emitted WASM function, called from the dispatch loop | block exec-count crosses the hotness threshold | E4-T09/T10 |

There is **one JIT tier (T2), not a baseline+optimizing split.** Rationale: v86 ships a single
JIT tier and reaches near-native on browser workloads; a second optimizing tier's classic payoff
(register allocation across blocks, speculative inlining) is exactly the superblock/trace work we
defer to a *measured* experiment (§2), and building two backends multiplies the browser
module-budget problem (§7) we already call the hard constraint. **A second tier is a hypothesis to
be opened only if the ledger shows T2 leaving ≥2× on the table (E4-T28 gate), not a day-one
commitment.**

**Hotness threshold: promote a block at its `N`-th execution, initial `N = 64`.** Counted as a
`u32` execution counter co-located with the `DecodedBlock` (§5 keying), incremented once per block
entry in T1. Rationale for 64: the profiling shows device-sync (a per-quantum fixed tax) dominates,
so the compile must pay for itself against *interpreter* time, and in the browser each compile also
pays a `WebAssembly.compile` latency (§7); 64 is v86's order-of-magnitude choice and is low enough
that a boot's hot kernel loops promote early yet high enough that one-shot init code never compiles.
**This is a tunable, not a law** — E4-T08 owns it and records the swept value against the ledger;
the number here is the starting point, falsifiable by a ledger regression.

**What is never JITted (day one):**

- **F/D floating-point** — deferred to E4-T15, which decides *by measurement* whether to emit inline
  WASM f32/f64 ops (fast, but IEEE/NaN-boxing/`fcsr` corner cases risk divergence from our softfloat)
  or to side-exit every FP op to the interpreter's proven softfloat. Until E4-T15 lands, an FP op is a
  block terminator that side-exits to T1/T0.
- **Any block containing a CSR read-write** — a CSR write can change `mstatus`/`satp`/`mie`, which
  changes device-sync and translation semantics mid-stream. E4-T05 already makes every CSR op a block
  *terminator*; the JIT inherits that. CSR access is handled by side-exit (E4-T12), not inline codegen.
- **`ecall`/`ebreak`/`wfi`/`sfence.vma`/`fence`/`fence.i`** — terminators that side-exit; the runtime
  owns SBI, trap delivery, the idle path, and TLB/cache coherence.
- **Cold code, code executed <64 times, and self-modifying hot regions** that thrash invalidation
  (§5) — these stay in T1/T0; a page whose blocks are repeatedly killed by SMC (E4-T17) is pinned to
  the interpreter to avoid compile churn.

---

## 2. Translation-unit shape

**Decision: the translation unit is exactly the E4-T05 `DecodedBlock` — a physical-address basic
block.** The JIT reuses E4-T05's block-discovery front end verbatim (`dispatch.rs`
`is_terminator` + the page-bound walk); it does **not** re-discover blocks.

Established constraints (already enforced and debug-asserted by `dispatch.rs`, reused unchanged):

- ends at the first terminator (branch/`jal`/`jalr`/`ecall`/`ebreak`/`xret`/`wfi`/fence/CSR-write);
- never crosses a **physical** page boundary (`total_len ≤ PAGE = 4096`);
- ≤ `MAX_BLOCK_OPS = 128` ops — which is *also* the interrupt-latency bound (§3);
- keyed by **physical** PC (paging remaps reuse the block — TCG `tb_phys_hash` style).

**Superblocks / traces are a deferred, measured experiment (E4-T18 chaining first, then an explicit
trace spike), not folklore.** The page-bound + 128-op + terminator constraints already cap a block;
extending across them means (a) crossing page boundaries — which breaks the physical-keying
invalidation story (§5) and requires per-page guards — and (b) growing the interrupt-latency window
past 128 ops, which would regress the E4-T05 batching guarantee. The cheaper win is **block chaining
(E4-T18)**: link a block's fall-through / taken-branch successor directly to the next compiled block's
entry *through a mutable funcref table / link slot* (the browser forbids code patching after
instantiation — §7), so the dispatch loop is bypassed on the hot edge without merging blocks. Chaining
captures most of the trace payoff while keeping blocks single-page and ≤128 ops. A true trace
(superblock with an embedded side-exit tree) is opened only if E4-T18 chaining leaves measurable
dispatch overhead on the ledger.

---

## 3. The ABI between the dispatch loop and generated code

This is the section E4-T09…T20 implement without amending. It is specified precisely enough to
write their function signatures.

### 3.1 CPU state lives in shared linear memory, at fixed offsets

Generated WASM functions do **not** close over the Rust `Hart` struct (they cannot — they are a
separately-instantiated module). They read/write guest architectural state through **fixed byte
offsets into the shared WASM linear memory** (`WebAssembly.Memory`, the same one the guest RAM lives
in, so the JIT's inline TLB fast-path — E4-T11 — can address guest RAM without a bounds re-check
crossing). A `CpuState` header is reserved at a fixed base `CPU_STATE_BASE` (below guest DRAM):

| Offset (from `CPU_STATE_BASE`) | Bytes | Field | Source of truth |
|---:|---:|---|---|
| `+0x000` | 32×8 = 256 | `x[0..32]` guest integer registers (`x[0]` reads as 0, never written back) | `hart::regs::XRegs` |
| `+0x100` | 8 | `pc` | `Hart` |
| `+0x108` | 32×8 = 256 | `f[0..32]` FP registers (NaN-boxed, FLEN=64) | `hart::fregs::FRegs` |
| `+0x208` | 8 | `fcsr` | `csr` |
| `+0x210` | 8 | `retired` (instruction retire counter — the E1-T12 clock) | run loop |
| `+0x218` | 8 | `exit_reason` (the exit-code enum, §3.3, written by the block before it returns) | ABI |
| `+0x220` | 8 | `exit_pc` (guest PC to resume at — fall-through PC, trap PC, or successor entry) | ABI |
| `+0x228` | 8 | `exit_info` (aux: trap cause / faulting vaddr / MMIO addr — see §3.3) | ABI |
| `+0x230` | 8 | `entry_pc` (guest **virtual** PC the block was entered at — written by the runtime before each `run`; the block emits every guest-visible PC relative to it, so control flow is correct under paging and when a physically-keyed block is reused from a new VA — E4-T16) | ABI |
| `+0x238` | 8 | `block_budget` (ops remaining before a mandatory boundary return, §3.4) | ABI |
| `+0x240` | … | mirror of the mutable CSRs a compiled block may *read* (`mstatus`, `satp`, `sstatus.SIE`, `mie`/`mip` snapshot) — **read-only to generated code**; any *write* is a terminator side-exit | `csr` |

Offsets are frozen here. The exact struct is emitted by E4-T07 from a single `#[repr(C)]` Rust
definition so host and codegen never drift; a `const_assert` on each offset guards it.

### 3.2 Register mapping policy — lazy load, eager writeback at exits

- **Within a compiled block, guest x-registers live in WASM `i64` locals** (v86 does the analogous
  thing with JS locals). A register is **lazily loaded** from `CPU_STATE_BASE+8*r` into a local on
  first read in the block, and kept in the local thereafter — so a hot block touches memory for a
  register at most once to load and once to store.
- **Writeback is eager at every block exit** and, critically, **before any potentially-trapping op**
  (§4). Registers modified in the block are flushed back to the `x[]` array in linear memory before
  the block returns an exit code *or* calls a runtime import that could observe/trap. `x[0]` is never
  written back.
- `pc` is written to `exit_pc` (not the live `pc` field) on normal exits; the runtime commits it.
  This keeps a single writer of the architectural `pc`.

### 3.3 The exit-code enum (frozen)

A compiled block is a WASM function `fn(state_base: i32) -> i32` returning an **`ExitCode`**. The
return value tells the dispatch loop what happened; `exit_pc`/`exit_info` in the header carry the
operands. This enum is frozen — E4-T12/T18 build on exactly these variants:

```
enum ExitCode (i32 return) {
  0  FALLTHROUGH   // block ran to its end; resume at exit_pc (next block entry). Hot path.
  1  BRANCH_TAKEN  // conditional/again resume at exit_pc; used by chaining (E4-T18) to pick edge
  2  TRAP          // a guest trap must be delivered: exit_info = cause, exit_pc = faulting PC,
                   //   header trap-vaddr slot = mtval. Runtime runs CSR trap delivery (E4-T12).
  3  INTERRUPT_POLL// reached a block boundary; runtime must run the batched device/interrupt
                   //   sync (§3.4) and decide whether an interrupt is now pending.
  4  MMIO          // a load/store resolved to a device (not RAM): exit_info = phys addr+width,
                   //   registers already written back; runtime performs the MMIO then resumes.
  5  MMU_MISS      // the inline TLB fast-path (E4-T11) missed; runtime does the Sv39 walk +
                   //   PMP check, fills the TLB, and re-enters the block at exit_pc.
  6  CALL_INTERP   // an op this block cannot handle (FP pre-E4-T15, CSR, sfence, wfi, fence.i,
                   //   ecall/ebreak): fall back to T1/T0 at exit_pc.
  7  NOT_COMPILED  // the successor block is not yet compiled; return to dispatch to interpret/
                   //   compile it. (Distinct from FALLTHROUGH so the loop can trigger compile.)
  8  BUDGET        // block_budget hit 0 (§3.4) without a natural terminator (should be rare given
                   //   the 128-op cap, but defined so long unrolled blocks can't starve I/O).
}
```

Everything except `FALLTHROUGH`/`BRANCH_TAKEN` returns control to the runtime, which owns SBI, trap
delivery, MMIO, MMU walks, and the interrupt fabric — exactly the components the profile says
dominate and that must stay in one audited Rust place.

### 3.4 Determinism + interrupt batching — the hard constraint, preserved

This is where the JIT must not regress E4-T05's measured 2.24×. The rules:

- **The retire clock advances per guest op.** A compiled block increments the `retired` counter (and
  hence guest `mtime`, which is retire-derived — E1-T12) by **one per guest instruction it executes**,
  inline. The clock is *never* batched. This is what keeps native/wasm/JIT byte-identical
  (`boot_retired_instrs` = 2,971,174,099 is the cross-engine equality anchor, per the Level-3 doc).
- **Device/interrupt *sampling* is batched to the block boundary.** A compiled block does **not** call
  `sync_plic`/`sync_clint`/`next_interrupt` per op. It runs to its terminator, writes back state, and
  returns `INTERRUPT_POLL` (or `FALLTHROUGH` if the runtime elects to poll every K blocks). The
  runtime then runs the same batched sync E4-T05 Phase C already runs. Because every CSR write and
  every `sfence`/`fence.i`/`wfi` is a block terminator, **the only new-interrupt source that can arise
  mid-block is `mtime` crossing `mtimecmp`** — and since `mtime` still advances per-retire, the
  interrupt becomes *pending* at the identical retire index; only its *sampling* defers ≤128 ops. That
  is the E4-T05 latency bound (AC #4, verified), and the 128-op block cap (§2) is what enforces it.
- **`block_budget` (`+0x230`) defends the bound under chaining.** When blocks are chained (E4-T18) the
  loop could otherwise run many blocks without returning; the runtime seeds `block_budget` with the
  remaining op allowance and each chained block decrements it, returning `BUDGET`/`INTERRUPT_POLL` when
  it reaches 0 so the ≤128-op interrupt-latency guarantee survives chaining. E4-T24 owns timekeeping
  under JIT+worker and will assert this bound holds under the differential harness (E4-T25).

---

## 4. Side-exit / deopt strategy

**Principle: a compiled block is coherent guest state at every point it can side-exit.** The
interpreter (T1/T0) can always resume from a side-exit because the block guarantees precise state
there. There is no speculative/rollback deopt (we do not have a second optimizing tier speculating);
every exit is *precise*.

**Rules (frozen — E4-T12 implements against these):**

1. **Materialize before any potentially-trapping op.** Before emitting a load/store, an FP op (pre
   E4-T15), a division (`/0` trap), or any op that can fault, the block **writes back every dirty
   x-register and sets `exit_pc` to that instruction's guest PC.** So if the op traps, the runtime sees
   architecturally-correct registers and the exact faulting PC.
2. **Loads/stores take the inline-TLB fast path, else side-exit.** E4-T11's inline TLB check (a probe
   into a TLB array in linear memory + a permission/PMP-cached bit) either resolves to a RAM
   host-address (fast inline access) or misses. A miss returns `MMU_MISS`; a hit that lands in a device
   MMIO range returns `MMIO`; an actual permission fault returns `TRAP` with cause/`mtval` filled. The
   runtime handles the slow path in Rust (the audited `mmu::translate_cached` + `pmp::check`) and
   re-enters. This is the 24%-of-host translation bucket attacked directly.
3. **A taken interrupt is delivered at the boundary, not mid-block.** Interrupts surface only at
   `INTERRUPT_POLL` (§3.4); the runtime runs CSR trap delivery there. No compiled block delivers an
   interrupt itself.
4. **A not-yet-compiled successor returns `NOT_COMPILED`** with `exit_pc` = successor entry. The
   dispatch loop interprets it (T1) and bumps its hotness counter; when it crosses the threshold it is
   compiled and (E4-T18) the predecessor's link slot is patched — via the funcref table, since the
   browser forbids editing instantiated code — to chain directly.
5. **Registers stay coherent at the exit because writeback already happened** (rule 1 / §3.2). The
   runtime never has to reconstruct a register the block left in a WASM local: the ABI requires the
   local be flushed before the exit is taken.

Who writes back registers on a trap side-exit? **The compiled block, before the trapping op**
(rule 1). How does the runtime know the faulting PC/vaddr/cause? **From `exit_pc` / trap-vaddr slot /
`exit_info`**, written by the block before it returned `TRAP`. These are the exact questions the
adversarial verifier is told to ask (E4-T12 signature); they are answered here.

---

## 5. Translation-cache keying + the invalidation matrix

**Keying: reuse E4-T05's physical-PC key verbatim.** Compiled T2 blocks are keyed by the **same
physical `phys_start`** as their T1 `DecodedBlock`, in the same open-addressed table
(`dispatch.rs::BlockCache`). A compiled block is an *attribute* of the cache entry (an added
`compiled: Option<CompiledFn>` + `exec_count: u32`), not a second cache. **Physical keying is
non-negotiable and already proven** (`predecode_diff.rs`: byte-identical across 127 riscv-tests incl.
`fence_i`, and the dual-VA-same-phys test): a paging remap of the same physical code reuses the block
with no flush, so `sfence.vma`/`satp` writes cost **zero** block invalidation. This is the TCG
`tb_phys_hash` argument, and it is why the invalidation matrix below has "no-op" rows.

**The full invalidation matrix** (RISC-V privileged spec checked; each row states what happens to
*compiled* code, reusing E4-T05's already-built `flush` / `flush_page` / `has_code` bitmap):

| Event | Spec / mechanism | Effect on block cache | Effect on compiled T2 code | Owner |
|---|---|---|---|---|
| **`fence.i`** | Zifencei — I-fetch sees prior stores | **near-free no-op** (`BlockCache::note_fence_i`) — the page bitmap is authoritative: every code write already invalidated its page eagerly at store time, so `fence.i` drops **no** blocks and un-dirtied pages survive | **none dropped** — compiled fns for pages the guest actually wrote were already released at that store; the rest survive | **E4-T17** ✓ (`jit-runtime/tests/invalidation.rs::fence_i_is_near_free`, `fence_i_invalidates_translated_block`) — was E4-T16 full-flush |
| **Store into a code page (SMC)** | store to a phys page holding cached blocks | `flush_page(frame)` via the `has_code` bitmap (O(1) set-miss for ordinary data stores) | compiled fns for that frame dropped; the frame is *pinned to T1* on the next compile if it thrashes | **E4-T17** |
| **Device/DMA write into RAM** | all DMA reaches RAM via `bus.storeN` with a **physical** addr; E4-T05 already routes every DMA (virtio-blk/net/rng, used-ring, T_GET_ID) through the `code_write_log` | same `flush_page` path as an SMC store (the easily-missed trigger — explicitly covered) | same as SMC | E4-T17 |
| **`sfence.vma rs1,rs2`** (all forms: whole-TLB, per-vaddr, per-ASID, vaddr+ASID) | Sv39 TLB coherence only | **no block flush** — blocks are physically keyed | **none** — TLB flush only (`hart.tlb`); compiled code untouched | E4-T16 ✓ proven (`invalidation.rs`: all four forms, remap-to-diff-phys + reuse-same-phys-new-VA, `blocks_discarded == 0`) |
| **`satp` write (ASID / mode / PPN change)** | address-space switch | **no block flush** (physical keying); TLB **not** flushed by hardware — the ASID/mode tag + `finish_leaf` re-derivation keep entries safe until software fences (spec §4.2.1) | **none** | E4-T16 ✓ proven |
| **Reset / power-cycle** | `Machine::reset` | **full flush** | all compiled fns dropped | E4-T05 (done) |
| **Snapshot restore** | `restore` overwrites RAM + arch state | **full flush** | all compiled fns dropped; recompile from cold on the restored image | E4-T05 (done) + E4-T20 |
| **Eviction (budget, §7)** | code-cache over budget | LRU-drop compiled fns (keep or rebuild T1) | dropped module(s) released; block falls back to T1 until re-hot | E4-T20 |

Note the ASID subtlety the verifier is told to check: because blocks are **physically** keyed and the
**software TLB** (not the block cache) is what carries ASID, `sfence.vma` with an `rs2`/ASID operand
invalidates only TLB entries, never blocks — correct precisely because a block's identity is its
physical bytes, independent of which ASID mapped them. The `has_code` bitmap is conservative-safe:
stale membership is only ever a wasted scan, never a missed flush (proven in E4-T05 Phase B).

**PC-relativity is what makes physical keying sound for *compiled* code (E4-T16).** A block keyed by
physical bytes may be entered from *any* virtual address that maps to those bytes, so the compiled
function must not bake an absolute virtual PC. It reads the runtime-supplied `entry_pc` (§3.1,
`+0x230`) and emits every guest-visible PC — branch/jal targets, `auipc`, link values, `exit_pc`, and
the precise-fault `mepc` — as `entry_pc + (compile-time offset)`. `jalr` targets come from a register
(already virtual) and need no adjustment. Without this, a compiled block run under paging (guest
virtual PC ≠ physical key) or reused from a second VA would emit physical PCs — the exact divergence
`invalidation.rs::sfence_vma_remap_to_different_phys` / `sfence_vma_reuse_same_phys_new_va` refute.

**E4-T17 relationship (SMC).** The `has_code` page bitmap built in E4-T05 Phase B *is* the SMC-dirty
precursor. E4-T17 upgrades it (per-page dirty tracking / write-protect-style granularity) so that
compiled hot code coexists with nearby data writes without a full-frame kill; the matrix row for SMC
is the contract E4-T17 must preserve.

**E4-T17 landed (page-granular precision + near-free `fence.i`).** The `has_code` page bitmap is now
authoritative for BOTH the decoded-block cache (`BlockCache::flush_page`) and the compiled-block cache
(`CompiledBlockExecutor::invalidate_page`, which drops only compiled fns whose physical frame matches).
A code-writing store — guest, JIT-fastpath, AMO, or device/DMA — routes through the single
`SystemBus::code_write_log` choke point and is drained page-granularly, so a store into page A
invalidates only page A's blocks while page B's blocks (decoded AND compiled) survive. Because every
such write invalidates its page *eagerly at store time*, `fence.i` no longer needs a whole-cache flush:
it is downgraded to a near-free no-op-plus-stats (`BlockCache::note_fence_i`, surfaced as
`DiscoveryStats::fence_i`). This is a valid RISC-V implementation (equivalent to having no I-cache —
strictly more eager than the spec requires, never stale). Reset / snapshot-restore / cache-toggle
remain whole-cache flushes (rare, not the hot path). Proven: `jit-runtime/tests/invalidation.rs`
(`page_granular_store_invalidates_only_written_page`, `store_to_non_code_page_invalidates_nothing`,
`fence_i_is_near_free`) + the byte-identical `predecode_smc_diff.rs`.

---

## 6. Worker execution model (sketch)

Per E4-T22/T23/T24. The JIT runs on a **dedicated CPU worker** with the guest RAM + `CpuState` header
in a **`SharedArrayBuffer`** (COOP/COEP required, E4-T22). What stays where:

- **CPU worker:** the dispatch loop, T0/T1 interpretation, T2 compiled-block execution, the inline TLB,
  the retire clock. Runs uninterrupted for a quantum, then a boundary poll.
- **Main thread:** the DOM/UART/framebuffer, the `WebAssembly.compile` of new modules (off the hot
  loop, E4-T21 background queue), device backends. MMIO from a compiled block (`MMIO` exit) is proxied
  to the device thread (E4-T23) via `Atomics.wait`/`notify` on a ring in the SAB.
- **Timekeeping (E4-T24):** `mtime` stays retire-derived on the worker (deterministic); wall-clock
  `performance.now()` reads (the 7.1% browser tax) are minimized by reading once per boundary poll,
  not per op — the JIT's structural answer to the `__wbg_now` line item.

---

## 7. Memory / module budgets (the browser is the hard target)

**Decision: emit real WASM bytecode at runtime and instantiate it with `WebAssembly.compile` /
`new WebAssembly.Module` — one module per *batch* of blocks, not per block.** (E4-T07 emitter,
E4-T19 batching.) Rationale and the rejected alternatives:

- **Rejected: an interpreter-of-uops / threaded-code in WASM.** That is essentially what T1 already is;
  it does not remove the dispatch/translate per-op cost that is the JIT's whole point (§1). No new tier
  earns its keep unless it emits straight-line native WASM for the block body.
- **Rejected: one WASM module per block.** Each `WebAssembly.Module` carries fixed overhead and each
  instantiation is a boundary crossing; a gcc-sized working set (thousands of hot blocks) would mean
  thousands of live Modules — over browser instance/Module practical limits and murder on GC. **Batch
  ~64 blocks per module** (E4-T19), one export per block, dispatched via a **funcref table** (the
  browser forbids patching instantiated code, so chaining and dispatch both go through the mutable
  `WebAssembly.Table` + link slots in the SAB — §2, §4.4).

**Concrete budgets (E4-T20; each with a stated fallback):**

| Budget | Value | Fallback when exceeded |
|---|---|---|
| Max translated-code bytes (code cache) | **32 MiB** of emitted WASM | LRU-evict whole modules (§5 eviction row); evicted blocks fall back to T1 |
| Blocks per module | **~64** | — (the batching unit; smaller only raises Module count) |
| Max live Modules / Instances per tab | **256** (≈16 k blocks at 64/module) | over cap → evict LRU module before compiling a new batch |
| Compile queue depth | **32** pending batches | queue full → skip promotion this pass, block stays T1 (no starvation: it stays correct + fast-ish) |
| JIT-attributable pause target | **< 5 ms** per main-thread stall | compile is off the hot loop (worker requests, main-thread compiles async, E4-T21); a compile that would exceed budget is chunked or deferred |

**Budget arithmetic for a gcc working set (adversarial #4).** gcc's hot working set is on the order of
low-thousands of basic blocks. At 64 blocks/module that is ~40–120 modules — well under the 256 cap —
and, at a conservative few-hundred bytes of emitted WASM per block, low-single-digit MiB — well under
the 32 MiB code cache. So a gcc-sized set **fits without eviction**; eviction is the defined fallback
for pathological or multi-workload sessions, not the common case. (gcc's own ledger row is still
*deferred* per the Level-3 baseline — the arithmetic here is bounded by block counts, not a measured
gcc run, and is flagged as a hypothesis to confirm when E4-T04's gcc bench lands.)

**E4-T19 amendment (batching as built).** The compile queue is drained in GROUPS: newly-hot blocks
accumulate, then union into connected components of the observed same-page static-edge graph, each
component compiled as ONE module of K functions (`run0..runK-1`, one shared `mem`). **K defaults to 64**
(the §7 number; UA-probed in the browser, one override via `set_batch_size`, which doubles as the
batched-vs-unbatched A/B flag at `K=1`). **Within-batch static edges lower to a direct `call`**
(no `call_indirect`, no dispatch bounce); cross-batch / dynamic edges use E4-T18's funcref-table link
slots. The direct call is gated by a one-byte **`chain_enabled` header flag (ABI `+0x250`)**: the
native executor leaves it 0 (plain return per block — the E4-T18 behavior, so the retire-clock /
interrupt-batching determinism of §3.4 is byte-identical), and the in-wasm chaining path (`=1`) is the
browser form (determinism validated by the E4-T25 differential harness). **Partial-batch invalidation
retires the WHOLE batch atomically** (`invalidate_page` → drop the Module/Instance), so no stale intra-
batch direct call can run dead bytes; survivors fall back to T1 and recompile. A per-Module/Instance
registry (count + estimated bytes) is the raw material for the E4-T20 budgets. Cross-browser
compile/instantiate/instance-cliff costs are measured by `bench/module-costs/` (harness committed;
live capture is dev debt — the mac reaps long browser runs).

**Native backend may differ.** Natively (the CLI) we are not bound by `WebAssembly.compile` caps and
could use Cranelift or direct machine-code emission; but to keep **one** codegen path audited against
the differential harness (E4-T25), the default is to run the *same* emitted-WASM through a native WASM
engine, and a native-only backend is an optimization opened only if the native ledger demands it.

---

## 8. Falsifiability — how each decision is measured (adversarial verification)

The design is engineered to be *refuted by the ledger*, not defended by argument:

- **Tiering / threshold (§1):** E4-T08 sweeps `N` and records CoreMark it/s + boot wall vs
  `level3-interpreter` in `bench/ledger.json`. If `N=64` is not within noise of the swept optimum, the
  number here is wrong and gets changed — the doc says it is a starting point.
- **Block-shape / no-superblock (§2):** E4-T18 chaining must show the dispatch-loop share (native
  ~9.5% `run_traced_inner` self, per hotspots) shrink on the profile; if chaining leaves ≥2× on the
  table, the trace-spike is opened. Falsifiable against a re-capture.
- **Batching preserved (§3.4):** the E4-T25 differential/lockstep harness asserts JIT retire traces are
  **byte-identical** to the interpreter (the `boot_retired_instrs` = 2,971,174,099 anchor) and the
  mid-block `mtimecmp` latency ≤128 test (E4-T05 AC #4) still passes under JIT. A divergence refutes the
  ABI. E4-T26 re-runs the compliance suite under JIT.
- **Invalidation matrix (§5):** each row has a dedicated test (fence.i full-flush, SMC/DMA `flush_page`,
  dual-VA-same-phys no-flush) — the E4-T05 `predecode_smc_diff` / `predecode_diff` gates are extended to
  the compiled tier by E4-T16/T17.
- **Budgets (§7):** E4-T20/T27 add a perf-regression CI gate; exceeding the 5 ms pause target or the
  32 MiB cache is a CI failure, not a silent slowdown.
- **The 10× capstone (§0):** E4-T28 is the single falsifiable endpoint — CoreMark it/s ≥ 10 ×
  261.734 in the ledger, or the epic has not met its goal.

**Honest hypothesis-vs-measured ledger:** *measured* = the E4-T02 hotspot shares, the E4-T05 2.24×
native uplift, the Level-3 baseline numbers, the browser 89%/47%/7.1% split. *Hypothesis* (flagged,
each owned by a task) = the `N=64` threshold, the ~64 blocks/module and 32 MiB/256-Module budgets, the
gcc working-set arithmetic (gcc bench deferred), and that single-tier T2 suffices for 10×.

---

## 9. Highest-risk decisions (flag for a spike)

1. **Preserving E4-T05 interrupt-batching + retire-clock determinism through compiled code (§3.4)** —
   the single most load-bearing constraint; a bug here silently diverges the guest clock and regresses
   the measured 2.24×. **Spike:** stand up the E4-T25 differential harness against a *toy* two-block
   compiled loop *before* T09 full translation, to lock the retire-clock/boundary-poll contract early.
2. **Browser module budget + no-code-patching chaining (§2, §7)** — chaining through a funcref
   table/link slots (not code patching) is a browser constraint v86/TCG do not both share; getting the
   Table/SAB link protocol wrong caps throughput. **Spike:** E4-T19 cross-browser (Chrome+Firefox)
   instantiation of a 64-block batch with one hot chain edge, measuring `WebAssembly.compile` latency
   against the <5 ms pause budget.
3. **Inline TLB fast-path coherence with the audited slow path (§4.2)** — the 24% translation bucket is
   the second prize, but an inline TLB that disagrees with `mmu::translate_cached`/`pmp::check` on a
   permission corner is a security/correctness bug. **Spike:** E4-T11 fuzz the inline probe against the
   Rust walker (part of E4-T25).
4. **FP policy (§1, E4-T15)** — emitting native WASM f64 risks NaN-boxing/`fcsr` divergence from our
   softfloat; side-exiting every FP op is safe but may cap FP-heavy workloads. Flagged because it is
   the one place "fast" and "provably identical" conflict. **RESOLVED (E4-T15, 2026-08-05):
   side-exit-all.** Measured dynamic F/D share is 0.0004 % of a Linux boot (0 FP-compute ops) and
   ~0 % in the CoreMark/Dhrystone hot loops; the Amdahl upside of translating FP is < 0.001 %, far
   under the correctness risk. Every F/D op keeps its block interpreted. See `docs/jit-fp-policy.md`
   + `evidence/e4-t15/fp-share.md`.

---

## 10. Decision log (ADR-style) + open questions → tasks

| # | Decision | Grounded in | Owner |
|---|---|---|---|
| D1 | 3 tiers (interp / predecoded-block / compiled), **one** JIT tier | decode only 9%; browser module budget | E4-T09/T10 |
| D2 | Hotness threshold **N=64** block executions | v86 prior art; browser compile latency; tunable | E4-T08 |
| D3 | Translation unit = E4-T05 physical basic block; superblock deferred | reuses proven discovery; page/128-op/latency constraints | E4-T09/T18 |
| D4 | Fixed `CpuState` linear-memory layout (§3.1) + lazy-load/eager-writeback registers | separate-module ABI; inline-TLB shares the Memory | E4-T07/T09/T11 |
| D5 | Frozen 9-variant `ExitCode` enum (§3.3) | runtime owns SBI/trap/MMIO/MMU/interrupts (the 47%+24% buckets) | E4-T10/T12 |
| D6 | Retire clock per-op, device-sync batched to boundary, `block_budget` guards chaining | **E4-T05 measured 2.24×**; ≤128-op latency bound | E4-T24 |
| D7 | Precise side-exits; writeback before any trapping op | precise-state correctness; no rollback tier | E4-T12 |
| D8 | Physical-PC keying; invalidation matrix §5; SMC via `has_code` bitmap | E4-T05 `predecode_diff` byte-identity; TCG tb_phys_hash | E4-T16/T17 |
| D9 | Emit real WASM, batch ~64 blocks/module, funcref-table chaining | `WebAssembly.compile` caps; no post-instantiation patching | E4-T07/T18/T19 |
| D10 | Budgets: 32 MiB cache / 256 Modules / 32 queue / <5 ms pause, LRU eviction | browser hard target; gcc-set fits | E4-T20/T21/T27 |
| D11 | CPU worker + SAB + Atomics; compile on main thread async | browser threading; `performance.now()` 7.1% tax | E4-T22/T23/T24 |

**Open questions, each assigned:**

- Exact `N` and any per-workload adaptivity → **E4-T08**.
- Inline-TLB probe shape + PMP caching in linear memory → **E4-T11**.
- FP: inline f64 vs softfloat side-exit (measured) → **E4-T15 — RESOLVED: side-exit-all (0.0004 %
  measured dynamic FP share; `docs/jit-fp-policy.md`).**
- SMC granularity beyond whole-frame `flush_page` → **E4-T17**.
- Chaining link-slot protocol through the funcref table → **E4-T18**.
- Cross-browser `WebAssembly.compile` latency vs the 5 ms budget → **E4-T19**.
- gcc working-set budget confirmation (bench deferred) → **E4-T04 (gcc row) + E4-T20**.
- Whether a second optimizing tier is ever needed → **E4-T28** (only if T2 leaves ≥2×).

---

## 11. Review

Per the AC ("doc reviewed in a separate session; review comments and resolutions committed"), this
document is submitted for a separate-session adversarial review whose mandate is §8 of the E4-T06
ticket: attempt to write the E4-T12 / T17 / T18 function signatures from §3–§5 alone, check the §5
matrix against the privileged spec, verify every cited number exists in `evidence/`, and stress the §7
budget arithmetic. Review comments + resolutions are appended here on completion.

*(Review log: pending separate-session review.)*

## Cross-reference

- Profiling: `docs/perf/flamegraphs.md`, `evidence/e4-t02/hotspots-summary.md`,
  `evidence/e4-t02/browser-capture.md`.
- Baselines / ledger: `docs/perf/level3-interpreter-baseline.md`, `bench/ledger.json`,
  `evidence/e4-t05/uplift.md`.
- Block cache (the skeleton the JIT inhabits): `crates/core/src/dispatch.rs`, E4-T05 ticket.
- Execution loop / state: `crates/core/src/lib.rs` (`run_traced_inner`, `RunOutcome`),
  `crates/core/src/hart/`.
- Prior art: v86 JIT (basic-block→wasm-module, funcref dispatch, interpreter fallback), QEMU TCG
  (physically-keyed TBs, block chaining, `tb_flush` on fence.i-equivalents, icount), CheerpX (tiered
  execution + SMC, per public talks).
- ADR house style: `docs/adr/0002-sbi-firmware.md`.
</content>
