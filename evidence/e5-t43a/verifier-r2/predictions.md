# E5-T43a round 2 — verifier predictions (written before any probe ran)

Head `21610fec8` (claim), code `8b3a524bf`. Read: task file, AGENTS.md, `git diff f0943bc6b..HEAD -- crates deploy`,
round 1's `verifier/` scripts. Live target https://wasm-vm-relay.brett-lamy.workers.dev. Nothing below has been run yet.

## From the code (driver.rs, relay_security.rs)

- Quota is reserved in `on_ws_message` (`reserve_quota_stream`) BEFORE the destination policy runs
  (`resolve_destination` in the spawned connect). So an OPEN to 127.0.0.1 consumes one of the token's
  120 connects/min and makes no outbound connection. That makes the connect budget observable cheaply:
  policy refusal = OPEN_FAIL code 1, quota refusal = OPEN_FAIL code 2.
- The HELLO deadline branch is guarded by `authenticated_token.is_none()`; once authenticated, nothing
  in `run` ever ends a session (no idle timer, no lifetime cap). There is no limit on the number of
  sessions per token (`sessions` is only a counter).
- `connect_times` is a 60 s sliding window: a token's 120 connects/min is a RATE that never runs out,
  and with sessions that never end it lasts forever. Concurrent streams (64) likewise.

## Live predictions

- R1 budget shared across expiry (P9 regression). Token T; sessions A and B both HELLO with T at start.
  About 35 s before T's expiry, A sends 100 OPENs to 127.0.0.1:80 one at a time: all 100 OPEN_FAIL:1.
  At expiry+8 s (same 60 s window), B sends 10 OPENs: all OPEN_FAIL:1 (count 110). Then A sends 20:
  exactly 10 OPEN_FAIL:1 and then 10 OPEN_FAIL:2. (Round-1 code would purge T's entry at expiry and
  give 30 × OPEN_FAIL:1.)
- R2 a new HELLO with expired T on a fresh connection: closed 1000, no OPEN_OK.
- R3 after the window clears (expiry+70 s), A opens example.com:80: OPEN_OK, HTTP 200 (sessions outlive
  tokens, by design).
- R4 B, authenticated and idle (no pings, no frames) from start to ~11 min: still open at the end.
  No idle cap exists for authenticated sessions.
- R5 HELLO deadline: a valid HELLO sent 9 s after `open` authenticates and OPEN example.com:80 gets
  OPEN_OK; a valid HELLO at 12 s finds the socket already closed (~10 s, code 1000).
- R6 partial HELLO: a raw TLS WebSocket that sends a frame header promising 300 bytes and trickles one
  byte a second is closed at ~10 s (Cloudflare's edge does not forward an incomplete frame, and the
  deadline is independent of the read side anyway).
- R7 ports: `smtp.gmail.com:587` and `:465` get OPEN_OK (only 25 is blocked; the unit test asserts
  587/465 allowed). Connect only, closed at once.
- R8 IPv6 forms not covered: `::ffff:0:7f00:1` (SIIT, ::ffff:0:0/96) and `fec0::1` (site-local) are not
  refused by policy (no OPEN_FAIL within ~1 s; they then fail or hang as unroutable). No breach expected.
- R9 `/token` rate limit: plain requests from this host get 429 somewhere between the 20th and ~45th
  in a minute. Once limited, requests carrying spoofed `CF-Connecting-IP`, `X-Forwarded-For`,
  `True-Client-IP`, `X-Real-IP` are still 429 (Cloudflare overwrites CF-Connecting-IP at the edge).
- R10 analytic: the limiter key is the full `CF-Connecting-IP` string, so an IPv6 client is keyed per
  /128, not per /64. (Cannot test live: this host has no IPv6.)
- R11 egress/cost: 2 GiB × 20–40 tokens/min/IP = 40–80 GiB/min/IP, above what one container can carry,
  so the token budget does not bound egress; one container's bandwidth does. And because sessions never
  end, the concurrent capacity an IP holds (64 streams and 120 connects/min per token) grows linearly
  with time, without a cap. Expect this to be the central finding against "what bounds a non-browser is
  the number of tokens it can get".
- R12 secrets: the round-2 commits add no 64-hex value and no secret assignment; web/dist has no relay
  secret; hardening/smoke evidence contain no token values (or only short-lived ones).

## Mutants (scratch copy, never the working tree)

- M1 `retain` back to `expiry > now` only: `a_session_keeps_its_budget_after_the_token_expires` FAILS.
- M2 `open_session` does not count: same test FAILS.
- M3 `close_session` a no-op (entries leak forever): SURVIVES — the test's final assertion
  `record_bytes("t1", 1) == ByteLimit` also holds when the entry is still there and full (100/100).
- M4 deadline guard without `authenticated_token.is_none()` (cuts every session at 10 s): SURVIVES the
  unit tests (no test holds an authenticated session past 10 s).
- M5 `port_is_allowed` check removed from `resolve_destination`: SURVIVES (the test calls only the
  helper).
- M6 6to4 branch removed: `embedded_ipv4_forms_and_blocked_ports` FAILS.
- M7 HELLO deadline branch removed: `secure_relay_closes_a_connection_that_never_authenticates` FAILS.
