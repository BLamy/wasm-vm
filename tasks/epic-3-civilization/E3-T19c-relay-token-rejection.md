---
id: E3-T19c
epic: 3
title: Relay token rejection (deterministic, no live tailnet)
priority: 319.3
status: pending
depends_on: [E3-T16, E3-T17]
estimate: S
risk: low
capstone: false
---

## Goal
The relay rejects unauthorized connections server-side. This is a deterministic security proof
that does NOT need the flaky live tailnet — verifiable against a local relay instance now.

## Context
Split from **E3-T19** on 2026-07-31 (seam decomposition) so each network proof is an independent boundary — the deterministic security proofs (token rejection, secret audit) no longer wait on the flaky live-tailnet proofs, and a provider-specific failure does not rerun unrelated gates.

## Acceptance criteria
- [ ] Relay connections with an absent, expired, or wrong-origin token are closed before OPEN.
- [ ] A valid token is accepted and the protected path succeeds.
- [ ] Rejection is enforced server-side (not just client-gated) — proven by a direct WebSocket attempt.

## Verification log
_(none yet — pending)_
