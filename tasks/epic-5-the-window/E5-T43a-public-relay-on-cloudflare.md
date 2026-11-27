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
