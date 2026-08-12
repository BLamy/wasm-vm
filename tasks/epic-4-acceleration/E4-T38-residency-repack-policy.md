---
id: E4-T38
epic: 4
title: JIT residency and repack policy
priority: 438
status: pending
depends_on: [E4-T34]
estimate: S
risk: high
capstone: false
---

## Goal

Measure same-page repack and live-module pressure with identical runtime bytes before choosing a
production cap or repack policy.

## Acceptance criteria

- Compare repack-off, cap-256, and cap-1024 using the exact Node fixture and one policy change per
  run.
- Publish submitted members, compile-pause time, module count, evictions, retranslations, logical
  blocks per engine call, and JIT retired share.
- Keep a policy only when both wall time and churn improve; otherwise close it as refuted.

## Adversarial verification

Churn a smallest-cache workload, invalidate a same-page target mid-run, and verify no stale Function,
Instance, table cell, profile, or metadata accounting survives removal.

## Verification log
