---
id: E8-T03
epic: 8
title: Nondeterminism inventory and clamps — freeze every source at the VM boundary
priority: 803
status: cancelled
depends_on: [E6]
estimate: L
capstone: false
---

> **CANCELLED 2026-07-06** (Brett's direction): Epic 8 "Chrome in Chrome" is cancelled as a
> goal. Superseded in spirit by **Epic 3.5 — OCI Workloads in the Browser**
> (`tasks/epic-3.5-oci-workloads/`): real container workloads are the payoff instead of a
> nested browser. The Layer-G record/replay ideas in E8-T03..T09 may be resurrected as their
> own epic later if VM time-travel becomes a goal again.

## Goal
The keystone of Layer G: a complete, audited **inventory of every source of nondeterminism**
that can reach the guest, and a clamp at the VM boundary for each one, so that guest execution
becomes a pure function of (initial state + a recorded input stream). This is what lets a *stock*
program — up to and including Chromium — be recorded and replayed without touching it.

## Context
Layer G was seeded in Level 0–1 (deterministic instruction execution) and advanced through
Levels 2/4/6. This task makes the inventory exhaustive for a full desktop+browser workload and
plugs the holes: wall-clock and monotonic time (mtime/goldfish-rtc — already virtualized, verify
they're the *only* time sources), RNG/entropy (virtio-rng, `getrandom`, RDRAND-equivalents),
timer interrupt delivery timing, device I/O completion ordering, DMA, interrupt arrival points,
uninitialized memory, and any host-value leak (E7-T11's box64 findings feed in). Each source is
either made deterministic-by-construction or routed through the record/replay boundary (E8-T04).
The RVWMO/SMP ordering (E6-T04) is a first-class entry: multi-hart interleaving must be replayable.

## Deliverables
- `docs/determinism/inventory.md`: every nondeterminism source, its clamp (deterministic vs
  recorded), and the test that proves the clamp.
- Boundary clamps/instrumentation for each source, with per-source unit tests.
- A "determinism harness": run the same workload twice from the same snapshot with the same
  input stream and assert bit-identical final state (using E6-T16 integrity hashes).

## Acceptance criteria
- [ ] Two runs of a fixed workload (including a short Chromium page-load) from the same initial
      snapshot + identical input stream produce bit-identical final machine state (hash match).
- [ ] Every entry in the inventory has a clamp and a passing test; entropy/time/RNG reads are
      demonstrably the only such sources (fuzzing the *host* clock/RNG does not change guest state
      when replaying a recorded stream).

## Adversarial verification
Try to *break* determinism: vary host wall clock, host RNG, host scheduling, and device-completion
timing between two replays of the same recorded stream — the guest final state must be identical
every time; any divergence exposes a missing inventory entry and refutes completeness. Run the
determinism harness across SMP interleavings (E6) — a race that changes results refutes. Introduce
a deliberately-unrecorded new device read and confirm the harness *catches* it (the check must be
capable of failing).

## Verification log
(empty)
