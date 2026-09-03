---
id: E5-T14a
epic: 5
title: pointer device specs and guest stream wiring
priority: 514.1
status: implemented
depends_on: [E5-T10c]
estimate: S
risk: medium
capstone: false
---

## Goal

Add the two guest-visible pointer devices that the browser will drive: an absolute virtio tablet
and a relative virtio mouse. Keep their capability maps, identity, slot wiring, and event stream
semantics deterministic and independently testable before adding DOM behavior.

## Deliverables

- Tablet and mouse `InputDeviceSpec` declarations with exact ABS/REL/KEY capability bitmaps and
  stable virtual-bus identities.
- Machine/controller wiring that keeps both devices present while the host selects which one
  receives events, without disturbing the existing keyboard slot.
- Native configuration and event-stream fixtures covering coordinates, relative deltas, buttons,
  and frame termination.

## Acceptance criteria

- [ ] Guest config for the tablet exposes `ABS_X`/`ABS_Y` with `0..32767` ranges and the expected
      left/right/middle/side/extra button bits; mouse config exposes `REL_X`/`REL_Y` and wheel axes.
- [ ] Both devices appear in deterministic slot order and each injected pointer frame is a
      complete `EV_*` sequence ending in exactly one `SYN_REPORT`.
- [ ] Native hostile fixtures reject malformed/unsupported pointer events without corrupting the
      other device or the keyboard queue.

## Adversarial verification

Read every config selector in a permuted order, request unsupported bitmap bytes, and interleave
tablet/mouse/button frames while the event queue is slow. The verifier must observe isolated
capabilities, bounded complete frames, and no keyboard-state changes.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `64ce03f` adds the deterministic absolute tablet and relative mouse
capability maps, stable virtual-bus identities, adjacent slots 4/5, independent Machine queue
service, and browser assembly wiring. Host frame injection now validates each device's advertised
event bitmap, rejects caller-supplied SYNs and invalid values, and preserves bounded whole-frame
delivery. The browser-only extra block device moved to slot 6 so the pointer pair is present on
every browser Linux boot without changing `/dev/vdb` enumeration.

The frozen-head recording ran `cargo test -p wasm-vm-core --test virtio_pointer`: 2 tests passed,
0 failed. It observed the permuted config-selector matrix, exact tablet/mouse bitmaps and ABS
metadata, complete event streams with one SYN_REPORT each, malformed/unsupported host events
rejected in isolation, and 100 interleaved bounded frames with unchanged keyboard state. The
affected input unit suite passed 19/19; core clippy and fmt passed; the wasm release build,
`make web-build`, and `make web-dist` passed. A direct Chromium run against the rebuilt page
booted the real busybox guest to `guestReady` with zero console, page, or request errors.

Evidence: `evidence/e5-t14a/pointer-devices-2026-09-03.json`, SHA-256
`6213d0d4bb03f2fbf532deff95214115e688f088c08dc4cdde4357aae61f4a21`; browser screenshot
`evidence/e5-t14a/pointer-browser-2026-09-03.png`, SHA-256
`c4150f9e8deac6fb0584be46aed095ddf8e0e8d2e2b777a5b943074a016f0d28`.
