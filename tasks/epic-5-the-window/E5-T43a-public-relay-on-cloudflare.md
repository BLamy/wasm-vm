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
