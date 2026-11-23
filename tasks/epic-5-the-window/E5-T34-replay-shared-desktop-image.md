---
id: E5-T34
epic: 5
title: Minimal single-fetch shared desktop OS for Replay Chrome and Node 26 (planning parent)
priority: 0.387
status: cancelled
depends_on: [E0-T34, E5-T33]
estimate: M
risk: high
capstone: false
---

User request (2026-11-22): run both on one shared desktop, on the smallest Linux
that boots them quickly, delivered as the whole OS at once, so boot never waits on
per-chunk virtio network fetches. Guest RAM is capped at 2 GiB (shared wasm32
memory), so an initramfs holding ~1 GB of browser + node is rejected. The OS ships
as one compressed read-only image fetched in a single stream into host-side memory
or OPFS and served to virtio-blk locally, with a tmpfs overlay for writes. Split into:

- E5-T34a — whole-image block backend in the web runtime: one fetch, integrity
  checked, no per-chunk network on the boot path (risk medium).
- E5-T34b — minimal rootfs: kernel + busybox init + a single-process Wayland
  kiosk compositor + fonts + Chrome 157 + Node 26 terminal; read-only compressed
  filesystem, privacy-scanned at its source tree before packing (risk medium).
- E5-T34c — boot both on the shared desktop in the browser, measure boot time and
  download size, publish (risk medium).

User decision (2026-11-23): the first desktop ships Replay Chrome 108 (verified
riscv64, E0-T34) because Replay's 157 uplift does not compile yet (E5-T32b, blocked).
