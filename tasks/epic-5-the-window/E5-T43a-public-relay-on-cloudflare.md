---
id: E5-T43a
epic: 5
title: Network for everyone — the wvrelay WebSocket relay deployed on Cloudflare, with tokens for the page's origin
priority: 0.38766
status: pending
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
