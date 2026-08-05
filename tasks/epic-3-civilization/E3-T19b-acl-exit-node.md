---
id: E3-T19b
epic: 3
title: ACL enforcement and exit-node routing
priority: 319.2
status: pending
depends_on: [E3-T19a]
blocked_on: [E4-T13]
estimate: S
risk: high
capstone: false
---

## Goal
Prove the tailnet ACL and exit-node controls actually gate traffic from the browser VM.

## Context
Split from **E3-T19** on 2026-07-31 (seam decomposition) so each network proof is an independent boundary — the deterministic security proofs (token rejection, secret audit) no longer wait on the flaky live-tailnet proofs, and a provider-specific failure does not rerun unrelated gates.

## Acceptance criteria
- [ ] An ACL-allowed browser node reaches the fixture; an ACL-denied node fails closed — both recorded.
- [ ] Selecting an exit node makes a public fixture observe the exit path; clearing it restores the direct path.
- [ ] ACL / exit-node changes take effect without a full re-provision.

## Verification log
_(none yet — pending)_
