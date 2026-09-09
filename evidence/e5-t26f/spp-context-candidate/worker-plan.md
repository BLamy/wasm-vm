# E5-T26f SPP context candidate — proposal only

This is a bounded worker-sidecar source audit. It is not applied, built, run, committed,
or a task-status change. The only proposed implementation artifact is the adjacent
`candidate.patch`.

Main integration note: the original proposal had an incorrect unified-diff hunk
count and failed `git apply --check` as corrupt at line11. Main corrected only
that artifact header/start and added the missing trailing context; the proposal remains
unapplied. This formatting repair is not executed runtime evidence.

## Disposition

**DEFENSIBLE as a source-level candidate, pending fresh real-WASM/guest proof.** The
cached comparison may ignore exactly `mstatus.SPP` (bit 8) in addition to M's already
verified bits 1, 3, 5, and 7, provided that the live `hart.csr.mstatus` is never
projected into architectural execution and the existing independent fields and
terminator/boundary rules remain unchanged.

This is not a diagnosis of E5-T26f's latency and makes no speedup promise. The current
fresh browser endpoint is still a 3701.995 ms failure against the unchanged 2000 ms
cap. The separate latency diagnostic is also a failure at 3637.795 ms, with zero PCM
through 3108.295 ms and first fresh PCM at 3156.655 ms. These observations do not
identify SPP, cache invalidation, or any other cause.

The proposal means “ignore bit 8 for cache-equality invalidation only.” It does not
ignore live SPP in `Csrs::sret`, trap entry, CSR reads/writes, snapshots, traces, or
any guest-visible state. `mode`, MPP, MPRV, SUM, MXR, satp, PMP revision, TLB flush
count, trigger-idle state, and every other mstatus bit remain authoritative.

The four-bit prerequisite is carried from M's independently verified final runtime/test
head `7f007bd28e0d8a73ed46d03c7f9bd803449157ee`; this sidecar is reviewed against the
current F head `657fb5a23b411bf02832b2d10ef943b43d0becf1`. The M proof is not silently
upgraded to cover bit 8, SRET, supervisor trap entry, or the F latency endpoint.

## Exact source audit

All line references below are against current HEAD `657fb5a23b411bf02832b2d10ef943b43d0becf1`
unless stated otherwise.

### Current cache comparison and invalidation

- `crates/wasm/src/jit_browser.rs:123-145` defines `InlineTlbContext` with separate
  `satp`, projected `mstatus`, current `mode`, `pmp_revision`, TLB `flushes`, and
  `triggers_idle` fields. The inline words and link caches are not architectural state.
- `crates/wasm/src/jit_browser.rs:133-135` currently masks only bits 1, 3, 5, and 7.
  The candidate patch adds only bit 8 to this projection.
- `crates/wasm/src/jit_browser.rs:181-193` derives the context. It reads the live
  `hart.csr.mstatus`, maps the live `hart.csr.mode` separately, and retains PMP/TLB/
  trigger context separately.
- `crates/wasm/src/jit_browser.rs:203-212` clears all inline TLB words on a genuine
  context mismatch. `crates/wasm/src/jit_browser.rs:1928-1939` calls this before every
  compiled invocation and resets dynamic links plus published static-link words only
  when that mismatch occurs.
- `crates/wasm/src/jit_browser.rs:2049-2057` remains the full invalidation path for
  reset/flush/eviction-like events; this candidate does not change it.

### Why SPP is not a memory-authority input

- `crates/core/src/csr.rs:378-391` defines data effective privilege as MPRV/MPP when
  MPRV is set, otherwise the current `mode`. SPP is not consulted.
- `crates/core/src/hart/mod.rs:385-469` routes loads, stores, and AMOs through
  `Csrs::data_priv()`, `mmu::translate_cached`, and PMP checks. None uses SPP.
- `crates/core/src/hart/mod.rs:654-667` routes instruction fetch through the true
  current `csr.mode`; MPRV and SPP do not select fetch privilege.
- `crates/core/src/mmu.rs:120-154` tags the software TLB with satp ASID and paging
  mode, then `crates/core/src/mmu.rs:245-292` rechecks live leaf permissions using
  effective privilege plus SUM/MXR. SPP is absent from both the key and permission
  calculation.
- `crates/core/src/csr.rs:304-343` gates triggers on the current `mode`, trigger
  configuration, and M-mode `tcontrol.mte`; SPP is not a trigger-mode input.
- `crates/core/src/pmp.rs:87-92` and `:141-184` provide revision tracking for PMP
  mutations. The revision remains in `InlineTlbContext`; SPP does not alter it.

### Why SPP changes do not hide an interrupt or xRET boundary

- `crates/core/src/csr.rs:475-496` implements M/S trap entry. Supervisor trap entry
  writes `SPIE <- SIE`, clears SIE, sets SPP according to the *prior* mode, and then
  sets current mode to S.
- `crates/core/src/csr.rs:517-533` implements SRET. It reads SPP to choose the return
  mode, restores SIE from SPIE, sets SPIE, clears SPP, and clears MPRV when returning
  below M. Therefore SPP must remain live for SRET semantics, while the resulting
  `mode` and all relevant MPRV/status changes remain in the cache context.
- `crates/core/src/csr.rs:611-663` computes interrupt eligibility from pending/enabled
  bits, delegation, current mode, and SIE/MIE. SPP is not an interrupt-eligibility
  predicate.
- `crates/core/src/csr.rs:1035-1103` checks CSR access privilege against `self.mode`;
  SPP does not authorize CSR access.
- `crates/core/src/hart/mod.rs:1811-1839` executes MRET/SRET in the interpreter
  path and calls the live CSR state machine. SRET is not a generated fast-path op.
- `crates/core/src/dispatch.rs:41-71` classifies SRET, MRET, WFI, SFENCE.VMA,
  fences, and every CSR operation as block terminators. A CSR/xRET cannot be hidden
  in the middle of a compiled block.
- `crates/jit-translate/src/lib.rs:1861-1939` is the translator support whitelist:
  it includes Ecall/Ebreak and fences, but excludes SRET, MRET, WFI, SFENCE.VMA,
  and all CSR operations. Thus the browser compiled code cannot itself read or
  mutate SPP, MPP, MPRV, SUM, MXR, satp, or interrupt-stack state.
- `crates/core/src/lib.rs:4329-4349` re-samples interrupt state between chained
  compiled blocks and returns to dispatch before delivering a pending interrupt.
  `crates/core/src/lib.rs:4818-4835` delivers the interrupt before the next fetch;
  `crates/core/src/lib.rs:4939-4970` delivers synchronous traps through the live
  Hart trap path. The next compiled entry therefore passes through the context sync.

### Why published links remain guarded

- `crates/wasm/src/jit_browser.rs:2230-2284` publishes static edges only after the
  target is present and fills the EXEC-TLB entry from a successful target resolution.
- `crates/jit-translate/src/lib.rs:1611-1707` makes a cross-page static edge prove
  the current EXEC-TLB tag/addend and expected host page before `call_indirect`.
- `crates/jit-translate/src/lib.rs:1709-1858` applies the same current EXEC-TLB
  authority predicate to dynamic JALR links. These generated predicates do not read
  SPP; they are safe across an SPP-only change only because the live fetch authority
  inputs (`mode`, satp, PMP revision, flush count, and retained status) remain equal.
- `crates/core/src/lib.rs:4244-4254` and `:4462-4480` keep the executor boundary
  around each compiled invocation. The SPP projection must not be passed into WASM
  execution as an architectural value.

## Why the candidate is safe only as written

An SPP transition can be harmless for memory authority in two cases:

1. S-mode trap entry from S leaves current mode S and changes SPP to 1. The trap
   also changes SIE/SPIE, which M already excludes. No data/fetch/PMP/trigger
   permission changes solely because SPP records the prior S privilege.
2. SRET from S with SPP=1 returns to S and clears SPP to 0. SPP chooses the return
   path, but SRET is an interpreter terminator; after it, current mode is still S
   and the live compiled memory authority is unchanged.

When a supervisor trap comes from U, or SRET returns to U, `mode` changes. The mode
field remains compared, so the cache and links are cleared. If SPP is changed by a
guest CSR write, the CSR is itself a terminator and the live SPP still controls a
later SRET; ignoring bit 8 does not make the current S-mode memory access run as U.

This candidate is not safe if any future translator embeds SRET/CSR/WFI/SFENCE or
interrupt delivery in a compiled block, if `mode` is folded into the mstatus projection,
if context sync is skipped before compiled entry, or if a future permission rule starts
using SPP. Any of those changes reopens this audit.

## Required fresh proof, not performed here

The current M test is not enough. `crates/wasm/src/jit_browser.rs:2358-2429`
currently asserts an exact 64-bit partition whose ignored set is only `{1,3,5,7}`;
after this candidate changes the set, that old assertion is stale and must be replaced
with an expected ignored set `{1,3,5,7,8}`. Do not cite the old 64-bit assertion as
proof of the five-bit candidate.

The proof must run the real `wasm_bindgen_test` BrowserExecutor path with an interpreter
oracle, not only host-side mutation or a private predicate test.

1. **SRET-to-S, guest-generated bit-8 transition.** Construct identical oracle and
   BrowserExecutor machines in S-mode with SPP=1, SEPC targeting a compiled block,
   a prepared inline TLB entry, and a published static edge plus a dynamic-link case.
   Execute the guest SRET instruction, which must return to S mode and clear SPP.
   Then execute the target through the browser executor. Predict before observing:
   target side effects, PC, registers, RAM, SIE/SPIE/SPP, trap CSRs, and link-hit/
   live-entry state are identical to the interpreter; the SPP-only context change
   does not clear the cached authority. Assert that the live mstatus changed exactly
   per SRET and was never replaced by the projected value.

2. **SRET-to-U, mode-change negative control.** Repeat with SPP=0 and SEPC in a
   U-mode target. SRET must change mode S→U and clear SPP. Predict that the separate
   `mode` mismatch clears inline words and links before the U target, and that the
   browser oracle matches the interpreter's U-mode fetch/data permission result.
   Include a U-page/S-page permission setup where stale S-mode authority would be
   observably wrong; require no stale target side effect and the exact trap/PC if the
   U access is denied.

3. **Supervisor trap entry from S and nested delegated interrupt.** With MEDELEG/MIDELEG
   configured, execute a guest S-mode ecall or take a delegated STIP/SEIP while
   already in S. Trap entry must keep mode S, set SPP=1, update SPIE/SIE and scause/
   sepc, and then execute a compiled handler/return path. Compare every architectural
   field and target side effect against an interpreter oracle. Add a nested delegated
   interrupt while SPP is already 1 to prove the trap-stack transition does not
   accidentally treat SPP as current privilege. Also include U→S delegation as a
   negative control: mode changes and cache/link invalidation are required.

4. **Exact context matrix.** Replace the old 64-bit expectation with the five-bit
   ignored set. Flip each mstatus bit individually and in combined cases; require
   only bits 1,3,5,7,8 to preserve seeded inline words. Explicitly retain negative
   controls for MPP, MPRV, SUM, MXR, FS, TVM/TW/TSR, and every other status bit.
   Keep separate checks for satp, current mode, PMP revision, TLB flush count, and
   trigger armed/idle state.

5. **Link and authority controls.** Extend the existing real-WASM static/dynamic
   link cases at `crates/wasm/tests/jit_browser_parity.rs:1147-1226` and
   `:2011-2099` with bit 8 and guest-generated transitions. Keep the existing SUM
   negative control and mixed interrupt-plus-SUM invalidation at `:2101` onward.
   Add satp remap, execute-permission/PMP revision, SFENCE.VMA, and armed-trigger
   negative controls; each must refuse stale entry or clear publication and match
   the interpreter result.

6. **Sabotage.** Temporarily add a retained authority bit such as SUM or MPRV to
   the ignored mask. The exact-mask test and a real link/permission oracle must fail.
   Restore the candidate source before any final evidence. Sabotage must not weaken
   identity guards, clocks, budgets, polling, images, helpers, or the 2-second cap.

## Explicit proof gaps and non-claims

- No fresh SRET-to-S/U, supervisor trap-entry, nested-interrupt, or guest oracle run
  has been performed by this sidecar.
- Existing M coverage proves the four-bit projection and real interrupt preemption;
  it does not prove SPP-only SRET/trap-stack behavior.
- Existing inline link guards prove physical execute authority, not the proposed SPP
  equivalence. The new proof must bind live CSR state and target side effects.
- The browser timing failures and counters do not establish that cache invalidation is
  the latency cause. No speedup, causality, or F acceptance is claimed.
- The old 64-bit partition assertion is intentionally not carried forward unchanged;
  its expected ignored set must change if this proposal is ever implemented.
- No runtime/harness/task/HEAD edits, builds, browser runs, deployment, budget/polling
  change, identity-guard weakening, image/helper/clock change, task activation, or
  commit belongs to this proposal.

## Handoff

Main may review the adjacent patch as a five-bit projection candidate. It should remain
unapplied until the real-WASM/guest oracle tests above pass and a fresh critic verifies
that every changed line is covered. The only defensible conclusion from this audit is:
**SPP bit 8 is plausibly non-authoritative for cached memory/link equality when mode and
all listed authority state remain live and authoritative; proof and latency causality
are still open.**
