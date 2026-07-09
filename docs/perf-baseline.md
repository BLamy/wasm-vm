# Boot-time performance baseline (E2-T25)

The frozen "where does boot time go" baseline that Epic 4's ≥10× JIT claim is measured against.
Reproduce every number here with `tools/profile-boot.sh` (native) — do not hand-edit.

## Methodology (two layers, one deterministic)
- **Guest-relative phases** — the CLI `--profile-boot` flag watches the kernel/init console stream
  for phase markers (`Linux version` → `printk: console` → `VFS: Mounted root` → `Freeing unused
  kernel` → busybox `userland up` / getty `login:`) and stamps **host wall time + retired-instruction
  count** at each first sighting. Host time lives in the CLI, never in `crates/core` (the determinism
  gate bans host clocks there), so this adds nothing non-deterministic to the emulator.
- **Host-relative counters** — `SystemBus::device_hits()` gives per-device MMIO **access counts**
  (UART/CLINT/PLIC/RTC/virtio). The counter itself is deterministic given identical execution, but
  **a full native boot is NOT bit-reproducible**: the CLI goldfish-RTC reads host wall time
  (`SystemClock`), and the profiler's boot→userland stop is quantum-granular, so the total retired
  count and per-device counts **drift by ~±1 quantum (≈200 k retired, a handful of UART accesses)
  run-to-run**. The numbers below are therefore *representative to ~1 %*, not byte-identical
  invariants. (A bit-reproducible run would need the deterministic-clock RTC path, not the host clock.)
- **The CPU-vs-device-vs-I/O TIME split** comes from an **external sampling profiler**
  (`cargo flamegraph` / `samply` over a native boot), which attributes wall time to functions. The
  per-device *counts* here measure device **traffic**, not device **time** — see the finding below.

## Native baseline — busybox initramfs (release, this dev machine)
`tools/profile-boot.sh` (stops at userland, so the total is boot time, not idle spin):

| phase | wall_ms (cumulative) | Δretired | phase MIPS |
|---|---|---|---|
| console-up (`printk: console`) | 44 366 | 267 191 589 | 6.0 |
| init-handoff (`Freeing unused kernel`) | 48 522 | 24 999 862 | 6.0 |
| busybox-userland (`userland up`) | 51 245 | 16 598 755 | 6.1 |
| **total (boot → userland)** | **51 245** | **308 790 206** | **~6.0** |

**Per-device MMIO accesses over the boot (representative — varies ~±1 %, see above):** `uart16550`
**~2 570** ≫ `plic` ~313 ≫ `goldfish-rtc` 9 ≫ each `virtio-mmio` slot 3, `clint` 0. The console sees
**~8× the traffic of every other device combined** — but this is *traffic, not time*: ~2 570 UART
accesses against 309 M retired instructions is a rounding error on execution.

**What the numbers actually say — the boot is interpreter-DISPATCH-bound, not device-bound.** Every
phase runs at a **uniform ~6 MIPS** (console-up, init-handoff, userland all ~6.0). If any phase were
device/MMIO-bound its MIPS would sag; none does. So the boot cost is fetch/decode/execute dispatch
across 309 M instructions, spread evenly — the UART just happens to be the busiest *device*. (The
authoritative CPU-vs-device *time* split still needs the external flamegraph; these counts only
establish that device MMIO is a tiny fraction of the instruction stream.)

### The MIPS baseline Epic 4 must beat 10×
The interpreter retires **~6.0 MIPS** on this boot workload. **Epic 4's JIT target is ≥ 60 MIPS on
the same boot.**

## Native baseline — Alpine rootfs (virtio-blk ext4, release)
`TARGET=alpine tools/profile-boot.sh` (stops at the getty `login:` marker). A single representative
~7 min run (not repeated); like busybox it varies ~±1 % run-to-run. Caveat: the getty terminal marker
is the loose substring `login:` — if an earlier OpenRC line contained it the boot would stop early
(none did here; the busybox `userland up` marker is a safer custom string).

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
