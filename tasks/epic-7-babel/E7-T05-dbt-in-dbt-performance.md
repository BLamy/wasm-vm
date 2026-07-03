---
id: E7-T05
epic: 7
title: DBT-in-DBT performance — box64 output under our JIT, i-cache coherence, tuning
priority: 705
status: pending
depends_on: [E7-T03]
estimate: L
capstone: false
---

## Goal
Make box64 *usable*, not just correct. box64 emits riscv64 code at runtime; that code becomes
hot guest code our Level 4 JIT then translates to WASM — a dynamic binary translator inside a
dynamic binary translator. This task measures and tunes that stack so x86_64 apps run at
interactive speed, and proves the **FENCE.I / i-cache coherence** path (E4-T16) holds when the
self-modifying code is box64's dynarec output.

## Context
box64 writes translated blocks into executable pages and issues fence.i; our JIT must observe
those writes and (re)translate, exactly the SMC path from E4-T16/T17. Measure the multiplier:
x86_64 CoreMark/Dhrystone under box64 vs the same benchmark native-riscv64, both under our JIT.
Investigate the big levers: box64 dynarec settings (`BOX64_DYNAREC_BIGBLOCK`,
`BOX64_DYNAREC_STRONGMEM`, callret), the interaction of box64's block cache with ours (avoid
pathological re-translation churn), and whether box64's generated code triggers excessive JIT
invalidations. Record honest numbers — box64-on-emulation will be slower than native x86, and
the goal is "interactive for real apps", not parity.

## Deliverables
- A benchmark ledger: x86_64 CoreMark/Dhrystone under box64+our-JIT, vs riscv64-native+JIT,
  vs interpreter — with the multipliers and the box64 settings used.
- Documented box64 tuning defaults for the guest, with the rationale and measurements.
- Any JIT-side fixes for box64's SMC pattern (excess invalidation, cache thrash), each with a
  regression test in the E4 area.

## Acceptance criteria
- [ ] An x86_64 CLI workload (e.g. x86_64 `sha256sum` over 100 MB, or x86_64 CoreMark) runs
      under box64 with no correctness divergence and a recorded speed within a documented
      factor of native-riscv64 — number stated, not hand-waved.
- [ ] No i-cache-coherence bugs: box64's runtime code generation is picked up by our JIT
      (a scripted stress run that repeatedly JITs fresh box64 blocks shows zero stale-code
      executions under the E4-T25 lockstep check).

## Adversarial verification
Force the SMC edge: run an x86_64 workload that makes box64 regenerate many blocks (varied
code paths) while the E4-T25 lockstep interpreter-vs-JIT check runs — any divergence traced to
stale translated code refutes coherence. Disable box64's bigblock and re-measure to confirm the
tuning claims are causal, not noise. Compare guest self-reported timing against host wall clock
(E4-T24 rule) so no clock skew inflates the multiplier.

## Verification log
(empty)
