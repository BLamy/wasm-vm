---
id: E5-T23b
epic: 5
title: Virtio-console multiport agent transport
priority: 523.2
status: in-progress
depends_on: [E5-T23a]
estimate: S
risk: high
capstone: false
---

## Goal

Expose the shared protocol through a real virtio-console device ID 3 with one named
`org.wasmvm.agent` port while keeping the existing serial console independent.

## Boundary

This slice owns the virtio-console MMIO device, feature negotiation, control-queue port lifecycle,
named-port data queues, and deterministic native transport tests. It does not own the agent
process, OpenRC image changes, host reconnect policy, or end-to-end boot proof.

## Deliverables

- `VIRTIO_CONSOLE_F_MULTIPORT` negotiation and device ID 3 registration on the E5 platform.
- Control messages for `PORT_ADD`, `PORT_NAME`, and `PORT_OPEN` for
  `org.wasmvm.agent`, with bounded descriptor-chain validation and backpressure.
- Separate host/guest data queues and a test seam for injecting a port restart.
- Native tests proving serial T08 traffic is unaffected while the agent port is saturated.

## Acceptance criteria

- [ ] A negotiated device publishes exactly one named `org.wasmvm.agent` port and rejects malformed
      control descriptors without an out-of-bounds read or host panic.
- [ ] Data written to the agent port completes through its queues with bounded backpressure and
      preserves frame bytes; a full agent queue never consumes serial-console descriptors.
- [ ] Port add/open/close/reopen transitions are deterministic and leave no stale queue ownership.

## Verification command

`cargo test -p wasm-vm-core virtio_console`

## Adversarial verification

Dribble control messages, coalesce ten data chains, close a port between split descriptors, and
send 10,000 PING-sized payloads without reading. Check descriptor bounds, bounded queue memory,
serial output continuity, and clean reopen after a forced transport reset.

## Verification log

(empty)
