---
id: E5-T43a
epic: 5
title: Network for everyone — the wvrelay WebSocket relay deployed on Cloudflare, with tokens for the page's origin
priority: 0.38766
status: verified
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

### 2026-11-27 — verifier (round 3) — VERDICT: refuted

VERDICT: refuted

A fresh session (I was not the implementer or either earlier verifier), against head `3bde7fe1c` (code `32029ac72`)
and the live `https://wasm-vm-relay.brett-lamy.workers.dev` (`relay-4`). I wrote the predictions first
(`evidence/e5-t43a/verifier-r3/predictions.md`). Then I ran: `verifier-r3/live3.mjs` (`live3.json`, sha256 `b0412c91…`,
34 WebSockets, connect-only); `local-hold.mjs` against native wvrelay built at this head on loopback with a throwaway
secret (`local-hold.json`, `60c60dff…`); 11 mutants in a scratch `git archive HEAD` copy (`run-mutants.py`,
`mutants.log`, `af0ddca1…`); and `clientkey.mjs` (`clientkey.log`). The session cap works as built, live and in code.
The claim fails on a bound it restates: that unauthenticated connections close at 10 s. The relay sends a Close frame
then. It does not drop the connection, so a client that ignores the Close keeps it. The same holds for a session refused
at the cap.

- Q5 "Unauthenticated connections close at 10 s", and a refused session holding resources: FAILED. Predicted from
  `ws_adapter.rs:277-289`: when `RelayServer::run` returns (HELLO deadline, refusal at the cap, bad token), the writer
  sends a Close frame. `bridge_ws` then keeps reading `ws_stream.next()` until the *client* sends Close or a binary
  frame, or drops TCP. Nothing closes the socket from the relay's side, and nothing times out.
  Observed locally: 30 server-side ESTABLISHED sockets at 62 s (`local-hold.json` `at62s.serverSockets`). They were
  8 live sessions, plus 22 connections the relay had finished with: a no-HELLO connection whose Close came at 10.0 s, a
  ninth session refused `SessionsPerClient` (Close at 1 ms), and 20 more no-HELLO connections. All 20 got a Close frame,
  and the server ended none of them (`many.serverEnded` 0). They went only when the client tore them down.
  Observed live: a raw TLS client got Close at 0.2 s for a session refused at the cap, and at 10.2 s for no HELLO. Both
  connections were still open at 116 s, with no TCP end from Cloudflare (`live3.json` `Q5_end`).
  The relay counts sessions, but nothing counts these connections, so one IPv4 client can pile up an unbounded number of
  them on the one container. Each holds a socket, a task and buffers, for as long as it likes. That is the outage route
  through "connections or memory" that round 2 (R11) asked to be capped; the session cap closes it only for
  authenticated sessions.
  Demand: after `run` returns, the relay ends the connection itself. Finish the close handshake with a short timeout,
  then drop the TCP stream: stop the reader when the writer is done, or wrap it in a deadline. Add a test that a client
  which never answers Close is disconnected within a bound, for both the HELLO deadline and a refusal at the cap. Add a
  live check like `live3.mjs` Q5. Optionally also cap unauthenticated connections per client.
- Round 2's demand, "a real cap, or the user's explicit acceptance": partly met.
  - Concurrency: met, a real cap (Q1, Q2, Q4 below).
  - Bytes over time: neither capped nor accepted. The claim states the residual honestly, but it says "the user is told
    it in the summary of this round". That is notice, not acceptance, and no acceptance is recorded in this file.
    NEEDS EVIDENCE: the user's explicit acceptance recorded here, or a per-client or per-instance byte budget per hour.
  - Lockout, new with this round's total cap, and not stated in the claim. Authenticated sessions still have no idle
    limit (round 2 R11: 675 s, no pings; the `driver.rs:207` guard is unchanged). So 32 IPv4 addresses that hold 8 idle
    sessions each fill all 256 places, and keep every other user out at no egress cost. The IPv6 key is a /64
    (`clientkey.log`: one routed /56 gives 256 keys × 8 = 2048 places), so one actor with a common residential /56, or
    a free tunnel-broker /48, can do it alone. Not tested live (this host has no IPv6).
    Demand, either of: (a) an idle limit for authenticated sessions, and/or a coarser IPv6 key (a /56 or /48) plus a
    cap per prefix; or (b) the lockout stated in the claim and accepted by the user in this file.
- Q1 the Worker overwrites `x-wvrelay-client`: HELD live. Ten sessions, each sending its own random `x-wvrelay-client`,
  `X-Forwarded-For` and `True-Client-IP`: 8 served, the 9th and 10th closed 1000 (`live3.json` `Q1_spoofedHeaders`). A
  raw client's own header was refused at the cap as well (`Q5`).
  Reached directly, wvrelay trusts the header: 10 sessions with 10 header values were all served locally
  (`local-hold.json` `directHeaderSpoof`). The Worker is therefore the only guard. That is acceptable, because the
  container has no ingress except `relay.fetch` in `/ws`, which always sets the header (`index.js:72-76`; Q6 by code
  read: `/health`, `/token`, 404 and 426 never touch the container).
- Q2 a refused session leaks no place: HELD. After the ten (two refused) and a version-mismatch HELLO closed, 8 of 9 new
  sessions were served and the 9th was refused (`Q2_recount`). Q3: a HELLO with version 2 closed 1000. `open_session`
  runs before `on_hello` rejects the version, so the session is opened and then closed once (`driver.rs:277-288` →
  break → `close_session`), and the recount shows no leak.
- Q4 twelve HELLOs at once: HELD, exactly 8 served (`Q4_race`). The check and the increment happen under one lock.
- Per-client cap live: NEEDS EVIDENCE (the sufficiency of the claim's live proof). All live tests come from one
  address. If wvrelay ignored the header, every Cloudflare connection would come from the same peer, and the result
  would be identical: 8 places in all instead of 8 per client. Mutant V4 (the header ignored, the peer IP always used)
  SURVIVED every test (`mutants.log`): no Rust test sends `x-wvrelay-client`, so the per-client keying is not proven
  anywhere. Demand: a `ws_adapter` test in which two header values each get their own places, and the header falls
  back to the peer IP when empty or over 64 bytes (V6, the length filter removed, also survived). Plus one live check
  from a second address while the first holds 8 sessions.
- Mutants (scratch copy, restored after each; slirp `ws_proxy` lib tests and wvrelay's three integration tests): the
  worker's five are KILLED. W1 cuts every session at the deadline; W2 removes the port check in
  `resolve_destination`; W3 means close never frees the client's place; W4 means close never decrements the token's
  sessions; W5 removes the per-client cap. Mine: V1 (`>` for `>=` per client), V2 (no total cap), V3 (close never
  decrements the total) and V5 (a refusal is ignored) are KILLED. V4 and V6 SURVIVED (above).
- Q9 NAT: 8 sessions per IPv4 address are shared by everyone behind one NAT or CGNAT, so a ninth desktop on a campus
  or carrier network is refused. The claim does not say so. A demo-scale limit, not refuting; state it with the
  lockout.
- `clientKey`: normalizes only letter case, not leading zeros (`2001:0db8:…` and `2001:db8:…` give different keys),
  and an IPv4-mapped `::ffff:a.b.c.d` maps to `0:0:0:0::/64`. Cloudflare sends canonical addresses, so a caller cannot
  use either; noted, not a finding.
- Carried forward as HELD, with the code and deployment unchanged on those paths: round 1 P1–P4, P5/P6, P10/P11 and
  P14; round 2 R1, R2, R5 (client side), R6, R7 (25 refused), R8, R9 and R12. This round's sessions got OPEN_OK to
  `example.com:80` (the happy path). I did not run `smoke.mjs` again. Secrets: my evidence writes no token
  (`grep` finds no `v1` token or long base64 run in `verifier-r3/`), and the round-3 diff adds no secret value.
- SUITE: none promoted until the refutation clears. `verifier-r3/live3.mjs` Q1–Q5 and `local-hold.mjs` should become
  part of `hardening.mjs` and a Rust test.

Commands: `node evidence/e5-t43a/verifier-r3/live3.mjs`;
`node evidence/e5-t43a/verifier-r3/local-hold.mjs <wvrelay built by cargo build -p wasm-vm-cli --bin wvrelay>`;
`python3 -I evidence/e5-t43a/verifier-r3/run-mutants.py <scratch git-archive copy>`, with RUSTFLAGS, RUST_LOG and
CARGO_* unset; `node evidence/e5-t43a/verifier-r3/clientkey.mjs deploy/cloudflare-relay/src/index.js`.
Not checked: anything from IPv6 or a second address; the container's fd and memory limits (how many held connections it
takes to cause an outage; no load was run); whether the Cloudflare edge or the Durable Object would end a held
connection after more than 116 s; whether the deployed image is byte-for-byte this head's wvrelay (the live behaviour
matches the code); the Cloudflare dashboard, logs and billing.

### 2026-11-27 — worker — round 4 claim (head `edaf2824b`)

**User decision, recorded** (2026-11-27, asked after round 3 with the two residual risks spelled
out: traffic over time per client uncapped, and idle sessions able to fill every place): the user
chose **"Add both caps"** — an hourly byte cap per client and closing sessions idle for 30
minutes, accepting that a desktop left idle that long loses its network until reloaded (the
client has no reconnect yet).

**Changed** (commit `edaf2824b`):
- **Finished connections are dropped by the relay** (`ws_adapter.rs` `bridge_ws`): once the relay
  side ends a session — the HELLO deadline, a refusal at a cap, a protocol error — it sends Close
  and drops the connection after `CLOSE_GRACE` (2 s), whatever the client does.
- **Caps** (`RelayLimits` defaults): 4 authenticated sessions per client, 1024 in all; **5 GiB per
  client per clock hour** across all its sessions and tokens; a session with **no traffic in either
  direction for 30 minutes is closed**, open streams or not; per token as before (2 GiB via the
  Worker, 120 connects/min, 64 streams).
- **Client key**: IPv4 address, or IPv6 /48 (round 3: /64), from `CF-Connecting-IP`; the Worker
  always overwrites `x-wvrelay-client`.

**Tests** (`cargo test -p wasm-vm-slirp --features native --lib`, 277 passed; relay smoke and
token-rejection integration tests pass; clippy clean): raw WebSocket clients written by hand that
never answer Close are dropped — the never-authenticating one after the deadline, the one refused
at the cap within the grace — while an authenticated one is kept
(`a_finished_connection_is_dropped_even_if_the_client_never_answers_close`); the cap is per client
name (two names get their own places, the same name shares one, an overlong header falls back to
the TCP peer: `the_session_cap_is_per_client_name`); hourly bytes per client
(`a_client_byte_budget_per_clock_hour`, `a_client_past_its_hourly_bytes_gets_no_more_data_through`);
idle closed, active kept by data-free frames (`an_idle_session_is_closed_and_an_active_one_kept`).
Mutants, each applied and the file restored: no forced close, the client header ignored, no
length limit on it, the idle check never closing, client bytes not checked, inbound frames not
refreshing activity — all six caught.

**Live** (redeployed, `relay-5`; container application version 6): `smoke.mjs` passes
(`smoke-live-r4.json`). `hardening.mjs` (`hardening-live-r4.json`): six authenticated sessions
from this machine — 4 served, 5th and 6th closed, and after they close a new one is served; port
25 and the three IPv6 forms OPEN_FAIL within 209 ms; an unauthenticated `ws` client is closed at
10.2 s.

**What the live raw clients show, and what they do not.** Raw TLS clients that never answer Close
(`rawNoHello`, `rawRefusedAtCap`) were NOT dropped within 30 s and 20 s. Between them and the
container sits the Containers library's WebSocket proxy (`containerFetch`): when the container
side closes, it forwards a Close to the client, and the Cloudflare edge then holds the client's
half until the client answers — a Worker has no call that aborts it. The container side is dropped
(the local raw-client tests above, against wvrelay at this head), and the refused session's place
is free (after those clients, a new session of the same client is served). So a held connection
now costs the Cloudflare edge, not the container's file descriptors, memory or session places;
how long the edge keeps it is Cloudflare's, not measured here.

**Limits, as they now are**: everyone behind one NAT shares 4 sessions and 5 GiB an hour; a
desktop idle 30 minutes loses its network until reloaded; the token rate limit is approximate
(26 of 26 allowed in this run, 33-40 of 80 in earlier ones); 256 IPv4 addresses (or /48s) each
holding 4 sessions can still fill all 1024 places.

### 2026-11-27 — verifier (round 4) — VERDICT: needs-evidence

VERDICT: needs-evidence

A fresh session (I was not the implementer or any earlier verifier). I checked head `091cb8ab1` (code `edaf2824b`) and
the live `https://wasm-vm-relay.brett-lamy.workers.dev` (`relay-5`). I wrote the predictions first
(`evidence/e5-t43a/verifier-r4/predictions.md`). Then I ran, in this order: `verifier-r4/live4.mjs` (`live4.json`, sha256
`04f2cde2…`, 23 WebSockets); `idle4.mjs` (`idle4.json`, `daf995d6…`, 32 min, 7 WebSockets); the gates and 14 mutants in a
sparse `git clone --shared` scratch copy at this head (`gates.log`, `mutants.log` `8ffd55f4…`); round 3's `local-hold.mjs`
against wvrelay built at this head (`local-hold.json`, `289fd218…`); `smoke.mjs` (`smoke.json`, SMOKE PASS); and
`idle5.mjs` (`idle5.json`, 32 min, 6 WebSockets).
Nothing I ran contradicts the round-4 product claim. Two of round 3's demands are met. Three proofs are still missing,
and only tests and evidence are needed to close them. One is round 3's live check from a second address. The other two
are driver-level tests: the one the claim cites for the hourly cap proves nothing, and the idle close's cleanup has none.

- Round 3 demand (1), the relay drops finished connections: HELD, container side.
  - Local: at 62 s the relay holds 4 server sockets, the 4 live sessions. Round 3 held 30 at the same point. A no-HELLO
    client got Close at 10.003 s and was disconnected at 12.061 s. A client refused at the cap got Close at 0 s and was
    disconnected at 2.002 s. 20 more no-HELLO clients that never answered were all disconnected (`local-hold.json` `at62s`).
    Mutant W1 (no forced close) is KILLED.
  - Live: 18 raw clients that never answer Close each got exactly one Close (1000). 16 were no-HELLO clients (Close at
    10.17–10.21 s). One was an authenticated session ended by an undecodable frame (Close at 1.74 s after upgrade).
    Frames sent after the Close got no bytes back: a valid HELLO plus an OPEN 5 s later, and an OPEN 7 s later
    (`live4.json` `S2_end`). With all 18 held, 4 new sessions were served, one got `HTTP/1.1 200 OK`, and the 5th was
    refused (`S3_withHeld`). So the protocol-error session's place was freed while its edge connection stayed open.
  - Deployed binary: the gitignored `deploy/cloudflare-relay/wvrelay` contains the round-4-only string
    `relay_session_idle_closed`.
  - Residual, stated in the claim: none of the 18 got a TCP end from Cloudflare (`serverEnded` 0). The edge keeps the
    client's half. Not measured: what that costs the edge or the Durable Object.
- Round 3 demand (2), the cap is per client: HELD in code, NEEDS EVIDENCE live.
  - Code: `the_session_cap_is_per_client_name` passes. W2 (header ignored) and W3 (no length limit) are KILLED.
  - Live: round 3 asked for "one live check from a second address while the first holds" its sessions. The claim does
    not mention it, and no evidence has it. From one address, a Worker that keyed every client the same would give the
    identical result: 4 places for everyone, so one client could lock out all users. I could not run it: this host has
    no IPv6 (`ipv6-check.log`, curl rc 7) and one IPv4 egress.
  - Demand: one live run from a second address (IPv6, a hotspot or a VPS) while this address holds 4 sessions.
  - Nit: V3 (an empty `x-wvrelay-client` accepted as a name) SURVIVED. The Worker never sends an empty one.
- Round 3 demand (3), bytes over time and the idle lockout: HELD as accepted. The user's choice ("Add both caps") is now
  recorded in this file.
  - Hourly cap: the code is right, but its driver-level proof is NEEDS EVIDENCE.
    `a_client_past_its_hourly_bytes_gets_no_more_data_through` never grants WINDOW credit, so nothing can be echoed back
    whether or not the budget is checked. I printed its state in the scratch copy: `echoed=0 ended=true` as written, and
    `echoed=0 ended=false` with the driver's client-budget check removed. Both pass.
    The suite does not kill W5 (the driver ignores `record_client_bytes`) or V6 (the hourly budget keyed by token, not
    client). W5b (the registry never refuses) is KILLED, by `a_client_byte_budget_per_clock_hour`.
    My scratch test, `verifier-r4/verifier_tests.rs` `verifier_hourly_bytes_are_per_client_across_tokens`, passes on this
    head. In it, client c1 echoes 40 of 40 bytes on token t1. A second token of c1 is then RST with 0 echoed, and client
    c2 still echoes 40. It kills W5 and V6 (`mutants-with-verifier-tests.log`).
    Demand: commit a driver test of this strength.
  - Clock-hour edges, observation: the window is a fixed clock hour, not a sliding one. A client can move up to
    2 × 5 GiB within seconds across H:59:59 and H+1:00:00. That is consistent with "per clock hour". State it if the
    bound is meant over any 60 minutes.
- Idle limit, live: HELD on the relay side.
  - idle5: a raw session idle since 2.3 s got Close (1000) at 1830.1 s, 30:28 after its last frame. It still held its
    place at 29 min (N1–N3 served, N4 refused) and the place was free by 31 min (N5 served). An OPEN it sent afterwards
    got nothing.
  - idle4: two sessions sending only WINDOW frames (one every 240 s, no bytes) were still open and served at 32 min.
    The places of A (idle, with an open TCP stream) and D (idle, no stream) were freed: E and F were served and G
    refused at 1923 s.
  - Unexplained, observation: in idle4, A and D (`ws` 8.23.1 clients, which answer a Close and emit `close` within its
    30 s close timeout) never emitted `close` in 32 min. So they never received the relay's Close, although their places
    were freed. In idle5 the raw client did receive it.
    Demand: one idle run from the real page (browser WebSocket), to show what a desktop sees after 30 minutes. The user
    accepted "loses its network until reloaded"; a page that is never told cannot even say so.
  - Tests: NEEDS EVIDENCE. V1 (the idle close returns and skips the cleanup, so the client's place and the token's
    streams leak for good) SURVIVED the suite. My `verifier_idle_close_frees_the_place` passes on this head and kills it.
    V2 (outbound data does not refresh activity) SURVIVED. The claim says "no traffic in either direction", but only the
    inbound half is tested. W4 (the idle check never closes) and W6 (inbound frames do not refresh) are KILLED.
    Demand: tests that kill V1 and V2.
- 1024 in all as a lockout: HELD as a stated limit. The claim says that 256 IPv4 addresses (or /48s) holding 4 sessions
  each fill every place. With the idle limit, that takes one frame per session every 30 minutes.
  - Follow-up, not refuting: 1024 sessions × 64 streams is up to 65,536 backend sockets on one basic instance. Neither
    the Dockerfile nor wvrelay raises `RLIMIT_NOFILE`, and nobody has measured the instance's fd or memory ceiling. So
    the total cap bounds places; it is not shown to be below the container's capacity. Measure it, or raise or clamp the
    limit.
- Worker's six mutants: W1, W2, W3, W4 and W6 are KILLED. "Client bytes not checked" is KILLED if it is the registry
  variant (W5b). The driver variant W5 SURVIVES (above). Mine: V4 (the hour never resets), V5 (`<=` to `<`) and V7 (a
  daily window) are KILLED. V1, V2, V3 and V6 SURVIVED.
- Gates at the exact head (scratch clone, with RUSTFLAGS, RUST_LOG and CARGO_* unset): `cargo fmt --check` passes.
  `cargo test -p wasm-vm-slirp --features native --lib`: 277 passed. The wvrelay smoke, token-rejection and
  ws-connector tests: 3 + 1 + 5 passed. Clippy with `-D warnings` is clean. The diff adds no `#[ignore]` and disables no
  `debug_assert`.
- Secrets: HELD. The round-4 diff adds no 64-hex run and no secret assignment, and my evidence holds no token
  (`secret-hygiene.log`).
- Carried forward as HELD (code and deployment unchanged on these paths): round 1 P1–P4, P5/P6, P10/P11 and P14; round 2
  R1, R2, R5–R9 and R12; round 3 Q1–Q4. This round's live sessions all got OPEN_OK to example.com:80, and `smoke.mjs`
  passes again.
- SUITE: none promoted yet. `verifier-r4/verifier_tests.rs` is offered for `ws_adapter_tests.rs`.
  `live4.mjs` (S2/S3) and `idle5.mjs` should join `hardening.mjs` (the idle one as a slow, opt-in check).

What closes this (tests and evidence only, so no full gauntlet restart):
1. The second-address live check.
2. Driver tests that kill W5, V6, V1 and V2.
3. One browser-page idle run.

Commands: `node evidence/e5-t43a/verifier-r4/live4.mjs`; `node …/idle4.mjs`; `node …/idle5.mjs`;
`node deploy/cloudflare-relay/smoke.mjs --base https://wasm-vm-relay.brett-lamy.workers.dev --out evidence/e5-t43a/verifier-r4/smoke.json`;
`node …/local-hold.mjs <scratch>/target/debug/wvrelay`; `python3 -I …/run-mutants.py <scratch clone>` (with and without
`verifier_tests.rs` appended there).
Not checked:
- anything from IPv6 or a second address;
- load: the container's fd and memory ceiling, the Durable Object's or edge's cost of held connections, and how long
  the edge keeps them;
- a 5 GiB hour spent live;
- why idle4's `ws` clients never saw the Close;
- the Cloudflare dashboard, logs and billing;
- a byte-for-byte match of the deployed image with this head (the strings and the behaviour match).

### 2026-11-27 — worker — round 5 claim (head `db41616ae`)

Answers to round 4's three demands. Commit `db41616ae`; tests and the Worker's code structure
only — wvrelay's code is as in round 4.

1. **Live per-client check from a second address: not done, and not possible here** (this
   machine has one IPv4 address and no IPv6; the round-4 verifier had the same). Instead the
   chain is proven link by link: (a) the Worker's half — `src/client.js` (extracted from
   `src/index.js`, behaviour unchanged) with `deploy/cloudflare-relay/test/client.test.mjs`
   (`node --test`, 3 passed): two IPv4 clients get two keys, IPv6 is keyed by /48 however it is
   written, and `relayHeaders` always sets `x-wvrelay-client` from `CF-Connecting-IP` whatever the
   caller sent (including empty, 200 characters, and another client's address); (b) wvrelay's
   half — `the_session_cap_is_per_client_name` (two names, own places; same name, shared; an
   overlong or empty name falls back to the TCP peer); (c) live, a caller's own header is
   overwritten (round 3, HELD; Worker unchanged since but for the extraction, redeployed:
   `smoke-live-r5.json` passes).
2. **Tests that fail on the surviving mutants**: the round-4 verifier's two tests adopted
   (`verifier_hourly_bytes_are_per_client_across_tokens`, `verifier_idle_close_frees_the_place`),
   the weak hourly test removed; new `outbound_traffic_alone_keeps_a_session_active` and the empty
   header case. The verifier's own runner over all 14 of its mutants at this head
   (`python3 -I evidence/e5-t43a/verifier-r4/run-mutants.py <repo>`, files restored after each;
   `mutants-r5.log`): **14 of 14 killed**, including W5, V1, V2, V3 and V6, which survived round 4.
   `cargo test -p wasm-vm-slirp --features native --lib`: 101 relay tests pass; clippy clean.
3. **Browser-page idle run: moved to E5-T43d**, whose acceptance now has it (a desktop untouched
   for 31 minutes loses its relay session, the page shows it, a reload restores it). It needs the
   online desktop, which this task does not build.

### 2026-11-27 — verifier (round 5) — VERDICT: verified

VERDICT: verified

A fresh session (I was not the implementer or any earlier verifier). I checked head `8a06ef267` (change `db41616ae`;
wvrelay code as in `edaf2824b`) and the live `https://wasm-vm-relay.brett-lamy.workers.dev` (`relay-5`). I wrote the
predictions first (`evidence/e5-t43a/verifier-r5/predictions.md`). Then I ran: `header5.mjs` (`header5.json`, sha256
`28d711f0…`, 8 WebSockets); `browser-idle.mjs` (`browser-idle.json`, `f1b66495…`, headless Chromium 159, 2 WebSockets,
31 min); `gates.sh` and round 4's mutant runner in a scratch `git clone --shared` sparse clone at this head, with
RUSTFLAGS, RUST_LOG and CARGO_* unset (`gates.log` `887b0d11…`, `mutants.log` `d61a4d8b…`, `mutants-killers.log`);
`js-mutants.py` on `src/client.js` (`js-mutants.log`); `smoke.mjs` (`smoke.json`, SMOKE PASS); and read-only checks of the
deployed Worker (`deployed-worker.log`, `containers-header-path.log`). Round 4's three demands are met or soundly
substituted. Nothing I ran contradicts the claim.

- Demand (1), per-client keying live: HELD by substitute. A second address is not available here either: no IPv6
  egress (`second-address.log`, `curl -6` rc 7) and one IPv4. The worker's link-by-link chain holds, and I closed the two
  links it left open:
  - (a) Worker source: `node --test test/client.test.mjs` passes 3 of 3. My six mutants of `src/client.js` are all
    KILLED: caller's header kept, a constant key, a /64 key, `X-Forwarded-For` first, no lowercasing, other headers
    dropped (`js-mutants.log`).
  - (b) Deployed Worker = this source (open in the claim): the current deployment is version `731688b9…` (no. 13), made
    48 s before `db41616ae` was committed. Its `index.js`, fetched read-only from the account's API, is byte-identical to
    `wrangler deploy --dry-run` of this head, with the `sourceMappingURL` line removed (sha256 `b63cd33a…` for both,
    diff 0 lines). Its bindings match `wrangler.jsonc`.
  - (c) The header reaches wvrelay (open in the claim; no single-address test can see it, because a dropped header
    falls back to the container's TCP peer, the same for everyone): `@cloudflare/containers` 0.3.7, bundled above,
    passes the whole Request to `tcpPort.fetch(containerUrl, request)` (`container.js:891`). The same path carries the
    Origin that wvrelay refuses live (round 1 P5/P6). `switchPort` overwrites `cf-container-target-port`, so a caller
    cannot pick 8081.
  - (d) wvrelay keys by the header: W2, W3 and V3 are KILLED (below).
  - Live overwrite (L1): sessions sending their own `x-wvrelay-client` (random, 200 characters, another IPv4), plus
    `X-Forwarded-For` and `True-Client-IP`. 4 were served (OPEN_OK to example.com:80) and the 5th–7th were closed 1000 at
    1.6–2.3 s. After all closed, an 8th was served (`header5.json`).
  - Residual, not refuting: that Cloudflare sets `CF-Connecting-IP` to each real client is the platform's guarantee and
    untested here. One live run from a second network would still be worth doing once one is to hand.
- Demand (2), tests that kill the survivors: HELD.
  - Round 4's runner at this head: 14 of 14 KILLED, no invalid mutant, and the scratch tree clean afterwards
    (`mutants.log`).
  - Each round-4 survivor is killed by the test written for it: W5 and V6 by
    `verifier_hourly_bytes_are_per_client_across_tokens`, V1 by `verifier_idle_close_frees_the_place`, V2 by
    `outbound_traffic_alone_keeps_a_session_active`, and V3 by the empty-name case of `the_session_cap_is_per_client_name`
    (`mutants-killers.log`).
  - The weak hourly test that was removed is superseded: its replacement grants WINDOW credit and kills what the old one
    could not.
  - Gates at the head:
    - `cargo fmt --check` passes.
    - `cargo test -p wasm-vm-slirp --features native --lib`: 279 passed, 3 runs in a row, so the new timing tests did not
      flake here.
    - wvrelay smoke, token-rejection and ws-connector tests: 3 + 1 + 5 passed.
    - clippy with `-D warnings` is clean.
    - The diff adds no `#[ignore]` and disables no `debug_assert`.
- Demand (3), the browser-page idle run: HELD, and the move to E5-T43d is legitimate.
  - My bounded attack ran a real Chromium page at the allowed origin `http://127.0.0.1:8125`. It fetched `/token` itself
    (CORS) and opened `wss://…/ws`. B1 sent HELLO + OPEN (OPEN_OK) and B2 sent HELLO only; then both stayed silent. Both
    got a `close` event with code 1000, `wasClean: true`, at 1830 s after their last frame (`browser-idle.json`).
  - So the relay's idle Close does reach a browser WebSocket through the Containers proxy. Round 4's idle4 anomaly
    (`ws` clients never told) does not reproduce in a browser.
  - What the desktop shows the user is page behaviour that this task does not build. E5-T43d's acceptance now owns it.
  - Page console: only the 404 of the blank page I used.
- Worker extraction: no behaviour change, HELD. `clientKey` moved byte-for-byte (diff of the function bodies is empty).
  `relayHeaders` adds `delete` before `set`, which changes nothing because `set` already replaces. `/token` still keys
  the limiter by `clientKey`. `smoke.mjs` passes live (happy path TCP/UDP, the protected addresses, and the token and
  Origin refusals).
- Secrets: HELD. The round-5 diff adds no 64-hex run and no token. My evidence holds no relay token and no OAuth token
  (`secret-hygiene.log`; the one 64-hex string is the bundle hash). The deployed bundle has the HMAC secret only as a
  `secret_text` binding.
- Carried forward as HELD (code and deployment unchanged on these paths): round 1 P1–P4, P5/P6, P10/P11 and P14; round 2
  R1, R2, R5–R9 and R12; round 3 Q1–Q4; round 4: demand (1) (the relay drops finished connections), the hourly cap and
  idle limit as accepted by the user, the idle limit live, and the 1024-in-all lockout as a stated limit.
- Follow-ups, not refuting, as round 4 filed them: measure the container's fd and memory ceiling against 1024 × 64
  streams; IPv4-embedded IPv6 classification; a port policy beyond 25.
- SUITE: the round-4 verifier's two tests are already promoted. I offer `verifier-r5/header5.mjs` (the overwrite and
  recount) and `browser-idle.mjs` (slow, opt-in) for `hardening.mjs`. Nothing else is promoted.

Commands: `node evidence/e5-t43a/verifier-r5/header5.mjs`; `node evidence/e5-t43a/verifier-r5/browser-idle.mjs`;
`bash evidence/e5-t43a/verifier-r5/gates.sh <scratch clone>`;
`python3 -I evidence/e5-t43a/verifier-r4/run-mutants.py <scratch clone>`;
`python3 -I evidence/e5-t43a/verifier-r5/js-mutants.py <copy of src/client.js + test/>`;
`node deploy/cloudflare-relay/smoke.mjs --base https://wasm-vm-relay.brett-lamy.workers.dev --out evidence/e5-t43a/verifier-r5/smoke.json`;
`npx --no-install wrangler deployments list|versions view` and `wrangler deploy --dry-run --outdir <scratch>` (no deploy).
Not checked:
- anything from IPv6 or a second address;
- load: the container's fd and memory ceiling, and what held edge connections cost;
- a 5 GiB hour spent live;
- the Cloudflare dashboard, logs and billing;
- a byte-for-byte match of the deployed container image (only the Worker bundle was compared);
- the online desktop's UI at the idle limit (E5-T43d).
