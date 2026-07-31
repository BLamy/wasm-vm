---
id: E3-T19d
epic: 3
title: Browser-VM HTTPS through provider and identity isolation
priority: 319.4
status: pending
depends_on: [E3-T19a]
blocked_on: [E4-T13]
estimate: M
risk: high
capstone: false
---

## Goal
The actual in-browser VM (not just the composed CLI) completes HTTPS through the provider, and
concurrent browser identities stay isolated. This is the flakiest / previously-unrecorded proof —
isolated here so it does not block the rest of the network path.

## Context
Split from **E3-T19** on 2026-07-31 (seam decomposition) so each network proof is an independent boundary — the deterministic security proofs (token rejection, secret audit) no longer wait on the flaky live-tailnet proofs, and a provider-specific failure does not rerun unrelated gates.

## Acceptance criteria
- [ ] The in-browser VM completes an HTTPS request to a fixture over the provider — recorded (not just the composed CLI).
- [ ] Two concurrent browser identities stay isolated: neither observes the other's traffic or node.
- [ ] A provider drop mid-request surfaces a typed error and recovers on reconnect (feeds E3-T25b).

## Verification log
_(none yet — pending)_
