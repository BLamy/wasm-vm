---
id: E9-T22c
epic: 9
title: Qualify both full pinned performance workloads
priority: 524.92203
status: pending
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

(pending; no implementation or verification claim)
