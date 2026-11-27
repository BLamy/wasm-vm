# wasm-vm public relay on Cloudflare (E5-T43a)

Gives a wasm-vm guest outbound TCP and UDP through the existing `wvrelay` (the E3-T16
WebSocket proxy protocol, `docs/design/ws-proxy-protocol.md`), run in a Cloudflare Container
behind a Worker.

- `GET /token` — for an allowed `Origin` only (`ALLOWED_ORIGINS` in `wrangler.jsonc`): a relay
  token in wvrelay's own format (`src/token.js`; at most 15 minutes, bound to that origin),
  CORS to that origin only. Any other origin gets 403.
- `GET /ws` — the WebSocket, forwarded with the browser's `Origin` to wvrelay, which verifies
  the token and the origin and refuses loopback, private, link-local and metadata addresses
  after DNS. The page sends the token in the protocol's `HELLO`, never in a URL.
- The container runs wvrelay on 8080 and a static busybox `httpd` on 8081 for the Containers
  runtime's HTTP readiness check (wvrelay drops plain HTTP); the Worker starts the container on
  8081, then hands the WebSocket to 8080.

Deploy: `bash deploy/cloudflare-relay/deploy.sh` (`--secret` the first time, to generate the
shared `RELAY_HMAC_SECRET`; it is sent to Cloudflare once and never stored). Check:
`node deploy/cloudflare-relay/smoke.mjs --base https://wasm-vm-relay.<account>.workers.dev`.
