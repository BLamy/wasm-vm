---
id: E8-T05
epic: 8
title: Replay engine — bit-identical re-execution from a snapshot + recorded trace
priority: 805
status: cancelled
depends_on: [E8-T04]
estimate: L
capstone: false
---

> **CANCELLED 2026-07-06** (Brett's direction): Epic 8 "Chrome in Chrome" is cancelled as a
> goal. Superseded in spirit by **Epic 3.5 — OCI Workloads in the Browser**
> (`tasks/epic-3.5-oci-workloads/`): real container workloads are the payoff instead of a
> nested browser. The Layer-G record/replay ideas in E8-T03..T09 may be resurrected as their
> own epic later if VM time-travel becomes a goal again.

## Goal
The **replay** half: given a starting snapshot and an E8-T04 trace, re-execute the guest so that
it reaches **bit-identical machine state** at every point of the original run, re-injecting each
recorded input at exactly its recorded delivery point. This is the mechanism that makes any
recorded session — including a stock-Chromium browsing session — reproducible on demand.

## Context
Replay drives the machine from the deterministic clock: at each retired-instruction/hart-order
key that has a recorded input, inject it; between them, execute purely (all E8-T03 sources are
clamped or come from the trace). It must work under the JIT (E4) — the lockstep interpreter-vs-JIT
harness (E4-T25) already proves translated runs are deterministic, so replay must hold under both
tiers. The strongest correctness check is *self-consistency*: record a run, replay it, and assert
the replay's state trajectory matches the recording's at checkpoints (E6-T16 hashes). Handle
trace exhaustion (replay past the recorded end → resume live or stop, documented).

## Deliverables
- `replay/` engine consuming the E8-T04 trace + a snapshot, with input re-injection keyed to the
  deterministic clock, working under interpreter and JIT.
- A record→replay self-consistency test: state hashes at N checkpoints match between record and replay.
- Documented behavior at trace end and on any divergence (fail loudly with the divergence point).

## Acceptance criteria
- [ ] Record a fixed workload (incl. Chromium loading a page), replay it, and every checkpoint
      state hash matches the recording — bit-identical, under both interpreter and JIT.
- [ ] Replay is robust: it detects and loudly reports any divergence (injected via a deliberate
      fault) rather than silently drifting; trace-end behavior matches the documented policy.

## Adversarial verification
This is the epic's core claim — attack it hard. Record a Chromium session, replay it 5x, and
demand identical checkpoint hashes every time; a single mismatch refutes. Replay under the JIT
when the recording was made under the interpreter (and vice versa) — cross-tier replay must still
match (else the JIT is nondeterministic, refuting E4's Layer-G claim). Inject a one-bit change
into the trace and confirm replay diverges *and reports it* (silent acceptance refutes). Vary all
host-side nondeterminism during replay (clock, RNG, scheduling) and confirm zero effect on guest
state.

## Verification log
(empty)
