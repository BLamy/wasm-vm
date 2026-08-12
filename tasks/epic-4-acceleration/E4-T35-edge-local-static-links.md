---
id: E4-T35
epic: 4
title: Edge-local static links for memory-aware traces
priority: 435
status: pending
depends_on: [E4-T34]
estimate: S
risk: high
capstone: false
---

## Goal

Remove dormant cross-module touch overhead and extend only the already-audited SharedReadTlb-safe
intra-block eligibility to useful static cross-module edges.

## Acceptance criteria

- Warm load/store two-module chains execute in one engine call with exact interpreter parity.
- Cold target, precise fault, and SMC unlink/reinstall preserve PC, retired, block, and device counts.
- A fresh short Node run reaches at least 5 logical blocks per engine call before a full run is allowed.

## Adversarial verification

Run Flat-memory rejection, op-zero target miss/refund, target fault, store provenance invalidation,
and an unarmed linked module; the latter must show no link-touch traffic.

## Verification log
