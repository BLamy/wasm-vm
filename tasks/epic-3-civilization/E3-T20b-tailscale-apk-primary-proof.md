---
id: E3-T20b
epic: 3
title: Tailscale exit-node apk primary-path proof
priority: 320.2
status: pending
depends_on: [E3-T20a]
estimate: S
risk: high
capstone: false
---

## Goal
From a fresh browser profile, install a signed Alpine package through the browser node and selected
Tailscale exit path while the public relay is unavailable.

## Deliverables
- A cold-profile browser acceptance target for provision, DHCP/DNS, exit-route selection,
  `apk update`, `apk add ripgrep`, and `rg --version`.
- Evidence binding the bytes and observed public route to the browser node with `wvrelay` stopped.
- A tampered-package rejection fixture that leaves signature/TLS policy unchanged.

## Acceptance criteria
- [ ] `make verify-E3-T20b` passes from a pristine clone with the relay stopped and attributes the
  complete transfer only to the expected Tailscale node/exit route.
- [ ] `apk update`, signed `ripgrep` installation, and `rg --version` succeed without manual guest
  network configuration.
- [ ] A corrupted package is rejected and no partial apk database is presented as complete.

## Adversarial verification
Enable a healthy relay while denying/revoking the node, tamper with DNS and package bytes, and inspect
all network/runtime evidence for a fallback or fixture backdoor. Any silent provider change,
unattributed traffic, disabled validation, or reusable auth-key persistence refutes.

## Verification log
(empty)
