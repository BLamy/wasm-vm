---
id: E9-T22
epic: 9
title: Measure recording storage and seek overhead on real guests
priority: 524.922
status: pending
depends_on: [E9-T15, E9-T16, E9-T18, E9-T19]
estimate: S
risk: medium
capstone: false
---

## Goal

Prove the predeclared recording, storage-growth and seek budgets on software and GPU desktop workloads.

## Boundary

A repeatable equal-work benchmark and bounded regressions, using T01 fixture identities/reference environment. Measure with recording enabled/disabled and distinguish preview, checkpoint restore and replay-forward times.

## Acceptance criteria

- [ ] Publish raw repeated samples, p50/p95 latency, recording overhead, peak memory, bytes per minute and checkpoint cadence for pinned real workloads.
- [ ] Run the seeded seek workload across short and longer sessions, with cached and initial-load measurements reported separately; apply the unchanged T01 budgets.
- [ ] Changing a budget after a failed run requires an explicit revised contract and retains the failed evidence; no MIPS or instant-scrubbing claim follows from a thumbnail.

## Deterministic acceptance

`make verify-E9-T22`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Repeat with dirty RAM, sustained file/network traffic and GPU readback, using independent seeds. Keep first loads and unfavorable samples; fabricated idle-only wins or changed workload amounts refute.

## Verification log

(pending; no implementation or verification claim)
