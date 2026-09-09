# E5-T26f Inline context candidate — proposal only

This is a bounded worker-sidecar proposal. It is not applied, does not change task
status, and has not been built or executed.

## Candidate

In `crates/wasm/src/jit_browser.rs`, treat exactly these four
interrupt/trap-stack bits as insignificant in cached equality:

```text
SIE  bit 1     MIE  bit 3     SPIE  bit 5     MPIE  bit 7
```

Equivalently, cache `hart.csr.mstatus & !((1 << 1) | (1 << 3) | (1 << 5) | (1 << 7))`.
The live `hart.csr.mstatus` remains unchanged. `satp`, privilege `mode`, PMP
revision, TLB flush count, and trigger-idle state remain separate cached fields.

The current context mismatch clears the inline TLB and resets static/dynamic
links. The proposed comparison therefore lets an IRQ-bit-only change preserve
compiled memory authority and links, while retaining invalidation for every
other authority boundary.

## Why these four bits are the safe candidate

The current compiled fast path checks an inline-TLB tag and performs the raw
load/store; it does not re-read CSR state on a hit. The four candidate bits do
not participate in address translation, permission checks, PMP checks, trigger
checks, executable-page authorization, or the inline-TLB physical-page mapping.
They are consumed by `Csrs::next_interrupt()` and trap entry/return. Those are
sampled by the outer `Machine` loop at block boundaries, after a JIT block
returns; they are not hidden inside the compiled memory fast path. The translator
also excludes CSR, xRET, WFI, and SFENCE instructions from JIT blocks, so a block
cannot change these bits without returning to the core boundary machinery.

This is not permission to ignore any other `mstatus` field:

| State that remains significant | Why it must invalidate |
| --- | --- |
| `MPRV`, `MPP` | Select the effective data privilege used by translation/permission checks. |
| `SUM`, `MXR` | Change supervisor access to user pages and execute-only read behavior. |
| `satp`, current `mode` | Change address-space translation and fetch/data privilege. |
| PMP revision | Changes physical access and execute authorization. |
| TLB flush count / `sfence.vma` | Invalidates cached translations. |
| Trigger-idle state | Armed load/store/execute triggers must not be bypassed by a raw hit. |
| `SPP`, `TVM`, `TW`, `TSR`, `FS`, and all other status bits | Retained conservatively; do not broaden this candidate without a separate proof. |

The main counterexample to watch is a future translator change that embeds CSR,
xRET, WFI, SFENCE, or interrupt sampling inside a compiled block. If that
happens, this mask is no longer sufficient without moving the boundary check or
adding the affected state to the context.

## Nearest actual wasm harness

Primary harness: `crates/wasm/tests/jit_browser_parity.rs`. It is
`wasm_bindgen_test`-based and runs the real browser executor with
`WebAssembly.Module`/`WebAssembly.Instance`; it already exercises
`BrowserExecutor::new_inline`, static links, dynamic links, RAM loops, PMP
permission changes, remapped executable pages, and interpreter parity.

Closest reusable tests:

- `browser_inline_static_cross_batch_link_executes_and_misses_safely`: warm a
  static edge, then observe whether the link survives or is invalidated.
- `browser_inline_dynamic_jalr_links_switch_and_unlinks`: exposes link hit/install
  behavior without adding a new instrumentation API.
- `browser_inline_static_link_refuses_after_execute_permission_change`: existing
  proof that an authorization change must invalidate a link.
- `browser_inline_tlb_matches_interpreter_for_ram_loop`: existing inline-TLB
  memory/parity path.
- `crates/wasm/tests/pmp_privilege_audit.rs` and
  `tests/shared/e5_t22f_pmp.rs`: existing privilege/PMP oracle material; keep
  these as the permission-side regression coverage rather than duplicating it.
- `crates/jit-translate/tests/inline_tlb.rs`: useful translator-level coverage,
  but not the primary harness because it is not the actual wasm/browser executor.

## Dewey’s bounded test charter

Put the focused tests in the actual real-WASM harness
`crates/wasm/tests/jit_browser_parity.rs`; the deterministic acceptance command
is `wasm-pack test --node crates/wasm --lib --test jit_browser_parity -- --nocapture`.

1. Add private `inline_tlb_context_masks_exactly_interrupt_stack_bits` coverage
   for a real `InlineTlbCache`: seed a word, establish context, flip every
   `mstatus` bit individually, and assert only bits 1, 3, 5, and 7 preserve the
   word/context. Every other bit must clear it.
2. Add public-path static and dynamic legs using the existing inline fixtures.
   Toggle each candidate bit between invocations and require the target to
   execute; the dynamic leg must also retain one live entry and advance hits.
   Republish, toggle `SUM`, and require no target execution and zero dynamic
   live entries.
3. Add the real `Machine` preemption leg with a pending timer interrupt and a
   compiled target carrying a visible side effect. Cover M-mode `MIE/MTIP` and
   S-mode delegated `SIE/STIP`; after guest xIE enable, require the interpreter
   oracle’s handler PC, cause, EPC, and IE/PIE stack values, with the compiled
   target side effect absent.
4. Sabotage once by temporarily adding `SUM` to the ignored mask. Tests 1 and 2
   must fail; revert before evidence recording.

Keep fresh executor state per matrix row. Do not add a production cache hook,
use timing as an assertion, or treat cache clearing as the interrupt barrier.

## Activation guard

The projection is sound only while `sync_context` runs before every compiled
invocation; a context change clears inline read/write/execute words, dynamic
links, and published static-link words; CSR/xRET/WFI/SFENCE remain terminators;
and device/interrupt sampling remains in `Machine` before JIT entry with the
existing bounded chain polling. Never mask architectural `mstatus`, alter CSR
semantics, or pass the projected value into execution. A future translator
change that embeds those operations requires reopening this proof.

## Evidence note

The closed profile at
`evidence/e5-t26f/single-process-guest-profile-001e8086/record/failure-post-restore-interaction-checks.json`
is a lead only: 1,316,919 engine entries, 18,090,931 JIT retires, 502,691
dynamic attempts, 20,838 hits, and 345,566 installs. Its raw SHA is
`00017cc094794aacacaa3f4ba993015f335eec11e3ac12cdadb39ec3b7db45ce`.
Those numbers do not establish causality or a 2x improvement and are not used as
acceptance evidence for this proposal.

No builds, browser runs, profiles, task edits, git operations, or verification
recordings were performed for this sidecar.
