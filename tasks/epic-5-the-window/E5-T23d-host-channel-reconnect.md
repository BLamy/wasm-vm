---
id: E5-T23d
epic: 5
title: Host agent Channel API and reconnect lifecycle
priority: 523.4
status: verified
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

- [x] A Channel reaches ready only after HELLO intersection and exposes negotiated capabilities;
      PING round trips correlate correctly even when replies arrive out of order.
- [x] Agent termination rejects every in-flight send exactly once, reconnects, and re-negotiates
      HELLO without duplicate listeners or stale subscriptions.
- [x] Ten thousand bounded PING attempts cannot grow pending memory without backpressure, and a
      send during the gap returns a documented disconnected error.

## Verification command

`node --test web/tests/agent-channel.test.mjs`

## Adversarial verification

Inject version skew, kill the transport during each handshake phase, replay a stale HELLO, and
deliver replies in reverse order. Inspect pending counts and listener cardinality after 100 restart
cycles; any silent send loss or duplicate callback is a finding.

## Verification log

### 2026-09-04 — worker — implemented

- Implementation commits: `4691d06` (host Channel and deterministic transport fixtures), `dbae7bc`
  (verification target), and `24fa64a` (retry/timeout coverage).
- Exact evidence is retained at `evidence/e5-t23d/agent-channel-2026-09-04.txt`.

Claim: `web/agent-channel.js` provides a worker-safe, transport-agnostic Channel. It stays in
handshaking until the shared HELLO version/capability intersection is valid, correlates PING/PONG
by a u64 nonce, routes typed subscriptions, NAKs unknown frames, bounds in-flight requests, and
returns `DisconnectedError` for sends during a restart gap. Generation guards and listener cleanup
make agent termination and reconnect/re-negotiation recoverable without stale callbacks.

### 2026-09-04 — verifier — VERDICT: verified

- **HELLO and capability gate — HELD.** The exact-head suite kept the channel non-ready before
  HELLO, negotiated host version 2 with a peer version 1 down to version 1, intersected capability
  bits, and correlated reverse-order PONGs by their own nonces.
- **Reconnect and settlement — HELD.** Transport termination rejected every in-flight PING once,
  returned an explicit `DisconnectedError` for a gap send, removed the old transport listener,
  preserved one user subscription, ignored late old-generation data, and re-negotiated on the fresh
  transport. A transport killed during HELLO followed the same recovery path.
- **Bounds and attacks — HELD.** Ten thousand PING attempts stopped at a pending bound of 64;
  9,936 returned `BackpressureError` and the 64 live requests were settled as disconnected on
  close. The suite also held unknown-type NAK, malformed PING, stale HELLO, no-common-version,
  connector retry, timeout, byte-dribble/coalescing, and 100-cycle listener cardinality checks.
- **Worker-safe routing — HELD.** A real Node `MessageChannel` used the endpoint adapter for HELLO
  and PING/PONG without a Window or DOM dependency. The module is intentionally not wired to the
  demo in this slice; E5-T23e owns the real virtio-console boot/browser proof.
- **COVERAGE — SUFFICIENT.** Every changed runtime behavior is exercised by the 11-test acceptance
  suite or is a bounded validation/cleanup branch exercised by its malformed-input, close, retry,
  timeout, and endpoint tests. No browser, host-rr, independent-machine, or WebKit leg is claimed
  under current policy and user direction.
- **SUITE:** retain `make verify-E5-T23d`, `web/tests/agent-channel.test.mjs`, and the exact-head
  evidence transcript.

Commands:

- `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR -u CARGO_BUILD_RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS node --test web/tests/agent-channel.test.mjs`
- the same scrubbed command repeated 25 consecutive times
- `node --check web/agent-channel.js`
- `git diff --check`
- `python3 tools/check_task_policy.py`
