---
id: E5-T26m
epic: 5
title: Retain browser inline-cache authority across interrupt-only status changes
priority: 526.598
status: implemented
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

### 2026-09-08 — worker submission — frozen runtime and promoted attack

Luna implements the exact four-bit projection; Main integrates/tests and freezes
runtime at `deb595c78aa96cbcbc674fa3cbe30a7e53dd522f`. Daybreak's independently
authored combined ignored+SUM test is promoted without runtime changes at final
head `7f007bd28e0d8a73ed46d03c7f9bd803449157ee`. Runtime source SHA256
`5a83c4269e73ba6cb8e66c27c8f2a4fc797e7e55b5abbd37f566e510f5ba24df`;
final parity-test SHA256
`73fdbf1c2b5e730e932910e8af4d05be0dd8d275ac63c698854f0eb4308e5bac`.

`make verify-E5-T26m` passes29 native tests, scoped format/clippy, both wasm32
builds and46 actual-WASM tests at runtime freeze. After the test-only promotion,
`wasm-pack test --node crates/wasm --lib --test jit_browser_parity -- --nocapture`
passes47 tests. The unchanged long E4-T33 churn test remains ignored, not claimed.
One final pristine proof,
`bash evidence/e5-t26m/run-final-clone.sh 7f007bd28e0d8a73ed46d03c7f9bd803449157ee`,
passes the full scoped make target (29 native+47 WASM) from a no-local, no-alternate
clone, fresh target and scrubbed compiler/test environment. Checkout is clean
before/after; retained at `/private/tmp/e5-t26m-final.fpoX9HG8/repo`.

Raw records: `evidence/e5-t26m/main-gates/08-frozen-runtime.log`,
`09-promoted-harness.log`, `10-final-clone.log`. Integration records02/03 show
the old comparison failing and exact mask passing; records05/06 show the one
unsafe SUM mask failing both private and actual dynamic-link controls. Correct
source was restored before freeze. These runs demonstrate actual generated
target reuse, retained authority invalidation, and M/S pending-interrupt state
matching the interpreter before the compiled successor executes.

`E5_DEMO_TASK=E5-T26m E5_DEMO_OUT=evidence/e5-t26m/demo-deb595c7 node tools/verify/e5-t18e-demo-smoke.mjs`
passes126/0 with empty console/page/HTTP errors and a viewed screenshot showing
this task. Built WASM SHA256
`18e53caa2e160819d16a6e0bf376530d45234e28f315c89b5042c48b1d791cc4`.
Independent predictions, source review and promoted attack are in
`evidence/e5-t26m/verifier/`. Final verdict belongs to that fresh critic. No
speedup, F timing/restore acceptance, deployment or Epic5 completion is claimed.

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
