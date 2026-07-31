---
id: E3-T26c
epic: 3
title: Provider credential and persisted-state hygiene
priority: 326.3
status: pending
depends_on: [E3-T19e, E3-T25e]
estimate: S
risk: high
capstone: false
---

## Goal
Prevent an XSS foothold, cache dump, copied profile, or diagnostics export from recovering a
reusable Tailscale auth key, relay token, or unauthorized node identity.

## Deliverables
- A storage/lifecycle inventory separating one-time keys, short-lived tokens, and persisted IPN
  state.
- Worker-memory-only handling and central URL/storage/log/diagnostics redaction tests.
- Copied-state and second-profile authorization tests with documented revocation behavior.

## Acceptance criteria
- [ ] `make verify-E3-T26c` finds no reusable key/token in URLs, cookies, web storage, caches, logs,
  diagnostics, or page-accessible worker messages.
- [ ] Copying persisted state cannot create an unauthorized simultaneous second node.
- [ ] Logout/admin revocation invalidates future use within the declared bound.

## Adversarial verification
Plant identifiable secrets, probe every storage API and `postMessage` surface, copy the profile,
crash during provisioning, and export diagnostics. Any reusable credential, undocumented state,
backend impersonation, or revocation escape refutes.

## Verification log
(empty)
