---
id: E3-T20c
epic: 3
title: Explicit relay-only apk fallback proof
priority: 320.3
status: pending
depends_on: [E3-T20a]
estimate: S
risk: high
capstone: false
---

## Goal
Install the same signed Alpine package through an explicitly selected public relay while the
Tailscale module, worker, node, and exit route are absent.

## Deliverables
- A forced-relay variant of the cold-profile apk acceptance target.
- Assertions that no Tailscale artifact loads and that the short-lived relay token refreshes
  without replaying guest bytes.
- Typed failure evidence for expired tokens, disconnect, and protected-destination refusal.

## Acceptance criteria
- [ ] `make verify-E3-T20c` passes from a pristine clone with Tailscale disabled/unloaded and
  attributes all package bytes to the authenticated relay.
- [ ] Signed `ripgrep` installation succeeds, while expired/wrong-origin tokens fail before OPEN.
- [ ] Token refresh and retry leave no duplicate bytes or partial apk database.

## Adversarial verification
Load Tailscale opportunistically, forge and replay tokens, disconnect mid-index and mid-package, and
attempt private/metadata destinations. Any cross-provider traffic, token reuse, policy bypass,
unbounded queue, or falsely successful apk state refutes.

## Verification log
(empty)
