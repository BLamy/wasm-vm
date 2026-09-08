---
id: E5-T26m
epic: 5
title: Retain browser inline-cache authority across interrupt-only status changes
priority: 526.598
status: in-progress
depends_on: [E4-T11, E5-T22g, E5-T26l]
estimate: S
risk: high
capstone: false
---

## Goal

Avoid clearing browser inline TLB and published static/dynamic links when only
the four interrupt-enable/history bits of mstatus change. This is a bounded
execution-cache prerequisite for F, not a claim that it caused the recorded
latency, improves wall time by any amount, or satisfies F's two-second deadline.

## Boundary

Own only the mstatus projection in BrowserExecutor's InlineTlbContext and its
deterministic proof. Exclude exactly bits1(SIE),3(MIE),5(SPIE),7(MPIE) from cached
equality; keep every other bit, satp, current privilege, PMP revision, TLB flush
count and trigger-idle state. Continue synchronizing context before every
compiled invocation and clearing inline words plus dynamic/static publication
on a genuine mismatch. Do not change architectural mstatus, interrupt/device
sampling, chained-execution budgets, translator instruction support, guest
image/helper, clocks, scheduling, snapshot format or F's harness/deadline.

## Acceptance criteria

- A private real-WASM cache test flips each of64 status bits individually from
  established state: exactly1/3/5/7 preserve cached words and report no mismatch;
  every other bit clears them and reports mismatch. Architectural status remains
  intact. No new production observation or tuning API is introduced.
- Actual WebAssembly BrowserExecutor caller/target execution retains published
  links across the four excluded-bit-only changes. Existing inline memory and
  static/dynamic link paths remain covered. A retained-bit negative control
  (SUM) clears publication and prevents the stale target from executing within
  that invocation. Test actual target side effects and link-hit/live counters,
  not a mock implementation of the context predicate.
- Real Machine execution with pending M-mode MTIP and S-mode delegated STIP
  runs a guest CSR terminator enabling the corresponding xIE bit. At the next
  bounded work slot, interrupt handler PC/cause/EPC and IE/PIE state match the
  interpreter oracle; the already-compiled next target's side effect is absent.
  Cached reuse must not become an interrupt polling predicate.
- Existing actual-WASM memory/PMP/execute-remap/link invalidation regressions
  pass, along with affected format/clippy/native interrupt/privilege tests and
  the affected wasm32 build. Retain deterministic guest/state comparisons and
  exact source/gate evidence, one final scrubbed-environment pristine clone,
  and a fresh independent critic verdict scoped to this boundary.
- Build the local demo, expose this task through the roadmap task manifest and
  record126 passed/0 failed with zero non-favicon errors and a screenshot.
  No production-only outage release. F's fresh cold checkpoint and actual
  two-second acceptance remain separate work after this prerequisite.

## Verification command

make verify-E5-T26m

The semantic core is the real Node WebAssembly harness:
`wasm-pack test --node crates/wasm --lib --test jit_browser_parity -- --nocapture`.
The make target groups that with the scoped source/native/target regression
checks; local demo and one final clean-clone recordings are retained separately.

## Adversarial verification

Predict mask equality and actual compiled-target execution before checking the
record. Exercise every status bit independently, including combined irrelevant
and relevant changes. Carry existing SUM/MXR/MPRV/MPP, mode, satp/PMP, SFENCE and
trigger authority tests when unchanged. Cover both pending-interrupt modes and
true guest CSR enablement, not only host mutation. Invent one bounded combination
of a masked and a retained bit, and once sabotage the mask by adding SUM: the
exact-mask and real-link negative controls must fail. Restore the real source
before the final frozen run. No rr, other machine, WebKit, latency waiver,
arbitrary performance claim or unrelated emulator optimization belongs here.

## Verification log

### 2026-09-08 — coordinator — activate scoped prerequisite

F's unprofiled observer result4.3622s and print-only counterfactual4.10187s remain
failed. The separate interpreted-PC/JIT observation records repeated engine
entries and low dynamic-hit counts, but cannot assign a cause. Direct source
inspection finds full mstatus equality clears inline TLB and link state even
for interrupt-only changes. Fresh Daybreak review permits only the four-bit
projection under the conditions in
`evidence/e5-t26f/inline-context-candidate/critic-preflight.md` and supplies the
three falsifiable test cases above. F is blocked on this named prerequisite;
one active task remains. No code or performance claim precedes the worker proof.
