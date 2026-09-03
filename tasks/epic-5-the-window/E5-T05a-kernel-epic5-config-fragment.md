---
id: E5-T05a
epic: 5
title: Epic 5 built-in kernel driver config fragment
priority: 505.1
status: in-progress
depends_on: [E4]
estimate: S
risk: high
capstone: false
---

## Goal

Extend the reviewed kernel config fragment with the built-in graphics, framebuffer, input, sound,
virtio-console, and VT symbols required by Epic 5, while retaining the existing E3/E4 headless
configuration and `CONFIG_MODULES=n` policy.

## Deliverables

- Updated `configs/wasm-vm.config` fragment containing every requested Epic 5 symbol as `=y` and
  explicit disablements where the defconfig would otherwise probe unsupported hardware.
- Updated `docs/kernel.md` table explaining each new symbol and the expected artifact-size impact.
- A deterministic fragment audit that reports missing, conflicting, or modular symbols before a
  kernel build is attempted.

## Acceptance criteria

- The fragment audit passes for DRM/Virtio-GPU + fbdev/fbcon, virtio-input/evdev,
  virtio-snd/ALSA, virtio-console, VT, and font symbols, with `CONFIG_MODULES=n`.
- Existing storage, serial, RTC, networking, and no-module fragment requirements remain present.
- No kernel artifact or boot claim is made by this slice; E5-T05b owns the rebuild.

## Adversarial verification

Flip each new symbol to `=m` or `=n`, duplicate it with a conflicting value, and remove one
dependency symbol. The audit must fail with the symbol named and must not silently accept a partial
fragment.

## Verification log
(empty)
