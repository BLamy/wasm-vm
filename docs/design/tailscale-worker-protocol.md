# Browser Tailscale Worker protocol

E3-T17 reuses the E3-T16 `ws-proxy` frame codec at the slirp connector seam. The main-thread
Wasm module and the dedicated Tailscale Worker exchange structured-clone messages; each `frame`
message carries exactly one canonical `ws-proxy` frame in an `ArrayBuffer` or `Uint8Array`.

## Main thread to Worker

- `{ type: "configure", config }` is the first message. `config` may contain the control URL,
  hostname, one-time auth key or interactive-login choice, persisted state snapshot, DNS and exit
  node preferences, and the pinned runtime/artifact URLs. Credentials are structured-cloned and
  MUST NOT appear in the Worker URL, logs, diagnostics, or persisted state. The Wasm boot slot is
  consumed as soon as this message is sent.
- `{ type: "frame", bytes }` carries an E3-T16 `HELLO`, `OPEN`, `DATA`, `WINDOW`,
  `SHUTDOWN_WR`, `CLOSE`, `RST`, or UDP frame. The Worker is the server role: it answers `HELLO`,
  maps TCP/UDP opens to generic Tailscale `net.Conn` sessions, and obeys the existing 256 KiB
  per-flow credit window and datagram boundary rules.
- `{ type: "login" }`, `{ type: "logout" }`, and `{ type: "dispose" }` are lifecycle controls.
  `dispose` deterministically closes every flow and releases every callback before the Worker exits.
- `{ type: "lookup", id, name }` asks the active IPN to resolve one MagicDNS/tailnet name. At most
  64 lookups are live; the Rust forwarder retains DNS wire parsing, response construction, and TTL
  caching. This control exists only for the Tailscale provider—relay/offline continue using DoH.

## Worker to main thread

- `{ type: "frame", bytes }` carries one canonical response frame. Malformed messages poison the
  transport; they are never partially decoded.
- `{ type: "status", status }` reports login/runtime state without credentials. Status is UI-only
  and cannot affect the frame data path.
- `{ type: "storageUpdate", snapshot }` reports opaque IPN state for persistence. Auth keys are
  provisioning inputs and MUST be deleted before this event is emitted.
- `{ type: "lookupResult", id, failed, addresses }` returns only IPv4 strings to the Rust resolver.
- `{ type: "failed", error: { code, message } }` fails all current connector flows. Error payloads
  use stable classes and redact config values.

## Runtime bridge

The pinned Go/Wasm bridge exposes generic bounded TCP and UDP sessions (`dialTCP`, `dialUDP`,
`read`, `write`, `shutdownWrite`, and `close`) plus `lookup`. The Worker drives only those methods.
The whole-body `ipn.fetch` API is not imported or called by this transport. Runtime and 25 MiB-class
Wasm artifact loading begins only after the `tailscale` provider has been selected; `relay` and
`offline` selection stage an empty Worker URL and therefore cannot create the Worker or request its
artifact.

## Failure and bounds

The shared Rust transport rejects messages above 1 MiB, caps queued inbound frames at 32 MiB and
outbound frames at 4 MiB, and fails closed after malformed input or Worker error. The session layer
adds the E3-T16 per-flow 256 KiB TCP windows and four-datagram UDP queue cap. UDP payloads are
limited to 1,252 bytes: Tailscale's default safe 1,280-byte TUN MTU minus the inner IPv4 (20-byte)
and UDP (8-byte) headers. A Worker crash or dispose fails in-flight flows normally; a later boot
creates one new Worker from persisted IPN state.
