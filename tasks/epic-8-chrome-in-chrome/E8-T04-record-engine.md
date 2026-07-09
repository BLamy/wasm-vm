---
id: E8-T04
epic: 8
title: Record engine — capture all host→guest inputs into a replayable trace (Layer G core)
priority: 804
status: cancelled
depends_on: [E8-T03]
estimate: L
capstone: false
---

> **CANCELLED 2026-07-06** (Brett's direction): Epic 8 "Chrome in Chrome" is cancelled as a
> goal. Superseded in spirit by **Epic 3.5 — OCI Workloads in the Browser**
> (`tasks/epic-3.5-oci-workloads/`): real container workloads are the payoff instead of a
> nested browser. The Layer-G record/replay ideas in E8-T03..T09 may be resurrected as their
> own epic later if VM time-travel becomes a goal again.

## Goal
The **record** half of record/replay: a low-overhead engine that captures, in order and with
their exact delivery points, every input crossing the VM boundary into the guest — building on
the E0-T16 trace hook and the E8-T03 inventory. The output is a compact trace that, together
with a starting snapshot, fully determines the run.

## Context
Record entries are keyed to a deterministic clock (retired-instruction count per hart, plus a
hart-ordering token for SMP): virtio-blk/net completions and their data, UART/keyboard/mouse
input, timer-interrupt delivery points, RNG/entropy results, and any other E8-T03 source. Design
for volume — a browsing session is large — so use delta/compression and reference disk/network
data by hash where possible (E6-T16 machinery). Overhead must stay low enough that recording is
"always available", per the cross-cutting Layer G intent (recording is not a special mode you
opt into at the end). Coordinate the format with snapshots (E8-T06) so snapshots are keyframes
within the trace.

## Deliverables
- `record/` engine + trace format spec (versioned, integrity-checked), writing to OPFS/IndexedDB
  or downloadable, with compression and hash-referenced bulk data.
- Recording integrated behind the existing trace hook; a documented overhead budget with measurements.
- A test recording a fixed workload and asserting the trace is complete (every E8-T03 source represented).

## Acceptance criteria
- [ ] Recording a fixed workload (incl. a Chromium page load) captures every input class from
      the E8-T03 inventory, keyed to the deterministic clock; trace passes its own integrity check.
- [ ] Recording overhead is within the documented budget (measured vs a non-recording run) —
      low enough to be always-on.

## Adversarial verification
Record a workload, then diff the recorded input set against an independent enumeration of guest
device reads over the same run — any missing input class refutes completeness (and is a
determinism hole). Push recording overhead: record a heavy Chromium session and confirm the
budget holds and the trace doesn't grow unboundedly (compression/hash-dedup working). Corrupt a
trace and confirm the integrity check catches it. Confirm the deterministic clock keying is
stable under SMP (two harts' inputs are ordered unambiguously).

## Verification log
(empty)
