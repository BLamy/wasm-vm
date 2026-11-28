# E5-T43a round 3 — verifier predictions (written before any run)

Head `3bde7fe1c` (claim), code `32029ac72`. Read so far: task file, AGENTS.md, `git diff 82a525654..HEAD -- crates deploy`,
`driver.rs` run/on_ws_message, `ws_adapter.rs` handle_secure_conn/bridge_ws, `session.rs` on_hello, round 1/2 scripts.
Nothing run yet.

## From the code (predictions to falsify)

- Q1 cap per client, live: 10 authenticated sessions from this machine, each sending its OWN random
  `x-wvrelay-client` header (and a spoofed `X-Forwarded-For`), give exactly 8 served and 2 closed. If the Worker did
  not overwrite the header, all 10 would be served. Prediction: 8 served / 2 closed.
- Q2 refused sessions leak no place, live: after all ten close, eight new sessions are all served and a ninth is
  closed. (`open_session` checks both caps before incrementing; a refusal never sets `authenticated_token`, so
  `close_session` never runs for it.) Prediction: 8/8 served, 9th closed.
- Q3 a second HELLO / version-mismatch HELLO does not double-count: version byte 2 -> `open_session` succeeds,
  `authenticated_token` set, then `on_hello` fails -> break -> one `close_session`. Prediction: no leak (by code;
  checked live via Q2's recount after a mismatch HELLO).
- Q4 racing HELLOs on many connections at once (12 at once, after the 8-session test): registry is one mutex,
  check+increment atomic. Prediction: exactly 8 served of 12.
- Q5 server-side close of refused / never-authenticated connections. `bridge_ws` ends only when the CLIENT's
  WebSocket stream ends: when `RelayServer::run` returns, the writer sends a Close frame, but the reader loop
  `while let Some(msg) = ws_stream.next()` keeps the TCP socket, task and buffers until the client sends Close/any
  binary or drops TCP. Prediction (locally against native wvrelay built at this head): a raw client that upgrades,
  never sends HELLO and never answers the Close frame keeps an ESTABLISHED server socket for well over 10 s (I will
  watch 60 s with `lsof`); likewise a session refused at the per-client cap. If true, "unauthenticated connections
  close at 10 s" holds only for cooperating clients, and the count of such connections per client is unbounded.
  Live prediction: the same raw client through the Worker sees the Close frame at ~10 s and then NO TCP end from
  Cloudflare within 90 s (unless the edge/DO closes it — unknown; whatever is observed is the answer).
- Q6 the container is reachable only through the Worker: Cloudflare Containers have no public ingress; the only route
  to port 8080 is `relay.fetch(switchPort(...))` in `/ws`, which always sets the header. Prediction: no other path
  (code read of `index.js`; `/health` and others do not touch the container).
- Q7 IPv6 key = /64. Prediction: one actor with a routed /56 (256 /64s, a common residential/hosting allocation; a free
  tunnel-broker /48 gives 65 536) gets 256 x 8 places, so ONE actor can take all 256 total places; with no idle
  timeout on authenticated sessions (round 2 R11: 675 s idle, no pings, unchanged `driver.rs:206` guard), it holds
  them for as long as it likes, at no egress cost. IPv4: 32 addresses do the same. Prediction: claim does not state
  this lockout. Not live-testable here (no IPv6 on this host).
- Q8 the claimed mutants (5) are each killed; my own: per-client `>=` -> `>` (allows 9) killed by
  `sessions_are_capped_per_client_and_in_total`; total-cap check removed killed by the same; ws_adapter ignoring the
  header (always peer IP) — prediction: SURVIVES (no test sends `x-wvrelay-client`); Worker `headers.set` removed —
  no JS test, only the live check (Q1).
- Q9 NAT collision: 8 sessions per IPv4 address shared by every user behind one NAT/CGNAT (one desktop = one session,
  so a 9th user behind the same address is refused). Prediction: claim does not mention it; a demo-scale limit,
  not refuting if stated.
- Q10 bytes over time: one client can close a spent session and open another; 8 parallel sessions can fill the
  container's 250 Mbit/s link indefinitely. Prediction: the claim states it; the user's explicit acceptance is NOT
  recorded in the task file (claim says "the user is told it in the summary of this round", i.e. told, not accepted).

## Carried forward (code + deployment path unchanged since the round that held them)
Round 1 P1-P4 Worker surface (except `/token`'s limiter key, now `clientKey`), P5/P6 token/origin at wvrelay, P10/P11
protected destinations, P14 happy paths; round 2 R1 shared budget past expiry, R2, R5, R6 (client-side close seen),
R9 spoof refusal at the edge, R12 secrets. Re-checked only through the smoke run.
