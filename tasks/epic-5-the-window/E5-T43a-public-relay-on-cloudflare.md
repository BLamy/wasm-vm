---
id: E5-T43a
epic: 5
title: Network for everyone — the wvrelay WebSocket relay deployed on Cloudflare, with tokens for the page's origin
priority: 0.38766
status: implemented
depends_on: []
estimate: S
risk: high
capstone: false
---

## Why this exists

The Replay desktop boots with networking off: its Chrome shows ERR_INTERNET_DISCONNECTED.
The client side already exists (E3-T16 WebSocket TCP/UDP proxy protocol, `WsConnector`, the
loader's `websocket`/`relay` providers); what is missing is a public relay. The user chose a
public relay on their Cloudflare account first, the Tailscale stack second (E5-T44).

## Boundary

New `deploy/cloudflare-relay/`: a Worker plus a Cloudflare Container running the existing
`wvrelay` (unchanged relay code; `deploy/e3-t19/relay.Dockerfile` is the starting point).
- `GET /token`: for an allowed `Origin` only (https://wasm-vm.pages.dev and the local dev
  origins), returns a relay token in wvrelay's own format (`v1`, expiry at most 15 min,
  origin, random id, HMAC-SHA256; `crates/slirp/src/ws_proxy/relay_security.rs`), CORS for
  that origin only. The HMAC secret is a Worker/Container secret, never in the repository.
- `GET /ws`: the WebSocket, forwarded to the Container with the browser's `Origin`; wvrelay
  checks the token and the origin itself and refuses protected networks (loopback, private,
  link-local, metadata, as it already does).
- A deploy script (`deploy/cloudflare-relay/deploy.sh`) and its README.

## Deterministic acceptance

- `cargo run -p wasm-vm-cli --bin wvrelay -- …` client smoke, or a node script speaking the
  ws-proxy protocol, against the DEPLOYED URL: with a token from `/token` (Origin
  https://wasm-vm.pages.dev) an OPEN to `example.com:80` and an HTTP GET returns `200`.
- Refusals against the deployed URL: no token; an expired token; a token for another origin;
  a token used from a different `Origin`; `/token` from a disallowed origin (403, no CORS);
  OPEN to 127.0.0.1, 10.0.0.1, 169.254.169.254 and a hostname resolving to a private address.
- No secret in the repository, the deployed Pages bundle, or logs (grep + privacy check).

## Adversarial verification

High risk (a public proxy on the user's account). Attack list: token replay after expiry;
token forged with a guessed secret; origin spoofing from a non-browser client (the token
binds the origin, but a non-browser can send any Origin — state what bounds abuse then:
per-token streams/bytes, token lifetime, rate of `/token`); DNS rebinding to a protected
address; slowloris-style idle streams; cost exposure (container instances, egress).

## Verification log

### 2026-11-27 — worker — claim (head `654ec1634`)

Deployed: `https://wasm-vm-relay.brett-lamy.workers.dev` (Worker `wasm-vm-relay`, Container
application `wasm-vm-relay-relay`, basic instance, at most 3), from `deploy/cloudflare-relay/`
with `bash deploy/cloudflare-relay/deploy.sh --secret`. wvrelay is the repository's, unchanged,
built at this head as a static linux/amd64 binary (zig as C compiler and linker).

`node deploy/cloudflare-relay/smoke.mjs --base https://wasm-vm-relay.brett-lamy.workers.dev --out evidence/e5-t43a/smoke-live.json`
passes (`smoke-live.json`):
- `/token` with `Origin: https://wasm-vm.pages.dev`: 200, CORS to that origin only; with
  `Origin: https://evil.example`: 403, no CORS header.
- TCP: OPEN `example.com:80`, an HTTP/1.1 GET: `200`, title `Example Domain`.
- UDP: UDP_OPEN `1.1.1.1:53`, an A query for example.com: one reply, 2 answers.
- Protected: OPEN to 127.0.0.1, 10.0.0.1, 169.254.169.254 and `localhost` each get OPEN_FAIL
  (code 1).
- No token, a forged token (last four characters changed): HELLO answered, no stream opened,
  the connection closed (1000). The right token from `Origin: https://evil.example`: refused by
  the Worker before the container (1006, 403).
- Locally against the native wvrelay with the same token code (before the deploy): the same
  results, proving `src/token.js` produces tokens wvrelay verifies.

No secret is in the repository (generated with `openssl rand -hex 32`, sent once with
`wrangler secret put RELAY_HMAC_SECRET`); the privacy check passed on the commit.

Bring-up notes: the Containers library checks readiness with a plain HTTP request on the port it
is about to use, which wvrelay drops ("Network connection lost"), so the container carries a
static busybox `httpd` on 8081 and the Worker starts it there before handing the WebSocket to
8080. The Durable Object is named by `RELAY_INSTANCE` (`relay-2`; the first instance from the
broken bring-up is left idle and sleeps after 15 minutes).

Not done: abuse bounds beyond wvrelay's own (per-token stream and byte limits, 15-minute
tokens). A non-browser client can claim the allowed Origin and get tokens from `/token`; nothing
rate-limits `/token` yet. Container cost: one basic instance while in use, sleeping after 15
minutes idle; egress is the account's.

### 2026-11-27 — verifier — VERDICT: refuted

VERDICT: refuted

Fresh session against head `44a03c51a` (code `654ec1634`) and the live
`https://wasm-vm-relay.brett-lamy.workers.dev`. I wrote the predictions first
(`evidence/e5-t43a/verifier/predictions.md`), then ran `smoke.mjs` again (`verifier/smoke.json`, SMOKE PASS),
`verifier/probe.mjs` (`probe.json`, sha256 `1ec733af…`) and `verifier/long.mjs` (`long.json`, sha256
`6c6f43a0…`, about 11 minutes, 4 connections). Every acceptance criterion held. The claim fails on the
abuse bounds it gives in answer to the attack list.

- P9 the token's lifetime bounds a session: FAILED. The claim lists "15-minute tokens" as an abuse bound. I
  predicted from the code that an authenticated session outlives its token. Observed: session A sent HELLO
  with token T (expiresAt 1795810136), and 10 s after T expired it opened a new TCP stream to
  `example.com:80` and got HTTP `200` (`long.json` `A_after` = OPEN_OK, http 200, `pastExpiryBy` 10).
  Cause: the token is checked only on HELLO (`driver.rs:234`). `reserve_stream` never compares expiry with
  now: it drops the expired entry and creates a fresh one (`relay_security.rs:167-169`), so the token's
  64 MiB byte counter also starts again at 0. One token therefore gives an unlimited session with byte
  budgets that reset. Demand: enforce expiry on OPEN/UDP_OPEN or close the session at expiry, and stop
  resetting quotas. That needs a wvrelay change (a new dependency task, since this task keeps wvrelay
  unchanged), or the Worker must close the WebSocket at expiry. Otherwise the claim must stop calling
  token lifetime a bound, and the user must accept that risk explicitly.
- P16 slowloris (attack list): FAILED (nothing bounds it, and the claim does not say so). Connection C
  upgraded with the allowed Origin and then sent nothing, not even pings. Connection B never sent HELLO and
  sent only client pings. Both were still open about 10 min later (`long.json` `B.alive`/`C.alive` =
  true). wvrelay has no deadline for HELLO (`ws_adapter.rs:183` onward, `driver.rs:234`). The library
  counts an open WebSocket as an in-flight request (`@cloudflare/containers` 0.3.7
  `container.js:887-896`), so idle sockets also keep the one container awake. Demand: a HELLO deadline and
  an idle cap, or a stated, accepted limit.
- P15 `/token` rate: HELD as a stated limit. A non-browser client that sends `Origin:
  https://wasm-vm.pages.dev` gets tokens without limit (`probe.json` P1/P2/P7). The worker said so. The
  per-token bounds in the code (64 concurrent streams, 120 connects/min, 64 MiB, 1024 streams per WebSocket)
  apply to a token id. Free tokens plus P9 mean they do not bound a client.
- P13 port 25: observed, follow-up. A TCP OPEN to `aspmx.l.google.com:25` got OPEN_OK (`probe.json` P13;
  connect only, RST at once). Together with free tokens, the relay is an SMTP-capable proxy on the
  user's account. The task names "cost exposure", not ports, so this alone does not refute. File a port
  policy (deny 25/465/587 at least) with the fix for P9.
- P12 IPv4-embedded IPv6: observed, follow-up, no breach. The container has IPv6 egress
  (`control.ipv6Public` OPEN_OK in 41 ms). `::127.0.0.1` (IPv4-compatible) and `64:ff9b::7f00:1` (NAT64)
  pass wvrelay's policy: no OPEN_FAIL within 15 s, against about 40 ms for every policy refusal. So the
  connect was attempted, and it hung without reaching anything. `ipv6_is_public` only unwraps
  `::ffff:0:0/96` (`relay_security.rs:387`). Follow-up: classify `::/96`, `64:ff9b::/96`,
  `64:ff9b:1::/48`, `2002::/16` and `2001::/32` by the IPv4 address they embed.
- P1–P4 Worker surface: HELD. `/token` returns 200 with ACAO equal to the origin, `Vary: Origin`,
  `no-store`, and only the keys `{token, expiresAt, ws}`. The token is `v1`, TTL 600, the origin, a
  32-hex id and a 64-hex MAC, with a new id each time; `?ttl=86400` is ignored (600). Each of
  `evil.example`, `HTTPS://WASM-VM.PAGES.DEV`, a trailing `/`, `:443`, `null`, a subdomain and no Origin
  gets 403 with no ACAO. OPTIONS gives 204, POST 405, `/health` 200, `/ws` without Upgrade 426,
  unknown paths 404.
- P5/P6/P6b token and Origin at wvrelay: HELD (new coverage). The smoke's `wrongOrigin` used an origin
  the Worker refuses, so it never reached the container. Here the pages.dev token from Origin
  `http://localhost:8123`, which the Worker allows and passes on, was closed 1000 by wvrelay. A token
  with its origin edited, and one with its expiry extended (signature kept), were each closed 1000 with
  no OPEN_OK.
- P8 an expired token in a new HELLO: HELD (`long.json` `D_expired` closed 1000). This is the acceptance
  item "an expired token", which the worker's smoke did not run against the deployed URL.
- P7 one token on two concurrent connections: both get OPEN_OK and HTTP 200. Tokens are not single-use;
  this is by design, not a finding.
- P10/P11 protected destinations: HELD. TCP OPEN_FAIL:1 in 33–522 ms for `::1`, `[::1]`, `fd00::1`,
  `fe80::1`, `::ffff:127.0.0.1`, `::ffff:10.0.0.1`, `0.0.0.0`, `127.1`, `2130706433`, `100.64.0.1`,
  `172.16.0.1`, `192.168.0.1`, `169.254.169.254`, and hostnames that resolve to private addresses
  (`127.0.0.1.nip.io`, `10.0.0.1.sslip.io`, `169.254.169.254.nip.io`; the acceptance item that the smoke
  covered only with `localhost` from /etc/hosts). UDP_OPEN_FAIL:1 for 127.0.0.1, 10.0.0.1,
  169.254.169.254 and `127.0.0.1.nip.io` on port 53.
- P14 TCP and UDP happy paths: HELD (`smoke.json`: example.com 200 "Example Domain"; DNS id 0x1234,
  2 answers).
- P17 secrets: HELD as far as I can check without the value. The task's two commits add no 64-hex string
  (package-lock excluded) and no `*_HMAC_SECRET=` value. Nothing is in `.wrangler/` or `.dev.vars`, and
  `web/dist` has no relay or secret string. Worker responses carry only the token (`response-headers.log`,
  `secret-hygiene.log`). No token value is written in the verifier evidence.
- COVERAGE of `src/index.js`/`src/token.js`: every branch ran except the 503 path with no secret,
  which cannot run without changing the deploy (waived: a guard). token.js ran in full.
- Nit: the claim says the container sleeps "after 15 minutes"; `DEFAULT_SLEEP_AFTER` is `'10m'`
  (`container.js:20`), and an open WebSocket keeps it awake indefinitely (see P16).
- SUITE: not yet; the refutations come first. Keep `verifier/probe.mjs` and `long.mjs` as the deployed-relay
  attack harness; the P9 and P16 assertions belong in the next smoke.

Commands: `node deploy/cloudflare-relay/smoke.mjs --base https://wasm-vm-relay.brett-lamy.workers.dev --out evidence/e5-t43a/verifier/smoke.json`;
`node evidence/e5-t43a/verifier/probe.mjs`; `node evidence/e5-t43a/verifier/long.mjs`. Not checked: the
Cloudflare dashboard, Worker logs and egress billing (no account access); whether the deployed image is
byte-for-byte this head's wvrelay; sustained load, and whether the 120 connects/min and 64 MiB limits
trip in production (they are only in the code).

### 2026-11-27 — worker — round 2 claim (head `8b3a524bf`)

The refutation is right: wvrelay checked the token only at HELLO and dropped an expired token's
usage entry, so the next stream started a fresh budget; and nothing closed a connection that
never authenticated. Fixing that needs wvrelay itself, so this round changes it (the task's
"wvrelay unchanged" no longer holds; the change is confined to `crates/slirp/src/ws_proxy/` and
`wvrelay.rs`'s limit setting).

**The bound, as it now is:** a token authorizes opening sessions; its budget (streams, connects
per minute, bytes — 2 GiB here, `WVRELAY_MAX_BYTES_PER_TOKEN`) is shared by every session it
opened and lasts as long as any of them, past the token's expiry. A browser desktop keeps one
session for its life on one token (the client has no reconnect), so a session is not cut at
expiry — that would take a user's network away after ten minutes. What bounds a non-browser
claiming the allowed Origin is then the number of tokens it can get: `/token` is rate-limited per
client IP (Cloudflare's rate-limiting binding, 20 a minute; approximate per location).

**Changed** (commit `8b3a524bf`):
- `relay_security.rs`: `open_session`/`close_session`; an entry goes only once expired with no
  session or stream holding it; `BLOCKED_PORTS = [25]`; IPv4-compatible `::a.b.c.d`, NAT64
  `64:ff9b::/96` and 6to4 `2002::/16` judged by the IPv4 they carry; `64:ff9b:1::/48` and Teredo
  refused.
- `driver.rs`: `HELLO_DEADLINE` 10 s for a secured connection; session open/close accounted.
- `wvrelay.rs`: `WVRELAY_MAX_BYTES_PER_TOKEN`.
- Worker: `TOKEN_LIMITER`; `MAX_BYTES_PER_TOKEN` to the container; `RELAY_INSTANCE` `relay-3`.

**Tests**: `cargo test -p wasm-vm-slirp --features native --lib` 268 passed (new:
`embedded_ipv4_forms_and_blocked_ports`, `a_session_keeps_its_budget_after_the_token_expires`,
`secure_relay_closes_a_connection_that_never_authenticates`); the wvrelay smoke and token-rejection
integration tests pass; clippy clean.

**Live** (redeployed): `smoke.mjs` passes again (`smoke-live-r2.json`). `hardening.mjs`
(`hardening-live.json`): `aspmx.l.google.com:25`, `::127.0.0.1`, `64:ff9b::7f00:1` and
`2002:7f00:1::1` each OPEN_FAIL within 250 ms, `example.com:80` opens; a connection that sends no
HELLO is closed after 10.2 s (code 1000). `/token`: 26 in a row all 200 (the binding counts
approximately); 80 in a row: 40 and then 33 got 200, the rest 429 (`token-rate-80.json`).

**Limits**: the byte budget is per token, not per user — 2 GiB a token, and roughly 20-40 tokens a
minute per IP. The container sleeps after `sleepAfter` (set to 15 minutes in the class) with no
requests; an open WebSocket keeps it awake. Container and egress cost is the account's. A session
past its token's expiry keeps working by design (above).

### 2026-11-27 — verifier (round 2) — VERDICT: refuted

VERDICT: refuted

A fresh session (I was neither the implementer nor round 1's verifier), against head `21610fec8` (code `8b3a524bf`)
and the live `https://wasm-vm-relay.brett-lamy.workers.dev`. I wrote the predictions first
(`evidence/e5-t43a/verifier-r2/predictions.md`), then ran `verifier-r2/long2.mjs` (`long2.json`, sha256 `5c849d5f…`,
about 11 min, 3 WebSockets), `short2.mjs` (`short2.json`, `b56dbf86…`), `ports2.mjs` (`ports2.json`, `68b1c8ae…`), one
`curl` (`cfip-403.*`) and 7 mutants in a scratch `git archive` copy (`run-mutants.py`, `mutants.log`, `7bc248d9…`). The
round-2 mechanisms work as built. The claim fails because of the bound it states: that the number of tokens a client can
get bounds a non-browser client. It does not. The operative bound is the single container, and no one has accepted that.

- R11 "What bounds a non-browser claiming the allowed Origin is then the number of tokens it can get": FAILED.
  Predicted from the code: an authenticated session has no idle timer, no lifetime cap and no per-token session limit (the
  deadline arm in `driver.rs:206` is guarded by `authenticated_token.is_none()`). Each token's 64 concurrent streams and
  120 connects/min (a sliding window, `relay_security.rs:192-205`) therefore last as long as any session that holds it.
  Observed: session B authenticated with T, sent nothing more, not even pings, and was still open 675 s later, 75 s past T's
  expiry (`long2.json` `B_end.aliveForS` 675). A opened `example.com:80` at expiry+75 s and got HTTP 200 (`A_late`). A
  client gets about 45 tokens a minute per IP (R9 below). It can keep every one of them, so the capacity it holds grows
  with time and has no ceiling. Even one minute's tokens (about 45 × 64 streams, 45 × 120 connects/min, 45 × 2 GiB) is
  more than the one container can carry. Every `/ws` goes to the one Durable Object named `RELAY_INSTANCE`
  (`index.js:59`), so one container serves everyone. The real ceiling is therefore that container's capacity: one IP can
  take its whole egress (billed to the account) and its connections or memory (an outage for every user), for as long
  as it likes. Round 1's P9 demand said: "otherwise the claim must stop calling token lifetime a bound, and the user must
  accept that risk explicitly." The claim dropped the lifetime wording, but it now names a different non-bound, and the
  task file records no acceptance by the user. Demand, either of:
  (a) a cap below the container's capacity: a global limit on concurrent sessions and streams in wvrelay, a limit on
  sessions per token, and/or a byte budget per instance per hour. Each needs a test and a live check.
  (b) a claim that states the operative bound as above (one container; per-IP capacity unbounded over time; egress up to
  the instance's throughput), plus the user's explicit acceptance recorded in this file.
  The design itself (a browser session outlives its token because the client has no reconnect; I found no reconnect in
  `crates/slirp/src/ws_proxy` or `crates/wasm-web/src`) is not what I refute.
- R1 a token's budget is shared, and is the same budget after expiry: HELD. A and B both sent HELLO with T. A spent 100
  connects on OPEN 127.0.0.1:80 from expiry−41 s to −36 s, and all 100 got OPEN_FAIL:1 (policy refusals still count,
  because the quota is reserved before the policy runs). At expiry+8 s, B's 10 OPENs all got OPEN_FAIL:1. A's next 20
  got 10 × OPEN_FAIL:1 and then exactly 10 × OPEN_FAIL:2, the quota refusal (`long2.json` `B_after`, `A_after.seq`).
  That is 120 in one window, across expiry and across two sessions. Round 1's code would have purged the entry and given
  30 × FAIL:1.
- R2 a new HELLO with expired T: HELD (`D_expired` closed 1000 after 59 ms).
- R5 HELLO deadline: HELD. A valid HELLO at 9 s authenticated, and OPEN example.com:80 got OPEN_OK and HTTP 200, still
  open at 12 s. With a HELLO due at 12 s, the socket was already closed (1000) at 10.2 s (`short2.json` `hello_at_*`).
- R6 partial or slow HELLO: HELD. I used a raw TLS WebSocket whose frame header promised 300 bytes, then sent one byte a
  second. A close frame came 10.02 s after the upgrade, after 10 bytes (`short2.json` `partialHello`).
- R9 `/token` limit, and spoofing it: HELD, with a looser number. The 42nd plain request in the window got the first 429,
  about 45 a minute counting the script's earlier tokens; the claim says 20, and "roughly 20-40". Once limited, spoofed
  `X-Forwarded-For`, `True-Client-IP`, `X-Real-IP`, `CF-Connecting-IPv6` and `Forwarded` were all 429. A client-supplied
  `CF-Connecting-IP` is refused at Cloudflare's edge: 403 `error code: 1000`, before the Worker runs (`cfip-403.headers`,
  `cfip-403.body`). The header cannot be spoofed from outside. Confirmed.
- R10 the IPv6 limiter key: NEEDS EVIDENCE (follow-up). `index.js` keys the limiter on the whole `CF-Connecting-IP`, so an
  IPv6 client is limited per /128, and one /64 is effectively unlimited. Not tested: this host has no IPv6
  (`curl -6` failed). Key on the /64 for IPv6.
- R7 ports: HELD for 25, follow-up for the rest. `aspmx.l.google.com:25` got OPEN_FAIL:1 in 33 ms.
  `smtp.gmail.com:587` and `:465` got OPEN_OK (connect-and-close only), and the new unit test asserts that they stay
  allowed. Submission needs credentials, so this is not refuting. Other abuse ports (22, 23, 3389, 445) are a policy
  choice to file with the cap.
- R8 IPv6 forms: HELD for the claimed forms (`::127.0.0.1` got OPEN_FAIL:1 in 37 ms; the worker's run covered NAT64 and
  6to4). Not covered: the SIIT form `::ffff:0:0/96` (`::ffff:0:7f00:1`, `::ffff:0:a9fe:a9fe`) and site-local `fec0::1`.
  Policy lets them through (no refusal within 3 s, while the session stayed up), and they then go nowhere, so I found no
  breach. Follow-up: judge `::ffff:0:a.b.c.d` by its embedded address, and refuse `fec0::/10`.
- Mutants (scratch copy, `mutants.log`; each run: the slirp `ws_proxy` lib tests plus wvrelay's three integration tests):
  M1 retain-by-expiry-only and M2 `open_session` not counting are killed by
  `a_session_keeps_its_budget_after_the_token_expires`. M6, the 6to4 branch removed, is killed by
  `embedded_ipv4_forms_and_blocked_ports`. M7, the deadline removed, is killed by
  `secure_relay_closes_a_connection_that_never_authenticates`. Three SURVIVED, a FAILED sufficiency check:
  M4: deadline guard without `authenticated_token.is_none()`. Every authenticated session is then cut at 10 s, which
  breaks the round's central design, and all tests pass.
  M5: port check removed from `resolve_destination` (`driver.rs:725`). The test calls only the helper.
  M3: `close_session` a no-op, so entries leak forever. The test's final assertion holds anyway, because t1 is full
  (100/100), so "t1's entry is gone" checks nothing.
  Demand: a test that holds an authenticated session past `HELLO_DEADLINE` and still opens a stream; one that sends OPEN
  to a public host on port 25 through the driver; and an entry-gone assertion that fails while the entry exists (leave t1
  with spare budget).
- R12 secrets: HELD. The round-2 commits add no 64-hex run and no secret assignment. `.wrangler/` is empty and ignored.
  `web/dist` mentions the relay only in task text. The new evidence holds no token values (`secret-hygiene.log`).
- Deployed binary: the gitignored `deploy/cloudflare-relay/wvrelay` (static x86-64, 15:14, before the 15:18 commit)
  contains `relay_hello_deadline` and `WVRELAY_MAX_BYTES_PER_TOKEN`, and the live behaviour matches the new code (R1, R5,
  R7). Not byte-compared with a build of this head.
- Carried forward from round 1 as HELD, with the code unchanged on those paths: P1–P4 Worker surface, P5/P6 token and
  Origin at wvrelay, P10/P11 protected destinations, P14 happy paths.
- SUITE: none promoted. `verifier-r2/long2.mjs` is the deployed check that the budget is shared across expiry; together
  with `short2.mjs`'s 9 s, 12 s and partial-HELLO cases it should become the next `hardening.mjs`. Note: `short2.json`'s
  `portsAndV6` block is void (my script sent CLOSE after an OPEN_FAIL, a protocol error that closed the session);
  `ports2.json` is the valid rerun.

Commands: `node evidence/e5-t43a/verifier-r2/long2.mjs`; `node evidence/e5-t43a/verifier-r2/short2.mjs`;
`node evidence/e5-t43a/verifier-r2/ports2.mjs`; `curl -H 'CF-Connecting-IP: 198.51.100.7' …/token`;
`python3 -I evidence/e5-t43a/verifier-r2/run-mutants.py` (in a scratch copy from `git archive HEAD`, with RUSTFLAGS and
CARGO_* unset). Not checked: any load (I did not measure how many sessions or streams the container survives, or its
throughput); IPv6 rotation (no IPv6 here); the Cloudflare dashboard, logs and billing; a 2 GiB budget exhausted live
(only the connect budget was driven to its limit); UDP after expiry (it shares `reserve_quota_stream`, by the code).

### 2026-11-27 — worker — round 3 claim (head `32029ac72`)

The refutation is right: with sessions outliving tokens, nothing bounded how many sessions one
client could hold. This round caps them; sessions still outlive their tokens (the client has no
reconnect), and the bound no longer rests on the number of tokens.

**The bounds, as they now are** (commit `32029ac72`):
- **Per client: at most 8 authenticated sessions at once**, the client being its IPv4 address or
  its IPv6 /64, named by the Worker from `CF-Connecting-IP` (set by Cloudflare; the round-2
  verifier found a caller-supplied one rejected) and passed in `x-wvrelay-client`, which the
  Worker always overwrites. wvrelay refuses a ninth at HELLO; closing one frees its place.
- **In all: at most 256 authenticated sessions.** So one client holds at most 8/256 of the relay.
- Per token, as in round 2: 2 GiB, 120 connects a minute, 64 concurrent streams, shared by its
  sessions and lasting past expiry. Unauthenticated connections close at 10 s. Port 25 refused.
- `/token`: per client key, about 20 a minute (approximate per location).

So one client's share is bounded in concurrency (8 sessions × 64 streams) and in bytes per
session (2 GiB, then that session can open no more), but not in bytes over time: it can close a
spent session and open another with a new token. The container's own link (250 Mbit/s,
`wrangler containers info`) is shared by everyone. That is the residual risk of a public relay
the user chose; the user is told it in the summary of this round.

**Tests**: `cargo test -p wasm-vm-slirp --features native --lib` 272 passed; new
`sessions_are_capped_per_client_and_in_total`, `an_authenticated_session_outlives_the_hello_deadline`,
`a_client_over_its_session_cap_is_refused_and_a_closed_session_frees_a_place`,
`the_public_relay_never_resolves_a_blocked_port`; the "entry is gone" assertion now records
zero bytes. Mutants (applied to the file, restored after each): cutting every session at the
deadline, removing the port check from `resolve_destination`, `close_session` not freeing the
client's place, `close_session` not decrementing the token's sessions, and no per-client cap — all
five caught. wvrelay smoke and token-rejection integration tests pass; clippy clean (two lint
allows on the handshake function, which now takes the TCP peer).

**Live** (`relay-4`): `smoke.mjs` passes (`smoke-live-r3.json`). `hardening.mjs`
(`hardening-live-r3.json`): ten authenticated sessions from this machine — 8 served, 9th and 10th
closed; after the ten close, a new one is served; port 25 and the three IPv6 forms OPEN_FAIL within
221 ms; no HELLO closed at 10.2 s; `/token` 23 of 26 then 429.
