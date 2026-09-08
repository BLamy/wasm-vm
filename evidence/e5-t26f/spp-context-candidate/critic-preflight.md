# E5-T26f SPP context candidate — fresh source-only critic preflight

**VERDICT: GO, for one new S/high prerequisite task in the bounded scope below.**

This is source permission to test the one-line bit-8 candidate, not verification of that
candidate. It does not establish a latency cause, a speedup, F's two-second acceptance, or
fitness to merge. No runtime, test, harness, task, HEAD, index, build, browser, clone, or future-F
evidence was inspected or changed in this review.

Proposal-artifact correction reviewed: `candidate.patch` now uses the valid
`@@ -131,7 +131,7 @@` hunk and includes the two trailing source-context lines. Its only semantic
delta remains adding `(1 << 8)` to `INLINE_TLB_MSTATUS_CONTEXT_MASK`; the corrected header/context
does not constitute implementation or runtime evidence and does not change this verdict or require
any test rerun.

## Source-safety result

I tried to refute the claim that `mstatus.SPP` is non-authoritative for inline-TLB/link cache
equality while remaining live architectural state. I did not find a source path that makes SPP a
current memory-authority input or lets an SPP-changing operation execute invisibly inside compiled
code.

- **Live SPP remains architectural — HELD at source.** The candidate changes only the projected
  `InlineTlbContext.mstatus` comparison. `InlineTlbCache::context` reads, masks, and copies live
  `hart.csr.mstatus`; it never writes the projection back (`crates/wasm/src/jit_browser.rs:123-135,
  181-193`). The live `Csrs::sret` reads bit 8 to select S versus U, then performs the exact
  SIE/SPIE/SPP/MPRV update (`crates/core/src/csr.rs:517-533`). Guest CSR reads and trap snapshots
  therefore continue to observe the real bit.
- **SPP is not present memory authority — HELD at source.** Data privilege is current mode or
  MPRV/MPP (`crates/core/src/csr.rs:378-391`); fetch uses current mode
  (`crates/core/src/hart/mod.rs:654-667`); cached translation rechecks live effective privilege,
  SUM, MXR, and R/W/X permissions (`crates/core/src/mmu.rs:120-154,245-292`). SPP is absent from
  those decisions. The context still independently compares full `satp`, current `mode`, PMP
  revision, TLB flush count, trigger-idle state, and all unmasked mstatus bits
  (`crates/wasm/src/jit_browser.rs:123-135,181-193`).
- **SRET-to-S may reuse authority — HELD at source, proof still required.** With live SPP=1,
  SRET selects S, clears SPP, and leaves current mode S. Its SIE/SPIE changes are among the already
  verified projected bits. If MPRV was set, SRET clears that retained bit, so the candidate still
  invalidates; the intended SPP-only positive case must start with MPRV=0. SRET is a dispatch
  terminator and is absent from the translator's supported set
  (`crates/core/src/dispatch.rs:41-71`; `crates/jit-translate/src/lib.rs:1860-1939`), so the next
  compiled invocation reaches context synchronization first
  (`crates/core/src/lib.rs:4455-4476`; `crates/wasm/src/jit_browser.rs:1928-1939`).
- **SRET-to-U cannot retain S authority — HELD at source, proof still required.** With SPP=0,
  SRET sets current mode U. `InlineTlbContext.mode` is separate from projected mstatus, so an actual
  compiled entry clears inline words, dynamic links, and published static words before generated
  code runs (`crates/wasm/src/jit_browser.rs:181-212,1928-1939`). In addition, dispatch performs an
  authoritative fetch under the new mode before selecting compiled code
  (`crates/core/src/lib.rs:4244-4250`).
- **Supervisor trap and pending-interrupt state do not acquire authority from SPP — HELD at
  source.** S trap entry derives SPP from the prior live mode, updates SIE/SPIE, and sets mode S
  (`crates/core/src/csr.rs:486-495,557-566`). Interrupt eligibility uses pending/enabled bits,
  delegation, SIE/MIE, and current mode—not SPP (`crates/core/src/csr.rs:611-663`). Interrupts are
  delivered at the dispatch boundary before the next fetch/JIT attempt
  (`crates/core/src/lib.rs:4818-4859`). Nested S entry while already in S therefore records SPP=1;
  nested SRET still consumes that live value.

The candidate remains safe only while all of those boundaries remain true. Any future change that
translates SRET/CSR operations, skips context sync before compiled invocation, removes the separate
mode comparison, or makes SPP a permission input reopens this decision.

## Proposal corrections

1. **Interpreter/JIT counter equality is invalid.** The interpreter has no BrowserExecutor static
   publication, dynamic hit, live-entry, host-entry, or indirect-dispatch counters. Architectural
   state must be compared to the interpreter oracle; JIT-only cache/link counters must be asserted
   independently against predeclared JIT expectations. Do not put JIT counters into a supposedly
   equal oracle snapshot.
2. **A denied U landing fetch does not prove context clearing.** `try_jit_block` calls
   `fetch_phys` before `BrowserExecutor::execute_with_budget` (`crates/core/src/lib.rs:4244-4250`).
   A U-denied post-SRET fetch is safely rejected, but the context-sync hunk is not reached and stale
   cache metadata may remain dormant. The mode-change negative must land on a U-fetchable compiled
   block, then attempt an operation or linked successor that would be legal only under stale S
   authority. That forces the separate mode comparison and clear to execute. A denied-fetch leg may
   be retained as an architectural check, but it is not coverage for this candidate.
3. **The proposed broad authority retest is unnecessary.** New satp-remap, PMP, SFENCE.VMA,
   trigger, SUM, and every-status-bit scenarios would repeat unchanged boundaries. Carry forward
   the unchanged M verdict and existing PMP/execute-remap, SUM, SFENCE/TLB-flush, satp, and trigger
   authority results when their source and evidence digests are unchanged. Extend only the exact
   partition and real static/dynamic bit-8 cases. No old harness redesign, second cold clone, or
   replay of unrelated full tasks is demanded by this preflight.

## Minimal falsifiable acceptance for the new S/high task

One scoped real-WASM acceptance target is sufficient if it contains exactly these four proof
units and records the frozen exact head and changed-source/test digests.

### A. One exact five-bit partition

Replace the existing private 64-bit expectation at
`crates/wasm/src/jit_browser.rs:2358-2434`; do not add a duplicate matrix. For each individual bit,
seed read/write/exec sentinel words and predict that only `{1,3,5,7,8}` preserves all three.
Every other bit must report a context change and clear all three. Keep one combined
ignored-plus-retained case proving a retained authority bit dominates. Assert the complete live
architectural `mstatus` after every flip.

Refutation: any sixth ignored bit, bit 8 clearing a sentinel, any retained bit preserving one, or
any mutation of live `hart.csr.mstatus`.

### B. Guest SRET positive and mode-change negative in the real BrowserExecutor path

Use encoded guest SRET—not a host assignment to bit 8—and an interpreter-oracle machine with the
same guest words and bounded instruction budget.

- **SRET-to-S positive:** begin in S with SPP=1, SPIE chosen explicitly, MPRV=0, and prewarmed
  inline read/write/exec authority plus published static and dynamic links. Retire guest SRET to an
  S-mode compiled path. Architectural snapshots must match the interpreter for PC, privilege,
  registers, RAM, `mstatus` including SIE/SPIE/SPP, `sepc/scause/stval`, and architectural retire/
  cycle state. Independently assert that the JIT path actually ran, the target side effects
  occurred, static publication remained armed, and the dynamic case gained the predicted hit/live
  state. A guest CSR read or equivalent exact post-SRET snapshot must show SPP cleared and SIE
  restored, proving the projected value never replaced live mstatus.
- **SRET-to-U negative:** begin in S with SPP=0 and prewarm authority as S. SRET must land on a
  U-fetchable compiled block so context sync actually executes. That U block must then touch an
  S-only data page or attempt an S-only published successor that stale S authority would wrongly
  allow. Predict exact interpreter parity for mode U and the resulting precise fault/non-entry,
  zero forbidden side effect, and exact PC/trap CSRs. Independently assert that inline authority
  and both publication classes were cleared/refused before stale authority could execute.

Refutation: a host-only bit flip, failure to enter compiled code in the negative, any architectural
oracle mismatch, stale-S side effect, live SPP mismatch, or a positive case that does not
demonstrate both static and dynamic preservation.

### C. One bounded novel attack: pending delegated S interrupt across SRET

Start in an outer S handler with SPP=1, SPIE=1, SIE=0 and a delegated, enabled S interrupt already
pending. Precompile and prewarm the SRET return target. Retire guest SRET: it must return to S,
clear SPP, and restore SIE. At the immediately following dispatch boundary, the pending interrupt
must preempt the compiled successor. Before inspecting, predict `sepc=return_target`, exact
interrupt `scause`, mode S, SPP=1, SIE=0, SPIE=1, and zero successor side effect. Clear the source
through the fixture's legitimate authority, execute the nested guest SRET, and predict exact return
state followed by the compiled target side effect. Compare architectural snapshots at both stops
to the interpreter oracle; keep JIT publication/hit assertions separate.

This single sequence covers pending delivery, S-to-S trap entry while SPP was just cleared, nested
SPP=1, nested SRET, and the no-stale-successor boundary. It replaces the proposal's open-ended set
of separate trap variants. Refutation is any early successor execution, wrong `sepc/scause`, wrong
SIE/SPIE/SPP stack, wrong return mode/PC, or architectural oracle mismatch.

### D. One sabotage

Temporarily add retained SUM (bit 18) to the ignored mask. Predict that the exact partition test
fails at bit 18 and the existing generated SUM authority control at
`crates/wasm/tests/jit_browser_parity.rs:2011-2155` rejects the sabotaged behavior. Restore the
candidate and prove the final source digest before recording accepted evidence. Do not alter test
identity, budgets, clocks, helpers, images, polling, or the F latency cap.

## Carried results and final boundary

Carry unchanged results from `evidence/e5-t26m/verifier/final-verdict.md`: four-bit partition and
static/dynamic reuse, M/MTIP and delegated-S interrupt precedence, retained mode/satp/PMP/flush/
trigger authority, SUM sabotage sensitivity, and the combined ignored-bits-plus-SUM attack. Carry
the unchanged pre-existing PMP, execute-remap, SUM, and SFENCE authority tests as regression walls;
do not claim they prove bit 8. Fresh proof is required only for the five-bit partition and the
guest-generated SPP/trap transitions above.

**GO means only that `candidate.patch` is source-defensible enough to activate one bounded S/high
prerequisite task.** Until a Luna worker supplies the four proof units and a fresh Daybreak Blue
critic fails to refute them, bit 8 is unverified. Even successful verification would establish only
cache-context safety; it would not explain the observed 3701.995 ms F failure, the separate
zero-PCM-to-3108 ms interval, or any latency improvement.
