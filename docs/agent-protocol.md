# wasm-vm agent channel protocol

The guest agent is a deliberately small peer on the named virtio-console port
`org.wasmvm.agent`. The port is exposed by the virtio-console multiport device as
`/dev/virtio-ports/org.wasmvm.agent`; the UART at `0x10000000` remains the independent serial
console. Agent traffic never shares the UART buffers.

## Wire framing

The channel is a byte stream of little-endian frames:

```text
u32 payload_len | u16 message_type | u16 flags | payload[payload_len]
```

The header is 8 bytes. `payload_len` excludes the header and is at most 1 MiB (`1 << 20`), so a
complete frame is at most 1 MiB + 8 bytes. There is no magic byte or resynchronization scan. A
decoder may receive one byte at a time, several frames at once, or arbitrary chunks from a
virtqueue descriptor. It retains the partial header/payload and emits a frame only when complete.

An oversized length is rejected before allocating a payload. A truncated frame is a connection
error when the port closes. Both cases make the byte boundary ambiguous: discard the decoder and
reset/reopen the port. Do not search the remaining bytes for a plausible header. Garbage that is a
valid header with an unknown type is different: it is an application-level unknown message and is
answered with `NAK`, keeping the session alive.

## Fixed messages

| Type | Value | Payload |
| --- | ---: | --- |
| `HELLO` | `0` | `u16 version`, `u64 capabilities` |
| `PING` | `1` | `u64 nonce` |
| `PONG` | `2` | `u64 nonce` copied from `PING` |
| `NAK` | `3` | `u16 rejected_type`, `u16 code` |

All integer fields are little-endian. The current protocol version is `1`. Capability bits are
registered in the shared Rust crate and mirrored by `web/agent-channel.js`: `CAP_PING = 1 << 0`,
`CAP_CLIPBOARD = 1 << 1`, and `CAP_DISPLAY = 1 << 2`. The guest currently advertises only
`CAP_PING`.

The endpoint sends `HELLO` as soon as it opens a fresh port incarnation. Each side sends its own
`HELLO`; the negotiated version is the lower non-zero version and capabilities are the bitwise
intersection. A peer version of zero has no common version and fails the connection. A later
`HELLO` with a lower version than the negotiated version is stale and also fails the connection.
`NAK_UNKNOWN_TYPE = 1` identifies an unknown message type. NAK payloads are themselves fixed-size
and malformed payloads are connection-fatal.

## Queue, size, and reset policy

The guest agent uses a 16 KiB read buffer and a 64 KiB response queue. The host-side virtio-console
state keeps each direction within its configured data budget (1 MiB by default). A producer may
accept a prefix and must retain the rejected suffix for later retry; it must never block the
emulator or silently reorder bytes. The host `Channel` uses a separate pending-request bound and
rejects excess requests with an explicit backpressure error.

The stream contract is:

1. **Byte dribble:** retain bytes until a complete frame is available.
2. **Coalescing:** decode every complete frame in order from one read.
3. **Garbage/unknown type:** decode the valid frame, send `NAK_UNKNOWN_TYPE`, and keep the port.
4. **Malformed length, malformed fixed payload, or close with a partial frame:** discard the
   decoder, reject in-flight requests as disconnected, and reconnect.
5. **Port close/recreate:** discard all in-flight application bytes. Re-open the fixed path, send a
   fresh `HELLO`, and do not replay a partially written frame.

The host `Channel` preserves user subscriptions across reconnects, removes the old transport
listener before installing the new one, and exposes an explicit `DISCONNECTED` gap. A request that
was in flight across the gap rejects with `DisconnectedError`; it is never silently retried.

## Adding a message type

Adding a message is an additive protocol change, not a change to the frame format:

1. Reserve a stable `u16` type and document its fixed payload schema and maximum size here.
2. Add any required capability bit to the shared Rust constants and the JavaScript constants.
3. Add an exact encoder/decoder and length checks on both peers. A malformed fixed payload must
   fail closed.
4. Add a guest handler and a host `Channel` typed send/subscribe path. Unknown older peers must
   receive `NAK` and remain usable.
5. Add byte-dribble, coalesced, malformed, size-boundary, reconnect, and browser/request/console
   evidence to the task's proof target. The recorded evidence must include the exact source and
   built-distribution hashes.

Clipboard and display messages should follow this recipe. They must not reuse `PING`/`PONG` flags
as an implicit type extension, grow an unbounded queue, or depend on the serial console.

## Reference implementations and proof

The no-`std` Rust contract is `crates/agent-protocol/src/lib.rs`; the static guest peer is
`guest/agent/src/lib.rs`; and the host lifecycle implementation is `web/agent-channel.js`. The
end-to-end proof target is `node tools/verify/e5-t23e-agent-channel-proof.mjs`. Its native phase
boots the pinned T17 kernel/rootfs through the proof-only CLI flag, while its deterministic phase
attacks framing and reconnect behavior. The resulting JSON records the boot, HELLO timing, PING
latency, flow-control bound, restart/re-negotiation, serial isolation, fuzz digest, and exact
source/distribution hashes.
