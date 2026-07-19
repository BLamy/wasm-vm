# WebSocket TCP/UDP proxy — framing protocol (E3-T16 / E3-T14)

A browser can't open raw TCP or UDP, so guest flows are tunnelled through **one** multiplexed
WebSocket to a small Rust relay server that opens the real outbound sockets. This document
specifies the binary wire format; the codec (`crates/slirp/src/ws_proxy.rs`) is shared by the
client (`WsConnector`) and the server (`proxy/`) so their encoders/decoders agree by construction.

## Framing

Each WebSocket **binary message is exactly one frame** — the WebSocket layer preserves message
boundaries, so a frame needs no length prefix of its own:

```
+-----------+--------+------------------+
| stream_id | opcode |     payload      |
|  u32 (BE) | u8     |  opcode-specific |
+-----------+--------+------------------+
     4          1        message - 5
```

- `stream_id` (u32, big-endian): identifies the logical flow. **Stream 0 is reserved** for
  connection-level frames (`HELLO`); a per-flow frame MUST use a nonzero stream id.
- `opcode` (u8): the frame type (below).
- `payload`: the remaining bytes of the WebSocket message; its shape depends on the opcode.

A message shorter than 5 bytes, an unknown opcode, or a malformed payload is a **protocol error**:
the decoder returns `None` (never panics); the peer SHOULD close the connection. Fuzzing the
decoder with garbage must never panic or leak.

## Opcodes

| op | name          | stream | payload                                    | direction |
|----|---------------|--------|--------------------------------------------|-----------|
| 0  | `HELLO`       | 0      | `version:u8` + `token` (rest of payload)   | both, first frame |
| 1  | `OPEN`        | nonzero| `host_len:u8` + `host` (UTF-8) + `port:u16`| client→server |
| 2  | `OPEN_OK`     | nonzero| —                                          | server→client |
| 3  | `OPEN_FAIL`   | nonzero| `code:u8` (errno-ish)                       | server→client |
| 4  | `DATA`        | nonzero| stream bytes                               | both |
| 5  | `SHUTDOWN_WR` | nonzero| —                                          | both (half-close) |
| 6  | `CLOSE`       | nonzero| —                                          | both (clean close) |
| 7  | `RST`         | nonzero| —                                          | both (abort) |
| 8  | `WINDOW`      | nonzero| `credit:u32` (BE)                          | both (flow control) |
| 9  | `UDP_OPEN`    | nonzero| `host_len:u8` + `host` + `port:u16`       | client→server |
| 10 | `UDP_OPEN_OK` | nonzero| —                                          | server→client |
| 11 | `UDP_OPEN_FAIL`| nonzero| `code:u8`                                 | server→client |
| 12 | `UDP_DATA`    | nonzero| one UDP datagram, at most 65,507 bytes     | both |
| 13 | `UDP_CLOSE`   | nonzero| —                                          | both |

- **`HELLO`** — version negotiation + an (optional, may be empty) auth token. Auth/rate-limiting
  is E3-T19; the token FIELD exists now so the wire format doesn't change later.
- **`OPEN`** — connect to `host:port`. The host is a **name, not an IP**, so the relay resolves it
  (and E3-T15's DNS can route through the relay). `host_len` is a u8 (max 255, comfortably
  covering a ≤253-byte DNS name); a host that won't fit a u8 length is a protocol error. The
  `OPEN` payload is exact-length — trailing bytes after the port are a protocol error (as for
  every fixed-shape opcode), so the wire stays canonical.
- **`OPEN_FAIL` `code`** — a small errno-ish class (refused / unreachable / timed-out / denied),
  mapped by the client to the guest's connect outcome.
- **`WINDOW`** — **credit-based flow control.** The receiver grants byte credits per stream; a
  sender MUST NOT have more `DATA` bytes outstanding than its granted-but-unconsumed credit. This
  is **per-stream** — do NOT rely on the WebSocket's `bufferedAmount`, which is global and can't
  prevent one stalled stream from head-of-line-blocking the others. The client maps credits to the
  slirp socket window (E3-T14's backpressure seam).

### UDP datagrams

`UDP_OPEN` creates a connected relay UDP socket for one guest five-tuple; the client allocates its
ids from `0x8000_0000..` to avoid TCP mux ids. Each `UDP_DATA` WebSocket message is exactly one UDP
datagram. Implementations MUST reject payloads over 65,507 bytes and MUST NOT coalesce or split
datagrams. UDP has no stream credit or half-close: bounded per-flow/application and transport queues
drop or fail under pressure, while `UDP_CLOSE` reaps the socket. The connected socket admits replies
only from the chosen destination. NAT idle expiry is 30 seconds on the client side.

## Close / RST state

`SHUTDOWN_WR` half-closes the sender's write side (the peer may keep sending). `CLOSE` is a clean
bidirectional close after both sides have finished. `RST` aborts immediately (surfaces to the guest
as `ECONNRESET`). A stream id is retired after `CLOSE`/`RST`; reusing it is a protocol error.

## Versioning

The `HELLO` `version` byte is checked on connect; a mismatch the peer can't speak is refused before
any stream opens. This document specifies **version 1**.
