---
id: E3-T13
epic: 3
title: virtio-net device with rx/tx rings, config space, and MAC
priority: 313
status: in_progress
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

**2026-07-06 — device core (pass 1), PR #96 stacked on #95.**
`crates/core/src/dev/virtio/net.rs`: VirtioNetDev (DeviceID 1) on the E2-T08 transport + E2-T09
rings — receiveq/transmitq, `VIRTIO_NET_F_MAC` only (declined + documented: MRG_RXBUF, offloads,
CTRL_VQ, STATUS), fixed MAC 52:54:00:12:34:56, deferred-kick service (blk pattern). **Header is
12 bytes** (`virtio_net_hdr_mrg_rxbuf`, num_buffers=1): spec §5.1.6.1 includes num_buffers under
VERSION_1 *or* MRG_RXBUF, and §5.1.6.4.1 mandates num_buffers=1 without MRG_RXBUF; Linux
`virtnet_probe` corroborates (hdr_len = mrg size under VERSION_1). `NetBackend` seam (plain
ethernet `Vec<u8>` frames) + `LoopbackBackend` (MAC-swap echo, 256-cap oldest-drop) +
`PcapBackend` (both-direction capture, deterministic tick timestamps). rx starvation drops with
`rx_dropped` counter; ring Violations degrade via protocol_violation.

Cold-clone critic (10-claim charter) **SOUND with one MED → fixed same PR**: pre-fix,
`service_rx` popped an rx descriptor BEFORE pulling the frame, so a backend whose `rx_ready()`
lied (buggy/racy T14 backend) consumed a posted descriptor per lie — silent permanent guest
buffer loss (critic demonstrated with a lying-backend test: 2 posted buffers gone, used.idx 0,
no NEEDS_RESET). Fixed by pulling the frame first (descriptor only popped once a real frame is
held); regression `lying_backend_does_not_leak_rx_descriptors`. Critic CONFIRMED all other
claims: 12-byte header (spec+Linux), bounded rx (device+backend layer), no loss/dup/reorder in
10⁴-frame fuzz, ring hostility handled by queue engine (zero-len rejected before address checks),
used.len=0 on oversized drop harmless for Linux (guards len<hdr_len → rx_length_errors++, repost;
QEMU virtio_errors instead — ours gentler, documented), IRQ can only be spurious never missed,
determinism clean. LOW advisories addressed: NetBackend re-entrancy contract documented (T14
landmine), PcapBackend unbounded-growth documented as test-only. Critic tests ADOPTED into
`crates/core/tests/virtio_net_critic.rs` (7): leak regression, writable-only tx chain, 3-segment
rx delivery, loopback cap oldest-drop, rx avail-idx jump → NEEDS_RESET, reset teardown+recovery,
wide config reads past the MAC.

Gates: net 10 + critic 7 + blk/torture/mmio/virtqueue all green; fmt/clippy(all-features)/
determinism/wasm(default+zicsr-stub) clean. **Remaining (pass 2, stacked):** Machine wiring
(`enable_virtio_net`, slot 1, run-loop service), DTB node, Alpine `eth0` probe + `ip link` MAC
acceptance, loopback arping via PcapBackend capture, native/wasm parity run.
