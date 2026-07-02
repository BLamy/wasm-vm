---
id: E5-T07
epic: 5
title: First light — kernel fbcon text console rendered on the canvas
priority: 507
status: pending
depends_on: [E5-T03, E5-T05, E5-T06]
estimate: M
capstone: false
---

## Goal
Boot the T05 kernel against the T01–T03 device and the T06 sink and watch the Linux boot
log scroll *on the canvas*: virtio-gpu probes, DRM registers card0, fbdev emulation
creates fb0, fbcon takes over tty0, and every printk is real pixels — the epic's
first user-visible milestone, before any input exists.

## Context
This is the integration checkpoint that proves the whole read path: guest driver →
virtqueue → resource/transfer/flush → FrameSink → canvas. The kernel driver's probe
sequence is a known script we can verify against: GET_DISPLAY_INFO, (GET_EDID),
RESOURCE_CREATE_2D for the fbcon framebuffer, ATTACH_BACKING, SET_SCANOUT, then a
steady drumbeat of TRANSFER_TO_HOST_2D + RESOURCE_FLUSH as fbcon draws (with
damage-rect flushes for the cursor blink). Boot with `console=tty0 console=ttyS0` so
serial remains our debug lifeline. Expected dmesg: `[drm] features: -virgl +edid`,
`virtio-mmio ... virtio_gpu`, `fb0: virtio_gpudrmfb frame buffer device`,
`Console: switching to colour frame buffer device 160x50`.

## Deliverables
- Device wiring: virtio-gpu registered on the mmio bus in the browser runner and the
  native headless runner (null sink) with a device-tree node the kernel discovers.
- A demo page (`web/first-light.html` or a flag on the main page) booting to fbcon.
- Command-sequence trace mode on the GPU device (feature-gated log of ctrl commands)
  and a captured probe-sequence fixture checked into `tests/fixtures/gpu-probe.log`.
- Fix list: whatever T01–T06 bugs this integration shakes out, fixed with regression
  tests.

## Acceptance criteria
- [ ] Cold boot in the browser shows the boot log rendering on canvas within the E4
      boot-time budget +20%; text is legible and correctly colored (penguin logo if
      CONFIG_LOGO=y renders with correct colors — BGRA swizzle check).
- [ ] `dmesg` contains the virtio_gpu probe lines and `fb0: virtio_gpudrmfb`.
- [ ] `cat /sys/class/graphics/fb0/name` == `virtio_gpudrmfb`.
- [ ] From the serial console, `echo hello > /dev/tty0` appears on canvas; fbcon cursor
      blink produces small damage-rect flushes (observed in the trace), not full frames.
- [ ] Native headless run with the null sink executes the same probe sequence
      (trace matches the fixture modulo timestamps).

## Adversarial verification
Refute by stress and comparison: run `cat /dev/urandom | head -c 1000000 | hexdump -C`
on tty0 — a full-speed fbcon scroll for 30 s must not deadlock the controlq, leak
resources (resource count returns to baseline), or corrupt rows (screenshot vs a QEMU
run of the same kernel/rootfs: text content must match line-for-line at the same VT
size). VT switch stress: `chvt 2; chvt 1` in a loop 100x (kernel VTs) — any stuck blank
screen refutes. Kill the tab mid-scroll and reload: device must re-probe cleanly.
Compare dmesg against QEMU virtio-gpu-device boot of the identical kernel — unexplained
divergence in probe lines is a refutation.

## Verification log
(empty)
