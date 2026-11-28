# E5-T43a round 5 — verifier predictions (written before running anything)

Head `8a06ef267` (claim), change `db41616ae`; round-4 verdict `c551288ae`. wvrelay unchanged since `edaf2824b`.
Live: https://wasm-vm-relay.brett-lamy.workers.dev (redeployed with the client.js extraction).

## From reading the diff (`git diff c551288ae..HEAD -- crates deploy tasks`)

- X1 Worker extraction is behaviour-neutral. `relayHeaders` = `new Headers(request.headers)`, `delete` then `set`
  `x-wvrelay-client` = `clientKey(request)`; the old code did `set` alone. `Headers.set` already replaces every value,
  so `delete` is redundant and the forwarded header set is identical. `clientKey` is moved byte-for-byte. The token
  limiter still calls `clientKey` (now imported). Prediction: a textual diff of the old function vs `client.js` shows
  only the `export`/location change; `wrangler deploy --dry-run` bundles without error.
- X2 `node --test deploy/cloudflare-relay/test/client.test.mjs` passes, 3 tests. A mutant `relayHeaders` that keeps the
  caller's header when present (`if (!headers.has(...)) set`) fails test 3; a constant `clientKey` (`return "k"`) fails
  test 1; a /64 key fails test 2.
- X3 Mutants: `python3 -I evidence/e5-t43a/verifier-r4/run-mutants.py <scratch clone at HEAD>` gives 14 of 14 KILLED,
  matching `mutants-r5.log`. Each runner pattern still occurs exactly once (wvrelay code unchanged), or the runner
  asserts. If any assertion fires the mutant is invalid, not survived.
- X4 The new Rust tests are not timing-flaky on this machine: `cargo test -p wasm-vm-slirp --features native --lib
  ws_proxy` passes 3 times in a row.
- X5 Sabotage of the new tests: V1/V2/V6/W5 each kill exactly the named new test (as mutants-r5.log says). Additional
  sabotage I will add: `outbound_traffic_alone_keeps_a_session_active` must fail if the idle limit ignores ALL traffic
  (W4 inverted: idle closes at limit regardless) — predicted KILLED by both idle tests.

## Live (a few dozen connections at most)

- L1 Caller-supplied `x-wvrelay-client` is overwritten by the deployed Worker: with my own random value on each of 5
  sessions (and on one, the value equal to this machine's IPv4 key), from this machine: 4 served (OPEN_OK to
  example.com:80), the 5th closed by the relay at HELLO. Also with an empty value and a 200-char value: refused while
  4 of this machine are held.
- L2 `smoke.mjs` passes against the live URL (happy path + refusals), unchanged from round 4.
- L3 Second address: predicted NOT obtainable cheaply (no IPv6 route on this host; one IPv4 egress). If an IPv6 or
  second path exists, a 5th session from it is served while this IPv4 holds 4.
- L4 Browser WebSocket idle (bounded novel attack on demand (3)): a real Chromium page at an allowed dev origin
  (`http://127.0.0.1:8125` or `:8123`), fetches `/token`, opens `new WebSocket(wss://…/ws)`, HELLO + OPEN
  example.com:80 (OPEN_OK), then sends nothing for 31 minutes. Prediction: the page's WebSocket receives a `close`
  event with code 1000 between 30:00 and ~31:00 after its last frame (relay idle close 30 min + check interval).
  Alternative outcome (round-4 idle4 anomaly reproduced): no `close` event by 32 min, i.e. the session is freed at the
  relay but the browser is never told. If that happens, it is a NEEDS EVIDENCE on "closed" at the client, which the
  moved E5-T43d acceptance ("the relay's Close reaches it, or the page notices") would have to absorb.

## Judgements to make

- J1 Demand (1) substitute: acceptable only if every link is proven: (a) Worker source keys per IP (X2), (b) deployed
  Worker = this source (X1 + L1 + deployment metadata), (c) wvrelay keys per header (W2/W3/V3 killed), (d)
  CF-Connecting-IP differs per client (Cloudflare's documented guarantee; not testable here). Predicted: acceptable,
  with (d) and the deployed-equals-source link waived/stated, since the verifier also cannot get a second address.
- J2 Demand (3) move: legitimate if this task's claim does not include "the client is told". The relay-side claim
  ("closed and place freed") is HELD from round 4; what the page shows is E5-T43d's UI. Predicted legitimate, provided
  L4 shows the Close reaches a browser WebSocket (else the relay's "closed" is only half-true and stays NEEDS EVIDENCE
  here, not there).
