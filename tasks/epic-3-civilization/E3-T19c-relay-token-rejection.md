---
id: E3-T19c
epic: 3
title: Relay token rejection (deterministic, no live tailnet)
priority: 319.3
status: verified
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
- [x] Relay connections with an absent, expired, or wrong-origin token are closed before OPEN.
- [x] A valid token is accepted and the protected path succeeds.
- [x] Rejection is enforced server-side (not just client-gated) — proven by a direct WebSocket attempt.

## Verification log
- 2026-08-03 — `make verify-E3-T19c`: **OK**. No live tailnet; deterministic. The server enforces two
  layers, both BEFORE any OPEN:
  1. **Handshake Origin allowlist** (`ws_adapter::handle_secure_conn`) — the WS `Origin` header must be
     in `WVRELAY_ALLOWED_ORIGINS`, else the connection is dropped right after upgrade (no server HELLO).
  2. **Origin-bound HMAC token** (`driver::on_ws_message` → `verify_relay_token`) — the first frame must
     be a HELLO whose token verifies (signature, expiry, ≤15-min lifetime, origin == the handshake
     origin), else `RelayError::Authentication` closes the connection.
  - New end-to-end proof `crates/cli/tests/wvrelay_token_rejection.rs` (5 cases) spawns the ACTUAL
    `wvrelay` binary with security enabled and drives it with a raw `tokio-tungstenite` client:
    `valid_token_opens_the_protected_path` (AC2 — OPEN→OPEN_OK through the relay);
    `absent_token`/`wrong_origin_token`/`expired_token`/`disallowed_handshake_origin` each confirm the
    server closes the connection and NEVER grants OPEN (AC1+AC3). The relay's own structured logs
    corroborate the reason for each: `relay_authentication_rejected {Malformed|WrongOrigin|Expired}`,
    `relay_origin_rejected`, `relay_session_authenticated`. Expiry is deterministic via a 1-second TTL
    + short sleep (bounded, no wall-clock flake).
  - The token-verification unit boundary (injected clock: wrong-origin, expired, tampered signature,
    round-trip) stays green via `wasm_vm_slirp` `relay_security` tests.
