---
id: E5-T23
epic: 5
title: virtio-console agent channel and static Rust guest agent
priority: 523
status: pending
depends_on: [E5-T05]
estimate: M
capstone: false
---

## Goal
A private host⇄guest control channel: a virtio-console (device ID 3) multiport device
exposing a named port, and a small static Rust agent in the guest speaking a versioned,
framed protocol over it — the extension point that clipboard (T24), resolution
notifications, and future integrations plug into without inventing new devices.

## Context
virtio-console multiport gives us named streams with zero kernel work:
`VIRTIO_CONSOLE_F_MULTIPORT`, control queue messages (`PORT_ADD`, `PORT_NAME`,
`PORT_OPEN`), port name `org.wasmvm.agent` → guest udev creates
`/dev/virtio-ports/org.wasmvm.agent`. (vsock considered: better for multiple concurrent
streams, but needs CONFIG_VIRTIO_VSOCKETS + AF_VSOCK plumbing and we need exactly one
stream now — decision recorded, revisit trigger noted.) The agent: Rust, built for
`riscv64gc-unknown-linux-musl`, static, `< 1 MiB` stripped, no async runtime (poll(2)
loop), installed in the T17 image with an OpenRC service. Protocol: length-prefixed
frames `{u32 len, u16 type, u16 flags, payload}`, little-endian, max frame 1 MiB;
type 0 = HELLO carrying protocol version + capability bitmap, negotiated down to the
intersection; unknown types must be ignored-with-NAK, not fatal, so old agents survive
new hosts and vice versa. Host side: a `Channel` service in the page/worker with typed
subscribe/send, reconnect-tolerant (agent restart, VM snapshot restore).

## Deliverables
- virtio-console device with multiport control queue and the named port (reuse Epic 2
  serial virtqueue plumbing where possible); serial console remains on its own device.
- `guest/agent/` crate: poll loop, framing, HELLO/PING/NAK handlers, capability
  registry; CI cross-build producing the static binary; size check in CI.
- T17 builder addition: agent binary + OpenRC service (`rc-update add wasmvm-agent`).
- Host `Channel` API + reconnect logic; framing fuzz tests (host and guest sides share
  a framing crate compiled both ways — one implementation, no drift).
- `docs/agent-protocol.md`: wire format, HELLO negotiation, how to add a message type.

## Acceptance criteria
- [ ] Boot T17 image: `/dev/virtio-ports/org.wasmvm.agent` exists; agent service runs;
      host receives HELLO with version+caps within 2 s of boot; PING round-trip p50
      < 20 ms measured from the host.
- [ ] `rc-service wasmvm-agent restart` → host Channel reconnects and re-negotiates
      HELLO automatically; in-flight host sends during the gap error cleanly (no
      silent drop without notification).
- [ ] Agent binary ≤ 1 MiB stripped (CI-enforced); runs with no dependencies
      (`ldd` reports "not a dynamic executable").
- [ ] Unknown frame type sent by host → agent NAKs, stays alive; same in reverse.
- [ ] Framing fuzz (cargo-fuzz, 10 min): zero panics on either side; oversized frame
      (len = 0xFFFFFFFF) rejected without allocation.

## Adversarial verification
Attack the framing: byte-dribble a valid frame (1 byte per write), coalesce 10 frames
in one write, split a frame across port-open/close, inject random garbage mid-stream —
the agent and host must resync or reset the connection per the documented policy; any
hang or desync-forever refutes. Attack flow control: host sends 10k PINGs without
reading responses — bounded memory on both sides (virtqueue backpressure, not
unbounded Vec). Kill -9 the agent 100x in a loop: no host leak (Channel listener
count flat), no guest zombie pile-up. Version skew drill: bump the protocol version on
the host only — HELLO must negotiate down or fail explicitly per the doc, not
half-work with wrong framing. Confirm the serial console (T08) is unaffected while the
agent channel is saturated.

## Verification log
(empty)
