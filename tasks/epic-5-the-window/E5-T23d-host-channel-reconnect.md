---
id: E5-T23d
epic: 5
title: Host agent Channel API and reconnect lifecycle
priority: 523.4
status: pending
depends_on: [E5-T23c]
estimate: S
risk: high
capstone: false
---

## Goal

Provide the page/worker-side `Channel` service that negotiates the guest agent, exposes typed
subscribe/send operations, and makes restart gaps explicit and recoverable.

## Boundary

This slice owns host Channel state, bounded in-flight requests, HELLO re-negotiation, listener
cleanup, and worker/page integration tests. It does not add clipboard semantics, change the
virtio-console transport, or claim end-to-end guest boot success.

## Deliverables

- A typed Channel API with capability checks, PING correlation, subscriptions, and bounded pending
  state.
- Reconnect handling for agent restart and VM snapshot restore, including a terminal error for
  sends attempted during the disconnected interval rather than silent loss.
- Worker-safe event routing and listener disposal with no main-thread-only API dependency.
- Deterministic Node tests for out-of-order replies, disconnect/reconnect, negotiation down-level,
  and pending-send rejection.

## Acceptance criteria

- [ ] A Channel reaches ready only after HELLO intersection and exposes negotiated capabilities;
      PING round trips correlate correctly even when replies arrive out of order.
- [ ] Agent termination rejects every in-flight send exactly once, reconnects, and re-negotiates
      HELLO without duplicate listeners or stale subscriptions.
- [ ] Ten thousand bounded PING attempts cannot grow pending memory without backpressure, and a
      send during the gap returns a documented disconnected error.

## Verification command

`node --test web/tests/agent-channel.test.mjs`

## Adversarial verification

Inject version skew, kill the transport during each handshake phase, replay a stale HELLO, and
deliver replies in reverse order. Inspect pending counts and listener cardinality after 100 restart
cycles; any silent send loss or duplicate callback is a finding.

## Verification log

(empty)
