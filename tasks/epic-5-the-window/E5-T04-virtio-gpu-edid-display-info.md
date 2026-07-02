---
id: E5-T04
epic: 5
title: EDID blocks and display-info config events (hotplug plumbing)
priority: 504
status: pending
depends_on: [E5-T03]
estimate: S
capstone: false
---

## Goal
The device advertises `VIRTIO_GPU_F_EDID`, answers `VIRTIO_GPU_CMD_GET_EDID` with a valid
128-byte EDID block whose preferred detailed timing matches the current host canvas size,
and can raise `VIRTIO_GPU_EVENT_DISPLAY` through `events_read` + config-change interrupt —
the mechanism display resize (T22) and multi-display (T27) will ride on.

## Context
Linux's virtio-gpu driver reads EDID when the feature bit is offered and uses it to build
the DRM connector's mode list; without it the guest falls back to the bare
GET_DISPLAY_INFO rect plus stock VESA modes, and compositors may pick 1024x768. The EDID
must have: header `00 FF..FF 00`, a fake vendor (e.g. PNP id "WVM"), one detailed timing
descriptor for the native mode, range-limits descriptor, and a correct checksum byte
(sum of all 128 bytes ≡ 0 mod 256). Config events: device sets bit 0 (EVENT_DISPLAY) in
`events_read` and asserts the config-change interrupt; guest acknowledges by writing the
bit to `events_clear`, then re-issues GET_DISPLAY_INFO/GET_EDID. Reference: virtio v1.2
§5.7.4–5.7.6.10; EDID 1.4 spec; `drm_edid.c`.

## Deliverables
- `gpu/edid.rs`: EDID 1.4 generator `edid_for(width, height, refresh) -> [u8; 128]` with
  DTD pixel-clock math and checksum; unit-tested against `edid-decode` output fixtures.
- `GET_EDID` handler (scanout-indexed, `ERR_INVALID_SCANOUT_ID` for out-of-range).
- `VirtioGpu::set_display(width, height)` host API: updates pmode 0 + regenerated EDID,
  sets EVENT_DISPLAY, raises config IRQ; `events_clear` write-1-to-clear semantics.
- Feature bit `VIRTIO_GPU_F_EDID` offered and honored (no GET_EDID service if the guest
  did not negotiate it — respond ERR_UNSPEC).

## Acceptance criteria
- [ ] Generated EDID for 1280x800@60 passes `edid-decode` with zero warnings (fixture
      checked in; regeneration compared byte-for-byte in a test).
- [ ] Checksum byte is valid for every size in a sweep of 50 (w,h) pairs including odd
      widths and 3840x2160.
- [ ] `set_display()` flips `events_read` bit 0 and raises exactly one config interrupt;
      a second call before `events_clear` does not lose the event.
- [ ] `events_clear` write clears only the written bits.
- [ ] Native + wasm32 tests green.

## Adversarial verification
Refute by feeding the EDID to real consumers: run `edid-decode --check` on 20 generated
blocks (CI fixture) — any checksum or DTD error refutes. In the guest (once T07 lands),
`cat /sys/class/drm/card0-Virtual-1/edid | edid-decode` must agree with the host-side
size. Race the event path: call `set_display()` 1000 times from the host thread while a
test guest polls/clears — prove no lost final state (last size always readable) and no
spurious interrupt storm (IRQ count ≤ set_display count). A guest that negotiates
without F_EDID must never see GET_EDID succeed.

## Verification log
(empty)
