---
id: E3-T19e
epic: 3
title: Secret-free diagnostics audit and combined teardown
priority: 319.5
status: pending
depends_on: [E3-T19b, E3-T19c, E3-T19d]
estimate: S
risk: low
capstone: false
---

## Goal
Terminal proof of the T19 hardening effort: no reusable secret survives at rest, and teardown is
clean. Verifiable now once the lifecycle sub-tickets land.

## Context
Split from **E3-T19** on 2026-07-31 (seam decomposition) so each network proof is an independent boundary — the deterministic security proofs (token rejection, secret audit) no longer wait on the flaky live-tailnet proofs, and a provider-specific failure does not rerun unrelated gates.

## Acceptance criteria
- [ ] A storage / log / URL / diagnostics audit finds no reusable auth key, relay token, or guest payload.
- [ ] Teardown removes the node from the tailnet; a re-provision gets a fresh identity.
- [ ] The combined lifecycle (provision -> use -> drop -> teardown) leaves no reusable secret at rest.

## Verification log
_(none yet — pending)_
