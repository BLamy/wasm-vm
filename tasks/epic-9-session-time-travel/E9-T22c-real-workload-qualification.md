---
id: E9-T22c
epic: 9
title: Qualify both full pinned performance workloads
priority: 524.92203
status: in-progress
depends_on: [E9-T22b]
estimate: S
risk: medium
capstone: false
---

## Goal

Qualify the unchanged real software and hardware GPU desktop workloads before timing.

## Boundary

One qualification harness and explicit reference/profile receipts. Reuse the
original software kernel/rootfs and GPU kernel/chunked-image/probe source pins.
Retain the old reference and every development failure. Explicitly document any
necessary supported-profile amendment before timing; never coerce a legacy
paced checkpoint or relabel a software renderer. Runtime semantic changes must
be their own prerequisite, not hidden in this harness task.

## Acceptance criteria

- [ ] Complete the frozen full Alpine workload with literal before/after bytes, real RTC/entropy receipts, 100 exact scheduled inputs, ten rewrites and ten counted 1 KiB HTTP responses.
- [ ] Boot the real Omarchy desktop in the accepted exact profile, compile the original frozen probe for RV64 against its qualified EGL/GLES libraries, execute it inside that guest and retain hardware GL_RENDERER, GL_ERROR0 and the complete red readback. Exercise the frozen viewport sequence.
- [ ] Prove both full recordings reopen/replay with complete architectural, RAM, device, disk, clock, pending/cursor, literal file/entropy/HTTP and GPU witnesses; zero live replay egress. Do not substitute tiny Linux, idle or bare-MMIO GPU fixtures.
- [ ] Seal executable source/asset/compiler/binary/renderer/reference receipts before the later timed campaign. Obtain a fresh actual Daybreak qualification verdict with one bounded novel attack; no performance/budget claim belongs here.

## Deterministic acceptance

`make verify-E9-T22c`. Planned target for full real-workload qualification and
affected harness/build/browser proof. The original development setup prefix
and frozen GPU probe cross-build are inputs to inspect, not passing acceptance.

## Adversarial verification

Corrupt an unrequested base chunk, vary workload seeds, dirty RAM/files,
sustained real HTTP and GPU readback. Independently read snapshots/filesystems
and count live server calls. Refuse software renderer or changed probe/assets,
missing GL results, hidden live replay I/O and an incomplete long recording.

## Verification log

### 2026-10-22 — worker — begin complete real-workload qualification

Activated only after fresh actual Daybreak verified E9-T22b at
`8b99d05a0e5b3ee23198e72ea9d4d324eb3e8744`, including actual main deployment
`a14eb837` / release `3efeff9dd069d94c3577cefd4eb9439870ef32d3`.
The native branch `codex/e9-real-workload-qualification` is the next layer;
all 29 preceding PRs remain open/unmerged/unqueued. This task alone occupies
the active lane. Risk is medium for the qualification harness/reference
boundary; no runtime semantic change is included.

A preparatory fresh actual Daybreak read-only design audit is retained at
`target/evidence/e9-t22c-daybreak-design/final-message.md`, SHA-256
`b60fed572468ef464510251985c058edc1f1cd06d765875de1c85dc876c80768`.
It establishes no acceptance verdict. Compose the genuine full-Alpine owned
HTTP path with a sealed absolute-transition scheduler and complete journal;
boot the original full Omarchy kernel/chunk manifest in fresh 1 GiB pure
ICount/64, use the production physical renderer, transfer/execute the original
RV64 EGL/GLES probe and verify both adopted viewports. Reopen both stores and
replay from their actual initial frames through the complete histories, with
full state/files/source/network/GPU witnesses and zero replay egress.

Seal original source/asset/compiler/library/ELF/renderer identities and explicit
profile receipts before execution/timing. Preserve the original Chrome .80
reference and existing .85 amendment, all workload amounts, all numeric budgets,
and every failed attempt. The pinned Omarchy manifest is authoritative (12 GiB
base, distinct from 1 GiB RAM); do not substitute a different base for stale
4 GiB prose. Keep setup, exactly 100 scheduled UART deliveries, and auxiliary
GPU controls separate and seal the exact payloads/origin. No performance claim
belongs in this task.

The 4096-receipt/64 MiB GPU inspection window is an immediate capacity risk to
check against the real boot. If it or another runtime boundary prevents the
full qualification, retain the exact repro and create an ordered prerequisite;
do not hide semantic fixes, raise constants in a harness, truncate history,
begin after boot, reuse a paced warm pair, or label a software renderer GPU.
A fresh actual Daybreak critic must independently audit the complete frozen
proof and apply one bounded novel attack before marking verified. T22d, T23
and T24 remain required, and no merge is authorized.
