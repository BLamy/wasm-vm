---
id: E5-T22a
epic: 5
title: Expose bounded display hotplug and actual GPU state to browser controllers
priority: 522.1
status: in-progress
depends_on: [E5-T04, E5-T18e]
estimate: S
risk: high
capstone: false
---

## Goal

Connect the existing verified GPU display-info/EDID hotplug boundary to WasmLinux
and both browser controller paths, with bounded inputs and truthful device state.

## Boundary

Own the host-to-device API and its direct/whole-machine-worker transport only.
Viewport debounce, presentation policy and real compositor adoption remain T22b-d.
Do not report requested dimensions as a guest scanout mode.

## Deliverables

- Strict WasmLinux setDisplay(width, height), rejecting non-integer, non-finite,
  out-of-range and non-number dimensions before any mutation.
- displayStats reporting the advertised mode, EDID, pending event, actual resource
  count/bytes and actual scanout resource dimensions separately.
- Explicit direct and worker controller methods, with safe absent/stopped behavior.
- Browser-visible demonstration of the real bridge, labeled as host hotplug only.

## Acceptance criteria

- [ ] Valid dimensions from 1 through the EDID limit update the advertised mode
      and EDID through the existing GPU boundary. Invalid dimensions do not
      partially mutate either dimension, event state or resources.
- [ ] One thousand updates retain the final mode and existing config-event
      coalescing; old resource dimensions, content and allocation accounting stay
      unchanged until the guest explicitly changes them.
- [ ] Stats describe the actual device resource map and bound scanout, never
      fabricate guest adoption from a host request. An absent device returns
      false/null; reentrant access returns a bounded error rather than panicking.
- [ ] Both actual browser direct and module-worker controllers perform the same
      update/read sequence and reject invalid requests. Stopped controllers
      cannot mutate the device. The built demo runs 126/0 with zero errors.

## Verification command

make verify-E5-T22a

## Adversarial verification

Send fractional, NaN, infinities, strings, booleans, null, negative, zero and
oversized dimensions, including a valid first dimension and invalid second.
Retain a live old-size resource across a storm and inspect its pixels, dimensions
and byte count. Attack a missing GPU and nested RefCell borrow. Use one independent
odd-size sequence through the real worker transport. Sabotage the new acceptance
test once. Carry T04's unchanged transport semantics forward.

## Verification log

### 2026-09-06 — coordinator — in-progress

First ordered S replacement for E5-T22. T18e is independently verified. This
slice makes no compositor-resize or release-to-frame latency claim.

