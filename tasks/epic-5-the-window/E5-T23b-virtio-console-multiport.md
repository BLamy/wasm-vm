---
id: E5-T23b
epic: 5
title: Virtio-console multiport agent transport
priority: 523.2
status: verified
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

- [x] A negotiated device publishes exactly one named `org.wasmvm.agent` port and rejects malformed
      control descriptors without an out-of-bounds read or host panic.
- [x] Data written to the agent port completes through its queues with bounded backpressure and
      preserves frame bytes; a full agent queue never consumes serial-console descriptors.
- [x] Port add/open/close/reopen transitions are deterministic and leave no stale queue ownership.

## Verification command

`cargo test -p wasm-vm-core virtio_console`

## Adversarial verification

Dribble control messages, coalesce ten data chains, close a port between split descriptors, and
send 10,000 PING-sized payloads without reading. Check descriptor bounds, bounded queue memory,
serial output continuity, and clean reopen after a forced transport reset.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified (user-directed)

- Named-port publication — HELD. Predicted a negotiated DeviceID 3 with exactly one named port;
  the exact-head unit and real-Machine tests observed the six-queue layout, `PORT_ADD`, and
  `PORT_NAME` for `org.wasmvm.agent`. The dribbled control-chain and seven-byte malformed control
  attacks completed with used length zero and no panic.
- Independent bounded transport — HELD. Predicted agent bytes would preserve order and stop at
  the configured budget without consuming serial descriptors; the focused tests preserved split
  input/output bytes, rejected the tail of 10,000 payload attempts at a 64-byte budget, left a
  posted agent descriptor pending, and still delivered the UART byte `S`.
- Lifecycle/reset — HELD. Predicted restart and full MMIO status-zero reset would clear stale
  agent buffers, queue ownership, and announcements; the lifecycle test observed a generation
  increment, empty data buffers, two fresh announcement packets after restart, and cleared
  announcements after reset.
- Diff coverage — HELD. `console.rs` and the Machine run-loop are exercised by the focused unit and
  integration tests; the `MAX_QUEUES` transport expansion is covered by MMIO, eight-slot, snapshot,
  block, network, and sound regression suites. No changed runtime hunk remains unexercised or
  unexplained.

Commands: `cargo test -p wasm-vm-core virtio_console`; `cargo fmt --all -- --check`; `cargo clippy -p wasm-vm-core --lib --tests -- -D warnings`; `cargo check -p wasm-vm-core --target wasm32-unknown-unknown --quiet`; `cargo test -p wasm-vm-core --lib virtio::mmio`; `cargo test -p wasm-vm-core --test virtio_mmio_slots`; `cargo test -p wasm-vm-core --test virtio_snd_machine`; `cargo test -p wasm-vm-core --test snapshot`; `cargo test -p wasm-vm-core --test snapshot_coherence`; `cargo test -p wasm-vm-core --test virtio_blk --test virtio_net_machine --test virtio_snd_machine`

Evidence: [`virtio-console-2026-09-04.txt`](../../evidence/e5-t23b/virtio-console-2026-09-04.txt) (SHA-256 `4c461117087a045ec02ab436b9bdbdcf214a78a369b05bed2740a285905256ed`), exact implementation commit `8aefa5e`.
