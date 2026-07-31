---
id: E3-T25b
epic: 3
title: Provider reconnect and fail-fast policy
priority: 325.2
status: pending
depends_on: [E3-T25a, E3-T19a, E3-T20d]
estimate: S
risk: high
capstone: false
---

## Goal
Make Tailscale and relay loss fail in-flight guest flows normally, fail new flows promptly, and
recover only within the explicitly selected identity/provider.

## Deliverables
- Bounded provider-specific reconnect state machines and a shared offline/reconnecting/online view.
- Tailscale persisted-state restoration and relay-token refresh without automatic cross-provider
  fallback.
- Byte-accounting tests proving reconnect never replays guest data.

## Acceptance criteria
- [ ] `make verify-E3-T25b` drops each provider during `apk add`, observes failure within ten
  seconds, restores it, and succeeds on retry without page reload or duplicate node/bytes.
- [ ] New flows fail fast while down; backoff caps under repeated flapping.
- [ ] Revocation/ACL denial remains closed while the alternate provider is healthy.

## Adversarial verification
Flap at 0.5 Hz for two minutes, revoke during active traffic, keep the alternate provider healthy,
and inspect queues and byte counters. Any silent identity change, replay, unbounded growth, stale
status, or duplicate node refutes.

## Verification log
(empty)
