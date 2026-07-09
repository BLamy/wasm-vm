---
id: E8-T08
epic: 8
title: Record/replay hardening under Chromium's real workload — SMP, GPU, threads, long runs
priority: 808
status: cancelled
depends_on: [E8-T02, E8-T05]
estimate: L
capstone: false
---

> **CANCELLED 2026-07-06** (Brett's direction): Epic 8 "Chrome in Chrome" is cancelled as a
> goal. Superseded in spirit by **Epic 3.5 — OCI Workloads in the Browser**
> (`tasks/epic-3.5-oci-workloads/`): real container workloads are the payoff instead of a
> nested browser. The Layer-G record/replay ideas in E8-T03..T09 may be resurrected as their
> own epic later if VM time-travel becomes a goal again.

## Goal
Harden record/replay against the most hostile determinism workload available: **live stock
Chromium** — dozens of threads across SMP harts, GPU command streams, JIT'd V8 code writing
itself, high-rate network and timer events, over a multi-minute session. This is where Layer G's
theoretical determinism meets the real world and any remaining nondeterminism source is flushed out.

## Context
Chromium is adversarial by nature: race-heavy threading (SMP interleaving must be recorded and
replayed exactly — leans on E6-T04/T06 RVWMO work), GPU (virtio-gpu command timing and any
readback nondeterminism), V8's runtime code generation (FENCE.I coherence under record, E4-T16),
and sheer event volume (record overhead and trace size under pressure). Every divergence found is
either a new E8-T03 inventory entry with a clamp, or a bug in record/replay. Long-run stability
matters: an hour-long recording must replay from any keyframe without drift or resource blowup.

## Deliverables
- A Chromium record/replay stress suite: multi-minute sessions with heavy threading, GPU, and
  network, replayed and checkpoint-verified; a long-run (≥1h) stability test.
- Fixes for every divergence found, each traced to an inventory entry or an engine bug, with a
  regression test; the E8-T03 inventory updated.
- Measured record overhead and trace growth under Chromium load, within documented budgets.

## Acceptance criteria
- [ ] A multi-minute live-Chromium recording replays with bit-identical checkpoint state, under
      SMP and JIT, including GPU-heavy and network-heavy segments; zero unexplained divergences.
- [ ] A ≥1-hour recording replays from arbitrary keyframes without drift; record overhead and
      trace size stay within budget throughout.

## Adversarial verification
Record a deliberately race-heavy Chromium session (many tabs, concurrent loads) and replay 5x —
any nondeterministic divergence refutes and names an unclamped source. Force GPU stress
(WebGL/canvas page) and confirm replay reproduces frames deterministically. Run V8-heavy JS
(recompilation-triggering) and confirm FENCE.I coherence holds under record (stale-code execution
refutes). Let a recording run an hour then seek to random points — resource exhaustion, drift, or
a failed seek refutes. Vary host load during replay and confirm zero guest-state effect.

## Verification log
(empty)
