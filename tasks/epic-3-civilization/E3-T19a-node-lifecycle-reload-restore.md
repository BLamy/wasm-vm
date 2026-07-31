---
id: E3-T19a
epic: 3
title: Composed-stack node lifecycle and reload-restore
priority: 319.1
status: pending
depends_on: [E3-T16, E3-T17]
blocked_on: [E4-T13]
estimate: S
risk: high
capstone: false
---

## Goal
On a fresh `docker compose` Headscale/Tailscale stack from a clean checkout (after `down -v`), the
browser VM provisions exactly one tailnet node, reaches a tailnet HTTPS fixture, and a page reload
restores the same identity without replaying the ephemeral auth key or persisting it. This is the
foundational live-network proof the rest of the network path builds on. It stays `blocked_on` the
Epic-4 relay/worker (E4-T13) so the live stack is non-flaky rather than environment-dependent.

## Context
Split from **E3-T19** on 2026-07-31 (seam decomposition) so each network proof is an independent boundary — the deterministic security proofs (token rejection, secret audit) no longer wait on the flaky live-tailnet proofs, and a provider-specific failure does not rerun unrelated gates.

## Acceptance criteria
- [ ] `docker compose up` from a clean checkout (fresh `down -v` stack) yields a browser VM that resolves and reaches a tailnet HTTPS fixture — recorded transcript.
- [ ] A fresh browser profile provisions exactly one node; a page reload restores it without re-running the auth-key exchange.
- [ ] The ephemeral auth key is never written to IndexedDB / localStorage / the URL (verified by inspection after provisioning).

## Verification log
_(none yet — pending)_
