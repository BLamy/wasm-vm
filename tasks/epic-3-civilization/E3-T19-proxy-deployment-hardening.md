---
id: E3-T19
epic: 3
title: Proxy server deployment - auth tokens, rate limits, CORS, local dev
priority: 319
status: pending
depends_on: [E3-T16]
estimate: M
capstone: false
---

## Goal
The T16 relay becomes deployable without becoming an open proxy: short-lived signed auth
tokens gate the WebSocket, per-token rate and connection limits bound abuse, destination
policy blocks internal networks, CORS/origin checks pin which pages may connect, and a
one-command local dev setup keeps the friction near zero.

## Context
An unauthenticated TCP relay on the public internet is an abuse magnet (spam, scanning,
SSRF into the host's own network). Auth: the page obtains a token at load time from a
`/token` endpoint (same origin as the app, CORS-restricted); token = HMAC-signed blob
{expiry ≤ 15 min, origin, random id} verified by the relay in the T16 hello frame — no
accounts, no persistence; the client transparently re-fetches on expiry for *new* flows
(established flows survive token expiry). SSRF defense: after the relay resolves an OPEN
hostname, reject destinations in RFC1918/4193, loopback, link-local, and the relay's own
metadata ranges (169.254.169.254) — resolve-then-check, not check-then-resolve, to beat DNS
rebinding. Limits: token-scoped concurrent-stream cap, bytes/sec ceiling, connects/min;
429-style OPEN_FAIL codes so the guest sees meaningful errors. Ops: `Origin` header
allowlist on the WS upgrade, structured logs with token ids (not payloads), Prometheus-style
metrics endpoint, Dockerfile + compose file that runs relay + token issuer + static app for
local dev (`docker compose up` → working VM with networking).

## Deliverables
- Token issuer (in the relay binary or the dev server): HMAC key from env, `/token`
  endpoint with origin checks; relay-side verification + expiry handling; client re-fetch.
- Destination policy module with the deny ranges + config allowlist override, applied
  post-resolution; unit tests incl. rebinding scenario (mock resolver flips answers).
- Rate/concurrency limiter keyed by token id, with OPEN_FAIL error codes wired to guest-
  visible errors.
- `docker-compose.yml` + `docs/deploy-proxy.md`: local dev flow, production checklist
  (TLS termination, key rotation, log retention).

## Acceptance criteria
- [ ] A WS connection with no/expired/garbage token is closed before any OPEN is honored
      (three explicit tests).
- [ ] OPEN to 10.0.0.5, 127.0.0.1, and a hostname whose mock DNS answer flips from public
      to 169.254.169.254 (rebinding) are all refused with the policy error code.
- [ ] Exceeding the concurrent-stream cap yields OPEN_FAIL and the guest's connect fails
      with a distinguishable error; existing streams unaffected.
- [ ] `docker compose up` from a clean checkout yields a browser VM where guest `wget` to
      an external host succeeds (documented end-to-end in deploy doc, executed once).
- [ ] Token expiry mid-session: established transfers continue; the next new connection
      triggers a client token refresh and succeeds without user action.

## Adversarial verification
Play the abuser. Connect with a token minted for a different origin (forge the fetch from
another local site) — acceptance refutes. Replay a captured valid token after expiry.
Attempt SSRF via every encoding trick: decimal IP (2130706433), IPv6-mapped v4
(::ffff:127.0.0.1), `localhost.` with trailing dot, a hostname with a 0-TTL rebinding
answer — any internal connection established refutes. Saturate one token with the byte
ceiling and verify a second token's throughput is unaffected (isolation). Check logs for
secrets: full tokens or HMAC keys in any log line refute. Confirm the compose setup binds
the relay to localhost or requires the token even in dev (an accidental open dev proxy on
0.0.0.0 refutes).

## Verification log
(empty)
