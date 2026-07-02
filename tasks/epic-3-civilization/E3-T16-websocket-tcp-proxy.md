---
id: E3-T16
epic: 3
title: WebSocket TCP proxy - framing protocol and Rust relay server
priority: 316
status: pending
depends_on: [E3-T14]
estimate: M
capstone: false
---

## Goal
The general-purpose transport: an `OutboundConnector` that tunnels guest TCP flows through a
single multiplexed WebSocket to a small Rust relay server, which opens real TCP connections
outbound. Any TCP protocol the guest speaks (HTTP, TLS, SSH, git) works through it, with a
designed-and-documented binary framing protocol.

## Context
Browsers cannot open raw sockets; a relay is how webvm-class systems reach arbitrary
TCP. Design the framing protocol first (`docs/design/ws-proxy-protocol.md`): one WebSocket
carries all flows; binary frames `{u32 stream_id, u8 opcode, payload}` with opcodes OPEN
(payload: hostname length-prefixed + u16 port — hostname not IP, so the relay does DNS and
T15 can also route through it), OPEN_OK/OPEN_FAIL(errno-ish code), DATA, SHUTDOWN_WR (maps
half-close), CLOSE, RST, and WINDOW (credit-based flow control: receiver grants byte
credits per stream; sender never exceeds outstanding credit — do not rely on WS
`bufferedAmount` alone, it is global not per-stream). Version byte in a hello frame.
Server: tokio + tokio-tungstenite (or axum ws), per-stream tasks, per-connection and
per-stream buffer caps. Client side implements `OutboundConnector` mapping credits to the
slirp socket window (T14's backpressure seam). Auth/rate limiting/deploy hardening is T19 —
but leave the hello frame's token field in the protocol now.

## Deliverables
- `docs/design/ws-proxy-protocol.md`: wire format, flow-control rules, close/RST state
  machine, version negotiation, token field.
- `proxy/` Rust server crate (tokio): WS endpoint, outbound TCP, credit enforcement,
  structured logs, `--listen`/`--allow-dest` flags, graceful shutdown.
- Client `WsConnector` (wasm: `web-sys` WebSocket; native: tungstenite for harness tests)
  implementing the protocol incl. credits and half-close.
- Protocol conformance tests: a shared test vector suite run against both client and server
  encoders/decoders; end-to-end native test guest→slirp→WsConnector→server→local echo.

## Acceptance criteria
- [ ] Booted guest (native harness and browser) completes `wget http://example-served-
      locally/100mb.bin` through the full chain; sha256 matches; single WebSocket carried
      all traffic (server logs show stream multiplexing for ≥3 concurrent flows).
- [ ] Credit flow control provably works: a guest downloading into a stalled reader (guest
      `sleep`ing mid-`wget` via a rate-limited pipe) causes the server's outstanding-credit
      counter for that stream to hit zero and its TCP read to pause (server metric), while
      a second concurrent stream continues at full speed.
- [ ] Half-close: guest `nc -q` style send-then-shutdown flows deliver the server's late
      response fully.
- [ ] RST from the destination surfaces to the guest as ECONNRESET within 1 s.
- [ ] Encoder/decoder conformance vectors pass identically in the wasm client, native
      client, and server.

## Adversarial verification
Attack the protocol and the flow control. Fuzz the server with malformed frames (unknown
opcodes, stream_id 0, DATA before OPEN, negative-ish lengths) — panic or resource leak
refutes. Violate credits deliberately from a hacked client: server must kill the stream or
connection, not buffer unboundedly (send 100 MB with zero granted credit). Open 500 streams
and drop the WebSocket abruptly: server must reap all TCP sockets within seconds (`lsof`
check). Stall one stream's reader for 5 minutes while 10 others transfer — head-of-line
blocking that stalls the others refutes the multiplexing claim. Byte-diff a 1 GB transfer.
Kill the server mid-transfer: guest must get a connection error, and (with T25 later)
reconnect must be possible — for now, no wasm panic.

## Verification log
(empty)
