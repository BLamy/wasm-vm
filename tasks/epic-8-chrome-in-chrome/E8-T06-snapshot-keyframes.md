---
id: E8-T06
epic: 8
title: Snapshot keyframes — periodic full-machine snapshots as replay seek points
priority: 806
status: cancelled
depends_on: [E8-T05]
estimate: M
capstone: false
---

> **CANCELLED 2026-07-06** (Brett's direction): Epic 8 "Chrome in Chrome" is cancelled as a
> goal. Superseded in spirit by **Epic 3.5 — OCI Workloads in the Browser**
> (`tasks/epic-3.5-oci-workloads/`): real container workloads are the payoff instead of a
> nested browser. The Layer-G record/replay ideas in E8-T03..T09 may be resurrected as their
> own epic later if VM time-travel becomes a goal again.

## Goal
Marry the E6 snapshot format to the record/replay engine so that a recording carries **periodic
full-machine snapshots as keyframes**. To reach any target time, replay seeks to the nearest
preceding keyframe (an O(1) snapshot restore) and replays the trace forward — the standard
time-travel-debugger architecture, now for a whole Linux machine running a stock browser.

## Context
Builds directly on E6-T16 (v2 snapshot format, hardened as the Layer-G keyframe substrate) and
E8-T04/T05. Decide keyframe cadence: too sparse and seeks are slow (long replay-forward); too
dense and storage explodes. Use adaptive cadence (denser during heavy activity) and dedupe RAM
chunks across keyframes by hash (E6-T16 already elides zero/unchanged chunks). A keyframe must be
a valid standalone snapshot *and* a valid replay resume point — same clock key, consistent with
the trace. This is the machinery E8-T07's UI scrubs through.

## Deliverables
- Keyframe capture integrated into the record engine (adaptive cadence), with cross-keyframe RAM
  dedupe; a storage-vs-seek-latency tradeoff study with chosen defaults.
- Seek primitive: given a target clock value, restore nearest keyframe + replay forward to it,
  returning exact machine state.
- A test: seek to many random points in a recording and verify state matches a from-start replay.

## Acceptance criteria
- [ ] Seeking to an arbitrary point via nearest-keyframe + replay-forward yields state
      bit-identical to replaying from the start to that point (hash match), for many random targets.
- [ ] Keyframe storage stays within the documented budget and seek latency meets its target for
      a multi-minute recording (numbers recorded).

## Adversarial verification
Seek to points *just after* and *just before* keyframes and to the exact keyframe instant; all
must match a from-start replay — an off-by-one in the clock keying refutes. Verify a keyframe is a
valid snapshot on its own (load it standalone, machine runs). Push storage: a long session must
not exceed the budget (dedupe working); measure. Corrupt a keyframe and confirm the seek fails
loudly (integrity check) rather than restoring garbage.

## Verification log
(empty)
