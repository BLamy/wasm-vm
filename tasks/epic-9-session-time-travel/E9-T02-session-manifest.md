---
id: E9-T02
epic: 9
title: Define bounded session manifests and compatibility checks
priority: 524.902
status: pending
depends_on: [E9-T01]
estimate: S
risk: high
capstone: false
---

## Goal

Identify exactly which machine, assets and replay policy a saved session needs.

## Boundary

The versioned session/event/checkpoint index codec and compatibility admission; no execution or UI. Preserve historical data when a build cannot replay it.

## Acceptance criteria

- [ ] Bind immutable VM/Wasm build, base-image/kernel identities, RAM/hart/device topology, event policy, checkpoint format and GPU profile when applicable.
- [ ] Represent instruction positions and sequence numbers without JavaScript precision loss; preserve exact values across the 2^53 boundary.
- [ ] Reject unknown required versions, inconsistent lengths/digests and foreign build/image/profile combinations with typed errors; keep the original session intact. Define retained runtime assets or an honest unavailable state after updates.

## Deterministic acceptance

`make verify-E9-T02`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Mutate each identity independently, use oversized/duplicate sections and counters above 2^53. A misleading compatible verdict or destructive automatic migration refutes the claim.

## Verification log

(pending; no implementation or verification claim)
