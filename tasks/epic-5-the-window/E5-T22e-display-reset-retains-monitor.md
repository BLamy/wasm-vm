---
id: E5-T22e
epic: 5
title: Preserve the host monitor mode across guest GPU reset
priority: 522.25
status: pending
depends_on: [E5-T22a, E5-T22b]
estimate: S
risk: high
capstone: false
---

## Goal

Keep the physical host monitor dimensions, refresh and EDID across a virtio GPU
device reset, while clearing all guest-owned GPU state. Linux performs this reset
during boot, after the browser has already supplied its initial viewport size.

## Boundary

Only the reset ownership distinction in VirtioGpu and its deterministic native,
actual-Wasm and browser-worker tests. No compositor, pixel-presentation, renderer,
JIT, snapshot format, or guest-image change belongs to this slice.

## Acceptance criteria

- [ ] Set an odd host mode, then perform a guest status=0 MMIO reset. The exact
      dimensions, refresh and all EDID bytes survive, in native and actual Wasm.
- [ ] Resources, backing accounting, scanout, cursor, queue kick state and pending
      device events/IRQ are cleared; no old guest resource remains usable.
- [ ] Repeated resets and repeated/new host mode requests remain deterministic.
      A fresh independent machine still starts at the unchanged default mode.
- [ ] Record the actual guest reset instruction trace and state digest; the built
      browser worker reads the preserved mode after executing the reset fixture,
      and the normal built demo still reaches 126 passed, zero failed/errors.

## Verification command

make verify-E5-T22e

## Adversarial verification

Reset during a pending host config event with live resources/cursor; verify stale
interrupts and resource references are gone while monitor identity remains.
Probe two resets in succession, new mode after reset, min/max/odd sizes, and a
fresh second machine to catch accidental shared monitor state. Independently
read EDID rather than accepting width/height counters alone. Sabotage preservation
once. Carry unchanged host-argument and stale-frame proofs from T22a/b forward.

## Verification log

### 2026-09-06 — coordinator — prerequisite discovered

T22c's first non-default initial-mode boot requests 901x701 before guest execution,
then stalls on an actual 1280x800 resource. VirtioGpu::reset restores monitor
defaults along with guest-owned resources. Preserve that reproduction under
`evidence/e5-t22c/initial-mode-reset-v3/`. This new S task separates the core reset
boundary from the blocked compositor adaptation work.
