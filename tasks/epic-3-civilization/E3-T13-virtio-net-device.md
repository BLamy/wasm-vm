---
id: E3-T13
epic: 3
title: virtio-net device with rx/tx rings, config space, and MAC
priority: 313
status: pending
depends_on: [E2]
estimate: M
capstone: false
---

## Goal
A virtio-mmio network device the unmodified Alpine kernel drives with its stock virtio_net
driver: two virtqueues (receiveq/transmitq), feature negotiation, MAC in config space, and
ethernet frames flowing to/from a pluggable `NetBackend` trait. Proven with a loopback
backend before any real network stack exists.

## Context
Reuses Epic 2's virtio-mmio transport and ring implementation — this task is the net device
model, not new transport code. Scope decisions: negotiate `VIRTIO_NET_F_MAC` (fixed
locally-administered MAC, e.g. 52:54:00:12:34:56, in config space); do *not* offer
`VIRTIO_NET_F_MRG_RXBUF`, checksum/TSO offloads, or control queue in v1 — fewer features,
simpler rx buffer handling (each rx frame in a single descriptor chain prefixed by
`virtio_net_hdr`); document what was declined and why. Every frame crosses the boundary as
a plain `Vec<u8>` ethernet frame — the `NetBackend` trait (`push_frame_to_guest`,
`pop_frame_from_guest`, readiness callback) is the seam T14's slirp stack plugs into.
Careful with rx: frames arriving while the guest has no free rx descriptors must be dropped
with a counter, not queued unboundedly.

## Deliverables
- `virtio-net` device in the core crate: MMIO registration, feature negotiation, rx/tx
  queue processing, `virtio_net_hdr` handling, config space with MAC.
- `NetBackend` trait + `LoopbackBackend` (echoes frames, swapping src/dst MAC) and
  `PcapBackend` (test-only: records frames to a pcap byte buffer for offline inspection).
- Native tests: kernel-free ring-level tests driving the queues directly; frame drop
  accounting under rx-descriptor starvation.
- Browser + native boot test: Alpine detects `eth0`.

## Acceptance criteria
- [ ] Guest `ip link` shows `eth0` with the configured MAC; `dmesg` shows virtio_net probe
      with the expected negotiated features (and none of the declined ones).
- [ ] With `LoopbackBackend`: guest `ip addr add 10.0.2.15/24 dev eth0 && ip link set eth0
      up` then `arping`/`ping` to a made-up neighbor gets its own echoed frames back
      (verified via `PcapBackend` capture showing tx and rx frames).
- [ ] Ring-level native test: 10^4 frames through tx and rx with randomized descriptor
      chain layouts (single and multi-descriptor) — no lost/duplicated/reordered frames.
- [ ] rx under descriptor starvation drops frames, increments the counter, and the guest
      recovers when buffers are reposted (no device lockup).
- [ ] Identical behavior native and wasm (same test binary run in both harnesses).

## Adversarial verification
Drive the rings hostilely: descriptor chains with zero-length segments, header split across
two descriptors, tx frame larger than any rx buffer, avail index racing ahead — any panic,
memory-unsafe access, or wedged queue refutes. Flood rx from the backend at 10× guest
consumption rate and verify bounded memory (drop counter grows, heap doesn't). Confirm the
`virtio_net_hdr` is exactly the negotiated size (no MRG_RXBUF → 10-byte legacy or per-spec
size for the negotiated version — check against the virtio spec revision Epic 2 targets;
an off-by-two here corrupts every frame and is the classic bug to hunt). Diff a pcap of
guest DHCP attempts against wireshark-parsed expectations for well-formedness.

## Verification log
(empty)
