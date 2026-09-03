---
id: E5-T05a
epic: 5
title: Epic 5 built-in kernel driver config fragment
priority: 505.1
status: verified
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

### 2026-09-03 — coordinator — VERDICT: verified (user-directed)

- **Fragment audit — HELD.** Commit `4a6bf44` passes `python3 tools/check-kernel-fragment.py`, covering 49 required built-in symbols and 6 explicit disabled symbols with zero modular requirements. The coverage includes DRM/Virtio-GPU, fbdev/fbcon/font, virtio-input/evdev, virtio-snd/ALSA, virtio-console/VT, and the existing serial/storage/RTC/reset/debug/networking requirements.
- **Adversarial modularization — HELD.** A temporary copy with `CONFIG_DRM=y` changed to `CONFIG_DRM=m` was rejected with both `required built-in symbol is not =y: CONFIG_DRM=m` and `modular symbols are forbidden: CONFIG_DRM`.
- **Harness integrity — HELD.** `python3 -m py_compile tools/check-kernel-fragment.py`, `bash -n tools/check-kernel-config.sh`, and `git diff --check` passed.
- **Scope boundary — HELD.** This slice makes no kernel artifact or boot claim; those proofs are owned by E5-T05b and E5-T05c.
- Evidence: `evidence/e5-t05a/kernel-config-fragment-2026-09-03.json` (SHA-256 `c85ea247ca3d9aab5a6c589a08421578d63129cc2857cc282f0e64605c798107`).
