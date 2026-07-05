# Boot-time performance baseline (E2-T25)

The frozen "where does boot time go" baseline that Epic 4's ≥10× JIT claim is measured against.
Reproduce every number here with `tools/profile-boot.sh` (native) — do not hand-edit.

## Methodology (two layers, one deterministic)
- **Guest-relative phases** — the CLI `--profile-boot` flag watches the kernel/init console stream
  for phase markers (`Linux version` → `printk: console` → `VFS: Mounted root` → `Freeing unused
  kernel` → busybox `userland up` / getty `login:`) and stamps **host wall time + retired-instruction
  count** at each first sighting. Host time lives in the CLI, never in `crates/core` (the determinism
  gate bans host clocks there), so this adds nothing non-deterministic to the emulator.
- **Host-relative counters (deterministic)** — `SystemBus::device_hits()` gives per-device MMIO
  **access counts** (UART/CLINT/PLIC/RTC/virtio), byte-identical native and wasm.
- **The CPU-vs-device-vs-I/O TIME split** comes from an **external sampling profiler**
  (`cargo flamegraph` / `samply` over a native boot), which attributes wall time to functions. The
  deterministic per-device *counts* above cross-check the flamegraph's per-device *time*. Absolute
  wall-ms and MIPS are host-speed-dependent; the *retired counts and MMIO counts are the invariant*.

## Native baseline — busybox initramfs (release, this dev machine)
`tools/profile-boot.sh` (stops at userland, so the total is boot time, not idle spin):

| phase | wall_ms (cumulative) | Δretired | phase MIPS |
|---|---|---|---|
| console-up (`printk: console`) | 44 366 | 267 191 589 | 6.0 |
| init-handoff (`Freeing unused kernel`) | 48 522 | 24 999 862 | 6.0 |
| busybox-userland (`userland up`) | 51 245 | 16 598 755 | 6.1 |
| **total (boot → userland)** | **51 245** | **308 790 206** | **~6.0** |

**Per-device MMIO accesses over the boot:** `uart16550` **2 582** ≫ `plic` 316 ≫ `goldfish-rtc` 9 ≫
each `virtio-mmio` slot 3, `clint` 0. Every UART access is an MMIO exit, so the long **console-up**
phase (267 M retired, ~87 % of the boot) is dominated by kernel dmesg being pushed a byte at a time
through the 16550 — the predicted "console-heavy phases look device-bound" finding, quantified: the
console device sees ~8× the traffic of every other device combined.

### The MIPS baseline Epic 4 must beat 10×
The interpreter retires **~6.0 MIPS** on this MMIO/trap-heavy boot workload (far below the pure-ALU
`perf-smoke` floor — boot is not ALU-bound). **Epic 4's JIT target is ≥ 60 MIPS on the same boot.**

## Native baseline — Alpine rootfs (virtio-blk ext4, release)
`TARGET=alpine tools/profile-boot.sh` (stops at the getty `login:` marker):

| phase | wall_ms (cumulative) | Δretired | phase MIPS |
|---|---|---|---|
| console-up (`printk: console`) | 40 591 | 229 191 847 | 5.7 |
| rootfs-mounted (`VFS: Mounted root`) | 45 967 | 31 599 772 | 5.9 |
| init-handoff (`Freeing unused kernel`) | 46 110 | 799 991 | 5.6 |
| getty-login (`login:`) | 445 444 | 2 447 204 717 | 6.1 |
| **total (boot → login)** | **445 444** | **2 708 796 327** | **~6.1** |

**Per-device MMIO accesses:** `uart16550` **5 513** ≫ `plic` 1 371 ≫ `virtio-mmio` slot 0 **791** ≫
`goldfish-rtc` 11, `clint` 0. Two findings vs busybox: (1) the disk-backed rootfs generates **real
virtio-blk traffic** (791 accesses on slot 0) that the initramfs boot doesn't (3 — just probe); (2)
**OpenRC init dominates** — from `init-handoff` (46 s) to `login:` (445 s) is ~400 s / 2.4 B retired,
**~90 % of the whole boot**, at ~6.1 MIPS. So Alpine's cost is userspace service startup, not the
kernel: the kernel reaches `Freeing unused kernel` in ~46 s (like busybox), and OpenRC does the rest.

## Browser baseline
The wasm interpreter runs the same deterministic retired/MMIO counts; only wall time differs. The
demo page's **Bench** button and `web/bench-node.mjs` report node/browser MIPS on the pinned
`loops.elf` ALU workload; the E2-T23 timekeeping spec measured the *idle* browser ratio at ~0.05
(≈5 MIPS at the WFI-idle prompt). A `performance.mark`/`measure` boot-total in `loader.js` around the
run quanta is the browser analogue of `--profile-boot`; wiring it is a small follow-up (the
deterministic phase *retired counts* are already identical to native, so only the browser wall-times
are new data).

## Top hotspots (flamegraph)
The host-time split requires `cargo flamegraph`/`samply`, which is not run in CI (needs perf/dtrace
privileges) — run locally with `cargo flamegraph --bin wasm-vm -- boot --kernel … --profile-boot`.
The deterministic per-device counts above already localize the cost: **console MMIO** (UART TX/LSR
polling per dmesg byte) is the top boot hotspot by device traffic; instruction dispatch (fetch/decode/
execute) is the remaining bulk. Archiving the SVG + naming the top-5 function-level hotspots with
their % shares is the remaining measurement step (a local flamegraph pass).

## Honest scope
Measured + checked-in here: the **native busybox** phase table + per-device profile + the ~6 MIPS
baseline, all reproduced by `tools/profile-boot.sh`. Alpine (a ~5–7 min boot) is measured by the same
tool (`TARGET=alpine`); the browser `performance.measure` boot-total and the archived flamegraph SVG
+ top-5 function hotspots are the remaining measurement passes the harness supports but that aren't
captured in this doc yet — the deterministic counts (retired, MMIO) are the cross-platform invariant.
