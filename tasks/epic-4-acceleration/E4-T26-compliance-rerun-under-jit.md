---
id: E4-T26
epic: 4
title: Full riscv-tests and RISCOF compliance rerun under JIT — the correctness gate
priority: 426
status: pending
depends_on: [E4-T16, E4-T17, E4-T25]
estimate: M
capstone: false
---

## Goal
The complete Epic 1 compliance surface — all riscv-tests suites (rv64ui/um/ua/uf/ud/uc,
mi/si) and a full RISCOF architectural run — passes with the JIT forced always-on
(hotness threshold 0, chaining on, eviction churn configs included), in both the native
wasmtime-backed runtime and the browser, wired into CI as a hard gate that no future JIT
change can merge past while red.

## Context
Individual suites went green piecemeal across E4-T10..T17; this task makes the *full
matrix* an enforced invariant and closes the gaps piecemeal running allowed: signature-
based RISCOF runs compare against the Sail reference model exactly as Epic 1 did, but now
exercise translated code paths (the RISCOF test harness itself becomes hot and gets
JITted — good). Configurations that historically shake out bugs get their own matrix rows:
threshold=0 (everything translated), threshold=1 with 2-batch eviction (churn),
chaining-off (isolates chaining bugs), and lockstep-enabled spot runs. Known-acceptable
differences (if any instruction class is deliberately interpreter-only per E4-T15's
policy) must be *documented as policy*, not silently passing because the JIT never saw
them — the threshold-0 run must force even those blocks through the JIT pipeline's
fallback decision code.

## Deliverables
- CI matrix: {riscv-tests, RISCOF} × {native, browser} × {jit-default, jit-threshold0,
  jit-churn, jit-nochain}, with runtime budgets per cell and result artifacts retained.
- Any failures found: fixed (with lockstep/fuzz repro added to the E4-T25 corpus) — this
  task is not done with waivers outstanding.
- `docs/jit-architecture.md` amended with the final "what is never translated" list,
  cross-referenced to the passing threshold-0 evidence.
- One-command local reproduction: `tools/compliance.py --jit <config>`.

## Acceptance criteria
- [ ] Every cell of the matrix green; CI blocks merge on any red cell thereafter
      (branch-protection or equivalent configured and demonstrated).
- [ ] RISCOF signature comparison against Sail is byte-exact in all JIT configs.
- [ ] Zero waivers/skips introduced relative to the Epic 1 baseline test list (diff of
      test manifests committed as evidence).
- [ ] Browser cells run in Chrome and Firefox (Safari best-effort, documented).
- [ ] Total matrix runtime ≤ 90 min in CI (parallelized) — a gate nobody routes around.

## Adversarial verification
Refute the gate's coverage. Attack angles: (1) verify "forced always-on" is real:
instrument a matrix run and count interpreter-executed instructions in threshold-0 mode —
if more than the documented never-translated set ran interpreted (i.e. the JIT silently
fell back and the suite "passed" without testing translation), the gate is refuted;
(2) manifest diff: compare the exact test list against Epic 1's capstone run — any
quietly dropped test refutes; (3) re-inject one E4-T25 mutation bug and push a branch —
CI must go red and block; a green pipeline refutes the gate's wiring; (4) run the matrix
on a cold clone (no cached translations/artifacts) — cache-dependent green refutes;
(5) check the churn config actually churns (eviction counter > 1000 during the run) —
a churn cell that never evicts is testing nothing and refutes that row's claim.

## Verification log
(empty)
