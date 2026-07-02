---
id: E6-T09
epic: 6
title: SMP stress and verification suite — locktorture, selftests, scaling
priority: 609
status: pending
depends_on: [E6-T06, E6-T07, E6-T08]
estimate: M
capstone: false
---

## Goal
A repeatable, CI-runnable SMP verification suite using the kernel's own torture machinery
plus scaling benchmarks — the standing proof that parallel harts stay correct as the JIT,
devices, and GPU work of this epic churn underneath them.

## Context
Parallel-hart bugs are probabilistic; one green boot proves nothing. The kernel ships
purpose-built weapons: `locktorture` (CONFIG_LOCK_TORTURE_TEST=m; spin_lock, mutex,
rwsem writer/reader torture) and `rcutorture` (CONFIG_RCU_TORTURE_TEST=m). Stock Alpine
kernels lack them, so this task ships a `test-kernel` image variant (our Epic 2 kernel
build pipeline) with both plus CONFIG_DEBUG_ATOMIC_SLEEP, CONFIG_PROVE_LOCKING (lockdep).
Userspace: `stress-ng` (--cpu, --switch, --futex, --vm, --fork), `sysbench threads`, and
the kernel futex selftests. Scaling is the honest metric: parallel harts that don't scale
are wasted complexity. Determinism is gone in parallel mode, so the suite is
invariant-based (torture reports zero failures; lockdep silent) rather than trace-based.

## Deliverables
- `images/test-kernel/`: config fragment + build script producing the torture-enabled
  kernel; boots on our machine and on QEMU (for cross-checking failures).
- `tools/smp_suite.sh` (guest-side) + host harness: runs locktorture (3 lock types,
  5 min each), rcutorture (10 min), futex selftests, stress-ng mix (10 min), collects
  dmesg + torture summaries into a machine-readable report.
- Scaling benchmark: aggregate CoreMark at smp=1/2/4 under JIT, recorded to
  `bench/results/` with host-machine metadata.
- Headless CI job (Chromium via Playwright) running a 15-minute reduced suite on every
  main-branch merge; full suite runbook for release gates.
- Flake policy documented: a pass requires 3 consecutive clean full runs.

## Acceptance criteria
- [ ] locktorture: `Writes: Total: N Max/Min: ... Fail: 0` for spin_lock, mutex_lock,
      rwsem at smp=4; rcutorture ends `rcu-torture: ... End of test: SUCCESS`.
- [ ] lockdep (PROVE_LOCKING) reports zero splats across the full suite.
- [ ] Kernel futex selftests: all pass at smp=4.
- [ ] Scaling: CoreMark aggregate ≥1.6x at smp=2 and ≥2.5x at smp=4 vs smp=1 (JIT,
      ≥8-core host, documented hardware).
- [ ] CI job green 3 consecutive runs; artifacts (dmesg, reports) uploaded per run.

## Adversarial verification
Run the *full* suite 5 times, not 3, on different hardware than the implementer used
(fewer host cores changes scheduling); any torture Fail>0, lockdep splat, oops, or hang
refutes. Verify the suite detects real bugs: re-introduce a known-fixed bug from
E6-T06/T07 (e.g. disable SC backoff, or make remote_sfence_vma a no-op) and confirm the
suite goes red within one run — a suite that stays green under a seeded regression is
refuted as a verification instrument. Attack the scaling claim: run CoreMark scaling on a
4-core host and confirm the acceptance thresholds are honestly conditioned on host cores
(if the doc claims ≥2.5x regardless of host, that's a refutation by measurement). Check
the CI job actually fails the build on a red suite (break it, push to a branch).

## Verification log
(empty)
