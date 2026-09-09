# BrowserExecutor inline-context critic preflight

Date: 2026-09-08  
Role: independent bounded design critic  
Source head inspected: `0c9abdac4e4dcde60eb4815b3fab0fa2d629c25b`  
Candidate patch state: not applied; no candidate file was present in this directory when inspected.

## Verdict

**CONDITIONAL GO for one new S/high-risk task.** I found no concrete semantic counterexample to
excluding exactly `mstatus.SIE` (bit 1), `MIE` (3), `SPIE` (5), and `MPIE` (7) from
`InlineTlbContext` equality. Those bits do not participate in virtual-to-physical translation,
page permission, effective data privilege, PMP authorization, generated load/store addressing, or
compiled instruction semantics. `SIE`/`MIE` are read by the core interrupt sampler; `SPIE`/`MPIE`
are trap-stack state consumed by xRET. The proposal leaves the actual `Hart` value and the core
sampler untouched.

This is not evidence that context resets caused the observed latency, not evidence of a wall-time
improvement, and not a `2x` or F-deadline claim. The cited closed guest profile and cold/quiet
probes remain negative diagnostic evidence only.

## Exact safe condition

Reuse is sound if and only if all of these remain true:

1. The projection is exactly
   `mstatus & !((1 << 1) | (1 << 3) | (1 << 5) | (1 << 7))`. No other bit is ignored.
2. `satp`, current privilege mode, PMP revision, software-TLB flush count, and trigger-idle state
   remain equality inputs.
3. `sync_context` still runs before every compiled invocation and one reported context change still
   clears all three authorization/reuse structures: inline read/write/execute TLB words, dynamic
   links, and published static-link words.
4. CSR accesses, MRET/SRET, WFI, and SFENCE.VMA remain block terminators and remain outside the
   browser translator's supported set. No compiled function can change any of the four ignored bits
   while a synchronous WebAssembly invocation is in flight.
5. Interrupt/device sampling remains in `Machine`, before JIT entry at a block boundary, and the
   existing bounded chained-execution polling/fuel rules remain unchanged. The cache context must
   never become an interrupt-poll predicate.
6. The proposal changes only comparison/projection. It must not mask the architectural `mstatus`,
   alter CSR reads/writes, alter trap entry/xRET, or pass the projected value into execution.

Under those conditions, two hart states equivalent under this projection authorize the same
cached fetch/load/store and execute-link outcomes. They may differ in whether an interrupt is
takeable, but that decision is made from the unmodified hart state outside the cache.

## Boundary audit

- **Inline cache and links.** `InlineTlbContext` currently holds full `mstatus` alongside `satp`,
  mode, PMP revision, flush count, and trigger state
  (`crates/wasm/src/jit_browser.rs:123-140,177-209`). A context change clears inline words and then
  resets dynamic and static published links before invocation
  (`crates/wasm/src/jit_browser.rs:1915-1939`). The proposed projection therefore has one coherent
  effect: retain all three structures only for an equivalent authorization context.
- **Translation and memory authorization.** Effective data privilege depends on MPRV and MPP, not
  the four candidate bits (`crates/core/src/csr.rs:378-390`). Leaf permission depends on effective
  privilege, SUM, MXR, and PTE bits (`crates/core/src/mmu.rs:248-292`). The refill path performs the
  real translated/PMP-checked access before publishing a RAM mapping
  (`crates/core/src/hart/mod.rs:943-1045`; `crates/wasm/src/jit_browser.rs:750-805`). Retaining all
  other `mstatus` bits is therefore necessary and sufficient for this part of the key.
- **Fetch and link authority.** Fetch translation uses the true current mode (never MPRV), then PMP
  execute permission. EXEC-TLB entries are published only after successful target resolution and
  generated static/dynamic calls compare the current VA tag and expected host page. Mode, `satp`,
  PMP revision, and flush count remain in the context, so the proposal does not weaken this guard.
- **Compiled instruction surface.** The translator supports integer/M/A operations, memory,
  ECALL/EBREAK, and fences; it does not support CSR instructions, MRET, SRET, WFI, or SFENCE.VMA
  (`crates/jit-translate/src/lib.rs:1860-1940`). Core decoding makes every CSR/xRET/WFI/SFENCE a
  terminator (`crates/core/src/dispatch.rs:41-76`). A compiled ECALL/EBREAK or memory fault returns
  to core before trap delivery, so trap entry observes and updates the real IE/PIE bits.
- **Interrupt sampling and batching.** `next_interrupt` reads only MIE/SIE from this four-bit set
  (`crates/core/src/csr.rs:632-660`). `Machine` synchronizes devices and samples it before attempting
  JIT execution (`crates/core/src/lib.rs:4637-4655,4818-4853`). Chained execution is already bounded
  and rechecks pending interrupts between host-visible links
  (`crates/core/src/lib.rs:4228-4239,4329-4349`). Browser in-module chains have their existing
  128-instruction fuel bound. Clearing cache/link state is not, and cannot be relied on as, the
  interrupt barrier: same-module direct edges are not cleared by `StaticLinkCache::clear_words`.
- **xRET and PIE.** MPIE/SPIE affect later MRET/SRET, but those instructions are interpreted. MRET
  also clears MPP and may change mode/MPRV; SRET clears SPP and may change mode/MPRV. Those retained
  context fields force the appropriate reset after xRET even though IE/PIE alone are projected out.

## Concrete counterexample boundary

There is no counterexample for the exact four-bit exclusion under the safe condition above. There
is an immediate stale-authorization counterexample if the exclusion is widened:

- In S mode, fill a read entry for a user page while `SUM=1`, then clear `SUM`. If SUM were ignored,
  the generated raw load could reuse the entry even though `perm_ok` now requires a page fault.
- Likewise, fill a read entry for an execute-only page while `MXR=1`, then clear `MXR`; or fill under
  M-mode `MPRV=1, MPP=S`, then clear MPRV. Ignoring any of those bits can redirect or authorize a raw
  memory access without returning to the MMU/PMP authority.

These are the useful sabotage mutations. A test suite that still passes after adding SUM, MXR,
MPRV, or MPP to the ignored mask is insufficient.

## Smallest authoritative test charter

Put the focused tests in the existing real-WASM harness
`crates/wasm/tests/jit_browser_parity.rs`; do not substitute a mock cache or native executor.

1. **`inline_tlb_context_masks_exactly_interrupt_stack_bits`** (private `jit_browser.rs` lib test).
   Seed a real `InlineTlbCache` word, establish a baseline context, and flip every `mstatus` bit
   individually. Bits 1, 3, 5, and 7 must report no context change and preserve the word; every
   other bit must report a change and clear it. This pins the exact complement without adding a
   production test hook.
2. **`browser_inline_context_retains_links_across_interrupt_stack_bits`.** Use the existing
   production `BrowserExecutor::new_inline` fixtures for two table-driven legs: a cross-batch static
   edge and a dynamic-JALR target. Establish the context, publish each target/EXEC authority, and
   prove one generated call. Toggle bits 1, 3, 5, and 7 one at a time between invocations. After
   every toggle, require the target to execute; for the dynamic leg also require its hit counter to
   advance and live-entry count to remain one. Then republish, toggle one retained bit (SUM is the
   smallest negative control), and require neither generated target to execute; the dynamic live
   entry count must become zero. This directly observes both production WebAssembly link branches;
   the private test separately pins the inline-word side of the shared context predicate.
3. **`browser_machine_xie_enable_preempts_reused_inline_target`.** Use a real `Machine` with a
   preinstalled production browser executor and a compiled target carrying a visible register
   side effect. With a timer interrupt pending and globally masked, execute a guest CSR terminator
   that enables xIE. On the very next bounded work slot, require the interrupt handler PC/cause/EPC
   and IE/PIE stack values to match the interpreter oracle, and require the compiled target's side
   effect to remain absent. Run two table-driven legs: M-mode MIE/MTIP and S-mode SIE/delegated STIP.
   This proves sampling still occurs before a retained cache/link can execute.
4. **Sabotage once.** Temporarily add SUM to the ignored mask. Tests 1 and 2 must fail. Revert the
   mutation before recording evidence. No timing sabotage is required.

One deterministic semantic acceptance command is enough:

```sh
wasm-pack test --node crates/wasm --lib --test jit_browser_parity -- --nocapture
```

The activated high-risk task still owes the repository's normal frozen-head format/clippy/test and
browser-impact gates, including the single built-page Playwright pass required by `AGENTS.md`.
Those gates should verify no regression; they must not be recast as evidence of speedup. No guest
boot, benchmark, or F-deadline belongs in this task's semantic acceptance criterion. A cold clone
may remain risk-tier submission evidence, but it is not the behavioral acceptance criterion.

## Activation scope for E5-T26m

- Size/risk: `S`, `high` (small diff, cached authorization boundary).
- Product change: introduce one named four-bit interrupt-stack mask/projection for
  `InlineTlbContext.mstatus`; preserve every other context input and all hart/sampler code.
- Permanent proof: one private real-wasm cache test, two public-path real-WASM tests, and one
  recorded SUM sabotage failure.
- Claim allowed: toggling only SIE/MIE/SPIE/MPIE no longer clears browser inline TLB/static/dynamic
  reuse, while pending interrupts still preempt compiled execution at the established boundary.
- Claims forbidden: causal attribution of the existing latency profile, any wall-time uplift,
  `2x`, or satisfaction of the unchanged F deadline.

## Evidence limitation

The raw profile at
`evidence/e5-t26f/single-process-guest-profile-001e8086/record/failure-post-restore-interaction-checks.json`
reports a failed post-restore interaction run and profiling observations. It can motivate this
candidate, but it does not isolate mstatus-driven resets and cannot prove the proposed change will
improve timing. This preflight is source reasoning and a falsifiable test design only; no build,
runtime, browser, benchmark, clone, task, or git operation was performed.
