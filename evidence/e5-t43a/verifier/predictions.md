# E5-T43a verifier — predictions (written before any probe)

Target: https://wasm-vm-relay.brett-lamy.workers.dev (head `44a03c51a`, code `654ec1634`).
Written from reading `deploy/cloudflare-relay/src/{index,token}.js`, `relay_security.rs`,
`ws_proxy/{driver,ws_adapter}.rs`, `wvrelay.rs`. Each line is falsifiable by a probe in
`probe.mjs` / `long.mjs` in this directory.

## Worker surface
- P1 `/token` with `Origin: https://wasm-vm.pages.dev` → 200, `Access-Control-Allow-Origin` exactly that
  origin, `Vary: Origin`, `Cache-Control: no-store`; body keys exactly `{token, expiresAt, ws}`.
- P2 decoded token = 5 newline fields `v1`, expiry, `https://wasm-vm.pages.dev`, 32 lowercase hex id,
  64 lowercase hex mac; `expiry - now` ≈ 600 s (≤ 900); `expiresAt` equals the expiry field; two
  requests yield different ids.
- P3 `/token` with Origin `https://evil.example`, `HTTPS://WASM-VM.PAGES.DEV`, `https://wasm-vm.pages.dev/`,
  `null`, no Origin → 403, no ACAO header.
- P4 `OPTIONS /token` from the allowed origin → 204 with ACAO; `POST /token` → 405; `/health` → 200 `ok`;
  `/ws` without Upgrade → 426; `/nope` → 404. No response body or header contains anything but the token.

## Token / Origin at wvrelay (reaching the container)
- P5 token for `https://wasm-vm.pages.dev` presented on a WebSocket whose Origin is `http://localhost:8123`
  (allowed by the Worker, so the request reaches wvrelay) → no OPEN_OK; connection closed after HELLO
  (WrongOrigin). The smoke's `wrongOrigin` never reached wvrelay (Worker 403), so this is new coverage.
- P6 token with its origin field edited to `http://localhost:8123` (signature kept), used from that Origin
  → no OPEN_OK (InvalidSignature).
- P7 same token on two concurrent connections → both authenticate and both OPEN example.com:80 succeed
  (tokens are not single-use; quotas are shared by token id). Design, not a defect.
- P8 a token older than its expiry, presented in a NEW HELLO → refused, no OPEN_OK.
- P9 (from code reading, pre-existing wvrelay) a session authenticated BEFORE expiry can still OPEN
  `example.com:80` AFTER expiry: `reserve_stream` never checks `expiry <= now`, it re-creates the
  token's usage entry (bytes reset to 0). Predict OPEN_OK at expiry+10 s on a long-lived session.

## Destinations (TCP OPEN and UDP_OPEN)
- P10 OPEN_FAIL / UDP_OPEN_FAIL for: `::1`, `[::1]`, `fd00::1`, `fe80::1`, `::ffff:127.0.0.1`,
  `::ffff:10.0.0.1`, `0.0.0.0`, `127.1`, `2130706433`, `100.64.0.1`, `172.16.0.1`, `192.168.0.1`,
  `169.254.169.254`, `127.0.0.1.nip.io`, `10.0.0.1.sslip.io`, `169.254.169.254.nip.io`.
- P11 UDP_OPEN to `127.0.0.1:53`, `10.0.0.1:53`, `169.254.169.254:53` → UDP_OPEN_FAIL (code 1).
- P12 `::127.0.0.1` (IPv4-compatible), `64:ff9b::7f00:1` (NAT64) are classified PUBLIC by wvrelay's
  policy; predict OPEN_FAIL anyway only because the container has no IPv6 route (indistinguishable code 1).
- P13 port 25 to a public MX: no port policy in wvrelay; predict OPEN_OK unless Cloudflare's egress blocks 25
  (connect only, no SMTP sent).
- P14 control: example.com:80 OPEN_OK + HTTP 200 (smoke), 1.1.1.1:53 UDP answer.

## Abuse bounds
- P15 a non-browser client sending `Origin: https://wasm-vm.pages.dev` gets tokens without limit (no
  rate limit in the Worker) — matches the worker's stated limit; per-token bounds from the code are
  64 concurrent streams, 120 connects/min, 64 MiB/token, 1024 streams per WebSocket, token ≤ 900 s.
  Since tokens are free, these bound one token, not a client.
- P16 a WebSocket that never sends HELLO: wvrelay has no HELLO deadline (no timeout in driver/ws_adapter).
  Predict it stays open for as long as the client keeps it alive (≥ 10 min with client pings); without
  pings the Cloudflare edge may close it after its idle timeout.

## Secret hygiene
- P17 no 64-hex secret, no `RELAY_HMAC_SECRET=`/`WVRELAY_HMAC_SECRET=` value in the tree, history of this
  branch's two commits, `deploy/cloudflare-relay/.wrangler/`, `web/dist`, or any Worker response.

## Coverage of the diff (src/index.js, src/token.js)
- P18 the worker's smoke exercised: /token 200 + 403, /ws upgrade path (allowed + disallowed origin),
  token.js fully. NOT exercised: /health, OPTIONS, 405, 426, 404, the 503 no-secret branch, TTL clamp
  branches. This verifier's probe exercises all but 503 (unreachable without changing the deploy).
